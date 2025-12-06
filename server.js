require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

// Database connection (Configured for Neon/Postgres)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for most cloud DBs like Neon
});

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Serve static files
app.use(express.static('public'));

console.log('✅ Server initializing...');
console.log('🌍 CORS enabled for all origins');
console.log('📊 Database URL configured:', !!process.env.DATABASE_URL);

// ============= ROOT & STATIC FILES =============

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============= TEST ENDPOINT =============

app.get('/api/test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({
            success: true,
            message: 'Database connected!',
            time: result.rows[0]
        });
    } catch (error) {
        console.error('Database Connection Error:', error);
        res.status(500).json({
            success: false,
            error: 'Database connection failed'
        });
    }
});

// ============= EARNINGS ENDPOINTS =============

// 1. Validate token
app.post('/api/earnings/validate-token', async (req, res) => {
    const { token, uid } = req.body;

    try {
        if (!token || !uid) {
            return res.status(400).json({ success: false, error: 'Missing token or uid' });
        }

        const userResult = await pool.query(
            'SELECT id, email, role, partner_id, created_at FROM users WHERE id = $1',
            [uid]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'User not found' });
        }

        const user = userResult.rows[0];

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                partnerId: user.partner_id,
                createdAt: user.created_at
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Dashboard summary (Fixed to include Available Balance)
app.get('/api/earnings/dashboard/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        // 1. Calculate Earnings per Operator
        const earningsResult = await pool.query(`
            SELECT 
                rl.operator,
                COUNT(r.id) AS total_referrals,
                COUNT(CASE WHEN r.status = 'approved' THEN 1 END) AS approved_referrals_count,
                COALESCE(
                    SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END),
                    0
                ) AS total_amount
            FROM referral_links rl
            LEFT JOIN referrals r ON rl.id = r.referral_link_id
            WHERE rl.user_id = $1
            GROUP BY rl.operator
        `, [userId]);

        // 2. Calculate Total Lifetime Earnings
        let totalLifetimeEarnings = 0;
        earningsResult.rows.forEach(row => {
            totalLifetimeEarnings += parseFloat(row.total_amount || 0);
        });

        // 3. Calculate Total Withdrawals (Pending + Approved/Paid)
        const withdrawalsResult = await pool.query(`
            SELECT COALESCE(SUM(requested_amount), 0) as total_withdrawn
            FROM withdrawals 
            WHERE user_id = $1 AND status IN ('pending', 'approved', 'paid')
        `, [userId]);

        const totalWithdrawn = parseFloat(withdrawalsResult.rows[0].total_withdrawn);
        const currentBalance = totalLifetimeEarnings - totalWithdrawn;

        res.json({
            success: true,
            totalEarnings: totalLifetimeEarnings.toFixed(2),
            currentBalance: currentBalance.toFixed(2), // New field for frontend
            totalWithdrawn: totalWithdrawn.toFixed(2),
            userEarnings: earningsResult.rows
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Winners of the week (Rolling 7 Days)
app.get('/api/earnings/winners-of-week', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id,
                u.email,
                COALESCE(
                    SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END),
                    0
                ) AS total_earnings,
                ROW_NUMBER() OVER (
                    ORDER BY SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END) DESC
                ) AS position
            FROM users u
            LEFT JOIN referral_links rl ON u.id = rl.user_id
            LEFT JOIN referrals r ON rl.id = r.referral_link_id
            WHERE r.created_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY u.id, u.email
            HAVING SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END) > 0
            ORDER BY total_earnings DESC
            LIMIT 10
        `);

        res.json({ success: true, winners: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. Referral links for a user
app.get('/api/earnings/referral-links/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await pool.query(
            'SELECT id, operator, referral_code FROM referral_links WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );

        res.json({ success: true, referralLinks: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. Earnings history
app.get('/api/earnings/history/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await pool.query(`
            SELECT 
                r.id,
                rl.operator,
                r.referred_name AS referred_person_name,
                CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END AS amount_earned,
                r.status,
                r.created_at
            FROM referrals r
            JOIN referral_links rl ON r.referral_link_id = rl.id
            WHERE rl.user_id = $1
            ORDER BY r.created_at DESC
        `, [userId]);

        res.json({ success: true, earningsHistory: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. Withdrawals history
app.get('/api/earnings/withdrawals/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await pool.query(`
            SELECT 
                id,
                operator,
                requested_amount,
                status,
                requested_at
            FROM withdrawals
            WHERE user_id = $1
            ORDER BY requested_at DESC
        `, [userId]);

        res.json({ success: true, withdrawals: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 7. Request withdrawal (SECURED)
app.post('/api/earnings/request-withdrawal', async (req, res) => {
    const { operator, requestedAmount, uid } = req.body;

    try {
        // --- VALIDATION START ---
        if (!operator || !uid) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const amount = parseFloat(requestedAmount);
        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid withdrawal amount' });
        }

        // Check 1: Does user already have a PENDING request? (Prevent double withdrawals)
        const pendingCheck = await pool.query(
            "SELECT id FROM withdrawals WHERE user_id = $1 AND status = 'pending'",
            [uid]
        );
        
        if (pendingCheck.rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'You already have a pending withdrawal request. Please wait for it to be processed.' 
            });
        }

        // Check 2: Calculate actual available balance
        // Total Earned (Lifetime)
        const earningsRes = await pool.query(`
            SELECT COALESCE(SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END), 0) as total_earned
            FROM referral_links rl
            JOIN referrals r ON rl.id = r.referral_link_id
            WHERE rl.user_id = $1
        `, [uid]);
        
        // Total Withdrawn (Pending + Approved + Paid)
        const withdrawalsRes = await pool.query(`
            SELECT COALESCE(SUM(requested_amount), 0) as total_withdrawn
            FROM withdrawals 
            WHERE user_id = $1 AND status IN ('pending', 'approved', 'paid')
        `, [uid]);

        const totalEarned = parseFloat(earningsRes.rows[0].total_earned);
        const totalWithdrawn = parseFloat(withdrawalsRes.rows[0].total_withdrawn);
        const availableBalance = totalEarned - totalWithdrawn;

        if (amount > availableBalance) {
            return res.status(400).json({ 
                success: false, 
                error: `Insufficient balance. Available: ₹${availableBalance.toFixed(2)}` 
            });
        }
        // --- VALIDATION END ---

        // Proceed to insert withdrawal
        const result = await pool.query(`
            INSERT INTO withdrawals (user_id, operator, requested_amount, status, requested_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING *
        `, [uid, operator, amount, 'pending']);

        res.json({
            success: true,
            withdrawal: result.rows[0],
            remainingBalance: (availableBalance - amount).toFixed(2)
        });

    } catch (error) {
        console.error('Withdrawal Request Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============= ERROR HANDLERS =============

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path
    });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal Server Error'
    });
});

// ============= START SERVER =============

app.listen(port, () => {
    console.log(`✅ Earnings server running on port ${port}`);
    console.log(`🌐 Dashboard: http://localhost:${port}`);
});

module.exports = app;
