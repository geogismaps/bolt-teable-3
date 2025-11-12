import { TeableAdapter } from './TeableAdapter.js';
import { GoogleSheetsAdapter } from './GoogleSheetsAdapter.js';
import { supabase } from '../config/supabase.js';
import { getEncryptionService } from '../utils/encryption.js';

const adapterCache = new Map();

export class AdapterFactory {
  static async getAdapter(customerId, tableId = null) {
    const cacheKey = `${customerId}-${tableId || 'default'}`;

    if (adapterCache.has(cacheKey)) {
      return adapterCache.get(cacheKey);
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, data_source')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      throw new Error(`Customer not found: ${customerId}`);
    }

    let adapter;

    if (customer.data_source === 'teable') {
      adapter = await this.createTeableAdapter(customerId, tableId);
    } else if (customer.data_source === 'google_sheets') {
      adapter = await this.createGoogleSheetsAdapter(customerId);
    } else {
      throw new Error(`Unsupported data source type: ${customer.data_source}`);
    }

    await adapter.connect();

    adapterCache.set(cacheKey, adapter);

    return adapter;
  }

  static async createTeableAdapter(customerId, tableId) {
    const { data: config, error } = await supabase
      .from('customer_teable_config')
      .select('*')
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .single();

    if (error || !config) {
      throw new Error('Teable configuration not found for customer');
    }

    const adapterConfig = {
      base_url: config.base_url,
      space_id: config.space_id,
      base_id: config.base_id,
      access_token: config.access_token,
      table_id: tableId
    };

    return new TeableAdapter(adapterConfig);
  }

  static async createGoogleSheetsAdapter(customerId) {
    const { data: config, error } = await supabase
      .from('customer_google_sheets_config')
      .select('*')
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .single();

    if (error || !config) {
      throw new Error('Google Sheets configuration not found for customer');
    }

    const encryptionService = getEncryptionService();

    const adapterConfig = {
      spreadsheet_id: config.spreadsheet_id,
      sheet_name: config.sheet_name,
      oauth_access_token: encryptionService.decrypt(config.oauth_access_token),
      oauth_refresh_token: encryptionService.decrypt(config.oauth_refresh_token),
      field_mappings: config.field_mappings || {}
    };

    return new GoogleSheetsAdapter(adapterConfig);
  }

  static clearCache(customerId = null) {
    if (customerId) {
      for (const key of adapterCache.keys()) {
        if (key.startsWith(customerId)) {
          adapterCache.delete(key);
        }
      }
    } else {
      adapterCache.clear();
    }
  }

  static async getDataSourceType(customerId) {
    const { data: customer, error } = await supabase
      .from('customers')
      .select('data_source')
      .eq('id', customerId)
      .single();

    if (error || !customer) {
      throw new Error(`Customer not found: ${customerId}`);
    }

    return customer.data_source;
  }
}
