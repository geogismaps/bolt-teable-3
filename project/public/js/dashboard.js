/**
 * Dashboard Functionality
 */

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication
    if (!window.teableAuth.requireAuth()) return;
    
    initializeDashboard();
});

async function initializeDashboard() {
    try {
        const session = window.teableAuth.getCurrentSession();
        
        // Display user info
        displayUserInfo(session);
        
        // Show admin features if user is admin or creator
        if (session.isAdmin || session.role === 'creator') {
            document.getElementById('quickActions').style.display = 'block';
            document.getElementById('mapConfigCard').style.display = 'block';
            document.getElementById('logsCard').style.display = 'block';
        } else {
            // Hide admin-only cards for non-admin users
            const adminCards = document.querySelectorAll('#mapConfigCard, #logsCard');
            adminCards.forEach(card => {
                card.style.display = 'none';
            });
        }

        // Initialize API
        if (session.userType === 'space_owner') {
            // API should already be initialized from login
            window.teableAPI.init(window.teableAuth.clientConfig);
        }

        // Load dashboard data
        await loadDashboardStats();
        
    } catch (error) {
        console.error('Dashboard initialization failed:', error);
        showError('Failed to load dashboard: ' + error.message);
    }
}

function displayUserInfo(session) {
    const displayName = `${session.firstName} ${session.lastName} (${session.role})`;
    document.getElementById('userDisplay').textContent = displayName;
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