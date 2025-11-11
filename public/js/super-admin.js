
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

    try {
        const config = {
            clientName: document.getElementById('clientName').value.trim(),
            ownerEmail: document.getElementById('ownerEmail').value.trim(),
            ownerPassword: document.getElementById('ownerPassword').value.trim(),
            baseUrl: document.getElementById('teableUrl').value.trim(),
            spaceId: document.getElementById('spaceId').value.trim(),
            baseId: document.getElementById('baseId').value.trim(),
            accessToken: document.getElementById('apiToken').value.trim()
        };

        // Validation
        if (!config.clientName || !config.ownerEmail || !config.ownerPassword || 
            !config.baseUrl || !config.baseId || !config.accessToken) {
            throw new Error('Please fill in all required fields');
        }

        if (!config.ownerEmail.includes('@')) {
            throw new Error('Please enter a valid email address');
        }

        if (config.ownerPassword.length < 6) {
            throw new Error('Owner password must be at least 6 characters long');
        }

        // Show loading
        showLoadingState(true);

        console.log('Creating client configuration...');

        // Test connection first
        await testConnectionInternal(config);

        // Initialize API with new config
        window.teableAPI.init(config);

        // Create system tables
        console.log('Creating system tables...');
        await window.teableAPI.ensureSystemTables();

        // Create Owner user in app_users table
        console.log('Creating Owner user...');
        const ownerPasswordHash = await window.teableAPI.hashPassword(config.ownerPassword);
        
        // Extract name from email if no separate name provided
        const emailParts = config.ownerEmail.split('@')[0];
        const firstName = emailParts.charAt(0).toUpperCase() + emailParts.slice(1);
        
        const ownerUserData = {
            email: config.ownerEmail,
            password_hash: ownerPasswordHash,
            first_name: firstName,
            last_name: 'Owner',
            role: 'Owner', // Using Teable.io nomenclature with proper case
            is_active: true,
            created_date: new Date().toISOString().split('T')[0],
            last_login: null,
            synced_from_teable: false,
            teable_user_id: null,
            admin_password_hash: ownerPasswordHash // Owner can use same password for admin functions
        };

        await window.teableAPI.createRecord(window.teableAPI.systemTables.users, ownerUserData);

        // Save configuration
        const fullConfig = {
            ...config,
            id: Date.now().toString(),
            created: new Date().toISOString(),
            status: 'active',
            userCount: 1
        };

        const configs = getStoredConfigs();
        configs.push(fullConfig);
        localStorage.setItem('teable_client_configs', JSON.stringify(configs));

        // Set as active configuration
        localStorage.setItem('teable_client_config', JSON.stringify(fullConfig));

        // Log initial activity
        try {
            await window.teableAPI.logActivity(
                config.ownerEmail,
                'system_initialized',
                `Client "${config.clientName}" configured and system initialized`
            );
        } catch (logError) {
            console.log('Failed to log initial activity:', logError.message);
        }

        showLoadingState(false);

        // Show success modal
        showSuccessModal(fullConfig);

        // Reset form
        document.getElementById('clientConfigForm').reset();

        // Refresh displays
        loadExistingConfigs();
        updateStats();

        console.log('Client created successfully:', fullConfig);

    } catch (error) {
        console.error('Client creation failed:', error);
        showLoadingState(false);
        showAlert('danger', 'Failed to create client: ' + error.message);
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
            </div></div>
        </div>
            <div class="col-md-6">
                <h6><i class="fas fa-database me-2"></i>System Setup</h6>
                <ul class="list-unstyled">
                    <li><i class="fas fa-check text-success me-1"></i>System tables created</li>
                    <li><i class="fas fa-check text-success me-1"></i>Owner account created</li>
                    <li><i class="fas fa-check text-success me-1"></i>Configuration saved</li>
                    <li><i class="fas fa-check text-success me-1"></i>API connection verified</li>
                </ul>
            </div>
        </div>
        
        <div class="alert alert-info mt-3">
            <h6><i class="fas fa-info-circle me-2"></i>Next Steps</h6>
            <ol class="mb-0">
                <li>Proceed to the client portal to start using the system</li>
                <li>Owner can log in using email: <code>${config.ownerEmail}</code></li>
                <li>Access map.html and table.html for data management</li>
                <li>Configure additional users through the user management panel</li>
            </ol>
        </div>
    `;

    currentClientConfig = config;
    const modal = new bootstrap.Modal(document.getElementById('successModal'));
    modal.show();
}

function proceedToClient() {
    if (currentClientConfig) {
        // Set the configuration as active and redirect to login
        localStorage.setItem('teable_client_config', JSON.stringify(currentClientConfig));
        window.location.href = 'login.html';
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
        if (!currentCustomerId) {
            const clientName = document.getElementById('clientName').value;
            const ownerEmail = document.getElementById('ownerEmail').value;

            if (!clientName || !ownerEmail) {
                alert('Please fill in Client Name and Owner Email first');
                return;
            }

            const customerResponse = await fetch('/api/customers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: clientName,
                    subdomain: clientName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                    adminEmail: ownerEmail
                })
            });

            if (!customerResponse.ok) {
                throw new Error('Failed to create customer');
            }

            const customerData = await customerResponse.json();
            currentCustomerId = customerData.customer.id;
        }

        const response = await fetch(`/api/auth/google/start?customerId=${currentCustomerId}&adminEmail=${document.getElementById('ownerEmail').value}`);
        const data = await response.json();

        if (data.authUrl) {
            window.location.href = data.authUrl;
        } else {
            alert('Failed to start OAuth flow');
        }
    } catch (error) {
        console.error('Error starting OAuth:', error);
        alert(`Error: ${error.message}`);
    }
}

async function loadSpreadsheets() {
    try {
        const response = await fetch(`/api/google-sheets/${currentCustomerId}/spreadsheets`);
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
        const response = await fetch(`/api/google-sheets/${currentCustomerId}/sheets?spreadsheetId=${spreadsheetId}`);
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
        const response = await fetch(`/api/google-sheets/${currentCustomerId}/detect-fields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        const response = await fetch(`/api/google-sheets/${currentCustomerId}/preview?spreadsheetId=${spreadsheetId}&sheetName=${encodeURIComponent(sheetName)}`);
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

        setTimeout(() => {
            document.getElementById('sourceGoogleSheets').checked = true;
            toggleDataSource();

            document.getElementById('googleAuthSection').style.display = 'none';
            document.getElementById('googleConfigSection').style.display = 'block';
            document.getElementById('googleEmail').textContent = email;

            loadSpreadsheets();

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
