/**
 * Professional Table View with Permission-Aware Features
 */

let currentTableData = [];
let currentTableFields = [];
let currentTablePermissions = {};
let filteredData = [];
let selectedRows = new Set();
let currentRowHeight = 'comfortable';
let currentFilters = [];
let currentSort = { field: null, direction: 'asc' };
let currentPage = 1;
let rowsPerPage = 50;
let frozenColumns = 0;
let columnWidths = {};
let visibleColumns = new Set();
let currentUser = null;

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication
    if (!window.teableAuth.requireAuth()) return;
    
    initializeTableView();
});

async function initializeTableView() {
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
        
        // Load available tables
        await loadTableSelector();
        
        // Setup event listeners
        setupEventListeners();
        
    } catch (error) {
        console.error('Table view initialization failed:', error);
        showError('Failed to initialize table view: ' + error.message);
    }
}

function setupEventListeners() {
    // View mode change
    document.querySelectorAll('input[name="viewMode"]').forEach(radio => {
        radio.addEventListener('change', function() {
            switchViewMode(this.value);
        });
    });

    // Context menu
    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', function(e) {
        if (e.target.closest('.grid-table')) {
            e.preventDefault();
            showContextMenu(e);
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
}

async function loadTableSelector() {
    try {
        const tablesData = await window.teableAPI.getTables();
        const allTables = tablesData.tables || tablesData || [];
        const userTables = allTables.filter(t => 
            !t.name.startsWith('app_') && 
            !t.name.startsWith('field_') && 
            !t.name.startsWith('system_')
        );
        
        const selector = document.getElementById('tableSelector');
        selector.innerHTML = '<option value="">Choose a table...</option>';
        
        userTables.forEach(table => {
            const option = document.createElement('option');
            option.value = table.id;
            option.textContent = table.name;
            selector.appendChild(option);
        });
        
        console.log('Loaded tables for selector:', userTables.length);
        
    } catch (error) {
        console.error('Error loading table selector:', error);
        showError('Failed to load tables: ' + error.message);
    }
}

async function loadTableData() {
    const tableId = document.getElementById('tableSelector').value;
    if (!tableId) {
        showEmptyState();
        return;
    }

    try {
        showLoading(true);
        hideEmptyState();

        // Get table info
        const tablesData = await window.teableAPI.getTables();
        const allTables = tablesData.tables || tablesData || [];
        const currentTable = allTables.find(t => t.id === tableId);
        
        // Update table header
        document.getElementById('tableTitle').textContent = currentTable?.name || 'Unknown Table';
        document.getElementById('tableSubtitle').textContent = `Table ID: ${tableId}`;

        // Get table records
        const recordsData = await window.teableAPI.getRecords(tableId, { limit: 1000 });
        currentTableData = recordsData.records || [];

        // Extract field information from first record or table schema
        if (currentTableData.length > 0) {
            const firstRecord = currentTableData[0];
            const fieldNames = Object.keys(firstRecord.fields || {});
            currentTableFields = fieldNames.map(fieldName => ({
                id: `${tableId}_${fieldName}`,
                name: fieldName,
                type: detectFieldType(firstRecord.fields[fieldName]),
                visible: true
            }));
        } else {
            currentTableFields = [];
        }

        // Load user permissions for this table
        currentTablePermissions = await loadUserPermissions(tableId);

        // Filter data based on permissions
        filteredData = filterDataByPermissions([...currentTableData]);

        // Initialize visible columns based on permissions
        visibleColumns = new Set(
            currentTableFields
                .filter(field => {
                    const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
                    return permission !== 'hidden';
                })
                .map(f => f.name)
        );

        // Enable controls
        document.getElementById('addRecordBtn').disabled = !hasEditPermissions();

        // Show table container
        document.getElementById('tableContainer').style.display = 'block';
        
        // Render table
        renderTable();
        updateTableStats();
        populateColumnControls();
        populateSortMenu();
        
        // Log activity
        await window.teableAPI.logActivity(
            currentUser.email,
            'table_accessed',
            `Accessed table: ${currentTable?.name || tableId}`,
            tableId
        );

    } catch (error) {
        console.error('Error loading table data:', error);
        showError('Failed to load table data: ' + error.message);
    } finally {
        showLoading(false);
    }
}

async function loadUserPermissions(tableId) {
    try {
        // Admins have full access
        if (currentUser.isAdmin) {
            const permissions = {};
            currentTableFields.forEach(field => {
                permissions[field.id] = 'edit';
            });
            return permissions;
        }

        if (!window.teableAPI.systemTables.permissions) {
            // No permissions system, use role-based defaults
            const permissions = {};
            currentTableFields.forEach(field => {
                permissions[field.id] = getDefaultPermission(currentUser.role);
            });
            return permissions;
        }

        const permissionsData = await window.teableAPI.getRecords(window.teableAPI.systemTables.permissions);
        const permissions = {};
        
        permissionsData.records?.forEach(record => {
            const fields = record.fields;
            if (fields.user_email === currentUser.email && fields.table_id === tableId) {
                permissions[fields.field_id] = fields.permission_type;
            }
        });
        
        // Set default permissions for fields without explicit permissions
        currentTableFields.forEach(field => {
            if (!permissions[field.id]) {
                permissions[field.id] = getDefaultPermission(currentUser.role);
            }
        });
        
        return permissions;
        
    } catch (error) {
        console.error('Error loading user permissions:', error);
        // Default to role-based permissions on error
        const permissions = {};
        currentTableFields.forEach(field => {
            permissions[field.id] = getDefaultPermission(currentUser.role);
        });
        return permissions;
    }
}

function getDefaultPermission(userRole) {
    const rolePermissions = {
        'creator': 'edit',
        'editor': 'edit',
        'commenter': 'view',
        'viewer': 'view'
    };
    return rolePermissions[userRole] || 'view';
}

function hasEditPermissions() {
    // Check if user has edit permissions on any field
    return Object.values(currentTablePermissions).some(permission => permission === 'edit') ||
           currentUser.role === 'creator' || currentUser.role === 'editor';
}

function filterDataByPermissions(data) {
    // Filter out hidden fields from all records
    return data.map(record => {
        const filteredFields = {};
        
        Object.keys(record.fields).forEach(fieldName => {
            const fieldId = `${document.getElementById('tableSelector').value}_${fieldName}`;
            const permission = currentTablePermissions[fieldId] || getDefaultPermission(currentUser.role);
            
            if (permission !== 'hidden') {
                filteredFields[fieldName] = record.fields[fieldName];
            }
        });
        
        return {
            ...record,
            fields: filteredFields
        };
    });
}

function detectFieldType(value) {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (value && typeof value === 'string') {
        if (value.match(/^\d{4}-\d{2}-\d{2}/)) return 'date';
        if (value.includes('@')) return 'email';
        if (value.startsWith('http')) return 'url';
        if (value.length > 100) return 'longText';
    }
    return 'text';
}

function renderTable() {
    const tableHead = document.getElementById('tableHead');
    const tableBody = document.getElementById('tableBody');
    
    // Clear existing content
    tableHead.innerHTML = '';
    tableBody.innerHTML = '';

    // Filter visible fields based on permissions and visibility settings
    const visibleFields = currentTableFields.filter(field => {
        const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
        return permission !== 'hidden' && visibleColumns.has(field.name);
    });

    if (visibleFields.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="100%" class="text-center text-muted py-5">
                    <i class="fas fa-eye-slash fa-2x mb-2"></i>
                    <p>No visible fields for your permission level</p>
                    <p class="small">Contact your administrator to adjust field permissions</p>
                </td>
            </tr>
        `;
        return;
    }

    // Create table header
    const headerRow = document.createElement('tr');
    
    // Row selector column
    const selectorHeader = document.createElement('th');
    selectorHeader.className = 'row-selector frozen';
    selectorHeader.innerHTML = `
        <input type="checkbox" onchange="toggleSelectAll(this)" title="Select all">
    `;
    headerRow.appendChild(selectorHeader);

    // Field headers
    visibleFields.forEach((field, index) => {
        const th = document.createElement('th');
        th.className = 'sortable';
        if (index < frozenColumns) {
            th.classList.add('frozen');
            th.style.left = `${40 + (index * 150)}px`; // Adjust for row selector
        }
        
        const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
        const fieldTypeIcon = getFieldTypeIcon(field.type);
        const permissionIndicator = getPermissionIndicator(permission);
        const sortIcon = currentSort.field === field.name ? 
            (currentSort.direction === 'asc' ? 'fa-sort-up' : 'fa-sort-down') : 'fa-sort';
        
        th.innerHTML = `
            <div class="d-flex align-items-center justify-content-between">
                <div class="d-flex align-items-center">
                    ${permissionIndicator}
                    <i class="${fieldTypeIcon} field-type-icon field-type-${field.type}"></i>
                    <span>${field.name}</span>
                </div>
                <div class="d-flex align-items-center">
                    <i class="fas ${sortIcon} sort-indicator ${currentSort.field === field.name ? 'sorted' : ''}"></i>
                    <div class="dropdown">
                        <button class="btn btn-sm column-menu" data-bs-toggle="dropdown">
                            <i class="fas fa-ellipsis-v"></i>
                        </button>
                        <ul class="dropdown-menu">
                            <li><a class="dropdown-item" href="#" onclick="sortColumn('${field.name}', 'asc')">
                                <i class="fas fa-sort-alpha-down me-2"></i>Sort A-Z
                            </a></li>
                            <li><a class="dropdown-item" href="#" onclick="sortColumn('${field.name}', 'desc')">
                                <i class="fas fa-sort-alpha-up me-2"></i>Sort Z-A
                            </a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><a class="dropdown-item" href="#" onclick="hideColumn('${field.name}')">
                                <i class="fas fa-eye-slash me-2"></i>Hide Column
                            </a></li>
                            ${permission === 'edit' ? `
                            <li><a class="dropdown-item" href="#" onclick="freezeColumn('${field.name}')">
                                <i class="fas fa-thumbtack me-2"></i>Freeze Column
                            </a></li>
                            ` : ''}
                        </ul>
                    </div>
                </div>
            </div>
            <div class="resize-handle" onmousedown="startColumnResize(event, '${field.name}')"></div>
        `;
        
        th.onclick = (e) => {
            if (!e.target.closest('.dropdown') && !e.target.closest('.resize-handle')) {
                toggleSort(field.name);
            }
        };
        
        headerRow.appendChild(th);
    });
    
    tableHead.appendChild(headerRow);

    // Create table body with pagination
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const pageData = filteredData.slice(startIndex, endIndex);

    pageData.forEach((record, rowIndex) => {
        const row = document.createElement('tr');
        row.dataset.recordId = record.id;
        
        if (selectedRows.has(record.id)) {
            row.classList.add('selected');
        }
        
        // Row selector
        const selectorCell = document.createElement('td');
        selectorCell.className = 'row-selector frozen';
        selectorCell.innerHTML = `
            <input type="checkbox" ${selectedRows.has(record.id) ? 'checked' : ''} 
                   onchange="toggleRowSelection('${record.id}', this.checked)">
        `;
        row.appendChild(selectorCell);
        
        // Data cells
        visibleFields.forEach((field, colIndex) => {
            const td = document.createElement('td');
            if (colIndex < frozenColumns) {
                td.classList.add('frozen');
                td.style.left = `${40 + (colIndex * 150)}px`;
            }
            
            const value = record.fields[field.name];
            const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
            const formattedValue = formatCellValue(value, field.type);
            
            if (permission === 'edit' && (currentUser.role === 'creator' || currentUser.role === 'editor')) {
                td.className = 'cell-editable';
                td.onclick = () => editCell(record.id, field.name, td, field.type);
                td.title = 'Click to edit';
            } else if (permission === 'hidden') {
                td.className = 'cell-hidden';
                td.innerHTML = '<i class="fas fa-eye-slash"></i> Hidden';
                return;
            } else {
                td.className = 'cell-readonly';
                if (permission === 'view') {
                    td.title = 'Read-only field';
                }
            }
            
            td.innerHTML = formattedValue;
            row.appendChild(td);
        });
        
        // Row context menu
        row.oncontextmenu = (e) => {
            e.preventDefault();
            showRowContextMenu(e, record.id);
        };
        
        tableBody.appendChild(row);
    });
    
    updatePagination();
}

function getFieldTypeIcon(type) {
    const icons = {
        'text': 'fas fa-font',
        'number': 'fas fa-hashtag',
        'date': 'fas fa-calendar',
        'boolean': 'fas fa-toggle-on',
        'email': 'fas fa-envelope',
        'url': 'fas fa-link',
        'longText': 'fas fa-align-left'
    };
    return icons[type] || 'fas fa-font';
}

function getPermissionIndicator(permission) {
    const indicators = {
        'view': '<span class="permission-indicator permission-view" title="View only"></span>',
        'edit': '<span class="permission-indicator permission-edit" title="Can edit"></span>',
        'hidden': '<span class="permission-indicator permission-hidden" title="Hidden"></span>'
    };
    return indicators[permission] || indicators['view'];
}

function formatCellValue(value, fieldType) {
    if (value === null || value === undefined || value === '') {
        return '<span class="text-muted">—</span>';
    }
    
    const stringValue = String(value);
    
    switch (fieldType) {
        case 'boolean':
            return value ? 
                '<i class="fas fa-check-circle text-success"></i>' : 
                '<i class="fas fa-times-circle text-danger"></i>';
        case 'date':
            try {
                return new Date(value).toLocaleDateString();
            } catch {
                return stringValue;
            }
        case 'email':
            return `<a href="mailto:${value}" class="text-decoration-none">${value}</a>`;
        case 'url':
            return `<a href="${value}" target="_blank" class="text-decoration-none">${stringValue.length > 30 ? stringValue.substring(0, 27) + '...' : stringValue}</a>`;
        case 'number':
            return typeof value === 'number' ? value.toLocaleString() : stringValue;
        case 'longText':
            return stringValue.length > 50 ? 
                `<span title="${stringValue}">${stringValue.substring(0, 47)}...</span>` : 
                stringValue;
        default:
            return stringValue.length > 30 ? 
                `<span title="${stringValue}">${stringValue.substring(0, 27)}...</span>` : 
                stringValue;
    }
}

// Row Height Management
function setRowHeight(height) {
    currentRowHeight = height;
    
    // Update check marks
    ['compact', 'comfortable', 'tall'].forEach(h => {
        const check = document.getElementById(`check-${h}`);
        if (check) {
            check.style.visibility = h === height ? 'visible' : 'hidden';
        }
    });
    
    // Apply to table
    const table = document.getElementById('dataTable');
    if (table) {
        table.className = `grid-table row-${height}`;
    }
}

// Column Management
function populateColumnControls() {
    const menu = document.getElementById('columnVisibilityMenu');
    menu.innerHTML = '<li><h6 class="dropdown-header">Show/Hide Columns</h6></li>';
    
    currentTableFields.forEach(field => {
        const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
        if (permission === 'hidden') return;
        
        const isVisible = visibleColumns.has(field.name);
        const permissionIcon = permission === 'edit' ? '✏️' : '👁️';
        
        menu.innerHTML += `
            <li>
                <a class="dropdown-item" href="#" onclick="toggleColumnVisibility('${field.name}')">
                    <i class="fas fa-${isVisible ? 'check' : 'square'} me-2"></i>
                    ${permissionIcon} ${field.name}
                </a>
            </li>
        `;
    });
}

function toggleColumnVisibility(fieldName) {
    if (visibleColumns.has(fieldName)) {
        visibleColumns.delete(fieldName);
    } else {
        visibleColumns.add(fieldName);
    }
    renderTable();
    populateColumnControls();
}

function hideColumn(fieldName) {
    visibleColumns.delete(fieldName);
    renderTable();
    populateColumnControls();
}

function freezeColumn(fieldName) {
    const fieldIndex = currentTableFields.findIndex(f => f.name === fieldName);
    if (fieldIndex !== -1) {
        frozenColumns = Math.max(frozenColumns, fieldIndex + 1);
        renderTable();
    }
}

function freezeColumns() {
    const count = prompt('How many columns to freeze from the left?', frozenColumns.toString());
    if (count !== null) {
        frozenColumns = Math.max(0, parseInt(count) || 0);
        renderTable();
    }
}

// Sorting
function populateSortMenu() {
    const menu = document.getElementById('sortMenu');
    menu.innerHTML = '<li><h6 class="dropdown-header">Sort by Field</h6></li>';
    
    const visibleFields = currentTableFields.filter(field => {
        const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
        return permission !== 'hidden' && visibleColumns.has(field.name);
    });
    
    visibleFields.forEach(field => {
        const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
        const permissionIcon = permission === 'edit' ? '✏️' : '👁️';
        
        menu.innerHTML += `
            <li><a class="dropdown-item" href="#" onclick="sortColumn('${field.name}', 'asc')">
                <i class="fas fa-sort-alpha-down me-2"></i>${permissionIcon} ${field.name} (A-Z)
            </a></li>
            <li><a class="dropdown-item" href="#" onclick="sortColumn('${field.name}', 'desc')">
                <i class="fas fa-sort-alpha-up me-2"></i>${permissionIcon} ${field.name} (Z-A)
            </a></li>
        `;
    });
}

function toggleSort(fieldName) {
    if (currentSort.field === fieldName) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.field = fieldName;
        currentSort.direction = 'asc';
    }
    
    applySorting();
    renderTable();
}

function sortColumn(fieldName, direction) {
    currentSort.field = fieldName;
    currentSort.direction = direction;
    applySorting();
    renderTable();
}

function applySorting() {
    if (!currentSort.field) return;
    
    filteredData.sort((a, b) => {
        const aVal = a.fields[currentSort.field] || '';
        const bVal = b.fields[currentSort.field] || '';
        
        let comparison = 0;
        if (aVal < bVal) comparison = -1;
        if (aVal > bVal) comparison = 1;
        
        return currentSort.direction === 'desc' ? comparison * -1 : comparison;
    });
}

function clearSort() {
    currentSort = { field: null, direction: 'asc' };
    filteredData = filterDataByPermissions([...currentTableData]);
    applyFilters(); // Reapply filters
    renderTable();
}

// Filtering
function toggleFilterPanel() {
    const panel = document.getElementById('filterPanel');
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
    } else {
        panel.style.display = 'none';
    }
}

function addFilterRule() {
    const rulesContainer = document.getElementById('filterRules');
    const ruleId = 'filter_' + Date.now();
    
    const visibleFields = currentTableFields.filter(field => {
        const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
        return permission !== 'hidden' && visibleColumns.has(field.name);
    });

    const ruleHtml = `
        <div class="filter-rule" id="${ruleId}">
            <select class="form-select" onchange="updateFilterOperators('${ruleId}')">
                <option value="">Select Field</option>
                ${visibleFields.map(field => {
                    const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
                    const permissionIcon = permission === 'edit' ? '✏️' : '👁️';
                    return `<option value="${field.name}">${permissionIcon} ${field.name}</option>`;
                }).join('')}
            </select>
            <select class="form-select" id="${ruleId}_operator">
                <option value="contains">Contains</option>
                <option value="equals">Equals</option>
                <option value="not_equals">Not Equals</option>
                <option value="starts_with">Starts With</option>
                <option value="ends_with">Ends With</option>
                <option value="greater_than">Greater Than</option>
                <option value="less_than">Less Than</option>
                <option value="is_empty">Is Empty</option>
                <option value="is_not_empty">Is Not Empty</option>
            </select>
            <input type="text" class="form-control" placeholder="Value" id="${ruleId}_value">
            <button class="btn btn-outline-danger" onclick="removeFilterRule('${ruleId}')">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
    
    rulesContainer.insertAdjacentHTML('beforeend', ruleHtml);
}

function removeFilterRule(ruleId) {
    document.getElementById(ruleId)?.remove();
}

function applyFilters() {
    const rules = document.querySelectorAll('.filter-rule');
    filteredData = filterDataByPermissions([...currentTableData]);
    
    // Apply quick search first
    const quickSearch = document.getElementById('quickSearch').value.toLowerCase();
    if (quickSearch) {
        filteredData = filteredData.filter(record => {
            return Object.values(record.fields).some(value => 
                String(value).toLowerCase().includes(quickSearch)
            );
        });
    }
    
    // Apply filter rules
    rules.forEach(rule => {
        const fieldSelect = rule.querySelector('select');
        const operatorSelect = rule.querySelector('select:nth-child(2)');
        const valueInput = rule.querySelector('input');
        
        const field = fieldSelect?.value;
        const operator = operatorSelect?.value;
        const value = valueInput?.value;
        
        if (!field || !operator) return;
        
        filteredData = filteredData.filter(record => {
            const fieldValue = String(record.fields[field] || '').toLowerCase();
            const searchValue = (value || '').toLowerCase();
            
            switch (operator) {
                case 'contains': return fieldValue.includes(searchValue);
                case 'equals': return fieldValue === searchValue;
                case 'not_equals': return fieldValue !== searchValue;
                case 'starts_with': return fieldValue.startsWith(searchValue);
                case 'ends_with': return fieldValue.endsWith(searchValue);
                case 'greater_than': return parseFloat(fieldValue) > parseFloat(searchValue);
                case 'less_than': return parseFloat(fieldValue) < parseFloat(searchValue);
                case 'is_empty': return fieldValue === '';
                case 'is_not_empty': return fieldValue !== '';
                default: return true;
            }
        });
    });
    
    currentPage = 1;
    applySorting();
    renderTable();
    updateTableStats();
}

function clearAllFilters() {
    document.getElementById('filterRules').innerHTML = '';
    document.getElementById('quickSearch').value = '';
    filteredData = filterDataByPermissions([...currentTableData]);
    currentPage = 1;
    applySorting();
    renderTable();
    updateTableStats();
}

function performQuickSearch() {
    applyFilters();
}

function clearQuickSearch() {
    document.getElementById('quickSearch').value = '';
    applyFilters();
}

// Row Selection
function toggleSelectAll(checkbox) {
    const pageData = filteredData.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
    
    if (checkbox.checked) {
        pageData.forEach(record => selectedRows.add(record.id));
    } else {
        pageData.forEach(record => selectedRows.delete(record.id));
    }
    
    renderTable();
    updateSelectionInfo();
}

function toggleRowSelection(recordId, selected) {
    if (selected) {
        selectedRows.add(recordId);
    } else {
        selectedRows.delete(recordId);
    }
    
    updateSelectionInfo();
}

function updateSelectionInfo() {
    const count = selectedRows.size;
    const info = document.getElementById('selectionInfo');
    const badge = document.getElementById('selectedCount');
    
    if (count > 0) {
        info.textContent = `${count} record${count === 1 ? '' : 's'} selected`;
        badge.textContent = `${count} selected`;
        badge.style.display = 'inline-block';
    } else {
        info.textContent = 'No selection';
        badge.style.display = 'none';
    }
}

// Pagination
function updatePagination() {
    const totalPages = Math.ceil(filteredData.length / rowsPerPage);
    const pagination = document.getElementById('pagination');
    const paginationInfo = document.getElementById('paginationInfo');
    
    // Update info
    const startRecord = (currentPage - 1) * rowsPerPage + 1;
    const endRecord = Math.min(currentPage * rowsPerPage, filteredData.length);
    paginationInfo.textContent = `Showing ${startRecord}-${endRecord} of ${filteredData.length} records`;
    
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
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
    
    pagination.innerHTML = html;
}

function changePage(page) {
    const totalPages = Math.ceil(filteredData.length / rowsPerPage);
    if (page >= 1 && page <= totalPages) {
        currentPage = page;
        renderTable();
    }
}

function changeRowsPerPage() {
    rowsPerPage = parseInt(document.getElementById('rowsPerPage').value);
    currentPage = 1;
    renderTable();
}

// Cell Editing
async function editCell(recordId, fieldName, cellElement, fieldType) {
    const fieldId = `${document.getElementById('tableSelector').value}_${fieldName}`;
    const permission = currentTablePermissions[fieldId] || getDefaultPermission(currentUser.role);
    
    if (permission !== 'edit' || (currentUser.role !== 'creator' && currentUser.role !== 'editor')) {
        showError('You do not have permission to edit this field');
        return;
    }
    
    const record = currentTableData.find(r => r.id === recordId);
    if (!record) return;
    
    const currentValue = record.fields[fieldName] || '';
    cellElement.classList.add('cell-editing');
    
    let input;
    switch (fieldType) {
        case 'boolean':
            input = document.createElement('select');
            input.className = 'form-select form-select-sm';
            input.innerHTML = `
                <option value="true" ${currentValue ? 'selected' : ''}>True</option>
                <option value="false" ${!currentValue ? 'selected' : ''}>False</option>
            `;
            break;
        case 'date':
            input = document.createElement('input');
            input.type = 'date';
            input.className = 'form-control form-control-sm';
            input.value = currentValue ? new Date(currentValue).toISOString().split('T')[0] : '';
            break;
        case 'number':
            input = document.createElement('input');
            input.type = 'number';
            input.className = 'form-control form-control-sm';
            input.value = currentValue;
            break;
        case 'longText':
            input = document.createElement('textarea');
            input.className = 'form-control form-control-sm';
            input.rows = 3;
            input.value = currentValue;
            break;
        default:
            input = document.createElement('input');
            input.type = 'text';
            input.className = 'form-control form-control-sm';
            input.value = currentValue;
    }
    
    cellElement.innerHTML = '';
    cellElement.appendChild(input);
    input.focus();
    
    if (input.type === 'text' || input.type === 'number') {
        input.select();
    }
    
    const saveEdit = async () => {
        let newValue;
        if (fieldType === 'boolean') {
            newValue = input.value === 'true';
        } else {
            newValue = input.value;
        }
        
        if (newValue !== currentValue) {
            await updateFieldValue(recordId, fieldName, newValue);
        }
        
        cellElement.classList.remove('cell-editing');
        cellElement.innerHTML = formatCellValue(newValue, fieldType);
    };
    
    const cancelEdit = () => {
        cellElement.classList.remove('cell-editing');
        cellElement.innerHTML = formatCellValue(currentValue, fieldType);
    };
    
    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && fieldType !== 'longText') {
            e.preventDefault();
            saveEdit();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    });
}

async function updateFieldValue(recordId, fieldName, newValue) {
    try {
        const tableId = document.getElementById('tableSelector').value;
        const updateData = {};
        updateData[fieldName] = newValue;
        
        await window.teableAPI.updateRecord(tableId, recordId, updateData);
        
        // Update local data
        const record = currentTableData.find(r => r.id === recordId);
        if (record) {
            record.fields[fieldName] = newValue;
        }
        const filteredRecord = filteredData.find(r => r.id === recordId);
        if (filteredRecord) {
            filteredRecord.fields[fieldName] = newValue;
        }
        
        showSuccess('Field updated successfully');
        
    } catch (error) {
        console.error('Error updating field:', error);
        showError('Failed to update field: ' + error.message);
    }
}

// Context Menu
function showContextMenu(event) {
    const menu = document.getElementById('contextMenu');
    const row = event.target.closest('tr');
    const recordId = row?.dataset.recordId;
    
    let menuItems = [];
    
    if (recordId) {
        const canEdit = hasEditPermissions();
        
        menuItems = [
            { icon: 'fas fa-eye', text: 'View Record', action: () => viewRecord(recordId) },
            ...(canEdit ? [
                { icon: 'fas fa-edit', text: 'Edit Record', action: () => editRecord(recordId) },
                { icon: 'fas fa-copy', text: 'Duplicate Record', action: () => duplicateRecord(recordId) },
                { divider: true },
                { icon: 'fas fa-trash', text: 'Delete Record', action: () => deleteRecord(recordId), class: 'text-danger' }
            ] : [])
        ];
    } else {
        menuItems = [
            ...(hasEditPermissions() ? [
                { icon: 'fas fa-plus', text: 'Add New Record', action: () => addNewRecord() }
            ] : []),
            { icon: 'fas fa-sync', text: 'Refresh Table', action: () => refreshTable() }
        ];
    }
    
    menu.innerHTML = menuItems.map(item => {
        if (item.divider) {
            return '<div class="context-menu-divider"></div>';
        }
        return `
            <div class="context-menu-item ${item.class || ''}" onclick="${item.action.name}('${recordId || ''}')">
                <i class="${item.icon}"></i>
                <span>${item.text}</span>
            </div>
        `;
    }).join('');
    
    menu.style.display = 'block';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
}

function hideContextMenu() {
    document.getElementById('contextMenu').style.display = 'none';
}

// Record Management
async function addNewRecord() {
    if (!hasEditPermissions()) {
        showError('You do not have permission to add records');
        return;
    }
    showRecordModal();
}

async function viewRecord(recordId) {
    const record = currentTableData.find(r => r.id === recordId);
    if (!record) return;

    const visibleFields = currentTableFields.filter(field => {
        const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
        return permission !== 'hidden';
    });

    let html = '<div class="row">';
    visibleFields.forEach(field => {
        const value = record.fields[field.name] || '';
        const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
        const formattedValue = formatCellValue(value, field.type);
        const permissionBadge = permission === 'edit' ? 
            '<span class="badge bg-primary ms-2">Editable</span>' : 
            '<span class="badge bg-secondary ms-2">Read-only</span>';
        
        html += `
            <div class="col-md-6 mb-3">
                <label class="form-label fw-semibold">
                    ${field.name}
                    ${permissionBadge}
                </label>
                <div class="form-control-plaintext">${formattedValue}</div>
            </div>
        `;
    });
    html += '</div>';

    // Show in modal
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        <i class="fas fa-info-circle me-2"></i>Record Details
                        <small class="text-muted ms-2">(${currentUser.role} view)</small>
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">${html}</div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    ${hasEditPermissions() ? `
                    <button type="button" class="btn btn-primary" onclick="editRecord('${recordId}'); this.closest('.modal').remove();">
                        <i class="fas fa-edit me-1"></i>Edit Record
                    </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
    
    modal.addEventListener('hidden.bs.modal', () => {
        modal.remove();
    });
}

function showRecordModal(recordId = null) {
    const modal = document.getElementById('recordModal');
    const title = document.getElementById('recordModalTitle');
    const fieldsContainer = document.getElementById('recordFields');
    
    title.innerHTML = recordId ? 
        '<i class="fas fa-edit me-2"></i>Edit Record' : 
        '<i class="fas fa-plus me-2"></i>Add New Record';
    
    // Get editable fields
    const editableFields = currentTableFields.filter(field => {
        const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
        return permission === 'edit';
    });
    
    if (editableFields.length === 0) {
        fieldsContainer.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle me-2"></i>
                You don't have edit permissions for any fields in this table.
                <br><small>Contact your administrator to adjust field permissions.</small>
            </div>
        `;
    } else {
        let html = '<div class="row">';
        editableFields.forEach(field => {
            const currentValue = recordId ? 
                (currentTableData.find(r => r.id === recordId)?.fields[field.name] || '') : '';
            
            html += `
                <div class="col-md-6 mb-3">
                    <label class="form-label">
                        ${field.name}
                        <span class="badge bg-primary ms-1">Editable</span>
                    </label>
                    ${getFieldInput(field, currentValue)}
                </div>
            `;
        });
        html += '</div>';
        fieldsContainer.innerHTML = html;
    }
    
    // Store record ID for saving
    modal.setAttribute('data-record-id', recordId || '');
    
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
}

function getFieldInput(field, value) {
    const inputId = `field_${field.name}`;
    
    switch (field.type) {
        case 'boolean':
            return `
                <select class="form-select" id="${inputId}">
                    <option value="true" ${value ? 'selected' : ''}>True</option>
                    <option value="false" ${!value ? 'selected' : ''}>False</option>
                </select>
            `;
        case 'date':
            const dateValue = value ? new Date(value).toISOString().split('T')[0] : '';
            return `<input type="date" class="form-control" id="${inputId}" value="${dateValue}">`;
        case 'number':
            return `<input type="number" class="form-control" id="${inputId}" value="${value}">`;
        case 'email':
            return `<input type="email" class="form-control" id="${inputId}" value="${value}">`;
        case 'url':
            return `<input type="url" class="form-control" id="${inputId}" value="${value}">`;
        case 'longText':
            return `<textarea class="form-control" id="${inputId}" rows="4">${value}</textarea>`;
        default:
            return `<input type="text" class="form-control" id="${inputId}" value="${value}">`;
    }
}

async function saveRecord() {
    try {
        const modal = document.getElementById('recordModal');
        const recordId = modal.getAttribute('data-record-id');
        const tableId = document.getElementById('tableSelector').value;
        
        // Collect field values
        const recordData = {};
        currentTableFields.forEach(field => {
            const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
            if (permission === 'edit') {
                const input = document.getElementById(`field_${field.name}`);
                if (input) {
                    if (field.type === 'boolean') {
                        recordData[field.name] = input.value === 'true';
                    } else {
                        recordData[field.name] = input.value;
                    }
                }
            }
        });

        if (recordId) {
            // Update existing record
            await window.teableAPI.updateRecord(tableId, recordId, recordData);
        } else {
            // Create new record
            await window.teableAPI.createRecord(tableId, recordData);
        }

        // Close modal
        const bootstrapModal = bootstrap.Modal.getInstance(modal);
        bootstrapModal.hide();

        // Reload table data
        await loadTableData();
        
        showSuccess(recordId ? 'Record updated successfully!' : 'Record created successfully!');

    } catch (error) {
        console.error('Error saving record:', error);
        showError('Failed to save record: ' + error.message);
    }
}

async function editRecord(recordId) {
    if (!hasEditPermissions()) {
        showError('You do not have permission to edit records');
        return;
    }
    showRecordModal(recordId);
}

async function duplicateRecord(recordId) {
    if (!hasEditPermissions()) {
        showError('You do not have permission to create records');
        return;
    }
    
    try {
        const record = currentTableData.find(r => r.id === recordId);
        if (!record) return;

        const tableId = document.getElementById('tableSelector').value;
        const duplicateData = { ...record.fields };
        
        // Remove any ID fields
        delete duplicateData.id;
        delete duplicateData.created_at;
        delete duplicateData.updated_at;

        await window.teableAPI.createRecord(tableId, duplicateData);
        await loadTableData();
        
        showSuccess('Record duplicated successfully!');

    } catch (error) {
        console.error('Error duplicating record:', error);
        showError('Failed to duplicate record: ' + error.message);
    }
}

async function deleteRecord(recordId) {
    if (!hasEditPermissions()) {
        showError('You do not have permission to delete records');
        return;
    }
    
    if (!confirm('Are you sure you want to delete this record?')) return;
    
    try {
        const tableId = document.getElementById('tableSelector').value;
        await window.teableAPI.deleteRecord(tableId, recordId);
        
        // Remove from local data
        currentTableData = currentTableData.filter(r => r.id !== recordId);
        filteredData = filteredData.filter(r => r.id !== recordId);
        selectedRows.delete(recordId);
        
        renderTable();
        updateTableStats();
        updateSelectionInfo();
        
        showSuccess('Record deleted successfully!');
        
    } catch (error) {
        console.error('Error deleting record:', error);
        showError('Failed to delete record: ' + error.message);
    }
}

// Utility Functions
function updateTableStats() {
    const count = filteredData.length;
    const total = currentTableData.length;
    const countText = total === count ? `${count} records` : `${count} of ${total} records`;
    
    document.getElementById('recordCount').textContent = countText;
}

function switchViewMode(mode) {
    // Future implementation for form view
    console.log('Switching to view mode:', mode);
}

function handleKeyboardShortcuts(event) {
    // Ctrl+A - Select all
    if (event.ctrlKey && event.key === 'a' && event.target.closest('.data-grid')) {
        event.preventDefault();
        const selectAllCheckbox = document.querySelector('.row-selector input[type="checkbox"]');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = true;
            toggleSelectAll(selectAllCheckbox);
        }
    }
    
    // Delete key - Delete selected records
    if (event.key === 'Delete' && selectedRows.size > 0 && hasEditPermissions()) {
        if (confirm(`Delete ${selectedRows.size} selected record(s)?`)) {
            selectedRows.forEach(recordId => deleteRecord(recordId));
        }
    }
}

async function exportTableData() {
    try {
        const tableId = document.getElementById('tableSelector').value;
        if (!tableId) return;

        const data = {
            table: tableId,
            records: filteredData,
            fields: currentTableFields,
            permissions: currentTablePermissions,
            userRole: currentUser.role,
            exportDate: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `table_export_${tableId}_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        showSuccess('Table data exported successfully!');

    } catch (error) {
        console.error('Error exporting table:', error);
        showError('Failed to export table: ' + error.message);
    }
}

async function refreshTable() {
    const tableId = document.getElementById('tableSelector').value;
    if (tableId) {
        await loadTableData();
        showSuccess('Table refreshed successfully!');
    }
}

function showEmptyState() {
    document.getElementById('tableContainer').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('addRecordBtn').disabled = true;
}

function hideEmptyState() {
    document.getElementById('emptyState').style.display = 'none';
}

function showLoading(show) {
    document.getElementById('tableLoading').style.display = show ? 'flex' : 'none';
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
    alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
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

// Make functions globally available
window.loadTableData = loadTableData;
window.setRowHeight = setRowHeight;
window.toggleColumnVisibility = toggleColumnVisibility;
window.hideColumn = hideColumn;
window.freezeColumn = freezeColumn;
window.freezeColumns = freezeColumns;
window.toggleSort = toggleSort;
window.sortColumn = sortColumn;
window.clearSort = clearSort;
window.toggleFilterPanel = toggleFilterPanel;
window.addFilterRule = addFilterRule;
window.removeFilterRule = removeFilterRule;
window.applyFilters = applyFilters;
window.clearAllFilters = clearAllFilters;
window.performQuickSearch = performQuickSearch;
window.clearQuickSearch = clearQuickSearch;
window.toggleSelectAll = toggleSelectAll;
window.toggleRowSelection = toggleRowSelection;
window.changePage = changePage;
window.changeRowsPerPage = changeRowsPerPage;
window.addNewRecord = addNewRecord;
window.saveRecord = saveRecord;
window.viewRecord = viewRecord;
window.editRecord = editRecord;
window.duplicateRecord = duplicateRecord;
window.deleteRecord = deleteRecord;
window.exportTableData = exportTableData;
window.refreshTable = refreshTable;