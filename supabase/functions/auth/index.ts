import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function hashPassword(password: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'teable_salt_2024');
  return crypto.subtle.digest('SHA-256', data).then(buffer => {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const url = new URL(req.url);
    const path = url.pathname.replace('/auth/', '');

    if (path === 'admin/login' && req.method === 'POST') {
      const { email, password } = await req.json();

      if (!email || !password) {
        return new Response(
          JSON.stringify({ error: 'Email and password are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: admin, error } = await supabase
        .from('system_admins')
        .select('*')
        .eq('email', email.toLowerCase())
        .eq('is_active', true)
        .maybeSingle();

      if (error || !admin) {
        return new Response(
          JSON.stringify({ error: 'Invalid credentials' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const passwordHash = await hashPassword(password);

      if (admin.password_hash !== passwordHash) {
        return new Response(
          JSON.stringify({ error: 'Invalid credentials' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabase
        .from('system_admins')
        .update({ last_login: new Date().toISOString() })
        .eq('id', admin.id);

      const session = {
        id: admin.id,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name,
        isSuperAdmin: admin.is_super_admin,
        loginTime: new Date().toISOString()
      };

      return new Response(
        JSON.stringify({ success: true, session }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (path === 'admin/register' && req.method === 'POST') {
      const { email, password, firstName, lastName, isSuperAdmin = false } = await req.json();

      if (!email || !password || !firstName || !lastName) {
        return new Response(
          JSON.stringify({ error: 'All fields are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: existing } = await supabase
        .from('system_admins')
        .select('id')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: 'Admin already exists' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const passwordHash = await hashPassword(password);

      const { data: admin, error } = await supabase
        .from('system_admins')
        .insert({
          email: email.toLowerCase(),
          password_hash: passwordHash,
          first_name: firstName,
          last_name: lastName,
          is_super_admin: isSuperAdmin,
          is_active: true
        })
        .select()
        .single();

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to create admin' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, admin: { id: admin.id, email: admin.email } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (path === 'customer/login' && req.method === 'POST') {
      const { email, password, customerId } = await req.json();

      if (!email || !password || !customerId) {
        return new Response(
          JSON.stringify({ error: 'Email, password, and customer ID are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: user, error } = await supabase
        .from('customer_users')
        .select('*')
        .eq('email', email.toLowerCase())
        .eq('customer_id', customerId)
        .eq('is_active', true)
        .maybeSingle();

      if (error || !user) {
        return new Response(
          JSON.stringify({ error: 'Invalid credentials' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabase
        .from('customer_users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', user.id);

      const session = {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role,
        customerId: user.customer_id,
        loginTime: new Date().toISOString()
      };

      return new Response(
        JSON.stringify({ success: true, session }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});