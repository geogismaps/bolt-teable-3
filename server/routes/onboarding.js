import express from 'express';
import { supabase, logCustomerActivity } from '../config/supabase.js';
import { AdapterFactory } from '../adapters/AdapterFactory.js';

export const onboardingRouter = express.Router();

async function detectLocationFields(headers, sampleData) {
  const detectedFields = {
    geometryColumn: null,
    latitudeColumn: null,
    longitudeColumn: null,
    addressColumn: null,
    idColumn: null,
    nameColumn: null,
    confidence: 0,
    suggestions: []
  };

  const geometryKeywords = ['geometry', 'geom', 'wkt', 'shape', 'the_geom', 'geojson', 'geo'];
  const latKeywords = ['latitude', 'lat', 'y', 'northing'];
  const lngKeywords = ['longitude', 'lon', 'lng', 'long', 'x', 'easting'];
  const addressKeywords = ['address', 'location', 'addr', 'street', 'place'];
  const idKeywords = ['id', 'objectid', 'fid', 'gid', 'feature_id'];
  const nameKeywords = ['name', 'title', 'label', 'description', 'desc'];

  headers.forEach((header, index) => {
    const lowerHeader = header.toLowerCase();

    if (geometryKeywords.some(keyword => lowerHeader.includes(keyword))) {
      if (!detectedFields.geometryColumn) {
        const samples = sampleData.slice(0, 5).map(row => row[index]).filter(v => v);
        if (samples.some(s => typeof s === 'string' && (s.includes('POINT') || s.includes('POLYGON') || s.includes('LINE')))) {
          detectedFields.geometryColumn = header;
          detectedFields.confidence += 30;
          detectedFields.suggestions.push(`Geometry column detected: ${header}`);
        }
      }
    }

    if (latKeywords.some(keyword => lowerHeader === keyword || lowerHeader.endsWith(keyword))) {
      if (!detectedFields.latitudeColumn) {
        detectedFields.latitudeColumn = header;
        detectedFields.confidence += 20;
      }
    }

    if (lngKeywords.some(keyword => lowerHeader === keyword || lowerHeader.endsWith(keyword))) {
      if (!detectedFields.longitudeColumn) {
        detectedFields.longitudeColumn = header;
        detectedFields.confidence += 20;
      }
    }

    if (addressKeywords.some(keyword => lowerHeader.includes(keyword))) {
      if (!detectedFields.addressColumn) {
        detectedFields.addressColumn = header;
        detectedFields.confidence += 10;
        detectedFields.suggestions.push(`Address column found: ${header} (requires geocoding)`);
      }
    }

    if (idKeywords.some(keyword => lowerHeader === keyword || lowerHeader.endsWith(keyword))) {
      if (!detectedFields.idColumn) {
        detectedFields.idColumn = header;
      }
    }

    if (nameKeywords.some(keyword => lowerHeader.includes(keyword))) {
      if (!detectedFields.nameColumn) {
        detectedFields.nameColumn = header;
      }
    }
  });

  if (detectedFields.latitudeColumn && detectedFields.longitudeColumn) {
    detectedFields.suggestions.push(`Lat/Lng pair detected: ${detectedFields.latitudeColumn}, ${detectedFields.longitudeColumn}`);
  }

  if (!detectedFields.idColumn && headers.length > 0) {
    detectedFields.idColumn = headers[0];
    detectedFields.suggestions.push(`Using first column as ID: ${headers[0]}`);
  }

  if (!detectedFields.nameColumn && headers.length > 1) {
    detectedFields.nameColumn = headers[1];
  }

  detectedFields.hasLocationData = !!(
    detectedFields.geometryColumn ||
    (detectedFields.latitudeColumn && detectedFields.longitudeColumn) ||
    detectedFields.addressColumn
  );

  if (!detectedFields.hasLocationData) {
    detectedFields.suggestions.push('No location data detected. You may need to add geometry, lat/lng, or address columns.');
  }

  return detectedFields;
}

onboardingRouter.get('/status/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;

    const { data: status, error } = await supabase
      .from('customer_onboarding_status')
      .select('*')
      .eq('customer_id', customerId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (!status) {
      return res.json({
        success: true,
        status: {
          current_step: 'data_source',
          data_source_connected: false,
          location_fields_detected: false,
          is_complete: false,
          steps_completed: {}
        }
      });
    }

    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('Error fetching onboarding status:', error);
    res.status(500).json({ error: 'Failed to fetch onboarding status' });
  }
});

onboardingRouter.post('/update-step', async (req, res) => {
  try {
    const { customerId, step, data: stepData } = req.body;

    if (!customerId || !step) {
      return res.status(400).json({ error: 'customerId and step are required' });
    }

    const { data: existing } = await supabase
      .from('customer_onboarding_status')
      .select('*')
      .eq('customer_id', customerId)
      .maybeSingle();

    const stepsCompleted = existing?.steps_completed || {};
    stepsCompleted[step] = new Date().toISOString();

    const updateData = {
      current_step: step,
      steps_completed: stepsCompleted,
      ...stepData
    };

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('customer_onboarding_status')
        .update(updateData)
        .eq('customer_id', customerId)
        .select()
        .single();

      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('customer_onboarding_status')
        .insert({
          customer_id: customerId,
          ...updateData
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
    }

    await logCustomerActivity(
      customerId,
      req.body.userEmail || 'system',
      'onboarding_step_completed',
      `Completed onboarding step: ${step}`
    );

    res.json({
      success: true,
      status: result
    });
  } catch (error) {
    console.error('Error updating onboarding step:', error);
    res.status(500).json({ error: 'Failed to update onboarding step' });
  }
});

onboardingRouter.post('/detect-location-fields', async (req, res) => {
  try {
    const { customerId, dataSource, tableId, spreadsheetId, sheetName } = req.body;

    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    let config;
    let adapter;

    if (dataSource === 'teable') {
      const { data: teableConfig } = await supabase
        .from('customer_teable_config')
        .select('*')
        .eq('customer_id', customerId)
        .eq('is_active', true)
        .single();

      if (!teableConfig) {
        return res.status(404).json({ error: 'Teable configuration not found' });
      }

      config = {
        ...teableConfig,
        table_id: tableId
      };

      adapter = AdapterFactory.createAdapter('teable', config);
    } else if (dataSource === 'google_sheets') {
      const { data: sheetsConfig } = await supabase
        .from('customer_google_sheets_config')
        .select('*')
        .eq('customer_id', customerId)
        .eq('is_active', true)
        .single();

      if (!sheetsConfig) {
        return res.status(404).json({ error: 'Google Sheets configuration not found' });
      }

      config = {
        ...sheetsConfig,
        spreadsheet_id: spreadsheetId || sheetsConfig.spreadsheet_id,
        sheet_name: sheetName || sheetsConfig.sheet_name
      };

      adapter = AdapterFactory.createAdapter('google_sheets', config);
    } else {
      return res.status(400).json({ error: 'Invalid data source' });
    }

    await adapter.connect();

    const schema = await adapter.getSchema();
    const headers = schema.map(field => field.name || field.title || field.id);

    const { features } = await adapter.fetchRecords({ limit: 10 });
    const sampleData = features.map(f => {
      const row = [];
      headers.forEach(header => {
        row.push(f.properties[header]);
      });
      return row;
    });

    const detectedFields = await detectLocationFields(headers, sampleData);

    const fieldMappings = {
      geometry_column: detectedFields.geometryColumn,
      latitude_column: detectedFields.latitudeColumn,
      longitude_column: detectedFields.longitudeColumn,
      address_column: detectedFields.addressColumn,
      id_column: detectedFields.idColumn,
      name_column: detectedFields.nameColumn
    };

    await supabase
      .from('customer_onboarding_status')
      .upsert({
        customer_id: customerId,
        field_mappings: fieldMappings,
        location_fields_detected: detectedFields.hasLocationData,
        current_step: detectedFields.hasLocationData ? 'complete' : 'location_detection'
      }, {
        onConflict: 'customer_id'
      });

    res.json({
      success: true,
      detected: detectedFields,
      fieldMappings,
      allFields: headers,
      sampleData: features.slice(0, 3)
    });
  } catch (error) {
    console.error('Error detecting location fields:', error);
    res.status(500).json({
      error: 'Failed to detect location fields',
      message: error.message
    });
  }
});

onboardingRouter.post('/save-field-mappings', async (req, res) => {
  try {
    const { customerId, dataSource, fieldMappings } = req.body;

    if (!customerId || !fieldMappings) {
      return res.status(400).json({ error: 'customerId and fieldMappings are required' });
    }

    if (dataSource === 'google_sheets') {
      await supabase
        .from('customer_google_sheets_config')
        .update({ field_mappings: fieldMappings })
        .eq('customer_id', customerId)
        .eq('is_active', true);
    }

    await supabase
      .from('customer_onboarding_status')
      .update({
        field_mappings: fieldMappings,
        location_fields_detected: true,
        current_step: 'complete'
      })
      .eq('customer_id', customerId);

    await logCustomerActivity(
      customerId,
      req.body.userEmail || 'system',
      'field_mappings_saved',
      'Field mappings configured and saved'
    );

    res.json({
      success: true,
      message: 'Field mappings saved successfully'
    });
  } catch (error) {
    console.error('Error saving field mappings:', error);
    res.status(500).json({ error: 'Failed to save field mappings' });
  }
});

onboardingRouter.post('/complete', async (req, res) => {
  try {
    const { customerId, userEmail } = req.body;

    if (!customerId) {
      return res.status(400).json({ error: 'customerId is required' });
    }

    await supabase
      .from('customer_onboarding_status')
      .update({
        is_complete: true,
        current_step: 'complete',
        onboarding_completed_at: new Date().toISOString()
      })
      .eq('customer_id', customerId);

    await logCustomerActivity(
      customerId,
      userEmail || 'system',
      'onboarding_completed',
      'Customer completed onboarding successfully'
    );

    res.json({
      success: true,
      message: 'Onboarding completed successfully'
    });
  } catch (error) {
    console.error('Error completing onboarding:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

onboardingRouter.post('/request-assistance', async (req, res) => {
  try {
    const { customerId, userEmail, requestType, subject, message, currentStep } = req.body;

    if (!customerId || !userEmail || !message) {
      return res.status(400).json({ error: 'customerId, userEmail, and message are required' });
    }

    const { data: supportRequest, error } = await supabase
      .from('support_requests')
      .insert({
        customer_id: customerId,
        customer_email: userEmail,
        request_type: requestType || 'general_help',
        subject: subject || 'Onboarding Assistance Needed',
        message,
        current_step: currentStep,
        status: 'open',
        priority: 'medium'
      })
      .select()
      .single();

    if (error) throw error;

    await supabase
      .from('customer_onboarding_status')
      .update({ requires_assistance: true })
      .eq('customer_id', customerId);

    await logCustomerActivity(
      customerId,
      userEmail,
      'assistance_requested',
      `Support request created: ${subject}`
    );

    res.json({
      success: true,
      message: 'Support request submitted successfully',
      supportRequest
    });
  } catch (error) {
    console.error('Error creating support request:', error);
    res.status(500).json({ error: 'Failed to create support request' });
  }
});
