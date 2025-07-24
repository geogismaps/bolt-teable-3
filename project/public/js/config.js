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
            adminPassword: document.getElementById('adminPassword').value.trim(),
            baseUrl: document.getElementById('teableUrl').value.trim(),
            spaceId: document.getElementById('spaceId').value.trim(),
            baseId: document.getElementById('baseId').value.trim(),
            accessToken: document.getElementById('apiToken').value.trim()
        };

        // Validation
        if (!config.clientName || !config.adminEmail || !config.adminPassword || 
            !config.baseUrl || !config.baseId || !config.accessToken) {
            throw new Error('Please fill in all required fields including admin password');
        }

        if (!config.adminEmail.includes('@')) {
            throw new Error('Please enter a valid email address');
        }

        if (config.adminPassword.length < 6) {
            throw new Error('Admin password must be at least 6 characters long');
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

            // Create default admin
            await window.teableAPI.createDefaultAdmin();

            // Now set up the space owner with admin credentials
            showAlert('info', 'Setting up space owner authentication...');
            await setupSpaceOwner(config);
        }

        // Save configuration (without the password for security)
        const configToSave = { ...config };
        delete configToSave.adminPassword; // Don't save password in client config

        const savedConfigs = window.teableAuth.addClientConfig(configToSave);

        // Set as current config
        window.teableAuth.saveClientConfig({
            baseUrl: config.baseUrl,
            spaceId: config.spaceId,
            baseId: config.baseId,
            accessToken: config.accessToken
        });

        // Show success
        showAlert('success', 'Space owner configuration completed successfully!');

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

/**
 * Set up space owner in local database with admin password
 */
async function setupSpaceOwner(config) {
    try {
        console.log('🔧 Setting up space owner authentication...');

        // Step 1: Try to fetch space owner details from Teable.io
        let spaceOwnerFromTeable = null;
        let spaceOwnerEmail = config.adminEmail.toLowerCase(); // Default to admin email

        try {
            console.log('🔍 Attempting to fetch space owner from Teable.io...');

            const testEndpoints = [
                `/api/space/${config.spaceId}/collaborators`,
                `/api/space/${config.spaceId}/collaborator`,
                `/api/space/${config.spaceId}`,
                `/api/space`
            ];

            for (const endpoint of testEndpoints) {
                try {
                    const result = await window.teableAPI.request(endpoint);

                    // Look for space owner in different response formats
                    if (result.collaborators) {
                        spaceOwnerFromTeable = result.collaborators.find(user => 
                            user.role === 'owner' || user.email === config.adminEmail
                        );
                    } else if (result.members) {
                        spaceOwnerFromTeable = result.members.find(user => 
                            user.role === 'owner' || user.email === config.adminEmail
                        );
                    } else if (result.owner) {
                        spaceOwnerFromTeable = result.owner;
                    } else if (result.email === config.adminEmail) {
                        spaceOwnerFromTeable = result;
                    }

                    if (spaceOwnerFromTeable) {
                        console.log('✅ Found space owner from Teable.io:', spaceOwnerFromTeable);
                        spaceOwnerEmail = spaceOwnerFromTeable.email || config.adminEmail;
                        break;
                    }

                } catch (endpointError) {
                    console.log(`❌ Endpoint ${endpoint} failed:`, endpointError.message);
                }
            }
        } catch (teableError) {
            console.log('⚠️ Could not fetch space owner from Teable.io:', teableError.message);
        }

        // Step 2: Check if space owner already exists in app_users
        console.log('🔍 Checking if space owner exists in local database...');
        const users = await window.teableAPI.getRecords(window.teableAPI.systemTables.users);
        const existingSpaceOwner = users.records?.find(u => 
            u.fields.email === spaceOwnerEmail && u.fields.role === 'owner'
        );

        // Step 3: Hash the admin password
        const adminPasswordHash = await window.teableAPI.hashPassword(config.adminPassword);

        if (existingSpaceOwner) {
            console.log('🔄 Updating existing space owner with admin password...');
            // Update existing space owner with admin password
            await window.teableAPI.updateRecord(
                window.teableAPI.systemTables.users,
                existingSpaceOwner.id,
                {
                    admin_password_hash: adminPasswordHash,
                    is_active: true,
                    synced_from_teable: spaceOwnerFromTeable ? true : false,
                    teable_user_id: spaceOwnerFromTeable?.id || 'manual_setup'
                }
            );
            console.log('✅ Updated existing space owner');
        } else {
            console.log('➕ Creating new space owner record...');

            // Parse name from Teable.io data or email
            let firstName = 'Space';
            let lastName = 'Owner';

            if (spaceOwnerFromTeable?.name) {
                const nameParts = spaceOwnerFromTeable.name.split(' ');
                firstName = nameParts[0] || 'Space';
                lastName = nameParts.slice(1).join(' ') || 'Owner';
            } else {
                // Use email prefix as first name
                firstName = spaceOwnerEmail.split('@')[0];
                lastName = 'Owner';
            }

            // Determine the role of the space owner
            let spaceOwnerRole = 'owner'; // Default role

            // Always use the admin email as the space owner email
            const finalSpaceOwnerEmail = config.adminEmail.toLowerCase();

            // Create new space owner record with admin email
            const spaceOwnerData = {
                email: finalSpaceOwnerEmail, // Use admin email as space owner email
                password_hash: await window.teableAPI.hashPassword('temp123'), // Temp password for app user auth
                admin_password_hash: adminPasswordHash, // The actual admin password for space owner auth
                first_name: firstName,
                last_name: lastName,
                role: spaceOwnerRole,
                is_active: true,
                created_date: new Date().toISOString().split('T')[0],
                last_login: null,
                synced_from_teable: spaceOwnerFromTeable ? true : false,
                teable_user_id: spaceOwnerFromTeable?.id || 'admin_setup',
                is_space_owner: true // Add flag to identify this as space owner
            };

            console.log('📝 Creating space owner record with admin email:', finalSpaceOwnerEmail);
            await window.teableAPI.createRecord(window.teableAPI.systemTables.users, spaceOwnerData);
            console.log('✅ Created space owner record with admin email');
        }

        console.log('✅ Space owner setup completed successfully!');

        // Log the setup activity
        await window.teableAPI.logActivity(
            spaceOwnerEmail,
            'space_owner_setup',
            `Space owner configured for client: ${config.clientName}`,
            'app_users'
        );

    } catch (error) {
        console.error('❌ Space owner setup failed:', error);
        throw new Error('Failed to set up space owner: ' + error.message);
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

// Toggle password visibility
function togglePasswordVisibility(inputId) {
    const passwordInput = document.getElementById(inputId);
    const button = passwordInput.nextElementSibling;
    const icon = button.querySelector('i');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// Make functions globally available
window.testConnection = testConnection;
window.useConfig = useConfig;
window.deleteConfig = deleteConfig;
window.handleConfigSubmit = handleConfigSubmit;