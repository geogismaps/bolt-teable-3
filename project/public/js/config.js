
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
    const baseUrlEl = document.getElementById('baseUrl');
    const spaceIdEl = document.getElementById('spaceId');
    const baseIdEl = document.getElementById('baseId');
    const apiTokenEl = document.getElementById('apiToken');
    
    if (!baseUrlEl || !spaceIdEl || !baseIdEl || !apiTokenEl) {
        showConnectionStatus('Form elements not found. Please check the HTML structure.', 'error');
        return;
    }
    
    const baseUrl = baseUrlEl.value.trim();
    const spaceId = spaceIdEl.value.trim();
    const baseId = baseIdEl.value.trim();
    const apiToken = apiTokenEl.value.trim();
    
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
        
        // First test basic connectivity by trying to get spaces
        console.log('Testing basic API connectivity...');
        let spacesResponse;
        try {
            spacesResponse = await testApi.getSpaces();
            console.log('✅ API connectivity successful');
        } catch (spaceError) {
            if (spaceError.message.includes('403') || spaceError.message.includes('Forbidden')) {
                showConnectionStatus('❌ Connection failed: API token does not have permission to access this Teable instance. Please verify your API token has the correct permissions.', 'error');
                return;
            } else if (spaceError.message.includes('401') || spaceError.message.includes('Unauthorized')) {
                showConnectionStatus('❌ Connection failed: Invalid API token. Please check your API token.', 'error');
                return;
            } else if (spaceError.message.includes('404')) {
                showConnectionStatus('❌ Connection failed: Invalid Teable instance URL. Please check your URL.', 'error');
                return;
            } else {
                throw spaceError;
            }
        }
        
        // Test space access
        console.log('Testing space access...');
        try {
            const spaceInfo = await testApi.getSpace();
            console.log('✅ Space access successful:', spaceInfo.name);
        } catch (spaceError) {
            if (spaceError.message.includes('403') || spaceError.message.includes('Forbidden')) {
                showConnectionStatus('❌ Connection failed: API token does not have permission to access the specified space. Please verify the Space ID and token permissions.', 'error');
                return;
            } else if (spaceError.message.includes('404')) {
                showConnectionStatus('❌ Connection failed: Space not found. Please check your Space ID.', 'error');
                return;
            } else {
                throw spaceError;
            }
        }
        
        // Test base access
        console.log('Testing base access...');
        try {
            const baseInfo = await testApi.getBase();
            if (baseInfo && baseInfo.id) {
                showConnectionStatus(`✅ Connection successful! Base found: "${baseInfo.name}" - All credentials are valid and have proper permissions.`, 'success');
            } else {
                showConnectionStatus('❌ Connection failed: Invalid response from server', 'error');
            }
        } catch (baseError) {
            console.error('Base access error details:', baseError);
            
            if (baseError.message.includes('403') || baseError.message.includes('Forbidden')) {
                showConnectionStatus(`❌ ACCESS DENIED (403 Error)

🚫 **PERMISSION ISSUE DETECTED**

Your API token does not have permission to access this base.

📋 **STEP-BY-STEP FIX:**

1. **Go to Teable.io Dashboard**
   • Open https://app.teable.io
   • Navigate to your workspace

2. **Check API Token Permissions:**
   • Go to Settings → API Tokens
   • Find your current token
   • Ensure it has these permissions:
     ✓ Base Read
     ✓ Record Read
     ✓ Space Read

3. **Verify Base Location:**
   • Current Base ID: ${baseId}
   • Current Space ID: ${spaceId}
   • Go to your base in Teable
   • Check URL: https://app.teable.io/base/${baseId}
   • Ensure this base exists in space ${spaceId}

4. **Create New Token (if needed):**
   • Delete old token
   • Create new token with proper permissions
   • Copy the new token here

⚠️ **COMMON MISTAKES:**
• Token has space access but not base access
• Base is in different space than specified
• Token was revoked or expired

Try creating a NEW API token with full permissions and test again.`, 'error');
                return;
            } else if (baseError.message.includes('404')) {
                showConnectionStatus(`❌ Base Not Found (404 Error)

🔍 POSSIBLE ISSUES:
• Base ID "${baseId}" doesn't exist
• Base might be in a different space
• Check the URL in Teable.io to get the correct Base ID`, 'error');
                return;
            } else {
                throw baseError;
            }
        }
        
    } catch (error) {
        console.error('Connection test failed:', error);
        let errorMessage = 'Unknown error occurred';
        
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            errorMessage = 'Network error: Cannot reach the Teable server. Please check your internet connection and URL.';
        } else if (error.message.includes('CORS')) {
            errorMessage = 'CORS error: The Teable server is blocking requests from this domain.';
        } else {
            errorMessage = error.message;
        }
        
        showConnectionStatus('❌ Connection failed: ' + errorMessage, 'error');
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
        
        // Get form data with null checks
        const clientNameEl = document.getElementById('clientName');
        const adminEmailEl = document.getElementById('adminEmail');
        const adminPasswordEl = document.getElementById('adminPassword');
        const baseUrlEl = document.getElementById('baseUrl');
        const spaceIdEl = document.getElementById('spaceId');
        const baseIdEl = document.getElementById('baseId');
        const apiTokenEl = document.getElementById('apiToken');
        
        if (!clientNameEl || !adminEmailEl || !adminPasswordEl || !baseUrlEl || !spaceIdEl || !baseIdEl || !apiTokenEl) {
            throw new Error('Cannot read properties of null (reading \'value\') - Form elements not found');
        }
        
        const formData = {
            clientName: clientNameEl.value.trim(),
            adminEmail: adminEmailEl.value.trim(),
            adminPassword: adminPasswordEl.value.trim(),
            baseUrl: baseUrlEl.value.trim(),
            spaceId: spaceIdEl.value.trim(),
            baseId: baseIdEl.value.trim(),
            apiToken: apiTokenEl.value.trim()
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

// Add verification helper function
async function verifyConfiguration() {
    const baseUrlEl = document.getElementById('baseUrl');
    const spaceIdEl = document.getElementById('spaceId'); 
    const baseIdEl = document.getElementById('baseId');
    const apiTokenEl = document.getElementById('apiToken');
    
    const baseUrl = baseUrlEl.value.trim();
    const spaceId = spaceIdEl.value.trim(); 
    const baseId = baseIdEl.value.trim();
    const apiToken = apiTokenEl.value.trim();
    
    showConnectionStatus('🔍 Verifying configuration step by step...', 'info');
    
    // Step 1: Check URL format
    try {
        new URL(baseUrl);
        console.log('✅ URL format is valid');
    } catch {
        showConnectionStatus('❌ Invalid URL format. Please use: https://app.teable.io', 'error');
        return;
    }
    
    // Step 2: Check ID formats
    if (!spaceId.startsWith('spc')) {
        showConnectionStatus('⚠️ Space ID should start with "spc". Current: ' + spaceId, 'error');
        return;
    }
    
    if (!baseId.startsWith('bse')) {
        showConnectionStatus('⚠️ Base ID should start with "bse". Current: ' + baseId, 'error');
        return;
    }
    
    // Step 3: Check token format
    if (apiToken.length < 10) {
        showConnectionStatus('⚠️ API token seems too short. Please check your token.', 'error');
        return;
    }
    
    showConnectionStatus(`✅ Configuration format looks good:
• URL: ${baseUrl}
• Space ID: ${spaceId} ✓
• Base ID: ${baseId} ✓
• Token: ${apiToken.substring(0, 8)}... ✓

Now testing API connection...`, 'info');
    
    // Continue with connection test
    setTimeout(() => testConnection(), 2000);
}

// Make functions globally available
window.testConnection = testConnection;
window.verifyConfiguration = verifyConfiguration;
window.deleteConfig = deleteConfig;
