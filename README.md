# Multi-Tenant GIS System

A comprehensive multi-tenant Geographic Information System built with Teable.io integration, enabling customer-specific branding, data isolation, and HTML customization.

## Features

- **Multi-Tenant Architecture**: Complete customer isolation with subdomain-based routing
- **Customer Branding**: Per-customer logos, colors, and visual customization
- **HTML Editor**: Admin interface to customize any HTML page for any customer
- **Teable.io Integration**: Each customer can connect to their own Teable.io instance
- **Version Control**: Track and rollback HTML changes with version history
- **Secure Authentication**: Admin and customer-level authentication with row-level security
- **Activity Logging**: Comprehensive audit trail of all system activities
- **Usage Metrics**: Track customer usage for billing and analytics

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Frontend**: Vanilla JavaScript + Vite
- **Code Editor**: CodeMirror
- **Authentication**: Custom JWT-based auth with Supabase RLS

## Prerequisites

- Node.js 18+ and npm
- Supabase account with database created
- Git for version control

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd teable-gis-system
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:

Create a `.env` file in the root directory:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
PORT=3000
NODE_ENV=development
```

4. Run database migrations:

The database schema will be automatically created using Supabase migrations. Check `docs/database-schema.md` for details.

## Development

### Start the development server:

```bash
npm run server:dev
```

The server will run on `http://localhost:3000`

### Start the frontend dev server (optional):

```bash
npm run dev
```

## Production Build

```bash
npm run build
```

## Deployment

### Bolt.new Deployment (Phase 1 - Testing with 10 customers)

1. Push code to GitHub:
```bash
git add .
git commit -m "Initial multi-tenant system"
git push origin main
```

2. Configure custom domain on Bolt.new with wildcard subdomain support

3. Update DNS records:
```
A     @              75.2.60.5
A     *              75.2.60.5
CNAME www            site-dns.bolt.host
```

### Linode Deployment (Phase 2 - Production)

See `docs/linode-deployment.md` for complete deployment guide.

## Project Structure

```
├── server/
│   ├── index.js                 # Express server entry point
│   ├── config/
│   │   └── supabase.js          # Supabase client configuration
│   ├── middleware/
│   │   ├── tenant.js            # Multi-tenant routing middleware
│   │   └── customer-html.js     # Customer HTML injection
│   └── routes/
│       ├── auth.js              # Authentication endpoints
│       ├── customers.js         # Customer management API
│       └── html-editor.js       # HTML customization API
├── public/
│   ├── admin-dashboard.html     # Admin dashboard
│   ├── admin-login.html         # Admin login page
│   ├── admin-register.html      # Admin registration
│   ├── html-editor.html         # HTML editor interface
│   ├── js/
│   │   ├── admin-dashboard.js   # Dashboard functionality
│   │   ├── html-editor.js       # Editor functionality
│   │   └── ...                  # Other JS modules
│   └── css/
│       └── styles.css           # Global styles
└── docs/
    ├── database-schema.md       # Database documentation
    ├── api-documentation.md     # API endpoints
    └── deployment-guide.md      # Deployment instructions
```

## Database Schema

### Core Tables

- `customers` - Customer/tenant information
- `customer_teable_config` - Teable.io API configuration per customer
- `customer_html_customizations` - Custom HTML for each customer
- `customer_html_versions` - Version history for rollbacks
- `customer_users` - User accounts per customer
- `customer_activity_logs` - Audit trail
- `system_admins` - Super admin accounts
- `customer_usage_metrics` - Usage tracking for billing

See `docs/database-schema.md` for complete schema documentation.

## API Documentation

### Authentication

- `POST /api/auth/admin/login` - Admin login
- `POST /api/auth/admin/register` - Create admin account
- `POST /api/auth/customer/login` - Customer user login

### Customer Management

- `GET /api/customers` - List all customers
- `GET /api/customers/:id` - Get customer details
- `POST /api/customers` - Create new customer
- `PUT /api/customers/:id` - Update customer
- `DELETE /api/customers/:id` - Delete customer
- `POST /api/customers/:id/teable-config` - Configure Teable.io
- `GET /api/customers/:id/teable-config` - Get Teable.io config

### HTML Editor

- `GET /api/html-editor/customers/:customerId/pages` - List customized pages
- `GET /api/html-editor/customers/:customerId/pages/:pageName` - Get page content
- `POST /api/html-editor/customers/:customerId/pages` - Save page customization
- `GET /api/html-editor/customers/:customerId/pages/:pageName/versions` - Get version history
- `POST /api/html-editor/customers/:customerId/pages/:pageName/rollback/:version` - Rollback to version
- `DELETE /api/html-editor/customers/:customerId/pages/:pageName` - Delete customization

## Usage

### Creating a Customer

1. Login to admin dashboard at `/admin-login.html`
2. Click "New Customer"
3. Enter customer name and subdomain
4. Configure Teable.io credentials (optional)
5. Customer site will be available at `http://[subdomain].mapz.in`

### Customizing Customer HTML

1. From admin dashboard, click "HTML" button for a customer
2. Select the page to customize (dashboard, map, login, etc.)
3. Edit HTML, CSS, and JavaScript in the code editor
4. Preview changes in real-time
5. Save to deploy immediately
6. Use version history to rollback if needed

### Customer Onboarding

1. Create customer account in admin dashboard
2. Configure Teable.io API credentials
3. Customize branding (logo, colors)
4. Customize HTML pages as needed
5. Create customer users
6. Share subdomain URL with customer

## Security

- Row Level Security (RLS) enabled on all tables
- Customer data completely isolated
- API tokens encrypted at rest
- Admin authentication required for all management operations
- Activity logging for audit compliance

## Monitoring

- Customer usage metrics tracked automatically
- Activity logs capture all system events
- Admin dashboard shows real-time statistics

## Contributing

This is a private project. Contact the repository owner for contribution guidelines.

## License

Proprietary - All Rights Reserved

## Support

For support, contact: support@mapz.in

## Roadmap

### Phase 1: Bolt Testing (Current)
- ✅ Multi-tenant database schema
- ✅ Backend routing engine
- ✅ Admin HTML editor
- ✅ Customer management
- 🔄 Test with 10 pilot customers
- 🔄 Gather feedback and iterate

### Phase 2: Production Migration
- ⏳ Linode server setup
- ⏳ GitHub Actions deployment pipeline
- ⏳ DNS and SSL configuration
- ⏳ Migration from Bolt to Linode
- ⏳ Production monitoring and optimization

### Phase 3: Enhancement
- ⏳ Customer self-service portal
- ⏳ Billing integration
- ⏳ Advanced analytics
- ⏳ Mobile responsive improvements
- ⏳ API rate limiting
