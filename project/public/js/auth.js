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

            // Clear any existing field permissions cache to prevent interference
            if (window.fieldPermissionsCache) {
                window.fieldPermissionsCache = {};
            }

            // Initialize API with client config for all authentication attempts
            window.teableAPI.init(this.clientConfig);

            // Wait for API initialization
            await new Promise(resolve => setTimeout(resolve, 100));

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
     * Authenticate Space Owner using working logic
     */
    async authenticateSpaceOwner(email, password) {
        try {
            console.log('Starting space owner authentication for:', email);

            // Step 1: Ensure system tables exist
            await window.teableAPI.ensureSystemTables();

            // Step 2: Get user from local app_users table
            console.log('Checking local app_users table...');

            // Ensure system tables are properly initialized
            if (!window.teableAPI.systemTables || !window.teableAPI.systemTables.users) {
                console.log('System tables not initialized, trying to initialize...');
                await window.teableAPI.ensureSystemTables();
            }

            const users = await window.teableAPI.getRecords(window.teableAPI.systemTables.users);
            console.log(`Found ${users.records?.length || 0} users in system table`);

            const localUser = users.records?.find(u => 
                u.fields.email === email.toLowerCase() && 
                (u.fields.role === 'Owner' || u.fields.role === 'owner') &&
                u.fields.admin_password_hash
            );

            console.log('Local user found:', !!localUser);
            if (localUser) {
                console.log('User role:', localUser.fields.role);
                console.log('Has admin password hash:', !!localUser.fields.admin_password_hash);
            }

            if (!localUser) {
                throw new Error('Space owner not found or admin password not set');
            }

            if (!localUser.fields.is_active) {
                throw new Error('Space owner account is inactive');
            }

            // Step 3: Verify admin password
            console.log('Verifying admin password...');
            
            if (!localUser.fields.admin_password_hash) {
                throw new Error('No admin password hash found for space owner. Please reconfigure the space owner.');
            }

            // Try multiple hashing methods for compatibility
            let passwordMatches = false;
            const storedHash = localUser.fields.admin_password_hash;
            
            console.log('Stored hash exists:', !!storedHash);
            console.log('Stored hash length:', storedHash ? storedHash.length : 0);
            console.log('Stored hash starts with:', storedHash ? storedHash.substring(0, 10) : 'null');
            
            // Method 1: Current API hashing (with salt)
            try {
                const apiHash = await window.teableAPI.hashPassword(password);
                console.log('API hash generated:', apiHash ? apiHash.substring(0, 10) + '...' : 'null');
                if (storedHash === apiHash) {
                    passwordMatches = true;
                    console.log('✅ Password verified with API hash method');
                }
            } catch (hashError) {
                console.log('API hash method failed:', hashError.message);
            }
            
            // Method 2: Simple SHA-256 (no salt)
            if (!passwordMatches) {
                try {
                    const encoder = new TextEncoder();
                    const data = encoder.encode(password);
                    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    const simpleHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                    
                    console.log('Simple hash generated:', simpleHash ? simpleHash.substring(0, 10) + '...' : 'null');
                    if (storedHash === simpleHash) {
                        passwordMatches = true;
                        console.log('✅ Password verified with simple SHA-256 method');
                        
                        // Update to new hashing method
                        try {
                            const newHash = await window.teableAPI.hashPassword(password);
                            await window.teableAPI.updateRecord(
                                window.teableAPI.systemTables.users,
                                localUser.id,
                                { admin_password_hash: newHash }
                            );
                            console.log('🔄 Updated password hash to new method');
                        } catch (updateError) {
                            console.log('Failed to update password hash:', updateError.message);
                        }
                    }
                } catch (simpleHashError) {
                    console.log('Simple hash method failed:', simpleHashError.message);
                }
            }
            
            // Method 3: Alternative salt variations
            if (!passwordMatches) {
                const saltVariations = [
                    'admin_salt_2024',
                    'teable_admin_salt',
                    'system_salt',
                    'admin_password_salt',
                    password + '_salt',
                    'salt_' + password
                ];
                
                for (const salt of saltVariations) {
                    try {
                        const encoder = new TextEncoder();
                        const data = encoder.encode(password + salt);
                        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        const saltedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                        
                        console.log(`Trying salt "${salt}":`, saltedHash ? saltedHash.substring(0, 10) + '...' : 'null');
                        
                        if (storedHash === saltedHash) {
                            passwordMatches = true;
                            console.log(`✅ Password verified with salt: ${salt}`);
                            
                            // Update to new hashing method
                            try {
                                const newHash = await window.teableAPI.hashPassword(password);
                                await window.teableAPI.updateRecord(
                                    window.teableAPI.systemTables.users,
                                    localUser.id,
                                    { admin_password_hash: newHash }
                                );
                                console.log('🔄 Updated password hash to new method');
                            } catch (updateError) {
                                console.log('Failed to update password hash:', updateError.message);
                            }
                            break;
                        }
                    } catch (saltError) {
                        console.log(`Salt method failed for "${salt}":`, saltError.message);
                    }
                }
            }
            
            // Method 4: Direct comparison (for plain text - should be avoided but for compatibility)
            if (!passwordMatches) {
                if (storedHash === password) {
                    passwordMatches = true;
                    console.log('⚠️ Password verified with plain text (updating to hashed)');
                    
                    // Update to hashed password immediately
                    try {
                        const newHash = await window.teableAPI.hashPassword(password);
                        await window.teableAPI.updateRecord(
                            window.teableAPI.systemTables.users,
                            localUser.id,
                            { admin_password_hash: newHash }
                        );
                        console.log('🔄 Updated plain text password to hashed');
                    } catch (updateError) {
                        console.log('Failed to update plain text password:', updateError.message);
                    }
                }
            }
            
            // Method 5: If still no match, offer to reset password
            if (!passwordMatches) {
                console.log('🔄 All password verification methods failed. Checking if we should allow reset...');
                
                // If this is a critical admin password that needs to be reset, you can uncomment this:
                // const shouldReset = confirm('Password verification failed. Reset admin password to entered password?');
                // if (shouldReset) {
                //     try {
                //         const newHash = await window.teableAPI.hashPassword(password);
                //         await window.teableAPI.updateRecord(
                //             window.teableAPI.systemTables.users,
                //             localUser.id,
                //             { admin_password_hash: newHash }
                //         );
                //         passwordMatches = true;
                //         console.log('🔄 Password reset and verified');
                //     } catch (resetError) {
                //         console.log('Failed to reset password:', resetError.message);
                //     }
                // }
            }

            if (!passwordMatches) {
                console.log('❌ Password verification failed with all methods');
                console.log('Expected hash starts with:', storedHash.substring(0, 10));
                throw new Error('Invalid admin password for space owner');
            }

            console.log('Password verification successful');

            // Step 4: Fetch current space owner from Teable.io for verification
            console.log('Verifying against live Teable.io space data...');
            let teableSpaceOwner = null;

            try {
                const endpoints = [
                    `/api/space/${this.clientConfig.spaceId}/collaborators`,
                    `/api/space/${this.clientConfig.spaceId}/collaborator`,
                    `/api/space/${this.clientConfig.spaceId}`,
                    `/api/space`
                ];

                for (const endpoint of endpoints) {
                    try {
                        const result = await window.teableAPI.request(endpoint);

                        // Look for owner role
                        if (result.collaborators) {
                            teableSpaceOwner = result.collaborators.find(user => 
                                user.role === 'Owner' || user.role === 'owner'
                            );
                        } else if (result.members) {
                            teableSpaceOwner = result.members.find(user => 
                                user.role === 'Owner' || user.role === 'owner'
                            );
                        } else if (result.owner) {
                            teableSpaceOwner = result.owner;
                        }

                        if (teableSpaceOwner) break;

                    } catch (endpointError) {
                        console.log(`Endpoint ${endpoint} failed:`, endpointError.message);
                    }
                }

                // Verify email matches current space owner
                if (teableSpaceOwner && teableSpaceOwner.email) {
                    if (teableSpaceOwner.email.toLowerCase() !== email.toLowerCase()) {
                        throw new Error(`Authentication failed: You are not the current space owner. Current owner: ${teableSpaceOwner.email}`);
                    }
                    console.log('Email verified against live Teable.io space data');
                } else {
                    console.log('Could not verify against Teable.io - proceeding with local authentication');
                }

            } catch (teableError) {
                console.log('Could not verify against Teable.io:', teableError.message);
                // Continue with local authentication
            }

            // Step 5: Update last login
            try {
                await window.teableAPI.updateRecord(
                    window.teableAPI.systemTables.users,
                    localUser.id,
                    { last_login: new Date().toISOString().split('T')[0] }
                );
            } catch (updateError) {
                console.log('Failed to update last login:', updateError.message);
            }

            console.log('Space owner authentication successful');

            return {
                userType: 'space_owner',
                email: localUser.fields.email,
                firstName: localUser.fields.first_name || 'Space',
                lastName: localUser.fields.last_name || 'Owner',
                role: localUser.fields.role,
                userId: localUser.id,
                accessToken: this.clientConfig.accessToken,
                loginTime: new Date().toISOString(),
                isAdmin: true,
                teableSpaceOwner: teableSpaceOwner || { email: email, verified: false }
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
            const user = users.records.find(u => u.fields.email === email);

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
        return this.currentSession && (this.currentSession.isAdmin || ['Owner', 'Admin'].includes(this.currentSession.role));
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
            const configData = localStorage.getItem('teable_client_config');
            if (configData) {
                this.clientConfig = JSON.parse(configData);
            }
        } catch (error) {
            console.error('Failed to load client config:', error);
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
    const icon = input.nextElementSibling && input.nextElementSibling.querySelector('i');

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