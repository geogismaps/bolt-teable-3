import express from 'express';
import { supabase, logCustomerActivity } from '../config/supabase.js';

export const htmlEditorRouter = express.Router();

htmlEditorRouter.get('/customers/:customerId/pages', async (req, res) => {
  try {
    const { customerId } = req.params;

    const { data: pages, error } = await supabase
      .from('customer_html_customizations')
      .select('*')
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .order('page_name');

    if (error) throw error;

    res.json({ success: true, pages });
  } catch (error) {
    console.error('Error fetching pages:', error);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

htmlEditorRouter.get('/customers/:customerId/pages/:pageName', async (req, res) => {
  try {
    const { customerId, pageName } = req.params;

    const { data: page, error } = await supabase
      .from('customer_html_customizations')
      .select('*')
      .eq('customer_id', customerId)
      .eq('page_name', pageName)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;

    res.json({ success: true, page });
  } catch (error) {
    console.error('Error fetching page:', error);
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

htmlEditorRouter.post('/customers/:customerId/pages', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { pageName, htmlContent, cssContent, jsContent, createdBy } = req.body;

    if (!pageName || !createdBy) {
      return res.status(400).json({ error: 'Page name and creator email are required' });
    }

    const { data: existing } = await supabase
      .from('customer_html_customizations')
      .select('*')
      .eq('customer_id', customerId)
      .eq('page_name', pageName)
      .eq('is_active', true)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('customer_html_versions')
        .insert({
          customization_id: existing.id,
          customer_id: customerId,
          page_name: pageName,
          html_content: existing.html_content,
          css_content: existing.css_content,
          js_content: existing.js_content,
          version: existing.version,
          created_by: existing.created_by,
          change_description: 'Previous version archived'
        });

      await supabase
        .from('customer_html_customizations')
        .update({
          html_content: htmlContent,
          css_content: cssContent,
          js_content: jsContent,
          version: existing.version + 1,
          created_by: createdBy
        })
        .eq('id', existing.id);

      const { data: updated } = await supabase
        .from('customer_html_customizations')
        .select('*')
        .eq('id', existing.id)
        .single();

      await logCustomerActivity(
        customerId,
        createdBy,
        'html_updated',
        `Updated HTML for page: ${pageName}`
      );

      return res.json({ success: true, page: updated });
    }

    const { data: page, error } = await supabase
      .from('customer_html_customizations')
      .insert({
        customer_id: customerId,
        page_name: pageName,
        html_content: htmlContent,
        css_content: cssContent,
        js_content: jsContent,
        version: 1,
        is_active: true,
        created_by: createdBy
      })
      .select()
      .single();

    if (error) throw error;

    await logCustomerActivity(
      customerId,
      createdBy,
      'html_created',
      `Created HTML customization for page: ${pageName}`
    );

    res.json({ success: true, page });
  } catch (error) {
    console.error('Error saving page:', error);
    res.status(500).json({ error: 'Failed to save page' });
  }
});

htmlEditorRouter.get('/customers/:customerId/pages/:pageName/versions', async (req, res) => {
  try {
    const { customerId, pageName } = req.params;

    const { data: versions, error } = await supabase
      .from('customer_html_versions')
      .select('*')
      .eq('customer_id', customerId)
      .eq('page_name', pageName)
      .order('version', { ascending: false });

    if (error) throw error;

    res.json({ success: true, versions });
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
});

htmlEditorRouter.post('/customers/:customerId/pages/:pageName/rollback/:version', async (req, res) => {
  try {
    const { customerId, pageName, version } = req.params;
    const { createdBy } = req.body;

    const { data: versionData, error: versionError } = await supabase
      .from('customer_html_versions')
      .select('*')
      .eq('customer_id', customerId)
      .eq('page_name', pageName)
      .eq('version', parseInt(version))
      .single();

    if (versionError || !versionData) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const { data: current } = await supabase
      .from('customer_html_customizations')
      .select('*')
      .eq('customer_id', customerId)
      .eq('page_name', pageName)
      .eq('is_active', true)
      .single();

    if (current) {
      await supabase
        .from('customer_html_versions')
        .insert({
          customization_id: current.id,
          customer_id: customerId,
          page_name: pageName,
          html_content: current.html_content,
          css_content: current.css_content,
          js_content: current.js_content,
          version: current.version,
          created_by: current.created_by,
          change_description: 'Archived before rollback'
        });

      await supabase
        .from('customer_html_customizations')
        .update({
          html_content: versionData.html_content,
          css_content: versionData.css_content,
          js_content: versionData.js_content,
          version: current.version + 1,
          created_by: createdBy
        })
        .eq('id', current.id);
    }

    await logCustomerActivity(
      customerId,
      createdBy,
      'html_rollback',
      `Rolled back page ${pageName} to version ${version}`
    );

    res.json({ success: true, message: 'Rollback successful' });
  } catch (error) {
    console.error('Error rolling back:', error);
    res.status(500).json({ error: 'Failed to rollback' });
  }
});

htmlEditorRouter.delete('/customers/:customerId/pages/:pageName', async (req, res) => {
  try {
    const { customerId, pageName } = req.params;

    const { error } = await supabase
      .from('customer_html_customizations')
      .delete()
      .eq('customer_id', customerId)
      .eq('page_name', pageName);

    if (error) throw error;

    await logCustomerActivity(
      customerId,
      req.body.createdBy || 'system',
      'html_deleted',
      `Deleted HTML customization for page: ${pageName}`
    );

    res.json({ success: true, message: 'Page deleted successfully' });
  } catch (error) {
    console.error('Error deleting page:', error);
    res.status(500).json({ error: 'Failed to delete page' });
  }
});
