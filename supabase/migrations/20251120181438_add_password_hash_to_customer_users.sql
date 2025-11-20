/*
  # Add password_hash column to customer_users table

  ## Overview
  This migration adds a password_hash column to the customer_users table
  to support password-based authentication for customer users.

  ## Changes
  1. Add password_hash column (text, nullable initially for existing records)
  2. All new user records must include a password hash

  ## Security
  - Password hashes are created using SHA-256 with salt
  - Never store plain text passwords
*/

-- Add password_hash column to customer_users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customer_users' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE customer_users ADD COLUMN password_hash text;
  END IF;
END $$;

-- Add index for email lookups with password verification
CREATE INDEX IF NOT EXISTS idx_customer_users_email_active ON customer_users(email, is_active) WHERE is_active = true;
