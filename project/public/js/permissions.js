/**
 * Field Permissions Management with Role-Based Controls
 */

let allUsers = [];
let allTables = [];
let allPermissions = [];
let currentUserEmail = '';
let currentTableId = '';
let hasUnsavedChanges = false;

// Teable.io role hierarchy and permissions
const ROLE_HIERARCHY = {
    'creator': {
        level: 4,
        name: 'Creator',
        description: 'Full admin access - can create, edit, delete, and manage permissions',
        allowedPermissions: ['view', 'edit'],
        defaultPermission: 'edit'
    },
    'editor': {
        level: 3,
        name: 'Editor',
        description: 'Can edit data and view all fields',
        allowedPermissions: ['view', 'edit'],
        defaultPermission: 'edit'
    },
    'commenter': {
        level: 2,
        name: 'Commenter',
        description: 'Can view data and add comments, but cannot edit',
        allowedPermissions: ['view', 'hidden'],
        defaultPermission: 'view'
    },
    'viewer': {
        level: 1,
        name: 'Viewer',
        description: 'Read-only access to data',
        allowedPermissions: ['view', 'hidden'],
        defaultPermission: 'view'
    }
};

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication and admin privileges
    if (!window.teableAuth.requireAdmin()) return;
    
    initializePermissions();
});

async function initializePermissions() {
    try {
        const session = window.teableAuth.getCurrentSession();
        document.getElementById('userDisplay').textContent = 
            `${session.firstName} ${session.lastName} (${session.role})`;

        // Ensure API is initialized with proper client configuration
        const clientConfig = window.teableAuth.clientConfig || 
                           JSON.parse(localStorage.getItem('currentClientConfig') || '{}') ||
                           JSON.parse(localStorage.getItem('teable_client_config') || '{}');

        if (!clientConfig.baseUrl || !clientConfig.accessToken) {
            throw new Error('No valid client configuration found. Please configure the system first in super-admin.html');
        }

        console.log('🔧 Initializing Teable API for permissions...');
        window.teableAPI.init(clientConfig);

        // Ensure system tables exist
        await window.teableAPI.ensureSystemTables();
        
        // Load data
        await loadPermissionData();
        
    } catch (error) {
        console.error('Permissions initialization failed:', error);
        showError('Failed to initialize permissions: ' + error.message);
    }
}

async function loadPermissionData() {
    try {
        // Load users
        const usersData = await window.teableAPI.getRecords(window.teableAPI.systemTables.users);
        allUsers = usersData.records || [];

        // Load tables
        const tablesData = await window.teableAPI.getTables();
        allTables = (tablesData.tables || tablesData || []).filter(t => 
            !t.name.startsWith('app_') && 
            !t.name.startsWith('field_') && 
            !t.name.startsWith('system_')
        );

        // Load existing permissions
        const permissionsData = await window.teableAPI.getRecords(window.teableAPI.systemTables.permissions);
        allPermissions = permissionsData.records || [];

        // Populate selectors
        populateSelectors();
        
        console.log('Loaded permission data:', {
            users: allUsers.length,
            tables: allTables.length,
            permissions: allPermissions.length
        });
        
    } catch (error) {
        console.error('Error loading permission data:', error);
        showError('Failed to load permission data: ' + error.message);
    }
}

function populateSelectors() {
    // Populate user selector
    const userSelector = document.getElementById('permissionUserSelector');
    userSelector.innerHTML = '<option value="">Choose a user...</option>';
    
    allUsers.forEach(user => {
        const fields = user.fields;
        const name = `${fields.first_name || ''} ${fields.last_name || ''}`.trim();
        const displayName = name ? `${name} (${fields.email})` : fields.email;
        const roleInfo = ROLE_HIERARCHY[fields.role] || ROLE_HIERARCHY['viewer'];
        
        const option = document.createElement('option');
        option.value = fields.email;
        option.textContent = `${displayName} - ${roleInfo.name}`;
        option.setAttribute('data-role', fields.role);
        userSelector.appendChild(option);
    });

    // Populate table selector
    const tableSelector = document.getElementById('permissionTableSelector');
    tableSelector.innerHTML = '<option value="">Choose a table...</option>';
    
    allTables.forEach(table => {
        const option = document.createElement('option');
        option.value = table.id;
        option.textContent = table.name;
        tableSelector.appendChild(option);
    });
}

function onPermissionUserChange() {
    currentUserEmail = document.getElementById('permissionUserSelector').value;
    if (currentUserEmail && currentTableId) {
        loadPermissionsMatrix();
    } else {
        clearPermissionsMatrix();
    }
}

function onPermissionTableChange() {
    currentTableId = document.getElementById('permissionTableSelector').value;
    if (currentUserEmail && currentTableId) {
        loadPermissionsMatrix();
    } else {
        clearPermissionsMatrix();
    }
}

async function loadPermissionsMatrix() {
    if (!currentUserEmail || !currentTableId) {
        clearPermissionsMatrix();
        return;
    }

    try {
        showMatrixLoading(true);

        // Get user role
        const user = allUsers.find(u => u.fields.email === currentUserEmail);
        const userRole = user?.fields.role || 'viewer';
        const roleInfo = ROLE_HIERARCHY[userRole] || ROLE_HIERARCHY['viewer'];

        // Get table fields by fetching a sample record
        const recordsData = await window.teableAPI.getRecords(currentTableId, { limit: 1 });
        let fieldNames = [];
        
        if (recordsData.records && recordsData.records.length > 0) {
            fieldNames = Object.keys(recordsData.records[0].fields || {});
        }

        if (fieldNames.length === 0) {
            document.getElementById('permissionsMatrix').innerHTML = `
                <div class="alert alert-warning">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    No fields found in this table, or table is empty.
                </div>
            `;
            return;
        }

        // Get existing permissions for this user/table
        const userPermissions = {};
        allPermissions.forEach(perm => {
            const fields = perm.fields;
            if (fields.user_email === currentUserEmail && fields.table_id === currentTableId) {
                userPermissions[fields.field_name] = {
                    permission: fields.permission_type,
                    recordId: perm.id,
                    updatedBy: fields.updated_by,
                    updatedDate: fields.updated_date
                };
            }
        });

        // Create permissions matrix
        displayPermissionsMatrix(fieldNames, userPermissions, roleInfo);

    } catch (error) {
        console.error('Error loading permissions matrix:', error);
        document.getElementById('permissionsMatrix').innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Failed to load permissions: ${error.message}
            </div>
        `;
    } finally {
        showMatrixLoading(false);
    }
}

function displayPermissionsMatrix(fieldNames, userPermissions, roleInfo) {
    const tableName = allTables.find(t => t.id === currentTableId)?.name || 'Unknown Table';
    const userName = getUserDisplayName(currentUserEmail);

    let html = `
        <!-- Role Information Banner -->
        <div class="alert alert-info mb-4">
            <div class="d-flex align-items-center">
                <i class="fas fa-user-shield fa-2x me-3"></i>
                <div>
                    <h6 class="mb-1">User Role: ${roleInfo.name}</h6>
                    <p class="mb-0 small">${roleInfo.description}</p>
                    <p class="mb-0 small"><strong>Available permissions:</strong> ${roleInfo.allowedPermissions.map(p => p.toUpperCase()).join(', ')}</p>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h5 class="mb-0">
                    <i class="fas fa-shield-alt me-2"></i>
                    Field Permissions: ${userName} → ${tableName}
                </h5>
                <p class="mb-0 text-muted small">Configure access level for each field (limited by user role)</p>
            </div>
            <div class="card-body">
                <div class="table-responsive">
                    <table class="table table-bordered">
                        <thead class="table-light">
                            <tr>
                                <th style="width: 30%;">Field Name</th>
                                <th style="width: 25%;">Permission</th>
                                <th style="width: 20%;">Status</th>
                                <th style="width: 25%;">Last Updated</th>
                            </tr>
                        </thead>
                        <tbody>
    `;

    fieldNames.forEach(fieldName => {
        const currentPerm = userPermissions[fieldName];
        const permission = currentPerm ? currentPerm.permission : roleInfo.defaultPermission;
        const statusBadge = currentPerm ? 
            '<span class="badge bg-info">Custom</span>' : 
            '<span class="badge bg-secondary">Default</span>';
        
        const lastUpdated = currentPerm && currentPerm.updatedDate ? 
            new Date(currentPerm.updatedDate).toLocaleDateString() : 
            'Never';

        html += `
            <tr>
                <td>
                    <strong>${fieldName}</strong>
                    <div class="text-muted small">${getFieldTypeIcon(fieldName)} Field</div>
                </td>
                <td>
                    <select class="form-select form-select-sm permission-select" 
                            data-field-name="${fieldName}" 
                            data-record-id="${currentPerm ? currentPerm.recordId : ''}"
                            onchange="updateFieldPermission('${fieldName}', this.value, '${currentPerm ? currentPerm.recordId : ''}', this)">
                        ${generatePermissionOptions(roleInfo.allowedPermissions, permission)}
                    </select>
                </td>
                <td>${statusBadge}</td>
                <td>
                    <div class="small">
                        ${lastUpdated}
                        ${currentPerm && currentPerm.updatedBy ? 
                            `<br><span class="text-muted">by ${currentPerm.updatedBy}</span>` : ''}
                    </div>
                </td>
            </tr>
        `;
    });

    html += `
                        </tbody>
                    </table>
                </div>
                
                <!-- Quick Actions -->
                <div class="mt-3 p-3 bg-light rounded">
                    <h6><i class="fas fa-magic me-2"></i>Quick Actions (Role-Limited)</h6>
                    <div class="btn-group" role="group">
                        ${roleInfo.allowedPermissions.includes('view') ? 
                            `<button class="btn btn-outline-success btn-sm" onclick="setAllPermissions('view')">
                                <i class="fas fa-eye me-1"></i>All View
                            </button>` : ''}
                        ${roleInfo.allowedPermissions.includes('edit') ? 
                            `<button class="btn btn-outline-primary btn-sm" onclick="setAllPermissions('edit')">
                                <i class="fas fa-edit me-1"></i>All Edit
                            </button>` : ''}
                        ${roleInfo.allowedPermissions.includes('hidden') ? 
                            `<button class="btn btn-outline-danger btn-sm" onclick="setAllPermissions('hidden')">
                                <i class="fas fa-eye-slash me-1"></i>All Hidden
                            </button>` : ''}
                        <button class="btn btn-outline-secondary btn-sm" onclick="resetToDefaults()">
                            <i class="fas fa-undo me-1"></i>Reset to Defaults
                        </button>
                    </div>
                </div>

                <!-- Save Section -->
                <div class="mt-4 p-3 border rounded ${hasUnsavedChanges ? 'border-warning bg-warning-subtle' : 'border-success bg-success-subtle'}">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="mb-1">
                                <i class="fas fa-${hasUnsavedChanges ? 'exclamation-triangle text-warning' : 'check-circle text-success'} me-2"></i>
                                ${hasUnsavedChanges ? 'Unsaved Changes' : 'All Changes Saved'}
                            </h6>
                            <p class="mb-0 small text-muted">
                                ${hasUnsavedChanges ? 'You have unsaved permission changes.' : 'All permission changes have been saved automatically.'}
                            </p>
                        </div>
                        <button class="btn btn-success" onclick="saveAllPermissions()" ${!hasUnsavedChanges ? 'disabled' : ''}>
                            <i class="fas fa-save me-1"></i>Save All Changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('permissionsMatrix').innerHTML = html;
    
    // Reset unsaved changes flag
    hasUnsavedChanges = false;
}

function generatePermissionOptions(allowedPermissions, currentPermission) {
    const allOptions = {
        'view': { icon: '👁️', label: 'View - Can see field data' },
        'edit': { icon: '✏️', label: 'Edit - Can view and modify' },
        'hidden': { icon: '🚫', label: 'Hidden - Field is invisible' }
    };

    return allowedPermissions.map(permission => {
        const option = allOptions[permission];
        const selected = permission === currentPermission ? ' selected' : '';
        return `<option value="${permission}"${selected}>${option.icon} ${option.label}</option>`;
    }).join('');
}

function getUserDisplayName(email) {
    const user = allUsers.find(u => u.fields.email === email);
    if (user) {
        const fields = user.fields;
        const name = `${fields.first_name || ''} ${fields.last_name || ''}`.trim();
        return name || email;
    }
    return email;
}

function getFieldTypeIcon(fieldName) {
    // Simple field type detection based on name
    const name = fieldName.toLowerCase();
    if (name.includes('email')) return '📧';
    if (name.includes('phone')) return '📞';
    if (name.includes('date')) return '📅';
    if (name.includes('name')) return '👤';
    if (name.includes('address')) return '📍';
    if (name.includes('url') || name.includes('link')) return '🔗';
    if (name.includes('number') || name.includes('count')) return '🔢';
    return '📝';
}

async function updateFieldPermission(fieldName, permission, existingRecordId, selectElement) {
    try {
        // Mark as having unsaved changes
        hasUnsavedChanges = true;
        updateSaveButtonState();

        const tableName = allTables.find(t => t.id === currentTableId)?.name || 'Unknown';
        const fieldId = `${currentTableId}_${fieldName}`;
        
        const permissionData = {
            user_email: currentUserEmail,
            table_id: currentTableId,
            table_name: tableName,
            field_id: fieldId,
            field_name: fieldName,
            permission_type: permission,
            updated_by: window.teableAuth.getCurrentSession().email,
            updated_date: new Date().toISOString().split('T')[0]
        };

        console.log('Updating permission with data:', permissionData);

        let newRecordId = existingRecordId;

        if (existingRecordId && existingRecordId !== '') {
            // Update existing permission
            await window.teableAPI.updateRecord(
                window.teableAPI.systemTables.permissions, 
                existingRecordId, 
                permissionData
            );
            console.log('Permission updated successfully');
        } else {
            // Create new permission
            const newRecord = await window.teableAPI.createRecord(
                window.teableAPI.systemTables.permissions, 
                permissionData
            );
            
            console.log('Permission created successfully:', newRecord);
            newRecordId = newRecord.id;
            
            // Update the select element's data attribute for future updates
            if (selectElement) {
                selectElement.setAttribute('data-record-id', newRecordId);
                selectElement.setAttribute('onchange', 
                    `updateFieldPermission('${fieldName}', this.value, '${newRecordId}', this)`);
            }
        }

        // Log activity
        try {
            await window.teableAPI.logActivity(
                window.teableAuth.getCurrentSession().email,
                'permission_granted',
                `Set ${permission} permission for ${currentUserEmail} on field ${fieldName} in table ${tableName}`
            );
        } catch (logError) {
            console.log('Failed to log activity:', logError.message);
        }

        // Update local permissions data
        await loadPermissionData();
        
        console.log('Permission updated successfully');

    } catch (error) {
        console.error('Error updating permission:', error);
        showError('Failed to update permission: ' + error.message);
    }
}

async function saveAllPermissions() {
    try {
        showSuccess('All permissions have been saved successfully!');
        hasUnsavedChanges = false;
        updateSaveButtonState();
        
        // Reload the matrix to show updated status
        await loadPermissionsMatrix();
        
    } catch (error) {
        console.error('Error saving permissions:', error);
        showError('Failed to save permissions: ' + error.message);
    }
}

function updateSaveButtonState() {
    const saveButton = document.querySelector('button[onclick="saveAllPermissions()"]');
    const statusSection = saveButton?.closest('.border');
    
    if (saveButton && statusSection) {
        saveButton.disabled = !hasUnsavedChanges;
        
        if (hasUnsavedChanges) {
            statusSection.className = 'mt-4 p-3 border rounded border-warning bg-warning-subtle';
            statusSection.querySelector('h6').innerHTML = '<i class="fas fa-exclamation-triangle text-warning me-2"></i>Unsaved Changes';
            statusSection.querySelector('p').textContent = 'You have unsaved permission changes.';
        } else {
            statusSection.className = 'mt-4 p-3 border rounded border-success bg-success-subtle';
            statusSection.querySelector('h6').innerHTML = '<i class="fas fa-check-circle text-success me-2"></i>All Changes Saved';
            statusSection.querySelector('p').textContent = 'All permission changes have been saved automatically.';
        }
    }
}

async function setAllPermissions(permission) {
    // Get user role to validate permission
    const user = allUsers.find(u => u.fields.email === currentUserEmail);
    const userRole = user?.fields.role || 'viewer';
    const roleInfo = ROLE_HIERARCHY[userRole] || ROLE_HIERARCHY['viewer'];
    
    if (!roleInfo.allowedPermissions.includes(permission)) {
        showError(`Cannot set "${permission}" permission. User role "${roleInfo.name}" does not allow this permission level.`);
        return;
    }

    if (!confirm(`Set all fields to "${permission}" permission for this user?`)) {
        return;
    }

    try {
        // Get all select elements in the matrix
        const selects = document.querySelectorAll('#permissionsMatrix select.permission-select');
        
        for (const select of selects) {
            if (select.value !== permission) {
                const fieldName = select.getAttribute('data-field-name');
                const recordId = select.getAttribute('data-record-id');
                
                select.value = permission;
                
                // Update the permission
                await updateFieldPermission(fieldName, permission, recordId, select);
                
                // Small delay to avoid overwhelming the API
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        showSuccess(`All permissions set to "${permission}" successfully!`);

    } catch (error) {
        console.error('Error setting bulk permissions:', error);
        showError('Failed to set bulk permissions: ' + error.message);
    }
}

async function resetToDefaults() {
    if (!confirm('Reset all permissions to default for this user and table?')) {
        return;
    }

    try {
        // Delete all custom permissions for this user/table
        const userTablePermissions = allPermissions.filter(perm => {
            const fields = perm.fields;
            return fields.user_email === currentUserEmail && fields.table_id === currentTableId;
        });

        for (const perm of userTablePermissions) {
            await window.teableAPI.deleteRecord(window.teableAPI.systemTables.permissions, perm.id);
        }

        // Log activity
        try {
            await window.teableAPI.logActivity(
                window.teableAuth.getCurrentSession().email,
                'permissions_reset',
                `Reset all permissions to defaults for ${currentUserEmail} on table ${currentTableId}`
            );
        } catch (logError) {
            console.log('Failed to log activity:', logError.message);
        }

        // Reload data and matrix
        await loadPermissionData();
        await loadPermissionsMatrix();

        showSuccess('Permissions reset to defaults successfully!');

    } catch (error) {
        console.error('Error resetting permissions:', error);
        showError('Failed to reset permissions: ' + error.message);
    }
}

function clearPermissionsMatrix() {
    document.getElementById('permissionsMatrix').innerHTML = `
        <div class="text-center text-muted py-5">
            <i class="fas fa-shield-alt fa-4x mb-3"></i>
            <h5>Field Permissions Matrix</h5>
            <p>Select a user and table above to configure field-level permissions</p>
            <div class="mt-4">
                <div class="row justify-content-center">
                    <div class="col-md-8">
                        <div class="border rounded p-3 bg-white">
                            <h6 class="text-start">Role-Based Permissions:</h6>
                            <ul class="text-start">
                                <li><strong>Creator/Editor:</strong> Can set View or Edit permissions</li>
                                <li><strong>Commenter/Viewer:</strong> Can set View or Hidden permissions</li>
                                <li><strong>Permissions are limited by user role</strong> - higher permissions cannot be granted to lower-level roles</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function showMatrixLoading(show) {
    if (show) {
        document.getElementById('permissionsMatrix').innerHTML = `
            <div class="text-center py-5">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2 text-muted">Loading permissions matrix...</p>
            </div>
        `;
    }
}

async function exportPermissions() {
    try {
        // Create CSV export of all permissions
        let csv = 'User Email,User Role,Table Name,Field Name,Permission Type,Updated By,Updated Date\n';
        
        allPermissions.forEach(perm => {
            const fields = perm.fields;
            const user = allUsers.find(u => u.fields.email === fields.user_email);
            const userRole = user?.fields.role || 'unknown';
            
            csv += `"${fields.user_email}","${userRole}","${fields.table_name}","${fields.field_name}","${fields.permission_type}","${fields.updated_by || ''}","${fields.updated_date || ''}"\n`;
        });

        // Download CSV
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `permissions_export_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showSuccess('Permissions exported successfully!');

    } catch (error) {
        console.error('Error exporting permissions:', error);
        showError('Failed to export permissions: ' + error.message);
    }
}

function applyBulkPermissions() {
    // Show bulk permissions modal
    const modal = new bootstrap.Modal(document.getElementById('bulkPermissionsModal'));
    
    // Populate bulk selectors
    const bulkUserSelector = document.getElementById('bulkUserSelector');
    const bulkTableSelector = document.getElementById('bulkTableSelector');
    
    // Clear and populate users
    bulkUserSelector.innerHTML = '';
    allUsers.forEach(user => {
        const fields = user.fields;
        const name = `${fields.first_name || ''} ${fields.last_name || ''}`.trim();
        const displayName = name ? `${name} (${fields.email})` : fields.email;
        const roleInfo = ROLE_HIERARCHY[fields.role] || ROLE_HIERARCHY['viewer'];
        
        const option = document.createElement('option');
        option.value = fields.email;
        option.textContent = `${displayName} - ${roleInfo.name}`;
        option.setAttribute('data-role', fields.role);
        bulkUserSelector.appendChild(option);
    });
    
    // Clear and populate tables
    bulkTableSelector.innerHTML = '';
    allTables.forEach(table => {
        const option = document.createElement('option');
        option.value = table.id;
        option.textContent = table.name;
        bulkTableSelector.appendChild(option);
    });
    
    modal.show();
}

async function executeBulkPermissions() {
    try {
        const selectedUsers = Array.from(document.getElementById('bulkUserSelector').selectedOptions)
            .map(option => ({ email: option.value, role: option.getAttribute('data-role') }));
        const selectedTables = Array.from(document.getElementById('bulkTableSelector').selectedOptions)
            .map(option => option.value);
        const template = document.querySelector('input[name="bulkTemplate"]:checked')?.value;

        if (selectedUsers.length === 0 || selectedTables.length === 0 || !template) {
            throw new Error('Please select users, tables, and a permission template');
        }

        if (!confirm(`Apply ${template} template to ${selectedUsers.length} users across ${selectedTables.length} tables?`)) {
            return;
        }

        // Apply permissions based on template and user roles
        for (const user of selectedUsers) {
            for (const tableId of selectedTables) {
                await applyPermissionTemplate(user.email, user.role, tableId, template);
            }
        }

        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('bulkPermissionsModal'));
        modal.hide();

        // Reload data
        await loadPermissionData();
        if (currentUserEmail && currentTableId) {
            await loadPermissionsMatrix();
        }

        showSuccess('Bulk permissions applied successfully!');

    } catch (error) {
        console.error('Error applying bulk permissions:', error);
        showError('Failed to apply bulk permissions: ' + error.message);
    }
}

async function applyPermissionTemplate(userEmail, userRole, tableId, template) {
    const roleInfo = ROLE_HIERARCHY[userRole] || ROLE_HIERARCHY['viewer'];
    
    // Get table fields
    const recordsData = await window.teableAPI.getRecords(tableId, { limit: 1 });
    if (!recordsData.records || recordsData.records.length === 0) return;
    
    const fieldNames = Object.keys(recordsData.records[0].fields || {});
    const tableName = allTables.find(t => t.id === tableId)?.name || 'Unknown';

    for (const fieldName of fieldNames) {
        let permission = roleInfo.defaultPermission; // Start with role default

        if (template === 'editor' && roleInfo.allowedPermissions.includes('edit')) {
            // Most fields editable, sensitive fields view-only
            const sensitiveFields = ['id', 'created_at', 'updated_at', 'created_by'];
            permission = sensitiveFields.some(sf => fieldName.toLowerCase().includes(sf)) ? 'view' : 'edit';
        } else if (template === 'restricted' && roleInfo.allowedPermissions.includes('hidden')) {
            // Only essential fields visible
            const essentialFields = ['name', 'title', 'email', 'status'];
            permission = essentialFields.some(ef => fieldName.toLowerCase().includes(ef)) ? 'view' : 'hidden';
        }

        // Ensure permission is allowed for this role
        if (!roleInfo.allowedPermissions.includes(permission)) {
            permission = roleInfo.defaultPermission;
        }

        // Create permission record
        const permissionData = {
            user_email: userEmail,
            table_id: tableId,
            table_name: tableName,
            field_id: `${tableId}_${fieldName}`,
            field_name: fieldName,
            permission_type: permission,
            updated_by: window.teableAuth.getCurrentSession().email,
            updated_date: new Date().toISOString().split('T')[0]
        };

        await window.teableAPI.createRecord(window.teableAPI.systemTables.permissions, permissionData);
    }
}

function showSuccess(message) {
    showAlert('success', message);
}

function showError(message) {
    showAlert('danger', message);
}

function showAlert(type, message) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.insertBefore(alertDiv, document.body.firstChild);
    
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}

// Make functions globally available
window.onPermissionUserChange = onPermissionUserChange;
window.onPermissionTableChange = onPermissionTableChange;
window.loadPermissionsMatrix = loadPermissionsMatrix;
window.updateFieldPermission = updateFieldPermission;
window.saveAllPermissions = saveAllPermissions;
window.setAllPermissions = setAllPermissions;
window.resetToDefaults = resetToDefaults;
window.exportPermissions = exportPermissions;
window.applyBulkPermissions = applyBulkPermissions;
window.executeBulkPermissions = executeBulkPermissions;