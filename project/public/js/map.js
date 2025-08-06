/**
 * Advanced GIS Map with Multi-layer Support, Filtering, and Professional Features
 */

let map;
let mapLayers = [];
let currentFilters = [];
let measurementGroup;
let currentMeasurement = null;
let measurementPoints = [];
let selectedFeatures = [];
let currentUser = null;
let geoJSONData = null;
let fieldPermissionsCache = {};

// State management for map configuration
let debouncedSave = null;
const STATE_STORAGE_KEY = 'gisMapState';

// Base map configurations
const baseMaps = {
    openstreetmap: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors',
        maxZoom: 21
    },
    satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '© Esri',
        maxZoom: 21
    },
    terrain: {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '© OpenTopoMap contributors',
        maxZoom: 21
    },
    dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '© CartoDB',
        maxZoom: 21
    },
    drone_imagery: {
        url: 'tiles/{z}/{x}/{y}.png',
        attribution: '© Custom Drone Imagery',
        minZoom: 18,
        maxZoom: 25,
        customTiles: true
    }
};

// Customer context detection
function getCustomerContext() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;

    let customerId = null;

    const pathMatch = pathname.match(/\/customer(\d+)\//);
    if (pathMatch) {
        customerId = pathMatch[1];
    }

    const subdomainMatch = hostname.match(/^customer(\d+)\./);
    if (subdomainMatch) {
        customerId = subdomainMatch[1];
    }

    if (!customerId) {
        customerId = localStorage.getItem('customer_id') ||
                    window.teableAuth?.getCurrentSession()?.customerId ||
                    'default';
    }

    return customerId;
}

function getCustomerTileUrl(customerId) {
    if (customerId && customerId !== 'default') {
        return `customer${customerId}/tiles/{z}/{x}/{y}.png`;
    } else {
        return 'tiles/{z}/{x}/{y}.png';
    }
}

async function checkCustomTilesAvailability(customerId) {
    try {
        const testTileUrl = getCustomerTileUrl(customerId).replace('{z}', '18').replace('{x}', '0').replace('{y}', '0');
        const response = await fetch(testTileUrl, { method: 'HEAD' });
        return response.ok;
    } catch (error) {
        console.log('Custom tiles not available for customer:', customerId);
        return false;
    }
}

async function initializeCustomerBaseMaps() {
    const customerId = getCustomerContext();
    console.log('Detected customer context:', customerId);

    const hasCustomTiles = await checkCustomTilesAvailability(customerId);

    if (hasCustomTiles) {
        baseMaps.drone_imagery.url = getCustomerTileUrl(customerId);
        baseMaps.drone_imagery.attribution = `© Customer ${customerId} Drone Imagery`;
        console.log(`Custom drone imagery tiles enabled for customer ${customerId}`);
        updateBasemapSelector(true);
    } else {
        console.log('No custom drone imagery tiles found for customer:', customerId);
        updateBasemapSelector(false);
    }
}

function updateBasemapSelector(showDroneImagery) {
    const basemapSelector = document.getElementById('basemapSelector');
    if (!basemapSelector) return;

    const droneOption = basemapSelector.querySelector('option[value="drone_imagery"]');

    if (showDroneImagery && !droneOption) {
        const option = document.createElement('option');
        option.value = 'drone_imagery';
        option.textContent = 'Drone Imagery (High Detail)';
        basemapSelector.appendChild(option);

        const zoomInfo = document.createElement('small');
        zoomInfo.className = 'text-muted d-block';
        zoomInfo.textContent = 'Available at zoom levels 18-25';
        basemapSelector.parentNode.appendChild(zoomInfo);

    } else if (!showDroneImagery && droneOption) {
        droneOption.remove();
        const zoomInfo = basemapSelector.parentNode.querySelector('small');
        if (zoomInfo) zoomInfo.remove();
    }
}

// State management functions
function createDebouncedSave() {
    let timeout;
    return function() {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            saveMapState();
        }, 1000);
    };
}

function getUserStateKey() {
    if (!currentUser) return STATE_STORAGE_KEY + '_default';
    return STATE_STORAGE_KEY + '_' + currentUser.email.replace(/[^a-zA-Z0-9]/g, '_');
}

async function saveMapState() {
    try {
        const state = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            user: currentUser ? currentUser.email : 'anonymous',
            mapView: {
                center: map ? [map.getCenter().lat, map.getCenter().lng] : [20.5937, 78.9629],
                zoom: map ? map.getZoom() : 5,
                basemap: document.getElementById('basemapSelector')?.value || 'openstreetmap'
            },
            layers: mapLayers.map(layer => ({
                id: layer.id,
                name: layer.name,
                tableId: layer.tableId,
                geometryField: layer.geometryField,
                color: layer.color,
                visible: layer.visible,
                type: layer.type,
                mediaType: layer.mediaType,
                properties: layer.properties || {},
                fieldPermissions: layer.fieldPermissions || {}
            })),
            filters: currentFilters
        };

        const stateKey = getUserStateKey();
        localStorage.setItem(stateKey, JSON.stringify(state));
        console.log('Map state saved successfully');
    } catch (error) {
        console.error('Error saving map state:', error);
    }
}

async function loadMapState() {
    try {
        const stateKey = getUserStateKey();
        const savedState = localStorage.getItem(stateKey);

        if (!savedState) {
            console.log('No saved state found');
            return;
        }

        const state = JSON.parse(savedState);
        console.log('Loading saved map state:', state);

        // Restore map view
        if (state.mapView && map) {
            map.setView(state.mapView.center, state.mapView.zoom);

            const basemapSelector = document.getElementById('basemapSelector');
            if (basemapSelector && state.mapView.basemap) {
                basemapSelector.value = state.mapView.basemap;
                changeBasemap();
            }
        }

        // Restore layers (this would need integration with your layer loading system)
        if (state.layers && state.layers.length > 0) {
            console.log(`Restoring ${state.layers.length} layers from saved state`);
            // Note: This would need to be integrated with your actual layer loading mechanism
        }

        // Restore filters
        if (state.filters) {
            currentFilters = state.filters;
            updateFilterRulesDisplay();
        }

        console.log('Map state loaded successfully');
    } catch (error) {
        console.error('Error loading map state:', error);
    }
}

function exportMapState() {
    try {
        const stateKey = getUserStateKey();
        const savedState = localStorage.getItem(stateKey);

        if (!savedState) {
            showWarning('No saved state to export');
            return;
        }

        const blob = new Blob([savedState], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `map_state_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
        URL.revokeObjectURL(url);

        showSuccess('Map state exported successfully');
    } catch (error) {
        console.error('Error exporting map state:', error);
        showError('Failed to export map state');
    }
}

function importMapState(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const state = JSON.parse(e.target.result);
            const stateKey = getUserStateKey();
            localStorage.setItem(stateKey, JSON.stringify(state));

            showSuccess('Map state imported successfully. Reload the page to apply changes.');
        } catch (error) {
            console.error('Error importing map state:', error);
            showError('Failed to import map state: Invalid file format');
        }
    };
    reader.readAsText(file);
}

function clearMapState() {
    if (confirm('Are you sure you want to clear all saved map state? This cannot be undone.')) {
        try {
            const stateKey = getUserStateKey();
            localStorage.removeItem(stateKey);
            showSuccess('Map state cleared successfully. Reload the page to see changes.');
        } catch (error) {
            console.error('Error clearing map state:', error);
            showError('Failed to clear map state');
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {
    if (!window.teableAuth.requireAuth()) return;

    setTimeout(() => {
        initializeMap();
    }, 100);
});

async function initializeMap() {
    try {
        currentUser = window.teableAuth.getCurrentSession();
        if (!currentUser) {
            console.error('No authenticated user found');
            window.location.href = 'login.html';
            return;
        }

        document.getElementById('userDisplay').textContent =
            `${currentUser.firstName} ${currentUser.lastName} (${currentUser.role})`;

        if (currentUser.userType === 'space_owner') {
            const clientConfig = window.teableAuth.clientConfig;
            if (!clientConfig) {
                console.error('No client configuration found');
                return;
            }
            window.teableAPI.init(clientConfig);
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        await initializeCustomerBaseMaps();

        map = L.map('map', {
            maxZoom: 25,
            zoomControl: true,
            zoomSnap: 0.5,
            zoomDelta: 0.5
        }).setView([20.5937, 78.9629], 5);

        L.tileLayer(baseMaps.openstreetmap.url, {
            attribution: baseMaps.openstreetmap.attribution,
            maxZoom: baseMaps.openstreetmap.maxZoom || 25
        }).addTo(map);

        measurementGroup = L.layerGroup().addTo(map);

        addZoomLevelDisplay();
        map.on('zoomend', handleZoomChange);

        await loadAvailableTables();
        setupGeoJSONDragDrop();
        setupModalEventListeners();

        // Initialize debounced save and load state
        debouncedSave = createDebouncedSave();
        await loadMapState();

        // Auto-save on map events
        map.on('moveend', debouncedSave);
        map.on('zoomend', debouncedSave);

        console.log('Map initialized successfully with state management');

    } catch (error) {
        console.error('Map initialization failed:', error);
        showError('Failed to initialize map: ' + error.message);
    }
}

function addZoomLevelDisplay() {
    const zoomDisplay = L.control({ position: 'bottomleft' });

    zoomDisplay.onAdd = function(map) {
        const div = L.DomUtil.create('div', 'zoom-display');
        div.style.cssText = `
            background: rgba(255, 255, 255, 0.9);
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 12px;
            font-weight: bold;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        `;
        div.innerHTML = `Zoom: ${map.getZoom()}`;
        return div;
    };

    zoomDisplay.addTo(map);

    map.on('zoomend', function() {
        const zoomElements = document.querySelectorAll('.zoom-display');
        zoomElements.forEach(element => {
            element.innerHTML = `Zoom: ${map.getZoom()}`;
        });
    });
}

function handleZoomChange() {
    const currentZoom = map.getZoom();
    const basemapSelector = document.getElementById('basemapSelector');
    const droneOption = basemapSelector?.querySelector('option[value="drone_imagery"]');

    if (currentZoom >= 18 && droneOption) {
        if (basemapSelector.value !== 'drone_imagery') {
            showInfo(`🚁 High-detail drone imagery is available at this zoom level! Switch to "Drone Imagery" for maximum detail.`);
        }
    }

    if (currentZoom > 21 && basemapSelector?.value !== 'drone_imagery') {
        showWarning(`⚠️ Current zoom level (${currentZoom}) exceeds standard basemap detail. Consider switching to Drone Imagery for better resolution.`);
    }
}

async function loadAvailableTables() {
    const tableSelector = document.getElementById('newLayerTable');

    if (!tableSelector) {
        console.error('Table selector not found');
        return;
    }

    try {
        tableSelector.innerHTML = '<option value="">Loading tables...</option>';
        tableSelector.disabled = true;

        if (!currentUser || !window.teableAPI || !window.teableAPI.config.baseUrl) {
            console.log('Authentication or API not ready, skipping table loading');
            tableSelector.innerHTML = '<option value="">Authentication required - please login</option>';
            tableSelector.disabled = false;
            return;
        }

        console.log('Loading tables from Teable API...');
        const tablesData = await window.teableAPI.getTables();
        const tables = tablesData.tables || tablesData || [];

        console.log(`Received ${tables.length} tables from API`);

        const userTables = tables.filter(t =>
            t.name &&
            !t.name.startsWith('app_') &&
            !t.name.startsWith('field_') &&
            !t.name.startsWith('system_') &&
            t.name !== 'data_change_logs'
        );

        console.log(`Filtered to ${userTables.length} user tables`);

        tableSelector.innerHTML = '';

        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = userTables.length > 0 ? 'Select table...' : 'No tables available';
        tableSelector.appendChild(defaultOption);

        userTables.forEach(table => {
            const option = document.createElement('option');
            option.value = table.id;
            option.textContent = table.name;
            tableSelector.appendChild(option);
        });

        tableSelector.disabled = false;

        console.log(`✅ Populated table selector with ${userTables.length} tables`);

        if (userTables.length === 0) {
            showWarning('No tables found. Please create tables in your Teable.io workspace first.');
        } else {
            showSuccess(`Loaded ${userTables.length} available tables`);
        }

    } catch (error) {
        console.error('Error loading tables:', error);
        tableSelector.innerHTML = '<option value="">Error loading tables - click to retry</option>';
        tableSelector.disabled = false;
        showError(`Failed to load tables: ${error.message}. Please check your API configuration and try again.`);
        throw error;
    }
}

function showAddLayerModal() {
    try {
        resetAddLayerModal();
        clearErrors();

        const modal = new bootstrap.Modal(document.getElementById('addLayerModal'));

        loadAvailableTables().then(() => {
            modal.show();

            setTimeout(() => {
                const tableTab = document.getElementById('table-tab');
                const geoJsonTab = document.getElementById('geojson-tab');
                const tablePane = document.getElementById('table-pane');
                const geoJsonPane = document.getElementById('geojson-pane');

                if (tableTab && geoJsonTab && tablePane && geoJsonPane) {
                    tableTab.classList.add('active');
                    geoJsonTab.classList.remove('active');
                    tablePane.classList.add('show', 'active');
                    geoJsonPane.classList.remove('show', 'active');
                }
            }, 100);
        }).catch(error => {
            console.error('Error loading tables before showing modal:', error);
            modal.show();
            showError('Failed to load available tables. Please check your connection and try again.');
        });
    } catch (error) {
        console.error('Error in showAddLayerModal:', error);
        showError('Failed to open Add Layer dialog: ' + error.message);
    }
}

function resetAddLayerModal() {
    try {
        const fields = [
            'newLayerTable',
            'newLayerName',
            'newLayerGeometry',
            'geoJSONTableName'
        ];

        fields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                try {
                    if (field.tagName === 'SELECT') {
                        field.selectedIndex = 0;
                    } else {
                        field.value = '';
                    }
                } catch (fieldError) {
                    console.warn(`Error resetting field ${fieldId}:`, fieldError);
                }
            }
        });

        const colorField = document.getElementById('newLayerColor');
        if (colorField) {
            colorField.value = '#3498db';
        }

        const geometrySelector = document.getElementById('newLayerGeometry');
        if (geometrySelector) {
            geometrySelector.innerHTML = '<option value="">Auto-detect...</option>';
        }

        const linkedTablesInfo = document.getElementById('linkedTablesInfo');
        if (linkedTablesInfo) {
            linkedTablesInfo.innerHTML = 'Select a table to see linked information';
        }

        const geoJSONPreview = document.getElementById('geoJSONPreview');
        if (geoJSONPreview) {
            geoJSONPreview.style.display = 'none';
        }

        const uploadProgress = document.getElementById('uploadProgress');
        if (uploadProgress) {
            uploadProgress.style.display = 'none';
        }

        const addLayerBtn = document.getElementById('addLayerBtn');
        const uploadGeoJSONBtn = document.getElementById('uploadGeoJSONBtn');

        if (addLayerBtn) {
            addLayerBtn.style.display = 'inline-block';
            addLayerBtn.disabled = false;
        }
        if (uploadGeoJSONBtn) {
            uploadGeoJSONBtn.style.display = 'none';
            uploadGeoJSONBtn.disabled = true;
        }

        geoJSONData = null;
        clearModalErrors();

    } catch (error) {
        console.error('Error in resetAddLayerModal:', error);
    }
}

function clearErrors() {
    const existingAlerts = document.querySelectorAll('.alert-danger');
    existingAlerts.forEach(alert => {
        if (alert.classList.contains('position-fixed')) {
            alert.remove();
        }
    });
}

function clearModalErrors() {
    const modalInputs = document.querySelectorAll('#addLayerModal input, #addLayerModal select');
    modalInputs.forEach(input => {
        input.classList.remove('is-invalid');
        const feedback = input.parentNode.querySelector('.invalid-feedback');
        if (feedback) {
            feedback.remove();
        }
    });
}

function toggleSection(header) {
    const section = header.parentElement;
    const content = section.querySelector('.section-content');
    const chevron = header.querySelector('.fas');

    if (content.style.display === 'none' || content.style.display === '') {
        content.style.display = 'block';
        chevron.classList.remove('fa-chevron-right');
        chevron.classList.add('fa-chevron-down');
        section.classList.add('active');
    } else {
        content.style.display = 'none';
        chevron.classList.remove('fa-chevron-down');
        chevron.classList.add('fa-chevron-right');
        section.classList.remove('active');
    }
}

function setupModalEventListeners() {
    const addLayerModal = document.getElementById('addLayerModal');
    if (addLayerModal) {
        const tableTab = document.getElementById('table-tab');
        const geoJsonTab = document.getElementById('geojson-tab');

        if (tableTab) {
            tableTab.addEventListener('click', function(e) {
                e.preventDefault();
                switchToTableTab();
            });
        }

        if (geoJsonTab) {
            geoJsonTab.addEventListener('click', function(e) {
                e.preventDefault();
                switchToGeoJSONTab();
            });
        }

        addLayerModal.addEventListener('shown.bs.modal', handleAddLayerModalShown);

        const tableSelector = document.getElementById('newLayerTable');
        if (tableSelector) {
            tableSelector.addEventListener('click', function() {
                if (this.options.length === 1 && this.options[0].textContent.includes('Error')) {
                    console.log('Retrying table load...');
                    loadAvailableTables().catch(error => {
                        console.error('Retry failed:', error);
                    });
                }
            });
        }

        addLayerModal.addEventListener('hidden.bs.modal', handleAddLayerModalHidden);
    }
}

function switchToTableTab() {
    const tableTab = document.getElementById('table-tab');
    const geoJsonTab = document.getElementById('geojson-tab');
    const tablePane = document.getElementById('table-pane');
    const geoJsonPane = document.getElementById('geojson-pane');
    const addLayerBtn = document.getElementById('addLayerBtn');
    const uploadGeoJSONBtn = document.getElementById('uploadGeoJSONBtn');

    if (tableTab && geoJsonTab && tablePane && geoJsonPane) {
        tableTab.classList.add('active');
        geoJsonTab.classList.remove('active');
        tablePane.classList.add('show', 'active');
        geoJsonPane.classList.remove('show', 'active');

        if (addLayerBtn) {
            addLayerBtn.style.display = 'inline-block';
        }
        if (uploadGeoJSONBtn) {
            uploadGeoJSONBtn.style.display = 'none';
        }
    }
}

function switchToGeoJSONTab() {
    const tableTab = document.getElementById('table-tab');
    const geoJsonTab = document.getElementById('geojson-tab');
    const tablePane = document.getElementById('table-pane');
    const geoJsonPane = document.getElementById('geojson-pane');
    const addLayerBtn = document.getElementById('addLayerBtn');
    const uploadGeoJSONBtn = document.getElementById('uploadGeoJSONBtn');

    if (tableTab && geoJsonTab && tablePane && geoJsonPane) {
        tableTab.classList.remove('active');
        geoJsonTab.classList.add('active');
        tablePane.classList.remove('show', 'active');
        geoJsonPane.classList.add('show', 'active');

        if (addLayerBtn) {
            addLayerBtn.style.display = 'none';
        }
        if (uploadGeoJSONBtn) {
            uploadGeoJSONBtn.style.display = 'inline-block';
        }
    }
}

function setupGeoJSONDragDrop() {
    const uploadArea = document.getElementById('geoJSONUploadArea');

    if (uploadArea) {
        uploadArea.addEventListener('dragover', function(e) {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', function(e) {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            uploadArea.classList.remove('dragover');

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleGeoJSONFile({ target: { files: files } });
            }
        });
    }
}

function handleAddLayerModalShown() {
    switchToTableTab();
    loadAvailableTables().catch(error => {
        console.error('Failed to load tables on modal show:', error);
    });
}

function handleAddLayerModalHidden() {
    resetAddLayerModal();
}

// Utility functions
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
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    alertDiv.style.cssText = 'top: 80px; right: 20px; z-index: 9999; min-width: 300px;';
    alertDiv.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-triangle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
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

// Make essential functions globally available
window.showAddLayerModal = showAddLayerModal;
window.changeBasemap = changeBasemap;
window.toggleSection = toggleSection;
window.saveMapState = saveMapState; // saveMapState is called via debouncedSave
window.exportMapState = exportMapState;
window.importMapState = importMapState;
window.clearMapState = clearMapState;

// Initialize debounced save when DOM loads
document.addEventListener('DOMContentLoaded', function() {
    if (!debouncedSave) {
        debouncedSave = createDebouncedSave();
    }
});