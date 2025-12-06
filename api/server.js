require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

console.log('✅ Server initializing...');
console.log('🌍 CORS enabled for all origins');
console.log('📊 Database URL configured:', !!process.env.DATABASE_URL);

// ============= ROOT & STATIC FILES =============

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= DEBUG ENDPOINT =============

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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= EARNINGS ENDPOINTS =============

// 1. Validate token
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
            'SELECT id, email, role, partner_id, created_at FROM users WHERE id = $1',
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
                email: user.email,
                role: user.role,
                partnerId: user.partner_id,
                createdAt: user.created_at
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 2. Dashboard summary (UPDATED with manual adjustments)
app.get('/api/earnings/dashboard/:userId', async (req, res) => {
    const userId = req.params.userId;
    
    try {
        // Query to get earnings by operator
        const result = await pool.query(`
            SELECT 
                'Airtel' as operator,
                COALESCE(SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END), 0) +
                COALESCE((SELECT SUM(amount) FROM earnings_adjustments WHERE user_id = $1), 0) as total_amount,
                COALESCE(COUNT(CASE WHEN r.status = 'approved' THEN 1 END), 0) as approved_referrals_count
            FROM referral_links rl
            LEFT JOIN referrals r ON rl.id = r.referral_link_id
            WHERE rl.user_id = $1 AND rl.operator = 'airtel'
            
            UNION ALL
            
            SELECT 
                'Vi' as operator,
                COALESCE(SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END), 0) +
                COALESCE((SELECT SUM(amount) FROM earnings_adjustments WHERE user_id = $1), 0) as total_amount,
                COALESCE(COUNT(CASE WHEN r.status = 'approved' THEN 1 END), 0) as approved_referrals_count
            FROM referral_links rl
            LEFT JOIN referrals r ON rl.id = r.referral_link_id
            WHERE rl.user_id = $1 AND rl.operator = 'vi'
            
            UNION ALL
            
            SELECT 
                'Jio' as operator,
                COALESCE(SUM(CASE WHEN r.status = 'approved' THEN 100 ELSE 0 END), 0) +
                COALESCE((SELECT SUM(amount) FROM earnings_adjustments WHERE user_id = $1), 0) as total_amount,
                COALESCE(COUNT(CASE WHEN r.status = 'approved' THEN 1 END), 0) as approved_referrals_count
            FROM referral_links rl
            LEFT JOIN referrals r ON rl.id = r.referral_link_id
            WHERE rl.user_id = $1 AND rl.operator = 'jio'
        `, [userId]);

        res.json({
            success: true,
            userEarnings: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 3. Winners of the week
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

        res.json({
            success: true,
            winners: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 4. Referral links
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
        res.status(500).json({
            success: false,
            error: error.message
        });
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. Withdrawals
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
        res.status(500).json({
            success: false,
            error: error.message
        });
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
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============= ADMIN ENDPOINTS =============

// Admin login (hardcoded credentials)
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Hardcoded credentials
        if (username === 'pratheek' && password === 'adminpratheek') {
            res.json({
                success: true,
                admin: {
                    id: 1,
                    username: 'pratheek'
                }
            });
        } else {
            res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get all referrals (for admin)
app.get('/api/admin/all-referrals', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                r.id,
                r.referral_link_id,
                r.referred_name,
                r.referred_email,
                r.referred_phone,
                r.order_details,
                r.status,
                r.created_at,
                rl.operator,
                u.email as referrer_username
            FROM referrals r
            JOIN referral_links rl ON r.referral_link_id = rl.id
            JOIN users u ON rl.user_id = u.id
            ORDER BY r.created_at DESC
        `);

        res.json({
            success: true,
            allReferrals: result.rows
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Approve/Reject referral (admin)
app.post('/api/admin/approve-referral/:id', async (req, res) => {
    const { id } = req.params;
    const { status, adminUsername } = req.body;

    try {
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid status'
            });
        }

        const result = await pool.query(
            'UPDATE referrals SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [status, id]
        );

        res.json({
            success: true,
            referral: result.rows[0]
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete referral (admin)
app.delete('/api/admin/delete-referral/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            'DELETE FROM referrals WHERE id = $1 RETURNING id',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Referral not found'
            });
        }

        res.json({
            success: true,
            message: 'Referral deleted'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
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

// ============= START SERVER =============

if (require.main === module) {
    app.listen(port, () => {
        console.log(`✅ Earnings server running on port ${port}`);
        console.log(`🌐 Dashboard: http://localhost:${port}`);
        console.log(`🌐 API: http://localhost:${port}/api/test`);
    });
}

module.exports = app;
