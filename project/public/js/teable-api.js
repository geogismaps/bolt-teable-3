
/**
 * Teable API Client
 * Handles communication with Teable.io API
 */

class TeableAPI {
    constructor(config) {
        this.baseUrl = config.baseUrl;
        this.spaceId = config.spaceId;
        this.baseId = config.baseId;
        this.accessToken = config.accessToken;
        
        // Ensure baseUrl ends without trailing slash
        if (this.baseUrl.endsWith('/')) {
            this.baseUrl = this.baseUrl.slice(0, -1);
        }
    }

    async makeRequest(endpoint, options = {}) {
        const url = `${this.baseUrl}/api${endpoint}`;
        
        const defaultOptions = {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json',
            },
            ...options
        };

        try {
            console.log('Making request to:', url);
            const response = await fetch(url, defaultOptions);
            
            if (!response.ok) {
                let errorText = '';
                try {
                    const errorData = await response.json();
                    errorText = errorData.message || JSON.stringify(errorData);
                } catch {
                    errorText = await response.text();
                }
                
                const errorMessage = `HTTP ${response.status}: ${errorText || response.statusText}`;
                console.error('API Error Details:', {
                    url,
                    status: response.status,
                    statusText: response.statusText,
                    errorText,
                    headers: Object.fromEntries(response.headers.entries())
                });
                
                throw new Error(errorMessage);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('API Request failed:', error);
            throw error;
        }
    }

    async getBase() {
        try {
            const response = await this.makeRequest(`/base/${this.baseId}`);
            return response;
        } catch (error) {
            throw new Error(`Failed to get base: ${error.message}`);
        }
    }

    async getTables() {
        try {
            const response = await this.makeRequest(`/base/${this.baseId}/table`);
            return response.tables || response;
        } catch (error) {
            throw new Error(`Failed to get tables: ${error.message}`);
        }
    }

    async getTable(tableIdOrName) {
        try {
            const response = await this.makeRequest(`/base/${this.baseId}/table/${tableIdOrName}`);
            return response;
        } catch (error) {
            throw new Error(`Failed to get table: ${error.message}`);
        }
    }

    async getRecords(tableIdOrName, query = {}) {
        try {
            const queryString = new URLSearchParams(query).toString();
            const endpoint = `/base/${this.baseId}/table/${tableIdOrName}/record${queryString ? `?${queryString}` : ''}`;
            const response = await this.makeRequest(endpoint);
            return response;
        } catch (error) {
            throw new Error(`Failed to get records: ${error.message}`);
        }
    }

    async createRecord(tableIdOrName, recordData) {
        try {
            const response = await this.makeRequest(`/base/${this.baseId}/table/${tableIdOrName}/record`, {
                method: 'POST',
                body: JSON.stringify({ fields: recordData })
            });
            return response;
        } catch (error) {
            throw new Error(`Failed to create record: ${error.message}`);
        }
    }

    async updateRecord(tableIdOrName, recordId, recordData) {
        try {
            const response = await this.makeRequest(`/base/${this.baseId}/table/${tableIdOrName}/record/${recordId}`, {
                method: 'PATCH',
                body: JSON.stringify({ fields: recordData })
            });
            return response;
        } catch (error) {
            throw new Error(`Failed to update record: ${error.message}`);
        }
    }

    async deleteRecord(tableIdOrName, recordId) {
        try {
            const response = await this.makeRequest(`/base/${this.baseId}/table/${tableIdOrName}/record/${recordId}`, {
                method: 'DELETE'
            });
            return response;
        } catch (error) {
            throw new Error(`Failed to delete record: ${error.message}`);
        }
    }

    async createBase(baseName, spaceId = null) {
        try {
            const targetSpaceId = spaceId || this.spaceId;
            const response = await this.makeRequest('/base', {
                method: 'POST',
                body: JSON.stringify({
                    name: baseName,
                    spaceId: targetSpaceId
                })
            });
            return response;
        } catch (error) {
            throw new Error(`Failed to create base: ${error.message}`);
        }
    }

    async getSpaces() {
        try {
            const response = await this.makeRequest('/space');
            return response;
        } catch (error) {
            throw new Error(`Failed to get spaces: ${error.message}`);
        }
    }

    async getSpace(spaceId = null) {
        try {
            const targetSpaceId = spaceId || this.spaceId;
            const response = await this.makeRequest(`/space/${targetSpaceId}`);
            return response;
        } catch (error) {
            throw new Error(`Failed to get space: ${error.message}`);
        }
    }
}

// Make TeableAPI globally available
window.TeableAPI = TeableAPI;
