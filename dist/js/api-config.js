/**
 * API Configuration for Edge Functions
 */

const SUPABASE_URL = 'https://prnfolxusxppqwukwasx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBybmZvbHh1c3hwcHF3dWt3YXN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAxMjM5OTUsImV4cCI6MjA3NTY5OTk5NX0.UZnV78aeMorSE5RNfJ3cG_kZ1hQadQkj_RMxqypKyqY';

const API_ENDPOINTS = {
  auth: `${SUPABASE_URL}/functions/v1/auth`,
  googleOAuth: `${SUPABASE_URL}/functions/v1/google-oauth`,
  googleSheets: `${SUPABASE_URL}/functions/v1/google-sheets`,
  customers: `${SUPABASE_URL}/functions/v1/customers`,
  data: `/api/data`,
  htmlEditor: `/api/html-editor`
};

function getHeaders() {
  return {
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY
  };
}

window.apiConfig = {
  endpoints: API_ENDPOINTS,
  getHeaders: getHeaders
};
