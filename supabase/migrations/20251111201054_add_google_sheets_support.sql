/*
  # Add Google Sheets Support to Multi-Tenant GIS System

  ## Overview
  This migration adds Google Sheets as an alternative data source to the existing
  Teable-based system. Customers can now choose between Teable.io or Google Sheets
  for storing their parcel/land data, while all system data (users, permissions, logs)
  remains in Supabase.

  ## New Tables

  ### 1. customer_google_sheets_config
  Stores Google Sheets API configuration and OAuth tokens for each customer.

  **Columns:**
  - `id` (uuid, primary key) - Configuration identifier
  - `customer_id` (uuid, foreign key) - Reference to customers table
  - `spreadsheet_id` (text) - Google Sheets spreadsheet ID
  - `sheet_name` (text) - Name of the sheet within spreadsheet
  - `oauth_access_token` (text) - Encrypted OAuth access token
  - `oauth_refresh_token` (text) - Encrypted OAuth refresh token
  - `oauth_token_expires_at` (timestamptz) - When access token expires
  - `oauth_user_email` (text) - Google account email
  - `field_mappings` (jsonb) - Maps sheet columns to standard fields
    - geometry_column: Column containing WKT or geometry data
    - id_column: Column for unique record identifier
    - name_column: Column for record name/label
    - latitude_column: Column for latitude (if not using WKT)
    - longitude_column: Column for longitude (if not using WKT)
    - custom_mappings: Additional field mappings
  - `is_active` (boolean) - Whether this config is currently active
  - `created_at` (timestamptz) - Configuration creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 2. google_oauth_state
  Temporary storage for OAuth state tokens during the OAuth flow.

  **Columns:**
  - `id` (uuid, primary key) - State identifier
  - `state_token` (text, unique) - Random token for CSRF protection
  - `customer_id` (uuid, nullable) - Customer being configured (if known)
  - `admin_email` (text) - Admin initiating OAuth flow
  - `redirect_uri` (text) - Where to redirect after OAuth
  - `created_at` (timestamptz) - State creation timestamp
  - `expires_at` (timestamptz) - When state token expires (15 minutes)

  ## Modified Tables

  ### customers table
  - Add `data_source_type` column to indicate whether customer uses Teable or Google Sheets
  - Valid values: 'teable', 'google_sheets'
  - Default: 'teable' (for backward compatibility)

  ## Security

  ### Row Level Security (RLS)
  All new tables have RLS enabled with restrictive policies:

  1. **customer_google_sheets_config**: Only accessible by system admins
  2. **google_oauth_state**: Only accessible by system admins

  ## Indexes
  Performance indexes created for:
  - Google Sheets config customer lookups
  - OAuth state token lookups
  - Data source type filtering

  ## Important Notes
  1. OAuth tokens must be encrypted at the application layer before storage
  2. State tokens expire after 15 minutes for security
  3. Access tokens typically expire after 1 hour and must be refreshed
  4. Field mappings are flexible to support various spreadsheet structures
*/

-- =====================================================
-- 1. ADD DATA SOURCE TYPE TO CUSTOMERS TABLE
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'data_source_type'
  ) THEN
    ALTER TABLE customers
    ADD COLUMN data_source_type text DEFAULT 'teable' NOT NULL;

    ALTER TABLE customers
    ADD CONSTRAINT valid_data_source_type
    CHECK (data_source_type IN ('teable', 'google_sheets'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_data_source_type
  ON customers(data_source_type);

-- =====================================================
-- 2. CUSTOMER GOOGLE SHEETS CONFIG TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS customer_google_sheets_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  spreadsheet_id text NOT NULL,
  sheet_name text NOT NULL,
  oauth_access_token text NOT NULL,
  oauth_refresh_token text NOT NULL,
  oauth_token_expires_at timestamptz NOT NULL,
  oauth_user_email text NOT NULL,
  field_mappings jsonb DEFAULT '{
    "geometry_column": null,
    "id_column": null,
    "name_column": null,
    "latitude_column": null,
    "longitude_column": null,
    "custom_mappings": {}
  }'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_active_google_config
    UNIQUE (customer_id, is_active)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_google_sheets_config_customer
  ON customer_google_sheets_config(customer_id);

CREATE INDEX IF NOT EXISTS idx_google_sheets_config_active
  ON customer_google_sheets_config(customer_id, is_active)
  WHERE is_active = true;

-- =====================================================
-- 3. GOOGLE OAUTH STATE TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS google_oauth_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_token text UNIQUE NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  admin_email text NOT NULL,
  redirect_uri text NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_token
  ON google_oauth_state(state_token);

CREATE INDEX IF NOT EXISTS idx_oauth_state_expires
  ON google_oauth_state(expires_at);

-- =====================================================
-- 4. TRIGGERS FOR UPDATED_AT
-- =====================================================

CREATE TRIGGER update_google_sheets_config_updated_at
  BEFORE UPDATE ON customer_google_sheets_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 5. ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Enable RLS on new tables
ALTER TABLE customer_google_sheets_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_oauth_state ENABLE ROW LEVEL SECURITY;

-- Customer Google Sheets Config policies
CREATE POLICY "System admins can manage google sheets configs"
  ON customer_google_sheets_config FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = (SELECT current_setting('request.jwt.claims', true)::json->>'email')
      AND system_admins.is_active = true
    )
  );

-- Google OAuth State policies
CREATE POLICY "System admins can manage oauth state"
  ON google_oauth_state FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = (SELECT current_setting('request.jwt.claims', true)::json->>'email')
      AND system_admins.is_active = true
    )
  );

-- =====================================================
-- 6. CLEANUP FUNCTION FOR EXPIRED OAUTH STATES
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM google_oauth_state
  WHERE expires_at < now();
END;
$$;

-- Create a comment to remind admins to set up a cron job
COMMENT ON FUNCTION cleanup_expired_oauth_states() IS
  'Run this periodically (e.g., hourly) to clean up expired OAuth state tokens.
   Can be scheduled via pg_cron or external cron job.';
