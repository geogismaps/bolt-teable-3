import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.75.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

class EncryptionService {
  private encryptionKey: string;

  constructor(encryptionKey: string) {
    if (!encryptionKey) {
      throw new Error('Encryption key is required');
    }
    this.encryptionKey = encryptionKey;
  }

  async deriveKey(salt: Uint8Array): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(this.encryptionKey),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async encrypt(text: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(64));
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const key = await this.deriveKey(salt);

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      new TextEncoder().encode(text)
    );

    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  async decrypt(encryptedText: string): Promise<string> {
    const buffer = Uint8Array.from(atob(encryptedText), c => c.charCodeAt(0));

    const salt = buffer.slice(0, 64);
    const iv = buffer.slice(64, 80);
    const encrypted = buffer.slice(80);

    const key = await this.deriveKey(salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );

    return new TextDecoder().decode(decrypted);
  }

  static generateToken(): string {
    const array = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }
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
    const path = url.pathname.replace('/google-oauth/', '');

    if (path === 'test' && req.method === 'GET') {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Google OAuth router is working',
          timestamp: new Date().toISOString()
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (path === 'start' && req.method === 'GET') {
      const customerId = url.searchParams.get('customerId');
      const adminEmail = url.searchParams.get('adminEmail');

      if (!customerId || !adminEmail) {
        return new Response(
          JSON.stringify({ error: 'customerId and adminEmail are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
      const redirectUri = Deno.env.get('GOOGLE_REDIRECT_URI');

      if (!clientId || !redirectUri) {
        return new Response(
          JSON.stringify({ error: 'Google OAuth is not configured on the server' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const stateToken = EncryptionService.generateToken();

      const { error } = await supabase
        .from('google_oauth_state')
        .insert({
          state_token: stateToken,
          customer_id: customerId,
          admin_email: adminEmail,
          redirect_uri: redirectUri
        });

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to initiate OAuth flow', details: error.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const scopes = [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/userinfo.email'
      ].join(' ');

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent(scopes)}&` +
        `state=${encodeURIComponent(stateToken)}&` +
        `access_type=offline&` +
        `prompt=consent`;

      return new Response(
        JSON.stringify({ authUrl }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (path === 'callback' && req.method === 'GET') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');

      if (!code || !state) {
        return new Response('Missing authorization code or state', { status: 400 });
      }

      const { data: stateRecord, error: stateError } = await supabase
        .from('google_oauth_state')
        .select('*')
        .eq('state_token', state)
        .single();

      if (stateError || !stateRecord) {
        return new Response('Invalid or expired OAuth state', { status: 400 });
      }

      if (new Date(stateRecord.expires_at) < new Date()) {
        await supabase
          .from('google_oauth_state')
          .delete()
          .eq('state_token', state);
        return new Response('OAuth state expired. Please try again.', { status: 400 });
      }

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code,
          client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
          client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
          redirect_uri: Deno.env.get('GOOGLE_REDIRECT_URI') ?? '',
          grant_type: 'authorization_code'
        })
      });

      const tokens = await tokenResponse.json();

      if (!tokens.access_token) {
        return new Response('Failed to get access token', { status: 500 });
      }

      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });
      const userInfo = await userInfoResponse.json();

      const encryptionService = new EncryptionService(Deno.env.get('ENCRYPTION_KEY') ?? '');
      const encryptedAccessToken = await encryptionService.encrypt(tokens.access_token);
      const encryptedRefreshToken = await encryptionService.encrypt(tokens.refresh_token || '');

      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + (tokens.expires_in || 3600));

      await supabase
        .from('customer_google_sheets_config')
        .update({ is_active: false })
        .eq('customer_id', stateRecord.customer_id);

      const { error: configError } = await supabase
        .from('customer_google_sheets_config')
        .insert({
          customer_id: stateRecord.customer_id,
          spreadsheet_id: '',
          sheet_name: '',
          oauth_access_token: encryptedAccessToken,
          oauth_refresh_token: encryptedRefreshToken,
          oauth_token_expires_at: expiresAt.toISOString(),
          oauth_user_email: userInfo.email,
          is_active: true
        });

      if (configError) {
        console.error('Error saving Google Sheets config:', configError);
        return new Response('Failed to save OAuth tokens', { status: 500 });
      }

      await supabase
        .from('google_oauth_state')
        .delete()
        .eq('state_token', state);

      return Response.redirect(
        `${url.origin}/super-admin.html?oauth=success&email=${encodeURIComponent(userInfo.email)}&customer=${stateRecord.customer_id}`,
        302
      );
    }

    if (path === 'refresh' && req.method === 'POST') {
      const { customerId } = await req.json();

      if (!customerId) {
        return new Response(
          JSON.stringify({ error: 'customerId is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: config, error } = await supabase
        .from('customer_google_sheets_config')
        .select('*')
        .eq('customer_id', customerId)
        .eq('is_active', true)
        .single();

      if (error || !config) {
        return new Response(
          JSON.stringify({ error: 'Google Sheets configuration not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const encryptionService = new EncryptionService(Deno.env.get('ENCRYPTION_KEY') ?? '');
      const refreshToken = await encryptionService.decrypt(config.oauth_refresh_token);

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: Deno.env.get('GOOGLE_CLIENT_ID') ?? '',
          client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
          grant_type: 'refresh_token'
        })
      });

      const tokens = await tokenResponse.json();

      if (!tokens.access_token) {
        return new Response(
          JSON.stringify({ error: 'Failed to refresh token' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const encryptedAccessToken = await encryptionService.encrypt(tokens.access_token);
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + (tokens.expires_in || 3600));

      const { error: updateError } = await supabase
        .from('customer_google_sheets_config')
        .update({
          oauth_access_token: encryptedAccessToken,
          oauth_token_expires_at: expiresAt.toISOString()
        })
        .eq('id', config.id);

      if (updateError) {
        return new Response(
          JSON.stringify({ error: 'Failed to update tokens' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, expiresAt: expiresAt.toISOString() }),
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