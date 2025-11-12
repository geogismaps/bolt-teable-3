import express from 'express';
import { google } from 'googleapis';
import { supabase } from '../config/supabase.js';
import { getEncryptionService, EncryptionService } from '../utils/encryption.js';

export const googleOAuthRouter = express.Router();

googleOAuthRouter.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Google OAuth router is working',
    timestamp: new Date().toISOString()
  });
});

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];

function getOAuth2Client() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    throw new Error('Google OAuth credentials not configured');
  }

  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

googleOAuthRouter.get('/start', async (req, res) => {
  try {
    console.log('🔵 Google OAuth start request:', req.query);

    const { customerId, adminEmail } = req.query;

    if (!customerId || !adminEmail) {
      console.error('❌ Missing required parameters:', { customerId, adminEmail });
      return res.status(400).json({ error: 'customerId and adminEmail are required' });
    }

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      console.error('❌ Missing Google OAuth credentials in environment');
      return res.status(500).json({ error: 'Google OAuth is not configured on the server' });
    }

    if (!process.env.ENCRYPTION_KEY) {
      console.error('❌ Missing encryption key in environment');
      return res.status(500).json({ error: 'Encryption is not configured on the server' });
    }

    const stateToken = EncryptionService.generateToken();
    console.log('🔑 Generated state token:', stateToken.substring(0, 10) + '...');

    const { error } = await supabase
      .from('google_oauth_state')
      .insert({
        state_token: stateToken,
        customer_id: customerId,
        admin_email: adminEmail,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`
      });

    if (error) {
      console.error('❌ Error saving OAuth state:', error);
      return res.status(500).json({ error: 'Failed to initiate OAuth flow', details: error.message });
    }

    console.log('✅ OAuth state saved successfully');

    const oauth2Client = getOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state: stateToken,
      prompt: 'consent'
    });

    console.log('✅ Generated auth URL:', authUrl.substring(0, 50) + '...');

    res.json({ authUrl });
  } catch (error) {
    console.error('❌ Error starting OAuth:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

googleOAuthRouter.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send('Missing authorization code or state');
    }

    const { data: stateRecord, error: stateError } = await supabase
      .from('google_oauth_state')
      .select('*')
      .eq('state_token', state)
      .single();

    if (stateError || !stateRecord) {
      return res.status(400).send('Invalid or expired OAuth state');
    }

    if (new Date(stateRecord.expires_at) < new Date()) {
      await supabase
        .from('google_oauth_state')
        .delete()
        .eq('state_token', state);

      return res.status(400).send('OAuth state expired. Please try again.');
    }

    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    const encryptionService = getEncryptionService();
    const encryptedAccessToken = encryptionService.encrypt(tokens.access_token);
    const encryptedRefreshToken = encryptionService.encrypt(tokens.refresh_token);

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokens.expiry_date ? (tokens.expiry_date - Date.now()) / 1000 : 3600));

    await supabase
      .from('customer_google_sheets_config')
      .update({ is_active: false })
      .eq('customer_id', stateRecord.customer_id);

    const { data: config, error: configError } = await supabase
      .from('customer_google_sheets_config')
      .insert({
        customer_id: stateRecord.customer_id,
        spreadsheet_id: '',
        sheet_name: '',
        oauth_access_token: encryptedAccessToken,
        oauth_refresh_token: encryptedRefreshToken,
        oauth_token_expires_at: expiresAt.toISOString(),
        oauth_user_email: userInfo.data.email,
        is_active: true
      })
      .select()
      .single();

    if (configError) {
      console.error('Error saving Google Sheets config:', configError);
      return res.status(500).send('Failed to save OAuth tokens');
    }

    await supabase
      .from('google_oauth_state')
      .delete()
      .eq('state_token', state);

    res.redirect(`/super-admin.html?oauth=success&email=${encodeURIComponent(userInfo.data.email)}&customer=${stateRecord.customer_id}`);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).send(`OAuth callback failed: ${error.message}`);
  }
});

googleOAuthRouter.post('/refresh', async (req, res) => {
  try {
    const { customerId } = req.body;

    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    const { data: config, error } = await supabase
      .from('customer_google_sheets_config')
      .select('*')
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .single();

    if (error || !config) {
      return res.status(404).json({ error: 'Google Sheets configuration not found' });
    }

    const encryptionService = getEncryptionService();
    const refreshToken = encryptionService.decrypt(config.oauth_refresh_token);

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: refreshToken
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    const encryptedAccessToken = encryptionService.encrypt(credentials.access_token);

    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + 3600);

    const { error: updateError } = await supabase
      .from('customer_google_sheets_config')
      .update({
        oauth_access_token: encryptedAccessToken,
        oauth_token_expires_at: expiresAt.toISOString()
      })
      .eq('id', config.id);

    if (updateError) {
      console.error('Error updating tokens:', updateError);
      return res.status(500).json({ error: 'Failed to update tokens' });
    }

    res.json({ success: true, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: error.message });
  }
});
