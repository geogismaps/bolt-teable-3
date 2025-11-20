/**
 * Data Source Setup Page Logic
 */

let selectedSource = null;
let session = null;

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication
    const sessionStr = localStorage.getItem('customer_session');
    if (!sessionStr) {
        window.location.href = '/login.html';
        return;
    }

    session = JSON.parse(sessionStr);

    // Check if data source already configured
    if (session.dataSource) {
        showMessage('Data source already configured', 'success');
        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 2000);
    }

    // Check if user is owner
    if (session.role !== 'owner') {
        showMessage('Only account owners can configure data sources', 'error');
        document.querySelectorAll('button').forEach(btn => btn.disabled = true);
    }
});

function selectDataSource(source) {
    selectedSource = source;

    // Hide all select buttons and forms
    document.getElementById('selectTeableBtn').style.display = 'none';
    document.getElementById('selectGoogleBtn').style.display = 'none';
    document.getElementById('teableForm').classList.remove('active');
    document.getElementById('googleForm').classList.remove('active');

    // Show selected form
    if (source === 'teable') {
        document.getElementById('teableCard').classList.add('selected');
        document.getElementById('googleCard').style.opacity = '0.5';
        document.getElementById('teableForm').classList.add('active');
    } else if (source === 'google') {
        document.getElementById('googleCard').classList.add('selected');
        document.getElementById('teableCard').style.opacity = '0.5';
        document.getElementById('googleForm').classList.add('active');
    }
}

async function testTeableConnection() {
    const baseUrl = document.getElementById('baseUrl').value.trim();
    const spaceId = document.getElementById('spaceId').value.trim();
    const baseId = document.getElementById('baseId').value.trim();
    const accessToken = document.getElementById('accessToken').value.trim();

    if (!baseUrl || !spaceId || !baseId || !accessToken) {
        showMessage('Please fill in all fields', 'error');
        return;
    }

    const testBtn = document.getElementById('testTeableBtn');
    testBtn.disabled = true;
    testBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Testing...';

    try {
        const response = await fetch(`/api/customers/${session.customerId}/test-teable`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': session.sessionToken
            },
            body: JSON.stringify({
                baseUrl,
                spaceId,
                baseId,
                accessToken
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showMessage('Connection successful!', 'success');
            document.getElementById('saveTeableBtn').disabled = false;
            testBtn.innerHTML = '<i class="fas fa-check me-2"></i>Connected';
            testBtn.classList.remove('btn-primary');
            testBtn.classList.add('btn-success');
        } else {
            showMessage(data.error || 'Connection test failed', 'error');
            testBtn.disabled = false;
            testBtn.innerHTML = '<i class="fas fa-plug me-2"></i>Test Connection';
        }
    } catch (error) {
        console.error('Test connection error:', error);
        showMessage('Network error. Please try again.', 'error');
        testBtn.disabled = false;
        testBtn.innerHTML = '<i class="fas fa-plug me-2"></i>Test Connection';
    }
}

async function saveTeableConfig() {
    const baseUrl = document.getElementById('baseUrl').value.trim();
    const spaceId = document.getElementById('spaceId').value.trim();
    const baseId = document.getElementById('baseId').value.trim();
    const accessToken = document.getElementById('accessToken').value.trim();

    const saveBtn = document.getElementById('saveTeableBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Saving...';

    try {
        const response = await fetch(`/api/customers/${session.customerId}/teable-config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': session.sessionToken
            },
            body: JSON.stringify({
                baseUrl,
                spaceId,
                baseId,
                accessToken
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Update session with data source
            session.dataSource = 'teable';
            localStorage.setItem('customer_session', JSON.stringify(session));

            showMessage('Configuration saved successfully!', 'success');
            saveBtn.innerHTML = '<i class="fas fa-check me-2"></i>Saved!';
            saveBtn.classList.add('btn-success');

            setTimeout(() => {
                window.location.href = '/customer-onboarding.html';
            }, 1500);
        } else {
            showMessage(data.error || 'Failed to save configuration', 'error');
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-check me-2"></i>Save & Continue';
        }
    } catch (error) {
        console.error('Save config error:', error);
        showMessage('Network error. Please try again.', 'error');
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-check me-2"></i>Save & Continue';
    }
}

async function connectGoogleSheets() {
    const connectBtn = document.getElementById('connectGoogleBtn');
    connectBtn.disabled = true;
    connectBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Connecting...';

    try {
        const response = await fetch(
            `/api/auth/google/start?customerId=${session.customerId}&adminEmail=${session.email}`,
            {
                headers: {
                    'X-Session-Token': session.sessionToken
                }
            }
        );

        const data = await response.json();

        if (response.ok && data.authUrl) {
            // Store session for callback
            sessionStorage.setItem('oauth_session', JSON.stringify(session));

            // Redirect to Google OAuth
            window.location.href = data.authUrl;
        } else {
            showMessage(data.error || 'Failed to start OAuth flow', 'error');
            connectBtn.disabled = false;
            connectBtn.innerHTML = '<i class="fab fa-google me-2"></i>Connect with Google';
        }
    } catch (error) {
        console.error('Google OAuth error:', error);
        showMessage('Network error. Please try again.', 'error');
        connectBtn.disabled = false;
        connectBtn.innerHTML = '<i class="fab fa-google me-2"></i>Connect with Google';
    }
}

function showMessage(message, type) {
    const errorDiv = document.getElementById('errorMessage');
    const successDiv = document.getElementById('successMessage');

    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    if (type === 'error') {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
        successDiv.textContent = message;
        successDiv.style.display = 'block';
    }

    setTimeout(() => {
        errorDiv.style.display = 'none';
        successDiv.style.display = 'none';
    }, 5000);
}
