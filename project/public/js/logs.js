/**
 * Data Change Logs Management
 */

let allLogs = [];
let filteredLogs = [];
let currentPage = 1;
let pageSize = 25;
let currentUser = null;

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication and admin privileges
    if (!window.teableAuth.requireAuth()) return;

    // Check if user is admin or creator
    const session = window.teableAuth.getCurrentSession();
    if (!session.isAdmin && session.role !== 'creator') {
        alert('Access denied. Data logs require admin or creator privileges.');
        window.location.href = 'dashboard.html';
        return;
    }

    // Remove view mode toggle listeners as we're using table view only

    initializeLogs();
});

async function initializeLogs() {
    try {
        currentUser = window.teableAuth.getCurrentSession();
        document.getElementById('userDisplay').textContent = 
            `${currentUser.firstName} ${currentUser.lastName} (${currentUser.role})`;

        // Initialize API if needed
        if (currentUser.userType === 'space_owner') {
            window.teableAPI.init(window.teableAuth.clientConfig);
        }

        // Ensure system tables exist
        await window.teableAPI.ensureSystemTables();

        // Create data change log table if it doesn't exist
        await ensureDataLogTable();

        // Load filter options
        await loadFilterOptions();

        // Load logs
        await loadDataLogs();

        console.log('Data logs initialized');

    } catch (error) {
        console.error('Logs initialization failed:', error);
        showError('Failed to initialize logs: ' + error.message);
    }
}

async function ensureDataLogTable() {
    try {
        // Check if data_change_logs table exists
        const tables = await window.teableAPI.getTables();
        const allTables = tables.tables || tables || [];

        let dataLogTable = allTables.find(t => t.name === 'data_change_logs');

        if (!dataLogTable) {
            console.log('Creating data_change_logs table...');
            dataLogTable = await window.teableAPI.createTable({
                name: 'data_change_logs',
                description: 'Comprehensive audit trail of all data changes',
                fields: [
                    { name: 'record_id', type: 'singleLineText' },
                    { name: 'table_id', type: 'singleLineText' },
                    { name: 'table_name', type: 'singleLineText' },
                    { name: 'action_type', type: 'singleSelect', options: {
                        choices: [
                            { name: 'create', color: 'green' },
                            { name: 'update', color: 'yellow' },
                            { name: 'delete', color: 'red' }
                        ]
                    }},
                    { name: 'field_name', type: 'singleLineText' },
                    { name: 'old_value', type: 'longText' },
                    { name: 'new_value', type: 'longText' },
                    { name: 'changed_by', type: 'singleLineText' },
                    { name: 'changed_at', type: 'date' },
                    { name: 'timestamp', type: 'singleLineText' },
                    { name: 'user_role', type: 'singleLineText' },
                    { name: 'ip_address', type: 'singleLineText' },
                    { name: 'session_id', type: 'singleLineText' }
                ]
            });
        }

        // Store table ID for future use
        window.teableAPI.systemTables.dataLogs = dataLogTable.id;

        console.log('Data change logs table ensured');

    } catch (error) {
        console.error('Error ensuring data log table:', error);
        throw error;
    }
}

async function loadFilterOptions() {
    try {
        // Load tables for filter
        const tablesData = await window.teableAPI.getTables();
        const allTables = (tablesData.tables || tablesData || []).filter(t => 
            !t.name.startsWith('app_') && 
            !t.name.startsWith('field_') && 
            !t.name.startsWith('system_') &&
            t.name !== 'data_change_logs'
        );

        const tableFilter = document.getElementById('tableFilter');
        tableFilter.innerHTML = '<option value="">All Tables</option>';

        allTables.forEach(table => {
            const option = document.createElement('option');
            option.value = table.id;
            option.textContent = table.name;
            tableFilter.appendChild(option);
        });

        // Load users for filter
        if (window.teableAPI.systemTables.users) {
            const usersData = await window.teableAPI.getRecords(window.teableAPI.systemTables.users);
            const users = usersData.records || [];

            const userFilter = document.getElementById('userFilter');
            userFilter.innerHTML = '<option value="">All Users</option>';

            users.forEach(user => {
                const fields = user.fields;
                const name = `${fields.first_name || ''} ${fields.last_name || ''}`.trim();
                const displayName = name ? `${name} (${fields.email})` : fields.email;

                const option = document.createElement('option');
                option.value = fields.email;
                option.textContent = displayName;
                userFilter.appendChild(option);
            });
        }

        console.log('Filter options loaded');

    } catch (error) {
        console.error('Error loading filter options:', error);
    }
}

async function loadDataLogs() {
    try {
        if (!window.teableAPI.systemTables.dataLogs) {
            showEmptyState('Data change logging is not yet configured.');
            return;
        }

        // Load all data change logs
        const logsData = await window.teableAPI.getRecords(
            window.teableAPI.systemTables.dataLogs, 
            { limit: 5000, sort: 'timestamp:desc' }
        );

        allLogs = logsData.records || [];

        // Group logs by record and timestamp for better display
        allLogs = groupLogsByChange(allLogs);

        filteredLogs = [...allLogs];

        // Update statistics
        updateStatistics();

        // Display logs
        displayLogs();

        console.log('Loaded data logs:', allLogs.length);

    } catch (error) {
        console.error('Error loading data logs:', error);
        showError('Failed to load data logs: ' + error.message);
    }
}

function groupLogsByChange(logs) {
    // Group logs by record_id, timestamp, and action_type to show related field changes together
    const grouped = {};

    logs.forEach(log => {
        if (!log || !log.fields) {
            console.warn('Invalid log entry:', log);
            return;
        }

        const fields = log.fields;
        const key = `${fields.record_id || 'unknown'}_${fields.timestamp || Date.now()}_${fields.action_type || 'unknown'}`;

        if (!grouped[key]) {
            grouped[key] = {
                id: key,
                recordId: fields.record_id || 'Unknown',
                tableId: fields.table_id || 'Unknown',
                tableName: fields.table_name || 'Unknown Table',
                actionType: fields.action_type || 'unknown',
                changedBy: fields.changed_by || 'Unknown User',
                changedAt: fields.changed_at || new Date().toISOString().split('T')[0],
                timestamp: fields.timestamp || new Date().toISOString(),
                userRole: fields.user_role || 'Unknown',
                ipAddress: fields.ip_address || 'Unknown',
                sessionId: fields.session_id || 'Unknown',
                fieldChanges: []
            };
        }

        // Only add field change if field_name exists
        if (fields.field_name) {
            grouped[key].fieldChanges.push({
                fieldName: fields.field_name,
                oldValue: fields.old_value,
                newValue: fields.new_value
            });
        }
    });

    // Convert to array and sort by timestamp
    return Object.values(grouped).sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );
}

function updateStatistics() {
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = allLogs.filter(log => log.changedAt === today);

    const uniqueUsers = new Set(allLogs.map(log => log.changedBy));
    const uniqueTables = new Set(allLogs.map(log => log.tableId));

    document.getElementById('totalChanges').textContent = allLogs.length;
    document.getElementById('todayChanges').textContent = todayLogs.length;
    document.getElementById('activeUsers').textContent = uniqueUsers.size;
    document.getElementById('affectedTables').textContent = uniqueTables.size;
}

function displayLogs() {
    const container = document.getElementById('logsContainer');

    if (filteredLogs.length === 0) {
        showEmptyState('No data changes found matching your filters.');
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(filteredLogs.length / pageSize);
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const pageData = filteredLogs.slice(startIndex, endIndex);

    // Create enhanced table view with field change history
    const html = createEnhancedFieldChangesTable(pageData);

    container.innerHTML = html;

    // Update pagination
    updatePagination();

    // Update filter counts
    document.getElementById('filteredCount').textContent = filteredLogs.length;
    document.getElementById('totalCount').textContent = allLogs.length;
}

function createEnhancedFieldChangesTable(pageData) {
    // Process data to group field changes by field name and show history
    const fieldChangesMap = new Map();

    // Flatten all field changes and group by field name
    pageData.forEach(logEntry => {
        if (logEntry.fieldChanges && logEntry.fieldChanges.length > 0) {
            logEntry.fieldChanges.forEach(change => {
                const key = `${logEntry.tableName}_${change.fieldName}`;
                if (!fieldChangesMap.has(key)) {
                    fieldChangesMap.set(key, {
                        tableName: logEntry.tableName,
                        fieldName: change.fieldName,
                        changes: []
                    });
                }

                fieldChangesMap.get(key).changes.push({
                    ...change,
                    timestamp: logEntry.timestamp,
                    changedBy: logEntry.changedBy,
                    actionType: logEntry.actionType,
                    recordId: logEntry.recordId,
                    userRole: logEntry.userRole
                });
            });
        }
    });

    // Sort changes within each field by timestamp (newest first)
    fieldChangesMap.forEach(fieldData => {
        fieldData.changes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    });

    let html = `
        <div class="logs-table">
            <div class="table-responsive">
                <table class="table table-hover mb-0">
                    <thead>
                        <tr>
                            <th style="width: 150px;">Table</th>
                            <th style="width: 150px;">Field Name</th>
                            <th style="width: 200px;">Old Value</th>
                            <th style="width: 200px;">New Value</th>
                            <th style="width: 120px;">Changed By</th>
                            <th style="width: 100px;">Action</th>
                            <th style="width: 140px;">Last Changed</th>
                            <th>History</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    if (fieldChangesMap.size === 0) {
        html += `
            <tr>
                <td colspan="8" class="text-center text-muted py-4">
                    <i class="fas fa-info-circle me-2"></i>
                    No field changes found in the selected data
                </td>
            </tr>
        `;
    } else {
        // Convert map to array and sort by most recent change
        const sortedFields = Array.from(fieldChangesMap.values()).sort((a, b) => 
            new Date(b.changes[0].timestamp) - new Date(a.changes[0].timestamp)
        );

        sortedFields.forEach(fieldData => {
            const mostRecent = fieldData.changes[0];
            const history = fieldData.changes.slice(1);
            const timestamp = new Date(mostRecent.timestamp);

            html += `
                <tr>
                    <td>
                        <div class="fw-semibold">${fieldData.tableName}</div>
                    </td>
                    <td>
                        <div class="d-flex align-items-center">
                            <i class="${getFieldIcon(fieldData.fieldName)} me-2 text-primary"></i>
                            <span class="fw-semibold">${fieldData.fieldName}</span>
                        </div>
                    </td>
                    <td>
                        <div class="old-value-cell">
                            ${formatCellValue(mostRecent.oldValue)}
                        </div>
                    </td>
                    <td>
                        <div class="new-value-cell">
                            ${formatCellValue(mostRecent.newValue)}
                        </div>
                    </td>
                    <td>
                        <div class="fw-semibold">${mostRecent.changedBy}</div>
                        <small class="text-muted">${mostRecent.userRole || 'User'}</small>
                    </td>
                    <td>
                        <span class="action-badge ${mostRecent.actionType.toLowerCase()}">${mostRecent.actionType}</span>
                    </td>
                    <td>
                        <div class="fw-semibold">${timestamp.toLocaleDateString()}</div>
                        <small class="text-muted">${timestamp.toLocaleTimeString()}</small>
                    </td>
                    <td>
                        ${createHistoryCell(history)}
                    </td>
                </tr>
            `;
        });
    }

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return html;
}

function formatCellValue(value) {
    if (value === null || value === undefined) {
        return '<em class="text-muted">null</em>';
    }

    if (value === '') {
        return '<em class="text-muted">empty</em>';
    }

    const stringValue = String(value);

    // Truncate very long values for cell display
    if (stringValue.length > 100) {
        return `
            <div class="value-preview" title="${stringValue.replace(/"/g, '&quot;')}">
                ${stringValue.substring(0, 100)}...
                <small class="text-muted d-block">(${stringValue.length} chars)</small>
            </div>
        `;
    }

    return `<span class="value-content">${stringValue.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
}

function createHistoryCell(history) {
    if (!history || history.length === 0) {
        return '<em class="text-muted">No previous changes</em>';
    }

    let html = `
        <div class="history-container">
            <button class="btn btn-sm btn-outline-secondary history-toggle" onclick="toggleHistory(this)">
                <i class="fas fa-history me-1"></i>
                ${history.length} previous change${history.length > 1 ? 's' : ''}
            </button>
            <div class="history-details" style="display: none;">
    `;

    history.forEach((change, index) => {
        const timestamp = new Date(change.timestamp);
        html += `
            <div class="history-item ${index < history.length - 1 ? 'border-bottom' : ''} pb-2 mb-2">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="history-change">
                            <strong>From:</strong> ${formatCellValue(change.oldValue)}<br>
                            <strong>To:</strong> ${formatCellValue(change.newValue)}
                        </div>
                    </div>
                    <div class="text-end">
                        <div class="small">
                            <span class="action-badge ${change.actionType.toLowerCase()}">${change.actionType}</span>
                        </div>
                        <div class="small text-muted">
                            ${timestamp.toLocaleDateString()}<br>
                            ${timestamp.toLocaleTimeString()}
                        </div>
                        <div class="small fw-semibold">${change.changedBy}</div>
                    </div>
                </div>
            </div>
        `;
    });

    html += `
            </div>
        </div>
    `;

    return html;
}

function toggleHistory(button) {
    const historyDetails = button.nextElementSibling;
    const icon = button.querySelector('i');

    if (historyDetails.style.display === 'none') {
        historyDetails.style.display = 'block';
        icon.className = 'fas fa-chevron-up me-1';
        button.classList.remove('btn-outline-secondary');
        button.classList.add('btn-secondary');
    } else {
        historyDetails.style.display = 'none';
        icon.className = 'fas fa-history me-1';
        button.classList.remove('btn-secondary');
        button.classList.add('btn-outline-secondary');
    }
}

function createTableView(pageData) {
    let html = `
        <div class="logs-table">
            <div class="table-responsive">
                <table class="table table-hover mb-0">
                    <thead>
                        <tr>
                            <th style="width: 140px;">Timestamp</th>
                            <th style="width: 80px;">Action</th>
                            <th style="width: 120px;">Table</th>
                            <th style="width: 100px;">Record ID</th>
                            <th style="width: 120px;">User</th>
                            <th style="width: 80px;">Role</th>
                            <th>Field Changes</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    // Flatten logs to show individual field changes
    const flattenedLogs = [];
    pageData.forEach(logEntry => {
        if (logEntry.fieldChanges && logEntry.fieldChanges.length > 0) {
            logEntry.fieldChanges.forEach((change, index) => {
                flattenedLogs.push({
                    ...logEntry,
                    fieldChange: change,
                    isFirstChange: index === 0,
                    totalChanges: logEntry.fieldChanges.length
                });
            });
        } else {
            // For entries without field changes (like pure create/delete)
            flattenedLogs.push({
                ...logEntry,
                fieldChange: null,
                isFirstChange: true,
                totalChanges: 0
            });
        }
    });

    flattenedLogs.forEach(entry => {
        const timestamp = new Date(entry.timestamp || new Date());
        const actionType = entry.actionType || 'unknown';
        const timeAgo = getTimeAgo(timestamp);

        html += `
            <tr>
                ${entry.isFirstChange ? `
                    <td rowspan="${Math.max(entry.totalChanges, 1)}" class="text-nowrap">
                        <div class="fw-bold">${timestamp.toLocaleString()}</div>
                        <small class="text-muted">${timeAgo}</small>
                    </td>
                    <td rowspan="${Math.max(entry.totalChanges, 1)}">
                        <span class="action-badge ${actionType.toLowerCase()}">${actionType}</span>
                    </td>
                    <td rowspan="${Math.max(entry.totalChanges, 1)}" class="text-nowrap">
                        <div class="fw-semibold">${entry.tableName || 'Unknown'}</div>
                        <small class="text-muted">${entry.tableId || 'N/A'}</small>
                    </td>
                    <td rowspan="${Math.max(entry.totalChanges, 1)}" class="text-nowrap">
                        <code class="small">${entry.recordId || 'Unknown'}</code>
                    </td>
                    <td rowspan="${Math.max(entry.totalChanges, 1)}" class="text-nowrap">
                        <div class="fw-semibold">${entry.changedBy || 'Unknown'}</div>
                    </td>
                    <td rowspan="${Math.max(entry.totalChanges, 1)}">
                        <span class="badge bg-secondary">${entry.userRole || 'Unknown'}</span>
                    </td>
                ` : ''}
                <td>
                    ${entry.fieldChange ? createFieldChangeTableCell(entry.fieldChange, actionType) : 
                      `<em class="text-muted">${actionType === 'create' ? 'Record created' : 
                        actionType === 'delete' ? 'Record deleted' : 'No field changes recorded'}</em>`}
                </td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return html;
}

function createFieldChangeTableCell(change, actionType) {
    if (!change || !change.fieldName) {
        return '<em class="text-muted">Invalid field data</em>';
    }

    const fieldIcon = getFieldIcon(change.fieldName);

    let html = `
        <div class="field-change-item">
            <i class="${fieldIcon} me-1"></i>
            <strong>${change.fieldName}</strong>
    `;

    if (actionType === 'create') {
        html += `<br><span class="new-value-inline">${formatValueInline(change.newValue)}</span>`;
    } else if (actionType === 'delete') {
        html += `<br><span class="old-value-inline">${formatValueInline(change.oldValue)}</span>`;
    } else {
        html += `
            <br>
            <span class="old-value-inline">${formatValueInline(change.oldValue)}</span>
            <i class="fas fa-arrow-right mx-1 text-muted"></i>
            <span class="new-value-inline">${formatValueInline(change.newValue)}</span>
        `;
    }

    html += '</div>';
    return html;
}

function formatValueInline(value) {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (value === '') {
        return 'empty';
    }

    const stringValue = String(value);

    // Truncate very long values for inline display
    if (stringValue.length > 50) {
        return stringValue.substring(0, 50) + '...';
    }

    return stringValue;
}

function createLogEntryHTML(logEntry) {
    const actionType = logEntry.actionType || 'unknown';
    const actionClass = actionType ? actionType.toLowerCase() : 'unknown';
    const actionIcon = getActionIcon(actionType);
    const timestamp = new Date(logEntry.timestamp || new Date());
    const timeAgo = getTimeAgo(timestamp);

    let html = `
        <div class="log-entry ${actionClass}">
            <div class="log-header">
                <div class="log-meta">
                    <div class="d-flex align-items-center gap-2">
                        <span class="log-action ${actionClass}">
                            <i class="${actionIcon} me-1"></i>${actionType || 'Unknown'}
                        </span>
                        <span class="log-table">${logEntry.tableName || 'Unknown Table'}</span>
                        <span class="log-user">
                            <i class="fas fa-user me-1"></i>${logEntry.changedBy || 'Unknown User'}
                        </span>
                    </div>
                    <div class="log-timestamp">
                        <i class="fas fa-clock me-1"></i>
                        ${timestamp.toLocaleString()} (${timeAgo})
                    </div>
                </div>
            </div>
            <div class="log-body">
                <div class="mb-3">
                    <strong>Record ID:</strong> ${logEntry.recordId || 'Unknown'}
                    ${logEntry.userRole ? `<span class="ms-3"><strong>User Role:</strong> ${logEntry.userRole}</span>` : ''}
                    ${logEntry.ipAddress ? `<span class="ms-3"><strong>IP:</strong> ${logEntry.ipAddress}</span>` : ''}
                </div>
    `;

    if (actionType === 'create') {
        html += `
            <div class="alert alert-success">
                <i class="fas fa-plus-circle me-2"></i>
                New record created with ${logEntry.fieldChanges ? logEntry.fieldChanges.length : 0} field(s)
            </div>
        `;
    } else if (actionType === 'delete') {
        html += `
            <div class="alert alert-danger">
                <i class="fas fa-trash me-2"></i>
                Record deleted (${logEntry.fieldChanges ? logEntry.fieldChanges.length : 0} field(s) were lost)
            </div>
        `;
    }

    // Show field changes
    if (logEntry.fieldChanges && Array.isArray(logEntry.fieldChanges) && logEntry.fieldChanges.length > 0) {
        html += '<div class="field-changes">';

        logEntry.fieldChanges.forEach(change => {
            if (change && typeof change === 'object') {
                html += createFieldChangeHTML(change, actionType);
            }
        });

        html += '</div>';
    }

    html += `
            </div>
        </div>
    `;

    return html;
}

function createFieldChangeHTML(change, actionType) {
    if (!change || !change.fieldName) {
        return '<div class="field-change"><div class="text-muted">Invalid field change data</div></div>';
    }

    const fieldIcon = getFieldIcon(change.fieldName);

    let html = `
        <div class="field-change">
            <div class="field-name">
                <i class="${fieldIcon} me-2"></i>
                ${change.fieldName}
            </div>
    `;

    if (actionType === 'create') {
        html += `
            <div class="new-value">
                <strong>Initial Value:</strong> ${formatValue(change.newValue)}
            </div>
        `;
    } else if (actionType === 'delete') {
        html += `
            <div class="old-value">
                <strong>Lost Value:</strong> ${formatValue(change.oldValue)}
            </div>
        `;
    } else {
        html += `
            <div class="value-comparison">
                <div class="old-value">
                    <strong>Old:</strong><br>
                    ${formatValue(change.oldValue)}
                </div>
                <div class="change-arrow">
                    <i class="fas fa-arrow-right"></i>
                </div>
                <div class="new-value">
                    <strong>New:</strong><br>
                    ${formatValue(change.newValue)}
                </div>
            </div>
        `;
    }

    html += '</div>';
    return html;
}

function formatValue(value) {
    if (value === null || value === undefined) {
        return '<em class="text-muted">null</em>';
    }

    if (value === '') {
        return '<em class="text-muted">empty</em>';
    }

    const stringValue = String(value);

    // Truncate very long values
    if (stringValue.length > 200) {
        return stringValue.substring(0, 200) + '... <em class="text-muted">(truncated)</em>';
    }

    // Escape HTML
    return stringValue.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getActionIcon(actionType) {
    if (!actionType) return 'fas fa-question-circle';

    const icons = {
        'create': 'fas fa-plus-circle',
        'update': 'fas fa-edit',
        'delete': 'fas fa-trash',
        'unknown': 'fas fa-question-circle'
    };
    return icons[actionType.toLowerCase()] || 'fas fa-question-circle';
}

function getFieldIcon(fieldName) {
    if (!fieldName || typeof fieldName !== 'string') {
        return 'fas fa-question-circle';
    }

    const name = fieldName.toLowerCase();
    if (name.includes('email')) return 'fas fa-envelope';
    if (name.includes('phone')) return 'fas fa-phone';
    if (name.includes('date') || name.includes('time')) return 'fas fa-calendar';
    if (name.includes('name') || name.includes('title')) return 'fas fa-tag';
    if (name.includes('address') || name.includes('location')) return 'fas fa-map-marker-alt';
    if (name.includes('url') || name.includes('link')) return 'fas fa-link';
    if (name.includes('number') || name.includes('count') || name.includes('amount')) return 'fas fa-hashtag';
    if (name.includes('description') || name.includes('comment')) return 'fas fa-comment';
    if (name.includes('status') || name.includes('state')) return 'fas fa-flag';
    return 'fas fa-font';
}

function getTimeAgo(date) {
    if (!date || isNaN(new Date(date).getTime())) {
        return 'Unknown time';
    }

    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

    return date.toLocaleDateString();
}

function applyFilters() {
    const dateRange = document.getElementById('dateRange').value;
    const tableFilter = document.getElementById('tableFilter').value;
    const userFilter = document.getElementById('userFilter').value;
    const actionFilter = document.getElementById('actionFilter').value;
    const searchText = document.getElementById('searchText').value.toLowerCase();

    // Show/hide custom date range
    const customDateRange = document.getElementById('customDateRange');
    if (dateRange === 'custom') {
        customDateRange.style.display = 'block';
    } else {
        customDateRange.style.display = 'none';
    }

    filteredLogs = allLogs.filter(log => {
        // Date filter
        if (dateRange !== 'all') {
            const logDate = new Date(log.changedAt);
            const today = new Date();

            switch (dateRange) {
                case 'today':
                    if (logDate.toDateString() !== today.toDateString()) return false;
                    break;
                case 'week':
                    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
                    if (logDate < weekAgo) return false;
                    break;
                case 'month':
                    const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
                    if (logDate < monthAgo) return false;
                    break;
                case 'custom':
                    const fromDate = document.getElementById('fromDate').value;
                    const toDate = document.getElementById('toDate').value;
                    if (fromDate && logDate < new Date(fromDate)) return false;
                    if (toDate && logDate > new Date(toDate + 'T23:59:59')) return false;
                    break;
            }
        }

        // Table filter
        if (tableFilter && log.tableId !== tableFilter) return false;

        // User filter
        if (userFilter && log.changedBy !== userFilter) return false;

        // Action filter
        if (actionFilter && log.actionType !== actionFilter) return false;

        // Search filter
        if (searchText) {
            const searchableText = [
                log.tableName,
                log.changedBy,
                log.recordId,
                ...log.fieldChanges.map(fc => fc.fieldName),
                ...log.fieldChanges.map(fc => fc.oldValue),
                ...log.fieldChanges.map(fc => fc.newValue)
            ].join(' ').toLowerCase();

            if (!searchableText.includes(searchText)) return false;
        }

        return true;
    });

    currentPage = 1;
    displayLogs();
}

function clearFilters() {
    document.getElementById('dateRange').value = 'all';
    document.getElementById('tableFilter').value = '';
    document.getElementById('userFilter').value = '';
    document.getElementById('actionFilter').value = '';
    document.getElementById('searchText').value = '';
    document.getElementById('fromDate').value = '';
    document.getElementById('toDate').value = '';
    document.getElementById('customDateRange').style.display = 'none';

    filteredLogs = [...allLogs];
    currentPage = 1;
    displayLogs();
}

function updatePagination() {
    const totalPages = Math.ceil(filteredLogs.length / pageSize);
    const pagination = document.getElementById('logsPagination');
    const paginationList = pagination.querySelector('.pagination');

    if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
    }

    pagination.style.display = 'flex';

    // Update page info
    const startRecord = (currentPage - 1) * pageSize + 1;
    const endRecord = Math.min(currentPage * pageSize, filteredLogs.length);

    document.getElementById('pageStart').textContent = startRecord;
    document.getElementById('pageEnd').textContent = endRecord;
    document.getElementById('pageTotal').textContent = filteredLogs.length;

    // Generate pagination
    let html = '';

    // Previous button
    html += `
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            ```text
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

    paginationList.innerHTML = html;
}

function changePage(page) {
    const totalPages = Math.ceil(filteredLogs.length / pageSize);
    if (page >= 1 && page <= totalPages) {
        currentPage = page;
        displayLogs();

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function changePageSize() {
    pageSize = parseInt(document.getElementById('pageSize').value);
    currentPage = 1;
    displayLogs();
}

async function refreshLogs() {
    try {
        document.getElementById('logsContainer').innerHTML = `
            <div class="loading-spinner">
                <div class="spinner-border text-primary" role="status">
                    <span class="visually-hidden">Loading...</span>
                </div>
                <span class="ms-3">Refreshing logs...</span>
            </div>
        `;

        await loadDataLogs();
        showSuccess('Logs refreshed successfully!');

    } catch (error) {
        console.error('Error refreshing logs:', error);
        showError('Failed to refresh logs: ' + error.message);
    }
}

async function exportLogs(format) {
    try {
        const dataToExport = filteredLogs.map(log => {
            const baseData = {
                timestamp: log.timestamp,
                date: log.changedAt,
                table_name: log.tableName,
                table_id: log.tableId,
                record_id: log.recordId,
                action_type: log.actionType,
                changed_by: log.changedBy,
                user_role: log.userRole,
                ip_address: log.ipAddress,
                session_id: log.sessionId
            };

            // Flatten field changes
            const exportData = [];
            log.fieldChanges.forEach(change => {
                exportData.push({
                    ...baseData,
                    field_name: change.fieldName,
                    old_value: change.oldValue,
                    new_value: change.newValue
                });
            });

            return exportData;
        }).flat();

        if (format === 'csv') {
            exportToCSV(dataToExport);
        } else if (format === 'json') {
            exportToJSON(dataToExport);
        }

        showSuccess(`Logs exported as ${format.toUpperCase()} successfully!`);

    } catch (error) {
        console.error('Error exporting logs:', error);
        showError('Failed to export logs: ' + error.message);
    }
}

function exportToCSV(data) {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    let csv = headers.join(',') + '\n';

    data.forEach(row => {
        const values = headers.map(header => {
            const value = row[header] || '';
            return `"${String(value).replace(/"/g, '""')}"`;
        });
        csv += values.join(',') + '\n';
    });

    downloadFile(csv, `data_change_logs_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
}

function exportToJSON(data) {
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `data_change_logs_${new Date().toISOString().split('T')[0]}.json`, 'application/json');
}

function downloadFile(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

function showEmptyState(message) {
    document.getElementById('logsContainer').innerHTML = `
        <div class="empty-state">
            <i class="fas fa-history"></i>
            <h5>No Change Logs</h5>
            <p>${message}</p>
            <button class="btn btn-primary" onclick="refreshLogs()">
                <i class="fas fa-sync me-1"></i>Refresh
            </button>
        </div>
    `;
}

function showSuccess(message) {
    showAlert('success', message);
}

function showError(message) {
    showAlert('danger', message);
}

function showAlert(type, message) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    alertDiv.style.cssText = 'top: 80px; right: 20px; z-index: 9999; min-width: 300px;';
    alertDiv.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-triangle'} me-2"></i>
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    document.body.appendChild(alertDiv);

    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.remove();
        }
    }, 5000);
}

async function loadLogs() {
    try {
        showLoading(true);
        console.log('🔄 Starting to load logs...');

        if (!window.teableAPI) {
            throw new Error('Teable API not available. Please check your configuration.');
        }

        if (!window.teableAPI.systemTables) {
            console.log('⚠️ System tables not initialized, attempting to initialize...');
            try {
                await window.teableAPI.ensureSystemTables();
                console.log('✅ System tables initialized successfully');
            } catch (initError) {
                throw new Error(`Failed to initialize system tables: ${initError.message}`);
            }
        }

        if (!window.teableAPI.systemTables.dataLogs) {
            throw new Error('Data logs table not available. Please run system setup first.');
        }

        console.log('📊 Loading logs from table:', window.teableAPI.systemTables.dataLogs);

        // Get logs data with pagination
        const logsData = await window.teableAPI.getRecords(window.teableAPI.systemTables.dataLogs, { 
            limit: 1000
        });

        allLogs = logsData.records || [];
        console.log(`✅ Loaded ${allLogs.length} log entries`);

        // Sort logs by timestamp (newest first)
        allLogs.sort((a, b) => {
            const timestampA = new Date(a.fields.timestamp || a.fields.changed_at || '1970-01-01');
            const timestampB = new Date(b.fields.timestamp || b.fields.changed_at || '1970-01-01');
            return timestampB - timestampA;
        });

        console.log('📝 Sample log entry:', allLogs[0]);

        // Apply current filters
        applyFilters();

        // Update statistics
        updateLogStatistics();

        if (allLogs.length === 0) {
            showInfo('No log entries found. Make some changes to tables or records to see logs appear here.');
        } else {
            showSuccess(`Loaded ${allLogs.length} log entries successfully`);
        }

    } catch (error) {
        console.error('❌ Error loading logs:', error);
        showError(`Failed to load logs: ${error.message}`);

        // Show detailed error state
        document.getElementById('logsTableBody').innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-4">
                    <div class="text-muted">
                        <i class="fas fa-exclamation-triangle fa-2x mb-2 text-warning"></i>
                        <h5>Error Loading Logs</h5>
                        <p class="mb-3">${error.message}</p>
                        <div class="d-flex gap-2 justify-content-center">
                            <button class="btn btn-primary btn-sm" onclick="loadLogs()">
                                <i class="fas fa-sync me-1"></i>Retry Loading
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="initializeSystemTables()">
                                <i class="fas fa-cog me-1"></i>Initialize System
                            </button>
                        </div>
                        <small class="text-muted mt-2 d-block">
                            If this persists, check your Teable.io connection and permissions.
                        </small>
                    </div>
                </td>
            </tr>
        `;
    } finally {
        showLoading(false);
    }
}

// Initialize system tables if needed
async function initializeSystemTables() {
    try {
        showLoading(true);
        console.log('🔧 Initializing system tables...');

        if (!window.teableAPI) {
            throw new Error('Teable API not available. Please check your configuration.');
        }

        await window.teableAPI.ensureSystemTables();
        console.log('✅ System tables initialized successfully');

        showSuccess('System tables initialized successfully. Loading logs...');

        // Reload logs after initialization
        setTimeout(() => {
            loadLogs();
        }, 1000);

    } catch (error) {
        console.error('❌ Error initializing system tables:', error);
        showError(`Failed to initialize system tables: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

// Make functions globally available
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.exportLogs = exportLogs;
window.refreshLogs = refreshLogs;
window.initializeSystemTables = initializeSystemTables;