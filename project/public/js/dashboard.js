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
        const clientConfig = window.teableAuth.clientConfig;
        
        // Update user display with client information
        document.getElementById('userDisplay').textContent = 
            `${session.firstName} ${session.lastName} (${session.role})`;
            
        // Show client information
        if (clientConfig) {
            const clientInfo = document.getElementById('clientInfo');
            if (clientInfo) {
                clientInfo.innerHTML = `
                    <div class="alert alert-primary">
                        <strong><i class="fas fa-building me-2"></i>${clientConfig.clientName}</strong><br>
                        <small>Base: ${clientConfig.baseId} | Space: ${clientConfig.spaceId}</small>
                    </div>
                `;
            }
            
            // Initialize API with client config
            window.teableAPI.init(clientConfig);
        }

        // Show/hide admin features based on role
        updateUIForUserRole(session);

        // Load dashboard data
        await loadDashboardStats();
        await loadRecentActivity();
        await loadSystemHealth();

        console.log(`✅ Dashboard initialized for client: ${clientConfig?.clientName || 'Unknown'}`);

    } catch (error) {
        console.error('Dashboard initialization failed:', error);
        showError('Failed to initialize dashboard: ' + error.message);
    }
}

function updateUIForUserRole(session) {
    const isAdmin = window.teableAuth.isAdmin();
    const clientConfig = window.teableAuth.clientConfig;

    console.log('Updating UI for:', {
        role: session.role,
        isAdmin: isAdmin,
        isConfigAdmin: session.isConfigAdmin,
        client: clientConfig?.clientName
    });

    // Hide super admin sections (config management) - only for super admin
    const superAdminSections = document.querySelectorAll('.super-admin-only');
    superAdminSections.forEach(section => {
        section.style.display = session.isConfigAdmin ? 'block' : 'none';
    });

    // Show ALL client tabs for authenticated users - this is the main functionality
    const clientTabs = document.querySelectorAll('.client-tab');
    clientTabs.forEach(tab => {
        tab.style.display = 'block';
        console.log('Showing client tab:', tab.querySelector('h5')?.textContent || 'Unknown');
    });

    // Apply role-based restrictions within features
    updateClientFeatures(session);

    // Update page title and branding to show client name
    if (clientConfig) {
        document.title = `${clientConfig.clientName} - Dashboard`;
        
        // Update any client name placeholders
        const clientNameElements = document.querySelectorAll('.client-name-placeholder');
        clientNameElements.forEach(el => {
            el.textContent = clientConfig.clientName;
        });

        // Update header with client information
        const headerTitle = document.querySelector('h1');
        if (headerTitle && headerTitle.textContent.includes('Dashboard')) {
            headerTitle.innerHTML = `<i class="fas fa-building me-2"></i>${clientConfig.clientName} Dashboard`;
        }
    }

    console.log('✅ UI updated - All client features should be accessible based on role');
}

function updateClientFeatures(session) {
    // Show/hide features based on role within the client base
    const isClientAdmin = session.role === 'owner' || session.role === 'admin';
    
    // User management only for client admins
    const userMgmtSections = document.querySelectorAll('.client-admin-only');
    userMgmtSections.forEach(section => {
        section.style.display = isClientAdmin ? 'block' : 'none';
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

async function loadRecentActivity() {
    try {
        if (!window.teableAPI.systemTables.activity) {
            console.log('Activity table not available');
            return;
        }

        const activityData = await window.teableAPI.getRecords(window.teableAPI.systemTables.activity, { 
            limit: 10,
            sort: [{ field: 'timestamp', order: 'desc' }]
        });
        
        const activities = activityData.records || [];
        console.log('Recent activities loaded:', activities.length);
        
    } catch (error) {
        console.error('Error loading recent activity:', error);
    }
}

async function loadSystemHealth() {
    try {
        const session = window.teableAuth.getCurrentSession();
        const clientConfig = window.teableAuth.clientConfig;
        
        // Basic health check - verify API connectivity
        const tables = await window.teableAPI.getTables();
        const isHealthy = tables && (tables.length > 0 || Array.isArray(tables));
        
        console.log('System health check:', isHealthy ? 'Healthy' : 'Issues detected');
        console.log('Client:', clientConfig?.clientName || 'Unknown');
        console.log('Base ID:', clientConfig?.baseId || 'Unknown');
        
    } catch (error) {
        console.error('System health check failed:', error);
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