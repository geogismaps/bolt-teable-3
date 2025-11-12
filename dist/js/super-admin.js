
/**
 * Super Admin Portal - Client Configuration and Management
 */

let currentClientConfig = null;
let allConfigs = [];

document.addEventListener('DOMContentLoaded', function() {
    initializeSuperAdmin();
    
    // Setup form handler
    const configForm = document.getElementById('clientConfigForm');
    if (configForm) {
        configForm.addEventListener('submit', handleClientCreation);
    }
});

async function initializeSuperAdmin() {
    try {
        loadExistingConfigs();
        updateStats();
        
        console.log('Super Admin portal initialized');
        
    } catch (error) {
        console.error('Super Admin initialization failed:', error);
        showAlert('danger', 'Failed to initialize Super Admin portal: ' + error.message);
    }
}

function loadExistingConfigs() {
    try {
        const configs = getStoredConfigs();
        allConfigs = configs;
        displayExistingConfigs(configs);
        
    } catch (error) {
        console.error('Failed to load existing configs:', error);
    }
}

function getStoredConfigs() {
    try {
        const configs = localStorage.getItem('teable_client_configs');
        return configs ? JSON.parse(configs) : [];
    } catch (error) {
        console.error('Failed to get stored configs:', error);
        return [];
    }
}

function displayExistingConfigs(configs) {
    const container = document.getElementById('existingConfigs');
    
    if (configs.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-3">
                <i class="fas fa-inbox fa-2x mb-2"></i>
                <p>No clients configured</p>
            </div>
        `;
        return;
    }

    let html = '';
    configs.forEach((config, index) => {
        const statusClass = config.status === 'active' ? 'success' : 'warning';
        const statusIcon = config.status === 'active' ? 'check-circle' : 'exclamation-triangle';
        
        html += `
            <div class="config-card mb-3 p-3 border rounded">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h6 class="mb-1">${config.clientName}</h6>
                        <small class="text-muted">${config.ownerEmail}</small>
                        <div class="mt-1">
                            <span class="badge bg-${statusClass}">
                                <i class="fas fa-${statusIcon} me-1"></i>${config.status || 'active'}
                            </span>
                        </div>
                    </div>
                    <div class="dropdown">
                        <button class="btn btn-sm btn-outline-secondary dropdown-toggle" 
                                data-bs-toggle="dropdown">
                            <i class="fas fa-cog"></i>
                        </button>
                        <ul class="dropdown-menu">
                            <li><a class="dropdown-item" href="#" onclick="activateConfig(${index})">
                                <i class="fas fa-play me-1"></i>Activate
                            </a></li>
                            <li><a class="dropdown-item" href="#" onclick="editConfig(${index})">
                                <i class="fas fa-edit me-1"></i>Edit
                            </a></li>
                            <li><a class="dropdown-item" href="#" onclick="testConfigConnection(${index})">
                                <i class="fas fa-wifi me-1"></i>Test
                            </a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><a class="dropdown-item text-danger" href="#" onclick="deleteConfig(${index})">
                                <i class="fas fa-trash me-1"></i>Delete
                            </a></li>
                        </ul>
                    </div>
                </div>
                <div class="mt-2">
                    <small class="text-muted">
                        <i class="fas fa-calendar me-1"></i>Created: ${new Date(config.created).toLocaleDateString()}
                    </small>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function updateStats() {
    try {
        const configs = getStoredConfigs();
        
        document.getElementById('totalClients').textContent = configs.length;
        document.getElementById('totalUsers').textContent = configs.reduce((sum, config) => sum + (config.userCount || 0), 0);
        document.getElementById('totalSpaces').textContent = configs.filter(c => c.spaceId).length;
        
    } catch (error) {
        console.error('Failed to update stats:', error);
    }
}

async function handleClientCreation(event) {
    event.preventDefault();

    const selectedSource = document.querySelector('input[name="dataSource"]:checked').value;

    if (selectedSource === 'google_sheets') {
        await handleGoogleSheetsClientCreation();
    } else {
        await handleTeableClientCreation();
    }
}

async function handleTeableClientCreation() {
    try {
        const clientName = document.getElementById('clientName').value.trim();
        const ownerEmail = document.getElementById('ownerEmail').value.trim();
        const ownerPassword = document.getElementById('ownerPassword').value.trim();
        const baseUrl = document.getElementById('teableUrl').value.trim();
        const spaceId = document.getElementById('spaceId').value.trim();
        const baseId = document.getElementById('baseId').value.trim();
        const accessToken = document.getElementById('apiToken').value.trim();

        if (!clientName || !ownerEmail || !ownerPassword || !baseUrl || !baseId || !accessToken) {
            throw new Error('Please fill in all required fields');
        }

        if (!ownerEmail.includes('@')) {
            throw new Error('Please enter a valid email address');
        }

        if (ownerPassword.length < 6) {
            throw new Error('Owner password must be at least 6 characters long');
        }

        showLoadingState(true);
        console.log('Creating Teable client...');

        const subdomain = clientName.toLowerCase().replace(/[^a-z0-9]/g, '-');

        const customerResponse = await fetch(window.apiConfig.endpoints.customers, {
            method: 'POST',
            headers: window.apiConfig.getHeaders(),
            body: JSON.stringify({
                name: clientName,
                subdomain: subdomain,
                adminEmail: ownerEmail,
                adminPassword: ownerPassword,
                dataSourceType: 'teable'
            })
        });

        if (!customerResponse.ok) {
            const errorData = await customerResponse.json();
            throw new Error(errorData.error || 'Failed to create customer');
        }

        const { customer, ownerUser } = await customerResponse.json();
        console.log('Customer created:', customer.id);

        const configResponse = await fetch(`${window.apiConfig.endpoints.customers}/${customer.id}/teable-config`, {
            method: 'POST',
            headers: window.apiConfig.getHeaders(),
            body: JSON.stringify({
                baseUrl: baseUrl,
                spaceId: spaceId,
                baseId: baseId,
                accessToken: accessToken,
                adminEmail: ownerEmail
            })
        });

        if (!configResponse.ok) {
            throw new Error('Failed to save Teable configuration');
        }

        const fullConfig = {
            clientName: clientName,
            ownerEmail: ownerEmail,
            subdomain: subdomain,
            customerId: customer.id,
            dataSource: 'teable',
            id: customer.id,
            created: new Date().toISOString(),
            status: 'active',
            userCount: 1
        };

        const configs = getStoredConfigs();
        configs.push(fullConfig);
        localStorage.setItem('teable_client_configs', JSON.stringify(configs));

        showLoadingState(false);
        showSuccessModal(fullConfig);

        document.getElementById('clientConfigForm').reset();
        loadExistingConfigs();
        updateStats();

        console.log('Teable client created successfully');

    } catch (error) {
        console.error('Teable client creation failed:', error);
        showLoadingState(false);
        showAlert('danger', 'Failed to create Teable client: ' + error.message);
    }
}

async function handleGoogleSheetsClientCreation() {
    try {
        if (!currentCustomerId) {
            throw new Error('Please complete Google OAuth authentication first');
        }

        const clientName = document.getElementById('clientName').value.trim();
        const ownerEmail = document.getElementById('ownerEmail').value.trim();
        let ownerPassword = document.getElementById('ownerPassword').value.trim();

        if (!ownerPassword) {
            ownerPassword = sessionStorage.getItem('pendingOwnerPassword');
        }
        const spreadsheetId = document.getElementById('spreadsheetSelect').value;
        const sheetName = document.getElementById('sheetSelect').value;
        const geometryColumn = document.getElementById('geometryColumn').value;
        const idColumn = document.getElementById('idColumn').value;
        const nameColumn = document.getElementById('nameColumn').value;
        const latColumn = document.getElementById('latColumn').value;
        const lngColumn = document.getElementById('lngColumn').value;

        if (!clientName || !ownerEmail || !ownerPassword) {
            throw new Error('Please fill in client name, email, and password');
        }

        if (!spreadsheetId || !sheetName) {
            throw new Error('Please select a spreadsheet and sheet');
        }

        if (!geometryColumn && (!latColumn || !lngColumn)) {
            throw new Error('Please select either a geometry column or latitude/longitude columns');
        }

        if (!idColumn || !nameColumn) {
            throw new Error('Please select ID and name columns');
        }

        showLoadingState(true);
        console.log('Completing Google Sheets client setup...');

        const fieldMappings = {
            geometry_column: geometryColumn || null,
            id_column: idColumn,
            name_column: nameColumn,
            latitude_column: latColumn || null,
            longitude_column: lngColumn || null
        };

        const configResponse = await fetch(`${window.apiConfig.endpoints.googleSheets}/${currentCustomerId}/save-config`, {
            method: 'POST',
            headers: window.apiConfig.getHeaders(),
            body: JSON.stringify({
                spreadsheetId: spreadsheetId,
                sheetName: sheetName,
                fieldMappings: fieldMappings
            })
        });

        if (!configResponse.ok) {
            const errorData = await configResponse.json();
            throw new Error(errorData.error || 'Failed to save Google Sheets configuration');
        }

        const setupResponse = await fetch(`${window.apiConfig.endpoints.customers}/${currentCustomerId}/complete-setup`, {
            method: 'POST',
            headers: window.apiConfig.getHeaders(),
            body: JSON.stringify({
                adminEmail: ownerEmail,
                adminPassword: ownerPassword,
                dataSourceType: 'google_sheets'
            })
        });

        if (!setupResponse.ok) {
            const errorData = await setupResponse.json();
            throw new Error(errorData.error || 'Failed to complete customer setup');
        }

        const { customer } = await setupResponse.json();

        const fullConfig = {
            clientName: clientName,
            ownerEmail: ownerEmail,
            subdomain: customer.subdomain,
            customerId: customer.id,
            dataSource: 'google_sheets',
            id: customer.id,
            created: new Date().toISOString(),
            status: 'active',
            userCount: 1
        };

        const configs = getStoredConfigs();
        configs.push(fullConfig);
        localStorage.setItem('teable_client_configs', JSON.stringify(configs));

        currentCustomerId = null;
        currentOAuthEmail = null;

        sessionStorage.removeItem('pendingCustomerId');
        sessionStorage.removeItem('pendingOwnerEmail');
        sessionStorage.removeItem('pendingOwnerPassword');
        sessionStorage.removeItem('pendingClientName');
        sessionStorage.removeItem('pendingSubdomain');

        showLoadingState(false);
        showSuccessModal(fullConfig);

        document.getElementById('clientConfigForm').reset();
        document.getElementById('googleAuthSection').style.display = 'block';
        document.getElementById('googleConfigSection').style.display = 'none';

        loadExistingConfigs();
        updateStats();

        console.log('Google Sheets client created successfully');

    } catch (error) {
        console.error('Google Sheets client creation failed:', error);
        showLoadingState(false);
        showAlert('danger', 'Failed to create Google Sheets client: ' + error.message);
    }
}

async function testConnection() {
    const statusDiv = document.getElementById('connectionStatus');

    try {
        statusDiv.innerHTML = `
            <div class="alert alert-info">
                <i class="fas fa-spinner fa-spin me-2"></i>Testing connection...
            </div>
        `;

        const config = {
            baseUrl: document.getElementById('teableUrl').value.trim(),
            spaceId: document.getElementById('spaceId').value.trim(),
            baseId: document.getElementById('baseId').value.trim(),
            accessToken: document.getElementById('apiToken').value.trim()
        };

        if (!config.baseUrl || !config.baseId || !config.accessToken) {
            throw new Error('Please fill in URL, Base ID, and API Token first');
        }

        console.log('Testing connection with config:', { ...config, accessToken: '***' });

        await testConnectionInternal(config);

        statusDiv.innerHTML = `
            <div class="alert alert-success">
                <i class="fas fa-check-circle me-2"></i>Connection successful!
                Ready to create client configuration.
            </div>
        `;

    } catch (error) {
        console.error('Connection test failed:', error);
        statusDiv.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>Connection failed: ${error.message}
            </div>
        `;
    }
}

async function testConnectionInternal(config) {
    // Initialize API temporarily
    window.teableAPI.init(config);

    // Test the actual API connection using the testConnection method
    try {
        const result = await window.teableAPI.testConnection();
        if (result.success) {
            console.log('API connection test successful:', result);
            return true;
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        throw new Error(`API connection failed: ${error.message}`);
    }
}

async function autoSetup() {
    try {
        const config = {
            baseUrl: document.getElementById('teableUrl').value.trim(),
            baseId: document.getElementById('baseId').value.trim(),
            accessToken: document.getElementById('apiToken').value.trim()
        };

        if (!config.baseUrl || !config.baseId || !config.accessToken) {
            throw new Error('Please fill in URL, Base ID, and API Token first');
        }

        showAlert('info', 'Setting up system tables...');

        // Initialize API temporarily
        window.teableAPI.init(config);

        // Create system tables
        await window.teableAPI.ensureSystemTables();

        showAlert('success', 'System tables created successfully!');

    } catch (error) {
        console.error('Auto setup failed:', error);
        showAlert('danger', 'Auto setup failed: ' + error.message);
    }
}

function activateConfig(index) {
    try {
        const configs = getStoredConfigs();
        const config = configs[index];
        
        if (!config) {
            throw new Error('Configuration not found');
        }

        // Set as active configuration
        localStorage.setItem('teable_client_config', JSON.stringify(config));
        
        // Update status
        configs.forEach(c => c.status = 'inactive');
        config.status = 'active';
        localStorage.setItem('teable_client_configs', JSON.stringify(configs));

        showAlert('success', `Activated client configuration: ${config.clientName}`);
        loadExistingConfigs();

    } catch (error) {
        console.error('Failed to activate config:', error);
        showAlert('danger', 'Failed to activate configuration: ' + error.message);
    }
}

function editConfig(index) {
    try {
        const configs = getStoredConfigs();
        const config = configs[index];
        
        if (!config) {
            throw new Error('Configuration not found');
        }

        // Populate form with existing data
        document.getElementById('clientName').value = config.clientName || '';
        document.getElementById('ownerEmail').value = config.ownerEmail || '';
        document.getElementById('teableUrl').value = config.baseUrl || '';
        document.getElementById('spaceId').value = config.spaceId || '';
        document.getElementById('baseId').value = config.baseId || '';
        document.getElementById('apiToken').value = config.accessToken || '';

        // Scroll to form
        document.getElementById('clientConfigForm').scrollIntoView({ behavior: 'smooth' });

        showAlert('info', `Editing configuration: ${config.clientName}. Update and save to apply changes.`);

        // Remove the config from storage (will be re-added when saved)
        configs.splice(index, 1);
        localStorage.setItem('teable_client_configs', JSON.stringify(configs));
        loadExistingConfigs();

    } catch (error) {
        console.error('Failed to edit config:', error);
        showAlert('danger', 'Failed to edit configuration: ' + error.message);
    }
}

async function testConfigConnection(index) {
    try {
        const configs = getStoredConfigs();
        const config = configs[index];
        
        if (!config) {
            throw new Error('Configuration not found');
        }

        await testConnectionInternal(config);
        showAlert('success', `Connection test successful for: ${config.clientName}`);

    } catch (error) {
        console.error('Config connection test failed:', error);
        showAlert('danger', `Connection test failed for config: ${error.message}`);
    }
}

function deleteConfig(index) {
    try {
        const configs = getStoredConfigs();
        const config = configs[index];
        
        if (!config) {
            throw new Error('Configuration not found');
        }

        if (!confirm(`Are you sure you want to delete the configuration for "${config.clientName}"?\n\nThis action cannot be undone.`)) {
            return;
        }

        // Remove from storage
        configs.splice(index, 1);
        localStorage.setItem('teable_client_configs', JSON.stringify(configs));

        // If this was the active config, clear it
        const activeConfig = localStorage.getItem('teable_client_config');
        if (activeConfig) {
            const active = JSON.parse(activeConfig);
            if (active.id === config.id) {
                localStorage.removeItem('teable_client_config');
            }
        }

        showAlert('success', `Configuration deleted: ${config.clientName}`);
        loadExistingConfigs();
        updateStats();

    } catch (error) {
        console.error('Failed to delete config:', error);
        showAlert('danger', 'Failed to delete configuration: ' + error.message);
    }
}

function showSuccessModal(config) {
    const content = document.getElementById('successContent');
    const loginUrl = `https://${config.subdomain}.mapz.in/login.html`;
    const dataSourceLabel = config.dataSource === 'google_sheets' ? 'Google Sheets' : 'Teable.io';

    content.innerHTML = `
        <div class="text-center mb-4">
            <i class="fas fa-check-circle fa-4x text-success mb-3"></i>
            <h4>Client "${config.clientName}" Created Successfully!</h4>
        </div>

        <div class="row">
            <div class="col-md-6">
                <h6><i class="fas fa-user me-2"></i>Owner Details</h6>
                <ul class="list-unstyled">
                    <li><strong>Email:</strong> ${config.ownerEmail}</li>
                    <li><strong>Role:</strong> Owner (Full Access)</li>
                    <li><strong>Status:</strong> Active</li>
                </ul>
            </div>
            <div class="col-md-6">
                <h6><i class="fas fa-database me-2"></i>System Setup</h6>
                <ul class="list-unstyled">
                    <li><i class="fas fa-check text-success me-1"></i>Customer created</li>
                    <li><i class="fas fa-check text-success me-1"></i>Owner account created</li>
                    <li><i class="fas fa-check text-success me-1"></i>Data source configured (${dataSourceLabel})</li>
                    <li><i class="fas fa-check text-success me-1"></i>Ready to use</li>
                </ul>
            </div>
        </div>

        <div class="alert alert-info mt-3">
            <h6><i class="fas fa-info-circle me-2"></i>Login Information</h6>
            <ul class="mb-0">
                <li><strong>Login URL:</strong> <a href="${loginUrl}" target="_blank">${loginUrl}</a></li>
                <li><strong>Email:</strong> <code>${config.ownerEmail}</code></li>
                <li><strong>Password:</strong> <em>As configured</em></li>
                <li><strong>Subdomain:</strong> <code>${config.subdomain}</code></li>
            </ul>
        </div>

        <div class="alert alert-success mt-2">
            <h6><i class="fas fa-rocket me-2"></i>Next Steps</h6>
            <ol class="mb-0">
                <li>Share the login URL with the customer owner</li>
                <li>Owner logs in with their email and password</li>
                <li>Customer can access their maps and data</li>
                <li>Owner can invite additional users through user management</li>
            </ol>
        </div>
    `;

    currentClientConfig = config;
    const modal = new bootstrap.Modal(document.getElementById('successModal'));
    modal.show();
}

function proceedToClient() {
    if (currentClientConfig) {
        const loginUrl = `https://${currentClientConfig.subdomain}.mapz.in/login.html`;
        window.open(loginUrl, '_blank');
    }
}

function resetForm() {
    document.getElementById('clientConfigForm').reset();
    document.getElementById('connectionStatus').innerHTML = '';
}

function showLoadingState(show) {
    const form = document.getElementById('clientConfigForm');
    const inputs = form.querySelectorAll('input, button');
    
    inputs.forEach(input => {
        input.disabled = show;
    });

    if (show) {
        showAlert('info', '<i class="fas fa-spinner fa-spin me-2"></i>Creating client configuration...');
    }
}

function exportConfigs() {
    try {
        const configs = getStoredConfigs();
        const exportData = configs.map(config => ({
            clientName: config.clientName,
            ownerEmail: config.ownerEmail,
            created: config.created,
            status: config.status,
            userCount: config.userCount || 0
        }));

        const csv = [
            'Client Name,Owner Email,Created,Status,User Count',
            ...exportData.map(row => 
                `"${row.clientName}","${row.ownerEmail}","${row.created}","${row.status}","${row.userCount}"`
            )
        ].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `client_configurations_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        showAlert('success', 'Client configurations exported successfully!');

    } catch (error) {
        console.error('Export failed:', error);
        showAlert('danger', 'Failed to export configurations: ' + error.message);
    }
}

function viewSystemLogs() {
    window.open('logs.html', '_blank');
}

function backupData() {
    showAlert('info', 'Backup functionality will be implemented in the next version.');
}

function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.nextElementSibling?.querySelector('i');
    
    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        if (icon) icon.className = 'fas fa-eye';
    }
}

function showAlert(type, message) {
    // Remove existing alerts
    const existingAlerts = document.querySelectorAll('.alert');
    existingAlerts.forEach(alert => {
        if (alert.classList.contains('alert-dismissible')) {
            alert.remove();
        }
    });

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    // Insert at top of container
    const container = document.querySelector('.container');
    if (container) {
        container.insertBefore(alertDiv, container.firstChild);
    }

    // Auto-remove after 8 seconds
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 8000);
}

// Expose functions to global window object for inline onclick handlers
window.testConnection = testConnection;
window.autoSetup = autoSetup;
window.resetForm = resetForm;
window.togglePasswordVisibility = togglePasswordVisibility;
window.activateConfig = activateConfig;
window.editConfig = editConfig;
window.testConfigConnection = testConfigConnection;
window.deleteConfig = deleteConfig;
window.proceedToClient = proceedToClient;
window.exportConfigs = exportConfigs;
window.viewSystemLogs = viewSystemLogs;
window.backupData = backupData;

let currentCustomerId = null;
let currentOAuthEmail = null;

function toggleDataSource() {
    const selectedSource = document.querySelector('input[name="dataSource"]:checked').value;
    const teableConfig = document.getElementById('teableConfig');
    const googleSheetsConfig = document.getElementById('googleSheetsConfig');

    if (selectedSource === 'teable') {
        teableConfig.style.display = 'block';
        googleSheetsConfig.style.display = 'none';

        document.getElementById('teableUrl').required = true;
        document.getElementById('spaceId').required = true;
        document.getElementById('baseId').required = true;
        document.getElementById('apiToken').required = true;
    } else {
        teableConfig.style.display = 'none';
        googleSheetsConfig.style.display = 'block';

        document.getElementById('teableUrl').required = false;
        document.getElementById('spaceId').required = false;
        document.getElementById('baseId').required = false;
        document.getElementById('apiToken').required = false;
    }
}

async function startGoogleOAuth() {
    try {
        const clientName = document.getElementById('clientName').value.trim();
        const ownerEmail = document.getElementById('ownerEmail').value.trim();
        const ownerPassword = document.getElementById('ownerPassword').value.trim();

        if (!clientName || !ownerEmail || !ownerPassword) {
            showAlert('danger', 'Please fill in Client Name, Owner Email, and Owner Password before connecting Google account');
            return;
        }

        if (ownerPassword.length < 6) {
            showAlert('danger', 'Owner password must be at least 6 characters long');
            return;
        }

        showAlert('info', 'Creating customer record...');

        const subdomain = clientName.toLowerCase().replace(/[^a-z0-9]/g, '-');

        const customerResponse = await fetch(window.apiConfig.endpoints.customers, {
            method: 'POST',
            headers: window.apiConfig.getHeaders(),
            body: JSON.stringify({
                name: clientName,
                subdomain: subdomain,
                dataSourceType: 'google_sheets'
            })
        });

        if (!customerResponse.ok) {
            const errorData = await customerResponse.json();
            throw new Error(errorData.error || 'Failed to create customer');
        }

        const customerData = await customerResponse.json();
        currentCustomerId = customerData.customer.id;

        console.log('Customer created, starting OAuth:', currentCustomerId);

        const oauthUrl = `${window.apiConfig.endpoints.googleOAuth}/start?customerId=${currentCustomerId}&adminEmail=${ownerEmail}`;
        console.log('Fetching OAuth URL:', oauthUrl);

        const response = await fetch(oauthUrl);
        console.log('OAuth response status:', response.status, response.statusText);
        console.log('OAuth response headers:', Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OAuth error response:', errorText);
            throw new Error(`OAuth request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const responseText = await response.text();
        console.log('OAuth response text:', responseText.substring(0, 200));
        alert(`DEBUG: Response status=${response.status}, body length=${responseText.length}, first 100 chars=${responseText.substring(0, 100)}`);

        if (!responseText) {
            throw new Error('Empty response from OAuth endpoint - server returned nothing');
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse OAuth response:', parseError);
            console.error('Response text:', responseText);
            alert(`DEBUG: JSON Parse Failed! Response was: ${responseText.substring(0, 500)}`);
            throw new Error(`Invalid JSON response: ${parseError.message}. Server returned: ${responseText.substring(0, 100)}`);
        }

        if (data.authUrl) {
            sessionStorage.setItem('pendingCustomerId', currentCustomerId);
            sessionStorage.setItem('pendingOwnerEmail', ownerEmail);
            sessionStorage.setItem('pendingOwnerPassword', ownerPassword);
            sessionStorage.setItem('pendingClientName', clientName);
            sessionStorage.setItem('pendingSubdomain', subdomain);
            window.location.href = data.authUrl;
        } else if (data.error) {
            throw new Error(data.error);
        } else {
            throw new Error('Failed to get OAuth URL');
        }
    } catch (error) {
        console.error('Error starting OAuth:', error);
        showAlert('danger', `Error starting OAuth: ${error.message}`);
    }
}

async function loadSpreadsheets() {
    try {
        const response = await fetch(`${window.apiConfig.endpoints.googleSheets}/${currentCustomerId}/spreadsheets`, { headers: window.apiConfig.getHeaders() });
        const data = await response.json();

        const select = document.getElementById('spreadsheetSelect');
        select.innerHTML = '<option value="">Select a spreadsheet...</option>';

        data.spreadsheets.forEach(sheet => {
            const option = document.createElement('option');
            option.value = sheet.id;
            option.textContent = sheet.name;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading spreadsheets:', error);
        alert(`Error loading spreadsheets: ${error.message}`);
    }
}

async function loadSheets() {
    const spreadsheetId = document.getElementById('spreadsheetSelect').value;
    if (!spreadsheetId) return;

    try {
        const response = await fetch(`${window.apiConfig.endpoints.googleSheets}/${currentCustomerId}/sheets?spreadsheetId=${spreadsheetId}`, { headers: window.apiConfig.getHeaders() });
        const data = await response.json();

        const select = document.getElementById('sheetSelect');
        select.innerHTML = '<option value="">Select a sheet...</option>';

        data.sheets.forEach(sheet => {
            const option = document.createElement('option');
            option.value = sheet.title;
            option.textContent = sheet.title;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading sheets:', error);
        alert(`Error loading sheets: ${error.message}`);
    }
}

async function autoDetectFields() {
    const spreadsheetId = document.getElementById('spreadsheetSelect').value;
    const sheetName = document.getElementById('sheetSelect').value;

    if (!spreadsheetId || !sheetName) {
        alert('Please select a spreadsheet and sheet first');
        return;
    }

    try {
        const response = await fetch(`${window.apiConfig.endpoints.googleSheets}/${currentCustomerId}/detect-fields`, {
            method: 'POST',
            headers: window.apiConfig.getHeaders(),
            body: JSON.stringify({ spreadsheetId, sheetName })
        });

        const suggestions = await response.json();

        populateColumnDropdowns(suggestions.all_columns);

        if (suggestions.geometry_column) {
            document.getElementById('geometryColumn').value = suggestions.geometry_column;
        }
        if (suggestions.id_column) {
            document.getElementById('idColumn').value = suggestions.id_column;
        }
        if (suggestions.name_column) {
            document.getElementById('nameColumn').value = suggestions.name_column;
        }
        if (suggestions.latitude_column) {
            document.getElementById('latColumn').value = suggestions.latitude_column;
        }
        if (suggestions.longitude_column) {
            document.getElementById('lngColumn').value = suggestions.longitude_column;
        }

        showAlert('success', 'Fields auto-detected! Please review the selections.');
    } catch (error) {
        console.error('Error detecting fields:', error);
        alert(`Error detecting fields: ${error.message}`);
    }
}

function populateColumnDropdowns(columns) {
    const dropdowns = ['geometryColumn', 'idColumn', 'nameColumn', 'latColumn', 'lngColumn'];

    dropdowns.forEach(dropdownId => {
        const select = document.getElementById(dropdownId);
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '<option value="">Select column...</option>';

        columns.forEach(col => {
            const option = document.createElement('option');
            option.value = col;
            option.textContent = col;
            select.appendChild(option);
        });

        if (currentValue) {
            select.value = currentValue;
        }
    });
}

async function previewData() {
    const spreadsheetId = document.getElementById('spreadsheetSelect').value;
    const sheetName = document.getElementById('sheetSelect').value;

    if (!spreadsheetId || !sheetName) {
        alert('Please select a spreadsheet and sheet first');
        return;
    }

    try {
        const response = await fetch(`${window.apiConfig.endpoints.googleSheets}/${currentCustomerId}/preview?spreadsheetId=${spreadsheetId}&sheetName=${encodeURIComponent(sheetName)}`, { headers: window.apiConfig.getHeaders() });
        const data = await response.json();

        const previewTable = document.getElementById('previewTable');
        const thead = previewTable.querySelector('thead');
        const tbody = previewTable.querySelector('tbody');

        thead.innerHTML = '<tr>' + data.headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
        tbody.innerHTML = data.rows.map(row =>
            '<tr>' + row.map(cell => `<td>${cell || ''}</td>`).join('') + '</tr>'
        ).join('');

        document.getElementById('previewContainer').style.display = 'block';

        populateColumnDropdowns(data.headers);
        showAlert('success', 'Data preview loaded!');
    } catch (error) {
        console.error('Error previewing data:', error);
        alert(`Error previewing data: ${error.message}`);
    }
}

function testTeableConnection() {
    testConnection();
}

window.toggleDataSource = toggleDataSource;
window.startGoogleOAuth = startGoogleOAuth;
window.loadSheets = loadSheets;
window.autoDetectFields = autoDetectFields;
window.previewData = previewData;
window.testTeableConnection = testTeableConnection;

if (window.location.search.includes('oauth=success')) {
    const urlParams = new URLSearchParams(window.location.search);
    const email = urlParams.get('email');
    const customerId = urlParams.get('customer');

    if (email && customerId) {
        currentCustomerId = customerId;
        currentOAuthEmail = email;

        const pendingClientName = sessionStorage.getItem('pendingClientName');
        const pendingOwnerEmail = sessionStorage.getItem('pendingOwnerEmail');

        setTimeout(() => {
            document.getElementById('sourceGoogleSheets').checked = true;
            toggleDataSource();

            if (pendingClientName) {
                document.getElementById('clientName').value = pendingClientName;
            }
            if (pendingOwnerEmail) {
                document.getElementById('ownerEmail').value = pendingOwnerEmail;
            }

            document.getElementById('googleAuthSection').style.display = 'none';
            document.getElementById('googleConfigSection').style.display = 'block';
            document.getElementById('googleEmail').textContent = email;

            loadSpreadsheets();

            showAlert('success', 'Google account connected successfully! Now select your spreadsheet and configure field mappings.');

            window.history.replaceState({}, document.title, window.location.pathname);
        }, 500);
    }
}

// Add CSS for better styling
const style = document.createElement('style');
style.textContent = `
    .stat-card {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 1.5rem;
        border-radius: 15px;
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
    }

    .stat-icon {
        font-size: 2rem;
        margin-right: 1rem;
        opacity: 0.8;
    }

    .stat-content h3 {
        font-size: 2.5rem;
        font-weight: bold;
        margin: 0;
    }

    .stat-content p {
        margin: 0;
        opacity: 0.9;
    }

    .config-card {
        transition: all 0.3s ease;
    }

    .config-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
`;
document.head.appendChild(style);
