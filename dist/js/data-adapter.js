/**
 * Unified Data Adapter for Frontend
 * Provides a consistent interface for both Teable and Google Sheets data sources
 */

class DataAdapter {
  constructor(customerId, dataSource) {
    this.customerId = customerId;
    this.dataSource = dataSource;
    this.apiBase = window.location.origin;
  }

  async getTables() {
    const response = await fetch(`${this.apiBase}/api/data/${this.customerId}/tables`, {
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tables: ${response.statusText}`);
    }

    const data = await response.json();
    return data.tables || [];
  }

  async getTableFields(tableId) {
    const response = await fetch(
      `${this.apiBase}/api/data/${this.customerId}/tables/${tableId}/fields`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch table fields: ${response.statusText}`);
    }

    const data = await response.json();
    return data.fields || [];
  }

  async getRecords(tableId, options = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit);
    if (options.offset) params.append('offset', options.offset);
    if (options.filter) params.append('filter', JSON.stringify(options.filter));
    if (options.sort) params.append('sort', options.sort);

    const queryString = params.toString();
    const url = `${this.apiBase}/api/data/${this.customerId}/tables/${tableId}/records${
      queryString ? '?' + queryString : ''
    }`;

    const response = await fetch(url, {
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch records: ${response.statusText}`);
    }

    const data = await response.json();
    return data.records || [];
  }

  async createRecord(tableId, fields) {
    const response = await fetch(
      `${this.apiBase}/api/data/${this.customerId}/tables/${tableId}/records`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ fields })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create record: ${error}`);
    }

    return await response.json();
  }

  async updateRecord(tableId, recordId, fields) {
    const response = await fetch(
      `${this.apiBase}/api/data/${this.customerId}/tables/${tableId}/records/${recordId}`,
      {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({ fields })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to update record: ${error}`);
    }

    return await response.json();
  }

  async deleteRecord(tableId, recordId) {
    const response = await fetch(
      `${this.apiBase}/api/data/${this.customerId}/tables/${tableId}/records/${recordId}`,
      {
        method: 'DELETE',
        headers: this.getHeaders()
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete record: ${error}`);
    }

    return await response.json();
  }

  async getMapData(tableId, locationField) {
    const response = await fetch(
      `${this.apiBase}/api/data/${this.customerId}/tables/${tableId}/map-data?locationField=${locationField}`,
      { headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch map data: ${response.statusText}`);
    }

    return await response.json();
  }

  getHeaders() {
    const session = this.getSession();
    return {
      'Content-Type': 'application/json',
      'X-Customer-ID': this.customerId,
      'X-Session-Token': session?.token || ''
    };
  }

  getSession() {
    const sessionStr = localStorage.getItem('customer_session');
    return sessionStr ? JSON.parse(sessionStr) : null;
  }

  getDataSourceName() {
    return this.dataSource === 'teable' ? 'Teable' : 'Google Sheets';
  }

  getDataSourceIcon() {
    return this.dataSource === 'teable'
      ? '<i class="fas fa-database"></i>'
      : '<i class="fab fa-google"></i>';
  }
}

class DataAdapterFactory {
  static async createAdapter() {
    const session = this.getSession();
    if (!session) {
      throw new Error('No active session found');
    }

    const customerId = session.customerId;
    if (!customerId) {
      throw new Error('No customer ID in session');
    }

    const dataSource = await this.getDataSource(customerId);

    return new DataAdapter(customerId, dataSource);
  }

  static async getDataSource(customerId) {
    const response = await fetch(`${window.location.origin}/api/customers/${customerId}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': this.getSession()?.token || ''
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch customer data source');
    }

    const data = await response.json();
    return data.customer?.data_source || 'teable';
  }

  static getSession() {
    const sessionStr = localStorage.getItem('customer_session');
    return sessionStr ? JSON.parse(sessionStr) : null;
  }
}

window.DataAdapter = DataAdapter;
window.DataAdapterFactory = DataAdapterFactory;
