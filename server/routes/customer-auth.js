import express from 'express';
import crypto from 'crypto';
import { supabase, logCustomerActivity } from '../config/supabase.js';

export const customerAuthRouter = express.Router();

console.log('✅ Customer auth router loaded');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'teable_salt_2024').digest('hex');
}

function generateSubdomain(orgName) {
  return orgName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

customerAuthRouter.post('/signup', async (req, res) => {
  try {
    const {
      organizationName,
      subdomain: requestedSubdomain,
      adminEmail,
      adminPassword,
      firstName,
      lastName
    } = req.body;

    if (!organizationName || !adminEmail || !adminPassword) {
      return res.status(400).json({ error: 'Organization name, email, and password are required' });
    }

    const subdomain = requestedSubdomain || generateSubdomain(organizationName);

    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('subdomain', subdomain)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        error: 'Subdomain already exists',
        suggestedSubdomain: `${subdomain}-${Math.floor(Math.random() * 1000)}`
      });
    }

    const { data: existingEmail } = await supabase
      .from('customer_users')
      .select('id')
      .eq('email', adminEmail.toLowerCase())
      .maybeSingle();

    if (existingEmail) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 30);

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .insert({
        name: organizationName,
        subdomain: subdomain.toLowerCase(),
        status: 'trial',
        subscription_tier: 'free',
        max_users: 5,
        max_map_views: 1000,
        trial_ends_at: trialEndsAt.toISOString(),
        data_source: null
      })
      .select()
      .single();

    if (customerError) {
      console.error('Error creating customer:', customerError);
      return res.status(500).json({ error: 'Failed to create customer account' });
    }

    const userFirstName = firstName || adminEmail.split('@')[0].charAt(0).toUpperCase() + adminEmail.split('@')[0].slice(1);
    const userLastName = lastName || 'Admin';
    const passwordHash = hashPassword(adminPassword);

    const { data: user, error: userError } = await supabase
      .from('customer_users')
      .insert({
        customer_id: customer.id,
        email: adminEmail.toLowerCase(),
        password_hash: passwordHash,
        first_name: userFirstName,
        last_name: userLastName,
        role: 'owner',
        is_active: true
      })
      .select()
      .single();

    if (userError) {
      console.error('Error creating user:', userError);
      await supabase.from('customers').delete().eq('id', customer.id);
      return res.status(500).json({ error: 'Failed to create user account' });
    }

    const { error: onboardingError } = await supabase
      .from('customer_onboarding_status')
      .insert({
        customer_id: customer.id,
        current_step: 'data_source',
        data_source_connected: false,
        location_fields_detected: false,
        is_complete: false,
        requires_assistance: false,
        steps_completed: JSON.stringify({ signup: new Date().toISOString() }),
        onboarding_started_at: new Date().toISOString()
      });

    if (onboardingError) {
      console.error('Error creating onboarding status:', onboardingError);
    }

    await logCustomerActivity(
      customer.id,
      adminEmail,
      'customer_signup',
      `Customer ${organizationName} signed up with subdomain ${subdomain}`
    );

    const session = {
      customerId: customer.id,
      userId: user.id,
      email: user.email,
      role: user.role,
      customerName: customer.name,
      subdomain: customer.subdomain,
      dataSource: customer.data_source,
      sessionToken: crypto.randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };

    res.json({
      success: true,
      message: 'Account created successfully',
      customer,
      user,
      session
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

customerAuthRouter.post('/login', async (req, res) => {
  try {
    console.log('=== Customer Login Request ===');
    console.log('Body:', req.body);
    console.log('Headers:', req.headers);

    const { email, password, subdomain } = req.body;

    if (!email || !password) {
      console.log('Missing email or password');
      return res.status(400).json({ error: 'Email and password are required' });
    }

    console.log('Querying database for user:', email);

    let query = supabase
      .from('customer_users')
      .select(`
        *,
        customers:customer_id (
          id,
          name,
          subdomain,
          status,
          subscription_tier,
          data_source,
          primary_color,
          secondary_color
        )
      `)
      .eq('email', email.toLowerCase())
      .eq('is_active', true);

    if (subdomain) {
      query = query.eq('customers.subdomain', subdomain.toLowerCase());
    }

    const { data: users, error } = await query;

    console.log('Query result - users:', users ? users.length : 0, 'error:', error);

    if (error) {
      console.error('Database query error:', error);
      return res.status(500).json({ error: 'Database error', details: error.message });
    }

    if (!users || users.length === 0) {
      console.log('No users found');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (users.length > 1 && !subdomain) {
      const customerList = users.map(u => ({
        customerId: u.customers.id,
        customerName: u.customers.name,
        subdomain: u.customers.subdomain
      }));
      return res.status(300).json({
        error: 'Multiple accounts found',
        message: 'Please select your organization',
        customers: customerList
      });
    }

    const user = users[0];
    const customer = user.customers;

    if (!customer) {
      return res.status(404).json({ error: 'Customer account not found' });
    }

    // Verify password
    const passwordHash = hashPassword(password);
    if (user.password_hash !== passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (customer.status === 'suspended' || customer.status === 'inactive') {
      return res.status(403).json({ error: 'Account is suspended or inactive. Please contact support.' });
    }

    await supabase
      .from('customer_users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    await logCustomerActivity(
      customer.id,
      user.email,
      'customer_login',
      `User ${user.email} logged in`
    );

    const session = {
      customerId: customer.id,
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role,
      customerName: customer.name,
      subdomain: customer.subdomain,
      dataSource: customer.data_source,
      primaryColor: customer.primary_color,
      secondaryColor: customer.secondary_color,
      sessionToken: crypto.randomBytes(32).toString('hex'),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };

    console.log('Login successful for user:', user.email);
    console.log('Sending response...');

    res.json({
      success: true,
      message: 'Login successful',
      session,
      customer
    });
  } catch (error) {
    console.error('=== Login Error ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    console.error('==================');

    if (!res.headersSent) {
      res.status(500).json({ error: 'Login failed', details: error.message });
    }
  }
});

customerAuthRouter.get('/check-subdomain/:subdomain', async (req, res) => {
  try {
    const { subdomain } = req.params;

    if (!subdomain || subdomain.length < 3) {
      return res.json({ available: false, error: 'Subdomain must be at least 3 characters' });
    }

    if (!/^[a-z0-9-]+$/.test(subdomain)) {
      return res.json({ available: false, error: 'Subdomain can only contain lowercase letters, numbers, and hyphens' });
    }

    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('subdomain', subdomain.toLowerCase())
      .maybeSingle();

    res.json({
      available: !existing,
      subdomain: subdomain.toLowerCase()
    });
  } catch (error) {
    console.error('Subdomain check error:', error);
    res.status(500).json({ error: 'Failed to check subdomain availability' });
  }
});

customerAuthRouter.post('/logout', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

customerAuthRouter.get('/session', async (req, res) => {
  try {
    const sessionData = req.headers.authorization?.replace('Bearer ', '');

    if (!sessionData) {
      return res.status(401).json({ error: 'No session found' });
    }

    res.json({
      success: true,
      valid: true
    });
  } catch (error) {
    console.error('Session check error:', error);
    res.status(500).json({ error: 'Failed to check session' });
  }
});
