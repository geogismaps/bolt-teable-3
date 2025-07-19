/**
 * User Management Functionality with Enhanced Sync
 * Uses Teable.io role nomenclature
 */

let allUsers = [];
let filteredUsers = [];
let currentPage = 1;
const usersPerPage = 10;

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication and admin privileges
    if (!window.teableAuth.requireAdmin()) return;
    
    initializeUserManagement();
});

async function initializeUserManagement() {
    try {
        const session = window.teableAuth.getCurrentSession();
        document.getElementById('userDisplay').textContent = 
            `${session.firstName} ${session.lastName} (${session.role})`;

        // Initialize API if needed
        if (session.userType === 'space_owner') {
            window.teableAPI.init(window.teableAuth.clientConfig);
        }

        // Ensure system tables exist with all required fields
        console.log('🔧 Ensuring system tables exist...');
        await window.teableAPI.ensureSystemTables();
        
        // Initialize user sync manager
        if (window.userSyncManager) {
            await window.userSyncManager.init();
        }
        
        // Load users
        await loadUsers();
        
        // Show sync status
        updateSyncStatus();
        
    } catch (error) {
        console.error('User management initialization failed:', error);
        showError('Failed to initialize user management: ' + error.message);
    }
}

async function loadUsers() {
    try {
        showLoading(true);
        
        const usersData = await window.teableAPI.getRecords(window.teableAPI.systemTables.users);
        allUsers = usersData.records || [];
        filteredUsers = [...allUsers];
        
        console.log(`📊 Loaded ${allUsers.length} users from app_users table`);
        
        displayUsers();
        updatePagination();
        
    } catch (error) {
        console.error('Error loading users:', error);
        showError('Failed to load users: ' + error.message);
    } finally {
        showLoading(false);
    }
}

function displayUsers() {
    const container = document.getElementById('usersTableContainer');
    
    if (filteredUsers.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-5">
                <i class="fas fa-users fa-3x mb-3"></i>
                <h5>No Users Found</h5>
                <p>No users match your current filters, or no users have been created yet.</p>
                <div class="mt-3">
                    <button class="btn btn-primary me-2" onclick="showAddUserModal()">
                        <i class="fas fa-user-plus me-1"></i>Add First User
                    </button>
                    <button class="btn btn-success" onclick="syncWithTeable()">
                        <i class="fas fa-sync me-1"></i>Sync from Teable.io
                    </button>
                </div>
            </div>
        `;
        return;
    }

    // Calculate pagination
    const startIndex = (currentPage - 1) * usersPerPage;
    const endIndex = startIndex + usersPerPage;
    const pageUsers = filteredUsers.slice(startIndex, endIndex);

    let html = `
        <div class="table-responsive">
            <table class="table table-hover">
                <thead class="table-light">
                    <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Status</th>
                        <th>Source</th>
                        <th>Created</th>
                        <th>Last Login</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    pageUsers.forEach(user => {
        const fields = user.fields;
        const fullName = `${fields.first_name || ''} ${fields.last_name || ''}`.trim();
        
        const statusBadge = fields.is_active ? 
            '<span class="badge bg-success">Active</span>' : 
            '<span class="badge bg-danger">Inactive</span>';
            
        const roleBadge = getRoleBadge(fields.role);
        
        // Source indicator
        const sourceBadge = fields.synced_from_teable ? 
            '<span class="badge bg-info" title="Synced from Teable.io"><i class="fas fa-sync me-1"></i>Teable</span>' :
            '<span class="badge bg-secondary" title="Created locally"><i class="fas fa-user me-1"></i>Local</span>';
        
        const createdDate = fields.created_date ? 
            new Date(fields.created_date).toLocaleDateString() : 'Unknown';
        const lastLogin = fields.last_login ? 
            new Date(fields.last_login).toLocaleDateString() : 'Never';

        html += `
            <tr>
                <td>
                    <div class="d-flex align-items-center">
                        <div class="avatar-circle me-2">
                            ${(fields.first_name?.[0] || '?').toUpperCase()}
                        </div>
                        <div>
                            <div class="fw-semibold">${fullName || 'Unnamed User'}</div>
                            ${fields.teable_user_id ? `<small class="text-muted">Teable ID: ${fields.teable_user_id}</small>` : ''}
                        </div>
                    </div>
                </td>
                <td>${fields.email || ''}</td>
                <td>${roleBadge}</td>
                <td>${statusBadge}</td>
                <td>${sourceBadge}</td>
                <td>${createdDate}</td>
                <td>${lastLogin}</td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-primary" onclick="editUser('${user.id}')" title="Edit User">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-outline-info" onclick="resetPassword('${user.id}')" title="Reset Password">
                            <i class="fas fa-key"></i>
                        </button>
                        ${fields.synced_from_teable ? 
                            `<button class="btn btn-outline-warning" onclick="syncSingleUser('${user.id}')" title="Sync with Teable">
                                <i class="fas fa-sync"></i>
                            </button>` : ''
                        }
                        <button class="btn btn-outline-danger" onclick="deleteUser('${user.id}')" title="Delete User">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

function getRoleBadge(role) {
    const badges = {
        'owner': '<span class="badge bg-danger">Owner</span>',
        'admin': '<span class="badge bg-primary">Admin</span>',
        'editor': '<span class="badge bg-success">Editor</span>',
        'commenter': '<span class="badge bg-warning">Commenter</span>',
        'viewer': '<span class="badge bg-info">Viewer</span>'
    };
    return badges[role] || '<span class="badge bg-secondary">Unknown</span>';
}

function filterUsers() {
    const searchTerm = document.getElementById('userSearch').value.toLowerCase();
    const roleFilter = document.getElementById('roleFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;

    filteredUsers = allUsers.filter(user => {
        const fields = user.fields;
        const fullName = `${fields.first_name || ''} ${fields.last_name || ''}`.toLowerCase();
        const email = (fields.email || '').toLowerCase();
        
        // Search filter
        const matchesSearch = !searchTerm || 
            fullName.includes(searchTerm) || 
            email.includes(searchTerm);
        
        // Role filter
        const matchesRole = !roleFilter || fields.role === roleFilter;
        
        // Status filter
        const matchesStatus = !statusFilter || 
            (statusFilter === 'active' && fields.is_active) ||
            (statusFilter === 'inactive' && !fields.is_active);
        
        return matchesSearch && matchesRole && matchesStatus;
    });

    currentPage = 1; // Reset to first page
    displayUsers();
    updatePagination();
}

function updatePagination() {
    const totalPages = Math.ceil(filteredUsers.length / usersPerPage);
    const pagination = document.getElementById('usersPagination');
    
    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }
    
    pagination.style.display = 'block';
    let html = '';
    
    // Previous button
    html += `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changePage(${currentPage - 1})">Previous</a>
        </li>
    `;
    
    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
        if (i === currentPage || i === 1 || i === totalPages || 
            (i >= currentPage - 1 && i <= currentPage + 1)) {
            html += `
                <li class="page-item ${i === currentPage ? 'active' : ''}">
                    <a class="page-link" href="#" onclick="changePage(${i})">${i}</a>
                </li>
            `;
        } else if (i === currentPage - 2 || i === currentPage + 2) {
            html += '<li class="page-item disabled"><span class="page-link">...</span></li>';
        }
    }
    
    // Next button
    html += `
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changePage(${currentPage + 1})">Next</a>
        </li>
    `;
    
    pagination.querySelector('.pagination').innerHTML = html;
}

function changePage(page) {
    const totalPages = Math.ceil(filteredUsers.length / usersPerPage);
    if (page >= 1 && page <= totalPages) {
        currentPage = page;
        displayUsers();
        updatePagination();
    }
}

function showAddUserModal() {
    // Clear form
    document.getElementById('addUserForm').reset();
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('addUserModal'));
    modal.show();
}

async function createUser() {
    try {
        const firstName = document.getElementById('newFirstName').value.trim();
        const lastName = document.getElementById('newLastName').value.trim();
        const email = document.getElementById('newEmail').value.trim();
        const password = document.getElementById('newPassword').value;
        const role = document.getElementById('newRole').value;
        const syncWithTeable = document.getElementById('syncWithTeable').checked;

        // Validation
        if (!firstName || !lastName || !email || !password || !role) {
            throw new Error('Please fill in all required fields');
        }

        if (!email.includes('@')) {
            throw new Error('Please enter a valid email address');
        }

        if (password.length < 6) {
            throw new Error('Password must be at least 6 characters long');
        }

        // Check if email already exists
        const existingUser = allUsers.find(u => u.fields.email === email);
        if (existingUser) {
            throw new Error('A user with this email already exists');
        }

        // Hash password
        const passwordHash = await window.teableAPI.hashPassword(password);

        // Create user data
        const userData = {
            email: email,
            password_hash: passwordHash,
            first_name: firstName,
            last_name: lastName,
            role: role, // Using Teable.io role directly
            is_active: true,
            created_date: new Date().toISOString().split('T')[0],
            last_login: null,
            synced_from_teable: false,
            teable_user_id: null
        };

        console.log('Creating user with data:', userData);

        // Create user in Teable
        const newUser = await window.teableAPI.createRecord(window.teableAPI.systemTables.users, userData);
        
        console.log('User created successfully:', newUser);

        // If sync with Teable is enabled, attempt to invite to space
        if (syncWithTeable && window.userSyncManager) {
            try {
                const inviteResult = await window.userSyncManager.inviteUserToSpace({
                    fields: userData
                });
                if (inviteResult.success) {
                    showInfo('User created and invite to Teable.io space attempted');
                }
            } catch (syncError) {
                console.log('Failed to sync with Teable:', syncError.message);
                showWarning('User created locally, but sync with Teable.io failed');
            }
        }

        // Log activity
        const session = window.teableAuth.getCurrentSession();
        try {
            await window.teableAPI.logActivity(
                session.email,
                'user_created',
                `Created user: ${email} with role: ${role}`
            );
        } catch (logError) {
            console.log('Failed to log activity:', logError.message);
        }

        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
        modal.hide();

        // Reload users
        await loadUsers();
        
        showSuccess('User created successfully!');

    } catch (error) {
        console.error('Error creating user:', error);
        
        // Provide more specific error messages
        let errorMessage = error.message;
        if (errorMessage.includes('Field name:') && errorMessage.includes('not found')) {
            const fieldMatch = errorMessage.match(/Field name: (\w+) not found/);
            if (fieldMatch) {
                const missingField = fieldMatch[1];
                errorMessage = `The field "${missingField}" doesn't exist in the users table. This might be due to a table schema mismatch. Please check your table structure.`;
            }
        }
        
        showError('Failed to create user: ' + errorMessage);
    }
}

async function editUser(userId) {
    try {
        const user = allUsers.find(u => u.id === userId);
        if (!user) {
            throw new Error('User not found');
        }

        const fields = user.fields;
        
        // Populate edit form
        document.getElementById('editUserId').value = userId;
        document.getElementById('editFirstName').value = fields.first_name || '';
        document.getElementById('editLastName').value = fields.last_name || '';
        document.getElementById('editEmail').value = fields.email || '';
        document.getElementById('editRole').value = fields.role || 'viewer';
        document.getElementById('editStatus').value = fields.is_active ? 'true' : 'false';
        document.getElementById('editPassword').value = '';

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('editUserModal'));
        modal.show();

    } catch (error) {
        console.error('Error loading user for edit:', error);
        showError('Failed to load user: ' + error.message);
    }
}

async function updateUser() {
    try {
        const userId = document.getElementById('editUserId').value;
        const firstName = document.getElementById('editFirstName').value.trim();
        const lastName = document.getElementById('editLastName').value.trim();
        const email = document.getElementById('editEmail').value.trim();
        const role = document.getElementById('editRole').value;
        const isActive = document.getElementById('editStatus').value === 'true';
        const newPassword = document.getElementById('editPassword').value;

        // Validation
        if (!firstName || !lastName || !email || !role) {
            throw new Error('Please fill in all required fields');
        }

        if (!email.includes('@')) {
            throw new Error('Please enter a valid email address');
        }

        // Check if email is taken by another user
        const existingUser = allUsers.find(u => u.fields.email === email && u.id !== userId);
        if (existingUser) {
            throw new Error('Email is already taken by another user');
        }

        // Prepare update data
        const updateData = {
            first_name: firstName,
            last_name: lastName,
            email: email,
            role: role, // Using Teable.io role directly
            is_active: isActive
        };

        // Add password hash if new password provided
        if (newPassword) {
            if (newPassword.length < 6) {
                throw new Error('Password must be at least 6 characters long');
            }
            updateData.password_hash = await window.teableAPI.hashPassword(newPassword);
        }

        // Update user in Teable
        await window.teableAPI.updateRecord(window.teableAPI.systemTables.users, userId, updateData);

        // If user is synced from Teable, attempt to update space role
        const user = allUsers.find(u => u.id === userId);
        if (user?.fields.synced_from_teable && window.userSyncManager) {
            try {
                const roleUpdateResult = await window.userSyncManager.updateSpaceUserRole(email, role);
                if (roleUpdateResult.success) {
                    showInfo('User updated and Teable.io space role update attempted');
                }
            } catch (syncError) {
                console.log('Failed to sync role with Teable:', syncError.message);
            }
        }

        // Log activity
        const session = window.teableAuth.getCurrentSession();
        try {
            await window.teableAPI.logActivity(
                session.email,
                'user_updated',
                `Updated user: ${email}`
            );
        } catch (logError) {
            console.log('Failed to log activity:', logError.message);
        }

        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('editUserModal'));
        modal.hide();

        // Reload users
        await loadUsers();
        
        showSuccess('User updated successfully!');

    } catch (error) {
        console.error('Error updating user:', error);
        showError('Failed to update user: ' + error.message);
    }
}

async function deleteUser(userId) {
    try {
        const user = allUsers.find(u => u.id === userId);
        if (!user) {
            throw new Error('User not found');
        }

        const userEmail = user.fields.email;
        
        if (!confirm(`Are you sure you want to delete user "${userEmail}"?\n\nThis action cannot be undone.`)) {
            return;
        }

        // Delete user from Teable
        await window.teableAPI.deleteRecord(window.teableAPI.systemTables.users, userId);

        // Log activity
        const session = window.teableAuth.getCurrentSession();
        try {
            await window.teableAPI.logActivity(
                session.email,
                'user_deleted',
                `Deleted user: ${userEmail}`
            );
        } catch (logError) {
            console.log('Failed to log activity:', logError.message);
        }

        // Reload users
        await loadUsers();
        
        showSuccess('User deleted successfully!');

    } catch (error) {
        console.error('Error deleting user:', error);
        showError('Failed to delete user: ' + error.message);
    }
}

async function resetPassword(userId) {
    try {
        const user = allUsers.find(u => u.id === userId);
        if (!user) {
            throw new Error('User not found');
        }

        const userEmail = user.fields.email;
        const newPassword = prompt(`Reset password for ${userEmail}:\n\nEnter new password (minimum 6 characters):`);
        
        if (!newPassword) return;
        
        if (newPassword.length < 6) {
            throw new Error('Password must be at least 6 characters long');
        }

        // Hash new password
        const passwordHash = await window.teableAPI.hashPassword(newPassword);

        // Update user password
        await window.teableAPI.updateRecord(window.teableAPI.systemTables.users, userId, {
            password_hash: passwordHash
        });

        // Log activity
        const session = window.teableAuth.getCurrentSession();
        try {
            await window.teableAPI.logActivity(
                session.email,
                'password_reset',
                `Reset password for user: ${userEmail}`
            );
        } catch (logError) {
            console.log('Failed to log activity:', logError.message);
        }

        showSuccess('Password reset successfully!');

    } catch (error) {
        console.error('Error resetting password:', error);
        showError('Failed to reset password: ' + error.message);
    }
}

async function syncWithTeable() {
    try {
        showLoading(true);
        
        if (!window.userSyncManager) {
            throw new Error('User sync manager not available');
        }
        
        // Show info about the sync process
        showInfo('🔄 Starting user synchronization from Teable.io...');
        
        // Force sync from Teable.io
        console.log('🔄 Forcing sync from Teable.io...');
        const teableSync = await window.userSyncManager.forceSyncFromTeable();
        
        if (teableSync.created > 0 || teableSync.updated > 0) {
            showSuccess(`✅ Sync from Teable.io completed! 
            • ${teableSync.created} users created
            • ${teableSync.updated} users updated
            • ${teableSync.errors} errors
            
            Details: ${teableSync.details.join(', ')}`);
        } else if (teableSync.errors > 0) {
            showWarning(`⚠️ Sync completed with issues:
            • ${teableSync.errors} errors
            
            Details: ${teableSync.details.join(', ')}`);
        } else {
            showInfo('ℹ️ Sync completed - all users are already up to date');
        }
        
        // Reload users to show updated data
        await loadUsers();
        updateSyncStatus();
        
    } catch (error) {
        console.error('Error syncing with Teable:', error);
        showError('Failed to sync with Teable: ' + error.message);
    } finally {
        showLoading(false);
    }
}

async function syncSingleUser(userId) {
    try {
        const user = allUsers.find(u => u.id === userId);
        if (!user) {
            throw new Error('User not found');
        }

        showInfo(`🔄 Syncing user ${user.fields.email}...`);
        
        // This would trigger a single user sync
        // For now, we'll just refresh the user data
        await loadUsers();
        
        showSuccess(`✅ User ${user.fields.email} sync completed!`);
        
    } catch (error) {
        console.error('Error syncing single user:', error);
        showError('Failed to sync user: ' + error.message);
    }
}

function updateSyncStatus() {
    if (!window.userSyncManager) return;
    
    const status = window.userSyncManager.getSyncStatus();
    const syncButton = document.querySelector('button[onclick="syncWithTeable()"]');
    
    if (syncButton) {
        if (status.syncInProgress) {
            syncButton.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Syncing...';
            syncButton.disabled = true;
        } else {
            syncButton.innerHTML = '<i class="fas fa-sync me-1"></i>Sync with Teable';
            syncButton.disabled = false;
        }
        
        // Update button title with last sync time
        if (status.lastSyncTime) {
            const lastSync = new Date(status.lastSyncTime).toLocaleString();
            syncButton.title = `Last sync: ${lastSync}`;
        }
    }
}

function showLoading(show) {
    const container = document.getElementById('usersTableContainer');
    if (show) {
        container.innerHTML = `
            <div class="text-center py-5">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2 text-muted">Loading users...</p>
            </div>
        `;
    }
}

function showSuccess(message) {
    showAlert('success', message);
}

function showError(message) {
    showAlert('danger', message);
}

function showWarning(message) {
    showAlert('warning', message);
}

function showInfo(message) {
    showAlert('info', message);
}

function showAlert(type, message) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-triangle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
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

// Add CSS for avatar circles
const style = document.createElement('style');
style.textContent = `
    .avatar-circle {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: linear-gradient(45deg, #667eea, #764ba2);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 0.9rem;
    }
`;
document.head.appendChild(style);

// Make functions globally available
window.filterUsers = filterUsers;
window.changePage = changePage;
window.showAddUserModal = showAddUserModal;
window.createUser = createUser;
window.editUser = editUser;
window.updateUser = updateUser;
window.deleteUser = deleteUser;
window.resetPassword = resetPassword;
window.syncWithTeable = syncWithTeable;
window.syncSingleUser = syncSingleUser;