# Getting Started - Multi-Tenant GIS System

Welcome to the Multi-Tenant GIS System! This guide will help you get started quickly.

## Quick Start

### 1. Initial Setup

```bash
# Install dependencies
npm install

# Seed test data (creates admin account and sample customers)
npm run seed

# Start the server
npm run server
```

### 2. Access the Admin Dashboard

Open your browser and navigate to:
```
http://localhost:3000/admin-login.html
```

**Default Admin Credentials:**
- Email: `admin@gissystem.com`
- Password: `admin123`

### 3. Explore the System

After logging in, you'll see:
- **Dashboard**: Overview of all customers and system statistics
- **Customer Management**: Create, edit, and delete customers
- **HTML Editor**: Customize any HTML page for any customer
- **Activity Logs**: Audit trail of all system actions

## Test Customers Created by Seed Script

The seed script creates 5 test customers:

1. **Acme Corporation** (`acme.mapz.in`)
   - Status: Active
   - Tier: Pro
   - 10 users, 10,000 map views/month

2. **Global Logistics Inc** (`globallogistics.mapz.in`)
   - Status: Active
   - Tier: Enterprise
   - 50 users, 100,000 map views/month

3. **City Planning Department** (`cityplanning.mapz.in`)
   - Status: Trial
   - Tier: Starter
   - 5 users, 1,000 map views/month

4. **Environmental Research Group** (`envresearch.mapz.in`)
   - Status: Active
   - Tier: Pro
   - 15 users, 50,000 map views/month

5. **Real Estate Analytics** (`realestate.mapz.in`)
   - Status: Trial
   - Tier: Starter
   - 5 users, 5,000 map views/month

## Core Features Tour

### Creating a New Customer

1. Click "New Customer" button in dashboard
2. Enter customer name (e.g., "Tech Startup Inc")
3. Enter subdomain (e.g., "techstartup")
4. Customer is created with 30-day trial

### Customizing Customer HTML

1. Click "HTML" button next to any customer
2. Select a page from the sidebar (dashboard, map, login, etc.)
3. Edit HTML, CSS, or JavaScript in the code editor
4. See live preview on the right
5. Click "Save Changes" to deploy immediately
6. View version history to rollback if needed

### Configuring Teable.io

1. Click "Edit" button next to any customer
2. Navigate to "Teable Configuration" section
3. Enter:
   - Base URL: `https://app.teable.io`
   - Space ID: `your_space_id`
   - Base ID: `your_base_id`
   - Access Token: `your_access_token`
4. Save configuration

### Managing Customer Users

1. From customer details page
2. Add users with different roles:
   - Owner: Full access
   - Admin: Can manage users and settings
   - Editor: Can edit data
   - Viewer: Read-only access

## Directory Structure Explained

```
├── server/                    # Backend Express server
│   ├── index.js              # Server entry point
│   ├── config/
│   │   └── supabase.js       # Database connection
│   ├── middleware/
│   │   ├── tenant.js         # Subdomain routing logic
│   │   └── customer-html.js  # HTML injection for customers
│   └── routes/
│       ├── auth.js           # Authentication endpoints
│       ├── customers.js      # Customer CRUD operations
│       └── html-editor.js    # HTML customization API
│
├── public/                    # Frontend files
│   ├── admin-*.html          # Admin interface pages
│   ├── html-editor.html      # Code editor interface
│   ├── js/
│   │   ├── admin-dashboard.js
│   │   ├── html-editor.js
│   │   └── ...
│   └── css/
│       └── styles.css
│
├── scripts/
│   └── seed-data.js          # Database seeding script
│
└── .github/workflows/
    └── deploy.yml            # Automated deployment
```

## Development Workflow

### Making Changes

1. Edit files in `server/` or `public/`
2. Server auto-reloads with `npm run server:dev`
3. Test changes at `http://localhost:3000`

### Before Committing

```bash
# Build to check for errors
npm run build

# Test the server starts correctly
npm run server

# Stage and commit changes
git add .
git commit -m "Your commit message"
```

### Deploying Changes

When using GitHub Actions:
```bash
# Push to main branch
git push origin main

# GitHub Actions automatically:
# - Runs build
# - Deploys to server
# - Restarts application
```

## Common Tasks

### Adding a New API Endpoint

1. Create route function in appropriate file:
   ```javascript
   // server/routes/customers.js
   customerRouter.get('/statistics', async (req, res) => {
     // Your logic here
   });
   ```

2. Test endpoint:
   ```bash
   curl http://localhost:3000/api/customers/statistics
   ```

### Adding a New Admin Page

1. Create HTML file in `public/`:
   ```html
   <!-- public/reports.html -->
   <!DOCTYPE html>
   <html>
   <head>
     <title>Reports</title>
     <link rel="stylesheet" href="/css/styles.css">
   </head>
   <body>
     <div class="container">
       <h1>Reports</h1>
       <!-- Your content -->
     </div>
     <script src="/js/reports.js"></script>
   </body>
   </html>
   ```

2. Create JavaScript file:
   ```javascript
   // public/js/reports.js
   async function loadReports() {
     // Your logic
   }
   ```

3. Add navigation link in admin dashboard

### Adding Database Tables

1. Create migration in Supabase dashboard or use SQL:
   ```sql
   CREATE TABLE customer_reports (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     customer_id uuid REFERENCES customers(id),
     report_name text NOT NULL,
     created_at timestamptz DEFAULT now()
   );

   ALTER TABLE customer_reports ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "Admins can manage reports"
     ON customer_reports FOR ALL
     TO authenticated
     USING (
       EXISTS (
         SELECT 1 FROM system_admins
         WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
       )
     );
   ```

2. Update seed script to include test data

3. Create API endpoints to access new table

## Testing Checklist

Before deploying to production:

- [ ] Admin login works
- [ ] Customer creation works
- [ ] HTML editor loads and saves
- [ ] Code preview updates in real-time
- [ ] Version history shows previous edits
- [ ] Rollback functionality works
- [ ] Customer list filters correctly
- [ ] Teable.io config saves successfully
- [ ] Activity logs capture actions
- [ ] Usage metrics are tracked
- [ ] Build completes without errors (`npm run build`)
- [ ] Server starts without errors (`npm run server`)

## Environment Variables

Required in `.env` file:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# Server Configuration
PORT=3000
NODE_ENV=development
```

## Troubleshooting

### "Cannot connect to Supabase"

1. Check `.env` file has correct credentials
2. Verify Supabase project is active
3. Test connection:
   ```bash
   curl https://your-project.supabase.co/rest/v1/customers
   ```

### "Admin login fails"

1. Run seed script to create admin account:
   ```bash
   npm run seed
   ```

2. Check Supabase `system_admins` table has entries

### "Customer subdomain not working"

This requires:
1. Production deployment with wildcard DNS
2. Nginx or similar proxy for subdomain routing
3. Will work after deploying to Bolt or Linode

In development, test with:
- `http://localhost:3000` for main site
- Customer configs are injected into pages automatically

### "HTML editor not saving"

1. Check browser console for errors
2. Verify admin session is valid
3. Check Supabase permissions on `customer_html_customizations` table

## Next Steps

1. **Customize for Your Needs**
   - Update branding in admin dashboard
   - Modify customer default colors
   - Add your own pages

2. **Configure Production Environment**
   - See `DEPLOYMENT.md` for full deployment guide
   - Set up custom domain
   - Configure wildcard DNS for subdomains

3. **Onboard First Real Customer**
   - Create customer in dashboard
   - Configure their Teable.io connection
   - Customize their branding
   - Add their users
   - Test their subdomain

4. **Gather Feedback**
   - Monitor activity logs
   - Track usage metrics
   - Iterate based on real usage

## Resources

- **Full Documentation**: See `README.md`
- **Deployment Guide**: See `DEPLOYMENT.md`
- **API Documentation**: Coming soon
- **Database Schema**: Check Supabase dashboard

## Support

For questions or issues:
- Check existing documentation first
- Review Supabase logs for backend errors
- Check browser console for frontend errors
- Review `server/` code for business logic

## Quick Reference

### Useful Commands

```bash
# Development
npm run server:dev          # Start server with auto-reload
npm run dev                 # Start Vite dev server (optional)

# Production
npm run build               # Build for production
npm run server              # Start production server

# Database
npm run seed                # Seed database with test data

# Git
git status                  # Check changed files
git add .                   # Stage all changes
git commit -m "message"     # Commit changes
git push origin main        # Push to GitHub (triggers deployment)
```

### Important URLs (Development)

- Admin Login: `http://localhost:3000/admin-login.html`
- Admin Dashboard: `http://localhost:3000/admin-dashboard.html`
- HTML Editor: `http://localhost:3000/html-editor.html?customerId=<id>`
- Register Admin: `http://localhost:3000/admin-register.html`

### Default Credentials

**Super Admin:**
- Email: `admin@gissystem.com`
- Password: `admin123`

**Test Customer Users:**
- `owner@<subdomain>.com`
- `admin@<subdomain>.com`
- `editor@<subdomain>.com`

(No passwords set for customer users by default - implement customer authentication separately)

---

**Ready to build something amazing! 🚀**
