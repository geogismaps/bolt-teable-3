/*
  # Customer Onboarding and Support System

  ## Overview
  This migration adds tables to support the guided self-service customer onboarding flow,
  enabling customers to sign up, connect data sources, and request assistance when needed.

  ## New Tables

  ### 1. customer_onboarding_status
  Tracks each customer's progress through the onboarding wizard.

  ### 2. support_requests
  Stores customer support requests and escalations during onboarding.

  ## Security
  All tables have RLS enabled with restrictive policies.
*/

-- 1. CUSTOMER ONBOARDING STATUS TABLE
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

-- 2. SUPPORT REQUESTS TABLE
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

-- ROW LEVEL SECURITY
ALTER TABLE customer_onboarding_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage all onboarding status"
  ON customer_onboarding_status FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage all support requests"
  ON support_requests FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can create support requests"
  ON support_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);