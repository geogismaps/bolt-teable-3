import { BaseDataAdapter } from './BaseDataAdapter.js';
import { GeometryParser } from '../utils/geometry.js';
import { google } from 'googleapis';

export class GoogleSheetsAdapter extends BaseDataAdapter {
  constructor(config) {
    super(config);
    this.spreadsheetId = config.spreadsheet_id;
    this.sheetName = config.sheet_name;
    this.accessToken = config.oauth_access_token;
    this.refreshToken = config.oauth_refresh_token;
    this.fieldMappings = config.field_mappings || {};
    this.oauth2Client = null;
    this.sheets = null;
    this.cachedHeaders = null;
    this.cachedData = null;
    this.cacheTimestamp = null;
    this.cacheDuration = 30000;
  }

  async connect() {
    try {
      this.oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );

      this.oauth2Client.setCredentials({
        access_token: this.accessToken,
        refresh_token: this.refreshToken
      });

      this.oauth2Client.on('tokens', (tokens) => {
        if (tokens.access_token) {
          this.accessToken = tokens.access_token;
        }
      });

      this.sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });

      const result = await this.testConnection();
      if (result.success) {
        this.connected = true;
        return true;
      }

      throw new Error(result.error || 'Failed to connect to Google Sheets');
    } catch (error) {
      throw new Error(`Google Sheets connection failed: ${error.message}`);
    }
  }

  async testConnection() {
    try {
      const response = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId
      });

      return { success: true, spreadsheet: response.data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async fetchRecords(options = {}) {
    await this.ensureConnected();

    const { limit = 1000, offset = 0 } = options;

    const headers = await this.getHeaders();
    const data = await this.getData();

    const startRow = offset;
    const endRow = Math.min(startRow + limit, data.length);
    const records = data.slice(startRow, endRow);

    const geojson = this.toGeoJSON(records, headers);

    geojson.metadata = {
      total: data.length,
      limit,
      offset,
      hasMore: endRow < data.length
    };

    return geojson;
  }

  async getRecord(id) {
    await this.ensureConnected();

    const headers = await this.getHeaders();
    const data = await this.getData();

    const idColumn = this.fieldMappings.id_column || headers[0];
    const idIndex = headers.indexOf(idColumn);

    if (idIndex === -1) {
      throw new Error(`ID column "${idColumn}" not found`);
    }

    const record = data.find(row => row[idIndex] === id);
    if (!record) {
      return null;
    }

    const geojson = this.toGeoJSON([record], headers);
    return geojson.features[0] || null;
  }

  async createRecord(data) {
    await this.ensureConnected();

    const headers = await this.getHeaders();
    const row = this.fromGeoJSON(data, headers);

    const range = `${this.sheetName}!A:${this.columnToLetter(headers.length)}`;

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [row]
      }
    });

    this.invalidateCache();

    const newData = await this.getData();
    const newRecord = newData[newData.length - 1];
    const geojson = this.toGeoJSON([newRecord], headers);

    return geojson.features[0];
  }

  async updateRecord(id, data) {
    await this.ensureConnected();

    const headers = await this.getHeaders();
    const allData = await this.getData();

    const idColumn = this.fieldMappings.id_column || headers[0];
    const idIndex = headers.indexOf(idColumn);

    if (idIndex === -1) {
      throw new Error(`ID column "${idColumn}" not found`);
    }

    const rowIndex = allData.findIndex(row => row[idIndex] === id);
    if (rowIndex === -1) {
      throw new Error(`Record with ID "${id}" not found`);
    }

    const updatedRow = this.fromGeoJSON(data, headers, allData[rowIndex]);

    const sheetRowNumber = rowIndex + 2;
    const range = `${this.sheetName}!A${sheetRowNumber}:${this.columnToLetter(headers.length)}${sheetRowNumber}`;

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [updatedRow]
      }
    });

    this.invalidateCache();

    const geojson = this.toGeoJSON([updatedRow], headers);
    return geojson.features[0];
  }

  async deleteRecord(id) {
    await this.ensureConnected();

    const headers = await this.getHeaders();
    const allData = await this.getData();

    const idColumn = this.fieldMappings.id_column || headers[0];
    const idIndex = headers.indexOf(idColumn);

    if (idIndex === -1) {
      throw new Error(`ID column "${idColumn}" not found`);
    }

    const rowIndex = allData.findIndex(row => row[idIndex] === id);
    if (rowIndex === -1) {
      throw new Error(`Record with ID "${id}" not found`);
    }

    const sheetId = await this.getSheetId();
    const sheetRowNumber = rowIndex + 1;

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: 'ROWS',
              startIndex: sheetRowNumber,
              endIndex: sheetRowNumber + 1
            }
          }
        }]
      }
    });

    this.invalidateCache();

    return { success: true, id };
  }

  async getSchema() {
    await this.ensureConnected();

    const headers = await this.getHeaders();
    const data = await this.getData();

    const schema = headers.map((header, index) => {
      const sampleValues = data.slice(0, 10).map(row => row[index]).filter(v => v != null && v !== '');
      const type = this.inferColumnType(sampleValues);

      return {
        name: header,
        type: type,
        index: index
      };
    });

    return schema;
  }

  async getTableList() {
    await this.ensureConnected();

    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId
    });

    return response.data.sheets.map(sheet => ({
      id: sheet.properties.sheetId,
      name: sheet.properties.title,
      rowCount: sheet.properties.gridProperties.rowCount,
      columnCount: sheet.properties.gridProperties.columnCount
    }));
  }

  toGeoJSON(records, headers) {
    const geometryColumn = this.fieldMappings.geometry_column;
    const latColumn = this.fieldMappings.latitude_column;
    const lngColumn = this.fieldMappings.longitude_column;
    const idColumn = this.fieldMappings.id_column || headers[0];

    const features = records.map((row, rowIndex) => {
      const properties = {};
      let id = null;
      let geometry = null;

      headers.forEach((header, index) => {
        const value = row[index];

        if (header === idColumn) {
          id = value;
        }

        if (header === geometryColumn && value) {
          geometry = this.normalizeGeometry(value);
        } else if (!geometry && latColumn && lngColumn && (header === latColumn || header === lngColumn)) {
          if (header === latColumn || header === lngColumn) {
            const lat = row[headers.indexOf(latColumn)];
            const lng = row[headers.indexOf(lngColumn)];
            if (lat && lng) {
              geometry = GeometryParser.parseLatLng(lat, lng);
            }
          }
        } else {
          properties[header] = value;
        }
      });

      return {
        type: 'Feature',
        id: id || `row-${rowIndex}`,
        geometry: geometry,
        properties: properties
      };
    });

    return {
      type: 'FeatureCollection',
      features: features
    };
  }

  fromGeoJSON(feature, headers, existingRow = null) {
    const row = existingRow ? [...existingRow] : new Array(headers.length).fill('');

    const geometryColumn = this.fieldMappings.geometry_column;
    const latColumn = this.fieldMappings.latitude_column;
    const lngColumn = this.fieldMappings.longitude_column;

    if (feature.geometry) {
      if (geometryColumn) {
        const geomIndex = headers.indexOf(geometryColumn);
        if (geomIndex !== -1) {
          const wkt = GeometryParser.toWKT(feature.geometry);
          row[geomIndex] = wkt || '';
        }
      } else if (latColumn && lngColumn && feature.geometry.type === 'Point') {
        const latIndex = headers.indexOf(latColumn);
        const lngIndex = headers.indexOf(lngColumn);
        if (latIndex !== -1 && lngIndex !== -1) {
          row[lngIndex] = feature.geometry.coordinates[0];
          row[latIndex] = feature.geometry.coordinates[1];
        }
      }
    }

    Object.entries(feature.properties || {}).forEach(([key, value]) => {
      const index = headers.indexOf(key);
      if (index !== -1) {
        row[index] = value != null ? String(value) : '';
      }
    });

    return row;
  }

  normalizeGeometry(value) {
    return GeometryParser.autoDetectGeometry(value);
  }

  async getHeaders() {
    if (this.cachedHeaders && this.isCacheValid()) {
      return this.cachedHeaders;
    }

    const range = `${this.sheetName}!1:1`;
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: range
    });

    this.cachedHeaders = response.data.values ? response.data.values[0] : [];
    return this.cachedHeaders;
  }

  async getData() {
    if (this.cachedData && this.isCacheValid()) {
      return this.cachedData;
    }

    const range = `${this.sheetName}!2:10000`;
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: range
    });

    this.cachedData = response.data.values || [];
    this.cacheTimestamp = Date.now();
    return this.cachedData;
  }

  async getSheetId() {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId
    });

    const sheet = response.data.sheets.find(s => s.properties.title === this.sheetName);
    return sheet ? sheet.properties.sheetId : 0;
  }

  isCacheValid() {
    return this.cacheTimestamp && (Date.now() - this.cacheTimestamp) < this.cacheDuration;
  }

  invalidateCache() {
    this.cachedData = null;
    this.cacheTimestamp = null;
  }

  columnToLetter(column) {
    let temp;
    let letter = '';
    while (column > 0) {
      temp = (column - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      column = (column - temp - 1) / 26;
    }
    return letter;
  }

  inferColumnType(samples) {
    if (samples.length === 0) return 'text';

    const allNumbers = samples.every(v => !isNaN(parseFloat(v)));
    if (allNumbers) return 'number';

    const allDates = samples.every(v => !isNaN(Date.parse(v)));
    if (allDates) return 'date';

    return 'text';
  }

  async ensureConnected() {
    if (!this.connected) {
      await this.connect();
    }
  }

  getDataSourceType() {
    return 'google_sheets';
  }
}
