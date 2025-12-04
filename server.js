require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const serverless = require('serverless-http');

const app = express();
const port = process.env.PORT || 5000;

// ============= DATABASE CONNECTIONS =============

// Earnings Database (PRIMARY)
const earningsPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Refer Database (for cross-database queries)
const referPool = new Pool({
  connectionString: process.env.REFER_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ============= MIDDLEWARE =============
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// ============= JWT CONFIG =============
const JWT_SECRET = process.env.JWT_SECRET || 'earnings_pratheek_secret_key_2025';
const JWT_EXPIRE = '7d';

// ============= TOKEN VALIDATION MIDDLEWARE =============
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, error: 'Invalid or expired token' });
  }
};

// ============= TEST ENDPOINT =============
app.get('/api/test', async (req, res) => {
  try {
    const result = await earningsPool.query('SELECT NOW()');
    res.json({
      success: true,
      message: 'Earnings database connected!',
      timestamp: result.rows[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============= USER ENDPOINTS =============

// 1. VALIDATE TOKEN - User verification
app.post('/api/earnings/validate-token', async (req, res) => {
  const token = req.body.token || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verify user exists in refer database
    const userCheck = await referPool.query(
      'SELECT id, username, email, full_name FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      user: {
        id: decoded.userId,
        username: decoded.username,
        email: userCheck.rows[0].email,
        fullName: userCheck.rows[0].full_name
      }
    });
  } catch (error) {
    res.status(403).json({ success: false, error: 'Invalid or expired token' });
  }
});

// 2. GET USER DASHBOARD - Total earnings by operator
app.get('/api/earnings/dashboard/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;

  // Security: ensure user can only see their own data
  if (parseInt(userId) !== req.user.userId) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const earnings = await earningsPool.query(
      `SELECT operator, total_amount, approved_referrals_count, updated_at
       FROM earnings
       WHERE user_id = $1
       ORDER BY operator`,
      [userId]
    );

    // Calculate total across all operators
    const totalEarnings = earnings.rows.reduce((sum, row) => sum + parseFloat(row.total_amount || 0), 0);

    res.json({
      success: true,
      userEarnings: earnings.rows,
      totalEarnings: totalEarnings,
      operators: ['Airtel', 'Vi', 'Jio']
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. GET EARNINGS HISTORY - Detailed transaction log
app.get('/api/earnings/history/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;
  const { operator } = req.query;

  if (parseInt(userId) !== req.user.userId) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  try {
    let query = `SELECT id, operator, referral_code, referred_person_name, amount_earned, status, created_at, admin_notes
                 FROM earnings_history
                 WHERE user_id = $1`;
    const params = [userId];

    if (operator) {
      query += ` AND operator = $${params.length + 1}`;
      params.push(operator);
    }

    query += ` ORDER BY created_at DESC`;

    const history = await earningsPool.query(query, params);

    res.json({
      success: true,
      earningsHistory: history.rows,
      count: history.rows.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. GET WITHDRAWAL HISTORY
app.get('/api/earnings/withdrawals/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;

  if (parseInt(userId) !== req.user.userId) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const withdrawals = await earningsPool.query(
      `SELECT id, operator, requested_amount, status, admin_notes, rejection_reason, requested_at, processed_at, processed_by_admin
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY requested_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      withdrawals: withdrawals.rows,
      count: withdrawals.rows.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. GET USER'S REFERRAL LINKS (from refer database)
app.get('/api/earnings/referral-links/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;

  if (parseInt(userId) !== req.user.userId) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  try {
    const links = await referPool.query(
      `SELECT id, referral_code, operator, total_clicks, created_at
       FROM referral_links
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      referralLinks: links.rows,
      count: links.rows.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. REQUEST WITHDRAWAL
app.post('/api/earnings/request-withdrawal', verifyToken, async (req, res) => {
  const { operator, requestedAmount } = req.body;
  const userId = req.user.userId;
  const username = req.user.username;

  if (!operator || !requestedAmount) {
    return res.status(400).json({ success: false, error: 'Operator and amount required' });
  }

  try {
    // Check if user has earnings for this operator
    const earningsCheck = await earningsPool.query(
      'SELECT total_amount FROM earnings WHERE user_id = $1 AND operator = $2',
      [userId, operator]
    );

    if (earningsCheck.rows.length === 0 || parseFloat(earningsCheck.rows[0].total_amount) === 0) {
      return res.status(400).json({ success: false, error: 'No earnings for this operator' });
    }

    // Create withdrawal request
    const withdrawal = await earningsPool.query(
      `INSERT INTO withdrawals (user_id, username, operator, requested_amount, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [userId, username, operator, requestedAmount]
    );

    res.json({
      success: true,
      message: 'Withdrawal request submitted',
      withdrawal: withdrawal.rows[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. GET WITHDRAWAL STATUS
app.get('/api/earnings/withdrawal-status/:withdrawalId', verifyToken, async (req, res) => {
  const { withdrawalId } = req.params;

  try {
    const withdrawal = await earningsPool.query(
      'SELECT * FROM withdrawals WHERE id = $1',
      [withdrawalId]
    );

    if (withdrawal.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Withdrawal not found' });
    }

    const wd = withdrawal.rows[0];

    // Verify ownership
    if (wd.user_id !== req.user.userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    res.json({ success: true, withdrawal: wd });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. GET WINNERS OF THE WEEK (for user dashboard display)
app.get('/api/earnings/winners-of-week', async (req, res) => {
  try {
    const winners = await earningsPool.query(
      `SELECT user_id, username, full_name, position, total_earnings, featured_message, selected_at
       FROM winners_of_week
       WHERE week_start_date <= CURDATE() AND week_end_date >= CURDATE()
       ORDER BY position ASC`
    );

    res.json({
      success: true,
      winners: winners.rows
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============= ADMIN ENDPOINTS =============

// 1. ADMIN LOGIN
app.post('/api/admin/earnings/login', async (req, res) => {
  const { username, password } = req.body;

  if (username !== 'pratheek' || password !== 'adminpratheek') {
    return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
  }

  try {
    // Check if admin exists, if not create it
    const adminCheck = await earningsPool.query(
      'SELECT id FROM earnings_admins WHERE username = $1',
      [username]
    );

    if (adminCheck.rows.length === 0) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await earningsPool.query(
        'INSERT INTO earnings_admins (username, password_hash) VALUES ($1, $2)',
        [username, hashedPassword]
      );
    }

    // Generate admin token
    const adminToken = jwt.sign(
      { adminUsername: username, isAdmin: true },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRE }
    );

    res.json({
      success: true,
      message: 'Admin login successful',
      adminToken: adminToken,
      admin: { username: username }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin token verification middleware
const verifyAdminToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'No admin token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ success: false, error: 'Not an admin token' });
    }
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, error: 'Invalid admin token' });
  }
};

// 2. GET ALL USERS' EARNINGS
app.get('/api/admin/earnings/all-users', verifyAdminToken, async (req, res) => {
  try {
    const users = await earningsPool.query(
      `SELECT DISTINCT user_id, username, 
              SUM(total_amount) as total_earnings,
              COUNT(DISTINCT operator) as operators_count
       FROM earnings
       GROUP BY user_id, username
       ORDER BY total_earnings DESC`
    );

    res.json({
      success: true,
      users: users.rows,
      totalUsers: users.rows.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. GET INDIVIDUAL USER PERFORMANCE
app.get('/api/admin/earnings/user/:userId', verifyAdminToken, async (req, res) => {
  const { userId } = req.params;

  try {
    // Get earnings by operator
    const earnings = await earningsPool.query(
      `SELECT operator, total_amount, approved_referrals_count, updated_at
       FROM earnings
       WHERE user_id = $1
       ORDER BY operator`,
      [userId]
    );

    // Get earnings history
    const history = await earningsPool.query(
      `SELECT id, operator, referral_code, referred_person_name, amount_earned, status, created_at
       FROM earnings_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    // Get pending withdrawals
    const withdrawals = await earningsPool.query(
      `SELECT id, operator, requested_amount, status, requested_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY requested_at DESC`,
      [userId]
    );

    // Get referral links from refer database
    const referralLinks = await referPool.query(
      `SELECT referral_code, operator, total_clicks, created_at
       FROM referral_links
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      earnings: earnings.rows,
      earningsHistory: history.rows,
      withdrawals: withdrawals.rows,
      referralLinks: referralLinks.rows
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. ADJUST USER EARNINGS (Manual admin adjustment)
app.post('/api/admin/earnings/adjust-earnings', verifyAdminToken, async (req, res) => {
  const { userId, username, adjustmentAmount, adjustmentType, reason } = req.body;

  if (!userId || !adjustmentAmount || !adjustmentType || !reason) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  try {
    // Record the adjustment
    await earningsPool.query(
      `INSERT INTO admin_adjustments (user_id, username, adjustment_amount, adjustment_type, reason, admin_username)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, username, adjustmentAmount, adjustmentType, reason, req.admin.adminUsername]
    );

    res.json({
      success: true,
      message: `Adjustment of ${adjustmentAmount} ${adjustmentType} recorded for user ${username}`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. GET ALL WITHDRAWAL REQUESTS
app.get('/api/admin/earnings/withdrawals', verifyAdminToken, async (req, res) => {
  try {
    const withdrawals = await earningsPool.query(
      `SELECT id, user_id, username, operator, requested_amount, status, admin_notes, requested_at
       FROM withdrawals
       ORDER BY requested_at DESC`
    );

    const pending = withdrawals.rows.filter(w => w.status === 'pending');
    const processed = withdrawals.rows.filter(w => w.status !== 'pending');

    res.json({
      success: true,
      allWithdrawals: withdrawals.rows,
      pendingCount: pending.length,
      processedCount: processed.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. APPROVE/REJECT WITHDRAWAL
app.put('/api/admin/earnings/approve-withdrawal/:withdrawalId', verifyAdminToken, async (req, res) => {
  const { withdrawalId } = req.params;
  const { status, adminNotes, rejectionReason } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  try {
    const withdrawal = await earningsPool.query(
      `UPDATE withdrawals 
       SET status = $1, admin_notes = $2, rejection_reason = $3, processed_at = NOW(), processed_by_admin = $4
       WHERE id = $5
       RETURNING *`,
      [status, adminNotes, rejectionReason, req.admin.adminUsername, withdrawalId]
    );

    res.json({
      success: true,
      message: `Withdrawal ${status}`,
      withdrawal: withdrawal.rows[0]
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 7. GET ALL PENDING WITHDRAWALS
app.get('/api/admin/earnings/pending-withdrawals', verifyAdminToken, async (req, res) => {
  try {
    const withdrawals = await earningsPool.query(
      `SELECT id, user_id, username, operator, requested_amount, status, requested_at
       FROM withdrawals
       WHERE status = 'pending'
       ORDER BY requested_at ASC`
    );

    res.json({
      success: true,
      pendingWithdrawals: withdrawals.rows,
      count: withdrawals.rows.length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. SET WINNERS OF THE WEEK
app.post('/api/admin/earnings/set-winners', verifyAdminToken, async (req, res) => {
  const { winner1, winner2 } = req.body;

  if (!winner1 || !winner2) {
    return res.status(400).json({ success: false, error: 'Two winners required' });
  }

  try {
    // Delete previous winners for this week
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    
    await earningsPool.query(
      `DELETE FROM winners_of_week 
       WHERE week_start_date = $1::DATE`,
      [weekStart.toISOString().split('T')[0]]
    );

    // Insert new winners
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    for (let i = 0; i < 2; i++) {
      const winner = i === 0 ? winner1 : winner2;
      const position = i + 1;

      await earningsPool.query(
        `INSERT INTO winners_of_week (user_id, username, position, total_earnings, featured_message, week_start_date, week_end_date, selected_by_admin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          winner.user_id,
          winner.username,
          position,
          winner.total_earnings || 0,
          winner.featured_message || `🎉 Top ${position} Earner of the Week!`,
          weekStart.toISOString().split('T')[0],
          weekEnd.toISOString().split('T')[0],
          req.admin.adminUsername
        ]
      );
    }

    res.json({
      success: true,
      message: 'Winners updated successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 9. GET CURRENT WINNERS
app.get('/api/admin/earnings/current-winners', verifyAdminToken, async (req, res) => {
  try {
    const winners = await earningsPool.query(
      `SELECT id, user_id, username, position, total_earnings, featured_message
       FROM winners_of_week
       WHERE week_start_date <= CURDATE() AND week_end_date >= CURDATE()
       ORDER BY position ASC`
    );

    res.json({
      success: true,
      winners: winners.rows
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 10. EXPORT EARNINGS DATA (CSV)
app.get('/api/admin/earnings/export', verifyAdminToken, async (req, res) => {
  try {
    const { type, userId } = req.query; // type: 'all-users', 'user-details', 'withdrawals'

    let data = [];
    let filename = 'earnings-export.csv';

    if (type === 'all-users') {
      const users = await earningsPool.query(
        `SELECT user_id, username, operator, total_amount, approved_referrals_count
         FROM earnings
         ORDER BY user_id, operator`
      );
      data = users.rows;
      filename = 'all-users-earnings.csv';
    } else if (type === 'user-details' && userId) {
      const userEarnings = await earningsPool.query(
        `SELECT * FROM earnings_history WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
      );
      data = userEarnings.rows;
      filename = `user-${userId}-earnings.csv`;
    } else if (type === 'withdrawals') {
      const withdrawals = await earningsPool.query(
        `SELECT id, user_id, username, operator, requested_amount, status, requested_at
         FROM withdrawals
         ORDER BY requested_at DESC`
      );
      data = withdrawals.rows;
      filename = 'withdrawals-export.csv';
    }

    // Convert to CSV
    if (data.length === 0) {
      return res.json({ success: false, error: 'No data to export' });
    }

    const csv = convertToCSV(data);
    
    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to convert JSON to CSV
function convertToCSV(data) {
  if (!data || data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const csv = [headers.join(',')];

  data.forEach(row => {
    const values = headers.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
    });
    csv.push(values.join(','));
  });

  return csv.join('\n');
}

// ============= SERVER START =============
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Earnings server running on port ${port}`);
  });
}

// Export for serverless deployment
module.exports = app;
module.exports.handler = serverless(app);
