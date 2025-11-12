import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'teable_salt_2024');
  return crypto.subtle.digest('SHA-256', data).then(buffer => {
    return Array.from(new Uint8Array(buffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  });
}

async function logActivity(supabase: any, customerId: string, userEmail: string, activityType: string, description: string, metadata: any = null) {
  await supabase.from('customer_activity_log').insert({
    customer_id: customerId,
    user_email: userEmail,
    activity_type: activityType,
    description: description,
    metadata: metadata
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
    const pathParts = url.pathname.split('/').filter(Boolean);
    const resource = pathParts[1];
    const id = pathParts[2];
    const action = pathParts[3];

    if (req.method === 'GET' && !id) {
      const { data: customers, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return new Response(
        JSON.stringify({ success: true, customers }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'GET' && id && !action) {
      const { data: customer, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return new Response(
        JSON.stringify({ success: true, customer }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'POST' && !id) {
      const body = await req.json();
      const {
        name, subdomain, customDomain, subscriptionTier = 'free',
        maxUsers = 5, maxMapViews = 1000, primaryColor = '#2563eb',
        secondaryColor = '#1e40af', adminEmail, adminPassword,
        dataSourceType = 'teable'
      } = body;

      if (!name || !subdomain) {
        return new Response(
          JSON.stringify({ error: 'Name and subdomain are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('subdomain', subdomain)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: 'Subdomain already exists' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 30);

      const { data: customer, error } = await supabase
        .from('customers')
        .insert({
          name, subdomain: subdomain.toLowerCase(),
          custom_domain: customDomain || null, status: 'trial',
          subscription_tier: subscriptionTier, max_users: maxUsers,
          max_map_views: maxMapViews, primary_color: primaryColor,
          secondary_color: secondaryColor,
          trial_ends_at: trialEndsAt.toISOString(),
          data_source_type: dataSourceType
        })
        .select()
        .single();

      if (error) throw error;

      let ownerUser = null;
      if (adminEmail && adminPassword) {
        const passwordHash = await hashPassword(adminPassword);
        const emailParts = adminEmail.split('@')[0];
        const firstName = emailParts.charAt(0).toUpperCase() + emailParts.slice(1);

        const { data: user, error: userError } = await supabase
          .from('customer_users')
          .insert({
            customer_id: customer.id, email: adminEmail.toLowerCase(),
            first_name: firstName, last_name: 'Admin',
            role: 'owner', is_active: true
          })
          .select()
          .single();

        if (userError) {
          await supabase.from('customers').delete().eq('id', customer.id);
          return new Response(
            JSON.stringify({ error: 'Failed to create customer user' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        ownerUser = user;
      }

      await logActivity(supabase, customer.id, adminEmail || 'system', 'customer_created', `Customer ${name} created with subdomain ${subdomain}`);

      return new Response(
        JSON.stringify({ success: true, customer, ownerUser }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'PUT' && id) {
      const updates = await req.json();
      const { data: customer, error } = await supabase
        .from('customers')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      await logActivity(supabase, id, updates.adminEmail || 'system', 'customer_updated', `Customer ${customer.name} updated`);

      return new Response(
        JSON.stringify({ success: true, customer }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (req.method === 'DELETE' && id) {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, message: 'Customer deleted successfully' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'teable-config' && req.method === 'POST') {
      const { baseUrl, spaceId, baseId, accessToken } = await req.json();

      if (!baseUrl || !spaceId || !baseId || !accessToken) {
        return new Response(
          JSON.stringify({ error: 'All Teable config fields are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabase.from('customer_teable_config').update({ is_active: false }).eq('customer_id', id);

      const { data: config, error } = await supabase
        .from('customer_teable_config')
        .insert({
          customer_id: id, base_url: baseUrl, space_id: spaceId,
          base_id: baseId, access_token: accessToken, is_active: true
        })
        .select()
        .single();

      if (error) throw error;
      await logActivity(supabase, id, 'system', 'teable_config_updated', 'Teable.io configuration updated');

      return new Response(
        JSON.stringify({ success: true, config }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'teable-config' && req.method === 'GET') {
      const { data: config, error } = await supabase
        .from('customer_teable_config')
        .select('*')
        .eq('customer_id', id)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      return new Response(
        JSON.stringify({ success: true, config }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'complete-setup' && req.method === 'POST') {
      const { adminEmail, adminPassword, dataSourceType } = await req.json();

      if (!adminEmail || !adminPassword) {
        return new Response(
          JSON.stringify({ error: 'Admin email and password are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: customer, error: customerError } = await supabase
        .from('customers').select('*').eq('id', id).single();

      if (customerError || !customer) {
        return new Response(
          JSON.stringify({ error: 'Customer not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: existingUser } = await supabase
        .from('customer_users')
        .select('id')
        .eq('customer_id', id)
        .eq('email', adminEmail.toLowerCase())
        .maybeSingle();

      if (existingUser) {
        return new Response(
          JSON.stringify({ error: 'User already exists for this customer' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const passwordHash = await hashPassword(adminPassword);
      const emailParts = adminEmail.split('@')[0];
      const firstName = emailParts.charAt(0).toUpperCase() + emailParts.slice(1);

      const { data: user, error: userError } = await supabase
        .from('customer_users')
        .insert({
          customer_id: id, email: adminEmail.toLowerCase(),
          first_name: firstName, last_name: 'Admin',
          role: 'owner', is_active: true
        })
        .select()
        .single();

      if (userError) {
        return new Response(
          JSON.stringify({ error: 'Failed to create customer user' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (dataSourceType) {
        await supabase.from('customers').update({ data_source_type: dataSourceType }).eq('id', id);
      }

      await logActivity(supabase, id, adminEmail, 'customer_setup_completed', `Customer setup completed for ${customer.name}`);

      return new Response(
        JSON.stringify({ success: true, customer, user }),
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