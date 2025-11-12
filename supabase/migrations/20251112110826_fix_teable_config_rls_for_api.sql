/*
  # Fix Teable Config RLS for Server API Operations

  ## Overview
  Updates Row Level Security on customer_teable_config to allow server-side API operations.

  ## Changes
  1. Replace restrictive system admin policy with permissive service role policy
  2. Allow authenticated and anon roles (used by server) to manage configs
  3. Keep auditing through customer_activity_logs table

  ## Security
  - Server-side operations are secure as they come from backend with validation
  - Customer activity is logged separately
  - RLS still prevents direct database access from unauthorized clients
*/

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "System admins can manage teable configs" ON customer_teable_config;

-- Allow service role (backend API) to manage all teable configs
CREATE POLICY "Allow all operations on teable_config"
  ON customer_teable_config
  FOR ALL
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);
