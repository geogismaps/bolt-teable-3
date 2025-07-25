
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
    
    // Validate ID formats first
    if (!spaceId.startsWith('spc')) {
        showConnectionStatus(`❌ Invalid Space ID format
        
Space ID should start with "spc" but you entered: "${spaceId}"

**How to find Space ID:**
1. Go to https://app.teable.io
2. Look at the URL: /space/[SPACE_ID]
3. Copy the part that starts with "spc"`, 'error');
        return;
    }
    
    if (!baseId.startsWith('bse')) {
        showConnectionStatus(`❌ Invalid Base ID format
        
Base ID should start with "bse" but you entered: "${baseId}"

**How to find Base ID:**
1. Go to your base in Teable
2. Look at the URL: /base/[BASE_ID] 
3. Copy the part that starts with "bse"`, 'error');
        return;
    }
    
    if (apiToken.length < 20) {
        showConnectionStatus(`❌ API token seems too short
        
API tokens are usually longer than 20 characters.
Your token: ${apiToken.length} characters

**How to get a valid token:**
1. Go to Settings → API Tokens in Teable
2. Create a new token with proper permissions
3. Copy the full token (it's quite long)`, 'error');
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
                showConnectionStatus(`❌ ACCESS DENIED (403 Error) - PERMISSION ISSUE DETECTED

🚫 **YOUR API TOKEN LACKS REQUIRED PERMISSIONS**

**STEP-BY-STEP FIX:**

**1. CREATE NEW API TOKEN (RECOMMENDED)**
   • Go to https://app.teable.io/settings/tokens
   • Click "Create New Token"
   • Name it: "GIS System Access"
   • **CRITICAL:** Select these permissions:
     ✅ Base Read ✅ Record Read ✅ Record Write ✅ Record Delete
     ✅ Space Read ✅ Table Read ✅ Field Read
   • Copy the FULL token (starts with "tbl_" usually)

**2. VERIFY YOUR IDS ARE CORRECT**
   • Base ID: ${baseId} (should start with "bse")
   • Space ID: ${spaceId} (should start with "spc")
   • **How to find correct IDs:**
     - Go to your Teable base
     - URL shows: .../space/YOUR_SPACE_ID/base/YOUR_BASE_ID
     - Copy these exact values

**3. CHECK TOKEN WORKSPACE**
   • Ensure token was created in the SAME workspace where your base exists
   • Token must have access to Space: ${spaceId}

**4. COMMON MISTAKES TO AVOID**
   ❌ Using a token from different workspace
   ❌ Token created without "Base Read" permission
   ❌ Copying partial token (tokens are usually 40+ characters)
   ❌ Using wrong Base ID or Space ID

**5. TEST AGAIN**
   After creating new token with proper permissions, paste it above and click "Test Connection"

**If still failing:** Your base might be in a different space or workspace than expected.`, 'error');
                return;
            } else if (baseError.message.includes('404')) {
                showConnectionStatus(`❌ Base Not Found (404 Error)

🔍 **HOW TO FIX:**

1. **Verify Base ID:**
   • Current Base ID: ${baseId}
   • Go to https://app.teable.io
   • Navigate to your base
   • Copy Base ID from URL: /base/[BASE_ID]

2. **Check Space Location:**
   • Ensure base exists in Space: ${spaceId}
   • Base might be in a different space

3. **Double-check IDs:**
   • Base ID should start with "bse"
   • Space ID should start with "spc"

Try updating the Base ID and test again.`, 'error');
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
        
        // Try to create space owner (optional)
        console.log('🔄 Setting up space owner (optional)...');
        const userResult = await setupSpaceOwner(formData);
        if (userResult) {
            console.log('✅ User setup completed');
        } else {
            console.log('ℹ️ User setup skipped - no Users table found or creation failed');
        }
        
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
        // First, check if Users table exists by trying to get tables
        const tables = await api.getTables();
        const usersTable = tables.find(table => 
            table.name === 'Users' || table.name === 'users' || table.name === 'User'
        );
        
        if (!usersTable) {
            console.log('ℹ️ No Users table found in this base - skipping user creation');
            return null;
        }
        
        console.log(`✅ Found Users table: ${usersTable.name}`);
        
        // Try to check if user already exists
        try {
            const existingUsers = await api.getRecords(usersTable.id || usersTable.name);
            const records = existingUsers.records || existingUsers;
            
            if (Array.isArray(records)) {
                const existingUser = records.find(user => 
                    user.fields && (
                        user.fields.Email === formData.adminEmail ||
                        user.fields.email === formData.adminEmail
                    )
                );
                
                if (existingUser) {
                    console.log('✅ User already exists:', existingUser.fields.Email || existingUser.fields.email);
                    return existingUser;
                }
            }
        } catch (recordError) {
            console.log('ℹ️ Could not check existing users - will try to create new user');
        }
        
        // Try to get table structure
        let tableInfo = null;
        try {
            tableInfo = await api.getTable(usersTable.id || usersTable.name);
        } catch (tableError) {
            console.log('ℹ️ Could not get table structure - using basic user data');
        }
        
        // Create basic user data
        const userData = {
            Email: formData.adminEmail,
            Role: 'Admin',
            'Created Date': new Date().toISOString().split('T')[0],
            Status: 'Active'
        };
        
        // Add password if supported
        if (formData.adminPassword) {
            userData.Password = formData.adminPassword;
        }
        
        // Add owner/client information
        userData.Owner = formData.clientName;
        userData.Client = formData.clientName;
        
        console.log('🔄 Creating user with data:', userData);
        
        try {
            const newUser = await api.createRecord(usersTable.id || usersTable.name, userData);
            console.log('✅ Space owner created successfully');
            return newUser;
        } catch (createError) {
            console.log('⚠️ Could not create user record - this is optional and configuration will still work');
            console.log('User creation error:', createError.message);
            return null;
        }
        
    } catch (error) {
        console.log('⚠️ User setup failed but configuration will continue:', error.message);
        // Don't throw error - user creation is optional
        return null;
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
        <div class="card mb-3 client-config-card" style="cursor: pointer; transition: all 0.3s ease;">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start" onclick="accessClientDashboard('${config.id}')">
                    <div class="flex-grow-1">
                        <h6 class="card-title mb-2">
                            <i class="fas fa-building text-primary me-2"></i>
                            ${config.clientName}
                        </h6>
                        <p class="card-text mb-2">
                            <small class="text-muted">
                                <i class="fas fa-envelope me-1"></i>Email: ${config.adminEmail}<br>
                                <i class="fas fa-link me-1"></i>Base URL: ${config.baseUrl}<br>
                                <i class="fas fa-calendar me-1"></i>Created: ${new Date(config.createdAt).toLocaleDateString()}
                            </small>
                        </p>
                        <div class="mt-2">
                            <span class="badge bg-primary me-1">
                                <i class="fas fa-database me-1"></i>Base: ${config.baseId}
                            </span>
                            <span class="badge bg-info me-1">
                                <i class="fas fa-cube me-1"></i>Space: ${config.spaceId}
                            </span>
                        </div>
                        <div class="mt-3">
                            <button class="btn btn-primary btn-sm me-2" onclick="event.stopPropagation(); accessClientDashboard('${config.id}')">
                                <i class="fas fa-tachometer-alt me-1"></i>Access Dashboard
                            </button>
                            <button class="btn btn-outline-secondary btn-sm me-2" onclick="event.stopPropagation(); viewClientDetails('${config.id}')">
                                <i class="fas fa-info-circle me-1"></i>Details
                            </button>
                        </div>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); deleteConfig('${config.id}')" title="Delete Configuration">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
    
    // Add hover effects
    const cards = container.querySelectorAll('.client-config-card');
    cards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-2px)';
            this.style.boxShadow = '0 4px 15px rgba(0,0,0,0.1)';
        });
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '';
        });
    });
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

function accessClientDashboard(configId) {
    try {
        // Set the selected client configuration
        localStorage.setItem('selectedClientConfig', configId);
        
        // Get the config details
        const configs = JSON.parse(localStorage.getItem('clientConfigs') || '[]');
        const selectedConfig = configs.find(config => config.id === configId);
        
        if (!selectedConfig) {
            showConfigAlert('Configuration not found!', 'error');
            return;
        }
        
        // Initialize the auth module with this config
        if (window.teableAuth) {
            window.teableAuth.selectClientConfig(configId);
        }
        
        showConfigAlert(`Accessing ${selectedConfig.clientName} dashboard...`, 'info');
        
        // Redirect to login page to authenticate for this client
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 1000);
        
    } catch (error) {
        console.error('Error accessing client dashboard:', error);
        showConfigAlert('Failed to access client dashboard: ' + error.message, 'error');
    }
}

function viewClientDetails(configId) {
    const configs = JSON.parse(localStorage.getItem('clientConfigs') || '[]');
    const config = configs.find(c => c.id === configId);
    
    if (!config) {
        showConfigAlert('Configuration not found!', 'error');
        return;
    }
    
    const detailsModal = `
        <div class="modal fade" id="clientDetailsModal" tabindex="-1" aria-hidden="true">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-building me-2"></i>
                            ${config.clientName} - Configuration Details
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row">
                            <div class="col-md-6">
                                <h6><i class="fas fa-info-circle text-primary me-2"></i>Basic Information</h6>
                                <table class="table table-borderless table-sm">
                                    <tr><td><strong>Client Name:</strong></td><td>${config.clientName}</td></tr>
                                    <tr><td><strong>Admin Email:</strong></td><td>${config.adminEmail}</td></tr>
                                    <tr><td><strong>Created:</strong></td><td>${new Date(config.createdAt).toLocaleString()}</td></tr>
                                    <tr><td><strong>Configuration ID:</strong></td><td><code>${config.id}</code></td></tr>
                                </table>
                            </div>
                            <div class="col-md-6">
                                <h6><i class="fas fa-database text-info me-2"></i>Teable Configuration</h6>
                                <table class="table table-borderless table-sm">
                                    <tr><td><strong>Base URL:</strong></td><td><a href="${config.baseUrl}" target="_blank">${config.baseUrl}</a></td></tr>
                                    <tr><td><strong>Space ID:</strong></td><td><code>${config.spaceId}</code></td></tr>
                                    <tr><td><strong>Base ID:</strong></td><td><code>${config.baseId}</code></td></tr>
                                    <tr><td><strong>API Token:</strong></td><td><code>${config.accessToken.substring(0, 8)}...****</code></td></tr>
                                </table>
                            </div>
                        </div>
                        <hr>
                        <div class="row">
                            <div class="col-12">
                                <h6><i class="fas fa-cogs text-success me-2"></i>Available Features</h6>
                                <div class="row">
                                    <div class="col-md-6">
                                        <ul class="list-unstyled">
                                            <li><i class="fas fa-map text-primary me-2"></i>Interactive Map</li>
                                            <li><i class="fas fa-table text-info me-2"></i>Data Management</li>
                                            <li><i class="fas fa-globe text-success me-2"></i>Public Map</li>
                                            <li><i class="fas fa-clipboard-list text-warning me-2"></i>Activity Logs</li>
                                        </ul>
                                    </div>
                                    <div class="col-md-6">
                                        <ul class="list-unstyled">
                                            <li><i class="fas fa-shield-alt text-danger me-2"></i>Permissions Management</li>
                                            <li><i class="fas fa-users text-dark me-2"></i>User Management</li>
                                            <li><i class="fas fa-cog text-secondary me-2"></i>Map Configuration</li>
                                            <li><i class="fas fa-lock text-primary me-2"></i>Role-Based Access</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" onclick="accessClientDashboard('${config.id}'); bootstrap.Modal.getInstance(document.getElementById('clientDetailsModal')).hide();">
                            <i class="fas fa-sign-in-alt me-1"></i>Access Dashboard
                        </button>
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if present
    const existingModal = document.getElementById('clientDetailsModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', detailsModal);
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('clientDetailsModal'));
    modal.show();
}

// Make functions globally available
window.testConnection = testConnection;
window.verifyConfiguration = verifyConfiguration;
window.deleteConfig = deleteConfig;
window.accessClientDashboard = accessClientDashboard;
window.viewClientDetails = viewClientDetails;
