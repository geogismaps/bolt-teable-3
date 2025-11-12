/*
  # Create Google Sheets OAuth and Configuration Tables

  ## Overview
  Creates the necessary tables for Google Sheets integration with OAuth support.

  ## New Tables

  ### 1. customer_google_sheets_config
  Stores Google Sheets configuration and OAuth tokens for customers.

  ### 2. google_oauth_state
  Temporary storage for OAuth state tokens during authentication flow.

  ## Security
  - RLS enabled with permissive policies for server-side operations
  - OAuth tokens encrypted at application layer
  - State tokens expire after 15 minutes
*/

-- =====================================================
-- 1. CUSTOMER GOOGLE SHEETS CONFIG TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS customer_google_sheets_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  spreadsheet_id text NOT NULL DEFAULT '',
  sheet_name text NOT NULL DEFAULT '',
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
-- 2. GOOGLE OAUTH STATE TABLE
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
-- 3. TRIGGERS
-- =====================================================

CREATE TRIGGER update_google_sheets_config_updated_at
  BEFORE UPDATE ON customer_google_sheets_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE customer_google_sheets_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_oauth_state ENABLE ROW LEVEL SECURITY;

-- Allow all operations for service (server API calls)
CREATE POLICY "Allow all operations on google_sheets_config"
  ON customer_google_sheets_config
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on oauth_state"
  ON google_oauth_state
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 5. CLEANUP FUNCTION
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

COMMENT ON FUNCTION cleanup_expired_oauth_states() IS
  'Run periodically to clean up expired OAuth state tokens';
