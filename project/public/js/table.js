
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
let currentFormIndex = 0;

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
    
    // Row selector column (never frozen)
    const selectorHeader = document.createElement('th');
    selectorHeader.className = 'row-selector';
    selectorHeader.innerHTML = `
        <input type="checkbox" onchange="toggleSelectAll(this)" title="Select all">
    `;
    headerRow.appendChild(selectorHeader);

    // Field headers
    visibleFields.forEach((field, index) => {
        const th = document.createElement('th');
        th.className = 'sortable';
        if (frozenColumns > 0 && index < frozenColumns) {
            th.classList.add('frozen');
            // Add shadow to last frozen column
            if (index === frozenColumns - 1) th.classList.add('frozen-shadow');
            else th.classList.remove('frozen-shadow');
        } else {
            th.classList.remove('frozen');
            th.classList.remove('frozen-shadow');
            th.style.left = '';
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
        
        // Row selector (never frozen)
        const selectorCell = document.createElement('td');
        selectorCell.className = 'row-selector';
        selectorCell.innerHTML = `
            <input type="checkbox" ${selectedRows.has(record.id) ? 'checked' : ''} 
                   onchange="toggleRowSelection('${record.id}', this.checked)">
        `;
        row.appendChild(selectorCell);
        
        // Data cells
        visibleFields.forEach((field, colIndex) => {
            const td = document.createElement('td');
            if (frozenColumns > 0 && colIndex < frozenColumns) {
                td.classList.add('frozen');
                // Add shadow to last frozen column
                if (colIndex === frozenColumns - 1) td.classList.add('frozen-shadow');
                else td.classList.remove('frozen-shadow');
            } else {
                td.classList.remove('frozen');
                td.classList.remove('frozen-shadow');
                td.style.left = '';
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
    updateFrozenColumnOffsets();
    updatePagination();
}

function updateFrozenColumnOffsets() {
    const table = document.getElementById('dataTable');
    if (!table) return;
    const headerCells = table.querySelectorAll('thead th');
    let leftOffsets = [];
    let left = 0;
    // Calculate left offsets for the first N frozen columns (skip selector at index 0)
    for (let i = 1; i <= frozenColumns; i++) {
        const th = headerCells[i];
        if (th) {
            leftOffsets[i] = left;
            left += th.offsetWidth;
        }
    }
    // Set left for header
    for (let i = 1; i < headerCells.length; i++) {
        const th = headerCells[i];
        if (th && th.classList.contains('frozen')) {
            th.style.left = leftOffsets[i] + 'px';
            th.style.position = 'sticky';
            th.style.zIndex = 11;
        } else {
            th.style.left = '';
            th.style.position = '';
            th.style.zIndex = '';
        }
    }
    // Set left for each row's frozen cells (skip selector)
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        for (let i = 1; i < cells.length; i++) {
            const td = cells[i];
            if (td && td.classList.contains('frozen')) {
                td.style.left = leftOffsets[i] + 'px';
                td.style.position = 'sticky';
                td.style.zIndex = 10;
            } else {
                td.style.left = '';
                td.style.position = '';
                td.style.zIndex = '';
            }
        }
    });
}

window.addEventListener('resize', () => {
    updateFrozenColumnOffsets();
});

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

// Show/hide Batch Edit button based on selection
function updateBatchEditButton() {
    const btn = document.getElementById('batchEditBtn');
    if (!btn) return;
    btn.style.display = selectedRows.size > 1 ? 'inline-block' : 'none';
}
// Call updateBatchEditButton in updateSelectionInfo
function updateSelectionInfo() {
    const count = selectedRows.size;
    const info = document.getElementById('selectionInfo');
    if (count === 0) {
        info.textContent = 'No selection';
    } else {
        info.textContent = `${count} record${count > 1 ? 's' : ''} selected`;
    }
    updateBatchEditButton();
}
// Batch Edit Modal logic
function showBatchEditModal() {
    const fieldsContainer = document.getElementById('batchEditFields');
    if (!fieldsContainer) return;
    let html = '<form id="batchEditForm" class="p-2">';
    currentTableFields.forEach(field => {
        const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
        if (permission === 'edit') {
            html += `
                <div class="mb-3">
                    <label class="form-label fw-semibold">${field.name}</label>
                    ${getFieldInput(field, '')}
                </div>
            `;
        }
    });
    html += '</form>';
    fieldsContainer.innerHTML = html;
    const modal = new bootstrap.Modal(document.getElementById('batchEditModal'));
    modal.show();
}
async function saveBatchEdit() {
    const form = document.getElementById('batchEditForm');
    if (!form) return;
    const tableId = document.getElementById('tableSelector').value;
    const updates = {};
    currentTableFields.forEach(field => {
        const input = document.getElementById(`field_${field.name}`);
        if (input && input.value !== '') {
            if (field.type === 'boolean') {
                updates[field.name] = input.value === 'true';
            } else if (field.type === 'number') {
                updates[field.name] = input.value === '' ? null : Number(input.value);
            } else {
                updates[field.name] = input.value;
            }
        }
    });
    if (Object.keys(updates).length === 0) {
        showError('Please fill in at least one field to update.');
        return;
    }
    try {
        for (const recordId of selectedRows) {
            await window.teableAPI.updateRecord(tableId, recordId, updates);
        }
        await loadTableData();
        showSuccess('Batch update successful!');
        const modal = bootstrap.Modal.getInstance(document.getElementById('batchEditModal'));
        if (modal) modal.hide();
    } catch (error) {
        showError('Batch update failed: ' + error.message);
    }
}
window.showBatchEditModal = showBatchEditModal;
window.saveBatchEdit = saveBatchEdit;

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
        
        // Get old value for logging
        const record = currentTableData.find(r => r.id === recordId);
        const oldValue = record ? record.fields[fieldName] : null;
        
        await window.teableAPI.updateRecord(tableId, recordId, updateData);
        
        // Log the field update
        const oldValues = { [fieldName]: oldValue };
        const newValues = { [fieldName]: newValue };
        await logDataChange(tableId, recordId, 'update', oldValues, newValues);
        
        // Update local data
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
            <div class="context-menu-item ${item.class || ''}">
                <i class="${item.icon}"></i>
                <span>${item.text}</span>
            </div>
        `;
    }).join('');
    // Attach event handlers in JS
    const menuItemEls = menu.querySelectorAll('.context-menu-item');
    let elIdx = 0;
    menuItems.forEach(item => {
        if (!item.divider) {
            menuItemEls[elIdx].onclick = item.action;
            elIdx++;
        }
    });
    menu.style.display = 'block';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
}
// Make showRowContextMenu global and call showContextMenu
function showRowContextMenu(event, recordId) {
    showContextMenu(event);
}
window.showRowContextMenu = showRowContextMenu;

function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    if (menu) menu.style.display = 'none';
}
window.hideContextMenu = hideContextMenu;

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
    
    // Clear any previous validation states
    const inputs = modal.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.classList.remove('is-invalid');
    });
    
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
    
    // Focus on first input for new records
    if (!recordId) {
        setTimeout(() => {
            const firstInput = modal.querySelector('input, select, textarea');
            if (firstInput) {
                firstInput.focus();
            }
        }, 300);
    }
}

function getFieldInput(field, value) {
    const inputId = `field_${field.name}`;
    
    switch (field.type) {
        case 'boolean':
            return `
                <select class="form-select" id="${inputId}">
                    <option value="">-- Select --</option>
                    <option value="true" ${value === true ? 'selected' : ''}>True</option>
                    <option value="false" ${value === false ? 'selected' : ''}>False</option>
                </select>
            `;
        case 'date':
            let dateValue = '';
            if (value) {
                try {
                    const date = new Date(value);
                    if (!isNaN(date.getTime())) {
                        dateValue = date.toISOString().split('T')[0];
                    }
                } catch (e) {
                    console.warn('Invalid date value:', value);
                }
            }
            return `<input type="date" class="form-control" id="${inputId}" value="${dateValue}">`;
        case 'number':
            let numValue = '';
            if (value !== null && value !== undefined && value !== '') {
                numValue = Number(value);
                if (isNaN(numValue)) numValue = '';
            }
            return `<input type="number" class="form-control" id="${inputId}" value="${numValue}" step="any">`;
        case 'email':
            return `<input type="email" class="form-control" id="${inputId}" value="${value || ''}" placeholder="Enter email address">`;
        case 'url':
            return `<input type="url" class="form-control" id="${inputId}" value="${value || ''}" placeholder="Enter URL">`;
        case 'longText':
            return `<textarea class="form-control" id="${inputId}" rows="4" placeholder="Enter text">${value || ''}</textarea>`;
        default:
            return `<input type="text" class="form-control" id="${inputId}" value="${value || ''}" placeholder="Enter ${field.name}">`;
    }
}

async function saveRecord() {
    try {
        const modal = document.getElementById('recordModal');
        const recordId = modal.getAttribute('data-record-id');
        const tableId = document.getElementById('tableSelector').value;
        
        if (!tableId) {
            showError('No table selected. Please select a table first.');
            return;
        }
        
        // Collect field values with validation
        const recordData = {};
        let hasValidData = false;
        
        currentTableFields.forEach(field => {
            const permission = currentTablePermissions[field.id] || getDefaultPermission(currentUser.role);
            if (permission === 'edit') {
                const input = document.getElementById(`field_${field.name}`);
                if (input) {
                    let value = input.value;
                    
                    // Convert value based on field type
                    if (field.type === 'boolean') {
                        value = value === 'true';
                    } else if (field.type === 'number') {
                        value = value === '' ? null : Number(value);
                        if (isNaN(value)) {
                            showError(`Invalid number value for field: ${field.name}`);
                            return;
                        }
                    } else if (field.type === 'date') {
                        if (value && !isNaN(new Date(value).getTime())) {
                            value = new Date(value).toISOString();
                        } else if (value) {
                            showError(`Invalid date value for field: ${field.name}`);
                            return;
                        }
                    }
                    
                    // Only add non-empty values (except for booleans and numbers which can be false/0)
                    if (value !== '' && value !== null && value !== undefined) {
                        recordData[field.name] = value;
                        hasValidData = true;
                    }
                }
            }
        });

        // Validate that we have at least some data
        if (!hasValidData) {
            showError('Please fill in at least one field before saving.');
            return;
        }

        console.log('Saving record data:', {
            tableId,
            recordId,
            recordData,
            isUpdate: !!recordId
        });

        let result;
        if (recordId) {
            // Get old values for logging
            const oldRecord = currentTableData.find(r => r.id === recordId);
            const oldValues = oldRecord ? oldRecord.fields : {};
            
            // Update existing record
            result = await window.teableAPI.updateRecord(tableId, recordId, recordData);
            console.log('Update result:', result);
            
            // Log the update operation
            await logDataChange(tableId, recordId, 'update', oldValues, recordData);
        } else {
            // Create new record
            result = await window.teableAPI.createRecord(tableId, recordData);
            console.log('Create result:', result);
            
            // Log the create operation
            const newRecordId = result.records?.[0]?.id || result.record?.id || 'unknown';
            await logDataChange(tableId, newRecordId, 'create', null, recordData);
        }

        // Validate the API response
        if (!result) {
            throw new Error('No response received from API');
        }

        // Check if the record was actually created/updated
        if (result.records && result.records.length > 0) {
            const savedRecord = result.records[0];
            console.log('Record saved successfully:', savedRecord);
        } else if (result.record) {
            console.log('Record saved successfully:', result.record);
        } else {
            console.warn('API response does not contain expected record data:', result);
        }

        // Close modal
        const bootstrapModal = bootstrap.Modal.getInstance(modal);
        if (bootstrapModal) {
            bootstrapModal.hide();
        }

        // Reload table data to show the new/updated record
        await loadTableData();
        
        // Verify the record was actually saved
        if (!recordId) {
            // For new records, check if they appear in the data
            const newRecordId = result.records?.[0]?.id || result.record?.id;
            if (newRecordId) {
                const savedRecord = currentTableData.find(r => r.id === newRecordId);
                if (!savedRecord) {
                    console.warn('Record was created but not found in table data after reload');
                    showError('Record was created but may not be visible. Please refresh the table.');
                    return;
                }
                console.log('✅ Record verified in table data:', savedRecord);
            }
        }
        
        showSuccess(recordId ? 'Record updated successfully!' : 'Record created successfully!');

    } catch (error) {
        console.error('Error saving record:', error);
        
        // Provide more specific error messages
        let errorMessage = 'Failed to save record: ';
        if (error.message.includes('API Error: 400')) {
            errorMessage += 'Invalid data format. Please check your input values.';
        } else if (error.message.includes('API Error: 401')) {
            errorMessage += 'Authentication failed. Please log in again.';
        } else if (error.message.includes('API Error: 403')) {
            errorMessage += 'You do not have permission to save records.';
        } else if (error.message.includes('API Error: 404')) {
            errorMessage += 'Table not found. Please select a valid table.';
        } else if (error.message.includes('API Error: 422')) {
            errorMessage += 'Validation error. Please check your field values.';
        } else {
            errorMessage += error.message;
        }
        
        showError(errorMessage);
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

        const result = await window.teableAPI.createRecord(tableId, duplicateData);
        
        // Log the duplicate operation as a create
        const newRecordId = result.records?.[0]?.id || result.record?.id || 'unknown';
        await logDataChange(tableId, newRecordId, 'create', null, duplicateData);
        
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
        
        // Get old values for logging before deletion
        const oldRecord = currentTableData.find(r => r.id === recordId);
        const oldValues = oldRecord ? oldRecord.fields : {};
        
        await window.teableAPI.deleteRecord(tableId, recordId);
        
        // Log the delete operation
        await logDataChange(tableId, recordId, 'delete', oldValues, null);
        
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
    // Show/hide grid and form containers
    const grid = document.getElementById('dataGrid');
    const form = document.getElementById('formViewContainer');
    if (mode === 'form') {
        if (grid) grid.style.display = 'none';
        if (form) {
            form.style.display = 'block';
            renderFormView();
        }
    } else {
        if (grid) grid.style.display = 'block';
        if (form) form.style.display = 'none';
    }
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
        // Prepare CSV header
        const fields = currentTableFields.map(f => f.name);
        let csv = fields.join(',') + '\n';
        // Prepare CSV rows
        filteredData.forEach(record => {
            const row = fields.map(field => {
                let value = record.fields[field];
                if (value === null || value === undefined) return '';
                // Escape quotes and commas
                if (typeof value === 'string') {
                    value = '"' + value.replace(/"/g, '""') + '"';
                }
                return value;
            });
            csv += row.join(',') + '\n';
        });
        // Download CSV
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `table_export_${tableId}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showSuccess('Table data exported as CSV successfully!');
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

function renderFormView() {
    const formContainer = document.getElementById('formViewContainer');
    if (!formContainer) return;
    if (!filteredData || filteredData.length === 0) {
        formContainer.innerHTML = '<div class="alert alert-info m-3">No records to display.</div>';
        return;
    }
    // Clamp index
    if (currentFormIndex < 0) currentFormIndex = 0;
    if (currentFormIndex >= filteredData.length) currentFormIndex = filteredData.length - 1;
    const record = filteredData[currentFormIndex];
    let html = `<form id="formViewForm" class="p-3">`;
    currentTableFields.forEach(field => {
        const value = record.fields[field.name] || '';
        html += `
            <div class="mb-3">
                <label class="form-label fw-semibold">${field.name}</label>
                ${getFieldInput(field, value)}
            </div>
        `;
    });
    html += `
        <div class="d-flex justify-content-between mt-4">
            <button type="button" class="btn btn-secondary" id="prevRecordBtn">&laquo; Previous</button>
            <div>
                <button type="button" class="btn btn-primary me-2" id="saveFormBtn">Save</button>
                <button type="button" class="btn btn-secondary" id="nextRecordBtn">Next &raquo;</button>
            </div>
        </div>
    </form>`;
    formContainer.innerHTML = html;
    // Event handlers
    document.getElementById('prevRecordBtn').onclick = () => {
        if (currentFormIndex > 0) {
            currentFormIndex--;
            renderFormView();
        }
    };
    document.getElementById('nextRecordBtn').onclick = () => {
        if (currentFormIndex < filteredData.length - 1) {
            currentFormIndex++;
            renderFormView();
        }
    };
    document.getElementById('saveFormBtn').onclick = async () => {
        await saveFormViewRecord();
    };
}

async function saveFormViewRecord() {
    const record = filteredData[currentFormIndex];
    const tableId = document.getElementById('tableSelector').value;
    const form = document.getElementById('formViewForm');
    if (!form) return;
    const recordData = {};
    currentTableFields.forEach(field => {
        const input = document.getElementById(`field_${field.name}`);
        if (input) {
            if (field.type === 'boolean') {
                recordData[field.name] = input.value === 'true';
            } else if (field.type === 'number') {
                recordData[field.name] = input.value === '' ? null : Number(input.value);
            } else {
                recordData[field.name] = input.value;
            }
        }
    });
    try {
        await window.teableAPI.updateRecord(tableId, record.id, recordData);
        await loadTableData();
        showSuccess('Record updated successfully!');
    } catch (error) {
        showError('Failed to update record: ' + error.message);
    }
}

// Debug function to help troubleshoot issues
async function debugTableData() {
    const tableId = document.getElementById('tableSelector').value;
    if (!tableId) {
        console.log('No table selected');
        return;
    }
    
    console.log('=== DEBUG TABLE DATA ===');
    console.log('Table ID:', tableId);
    console.log('Current user:', currentUser);
    console.log('Table fields:', currentTableFields);
    console.log('Table permissions:', currentTablePermissions);
    console.log('Current table data count:', currentTableData.length);
    console.log('Filtered data count:', filteredData.length);
    console.log('Sample record:', currentTableData[0]);
    
    try {
        // Test API connection
        console.log('Testing API connection...');
        const tables = await window.teableAPI.getTables();
        console.log('Available tables:', tables);
        
        // Test getting records
        console.log('Testing record retrieval...');
        const records = await window.teableAPI.getRecords(tableId, { limit: 5 });
        console.log('Recent records:', records);
        
    } catch (error) {
        console.error('API test failed:', error);
    }
    
    console.log('=== END DEBUG ===');
}

// Data change logging helper function
async function logDataChange(tableId, recordId, actionType, oldValues, newValues) {
    try {
        // Skip logging if data logs system not available
        if (!window.teableAPI || !window.teableAPI.systemTables || !window.teableAPI.systemTables.dataLogs) {
            console.log('Data logging system not available, skipping log entry');
            return;
        }
        
        const session = window.teableAuth?.getCurrentSession();
        if (!session) {
            console.log('No user session available for logging');
            return;
        }

        // Get table name
        let tableName = 'Unknown';
        try {
            const tables = await window.teableAPI.getTables();
            const table = (tables.tables || tables || []).find(t => t.id === tableId);
            tableName = table?.name || tableName;
        } catch (error) {
            console.log('Could not get table name for logging:', error.message);
        }

        const timestamp = new Date().toISOString();
        const changedAt = timestamp.split('T')[0];

        // Create log entries for each field change
        const logEntries = [];

        if (actionType === 'create' && newValues) {
            // Log all new fields
            Object.keys(newValues).forEach(fieldName => {
                logEntries.push({
                    record_id: recordId,
                    table_id: tableId,
                    table_name: tableName,
                    action_type: actionType,
                    field_name: fieldName,
                    old_value: null,
                    new_value: String(newValues[fieldName] || ''),
                    changed_by: session.email,
                    changed_at: changedAt,
                    timestamp: timestamp,
                    user_role: session.role,
                    ip_address: 'unknown',
                    session_id: session.loginTime || 'unknown'
                });
            });
        } else if (actionType === 'delete' && oldValues) {
            // Log all deleted fields
            Object.keys(oldValues).forEach(fieldName => {
                logEntries.push({
                    record_id: recordId,
                    table_id: tableId,
                    table_name: tableName,
                    action_type: actionType,
                    field_name: fieldName,
                    old_value: String(oldValues[fieldName] || ''),
                    new_value: null,
                    changed_by: session.email,
                    changed_at: changedAt,
                    timestamp: timestamp,
                    user_role: session.role,
                    ip_address: 'unknown',
                    session_id: session.loginTime || 'unknown'
                });
            });
        } else if (actionType === 'update' && oldValues && newValues) {
            // Log only changed fields
            Object.keys(newValues).forEach(fieldName => {
                const oldValue = oldValues[fieldName];
                const newValue = newValues[fieldName];

                // Only log if value actually changed
                if (String(oldValue) !== String(newValue)) {
                    logEntries.push({
                        record_id: recordId,
                        table_id: tableId,
                        table_name: tableName,
                        action_type: actionType,
                        field_name: fieldName,
                        old_value: String(oldValue || ''),
                        new_value: String(newValue || ''),
                        changed_by: session.email,
                        changed_at: changedAt,
                        timestamp: timestamp,
                        user_role: session.role,
                        ip_address: 'unknown',
                        session_id: session.loginTime || 'unknown'
                    });
                }
            });
        }

        // Create log entries in batch
        for (const logEntry of logEntries) {
            try {
                await window.teableAPI.createRecord(window.teableAPI.systemTables.dataLogs, logEntry);
            } catch (logError) {
                console.error('Failed to create data log entry:', logError);
            }
        }

        console.log(`Logged ${logEntries.length} field changes for ${actionType} action in table ${tableName}`);

    } catch (error) {
        console.error('Error logging data change:', error);
        // Don't throw error to avoid breaking the main operation
    }
}

// Data change logging helper function
async function logDataChange(tableId, recordId, actionType, oldValues, newValues) {
    try {
        // Skip logging if data logs system not available
        if (!window.teableAPI || !window.teableAPI.systemTables || !window.teableAPI.systemTables.dataLogs) {
            console.log('Data logging system not available, skipping log entry');
            return;
        }
        
        const session = window.teableAuth?.getCurrentSession();
        if (!session) {
            console.log('No user session available for logging');
            return;
        }

        // Get table name
        let tableName = 'Unknown';
        try {
            const tables = await window.teableAPI.getTables();
            const table = (tables.tables || tables || []).find(t => t.id === tableId);
            tableName = table?.name || tableName;
        } catch (error) {
            console.log('Could not get table name for logging:', error.message);
        }

        const timestamp = new Date().toISOString();
        const changedAt = timestamp.split('T')[0];

        // Create log entries for each field change
        const logEntries = [];

        if (actionType === 'create' && newValues) {
            // Log all new fields
            Object.keys(newValues).forEach(fieldName => {
                logEntries.push({
                    record_id: recordId,
                    table_id: tableId,
                    table_name: tableName,
                    action_type: actionType,
                    field_name: fieldName,
                    old_value: null,
                    new_value: String(newValues[fieldName] || ''),
                    changed_by: session.email,
                    changed_at: changedAt,
                    timestamp: timestamp,
                    user_role: session.role,
                    ip_address: 'unknown',
                    session_id: session.loginTime || 'unknown'
                });
            });
        } else if (actionType === 'delete' && oldValues) {
            // Log all deleted fields
            Object.keys(oldValues).forEach(fieldName => {
                logEntries.push({
                    record_id: recordId,
                    table_id: tableId,
                    table_name: tableName,
                    action_type: actionType,
                    field_name: fieldName,
                    old_value: String(oldValues[fieldName] || ''),
                    new_value: null,
                    changed_by: session.email,
                    changed_at: changedAt,
                    timestamp: timestamp,
                    user_role: session.role,
                    ip_address: 'unknown',
                    session_id: session.loginTime || 'unknown'
                });
            });
        } else if (actionType === 'update' && oldValues && newValues) {
            // Log only changed fields
            Object.keys(newValues).forEach(fieldName => {
                const oldValue = oldValues[fieldName];
                const newValue = newValues[fieldName];

                // Only log if value actually changed
                if (String(oldValue) !== String(newValue)) {
                    logEntries.push({
                        record_id: recordId,
                        table_id: tableId,
                        table_name: tableName,
                        action_type: actionType,
                        field_name: fieldName,
                        old_value: String(oldValue || ''),
                        new_value: String(newValue || ''),
                        changed_by: session.email,
                        changed_at: changedAt,
                        timestamp: timestamp,
                        user_role: session.role,
                        ip_address: 'unknown',
                        session_id: session.loginTime || 'unknown'
                    });
                }
            });
        }

        // Create log entries in batch
        for (const logEntry of logEntries) {
            try {
                await window.teableAPI.createRecord(window.teableAPI.systemTables.dataLogs, logEntry);
            } catch (logError) {
                console.error('Failed to create data log entry:', logError);
            }
        }

        console.log(`Logged ${logEntries.length} field changes for ${actionType} action in table ${tableName}`);

    } catch (error) {
        console.error('Error logging data change:', error);
        // Don't throw error to avoid breaking the main operation
    }
}

// Add debug function to window for console access
window.debugTableData = debugTableData;

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
