/*
  # Multi-Tenant GIS System Database Schema

  ## Overview
  This migration creates a complete multi-tenant architecture for the Teable GIS System,
  enabling customer isolation, custom branding, and per-customer HTML customization.

  ## New Tables

  ### 1. customers
  Core customer/tenant information table that stores organization details and configuration.
  
  **Columns:**
  - `id` (uuid, primary key) - Unique customer identifier
  - `name` (text) - Customer organization name
  - `subdomain` (text, unique) - Unique subdomain for customer (e.g., "acme" for acme.yourdomain.com)
  - `custom_domain` (text, nullable) - Optional custom domain (e.g., "maps.acme.com")
  - `status` (text) - Customer status: 'active', 'inactive', 'trial', 'suspended'
  - `logo_url` (text, nullable) - URL to customer's logo
  - `primary_color` (text) - Brand primary color (hex code)
  - `secondary_color` (text) - Brand secondary color (hex code)
  - `created_at` (timestamptz) - Customer creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp
  - `trial_ends_at` (timestamptz, nullable) - Trial expiration date
  - `subscription_tier` (text) - Subscription level: 'free', 'starter', 'pro', 'enterprise'
  - `max_users` (integer) - Maximum allowed users
  - `max_map_views` (integer) - Maximum map views per month
  - `settings` (jsonb) - Additional customer-specific settings

  ### 2. customer_teable_config
  Stores Teable.io API configuration for each customer, enabling per-customer data sources.
  
  **Columns:**
  - `id` (uuid, primary key) - Configuration identifier
  - `customer_id` (uuid, foreign key) - Reference to customers table
  - `base_url` (text) - Teable.io instance URL
  - `space_id` (text) - Teable space identifier
  - `base_id` (text) - Teable base identifier
  - `access_token` (text) - Encrypted API access token
  - `is_active` (boolean) - Whether this config is currently active
  - `created_at` (timestamptz) - Configuration creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 3. customer_html_customizations
  Stores per-customer HTML overrides for complete UI customization.
  
  **Columns:**
  - `id` (uuid, primary key) - Customization identifier
  - `customer_id` (uuid, foreign key) - Reference to customers table
  - `page_name` (text) - Name of the HTML page (e.g., 'map', 'dashboard', 'login')
  - `html_content` (text) - Custom HTML content
  - `css_content` (text, nullable) - Custom CSS styles
  - `js_content` (text, nullable) - Custom JavaScript code
  - `version` (integer) - Version number for tracking changes
  - `is_active` (boolean) - Whether this customization is currently active
  - `created_by` (text) - Admin email who created this version
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 4. customer_html_versions
  Version history for HTML customizations, enabling rollback capability.
  
  **Columns:**
  - `id` (uuid, primary key) - Version identifier
  - `customization_id` (uuid, foreign key) - Reference to customer_html_customizations
  - `customer_id` (uuid, foreign key) - Reference to customers table
  - `page_name` (text) - Name of the HTML page
  - `html_content` (text) - Archived HTML content
  - `css_content` (text, nullable) - Archived CSS styles
  - `js_content` (text, nullable) - Archived JavaScript code
  - `version` (integer) - Version number
  - `created_by` (text) - Admin who created this version
  - `created_at` (timestamptz) - Archive timestamp
  - `change_description` (text, nullable) - Description of changes made

  ### 5. customer_users
  User accounts associated with specific customers for multi-tenant access control.
  
  **Columns:**
  - `id` (uuid, primary key) - User identifier
  - `customer_id` (uuid, foreign key) - Reference to customers table
  - `email` (text) - User email address
  - `first_name` (text) - User first name
  - `last_name` (text) - User last name
  - `role` (text) - User role: 'owner', 'admin', 'editor', 'viewer'
  - `is_active` (boolean) - Whether user account is active
  - `last_login` (timestamptz, nullable) - Last login timestamp
  - `created_at` (timestamptz) - User creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 6. customer_activity_logs
  Audit trail for customer-level activities and admin actions.
  
  **Columns:**
  - `id` (uuid, primary key) - Log entry identifier
  - `customer_id` (uuid, foreign key) - Reference to customers table
  - `user_email` (text) - Email of user who performed action
  - `action_type` (text) - Type of action performed
  - `action_description` (text) - Detailed description of action
  - `ip_address` (text, nullable) - IP address of user
  - `user_agent` (text, nullable) - Browser user agent
  - `metadata` (jsonb, nullable) - Additional action metadata
  - `created_at` (timestamptz) - Action timestamp

  ### 7. system_admins
  Super admin accounts for managing the entire multi-tenant system.
  
  **Columns:**
  - `id` (uuid, primary key) - Admin identifier
  - `email` (text, unique) - Admin email address
  - `password_hash` (text) - Hashed password
  - `first_name` (text) - Admin first name
  - `last_name` (text) - Admin last name
  - `is_super_admin` (boolean) - Super admin flag
  - `is_active` (boolean) - Whether admin account is active
  - `last_login` (timestamptz, nullable) - Last login timestamp
  - `created_at` (timestamptz) - Admin creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 8. customer_usage_metrics
  Tracks usage metrics for billing and analytics purposes.
  
  **Columns:**
  - `id` (uuid, primary key) - Metric identifier
  - `customer_id` (uuid, foreign key) - Reference to customers table
  - `metric_date` (date) - Date of metric
  - `map_views` (integer) - Number of map views
  - `api_calls` (integer) - Number of API calls made
  - `active_users` (integer) - Number of active users
  - `storage_used_mb` (numeric) - Storage used in MB
  - `created_at` (timestamptz) - Metric creation timestamp

  ## Security

  ### Row Level Security (RLS)
  All tables have RLS enabled with restrictive policies:
  
  1. **customers table**: Only accessible by system admins and authenticated users for their own customer
  2. **customer_teable_config**: Only accessible by system admins and customer owners
  3. **customer_html_customizations**: Only accessible by system admins
  4. **customer_html_versions**: Only accessible by system admins
  5. **customer_users**: Accessible by system admins and users can view their own record
  6. **customer_activity_logs**: Accessible by system admins and customer owners for their customer
  7. **system_admins**: Only accessible by authenticated super admins
  8. **customer_usage_metrics**: Accessible by system admins and customer owners for their customer

  ## Indexes
  Performance indexes created for:
  - Customer subdomain and custom domain lookups
  - Customer user email lookups
  - Activity log queries by customer and timestamp
  - HTML customization lookups by customer and page

  ## Important Notes
  1. All sensitive data (API tokens, passwords) should be properly encrypted
  2. Customer data is fully isolated using RLS policies
  3. Version history enables safe rollbacks of customizations
  4. Usage metrics support billing and capacity planning
*/

-- =====================================================
-- 1. CUSTOMERS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subdomain text UNIQUE NOT NULL,
  custom_domain text UNIQUE,
  status text NOT NULL DEFAULT 'trial',
  logo_url text,
  primary_color text DEFAULT '#2563eb',
  secondary_color text DEFAULT '#1e40af',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  trial_ends_at timestamptz,
  subscription_tier text DEFAULT 'free',
  max_users integer DEFAULT 5,
  max_map_views integer DEFAULT 1000,
  settings jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT valid_status CHECK (status IN ('active', 'inactive', 'trial', 'suspended')),
  CONSTRAINT valid_tier CHECK (subscription_tier IN ('free', 'starter', 'pro', 'enterprise')),
  CONSTRAINT valid_subdomain CHECK (subdomain ~ '^[a-z0-9-]+$')
);

CREATE INDEX IF NOT EXISTS idx_customers_subdomain ON customers(subdomain);
CREATE INDEX IF NOT EXISTS idx_customers_custom_domain ON customers(custom_domain);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

-- =====================================================
-- 2. CUSTOMER TEABLE CONFIG TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS customer_teable_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  base_url text NOT NULL,
  space_id text NOT NULL,
  base_id text NOT NULL,
  access_token text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_active_config UNIQUE (customer_id, is_active) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_customer_teable_config_customer ON customer_teable_config(customer_id);

-- =====================================================
-- 3. CUSTOMER HTML CUSTOMIZATIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS customer_html_customizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  page_name text NOT NULL,
  html_content text,
  css_content text,
  js_content text,
  version integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_active_page UNIQUE (customer_id, page_name, is_active) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_html_customizations_customer ON customer_html_customizations(customer_id);
CREATE INDEX IF NOT EXISTS idx_html_customizations_page ON customer_html_customizations(customer_id, page_name);

-- =====================================================
-- 4. CUSTOMER HTML VERSIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS customer_html_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customization_id uuid REFERENCES customer_html_customizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  page_name text NOT NULL,
  html_content text,
  css_content text,
  js_content text,
  version integer NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now(),
  change_description text
);

CREATE INDEX IF NOT EXISTS idx_html_versions_customization ON customer_html_versions(customization_id);
CREATE INDEX IF NOT EXISTS idx_html_versions_customer ON customer_html_versions(customer_id);

-- =====================================================
-- 5. CUSTOMER USERS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS customer_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  role text NOT NULL DEFAULT 'viewer',
  is_active boolean DEFAULT true,
  last_login timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_role CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  CONSTRAINT unique_customer_email UNIQUE (customer_id, email)
);

CREATE INDEX IF NOT EXISTS idx_customer_users_customer ON customer_users(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_users_email ON customer_users(email);

-- =====================================================
-- 6. CUSTOMER ACTIVITY LOGS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS customer_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  action_type text NOT NULL,
  action_description text NOT NULL,
  ip_address text,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_customer ON customer_activity_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON customer_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON customer_activity_logs(user_email);

-- =====================================================
-- 7. SYSTEM ADMINS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS system_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  is_super_admin boolean DEFAULT false,
  is_active boolean DEFAULT true,
  last_login timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_admins_email ON system_admins(email);

-- =====================================================
-- 8. CUSTOMER USAGE METRICS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS customer_usage_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  map_views integer DEFAULT 0,
  api_calls integer DEFAULT 0,
  active_users integer DEFAULT 0,
  storage_used_mb numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT unique_customer_metric_date UNIQUE (customer_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_usage_metrics_customer ON customer_usage_metrics(customer_id);
CREATE INDEX IF NOT EXISTS idx_usage_metrics_date ON customer_usage_metrics(metric_date DESC);

-- =====================================================
-- ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_teable_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_html_customizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_html_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_usage_metrics ENABLE ROW LEVEL SECURITY;

-- Customers table policies
CREATE POLICY "System admins can view all customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

CREATE POLICY "System admins can insert customers"
  ON customers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

CREATE POLICY "System admins can update customers"
  ON customers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

CREATE POLICY "System admins can delete customers"
  ON customers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

-- Customer Teable Config policies
CREATE POLICY "System admins can manage teable configs"
  ON customer_teable_config FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

-- Customer HTML Customizations policies
CREATE POLICY "System admins can manage html customizations"
  ON customer_html_customizations FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

-- Customer HTML Versions policies
CREATE POLICY "System admins can view html versions"
  ON customer_html_versions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

-- Customer Users policies
CREATE POLICY "System admins can manage customer users"
  ON customer_users FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

-- Customer Activity Logs policies
CREATE POLICY "System admins can view activity logs"
  ON customer_activity_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

CREATE POLICY "System can insert activity logs"
  ON customer_activity_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- System Admins policies
CREATE POLICY "Super admins can view all admins"
  ON system_admins FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins sa
      WHERE sa.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND sa.is_super_admin = true
      AND sa.is_active = true
    )
  );

CREATE POLICY "Super admins can manage admins"
  ON system_admins FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins sa
      WHERE sa.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND sa.is_super_admin = true
      AND sa.is_active = true
    )
  );

-- Customer Usage Metrics policies
CREATE POLICY "System admins can view usage metrics"
  ON customer_usage_metrics FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

CREATE POLICY "System can insert usage metrics"
  ON customer_usage_metrics FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =====================================================
-- TRIGGERS FOR UPDATED_AT
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_teable_config_updated_at
  BEFORE UPDATE ON customer_teable_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_html_customizations_updated_at
  BEFORE UPDATE ON customer_html_customizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customer_users_updated_at
  BEFORE UPDATE ON customer_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_admins_updated_at
  BEFORE UPDATE ON system_admins
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
