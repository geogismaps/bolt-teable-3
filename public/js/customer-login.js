document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const loginBtn = document.getElementById('loginBtn');

    const existingSession = localStorage.getItem('customer_session');
    if (existingSession) {
        try {
            const session = JSON.parse(existingSession);
            if (session.customerId) {
                if (!session.dataSource) {
                    window.location.href = '/data-source-setup.html';
                } else {
                    window.location.href = '/dashboard.html';
                }
                return;
            }
        } catch (e) {
            localStorage.removeItem('customer_session');
        }
    }

    loginForm.addEventListener('submit', handleLogin);
});

async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');

    if (!email || !password) {
        showAlert('Please enter both email and password', 'danger');
        return;
    }

    loginBtn.disabled = true;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Signing in...';

    try {
        const response = await fetch('/api/auth/customer/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email: email,
                password: password
            })
        });

        const data = await response.json();

        if (response.status === 300) {
            showAlert(data.message || 'Multiple accounts found. Please contact support.', 'warning');
            loginBtn.disabled = false;
            loginBtn.innerHTML = '<i class="fas fa-sign-in-alt me-2"></i>Sign In';
            return;
        }

        if (!response.ok) {
            throw new Error(data.error || 'Login failed');
        }

        if (data.success && data.session) {
            const session = {
                customerId: data.session.customerId,
                userId: data.session.userId,
                email: data.session.email,
                role: data.session.role,
                sessionToken: data.session.sessionToken,
                customerName: data.session.customerName,
                subdomain: data.session.subdomain,
                dataSource: data.session.dataSource,
                primaryColor: data.session.primaryColor,
                secondaryColor: data.session.secondaryColor
            };

            localStorage.setItem('customer_session', JSON.stringify(session));

            showAlert('Login successful! Redirecting...', 'success');

            setTimeout(() => {
                if (!session.dataSource) {
                    window.location.href = '/data-source-setup.html';
                } else {
                    window.location.href = '/dashboard.html';
                }
            }, 1000);
        } else {
            throw new Error('Invalid response from server');
        }

    } catch (error) {
        console.error('Login error:', error);
        showAlert(error.message || 'Login failed. Please check your credentials.', 'danger');
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt me-2"></i>Sign In';
    }
}

function togglePassword() {
    const passwordInput = document.getElementById('password');
    const toggleIcon = document.getElementById('toggleIcon');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleIcon.classList.remove('fa-eye');
        toggleIcon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        toggleIcon.classList.remove('fa-eye-slash');
        toggleIcon.classList.add('fa-eye');
    }
}

function showAlert(message, type) {
    const alertContainer = document.getElementById('alertContainer');
    const alertHtml = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-circle' : 'info-circle'} me-2"></i>
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    alertContainer.innerHTML = alertHtml;

    setTimeout(() => {
        const alert = alertContainer.querySelector('.alert');
        if (alert) {
            alert.classList.remove('show');
            setTimeout(() => alert.remove(), 150);
        }
    }, 5000);
}
