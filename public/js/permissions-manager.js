/**
 * Permissions Manager
 * Handles loading and checking field-level permissions from Supabase
 */

class PermissionsManager {
    constructor() {
        this.supabase = null;
        this.currentUserId = null;
        this.permissions = {};
        this.initialized = false;
    }

    async init(supabaseUrl, supabaseKey) {
        if (!window.supabase) {
            throw new Error('Supabase library not loaded');
        }

        this.supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

        // Get or create current user session
        const userEmail = localStorage.getItem('gis_current_user_email');
        const customerId = localStorage.getItem('gis_customer_id');

        if (!userEmail || !customerId) {
            console.warn('No user session found');
            return false;
        }

        // Load user from database
        const { data: users, error } = await this.supabase
            .from('customer_users')
            .select('*')
            .eq('customer_id', customerId)
            .eq('email', userEmail)
            .maybeSingle();

        if (error) {
            console.error('Error loading user:', error);
            return false;
        }

        if (!users) {
            console.warn('User not found in database');
            return false;
        }

        this.currentUserId = users.id;
        await this.loadPermissions();
        this.initialized = true;
        return true;
    }

    async loadPermissions() {
        if (!this.currentUserId) {
            console.warn('No user ID available');
            return;
        }

        const { data, error } = await this.supabase
            .from('user_field_permissions')
            .select('*')
            .eq('user_id', this.currentUserId);

        if (error) {
            console.error('Error loading permissions:', error);
            return;
        }

        // Organize permissions by table and field
        this.permissions = {};
        (data || []).forEach(perm => {
            if (!this.permissions[perm.table_id]) {
                this.permissions[perm.table_id] = {};
            }
            this.permissions[perm.table_id][perm.field_id] = perm.permission;
        });

        console.log('Loaded permissions:', this.permissions);
    }

    canViewField(tableId, fieldId) {
        const permission = this.permissions[tableId]?.[fieldId] || 'view';
        return permission === 'view' || permission === 'edit';
    }

    canEditField(tableId, fieldId) {
        const permission = this.permissions[tableId]?.[fieldId] || 'view';
        return permission === 'edit';
    }

    getFieldPermission(tableId, fieldId) {
        return this.permissions[tableId]?.[fieldId] || 'view';
    }

    filterVisibleFields(tableId, fields) {
        return fields.filter(field => this.canViewField(tableId, field.id));
    }

    filterEditableFields(tableId, fields) {
        return fields.filter(field => this.canEditField(tableId, field.id));
    }

    applyPermissionsToRecord(tableId, record, fields) {
        const filteredRecord = { ...record };

        fields.forEach(field => {
            if (!this.canViewField(tableId, field.id)) {
                delete filteredRecord[field.id];
            }
        });

        return filteredRecord;
    }
}

// Export as global
window.PermissionsManager = PermissionsManager;
