
/**
 * Configuration Page Functionality
 */

document.addEventListener('DOMContentLoaded', function() {
    setupConfigForm();
    loadExistingConfigs();
    setupPasswordToggle();
});

function setupConfigForm() {
    const form = document.getElementById('configForm');
    if (form) {
        form.addEventListener('submit', handleConfigSubmit);
    }

    // Add test connection button event listener
    const testBtn = document.querySelector('[onclick="testConnection()"]');
    if (testBtn) {
        testBtn.onclick = testConnection;
    }
}

function setupPasswordToggle() {
    window.togglePasswordVisibility = function(fieldId) {
        const field = document.getElementById(fieldId);
        const button = field.nextElementSibling;
        const icon = button.querySelector('i');
        
        if (field.type === 'password') {
            field.type = 'text';
            icon.className = 'fas fa-eye-slash';
        } else {
            field.type = 'password';
            icon.className = 'fas fa-eye';
        }
    };
}

async function testConnection() {
    const baseUrl = document.getElementById('baseUrl').value.trim();
    const spaceId = document.getElementById('spaceId').value.trim();
    const baseId = document.getElementById('baseId').value.trim();
    const apiToken = document.getElementById('apiToken').value.trim();
    
    const statusDiv = document.getElementById('connectionStatus');
    
    if (!baseUrl || !spaceId || !baseId || !apiToken) {
        showConnectionStatus('Please fill in all fields before testing connection.', 'error');
        return;
    }
    
    showConnectionStatus('Testing connection...', 'info');
    
    try {
        // Initialize API client with test credentials
        const testApi = new TeableAPI({
            baseUrl: baseUrl,
            spaceId: spaceId,
            baseId: baseId,
            accessToken: apiToken
        });
        
        // Test connection by trying to get base info
        const baseInfo = await testApi.getBase();
        
        if (baseInfo && baseInfo.id) {
            showConnectionStatus('✅ Connection successful! Base found: ' + baseInfo.name, 'success');
        } else {
            showConnectionStatus('❌ Connection failed: Invalid response from server', 'error');
        }
    } catch (error) {
        console.error('Connection test failed:', error);
        showConnectionStatus('❌ Connection failed: ' + error.message, 'error');
    }
}

function showConnectionStatus(message, type) {
    const statusDiv = document.getElementById('connectionStatus');
    if (!statusDiv) return;
    
    statusDiv.innerHTML = '';
    
    const alertClass = type === 'success' ? 'alert-success' : 
                     type === 'error' ? 'alert-danger' : 'alert-info';
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${alertClass} mt-2`;
    alertDiv.innerHTML = message;
    
    statusDiv.appendChild(alertDiv);
    
    // Auto-remove after 5 seconds for non-error messages
    if (type !== 'error') {
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        }, 5000);
    }
}

async function handleConfigSubmit(event) {
    event.preventDefault();
    
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    
    try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Creating Configuration...';
        
        // Get form data
        const formData = {
            clientName: document.getElementById('clientName').value.trim(),
            adminEmail: document.getElementById('adminEmail').value.trim(),
            adminPassword: document.getElementById('adminPassword').value.trim(),
            baseUrl: document.getElementById('baseUrl').value.trim(),
            spaceId: document.getElementById('spaceId').value.trim(),
            baseId: document.getElementById('baseId').value.trim(),
            apiToken: document.getElementById('apiToken').value.trim()
        };
        
        // Validate form data
        if (!validateFormData(formData)) {
            return;
        }
        
        // Test connection first
        console.log('🔄 Testing connection before creating configuration...');
        await testConnectionForSubmit(formData);
        
        // Create space owner if needed
        console.log('🔄 Setting up space owner...');
        await setupSpaceOwner(formData);
        
        // Save configuration
        console.log('🔄 Saving client configuration...');
        const configId = saveClientConfig(formData);
        
        showConfigAlert('✅ Client configuration created successfully!', 'success');
        
        // Reset form
        document.getElementById('configForm').reset();
        
        // Reload existing configs
        loadExistingConfigs();
        
        console.log('✅ Configuration created with ID:', configId);
        
    } catch (error) {
        console.error('❌ Configuration failed:', error);
        showConfigAlert('❌ Failed to create configuration: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

function validateFormData(data) {
    const required = ['clientName', 'adminEmail', 'adminPassword', 'baseUrl', 'spaceId', 'baseId', 'apiToken'];
    
    for (const field of required) {
        if (!data[field]) {
            showConfigAlert(`Please fill in the ${field.replace(/([A-Z])/g, ' $1').toLowerCase()} field.`, 'error');
            return false;
        }
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.adminEmail)) {
        showConfigAlert('Please enter a valid email address.', 'error');
        return false;
    }
    
    // Validate URL format
    try {
        new URL(data.baseUrl);
    } catch {
        showConfigAlert('Please enter a valid URL for Teable Instance URL.', 'error');
        return false;
    }
    
    return true;
}

async function testConnectionForSubmit(formData) {
    const testApi = new TeableAPI({
        baseUrl: formData.baseUrl,
        spaceId: formData.spaceId,
        baseId: formData.baseId,
        accessToken: formData.apiToken
    });
    
    try {
        const baseInfo = await testApi.getBase();
        if (!baseInfo || !baseInfo.id) {
            throw new Error('Invalid API response - could not verify base access');
        }
        console.log('✅ Connection test passed');
    } catch (error) {
        throw new Error(`Connection test failed: ${error.message}`);
    }
}

async function setupSpaceOwner(formData) {
    const api = new TeableAPI({
        baseUrl: formData.baseUrl,
        spaceId: formData.spaceId,
        baseId: formData.baseId,
        accessToken: formData.apiToken
    });
    
    try {
        // First, check if user already exists
        const existingUsers = await api.getRecords('Users');
        const existingUser = existingUsers.find(user => 
            user.fields && user.fields.Email === formData.adminEmail
        );
        
        if (existingUser) {
            console.log('✅ User already exists:', existingUser.fields.Email);
            return existingUser;
        }
        
        // Get valid options for Owner field
        const tableInfo = await api.getTable('Users');
        const ownerField = tableInfo.fields.find(field => field.name === 'Owner');
        
        let ownerValue = formData.clientName;
        
        // If Owner field has options, use the first available option or create new one
        if (ownerField && ownerField.options && ownerField.options.choices) {
            const existingChoice = ownerField.options.choices.find(choice => 
                choice.name.toLowerCase() === formData.clientName.toLowerCase()
            );
            
            if (existingChoice) {
                ownerValue = existingChoice.name;
            } else if (ownerField.options.choices.length > 0) {
                // Use first available choice
                ownerValue = ownerField.options.choices[0].name;
            }
        }
        
        // Create new user record
        const userData = {
            Email: formData.adminEmail,
            Password: formData.adminPassword,
            Role: 'Admin',
            Owner: ownerValue,
            'Created Date': new Date().toISOString(),
            Status: 'Active'
        };
        
        console.log('🔄 Creating user with data:', userData);
        const newUser = await api.createRecord('Users', userData);
        console.log('✅ Space owner created successfully');
        return newUser;
        
    } catch (error) {
        console.error('❌ Create record failed:', error);
        throw new Error(`Failed to set up space owner: ${error.message}`);
    }
}

function saveClientConfig(formData) {
    const config = {
        id: 'config_' + Date.now(),
        clientName: formData.clientName,
        adminEmail: formData.adminEmail,
        baseUrl: formData.baseUrl,
        spaceId: formData.spaceId,
        baseId: formData.baseId,
        accessToken: formData.apiToken,
        createdAt: new Date().toISOString()
    };
    
    // Get existing configs
    const configs = JSON.parse(localStorage.getItem('clientConfigs') || '[]');
    
    // Add new config
    configs.push(config);
    
    // Save to localStorage
    localStorage.setItem('clientConfigs', JSON.stringify(configs));
    
    return config.id;
}

function loadExistingConfigs() {
    const configs = JSON.parse(localStorage.getItem('clientConfigs') || '[]');
    const container = document.getElementById('existingConfigs');
    
    if (!container) return;
    
    if (configs.length === 0) {
        container.innerHTML = '<p class="text-muted">No configurations found.</p>';
        return;
    }
    
    container.innerHTML = configs.map(config => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <h6 class="card-title">${config.clientName}</h6>
                        <p class="card-text">
                            <small class="text-muted">
                                Email: ${config.adminEmail}<br>
                                Base URL: ${config.baseUrl}<br>
                                Created: ${new Date(config.createdAt).toLocaleDateString()}
                            </small>
                        </p>
                    </div>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteConfig('${config.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function deleteConfig(configId) {
    if (!confirm('Are you sure you want to delete this configuration?')) {
        return;
    }
    
    const configs = JSON.parse(localStorage.getItem('clientConfigs') || '[]');
    const updatedConfigs = configs.filter(config => config.id !== configId);
    
    localStorage.setItem('clientConfigs', JSON.stringify(updatedConfigs));
    loadExistingConfigs();
    
    showConfigAlert('Configuration deleted successfully.', 'info');
}

function showConfigAlert(message, type) {
    // Remove existing alerts
    const existingAlerts = document.querySelectorAll('.alert');
    existingAlerts.forEach(alert => alert.remove());
    
    const alertClass = type === 'success' ? 'alert-success' : 
                     type === 'error' ? 'alert-danger' : 'alert-info';
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${alertClass} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Insert before the form
    const form = document.getElementById('configForm');
    form.parentNode.insertBefore(alertDiv, form);
    
    // Auto-remove after 8 seconds
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 8000);
}

// Make functions globally available
window.testConnection = testConnection;
window.deleteConfig = deleteConfig;
