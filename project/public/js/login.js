
/**
 * Login Page Functionality
 */

document.addEventListener('DOMContentLoaded', function() {
    loadClientConfigs();

    // Handle login form submission
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

function loadClientConfigs() {
    const configs = JSON.parse(localStorage.getItem('clientConfigs') || '[]');
    const selector = document.getElementById('clientConfigSelector');

    if (!selector) return;

    // Clear existing options
    selector.innerHTML = '<option value="">Choose a client configuration...</option>';

    // Add config options
    configs.forEach(config => {
        const option = document.createElement('option');
        option.value = config.id;
        option.textContent = `${config.clientName} (${config.adminEmail})`;
        selector.appendChild(option);
    });

    // Check for URL parameter first
    const urlParams = new URLSearchParams(window.location.search);
    const configFromUrl = urlParams.get('config');
    
    let selectedConfigId = configFromUrl || localStorage.getItem('selectedClientConfig');
    
    if (selectedConfigId && configs.find(c => c.id === selectedConfigId)) {
        selector.value = selectedConfigId;
        localStorage.setItem('selectedClientConfig', selectedConfigId);
        onClientConfigChange();

        // Show a welcome message for the selected client
        const selectedConfig = configs.find(c => c.id === selectedConfigId);
        if (selectedConfig) {
            showAlert(`Welcome to ${selectedConfig.clientName}! Please sign in to access your dashboard.`, 'info');
        }
    }
}

function onClientConfigChange() {
    const selector = document.getElementById('clientConfigSelector');
    const configId = selector.value;

    if (configId) {
        // Save selection and update auth module
        window.teableAuth.selectClientConfig(configId);

        // Show login form
        document.getElementById('configSelection').style.display = 'none';
        document.getElementById('loginSection').style.display = 'block';

        // Update config info
        const configs = JSON.parse(localStorage.getItem('clientConfigs') || '[]');
        const selectedConfig = configs.find(c => c.id === configId);
        if (selectedConfig) {
            document.getElementById('selectedConfigName').textContent = selectedConfig.clientName;
            document.getElementById('selectedConfigUrl').textContent = selectedConfig.baseUrl;

            // Pre-fill admin email if it matches
            const emailField = document.getElementById('email');
            if (emailField && selectedConfig.adminEmail) {
                emailField.value = selectedConfig.adminEmail;
            }
        }
    } else {
        // Hide login form
        document.getElementById('configSelection').style.display = 'block';
        document.getElementById('loginSection').style.display = 'none';
    }
}

async function handleLogin(event) {
    event.preventDefault();

    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;

    try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Signing in...';

        // Validate dependencies
        if (!window.teableAPI) {
            throw new Error('Teable API not available. Please refresh the page.');
        }
        if (!window.teableAuth) {
            throw new Error('Authentication module not available. Please refresh the page.');
        }

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        if (!email || !password) {
            throw new Error('Please enter both email and password');
        }

        // Check if we have a client config selected
        const selectedConfigId = localStorage.getItem('selectedClientConfig');
        if (!selectedConfigId) {
            throw new Error('Please select a client configuration first');
        }

        // Validate email format
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(email)) {
            throw new Error('Please enter a valid email address');
        }

        console.log('🔐 Attempting login with:', { email, configId: selectedConfigId });

        // Show loading modal
        const loadingModalElement = document.getElementById('loadingModal');
        if (loadingModalElement) {
            const loadingModal = new bootstrap.Modal(loadingModalElement);
            loadingModal.show();
        }

        // Attempt authentication
        const authResult = await window.teableAuth.login({ email, password });

        // Hide loading modal
        if (loadingModalElement) {
            const loadingModal = bootstrap.Modal.getInstance(loadingModalElement);
            if (loadingModal) {
                loadingModal.hide();
            }
        }

        if (authResult && authResult.success) {
            console.log('✅ Login successful:', authResult.session);
            showAlert('Login successful! Loading your dashboard...', 'success');

            // Redirect to dashboard in same tab after a short delay
            setTimeout(() => {
                window.location.replace('dashboard.html');
            }, 1000);
        } else {
            const errorMessage = (authResult && authResult.message) || 'Login failed - Invalid credentials';
            throw new Error(errorMessage);
        }

    } catch (error) {
        console.error('❌ Login error:', error);
        
        // Hide loading modal if it's showing
        const loadingModalElement = document.getElementById('loadingModal');
        if (loadingModalElement) {
            const loadingModal = bootstrap.Modal.getInstance(loadingModalElement);
            if (loadingModal) {
                loadingModal.hide();
            }
        }
        
        let errorMessage = error.message;
        if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
            errorMessage = 'Network error. Please check your internet connection and try again.';
        } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
            errorMessage = 'Access denied. Please check your credentials and permissions.';
        }
        
        showAlert('Login failed: ' + errorMessage, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

function showAlert(message, type) {
    // Remove existing alerts
    const existingAlerts = document.querySelectorAll('.alert:not(.alert-info)');
    existingAlerts.forEach(alert => alert.remove());

    const alertClass = type === 'success' ? 'alert-success' : 
                     type === 'info' ? 'alert-info' : 'alert-danger';
    const iconClass = type === 'success' ? 'check-circle' : 
                     type === 'info' ? 'info-circle' : 'exclamation-triangle';
    
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${alertClass} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        <i class="fas fa-${iconClass} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    // Insert at the top of the login section or config selection
    const targetContainer = document.getElementById('loginSection').style.display !== 'none' 
        ? document.getElementById('loginSection')
        : document.querySelector('.glass-card');
    
    targetContainer.insertBefore(alertDiv, targetContainer.firstChild);

    // Auto-remove success alerts
    if (type === 'success') {
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        }, 3000);
    }
}

// Make functions globally available
window.onClientConfigChange = onClientConfigChange;
