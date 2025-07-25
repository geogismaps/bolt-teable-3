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

    if (configs.length === 0) {
        selector.innerHTML = '<option value="">No configurations available - Contact administrator</option>';
        selector.disabled = true;
        return;
    }

    // Add configurations
    configs.forEach(config => {
        const option = document.createElement('option');
        option.value = config.id;
        option.textContent = `${config.clientName} (${config.adminEmail})`;
        selector.appendChild(option);
    });

    // Select previously selected config
    const savedConfig = localStorage.getItem('selectedClientConfig');
    if (savedConfig) {
        selector.value = savedConfig;
        onClientConfigChange();
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

        console.log('🔐 Attempting login with:', { email, configId: selectedConfigId });

        const authResult = await window.teableAuth.login({ email, password });

        if (authResult.success) {
            console.log('✅ Login successful:', authResult.session);
            showAlert('Login successful! Redirecting...', 'success');

            // Redirect to dashboard after a short delay
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1000);
        } else {
            throw new Error(authResult.message || 'Login failed');
        }

    } catch (error) {
        console.error('❌ Login error:', error);
        showAlert('Login failed: ' + error.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

function showAlert(message, type) {
    // Remove existing alerts
    const existingAlerts = document.querySelectorAll('.alert');
    existingAlerts.forEach(alert => alert.remove());

    const alertClass = type === 'success' ? 'alert-success' : 'alert-danger';
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${alertClass} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    // Insert at the top of the form
    const container = document.querySelector('.card-body');
    container.insertBefore(alertDiv, container.firstChild);

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