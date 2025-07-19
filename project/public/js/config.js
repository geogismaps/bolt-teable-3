/**
 * Super Admin Configuration Management
 */

document.addEventListener('DOMContentLoaded', function() {
    loadExistingConfigs();
    
    // Setup form handler
    const configForm = document.getElementById('configForm');
    if (configForm) {
        configForm.addEventListener('submit', handleConfigSubmit);
    }
});

async function handleConfigSubmit(event) {
    event.preventDefault();
    
    try {
        const config = {
            clientName: document.getElementById('clientName').value.trim(),
            adminEmail: document.getElementById('adminEmail').value.trim(),
            baseUrl: document.getElementById('teableUrl').value.trim(),
            spaceId: document.getElementById('spaceId').value.trim(),
            baseId: document.getElementById('baseId').value.trim(),
            accessToken: document.getElementById('apiToken').value.trim()
        };

        // Validation
        if (!config.clientName || !config.adminEmail || !config.baseUrl || 
            !config.baseId || !config.accessToken) {
            throw new Error('Please fill in all required fields');
        }

        if (!config.adminEmail.includes('@')) {
            throw new Error('Please enter a valid email address');
        }

        // Clean up URL
        config.baseUrl = config.baseUrl.replace(/\/$/, '');

        // Test connection first
        showAlert('info', 'Testing connection...');
        
        // Initialize API for testing
        if (window.teableAPI) {
            window.teableAPI.init({
                baseUrl: config.baseUrl,
                spaceId: config.spaceId,
                baseId: config.baseId,
                accessToken: config.accessToken
            });

            const connectionResult = await window.teableAPI.testConnection();
            if (!connectionResult.success) {
                throw new Error('Connection test failed: ' + connectionResult.error);
            }

            // Initialize system tables
            showAlert('info', 'Initializing system tables...');
            await window.teableAPI.ensureSystemTables();
            await window.teableAPI.createDefaultAdmin();
        }

        // Save configuration
        const savedConfigs = window.teableAuth.addClientConfig(config);
        
        // Set as current config
        window.teableAuth.saveClientConfig({
            baseUrl: config.baseUrl,
            spaceId: config.spaceId,
            baseId: config.baseId,
            accessToken: config.accessToken
        });

        // Show success
        showAlert('success', 'Client configuration created successfully!');
        
        // Clear form
        document.getElementById('configForm').reset();
        
        // Refresh list
        loadExistingConfigs();

        // Show redirect option
        setTimeout(() => {
            if (confirm('Configuration saved! Would you like to go to the login page now?')) {
                window.location.href = 'login.html';
            }
        }, 1500);

    } catch (error) {
        console.error('Configuration failed:', error);
        showAlert('danger', error.message);
    }
}

async function testConnection() {
    try {
        const baseUrl = document.getElementById('teableUrl').value.trim();
        const spaceId = document.getElementById('spaceId').value.trim();
        const baseId = document.getElementById('baseId').value.trim();
        const token = document.getElementById('apiToken').value.trim();

        if (!baseUrl || !baseId || !token) {
            throw new Error('Please fill in Base URL, Base ID, and API Token');
        }

        // Show loading
        document.getElementById('connectionStatus').innerHTML = `
            <div class="alert alert-info">
                <i class="fas fa-spinner fa-spin me-2"></i>Testing connection...
            </div>
        `;

        // Initialize API for testing
        if (window.teableAPI) {
            window.teableAPI.init({
                baseUrl: baseUrl.replace(/\/$/, ''),
                spaceId: spaceId,
                baseId: baseId,
                accessToken: token
            });

            const result = await window.teableAPI.testConnection();
            
            if (result.success) {
                document.getElementById('connectionStatus').innerHTML = `
                    <div class="alert alert-success">
                        <i class="fas fa-check-circle me-2"></i>
                        Connection successful! Working endpoint: ${result.endpoint}
                    </div>
                `;
            } else {
                throw new Error(result.error);
            }
        } else {
            throw new Error('Teable API not loaded');
        }

    } catch (error) {
        document.getElementById('connectionStatus').innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Connection failed: ${error.message}
            </div>
        `;
    }
}

function loadExistingConfigs() {
    const configs = window.teableAuth ? window.teableAuth.getClientConfigs() : [];
    const container = document.getElementById('existingConfigs');
    
    if (!container) return;
    
    if (configs.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-3">
                <i class="fas fa-inbox fa-2x mb-2"></i>
                <p>No client configurations found</p>
                <p class="small">Create your first client configuration above</p>
            </div>
        `;
        return;
    }

    let html = '<div class="row">';
    configs.forEach(config => {
        html += `
            <div class="col-md-6 mb-3">
                <div class="card">
                    <div class="card-body">
                        <h6 class="card-title">
                            <i class="fas fa-building me-2"></i>${config.clientName}
                        </h6>
                        <p class="card-text small">
                            <strong>Admin:</strong> ${config.adminEmail}<br>
                            <strong>URL:</strong> ${config.baseUrl}<br>
                            <strong>Base:</strong> ${config.baseId}<br>
                            <strong>Created:</strong> ${new Date(config.created).toLocaleDateString()}
                        </p>
                        <div class="d-flex gap-2">
                            <button class="btn btn-primary btn-sm" onclick="useConfig('${config.id}')">
                                <i class="fas fa-sign-in-alt me-1"></i>Use Config
                            </button>
                            <button class="btn btn-outline-danger btn-sm" onclick="deleteConfig('${config.id}')">
                                <i class="fas fa-trash me-1"></i>Delete
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    
    container.innerHTML = html;
}

function useConfig(configId) {
    if (!window.teableAuth) return;
    
    const configs = window.teableAuth.getClientConfigs();
    const config = configs.find(c => c.id === configId);
    
    if (config) {
        // Save as current client config
        window.teableAuth.saveClientConfig({
            baseUrl: config.baseUrl,
            spaceId: config.spaceId,
            baseId: config.baseId,
            accessToken: config.accessToken
        });
        
        showAlert('success', 'Configuration loaded successfully!');
        
        // Redirect to login
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1000);
    }
}

function deleteConfig(configId) {
    if (!window.teableAuth) return;
    
    if (confirm('Are you sure you want to delete this client configuration?')) {
        const configs = window.teableAuth.getClientConfigs();
        const updatedConfigs = configs.filter(c => c.id !== configId);
        localStorage.setItem('teable_client_configs', JSON.stringify(updatedConfigs));
        loadExistingConfigs();
        showAlert('info', 'Configuration deleted successfully');
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
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Insert at top of form
    const form = document.getElementById('configForm');
    if (form && form.parentNode) {
        form.parentNode.insertBefore(alertDiv, form);
    }
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}

// Make functions globally available
window.testConnection = testConnection;
window.useConfig = useConfig;
window.deleteConfig = deleteConfig;
window.handleConfigSubmit = handleConfigSubmit;