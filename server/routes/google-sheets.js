import express from 'express';
import { google } from 'googleapis';
import { supabase } from '../config/supabase.js';
import { getEncryptionService } from '../utils/encryption.js';

export const googleSheetsRouter = express.Router();

googleSheetsRouter.get('/get-token/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;

    const { data: config, error } = await supabase
      .from('customer_google_sheets_config')
      .select('*')
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !config) {
      return res.status(404).json({ error: 'Google Sheets configuration not found' });
    }

    const encryptionService = getEncryptionService();
    const accessToken = encryptionService.decrypt(config.oauth_access_token);

    res.json({
      success: true,
      accessToken: accessToken
    });
  } catch (error) {
    console.error('Error getting access token:', error);
    res.status(500).json({ error: 'Failed to get access token' });
  }
});

googleSheetsRouter.post('/save-selection/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { spreadsheetId, sheetName } = req.body;

    if (!spreadsheetId || !sheetName) {
      return res.status(400).json({ error: 'spreadsheetId and sheetName are required' });
    }

    const { error } = await supabase
      .from('customer_google_sheets_config')
      .update({
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName
      })
      .eq('customer_id', customerId)
      .eq('is_active', true);

    if (error) {
      console.error('Error saving sheet selection:', error);
      return res.status(500).json({ error: 'Failed to save selection' });
    }

    res.json({
      success: true,
      message: 'Sheet selection saved successfully'
    });
  } catch (error) {
    console.error('Error saving sheet selection:', error);
    res.status(500).json({ error: error.message });
  }
});

async function getAuthorizedClient(customerId) {
  const { data: config, error } = await supabase
    .from('customer_google_sheets_config')
    .select('*')
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .single();

  if (error || !config) {
    throw new Error('Google Sheets configuration not found');
  }

  const encryptionService = getEncryptionService();
  const accessToken = encryptionService.decrypt(config.oauth_access_token);
  const refreshToken = encryptionService.decrypt(config.oauth_refresh_token);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  return { oauth2Client, config };
}

googleSheetsRouter.get('/:customerId/spreadsheets', async (req, res) => {
  try {
    const { customerId } = req.params;

    const { oauth2Client } = await getAuthorizedClient(customerId);
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    const response = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet'",
      fields: 'files(id, name, webViewLink, modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: 100
    });

    res.json({
      spreadsheets: response.data.files || []
    });
  } catch (error) {
    console.error('Error listing spreadsheets:', error);
    res.status(500).json({ error: error.message });
  }
});

googleSheetsRouter.get('/:customerId/sheets', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { spreadsheetId } = req.query;

    if (!spreadsheetId) {
      return res.status(400).json({ error: 'spreadsheetId is required' });
    }

    const { oauth2Client } = await getAuthorizedClient(customerId);
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const response = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId
    });

    const sheetList = response.data.sheets.map(sheet => ({
      sheetId: sheet.properties.sheetId,
      title: sheet.properties.title,
      rowCount: sheet.properties.gridProperties.rowCount,
      columnCount: sheet.properties.gridProperties.columnCount,
      index: sheet.properties.index
    }));

    res.json({
      spreadsheetName: response.data.properties.title,
      sheets: sheetList
    });
  } catch (error) {
    console.error('Error listing sheets:', error);
    res.status(500).json({ error: error.message });
  }
});

googleSheetsRouter.get('/:customerId/preview', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { spreadsheetId, sheetName } = req.query;

    if (!spreadsheetId || !sheetName) {
      return res.status(400).json({ error: 'spreadsheetId and sheetName are required' });
    }

    const { oauth2Client } = await getAuthorizedClient(customerId);
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const range = `${sheetName}!A1:Z10`;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range
    });

    const values = response.data.values || [];
    const headers = values.length > 0 ? values[0] : [];
    const rows = values.slice(1, 6);

    res.json({
      headers: headers,
      rows: rows,
      totalRows: values.length - 1
    });
  } catch (error) {
    console.error('Error fetching preview:', error);
    res.status(500).json({ error: error.message });
  }
});

googleSheetsRouter.post('/:customerId/detect-fields', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { spreadsheetId, sheetName } = req.body;

    if (!spreadsheetId || !sheetName) {
      return res.status(400).json({ error: 'spreadsheetId and sheetName are required' });
    }

    const { oauth2Client } = await getAuthorizedClient(customerId);
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const range = `${sheetName}!A1:Z100`;

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range
    });

    const values = response.data.values || [];
    if (values.length < 2) {
      return res.status(400).json({ error: 'Sheet must have at least a header row and one data row' });
    }

    const headers = values[0];
    const dataRows = values.slice(1);

    let geometryColumn = null;
    let idColumn = null;
    let nameColumn = null;
    let latitudeColumn = null;
    let longitudeColumn = null;

    headers.forEach((header, index) => {
      const lowerHeader = header.toLowerCase();

      if (['geometry', 'geom', 'wkt', 'shape', 'the_geom'].some(g => lowerHeader.includes(g))) {
        geometryColumn = header;
      }

      if (['id', 'objectid', 'fid', 'gid'].some(i => lowerHeader === i || lowerHeader.endsWith(i))) {
        idColumn = header;
      }

      if (['name', 'title', 'label', 'description'].some(n => lowerHeader.includes(n))) {
        if (!nameColumn) {
          nameColumn = header;
        }
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
        const sampleValue = dataRows.find(row => row[i])? [i] : null;
        if (sampleValue && typeof sampleValue === 'string') {
          const trimmed = sampleValue.trim();
          if (trimmed.startsWith('POINT') || trimmed.startsWith('POLYGON') || trimmed.startsWith('LINESTRING')) {
            geometryColumn = headers[i];
            break;
          }
        }
      }
    }

    if (!idColumn && headers.length > 0) {
      idColumn = headers[0];
    }

    if (!nameColumn && headers.length > 1) {
      nameColumn = headers[1];
    }

    const suggestions = {
      geometry_column: geometryColumn,
      id_column: idColumn,
      name_column: nameColumn,
      latitude_column: latitudeColumn,
      longitude_column: longitudeColumn,
      all_columns: headers
    };

    res.json(suggestions);
  } catch (error) {
    console.error('Error detecting fields:', error);
    res.status(500).json({ error: error.message });
  }
});

googleSheetsRouter.post('/:customerId/save-config', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { spreadsheetId, sheetName, fieldMappings } = req.body;

    if (!spreadsheetId || !sheetName || !fieldMappings) {
      return res.status(400).json({ error: 'spreadsheetId, sheetName, and fieldMappings are required' });
    }

    const { data: existingConfig } = await supabase
      .from('customer_google_sheets_config')
      .select('id')
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .single();

    if (!existingConfig) {
      return res.status(404).json({ error: 'OAuth configuration not found. Please authenticate first.' });
    }

    const { error } = await supabase
      .from('customer_google_sheets_config')
      .update({
        spreadsheet_id: spreadsheetId,
        sheet_name: sheetName,
        field_mappings: fieldMappings
      })
      .eq('id', existingConfig.id);

    if (error) {
      console.error('Error saving config:', error);
      return res.status(500).json({ error: 'Failed to save configuration' });
    }

    await supabase
      .from('customers')
      .update({ data_source: 'google_sheets' })
      .eq('id', customerId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving Google Sheets config:', error);
    res.status(500).json({ error: error.message });
  }
});
