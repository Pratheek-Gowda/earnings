# earnings.pratheek.shop - Earnings & Withdrawal Management System

A complete earnings tracking and withdrawal management platform for your SIM referral system. Users can view their earnings by operator, request withdrawals, and admins can manage approvals and payouts.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database (Neon)
- Vercel account for deployment

### Installation

1. **Clone & Setup**
```bash
git clone <repository-url>
cd earnings-platform
npm install
```

2. **Environment Variables (.env)**
```
DATABASE_URL='postgresql://...' # Earnings database
REFER_DATABASE_URL='postgresql://...' # Refer system database
JWT_SECRET='earnings_pratheek_secret_key_2025'
PORT=5000
NODE_ENV=development
```

3. **Database Setup**
- Create new PostgreSQL database on Neon
- Run the SQL schema from `database-schema.sql`

```bash
# Using psql
psql $DATABASE_URL < database-schema.sql
```

4. **Run Locally**
```bash
npm start
# Server runs on http://localhost:5000
```

## 📁 Project Structure

```
earnings-platform/
├── server.js                 # Express backend with all APIs
├── index.html               # User dashboard (protected)
├── admin.html               # Admin panel
├── package.json             # Dependencies
├── .env                     # Environment variables (not in git)
├── vercel.json              # Vercel deployment config
├── database-schema.sql      # PostgreSQL schema
└── README.md
```

## 🔐 Authentication

### User Access
- Token-based authentication via JWT
- Users redirected from refer.pratheek.shop with token in URL
- Token stored in localStorage for session persistence
- Protected API endpoints require valid token

**Token Format:**
```javascript
{
  userId: 123,
  username: "user",
  iat: 1234567890,
  exp: 1234654290
}
```

### Admin Access
- Direct login at `/admin` with credentials:
  - Username: `pratheek`
  - Password: `adminpratheek`
- Separate JWT token for admin operations

## 📊 User Dashboard (`/`)

### Features
- **Total Earnings Summary**: Aggregate earnings across all operators
- **Earnings by Operator**: Cards showing Airtel, Vi, Jio earnings separately
- **Referral Links**: View and copy personal referral links
- **Earnings History**: Detailed transaction log of all earnings
- **Withdrawal Requests**: History of withdrawal requests and status
- **Winners of the Week**: Featured top 2 earners

### Withdrawal Rules
- Users can request withdrawal **anytime**
- Minimum 3 approved referrals per operator required
- Admin manually reviews and approves/rejects
- No automatic processing - all manual by admin

## 👨‍💼 Admin Panel (`/admin`)

### Sections

#### 1. **Dashboard**
- Quick statistics (total users, pending withdrawals, total earnings)
- Quick action buttons

#### 2. **Withdrawal Requests**
- View all withdrawals (pending, approved, rejected, processed)
- Take action on pending requests
- Add notes and process withdrawals

#### 3. **Users Management**
- View all users and their total earnings
- Click "View" to see individual performance
- See earnings breakdown by operator
- View withdrawal history

#### 4. **Earnings Adjustments**
- Manually adjust user earnings (add/subtract)
- Provide reason for adjustment
- Tracked in admin_adjustments table

#### 5. **Winners of the Week**
- Select top 2 earners from leaderboard
- Manually curate winners
- Display on user dashboard
- Featured with custom message

#### 6. **Export Data**
- Export all users' earnings to CSV
- Export withdrawal history
- Export admin adjustments
- Data download for reports

## 🔌 API Endpoints

### User Endpoints (Requires Token)

**POST** `/api/earnings/validate-token`
- Validate JWT token and get user info

**GET** `/api/earnings/dashboard/:userId`
- Get total earnings by operator

**GET** `/api/earnings/history/:userId?operator=Airtel`
- Get earnings transaction history

**GET** `/api/earnings/withdrawals/:userId`
- Get withdrawal request history

**GET** `/api/earnings/referral-links/:userId`
- Get user's referral links

**POST** `/api/earnings/request-withdrawal`
```json
{
  "operator": "Airtel",
  "requestedAmount": 500
}
```

**GET** `/api/earnings/winners-of-week`
- Get current week's featured winners

### Admin Endpoints (Requires Admin Token)

**POST** `/api/admin/earnings/login`
```json
{
  "username": "pratheek",
  "password": "adminpratheek"
}
```

**GET** `/api/admin/earnings/all-users`
- All users with aggregate earnings

**GET** `/api/admin/earnings/user/:userId`
- Individual user performance

**GET** `/api/admin/earnings/withdrawals`
- All withdrawal requests

**GET** `/api/admin/earnings/pending-withdrawals`
- Only pending withdrawal requests

**PUT** `/api/admin/earnings/approve-withdrawal/:withdrawalId`
```json
{
  "status": "approved",
  "adminNotes": "Processed to account"
}
```

**POST** `/api/admin/earnings/adjust-earnings`
```json
{
  "userId": 123,
  "username": "user",
  "adjustmentAmount": 100,
  "adjustmentType": "add",
  "reason": "Bonus for extra referrals"
}
```

**POST** `/api/admin/earnings/set-winners`
```json
{
  "winner1": { "user_id": 1, "username": "top_user" },
  "winner2": { "user_id": 2, "username": "second_user" }
}
```

**GET** `/api/admin/earnings/export?type=all-users`
- Export data as CSV

## 🗄️ Database Schema

### Tables

**earnings**
- Total earnings per user per operator
- Unique constraint on (user_id, operator)

**earnings_history**
- Detailed transaction log
- Each referral approval creates entry
- Tracks amount earned and status

**withdrawals**
- Withdrawal request tracking
- Statuses: pending, approved, rejected, processed
- Admin notes and rejection reasons

**admin_adjustments**
- Manual earnings changes by admin
- Tracks reason and admin username
- Complete audit trail

**winners_of_week**
- Featured top 2 earners
- Week date range
- Featured message customization

**earnings_admins**
- Admin user accounts (currently just pratheek)

**token_blacklist**
- Blacklisted tokens for logout (optional)

## 📤 Deployment to Vercel

1. **Connect GitHub Repository**
```bash
git push origin main
```

2. **Set Environment Variables in Vercel**
- Go to Vercel Project Settings → Environment Variables
- Add:
  - `DATABASE_URL` (earnings database URL)
  - `REFER_DATABASE_URL` (refer system database URL)
  - `JWT_SECRET` (your secret key)
  - `NODE_ENV=production`

3. **Deploy**
- Vercel auto-deploys on push to main
- Or manually trigger: `vercel deploy --prod`

4. **Custom Domain**
- Add `earnings.pratheek.shop` in Vercel project settings
- Configure DNS CNAME record

## 🔗 Integration with refer.pratheek.shop

**From refer.pratheek.shop, when user logs in:**

```javascript
// Generate JWT token for user
const token = jwt.sign(
  { userId: user.id, username: user.username },
  JWT_SECRET,
  { expiresIn: '7d' }
);

// Redirect to earnings dashboard
window.location.href = `https://earnings.pratheek.shop?token=${token}`;
```

## 💡 How It Works

### Flow Diagram

```
1. User logs in → refer.pratheek.shop
2. refer.pratheek.shop generates JWT token
3. Redirects to → earnings.pratheek.shop?token=XXX
4. earnings.pratheek.shop validates token
5. User sees their earnings dashboard
6. User can request withdrawal
7. Admin reviews in admin.pratheek.shop/admin
8. Admin approves/rejects
9. Withdrawal status updates on user dashboard
```

### Earnings Calculation

1. Referral submitted on refer.pratheek.shop
2. Admin approves referral
3. Earnings entry created in earnings_history
4. Total earnings updated in earnings table
5. User sees updated earnings on dashboard

## 🛡️ Security

- ✅ JWT token-based authentication
- ✅ Token expiration (7 days)
- ✅ Password hashing with bcrypt
- ✅ HTTPS required
- ✅ CORS configured for cross-origin requests
- ✅ Environment variables for sensitive data
- ✅ User can only access own data
- ✅ Admin token validation on all admin endpoints

## 📝 Database Credentials (Secure)

**NEVER commit .env file to git!**

Add to .gitignore:
```
.env
.env.local
.env.*.local
```

## 🐛 Troubleshooting

**Token Validation Error**
- Check if token is expired (7 days max)
- Ensure JWT_SECRET matches refer.pratheek.shop
- Check Authorization header format: `Bearer {token}`

**Database Connection Error**
- Verify DATABASE_URL is correct
- Check Neon PostgreSQL is active
- Ensure SSL mode is required

**Admin Login Failed**
- Username: `pratheek` (case-sensitive)
- Password: `adminpratheek` (case-sensitive)

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review API endpoint documentation
3. Check database schema for data structure

## 📄 License

Proprietary - Pratheek Shop

---

**Last Updated**: December 4, 2025  
**Version**: 1.0.0
