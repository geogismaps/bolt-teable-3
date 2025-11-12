/*
  # Cleanup Duplicate RLS Policies

  ## Overview
  Removes old restrictive policies that conflict with new permissive policies.

  ## Changes
  1. Remove duplicate system admin policies that are superseded by permissive policies
  2. Keep only the "Allow all operations" policies for each table
*/

-- Cleanup customer_activity_logs
DROP POLICY IF EXISTS "System admins can view activity logs" ON customer_activity_logs;

-- Cleanup customer_users  
DROP POLICY IF EXISTS "System admins can manage customer users" ON customer_users;

-- Cleanup customers
DROP POLICY IF EXISTS "System admins can delete customers" ON customers;
DROP POLICY IF EXISTS "System admins can insert customers" ON customers;
DROP POLICY IF EXISTS "System admins can update customers" ON customers;
DROP POLICY IF EXISTS "System admins can view all customers" ON customers;
