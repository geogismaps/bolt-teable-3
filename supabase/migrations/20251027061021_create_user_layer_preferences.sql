/*
  # Create User Layer Preferences Table

  1. New Tables
    - `user_layer_preferences`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references customer_users.id)
      - `user_email` (text, email of the user)
      - `customer_id` (uuid, references customers.id)
      - `layer_id` (text, the Teable table ID)
      - `layer_name` (text, name of the layer)
      - `configuration` (jsonb, stores all layer settings)
        - symbology (colors, styles, categorization)
        - labels (enabled, field, style)
        - filters (active filters)
        - popup (enabled, fields, template)
        - visibility (true/false)
        - opacity (0-1)
      - `is_active` (boolean, default true)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `user_layer_preferences` table
    - Add policy for users to read their own preferences
    - Add policy for users to insert their own preferences
    - Add policy for users to update their own preferences
    - Add policy for users to delete their own preferences

  3. Indexes
    - Index on (user_id, layer_id) for fast lookups
    - Index on (customer_id, user_email, layer_id) for customer-scoped queries
*/

-- Create user_layer_preferences table
CREATE TABLE IF NOT EXISTS user_layer_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_email text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  layer_id text NOT NULL,
  layer_name text NOT NULL,
  configuration jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_layer_prefs_user_layer 
  ON user_layer_preferences(user_email, layer_id);

CREATE INDEX IF NOT EXISTS idx_user_layer_prefs_customer 
  ON user_layer_preferences(customer_id, user_email);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_user_layer_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_layer_preferences_updated_at
  BEFORE UPDATE ON user_layer_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_layer_preferences_updated_at();

-- Enable Row Level Security
ALTER TABLE user_layer_preferences ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own layer preferences
CREATE POLICY "Users can view own layer preferences"
  ON user_layer_preferences
  FOR SELECT
  USING (user_email = current_setting('app.current_user_email', true));

-- Policy: Users can insert their own layer preferences
CREATE POLICY "Users can insert own layer preferences"
  ON user_layer_preferences
  FOR INSERT
  WITH CHECK (user_email = current_setting('app.current_user_email', true));

-- Policy: Users can update their own layer preferences
CREATE POLICY "Users can update own layer preferences"
  ON user_layer_preferences
  FOR UPDATE
  USING (user_email = current_setting('app.current_user_email', true))
  WITH CHECK (user_email = current_setting('app.current_user_email', true));

-- Policy: Users can delete their own layer preferences
CREATE POLICY "Users can delete own layer preferences"
  ON user_layer_preferences
  FOR DELETE
  USING (user_email = current_setting('app.current_user_email', true));