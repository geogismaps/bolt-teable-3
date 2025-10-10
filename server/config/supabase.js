import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getCustomerBySubdomain(subdomain) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('subdomain', subdomain)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getCustomerByDomain(domain) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('custom_domain', domain)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getCustomerTeableConfig(customerId) {
  const { data, error } = await supabase
    .from('customer_teable_config')
    .select('*')
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getCustomerHTMLCustomization(customerId, pageName) {
  const { data, error } = await supabase
    .from('customer_html_customizations')
    .select('*')
    .eq('customer_id', customerId)
    .eq('page_name', pageName)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function logCustomerActivity(customerId, userEmail, actionType, actionDescription, metadata = {}) {
  const { error } = await supabase
    .from('customer_activity_logs')
    .insert({
      customer_id: customerId,
      user_email: userEmail,
      action_type: actionType,
      action_description: actionDescription,
      metadata
    });

  if (error) console.error('Failed to log activity:', error);
}
