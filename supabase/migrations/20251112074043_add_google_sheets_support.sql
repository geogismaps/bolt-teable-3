/*
  # Add Google Sheets Support

  ## Overview
  Adds support for Google Sheets as a data source alongside Teable, enabling customers
  to use either platform for their GIS data storage.

  ## Changes Made

  1. **New Tables**
     - `google_oauth_tokens` - Stores encrypted OAuth tokens for Google Sheets access
       - `id` (uuid, primary key)
       - `customer_id` (uuid, references customers)
       - `encrypted_access_token` (text, encrypted)
       - `encrypted_refresh_token` (text, encrypted)
       - `token_expiry` (timestamptz)
       - `created_at` (timestamptz)
       - `updated_at` (timestamptz)

  2. **Modified Tables**
     - `customers` table:
       - Added `data_source` column (text, values: 'teable' or 'google_sheets')
       - Added `google_sheet_id` column (text, for Google Sheets customers)
       - Added `google_sheet_name` column (text, for Google Sheets customers)

  3. **Security**
     - RLS enabled on `google_oauth_tokens`
     - Policies restrict access to authenticated users who own the customer account
     - All OAuth tokens are encrypted using server-side encryption

  ## Notes
  - Default data_source is 'teable' for backward compatibility
  - Google Sheets fields are nullable to support both data sources
  - Encryption key must be set in environment variables
  - Token refresh is handled automatically by the server
*/

-- Add Google Sheets support to customers table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'data_source'
  ) THEN
    ALTER TABLE customers ADD COLUMN data_source text DEFAULT 'teable' CHECK (data_source IN ('teable', 'google_sheets'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'google_sheet_id'
  ) THEN
    ALTER TABLE customers ADD COLUMN google_sheet_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'google_sheet_name'
  ) THEN
    ALTER TABLE customers ADD COLUMN google_sheet_name text;
  END IF;
END $$;

-- Create google_oauth_tokens table for storing encrypted OAuth tokens
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  token_expiry timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(customer_id)
);

-- Enable RLS on google_oauth_tokens
ALTER TABLE google_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Create policies for google_oauth_tokens
CREATE POLICY "Users can view own OAuth tokens"
  ON google_oauth_tokens
  FOR SELECT
  TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id FROM customer_users WHERE email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Users can insert own OAuth tokens"
  ON google_oauth_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id IN (
      SELECT customer_id FROM customer_users WHERE email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Users can update own OAuth tokens"
  ON google_oauth_tokens
  FOR UPDATE
  TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id FROM customer_users WHERE email = auth.jwt() ->> 'email'
    )
  )
  WITH CHECK (
    customer_id IN (
      SELECT customer_id FROM customer_users WHERE email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Users can delete own OAuth tokens"
  ON google_oauth_tokens
  FOR DELETE
  TO authenticated
  USING (
    customer_id IN (
      SELECT customer_id FROM customer_users WHERE email = auth.jwt() ->> 'email'
    )
  );

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_google_oauth_tokens_customer_id ON google_oauth_tokens(customer_id);