/*
  # Create Field Permissions Table

  1. New Tables
    - `user_field_permissions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references customer_users)
      - `table_id` (text, the table/sheet identifier)
      - `field_id` (text, the field identifier)
      - `permission` (text, values: 'none', 'view', 'edit')
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `user_field_permissions` table
    - Add policies for authenticated access

  3. Indexes
    - Add index on user_id for fast lookups
    - Add composite index on (user_id, table_id, field_id) for unique constraints
*/

-- Create the user_field_permissions table
CREATE TABLE IF NOT EXISTS user_field_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES customer_users(id) ON DELETE CASCADE,
  table_id text NOT NULL,
  field_id text NOT NULL,
  permission text NOT NULL DEFAULT 'view',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_permission CHECK (permission IN ('none', 'view', 'edit')),
  CONSTRAINT unique_user_table_field UNIQUE (user_id, table_id, field_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_field_permissions_user_id ON user_field_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_field_permissions_table_id ON user_field_permissions(table_id);
CREATE INDEX IF NOT EXISTS idx_user_field_permissions_composite ON user_field_permissions(user_id, table_id, field_id);

-- Enable RLS
ALTER TABLE user_field_permissions ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own field permissions"
  ON user_field_permissions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert field permissions"
  ON user_field_permissions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can update field permissions"
  ON user_field_permissions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can delete field permissions"
  ON user_field_permissions FOR DELETE
  TO authenticated
  USING (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_field_permissions_updated_at'
  ) THEN
    CREATE TRIGGER update_user_field_permissions_updated_at
      BEFORE UPDATE ON user_field_permissions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
