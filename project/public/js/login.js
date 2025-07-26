/**
 * Login Page Functionality
 */

document.addEventListener('DOMContentLoaded', function() {
    loadClientConfigs();
    setupUserTypeToggle();
    setupLoginForm();
});

function loadClientConfigs() {
    const configs = window.teableAuth.getClientConfigs();
    const selector = document.getElementById('clientSelector');
    
    selector.innerHTML = '<option value="">Choose a client configuration...</option>';
    
    configs.forEach(config => {
        const option = document.createElement('option');
        option.value = config.id;
        option.textContent = `${config.clientName} (${config.adminEmail})`;
        selector.appendChild(option);
    });
    
    // Auto-select if only one config
    if (configs.length === 1) {
        selector.value = configs[0].id;
        onClientChange();
    }
}

function onClientChange() {
    const configId = document.getElementById('clientSelector').value;
    const loginForm = document.getElementById('loginForm');
    
    if (configId) {
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
            
            // Show login form
            loginForm.style.display = 'block';
            
            // Clear previous values
            document.getElementById('loginEmail').value = '';
            document.getElementById('loginPassword').value = '';
        }
    } else {
        loginForm.style.display = 'none';
    }
}

function setupUserTypeToggle() {
    const userTypeRadios = document.querySelectorAll('input[name="userType"]');
    userTypeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            const spaceOwnerHelp = document.getElementById('spaceOwnerHelp');
            const appUserHelp = document.getElementById('appUserHelp');
            
            if (this.value === 'space_owner') {
                spaceOwnerHelp.style.display = 'block';
                appUserHelp.style.display = 'none';
            } else {
                spaceOwnerHelp.style.display = 'none';
                appUserHelp.style.display = 'block';
            }
        });
    });
}

function setupLoginForm() {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
}

async function handleLogin(event) {
    event.preventDefault();
    
    try {
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const userType = document.querySelector('input[name="userType"]:checked').value;

        if (!email || !password) {
            throw new Error('Please enter both email and password');
        }

        // Show loading modal
        const loadingModal = new bootstrap.Modal(document.getElementById('loadingModal'));
        loadingModal.show();

        try {
            // Attempt login
            const session = await window.teableAuth.login(email, password, userType);
            
            // Hide loading modal
            loadingModal.hide();
            
            // Redirect to dashboard
            window.location.href = 'dashboard.html';
            
        } catch (error) {
            loadingModal.hide();
            throw error;
        }

    } catch (error) {
        console.error('Login failed:', error);
        showLoginError(error.message);
    }
}

function fillDemoCredentials() {
    document.getElementById('loginEmail').value = 'admin@system.local';
    document.getElementById('loginPassword').value = 'admin123';
    document.querySelector('input[name="userType"][value="app_user"]').checked = true;
    
    // Trigger user type change
    const event = new Event('change');
    document.querySelector('input[name="userType"][value="app_user"]').dispatchEvent(event);
}

function showLoginError(message) {
    // Remove existing alerts
    const existingAlerts = document.querySelectorAll('.alert');
    existingAlerts.forEach(alert => alert.remove());
    
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-danger alert-dismissible fade show';
    alertDiv.innerHTML = `
        <i class="fas fa-exclamation-triangle me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Insert before login form
    const loginForm = document.getElementById('loginForm');
    loginForm.parentNode.insertBefore(alertDiv, loginForm);
    
    // Auto-remove after 8 seconds
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 8000);
}

// Make functions globally available
window.onClientChange = onClientChange;
window.fillDemoCredentials = fillDemoCredentials;