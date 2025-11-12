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
      { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  }

  async decrypt(encryptedText: string): Promise<string> {
    const buffer = Uint8Array.from(atob(encryptedText), c => c.charCodeAt(0));
    const salt = buffer.slice(0, 64);
    const iv = buffer.slice(64, 80);
    const encrypted = buffer.slice(80);
    const key = await this.deriveKey(salt);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, encrypted);
    return new TextDecoder().decode(decrypted);
  }
}

async function getAuthorizedClient(supabase: any, customerId: string, encryptionService: EncryptionService) {
  const { data: config, error } = await supabase
    .from('customer_google_sheets_config')
    .select('*')
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .single();

  if (error || !config) {
    throw new Error('Google Sheets configuration not found');
  }

  const accessToken = await encryptionService.decrypt(config.oauth_access_token);
  return { accessToken, config };
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

    const encryptionService = new EncryptionService(Deno.env.get('ENCRYPTION_KEY') ?? '');
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const customerId = pathParts[1];
    const action = pathParts[2];

    if (action === 'spreadsheets' && req.method === 'GET') {
      const { accessToken } = await getAuthorizedClient(supabase, customerId, encryptionService);
      
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'&fields=files(id,name,webViewLink,modifiedTime)&orderBy=modifiedTime desc&pageSize=100`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const data = await response.json();
      return new Response(
        JSON.stringify({ spreadsheets: data.files || [] }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'sheets' && req.method === 'GET') {
      const spreadsheetId = url.searchParams.get('spreadsheetId');
      if (!spreadsheetId) {
        return new Response(
          JSON.stringify({ error: 'spreadsheetId is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { accessToken } = await getAuthorizedClient(supabase, customerId, encryptionService);
      
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const data = await response.json();
      const sheetList = data.sheets.map((sheet: any) => ({
        sheetId: sheet.properties.sheetId,
        title: sheet.properties.title,
        rowCount: sheet.properties.gridProperties.rowCount,
        columnCount: sheet.properties.gridProperties.columnCount,
        index: sheet.properties.index
      }));

      return new Response(
        JSON.stringify({ spreadsheetName: data.properties.title, sheets: sheetList }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'preview' && req.method === 'GET') {
      const spreadsheetId = url.searchParams.get('spreadsheetId');
      const sheetName = url.searchParams.get('sheetName');

      if (!spreadsheetId || !sheetName) {
        return new Response(
          JSON.stringify({ error: 'spreadsheetId and sheetName are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { accessToken } = await getAuthorizedClient(supabase, customerId, encryptionService);
      
      const range = `${sheetName}!A1:Z10`;
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const data = await response.json();
      const values = data.values || [];
      const headers = values.length > 0 ? values[0] : [];
      const rows = values.slice(1, 6);

      return new Response(
        JSON.stringify({ headers, rows, totalRows: values.length - 1 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'detect-fields' && req.method === 'POST') {
      const { spreadsheetId, sheetName } = await req.json();

      if (!spreadsheetId || !sheetName) {
        return new Response(
          JSON.stringify({ error: 'spreadsheetId and sheetName are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { accessToken } = await getAuthorizedClient(supabase, customerId, encryptionService);
      
      const range = `${sheetName}!A1:Z100`;
      const response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      const data = await response.json();
      const values = data.values || [];

      if (values.length < 2) {
        return new Response(
          JSON.stringify({ error: 'Sheet must have at least a header row and one data row' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const headers = values[0];
      const dataRows = values.slice(1);

      let geometryColumn = null;
      let idColumn = null;
      let nameColumn = null;
      let latitudeColumn = null;
      let longitudeColumn = null;

      headers.forEach((header: string, index: number) => {
        const lowerHeader = header.toLowerCase();

        if (['geometry', 'geom', 'wkt', 'shape', 'the_geom'].some(g => lowerHeader.includes(g))) {
          geometryColumn = header;
        }
        if (['id', 'objectid', 'fid', 'gid'].some(i => lowerHeader === i || lowerHeader.endsWith(i))) {
          idColumn = header;
        }
        if (['name', 'title', 'label', 'description'].some(n => lowerHeader.includes(n))) {
          if (!nameColumn) nameColumn = header;
        }
        if (['latitude', 'lat', 'y'].some(l => lowerHeader === l || lowerHeader.endsWith('lat'))) {
          latitudeColumn = header;
        }
        if (['longitude', 'lon', 'lng', 'long', 'x'].some(l => lowerHeader === l || lowerHeader.endsWith('lng') || lowerHeader.endsWith('lon'))) {
          longitudeColumn = header;
        }
      });

      if (!geometryColumn && !latitudeColumn && !longitudeColumn) {
        for (let i = 0; i < headers.length; i++) {
          const sampleValue = dataRows.find((row: any) => row[i])?.[i];
          if (sampleValue && typeof sampleValue === 'string') {
            const trimmed = sampleValue.trim();
            if (trimmed.startsWith('POINT') || trimmed.startsWith('POLYGON') || trimmed.startsWith('LINESTRING')) {
              geometryColumn = headers[i];
              break;
            }
          }
        }
      }

      if (!idColumn && headers.length > 0) idColumn = headers[0];
      if (!nameColumn && headers.length > 1) nameColumn = headers[1];

      return new Response(
        JSON.stringify({
          geometry_column: geometryColumn,
          id_column: idColumn,
          name_column: nameColumn,
          latitude_column: latitudeColumn,
          longitude_column: longitudeColumn,
          all_columns: headers
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'save-config' && req.method === 'POST') {
      const { spreadsheetId, sheetName, fieldMappings } = await req.json();

      if (!spreadsheetId || !sheetName || !fieldMappings) {
        return new Response(
          JSON.stringify({ error: 'spreadsheetId, sheetName, and fieldMappings are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: existingConfig } = await supabase
        .from('customer_google_sheets_config')
        .select('id')
        .eq('customer_id', customerId)
        .eq('is_active', true)
        .single();

      if (!existingConfig) {
        return new Response(
          JSON.stringify({ error: 'OAuth configuration not found. Please authenticate first.' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { error } = await supabase
        .from('customer_google_sheets_config')
        .update({ spreadsheet_id: spreadsheetId, sheet_name: sheetName, field_mappings: fieldMappings })
        .eq('id', existingConfig.id);

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to save configuration' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      await supabase
        .from('customers')
        .update({ data_source: 'google_sheets' })
        .eq('id', customerId);

      return new Response(
        JSON.stringify({ success: true }),
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