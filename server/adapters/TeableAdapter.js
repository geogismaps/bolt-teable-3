import { BaseDataAdapter } from './BaseDataAdapter.js';
import { GeometryParser } from '../utils/geometry.js';

export class TeableAdapter extends BaseDataAdapter {
  constructor(config) {
    super(config);
    this.baseUrl = config.base_url?.replace(/\/$/, '');
    this.spaceId = config.space_id;
    this.baseId = config.base_id;
    this.accessToken = config.access_token;
    this.tableId = config.table_id || null;
  }

  async connect() {
    const result = await this.testConnection();
    if (result.success) {
      this.connected = true;
      return true;
    }
    throw new Error(result.error || 'Failed to connect to Teable');
  }

  async testConnection() {
    try {
      const testEndpoints = [
        `/api/base/${this.baseId}/table`,
        `/api/base/${this.baseId}`,
        `/api/space/${this.spaceId}/base`,
        `/api/space/${this.spaceId}`
      ];

      for (const endpoint of testEndpoints) {
        try {
          await this.request(endpoint);
          return { success: true, endpoint };
        } catch (error) {
          continue;
        }
      }

      throw new Error('All test endpoints failed');
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async request(endpoint, options = {}) {
    if (!this.baseUrl || !this.accessToken) {
      throw new Error('Teable API not properly configured');
    }

    const url = `${this.baseUrl}${endpoint}`;
    const requestOptions = {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    const response = await fetch(url, requestOptions);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Teable API Error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  async fetchRecords(options = {}) {
    if (!this.tableId) {
      throw new Error('Table ID not set for Teable adapter');
    }

    let endpoint = `/api/table/${this.tableId}/record`;
    const params = new URLSearchParams();

    if (options.limit) params.append('limit', options.limit);
    if (options.offset) params.append('offset', options.offset);
    if (options.sort) params.append('sort', options.sort);
    if (options.filter) params.append('filter', JSON.stringify(options.filter));

    if (params.toString()) {
      endpoint += `?${params.toString()}`;
    }

    const result = await this.request(endpoint);
    return this.toGeoJSON(result.records || []);
  }

  async getRecord(id) {
    if (!this.tableId) {
      throw new Error('Table ID not set for Teable adapter');
    }

    const result = await this.request(`/api/table/${this.tableId}/record/${id}`);
    const features = this.toGeoJSON([result]);
    return features.features[0] || null;
  }

  async createRecord(data) {
    if (!this.tableId) {
      throw new Error('Table ID not set for Teable adapter');
    }

    const fields = this.fromGeoJSON(data);
    const requestBody = {
      records: [{ fields }]
    };

    const result = await this.request(`/api/table/${this.tableId}/record`, {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });

    if (result.records && result.records.length > 0) {
      const features = this.toGeoJSON([result.records[0]]);
      return features.features[0];
    }

    return null;
  }

  async updateRecord(id, data) {
    if (!this.tableId) {
      throw new Error('Table ID not set for Teable adapter');
    }

    const fields = this.fromGeoJSON(data);
    const requestBody = {
      record: { fields }
    };

    try {
      const result = await this.request(`/api/table/${this.tableId}/record/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(requestBody)
      });

      const features = this.toGeoJSON([result]);
      return features.features[0];
    } catch (error) {
      const alternativeBody = {
        records: [{ id, fields }]
      };

      const result = await this.request(`/api/table/${this.tableId}/record`, {
        method: 'PATCH',
        body: JSON.stringify(alternativeBody)
      });

      const features = this.toGeoJSON(result.records || [result]);
      return features.features[0];
    }
  }

  async deleteRecord(id) {
    if (!this.tableId) {
      throw new Error('Table ID not set for Teable adapter');
    }

    await this.request(`/api/table/${this.tableId}/record/${id}`, {
      method: 'DELETE'
    });

    return { success: true, id };
  }

  async getSchema() {
    if (!this.tableId) {
      const tables = await this.getTableList();
      if (tables.length > 0) {
        this.tableId = tables[0].id;
      } else {
        throw new Error('No tables found in Teable base');
      }
    }

    const response = await this.request(`/api/table/${this.tableId}/field`);
    return response.fields || response || [];
  }

  async getTableList() {
    const response = await this.request(`/api/base/${this.baseId}/table`);
    return response.tables || response || [];
  }

  toGeoJSON(records) {
    const features = records.map(record => {
      const properties = { ...record.fields };
      let geometry = null;

      const geometryField = this.findGeometryField(properties);
      if (geometryField) {
        const geomValue = properties[geometryField];
        geometry = this.normalizeGeometry(geomValue);
        delete properties[geometryField];
      }

      return {
        type: 'Feature',
        id: record.id,
        geometry: geometry,
        properties: properties
      };
    });

    return {
      type: 'FeatureCollection',
      features: features
    };
  }

  fromGeoJSON(feature) {
    const fields = { ...feature.properties };

    if (feature.geometry) {
      const wkt = GeometryParser.toWKT(feature.geometry);
      if (wkt) {
        fields.geometry = wkt;
      }
    }

    return fields;
  }

  normalizeGeometry(value) {
    if (!value) return null;

    if (typeof value === 'string') {
      return GeometryParser.parseWKT(value) || GeometryParser.parseGeoJSON(value);
    }

    if (typeof value === 'object' && value.type) {
      return value;
    }

    return null;
  }

  findGeometryField(properties) {
    const geometryFieldNames = ['geometry', 'geom', 'shape', 'wkt', 'the_geom'];

    for (const fieldName of geometryFieldNames) {
      if (properties.hasOwnProperty(fieldName)) {
        return fieldName;
      }
    }

    for (const key in properties) {
      const value = properties[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.startsWith('POINT') ||
            trimmed.startsWith('LINESTRING') ||
            trimmed.startsWith('POLYGON') ||
            trimmed.startsWith('MULTI')) {
          return key;
        }
      }
    }

    return null;
  }

  getDataSourceType() {
    return 'teable';
  }
}
