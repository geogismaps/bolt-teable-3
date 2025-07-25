/**
 * Dashboard Functionality
 */

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication first
    if (!window.teableAuth.requireAuth()) return;

    // For dashboard, allow all authenticated users but show different content based on role
    initializeDashboard();
});

async function initializeDashboard() {
    try {
        const session = window.teableAuth.getCurrentSession();
        document.getElementById('userDisplay').textContent = 
            `${session.firstName} ${session.lastName} (${session.role})`;

        // Initialize API with client config
        const clientConfig = window.teableAuth.clientConfig;
        if (clientConfig && window.teableAPI) {
            window.teableAPI.init(clientConfig);
        }

        // Show/hide admin features based on role
        updateUIForUserRole(session);

        // Load dashboard data
        await loadDashboardStats();
        await loadRecentActivity();
        await loadSystemHealth();

    } catch (error) {
        console.error('Dashboard initialization failed:', error);
        showError('Failed to initialize dashboard: ' + error.message);
    }
}

function updateUIForUserRole(session) {
    const isAdmin = window.teableAuth.isAdmin();

    // Show/hide admin-only sections
    const adminSections = document.querySelectorAll('.admin-only');
    adminSections.forEach(section => {
        section.style.display = isAdmin ? 'block' : 'none';
    });

    // Update navigation visibility
    updateNavigationForRole(isAdmin);

    console.log('UI updated for role:', session.role, 'isAdmin:', isAdmin);
}

function updateNavigationForRole(isAdmin) {
    // Update sidebar navigation if it exists
    const adminNavItems = document.querySelectorAll('.nav-item.admin-only');
    adminNavItems.forEach(item => {
        item.style.display = isAdmin ? 'block' : 'none';
    });
}

async function loadDashboardStats() {
    try {
        // Load tables
        const tablesData = await window.teableAPI.getTables();
        const allTables = tablesData.tables || tablesData || [];
        const userTables = allTables.filter(t => 
            !t.name.startsWith('app_') && 
            !t.name.startsWith('field_') && 
            !t.name.startsWith('system_') &&
            t.name !== 'data_change_logs'
        );

        document.getElementById('statTables').textContent = userTables.length;

        // Load users count
        if (window.teableAPI.systemTables.users) {
            const usersData = await window.teableAPI.getRecords(window.teableAPI.systemTables.users);
            document.getElementById('statUsers').textContent = usersData.records?.length || 0;
        }

        // Count total records (sample from first few tables)
        let totalRecords = 0;
        const tablesToSample = userTables.slice(0, 3); // Sample first 3 tables

        for (const table of tablesToSample) {
            try {
                const records = await window.teableAPI.getRecords(table.id, { limit: 1000 });
                totalRecords += records.records?.length || 0;
            } catch (error) {
                console.log('Failed to count records for table:', table.name);
            }
        }

        document.getElementById('statRecords').textContent = totalRecords;

        // Activity count
        if (window.teableAPI.systemTables.activity) {
            try {
                const activityData = await window.teableAPI.getRecords(window.teableAPI.systemTables.activity, { limit: 100 });
                document.getElementById('statActivity').textContent = activityData.records?.length || 0;
            } catch (error) {
                document.getElementById('statActivity').textContent = '0';
            }
        } else {
            document.getElementById('statActivity').textContent = '0';
        }

    } catch (error) {
        console.error('Error loading dashboard stats:', error);
        // Set default values on error
        document.getElementById('statTables').textContent = '0';
        document.getElementById('statUsers').textContent = '0';
        document.getElementById('statRecords').textContent = '0';
        document.getElementById('statActivity').textContent = '0';
    }
}

function showProfile() {
    const session = window.teableAuth.getCurrentSession();

    alert(`Profile Information:

Name: ${session.firstName} ${session.lastName}
Email: ${session.email}
Role: ${session.role}
User Type: ${session.userType}
Login Time: ${new Date(session.loginTime).toLocaleString()}
Admin: ${session.isAdmin ? 'Yes' : 'No'}`);
}

function showError(message) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-danger alert-dismissible fade show';
    alertDiv.innerHTML = `
        <i class="fas fa-exclamation-triangle me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    document.body.insertBefore(alertDiv, document.body.firstChild);

    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 8000);
}

// Make functions globally available
window.showProfile = showProfile;