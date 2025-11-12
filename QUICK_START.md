# Quick Start Guide

## 🚀 Your System is Ready!

Your multi-tenant GIS system has been successfully deployed to Supabase.

---

## Start the Server

```bash
npm run server
```

Or with auto-reload for development:

```bash
npm run server:dev
```

---

## Access the Admin Dashboard

1. Open your browser and go to:
   ```
   http://localhost:3000/admin-login.html
   ```

2. Login with these credentials:
   ```
   Email: admin@gissystem.com
   Password: admin123
   ```

---

## What You Can Do Now

### 1. View Customers
After logging in, you'll see 5 test customers:
- Acme Corporation
- Global Logistics Inc
- City Planning Department
- Environmental Research Group
- Real Estate Analytics

### 2. Create New Customers
Click "New Customer" button to add a new customer:
- Enter customer name
- Enter subdomain (lowercase, no spaces)
- Set subscription tier
- Configure branding (colors, logo)

### 3. Customize HTML for Customers
- Click "HTML" button next to any customer
- Select a page to customize (dashboard, map, login, etc.)
- Edit HTML, CSS, or JavaScript
- Preview changes in real-time
- Save to deploy immediately

### 4. Configure Teable.io Integration
- Click "Edit" on any customer
- Navigate to "Teable Configuration"
- Enter Teable.io credentials:
  - Base URL
  - Space ID
  - Base ID
  - Access Token

### 5. Manage Users
- View all users per customer
- Add new users with different roles:
  - Owner (full access)
  - Admin (manage users and settings)
  - Editor (edit data)
  - Viewer (read-only)

---

## Test Customers

All test customers have these users created:

**For `acme` customer:**
- owner@acme.com
- admin@acme.com
- editor@acme.com

**Pattern applies to all customers:**
- owner@[subdomain].com
- admin@[subdomain].com
- editor@[subdomain].com

---

## Important URLs

### Development
- Admin Login: http://localhost:3000/admin-login.html
- Admin Dashboard: http://localhost:3000/admin-dashboard.html
- HTML Editor: http://localhost:3000/html-editor.html

### Production (after deployment)
- Admin Login: https://mapz.in/admin-login.html
- Customer Sites: https://[subdomain].mapz.in

---

## Database Connection

Your Supabase database at `ortzrolwcjkypglqpynh.supabase.co` contains:

✅ **1** Super admin account
✅ **5** Test customers
✅ **15** Customer users
✅ **5** Teable.io configurations
✅ **35** Usage metric records

---

## Features Available

✅ Multi-tenant architecture with complete data isolation
✅ Subdomain-based customer routing
✅ Custom branding per customer (logo, colors)
✅ HTML/CSS/JS customization with version control
✅ Teable.io integration for data sources
✅ Google Sheets integration (OAuth configured)
✅ User management with role-based access
✅ Activity logging and audit trail
✅ Usage metrics for billing
✅ Secure authentication with RLS

---

## Troubleshooting

### Server won't start
```bash
# Check if port 3000 is already in use
lsof -i :3000

# Kill the process if needed
kill -9 [PID]

# Try again
npm run server
```

### Can't login
- Verify you're using: admin@gissystem.com / admin123
- Check browser console for errors
- Verify server is running

### Database connection issues
- Check `.env` file has correct Supabase URL
- Verify Supabase project is active
- Test connection: Visit your Supabase dashboard

---

## Next Steps

1. **Test the system:**
   - Create a new customer
   - Customize HTML for a customer
   - Add users to a customer
   - View activity logs

2. **Configure for production:**
   - Set up wildcard DNS for *.mapz.in
   - Configure SSL certificates
   - Deploy to production server
   - See `DEPLOYMENT.md` for details

3. **Customize for your needs:**
   - Update branding in admin dashboard
   - Modify default customer colors
   - Add your own pages
   - Configure your Teable.io accounts

---

## Support

For detailed information:
- **Full Documentation:** See `README.md`
- **Deployment Guide:** See `DEPLOYMENT.md`
- **Getting Started:** See `GETTING_STARTED.md`
- **Deployment Status:** See `DEPLOYMENT_STATUS.md`

---

**Everything is ready to go! Start the server and login to begin. 🎉**
