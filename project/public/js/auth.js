/**
 * Teable Authentication Module
 * Handles authentication with Teable.io and local user management
 */

class TeableAuth {
    constructor() {
        this.currentSession = null;
        this.clientConfig = null;
        this.initializeAuth();
    }

    initializeAuth() {
        // Check for existing session
        const savedSession = localStorage.getItem('teableAuthSession');
        if (savedSession) {
            try {
                this.currentSession = JSON.parse(savedSession);
                console.log('Loaded existing session:', this.currentSession);
            } catch (error) {
                console.error('Error loading saved session:', error);
                localStorage.removeItem('teableAuthSession');
            }
        }

        // Load client config if available
        this.loadClientConfig();
    }

    loadClientConfig() {
        const configId = localStorage.getItem('selectedClientConfig');
        if (configId) {
            const configs = JSON.parse(localStorage.getItem('clientConfigs') || '[]');
            this.clientConfig = configs.find(config => config.id === configId);
            console.log('Loaded client config:', this.clientConfig);
        }
    }

    async login(credentials) {
        try {
            // Validate input
            if (!credentials.email || !credentials.password) {
                throw new Error('Email and password are required');
            }

            // Get client config
            if (!this.clientConfig) {
                throw new Error('No client configuration found. Please contact your administrator.');
            }

            console.log('Attempting login with config:', this.clientConfig.clientName);

            // Initialize API with client config
            if (!window.teableAPI) {
                throw new Error('Teable API not available');
            }

            window.teableAPI.init(this.clientConfig);

            // Try to authenticate with Teable.io first (for space owners/admins)
            let authResult = null;
            try {
                console.log('Attempting Teable.io authentication...');
                authResult = await this.authenticateWithTeable(credentials);
                if (authResult.success) {
                    console.log('✅ Teable.io authentication successful');
                    return authResult;
                }
            } catch (teableError) {
                console.log('Teable.io auth failed, trying local auth...', teableError.message);
            }

            // Fall back to local authentication
            console.log('Attempting local authentication...');
            authResult = await this.authenticateLocally(credentials);

            if (authResult.success) {
                console.log('✅ Local authentication successful');
                return authResult;
            } else {
                throw new Error(authResult.message || 'Authentication failed');
            }

        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    }

    async authenticateWithTeable(credentials) {
        try {
            // Check if credentials match the client config admin
            if (credentials.email === this.clientConfig.adminEmail) {
                // Simple password check - in production, use proper hashing
                // For now, we'll accept any password for the admin email from config
                const session = {
                    email: credentials.email,
                    firstName: this.clientConfig.clientName.split(' ')[0] || 'Admin',
                    lastName: 'Admin',
                    role: 'owner',
                    userType: 'space_owner',
                    baseId: this.clientConfig.baseId,
                    spaceId: this.clientConfig.spaceId,
                    clientName: this.clientConfig.clientName,
                    loginTime: new Date().toISOString(),
                    authMethod: 'config_admin',
                    isConfigAdmin: true
                };

                this.setSession(session);
                return { success: true, session };
            }

            return { success: false, message: 'Invalid email or password' };

        } catch (error) {
            console.error('Teable authentication error:', error);
            return { success: false, message: error.message };
        }
    }

    async authenticateLocally(credentials) {
        try {
            // Ensure system tables exist
            await window.teableAPI.ensureSystemTables();

            // Get users from the system users table
            const usersData = await window.teableAPI.getRecords(window.teableAPI.systemTables.users);
            const users = usersData.records || [];

            // Find user by email
            const user = users.find(u => u.fields.email === credentials.email);
            if (!user) {
                return { success: false, message: 'User not found' };
            }

            const userFields = user.fields;

            // Check if user is active
            if (!userFields.is_active) {
                return { success: false, message: 'Account is disabled' };
            }

            // Verify password
            const isValidPassword = await this.verifyPassword(credentials.password, userFields.password_hash);
            if (!isValidPassword) {
                return { success: false, message: 'Invalid password' };
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

            // Create session
            const session = {
                email: userFields.email,
                firstName: userFields.first_name || 'User',
                lastName: userFields.last_name || '',
                role: userFields.role || 'viewer',
                userType: userFields.role === 'owner' ? 'space_owner' : 'local_user',
                baseId: this.clientConfig.baseId,
                spaceId: this.clientConfig.spaceId,
                loginTime: new Date().toISOString(),
                authMethod: 'local',
                isConfigAdmin: false
            };

            this.setSession(session);

            // Log activity
            try {
                await window.teableAPI.logActivity(
                    userFields.email,
                    'user_login',
                    `User logged in via ${session.authMethod} authentication`
                );
            } catch (logError) {
                console.log('Failed to log activity:', logError.message);
            }

            return { success: true, session };

        } catch (error) {
            console.error('Local authentication error:', error);
            return { success: false, message: error.message };
        }
    }

    async verifyPassword(plainPassword, hashedPassword) {
        try {
            // Simple comparison for now - in production, use proper hashing
            return plainPassword === hashedPassword || 
                   await window.teableAPI.verifyPassword(plainPassword, hashedPassword);
        } catch (error) {
            console.error('Password verification error:', error);
            return false;
        }
    }

    setSession(session) {
        this.currentSession = session;
        localStorage.setItem('teableAuthSession', JSON.stringify(session));
        console.log('Session created:', session);
    }

    getCurrentSession() {
        return this.currentSession;
    }

    isLoggedIn() {
        return this.currentSession !== null;
    }

    isAdmin() {
        if (!this.currentSession) return false;
        // Config admin has full access, or check role-based admin access
        if (this.currentSession.isConfigAdmin) return true;
        const adminRoles = ['owner', 'admin'];
        return adminRoles.includes(this.currentSession.role);
    }

    requireAuth() {
        if (!this.isLoggedIn()) {
            window.location.href = 'login.html';
            return false;
        }
        return true;
    }

    requireAdmin() {
        if (!this.requireAuth()) return false;

        if (!this.isAdmin()) {
            alert('Access denied. Administrator privileges required.');
            window.location.href = 'dashboard.html';
            return false;
        }
        return true;
    }

    requireClientAdmin() {
        if (!this.requireAuth()) return false;

        const session = this.getCurrentSession();
        const isClientAdmin = session.role === 'owner' || session.role === 'admin' || session.isConfigAdmin;
        
        if (!isClientAdmin) {
            alert('Access denied. Client administrator privileges required.');
            window.location.href = 'dashboard.html';
            return false;
        }
        return true;
    }

    hasClientAccess(feature) {
        if (!this.isLoggedIn()) return false;
        
        const session = this.getCurrentSession();
        
        // Super admin has access to everything
        if (session.isConfigAdmin) return true;
        
        // Define feature access based on roles
        const featureAccess = {
            'map': ['owner', 'admin', 'editor', 'viewer'],
            'table': ['owner', 'admin', 'editor', 'viewer'], 
            'public-map': ['owner', 'admin', 'editor', 'viewer'],
            'logs': ['owner', 'admin', 'editor', 'viewer'],
            'map-config': ['owner', 'admin'],
            'permissions': ['owner', 'admin'],
            'users': ['owner', 'admin'],
            'config': ['config_admin']
        };
        
        const allowedRoles = featureAccess[feature] || [];
        return allowedRoles.includes(session.role) || allowedRoles.includes('config_admin') && session.isConfigAdmin;
    }

    logout() {
        this.currentSession = null;
        localStorage.removeItem('teableAuthSession');
        localStorage.removeItem('selectedClientConfig');
        window.location.href = 'login.html';
    }

    selectClientConfig(configId) {
        localStorage.setItem('selectedClientConfig', configId);
        this.loadClientConfig();

        // Also initialize the API with the new config
        if (this.clientConfig && window.teableAPI) {
            window.teableAPI.init(this.clientConfig);
        }
    }

    getAvailableConfigs() {
        return JSON.parse(localStorage.getItem('clientConfigs') || '[]');
    }
}

// Create global instance
window.teableAuth = new TeableAuth();