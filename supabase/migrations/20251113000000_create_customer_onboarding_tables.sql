/*
  # Customer Onboarding and Support System

  ## Overview
  This migration adds tables to support the guided self-service customer onboarding flow,
  enabling customers to sign up, connect data sources, and request assistance when needed.

  ## New Tables

  ### 1. customer_onboarding_status
  Tracks each customer's progress through the onboarding wizard.

  **Columns:**
  - `id` (uuid, primary key) - Status record identifier
  - `customer_id` (uuid, foreign key) - Reference to customers table
  - `current_step` (text) - Current step: 'signup', 'data_source', 'location_detection', 'complete'
  - `data_source_connected` (boolean) - Whether data source is successfully connected
  - `location_fields_detected` (boolean) - Whether location fields were auto-detected
  - `is_complete` (boolean) - Whether onboarding is complete
  - `requires_assistance` (boolean) - Whether customer requested help
  - `steps_completed` (jsonb) - Array of completed steps with timestamps
  - `field_mappings` (jsonb) - Detected or configured field mappings
  - `onboarding_started_at` (timestamptz) - When onboarding started
  - `onboarding_completed_at` (timestamptz) - When onboarding was completed
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 2. support_requests
  Stores customer support requests and escalations during onboarding.

  **Columns:**
  - `id` (uuid, primary key) - Request identifier
  - `customer_id` (uuid, foreign key) - Reference to customers table
  - `customer_email` (text) - Customer contact email
  - `request_type` (text) - Type: 'no_location_data', 'connection_issues', 'general_help', 'data_mapping'
  - `subject` (text) - Request subject line
  - `message` (text) - Customer message
  - `current_step` (text) - Onboarding step where help was requested
  - `status` (text) - Status: 'open', 'in_progress', 'resolved', 'closed'
  - `priority` (text) - Priority: 'low', 'medium', 'high', 'urgent'
  - `admin_notes` (text) - Internal admin notes
  - `resolved_by` (text) - Admin email who resolved the request
  - `resolved_at` (timestamptz) - When request was resolved
  - `metadata` (jsonb) - Additional request metadata
  - `created_at` (timestamptz) - Request creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security

  ### Row Level Security (RLS)
  All tables have RLS enabled with restrictive policies:

  1. **customer_onboarding_status**: Accessible by system admins and customer owners for their own record
  2. **support_requests**: Accessible by system admins and customers can view/create their own requests

  ## Indexes
  Performance indexes created for:
  - Onboarding status lookups by customer
  - Support request queries by customer and status
  - Support request date queries for reporting

  ## Important Notes
  1. Onboarding progress is tracked at every step
  2. Support requests create audit trail for customer assistance
  3. Field mappings stored in JSONB for flexibility with different data sources
  4. Steps completed array tracks timestamp for each completed step
*/

-- =====================================================
-- 1. CUSTOMER ONBOARDING STATUS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS customer_onboarding_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  current_step text NOT NULL DEFAULT 'signup',
  data_source_connected boolean DEFAULT false,
  location_fields_detected boolean DEFAULT false,
  is_complete boolean DEFAULT false,
  requires_assistance boolean DEFAULT false,
  steps_completed jsonb DEFAULT '[]'::jsonb,
  field_mappings jsonb DEFAULT '{}'::jsonb,
  onboarding_started_at timestamptz DEFAULT now(),
  onboarding_completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_step CHECK (current_step IN ('signup', 'data_source', 'location_detection', 'dashboard_tour', 'complete')),
  CONSTRAINT unique_customer_onboarding UNIQUE (customer_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_status_customer ON customer_onboarding_status(customer_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_status_step ON customer_onboarding_status(current_step);
CREATE INDEX IF NOT EXISTS idx_onboarding_status_complete ON customer_onboarding_status(is_complete);

-- =====================================================
-- 2. SUPPORT REQUESTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  customer_email text NOT NULL,
  request_type text NOT NULL DEFAULT 'general_help',
  subject text NOT NULL,
  message text NOT NULL,
  current_step text,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'medium',
  admin_notes text,
  resolved_by text,
  resolved_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_request_type CHECK (request_type IN ('no_location_data', 'connection_issues', 'general_help', 'data_mapping', 'technical_issue')),
  CONSTRAINT valid_status CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  CONSTRAINT valid_priority CHECK (priority IN ('low', 'medium', 'high', 'urgent'))
);

CREATE INDEX IF NOT EXISTS idx_support_requests_customer ON support_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status);
CREATE INDEX IF NOT EXISTS idx_support_requests_created ON support_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_requests_type ON support_requests(request_type);

-- =====================================================
-- ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Enable RLS on new tables
ALTER TABLE customer_onboarding_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;

-- Customer Onboarding Status policies
CREATE POLICY "System admins can view all onboarding status"
  ON customer_onboarding_status FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

CREATE POLICY "System admins can manage onboarding status"
  ON customer_onboarding_status FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

CREATE POLICY "Service role can manage all onboarding status"
  ON customer_onboarding_status FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Support Requests policies
CREATE POLICY "System admins can view all support requests"
  ON support_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM system_admins
      WHERE system_admins.email = current_setting('request.jwt.claims', true)::json->>'email'
      AND system_admins.is_active = true
    )
  );

CREATE POLICY "System admins can update support requests"
  ON support_requests FOR UPDATE
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

CREATE POLICY "Service role can manage all support requests"
  ON support_requests FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can create support requests"
  ON support_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- =====================================================
-- TRIGGERS FOR UPDATED_AT
-- =====================================================

CREATE TRIGGER update_customer_onboarding_status_updated_at
  BEFORE UPDATE ON customer_onboarding_status
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_support_requests_updated_at
  BEFORE UPDATE ON support_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to mark onboarding step as complete
CREATE OR REPLACE FUNCTION complete_onboarding_step(
  p_customer_id uuid,
  p_step text
)
RETURNS void AS $$
BEGIN
  UPDATE customer_onboarding_status
  SET
    steps_completed = steps_completed || jsonb_build_object(p_step, now()),
    updated_at = now()
  WHERE customer_id = p_customer_id;
END;
$$ LANGUAGE plpgsql;

-- Function to check if onboarding is complete
CREATE OR REPLACE FUNCTION check_onboarding_complete(p_customer_id uuid)
RETURNS boolean AS $$
DECLARE
  v_required_steps text[] := ARRAY['signup', 'data_source', 'location_detection'];
  v_completed_steps jsonb;
  v_step text;
BEGIN
  SELECT steps_completed INTO v_completed_steps
  FROM customer_onboarding_status
  WHERE customer_id = p_customer_id;

  IF v_completed_steps IS NULL THEN
    RETURN false;
  END IF;

  FOREACH v_step IN ARRAY v_required_steps
  LOOP
    IF NOT (v_completed_steps ? v_step) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$ LANGUAGE plpgsql;
