require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5000;

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

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
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============= EARNINGS ENDPOINTS =============

// 1. Validate token (from refer.pratheek.shop)
app.post('/api/earnings/validate-token', async (req, res) => {
    const { token, uid } = req.body;

    try {
        if (!token || !uid) {
            return res.status(400).json({
                success: false,
                error: 'Missing token or uid'
            });
        }

        const userResult = await pool.query(
            'SELECT id, name, email, phone FROM users WHERE id = $1',
            [uid]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'User not found'
            });
        }

        const user = userResult.rows[0];

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// 2. Dashboard summary
app.get('/api/earnings/dashboard/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await pool.query(`
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

        let total = 0;
        result.rows.forEach(row => {
            total += parseFloat(row.total_amount || 0);
        });

        res.json({
            success: true,
            totalEarnings: total.toFixed(2),
            userEarnings: result.rows
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Winners of the week
app.get('/api/earnings/winners-of-week', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id,
                u.username,
                u.full_name,
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
            GROUP BY u.id, u.username, u.full_name
            HAVING SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END) > 0
            ORDER BY total_earnings DESC
            LIMIT 10
        `);

        res.json({
            success: true,
            winners: result.rows
        });
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

        res.json({
            success: true,
            referralLinks: result.rows
        });
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

        res.json({
            success: true,
            earningsHistory: result.rows
        });
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

        res.json({
            success: true,
            withdrawals: result.rows
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 7. Request withdrawal
app.post('/api/earnings/request-withdrawal', async (req, res) => {
    const { operator, requestedAmount, uid } = req.body;

    try {
        if (!operator || !requestedAmount || !uid) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        const result = await pool.query(`
            INSERT INTO withdrawals (user_id, operator, requested_amount, status, requested_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING *
        `, [uid, operator, requestedAmount, 'pending']);

        res.json({
            success: true,
            withdrawal: result.rows[0]
        });
    } catch (error) {
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
        error: err.message
    });
});
// Add this TEMPORARY endpoint to check your table structure
app.get('/api/debug/table-structure', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'users'
            ORDER BY ordinal_position
        `);
        res.json({
            success: true,
            columns: result.rows
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});


// ============= START SERVER =============

app.listen(port, () => {
    console.log(`✅ Earnings server running on port ${port}`);
    console.log(`🌐 Test: http://localhost:${port}/api/test`);
});

module.exports = app;
