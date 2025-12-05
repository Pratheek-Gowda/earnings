require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5000;

// Database connection (SAME DATABASE AS refer.pratheek.shop)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

app.use(express.json());

// Test endpoint
app.get('/api/test', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({
            success: true,
            message: 'Database connected!',
            time: result.rows[0],
            env: {
                hasDatabase: !!process.env.DATABASE_URL,
                nodeEnv: process.env.NODE_ENV
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= EARNINGS DASHBOARD ENDPOINTS =============

// 1. Validate token - validate user from refer.pratheek.shop
app.post('/api/earnings/validate-token', async (req, res) => {
    const { token, uid } = req.body;
    
    console.log('Validate token request:', { token, uid });
    
    try {
        if (!token || !uid) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing token or uid' 
            });
        }
        
        // Query user by ID from refer database
        const userResult = await pool.query(
            'SELECT id, username, email, full_name FROM users WHERE id = $1',
            [uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false, 
                error: 'User not found in database' 
            });
        }
        
        const user = userResult.rows[0];
        
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.full_name
            }
        });
        
    } catch (error) {
        console.error('Validate token error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 2. Get earnings dashboard data
app.get('/api/earnings/dashboard/:userId', async (req, res) => {
    const { userId } = req.params;
    
    console.log('Dashboard request for userId:', userId);
    
    try {
        // Get all referrals with earnings for this user by operator
        const earningsResult = await pool.query(`
            SELECT 
                rl.operator,
                COUNT(r.id) as total_referrals,
                COUNT(CASE WHEN r.status = 'approved' THEN 1 END) as approved_referrals_count,
                COALESCE(SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END), 0) as total_amount
            FROM referral_links rl
            LEFT JOIN referrals r ON rl.id = r.referral_link_id
            WHERE rl.user_id = $1
            GROUP BY rl.operator
        `, [userId]);
        
        let totalEarnings = 0;
        earningsResult.rows.forEach(row => {
            totalEarnings += parseFloat(row.total_amount || 0);
        });
        
        res.json({
            success: true,
            totalEarnings: totalEarnings.toFixed(2),
            userEarnings: earningsResult.rows
        });
        
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 3. Get winners of the week
app.get('/api/earnings/winners-of-week', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id,
                u.username,
                u.full_name,
                COALESCE(SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END), 0) as total_earnings,
                ROW_NUMBER() OVER (ORDER BY SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END) DESC) as position,
                '' as featured_message
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
        console.error('Winners error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 4. Get referral links for user
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
        console.error('Referral links error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 5. Get earnings history for user
app.get('/api/earnings/history/:userId', async (req, res) => {
    const { userId } = req.params;
    
    try {
        const result = await pool.query(`
            SELECT 
                r.id,
                rl.operator,
                r.referred_name as referred_person_name,
                CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END as amount_earned,
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
        console.error('History error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 6. Get withdrawals for user
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
        console.error('Withdrawals error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 7. Request withdrawal
app.post('/api/earnings/request-withdrawal', async (req, res) => {
    const { operator, requestedAmount, uid } = req.body;
    const authHeader = req.headers.authorization;
    
    console.log('Withdrawal request:', { operator, requestedAmount, uid });
    
    try {
        if (!operator || !requestedAmount || !uid) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields' 
            });
        }
        
        // Insert withdrawal request
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
        console.error('Withdrawal error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============= ERROR HANDLING =============

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: err.message
    });
});

// Start server
app.listen(port, () => {
    console.log(`✅ Earnings server running on port ${port}`);
    console.log(`📊 Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
});

module.exports = app;
