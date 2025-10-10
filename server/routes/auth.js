import express from 'express';
import crypto from 'crypto';
import { supabase } from '../config/supabase.js';

export const authRouter = express.Router();

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'teable_salt_2024').digest('hex');
}

authRouter.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data: admin, error } = await supabase
      .from('system_admins')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .maybeSingle();

    if (error || !admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordHash = hashPassword(password);

    if (admin.password_hash !== passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
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

    res.json({ success: true, session });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

authRouter.post('/admin/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, isSuperAdmin = false } = req.body;

    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const { data: existing } = await supabase
      .from('system_admins')
      .select('id')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Admin already exists' });
    }

    const passwordHash = hashPassword(password);

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
      return res.status(500).json({ error: 'Failed to create admin' });
    }

    res.json({ success: true, admin: { id: admin.id, email: admin.email } });
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

authRouter.post('/customer/login', async (req, res) => {
  try {
    const { email, password, customerId } = req.body;

    if (!email || !password || !customerId) {
      return res.status(400).json({ error: 'Email, password, and customer ID are required' });
    }

    const { data: user, error } = await supabase
      .from('customer_users')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
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

    res.json({ success: true, session });
  } catch (error) {
    console.error('Customer user login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});
