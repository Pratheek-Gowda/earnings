# 1. DELETE current server.js
rm server.js

# 2. CREATE new server.js with this exact content:
cat > server.js << 'EOF'
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Test endpoint
app.get('/api/test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ success: true, message: 'Database connected!', time: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Validate token
app.post('/api/earnings/validate-token', async (req, res) => {
    const { token, uid } = req.body;
    try {
        if (!token || !uid) {
            return res.status(400).json({ success: false, error: 'Missing token or uid' });
        }
        
        const userResult = await pool.query(
            'SELECT id, username, email, full_name FROM users WHERE id = $1', [uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ success: false, error: 'User not found' });
        }
        
        res.json({
            success: true,
            user: {
                id: userResult.rows[0].id,
                username: userResult.rows[0].username,
                email: userResult.rows[0].email,
                fullName: userResult.rows[0].full_name
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Dashboard
app.get('/api/earnings/dashboard/:userId', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT rl.operator, COUNT(r.id) as total_referrals,
                COUNT(CASE WHEN r.status = 'approved' THEN 1 END) as approved_referrals_count,
                COALESCE(SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END), 0) as total_amount
            FROM referral_links rl
            LEFT JOIN referrals r ON rl.id = r.referral_link_id
            WHERE rl.user_id = $1
            GROUP BY rl.operator
        `, [req.params.userId]);
        
        let total = 0;
        result.rows.forEach(r => total += parseFloat(r.total_amount || 0));
        
        res.json({ success: true, totalEarnings: total.toFixed(2), userEarnings: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Winners
app.get('/api/earnings/winners-of-week', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.full_name,
                COALESCE(SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END), 0) as total_earnings,
                ROW_NUMBER() OVER (ORDER BY SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END) DESC) as position
            FROM users u
            LEFT JOIN referral_links rl ON u.id = rl.user_id
            LEFT JOIN referrals r ON rl.id = r.referral_link_id
            WHERE r.created_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY u.id, u.username, u.full_name
            HAVING SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END) > 0
            ORDER BY total_earnings DESC LIMIT 10
        `);
        res.json({ success: true, winners: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Referral links
app.get('/api/earnings/referral-links/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, operator, referral_code FROM referral_links WHERE user_id = $1 ORDER BY created_at DESC',
            [req.params.userId]
        );
        res.json({ success: true, referralLinks: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// History
app.get('/api/earnings/history/:userId', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.id, rl.operator, r.referred_name as referred_person_name,
                CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END as amount_earned,
                r.status, r.created_at
            FROM referrals r
            JOIN referral_links rl ON r.referral_link_id = rl.id
            WHERE rl.user_id = $1
            ORDER BY r.created_at DESC
        `, [req.params.userId]);
        res.json({ success: true, earningsHistory: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Withdrawals
app.get('/api/earnings/withdrawals/:userId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, operator, requested_amount, status, requested_at FROM withdrawals WHERE user_id = $1 ORDER BY requested_at DESC',
            [req.params.userId]
        );
        res.json({ success: true, withdrawals: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Request withdrawal
app.post('/api/earnings/request-withdrawal', async (req, res) => {
    const { operator, requestedAmount, uid } = req.body;
    try {
        if (!operator || !requestedAmount || !uid) {
            return res.status(400).json({ success: false, error: 'Missing fields' });
        }
        
        const result = await pool.query(
            'INSERT INTO withdrawals (user_id, operator, requested_amount, status, requested_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
            [uid, operator, requestedAmount, 'pending']
        );
        res.json({ success: true, withdrawal: result.rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 404
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Not found', path: req.path });
});

app.listen(port, () => {
    console.log(`✅ Server on port ${port}`);
    console.log(`🌐 Test: http://localhost:${port}/api/test`);
});
EOF

# 3. Restart server
node server.js
