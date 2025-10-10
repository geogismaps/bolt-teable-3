import express from 'express';
import { supabase, logCustomerActivity } from '../config/supabase.js';

export const customerRouter = express.Router();

customerRouter.get('/', async (req, res) => {
  try {
    const { data: customers, error } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ success: true, customers });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

customerRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: customer, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;

    res.json({ success: true, customer });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

customerRouter.post('/', async (req, res) => {
  try {
    const {
      name,
      subdomain,
      customDomain,
      subscriptionTier = 'free',
      maxUsers = 5,
      maxMapViews = 1000,
      primaryColor = '#2563eb',
      secondaryColor = '#1e40af'
    } = req.body;

    if (!name || !subdomain) {
      return res.status(400).json({ error: 'Name and subdomain are required' });
    }

    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('subdomain', subdomain)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Subdomain already exists' });
    }

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 30);

    const { data: customer, error } = await supabase
      .from('customers')
      .insert({
        name,
        subdomain: subdomain.toLowerCase(),
        custom_domain: customDomain || null,
        status: 'trial',
        subscription_tier: subscriptionTier,
        max_users: maxUsers,
        max_map_views: maxMapViews,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        trial_ends_at: trialEndsAt.toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    await logCustomerActivity(
      customer.id,
      req.body.adminEmail || 'system',
      'customer_created',
      `Customer ${name} created with subdomain ${subdomain}`
    );

    res.json({ success: true, customer });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

customerRouter.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const { data: customer, error } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await logCustomerActivity(
      id,
      req.body.adminEmail || 'system',
      'customer_updated',
      `Customer ${customer.name} updated`
    );

    res.json({ success: true, customer });
  } catch (error) {
    console.error('Error updating customer:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

customerRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

customerRouter.post('/:id/teable-config', async (req, res) => {
  try {
    const { id } = req.params;
    const { baseUrl, spaceId, baseId, accessToken } = req.body;

    if (!baseUrl || !spaceId || !baseId || !accessToken) {
      return res.status(400).json({ error: 'All Teable config fields are required' });
    }

    await supabase
      .from('customer_teable_config')
      .update({ is_active: false })
      .eq('customer_id', id);

    const { data: config, error } = await supabase
      .from('customer_teable_config')
      .insert({
        customer_id: id,
        base_url: baseUrl,
        space_id: spaceId,
        base_id: baseId,
        access_token: accessToken,
        is_active: true
      })
      .select()
      .single();

    if (error) throw error;

    await logCustomerActivity(
      id,
      req.body.adminEmail || 'system',
      'teable_config_updated',
      'Teable.io configuration updated'
    );

    res.json({ success: true, config });
  } catch (error) {
    console.error('Error saving Teable config:', error);
    res.status(500).json({ error: 'Failed to save Teable config' });
  }
});

customerRouter.get('/:id/teable-config', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: config, error } = await supabase
      .from('customer_teable_config')
      .select('*')
      .eq('customer_id', id)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;

    res.json({ success: true, config });
  } catch (error) {
    console.error('Error fetching Teable config:', error);
    res.status(500).json({ error: 'Failed to fetch Teable config' });
  }
});
