/**
 * Teable.io API Integration Module
 * Handles all API communication with Teable instances
 */

class TeableAPI {
    constructor() {
        this.config = {
            baseUrl: null,
            spaceId: null,
            baseId: null,
            accessToken: null
        };
        this.systemTables = {};
    }

    /**
     * Initialize API configuration
     */
    init(config) {
        this.config = { ...this.config, ...config };
        this.config.baseUrl = this.config.baseUrl?.replace(/\/$/, ''); // Remove trailing slash
        console.log('Teable API initialized:', this.config);
    }

    /**
     * Make authenticated API request
     */
    async request(endpoint, options = {}) {
        if (!this.config.baseUrl || !this.config.accessToken) {
            throw new Error('API not properly configured. Please check your Base URL and API Token.');
        }

        const url = `${this.config.baseUrl}${endpoint}`;

        const requestOptions = {
            headers: {
                'Authorization': `Bearer ${this.config.accessToken}`,
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };

        console.log('API Request:', url, requestOptions);

        try {
            const response = await fetch(url, requestOptions);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            console.log('API Response:', data);
            return data;
        } catch (error) {
            console.error('API Request failed:', error);
            throw error;
        }
    }

    /**
     * Test API connection
     */
    async testConnection() {
        try {
            // Test multiple endpoints to find working one
            const testEndpoints = [
                `/api/table/${this.config.baseId}`, // Try base as table ID first
                `/api/base/${this.config.baseId}/table`,
                `/api/base/${this.config.baseId}`,
                `/api/space/${this.config.spaceId}`,
                `/api/space`
            ];

            for (const endpoint of testEndpoints) {
                try {
                    console.log(`Testing endpoint: ${endpoint}`);
                    await this.request(endpoint);
                    console.log(`✅ Success: ${endpoint}`);
                    return { success: true, endpoint };
                } catch (error) {
                    console.log(`❌ Failed: ${endpoint} - ${error.message}`);
                }
            }

            throw new Error('All test endpoints failed. Please check your credentials and Base ID.');
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all tables in base
     */
    async getTables() {
        return await this.request(`/api/base/${this.config.baseId}/table`);
    }

    /**
     * Get table schema/fields
     */
    async getTableFields(tableId) {
        try {
            const response = await this.request(`/api/table/${tableId}/field`);
            return response.fields || response || [];
        } catch (error) {
            console.error(`Error getting table fields for ${tableId}:`, error);
            throw error;
        }
    }

    /**
     * Create new field in table
     */
    async createField(tableId, fieldSchema) {
        try {
            console.log(`Creating field in table ${tableId}:`, fieldSchema);
            const response = await this.request(`/api/table/${tableId}/field`, {
                method: 'POST',
                body: JSON.stringify(fieldSchema)
            });
            console.log(`✅ Field created successfully:`, response);
            return response;
        } catch (error) {
            console.error(`❌ Error creating field in table ${tableId}:`, error);
            throw error;
        }
    }

    /**
     * Get table records
     */
    async getRecords(tableId, options = {}) {
        let endpoint = `/api/table/${tableId}/record`;

        // Add query parameters
        const params = new URLSearchParams();
        if (options.limit) params.append('limit', options.limit);
        if (options.offset) params.append('offset', options.offset);
        if (options.sort) params.append('sort', options.sort);
        if (options.filter) params.append('filter', JSON.stringify(options.filter));

        if (params.toString()) {
            endpoint += `?${params.toString()}`;
        }

        return await this.request(endpoint);
    }

    /**
     * Create new record - Using correct Teable.io API format
     */
    async createRecord(tableId, fields) {
        console.log('Creating record with fields:', fields);

        // Use the exact Teable.io API format: POST /api/table/{tableId}/record
        // Body should contain the record fields directly
        const requestBody = {
            records: [
                {
                    fields: fields
                }
            ]
        };

        console.log('Create request body:', JSON.stringify(requestBody, null, 2));

        try {
            const result = await this.request(`/api/table/${tableId}/record`, {
                method: 'POST',
                body: JSON.stringify(requestBody)
            });

            console.log('✅ Create record succeeded:', result);

            // Log the data change
            await this.logDataChange(tableId, result.records?.[0]?.id, 'create', null, fields);

            // Return the first record from the response
            if (result.records && result.records.length > 0) {
                return result.records[0];
            }

            return result;

        } catch (error) {
            console.error('❌ Create record failed:', error);
            throw error;
        }
    }

    /**
     * Update record - Using correct Teable.io API format
     */
    async updateRecord(tableId, recordId, fields) {
        console.log('Updating record:', recordId, 'with fields:', fields);

        // Get old values first for logging
        let oldValues = {};
        try {
            const existingRecord = await this.getRecords(tableId, { filter: { id: recordId }, limit: 1 });
            if (existingRecord.records && existingRecord.records.length > 0) {
                oldValues = existingRecord.records[0].fields;
            }
        } catch (error) {
            console.log('Could not fetch old values for logging:', error.message);
        }

        // For updates, use the record format with both records array and individual record endpoint
        const requestBody = {
            record: {
                fields: fields
            }
        };

        console.log('Update request body:', JSON.stringify(requestBody, null, 2));

        try {
            // Use PATCH method on individual record endpoint
            const result = await this.request(`/api/table/${tableId}/record/${recordId}`, {
                method: 'PATCH',
                body: JSON.stringify(requestBody)
            });

            console.log('✅ Update record succeeded:', result);

            // Log the data change
            await this.logDataChange(tableId, recordId, 'update', oldValues, fields);

            return result;

        } catch (error) {
            console.error('❌ Update record failed with PATCH, trying alternative format:', error);

            // Try alternative format with records array
            try {
                const alternativeBody = {
                    records: [
                        {
                            id: recordId,
                            fields: fields
                        }
                    ]
                };

                const result = await this.request(`/api/table/${tableId}/record`, {
                    method: 'PATCH',
                    body: JSON.stringify(alternativeBody)
                });

                console.log('✅ Update record succeeded with alternative format:', result);

                // Log the data change
                await this.logDataChange(tableId, recordId, 'update', oldValues, fields);

                return result.records ? result.records[0] : result;

            } catch (altError) {
                console.error('❌ Update record failed with alternative format too:', altError);
                throw altError;
            }
        }
    }

    /**
     * Delete record
     */
    async deleteRecord(tableId, recordId) {
        // Get old values first for logging
        let oldValues = {};
        try {
            const existingRecord = await this.getRecords(tableId, { filter: { id: recordId }, limit: 1 });
            if (existingRecord.records && existingRecord.records.length > 0) {
                oldValues = existingRecord.records[0].fields;
            }
        } catch (error) {
            console.log('Could not fetch old values for logging:', error.message);
        }

        const result = await this.request(`/api/table/${tableId}/record/${recordId}`, {
            method: 'DELETE'
        });

        // Log the data change
        await this.logDataChange(tableId, recordId, 'delete', oldValues, null);

        return result;
    }

    /**
     * Log data changes for audit trail
     */
    async logDataChange(tableId, recordId, actionType, oldValues, newValues) {
        try {
            // Skip logging for system tables to avoid infinite loops
            if (!this.systemTables.dataLogs || tableId === this.systemTables.dataLogs) {
                return;
            }

            const session = window.teableAuth?.getCurrentSession();
            if (!session) return;

            // Get table name
            let tableName = 'Unknown';
            try {
                const tables = await this.getTables();
                const table = (tables.tables || tables || []).find(t => t.id === tableId);
                tableName = table?.name || tableName;
            } catch (error) {
                console.log('Could not get table name for logging:', error.message);
            }

            const timestamp = new Date().toISOString();
            const changedAt = timestamp.split('T')[0];

            // Create log entries for each field change
            const logEntries = [];

            if (actionType === 'create' && newValues) {
                // Log all new fields
                Object.keys(newValues).forEach(fieldName => {
                    logEntries.push({
                        record_id: recordId,
                        table_id: tableId,
                        table_name: tableName,
                        action_type: actionType,
                        field_name: fieldName,
                        old_value: null,
                        new_value: String(newValues[fieldName] || ''),
                        changed_by: session.email,
                        changed_at: changedAt,
                        timestamp: timestamp,
                        user_role: session.role,
                        ip_address: 'unknown', // Could be enhanced with real IP detection
                        session_id: session.loginTime || 'unknown'
                    });
                });
            } else if (actionType === 'delete' && oldValues) {
                // Log all deleted fields
                Object.keys(oldValues).forEach(fieldName => {
                    logEntries.push({
                        record_id: recordId,
                        table_id: tableId,
                        table_name: tableName,
                        action_type: actionType,
                        field_name: fieldName,
                        old_value: String(oldValues[fieldName] || ''),
                        new_value: null,
                        changed_by: session.email,
                        changed_at: changedAt,
                        timestamp: timestamp,
                        user_role: session.role,
                        ip_address: 'unknown',
                        session_id: session.loginTime || 'unknown'
                    });
                });
            } else if (actionType === 'update' && oldValues && newValues) {
                // Log only changed fields
                Object.keys(newValues).forEach(fieldName => {
                    const oldValue = oldValues[fieldName];
                    const newValue = newValues[fieldName];

                    // Only log if value actually changed
                    if (String(oldValue) !== String(newValue)) {
                        logEntries.push({
                            record_id: recordId,
                            table_id: tableId,
                            table_name: tableName,
                            action_type: actionType,
                            field_name: fieldName,
                            old_value: String(oldValue || ''),
                            new_value: String(newValue || ''),
                            changed_by: session.email,
                            changed_at: changedAt,
                            timestamp: timestamp,
                            user_role: session.role,
                            ip_address: 'unknown',
                            session_id: session.loginTime || 'unknown'
                        });
                    }
                });
            }

            // Create log entries in batch
            for (const logEntry of logEntries) {
                try {
                    await this.createRecord(this.systemTables.dataLogs, logEntry);
                } catch (logError) {
                    console.error('Failed to create data log entry:', logError);
                }
            }

            console.log(`Logged ${logEntries.length} field changes for ${actionType} action`);

        } catch (error) {
            console.error('Error logging data change:', error);
            // Don't throw error to avoid breaking the main operation
        }
    }

    /**
     * Create new table
     */
    async createTable(tableSchema) {
        return await this.request(`/api/base/${this.config.baseId}/table`, {
            method: 'POST',
            body: JSON.stringify(tableSchema)
        });
    }

    /**
     * Get space information
     */
    async getSpace() {
        try {
            return await this.request(`/api/space/${this.config.spaceId}`);
        } catch (error) {
            console.log('Failed to get space info:', error.message);
            // Return minimal space info if we can't access it
            return {
                id: this.config.spaceId,
                name: 'Space (Limited Access)',
                description: 'Space information not accessible with current permissions'
            };
        }
    }

    /**
     * Get space users/collaborators (Enhanced for better sync)
     */
    async getSpaceUsers() {
        try {
            console.log('🔍 Attempting to get space collaborators...');

            // Try multiple endpoints to get space users
            const endpoints = [
                `/api/space/${this.config.spaceId}/collaborators`,
                `/api/space/${this.config.spaceId}/collaborator`,
                `/api/space/${this.config.spaceId}/members`,
                `/api/space/${this.config.spaceId}/member`,
                `/api/space/${this.config.spaceId}`
            ];

            for (const endpoint of endpoints) {
                try {
                    console.log(`🔍 Trying endpoint: ${endpoint}`);
                    const result = await this.request(endpoint);

                    // Check different response formats
                    if (result.collaborators) {
                        console.log(`✅ Found collaborators via ${endpoint}:`, result.collaborators);
                        return { collaborators: result.collaborators };
                    } else if (result.members) {
                        console.log(`✅ Found members via ${endpoint}:`, result.members);
                        return { collaborators: result.members };
                    } else if (result.users) {
                        console.log(`✅ Found users via ${endpoint}:`, result.users);
                        return { collaborators: result.users };
                    } else if (Array.isArray(result)) {
                        console.log(`✅ Found user array via ${endpoint}:`, result);
                        return { collaborators: result };
                    } else {
                        console.log(`⚠️ Endpoint ${endpoint} returned unexpected format:`, result);
                    }
                } catch (endpointError) {
                    console.log(`❌ Endpoint ${endpoint} failed:`, endpointError.message);

                    // Check for permission errors specifically
                    if (endpointError.message.includes('403') || endpointError.message.includes('not allowed')) {
                        throw new Error(`Permission denied: ${endpointError.message}`);
                    }
                }
            }

            // If all endpoints fail, return helpful error
            throw new Error('Cannot access space collaborators with current API token permissions');

        } catch (error) {
            console.log('❌ Cannot access space collaborators:', error.message);

            // If we can't access space collaborators, return a helpful message
            if (error.message.includes('403') || error.message.includes('not allowed') || error.message.includes('Permission denied')) {
                return {
                    message: 'Insufficient permissions to access space collaborators. This feature requires space admin privileges. You can still manage app users locally.',
                    collaborators: [],
                    permissionError: true
                };
            }

            // For other errors, try alternative approaches
            try {
                const spaceInfo = await this.getSpace();
                return {
                    collaborators: [],
                    message: 'Space collaborators not accessible with current API token permissions',
                    space: spaceInfo
                };
            } catch (spaceError) {
                return {
                    message: 'Cannot access space information. Please check your API token permissions.',
                    collaborators: [],
                    permissionError: true
                };
            }
        }
    }

    /**
     * Get current user info (for space owners)
     */
    async getCurrentUser() {
        // Try different endpoints to get user info
        const userEndpoints = [
            `/api/space/${this.config.spaceId}/collaborators`,
            `/api/space/${this.config.spaceId}`,
            `/api/space`
        ];

        for (const endpoint of userEndpoints) {
            try {
                const data = await this.request(endpoint);
                // Extract user info from response
                if (data.collaborators && data.collaborators.length > 0) {
                    return data.collaborators[0]; // Return first collaborator as current user
                }
                if (data.owner) {
                    return data.owner;
                }
                if (data.name) {
                    return { name: data.name, id: 'space_owner' };
                }
            } catch (error) {
                console.log(`User endpoint ${endpoint} failed:`, error.message);
            }
        }

        // Fallback user info
        return { 
            name: 'Space Owner', 
            id: 'space_owner',
            email: 'owner@space.local'
        };
    }

    /**
     * Ensure required fields exist in a table
     */
    async ensureTableFields(tableId, expectedFields) {
        try {
            console.log(`🔍 Checking fields for table ${tableId}...`);

            // Get current table fields
            const currentFields = await this.getTableFields(tableId);
            const currentFieldNames = currentFields.map(field => field.name.toLowerCase());

            console.log(`📋 Current fields in table:`, currentFieldNames);
            console.log(`📋 Expected fields:`, expectedFields.map(f => f.name));

            // Check for missing fields
            const missingFields = expectedFields.filter(expectedField => 
                !currentFieldNames.includes(expectedField.name.toLowerCase())
            );

            if (missingFields.length > 0) {
                console.log(`➕ Adding ${missingFields.length} missing fields:`, missingFields.map(f => f.name));

                // Add missing fields one by one
                for (const fieldSchema of missingFields) {
                    try {
                        console.log(`➕ Creating field: ${fieldSchema.name}`);
                        await this.createField(tableId, fieldSchema);
                        console.log(`✅ Successfully created field: ${fieldSchema.name}`);
                    } catch (fieldError) {
                        console.error(`❌ Failed to create field ${fieldSchema.name}:`, fieldError);
                        // Continue with other fields even if one fails
                    }
                }
            } else {
                console.log(`✅ All required fields exist in table ${tableId}`);
            }

        } catch (error) {
            console.error(`❌ Error ensuring table fields for ${tableId}:`, error);
            throw error;
        }
    }

    /**
     * Ensure system tables exist - Updated to use Teable.io roles and ensure all fields
     */
    async ensureSystemTables() {
        try {
            const tables = await this.getTables();
            const allTables = tables.tables || tables || [];

            // Define expected fields for data_change_logs table
            const dataLogsFields = [
                { name: 'record_id', type: 'singleLineText' },
                { name: 'table_id', type: 'singleLineText' },
                { name: 'table_name', type: 'singleLineText' },
                { name: 'action_type', type: 'singleSelect', options: {
                    choices: [
                        { name: 'create', color: 'green' },
                        { name: 'update', color: 'yellow' },
                        { name: 'delete', color: 'red' }
                    ]
                }},
                { name: 'field_name', type: 'singleLineText' },
                { name: 'old_value', type: 'longText' },
                { name: 'new_value', type: 'longText' },
                { name: 'changed_by', type: 'singleLineText' },
                { name: 'changed_at', type: 'date' },
                { name: 'timestamp', type: 'singleLineText' },
                { name: 'user_role', type: 'singleLineText' },
                { name: 'ip_address', type: 'singleLineText' },
                { name: 'session_id', type: 'singleLineText' }
            ];

            // Check for data_change_logs table
            let dataLogsTable = allTables.find(t => t.name === 'data_change_logs');
            if (!dataLogsTable) {
                console.log('Creating data_change_logs table...');
                dataLogsTable = await this.createTable({
                    name: 'data_change_logs',
                    description: 'Comprehensive audit trail of all data changes',
                    fields: dataLogsFields
                });
            } else {
                console.log('data_change_logs table exists, ensuring all fields...');
                await this.ensureTableFields(dataLogsTable.id, dataLogsFields);
            }
            this.systemTables.dataLogs = dataLogsTable.id;

            // Define expected fields for app_users table
            const appUsersFields = [
                { name: 'email', type: 'singleLineText' },
                { name: 'password_hash', type: 'singleLineText' },
                { name: 'admin_password_hash', type: 'singleLineText' },
                { name: 'first_name', type: 'singleLineText' },
                { name: 'last_name', type: 'singleLineText' },
                { 
                    name: 'role', 
                    type: 'singleSelect',
                    options: {
                        choices: [
                            { name: 'Owner', color: 'red' },
                            { name: 'Admin', color: 'blue' },
                            { name: 'Editor', color: 'green' },
                            { name: 'Commenter', color: 'orange' },
                            { name: 'Viewer', color: 'yellow' }
                        ]
                    }
                },
                { name: 'is_active', type: 'checkbox' },
                { name: 'is_space_owner', type: 'checkbox' },
                { name: 'created_date', type: 'date' },
                { name: 'last_login', type: 'date' },
                { name: 'synced_from_teable', type: 'checkbox' },
                { name: 'teable_user_id', type: 'singleLineText' }
            ];

            // Check for app_users table
            let usersTable = allTables.find(t => t.name === 'app_users');
            if (!usersTable) {
                console.log('Creating app_users table...');
                usersTable = await this.createTable({
                    name: 'app_users',
                    description: 'System users with Teable.io role-based access',
                    fields: appUsersFields
                });
            } else {
                console.log('app_users table exists, ensuring all fields...');
                await this.ensureTableFields(usersTable.id, appUsersFields);
            }
            this.systemTables.users = usersTable.id;

            // Define expected fields for field_permissions table
            const permissionsFields = [
                { name: 'user_email', type: 'singleLineText' },
                { name: 'table_id', type: 'singleLineText' },
                { name: 'table_name', type: 'singleLineText' },
                { name: 'field_id', type: 'singleLineText' },
                { name: 'field_name', type: 'singleLineText' },
                { 
                    name: 'permission_type',
                    type: 'singleSelect',
                    options: {
                        choices: [
                            { name: 'view', color: 'green' },
                            { name: 'edit', color: 'blue' },
                            { name: 'hidden', color: 'red' }
                        ]
                    }
                },
                { name: 'updated_by', type: 'singleLineText' },
                { name: 'updated_date', type: 'date' }
            ];

            // Check for field_permissions table
            let permissionsTable = allTables.find(t => t.name === 'field_permissions');
            if (!permissionsTable) {
                console.log('Creating field_permissions table...');
                permissionsTable = await this.createTable({
                    name: 'field_permissions',
                    description: 'Field-level permissions for users',
                    fields: permissionsFields
                });
            } else {
                console.log('field_permissions table exists, ensuring all fields...');
                await this.ensureTableFields(permissionsTable.id, permissionsFields);
            }
            this.systemTables.permissions = permissionsTable.id;

            // Define expected fields for system_activity table
            const activityFields = [
                { name: 'user_email', type: 'singleLineText' },
                { name: 'action_type', type: 'singleLineText' },
                { name: 'description', type: 'longText' },
                { name: 'table_affected', type: 'singleLineText' },
                { name: 'timestamp', type: 'date' },
                { name: 'ip_address', type: 'singleLineText' }
            ];

            // Check for system_activity table
            let activityTable = allTables.find(t => t.name === 'system_activity');
            if (!activityTable) {
                console.log('Creating system_activity table...');
                activityTable = await this.createTable({
                    name: 'system_activity',
                    description: 'System activity log',
                    fields: activityFields
                });
            } else {
                console.log('system_activity table exists, ensuring all fields...');
                await this.ensureTableFields(activityTable.id, activityFields);
            }
            this.systemTables.activity = activityTable.id;

            console.log('System tables ensured:', this.systemTables);
            return this.systemTables;

        } catch (error) {
            console.error('Error ensuring system tables:', error);
            throw error;
        }
    }

    /**
     * Create default admin user with Teable.io role
     */
    async createDefaultAdmin() {
        if (!this.systemTables.users) {
            throw new Error('Users table not initialized');
        }

        const adminUser = {
            email: 'admin@system.local',
            password_hash: await this.hashPassword('admin123'),
            first_name: 'System',
            last_name: 'Administrator',
            role: 'Admin', // Using Teable.io role
            is_active: true,
            created_date: new Date().toISOString().split('T')[0],
            last_login: null,
            synced_from_teable: false,
            teable_user_id: null
        };

        try {
            await this.createRecord(this.systemTables.users, adminUser);
            console.log('Default admin user created');
        } catch (error) {
            // User might already exist
            console.log('Admin user creation skipped:', error.message);
        }
    }

    /**
     * Hash password using Web Crypto API
     */
    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password + 'teable_salt_2024');
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    /**
     * Log system activity
     */
    async logActivity(userEmail, actionType, description, tableAffected = null) {
        if (!this.systemTables.activity) return;

        try {
            await this.createRecord(this.systemTables.activity, {
                user_email: userEmail,
                action_type: actionType,
                description: description,
                table_affected: tableAffected,
                timestamp: new Date().toISOString().split('T')[0],
                ip_address: 'unknown' // Could be enhanced with real IP detection
            });
        } catch (error) {
            console.error('Failed to log activity:', error);
        }
    }
}

// Create global instance
window.teableAPI = new TeableAPI();