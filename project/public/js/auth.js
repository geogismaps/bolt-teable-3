/**
 * Mixed Authentication System for Teable GIS
 * Supports both Space Owner and App User authentication
 */

class TeableAuth {
    constructor() {
        this.currentSession = null;
        this.clientConfig = null;
    }

    /**
     * Initialize authentication system
     */
    init() {
        this.loadSession();
        this.loadClientConfig();
    }

    /**
     * Authenticate user (auto-detect type)
     */
    async login(email, password, userType = 'auto') {
        try {
            if (!this.clientConfig) {
                throw new Error('Client configuration not found. Please configure the system first.');
            }

            // Initialize API with client config for all authentication attempts
            window.teableAPI.init(this.clientConfig);

            let session = null;

            if (userType === 'space_owner' || userType === 'auto') {
                try {
                    session = await this.authenticateSpaceOwner(email, password);
                    if (session) {
                        console.log('Space owner authentication successful');
                    }
                } catch (error) {
                    console.log('Space owner auth failed:', error.message);
                    if (userType === 'space_owner') throw error;
                }
            }

            if (!session && (userType === 'app_user' || userType === 'auto')) {
                try {
                    session = await this.authenticateAppUser(email, password);
                    if (session) {
                        console.log('App user authentication successful');
                    }
                } catch (error) {
                    console.log('App user auth failed:', error.message);
                    if (userType === 'app_user') throw error;
                }
            }

            if (!session) {
                throw new Error('Authentication failed. Please check your credentials.');
            }

            this.currentSession = session;
            this.saveSession();

            // Log activity
            try {
                await window.teableAPI.logActivity(
                    session.email, 
                    'user_login', 
                    `User logged in as ${session.userType}`
                );
            } catch (logError) {
                console.log('Failed to log activity:', logError.message);
            }

            return session;

        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    }

    /**
     * Authenticate Space Owner using clean logic
     */
    async authenticateSpaceOwner(email, password) {
        try {
            console.log('🔐 Starting space owner authentication...');

            // Step 1: Ensure system tables exist
            await window.teableAPI.ensureSystemTables();

            // Step 2: Get user from local app_users table
            console.log('🔍 Checking local app_users table...');
            const users = await window.teableAPI.getRecords(window.teableAPI.systemTables.users);
            const localUser = users.records?.find(u => 
                u.fields.email === email.toLowerCase() && 
                (u.fields.role === 'Owner' || u.fields.role === 'owner') &&
                u.fields.admin_password_hash // Must have admin password set
            );

            if (!localUser) {
                throw new Error('Space owner not found. Please ensure the admin email was configured correctly during client setup.');
            }

            if (!localUser.fields.is_active) {
                throw new Error('Space owner account is inactive');
            }

            // Step 3: Verify admin password
            if (!localUser.fields.admin_password_hash) {
                throw new Error('Admin password not set for this space owner. Please reconfigure the client.');
            }

            const adminPasswordHash = await window.teableAPI.hashPassword(password);
            if (localUser.fields.admin_password_hash !== adminPasswordHash) {
                throw new Error('Invalid admin password for space owner');
            }

            // Step 4: Update last login
            try {
                await window.teableAPI.updateRecord(
                    window.teableAPI.systemTables.users,
                    localUser.id,
                    { last_login: new Date().toISOString().split('T')[0] }
                );
            } catch (updateError) {
                console.log('Failed to update last login:', updateError.message);
            }

            console.log('✅ Space owner authentication successful');

            return {
                userType: 'space_owner',
                email: localUser.fields.email,
                firstName: localUser.fields.first_name || 'Space',
                lastName: localUser.fields.last_name || 'Owner',
                role: localUser.fields.role,
                userId: localUser.id,
                accessToken: this.clientConfig.accessToken,
                loginTime: new Date().toISOString(),
                isAdmin: true
            };

        } catch (error) {
            throw new Error('Space owner authentication failed: ' + error.message);
        }
    }

    /**
     * Authenticate App User (internal system)
     */
    async authenticateAppUser(email, password) {
        try {
            // Ensure system tables exist
            await window.teableAPI.ensureSystemTables();

            // Get user from app_users table
            const users = await window.teableAPI.getRecords(window.teableAPI.systemTables.users);
            const user = users.records?.find(u => u.fields.email === email);

            if (!user) {
                throw new Error('User not found');
            }

            if (!user.fields.is_active) {
                throw new Error('Account is inactive');
            }

            // Verify password
            const passwordHash = await window.teableAPI.hashPassword(password);
            if (user.fields.password_hash !== passwordHash) {
                throw new Error('Invalid password');
            }

            // Update last login
            try {
                await window.teableAPI.updateRecord(
                    window.teableAPI.systemTables.users,
                    user.id,
                    { last_login: new Date().toISOString().split('T')[0] }
                );
            } catch (updateError) {
                console.log('Failed to update last login:', updateError.message);
            }

            return {
                userType: 'app_user',
                email: user.fields.email,
                firstName: user.fields.first_name,
                lastName: user.fields.last_name,
                role: user.fields.role || 'Viewer',
                userId: user.id,
                loginTime: new Date().toISOString(),
                isAdmin: ['Owner', 'Admin'].includes(user.fields.role)
            };

        } catch (error) {
            throw new Error('App user authentication failed: ' + error.message);
        }
    }

    /**
     * Logout current user
     */
    async logout() {
        if (this.currentSession) {
            try {
                await window.teableAPI.logActivity(
                    this.currentSession.email,
                    'user_logout',
                    'User logged out'
                );
            } catch (error) {
                console.error('Failed to log logout activity:', error);
            }
        }

        this.currentSession = null;
        localStorage.removeItem('teable_session');
        window.location.href = 'login.html';
    }

    /**
     * Get current session
     */
    getCurrentSession() {
        return this.currentSession;
    }

    /**
     * Check if user is admin (owner or admin role)
     */
    isAdmin() {
        return this.currentSession?.isAdmin || ['Owner', 'Admin'].includes(this.currentSession?.role);
    }

    /**
     * Check if user has specific role
     */
    hasRole(role) {
        if (!this.currentSession) return false;
        if (this.isAdmin()) return true;
        return this.currentSession.role === role;
    }

    /**
     * Check role hierarchy (Teable.io style)
     */
    hasRoleOrHigher(requiredRole) {
        if (!this.currentSession) return false;

        const roleHierarchy = {
            'Viewer': 1,
            'Commenter': 2,
            'Editor': 3,
            'Admin': 4,
            'Owner': 5
        };

        const userLevel = roleHierarchy[this.currentSession.role] || 0;
        const requiredLevel = roleHierarchy[requiredRole] || 0;

        return userLevel >= requiredLevel;
    }

    /**
     * Save session to localStorage
     */
    saveSession() {
        if (this.currentSession) {
            localStorage.setItem('teable_session', JSON.stringify(this.currentSession));
        }
    }

    /**
     * Load session from localStorage
     */
    loadSession() {
        try {
            const sessionData = localStorage.getItem('teable_session');
            if (sessionData) {
                this.currentSession = JSON.parse(sessionData);

                // Check if session is expired (24 hours)
                const loginTime = new Date(this.currentSession.loginTime);
                const now = new Date();
                const hoursDiff = (now - loginTime) / (1000 * 60 * 60);

                if (hoursDiff > 24) {
                    console.log('Session expired, logging out');
                    this.logout();
                    return;
                }

                // Restore API configuration for both user types
                if (this.clientConfig) {
                    window.teableAPI.init(this.clientConfig);
                }
            }
        } catch (error) {
            console.error('Failed to load session:', error);
            localStorage.removeItem('teable_session');
        }
    }

    /**
     * Save client configuration
     */
    saveClientConfig(config) {
        this.clientConfig = config;
        localStorage.setItem('teable_client_config', JSON.stringify(config));
    }

    /**
     * Load client configuration
     */
    loadClientConfig() {
        try {
            // First try to load current client config (set by super-admin)
            let configString = localStorage.getItem('currentClientConfig');

            // Fallback to legacy clientConfig
            if (!configString) {
                configString = localStorage.getItem('clientConfig');
            }

            if (configString) {
                this.clientConfig = JSON.parse(configString);

                // Ensure required properties exist
                if (!this.clientConfig.baseUrl && this.clientConfig.teableUrl) {
                    this.clientConfig.baseUrl = this.clientConfig.teableUrl;
                }
                if (!this.clientConfig.accessToken && this.clientConfig.apiToken) {
                    this.clientConfig.accessToken = this.clientConfig.apiToken;
                }

                console.log('Client configuration loaded:', {
                    baseUrl: this.clientConfig.baseUrl,
                    spaceId: this.clientConfig.spaceId,
                    baseId: this.clientConfig.baseId,
                    hasAccessToken: !!this.clientConfig.accessToken
                });

                return this.clientConfig;
            }
            return null;
        } catch (error) {
            console.error('Error loading client config:', error);
            return null;
        }
    }

    /**
     * Get available client configurations
     */
    getClientConfigs() {
        try {
            const configs = localStorage.getItem('teable_client_configs');
            return configs ? JSON.parse(configs) : [];
        } catch (error) {
            console.error('Failed to load client configs:', error);
            return [];
        }
    }

    /**
     * Add client configuration
     */
    addClientConfig(config) {
        try {
            const configs = this.getClientConfigs();
            configs.push({
                ...config,
                id: Date.now().toString(),
                created: new Date().toISOString()
            });
            localStorage.setItem('teable_client_configs', JSON.stringify(configs));
            return configs;
        } catch (error) {
            console.error('Failed to save client config:', error);
            throw error;
        }
    }

    /**
     * Check authentication status and redirect if needed
     */
    requireAuth() {
        if (!this.currentSession) {
            window.location.href = 'login.html';
            return false;
        }

        // Ensure API is configured for authenticated users
        if (this.clientConfig && !window.teableAPI.config.baseUrl) {
            window.teableAPI.init(this.clientConfig);
        }

        return true;
    }

    /**
     * Require admin privileges (owner or admin)
     */
    requireAdmin() {
        if (!this.requireAuth()) return false;
        if (!this.isAdmin()) {
            alert('Access denied. Admin privileges required.');
            window.location.href = 'dashboard.html';
            return false;
        }
        return true;
    }
}

// Initialize global auth instance
window.teableAuth = new TeableAuth();
window.teableAuth.init();

// Utility functions for UI
window.togglePasswordVisibility = function(inputId) {
    const input = document.getElementById(inputId);
    const icon = input.nextElementSibling?.querySelector('i');

    if (input.type === 'password') {
        input.type = 'text';
        if (icon) icon.className = 'fas fa-eye-slash';
    } else {
        input.type = 'password';
        if (icon) icon.className = 'fas fa-eye';
    }
};

window.logout = function() {
    if (confirm('Are you sure you want to logout?')) {
        window.teableAuth.logout();
    }
};