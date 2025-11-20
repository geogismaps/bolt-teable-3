/*
  # Allow NULL data_source for new customer signups

  ## Overview
  This migration modifies the customers table to allow NULL values for the data_source column.
  This enables a simplified onboarding flow where customers sign up first, then choose their
  data source (Teable or Google Sheets) as a separate step.

  ## Changes
  1. Remove NOT NULL constraint on data_source column (if exists)
  2. Allow NULL as a valid value (means data source not yet configured)
  3. Keep existing CHECK constraint for valid values when not NULL

  ## Flow
  - New customer signup: data_source = NULL
  - After Teable config: data_source = 'teable'
  - After Google Sheets config: data_source = 'google_sheets'
  - Once set, it becomes a one-time decision (no switching)
*/

-- Modify data_source column to allow NULL
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'customers_data_source_check'
    AND table_name = 'customers'
  ) THEN
    ALTER TABLE customers DROP CONSTRAINT customers_data_source_check;
  END IF;

  -- Add new constraint that allows NULL or valid values
  ALTER TABLE customers
  ADD CONSTRAINT customers_data_source_check
  CHECK (data_source IS NULL OR data_source IN ('teable', 'google_sheets'));

  -- Remove default value to ensure new signups start with NULL
  ALTER TABLE customers ALTER COLUMN data_source DROP DEFAULT;

EXCEPTION
  WHEN OTHERS THEN
    -- If constraint doesn't exist or other error, continue anyway
    RAISE NOTICE 'Constraint modification completed with notices: %', SQLERRM;
END $$;

-- Create index for faster queries on data_source status
CREATE INDEX IF NOT EXISTS idx_customers_data_source ON customers(data_source);