export class BaseDataAdapter {
  constructor(config) {
    this.config = config;
    this.connected = false;
  }

  async connect() {
    throw new Error('connect() must be implemented by subclass');
  }

  async disconnect() {
    this.connected = false;
  }

  async testConnection() {
    throw new Error('testConnection() must be implemented by subclass');
  }

  async fetchRecords(options = {}) {
    throw new Error('fetchRecords() must be implemented by subclass');
  }

  async getRecord(id) {
    throw new Error('getRecord() must be implemented by subclass');
  }

  async createRecord(data) {
    throw new Error('createRecord() must be implemented by subclass');
  }

  async updateRecord(id, data) {
    throw new Error('updateRecord() must be implemented by subclass');
  }

  async deleteRecord(id) {
    throw new Error('deleteRecord() must be implemented by subclass');
  }

  async getSchema() {
    throw new Error('getSchema() must be implemented by subclass');
  }

  async getTableList() {
    throw new Error('getTableList() must be implemented by subclass');
  }

  toGeoJSON(records) {
    throw new Error('toGeoJSON() must be implemented by subclass');
  }

  fromGeoJSON(feature) {
    throw new Error('fromGeoJSON() must be implemented by subclass');
  }

  normalizeGeometry(geometry) {
    throw new Error('normalizeGeometry() must be implemented by subclass');
  }

  getDataSourceType() {
    throw new Error('getDataSourceType() must be implemented by subclass');
  }
}
