/**
 * Map Configuration Management for Client Admins
 */

let currentUser = null;
let availableTables = [];
let publicLayers = [];
let mapConfig = {};
let previewMap = null;
let hasUnsavedChanges = false;
let centerMarker = null;

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication and admin privileges
    if (!window.teableAuth.requireAuth()) return;
    
    // Check if user is admin or creator
    const session = window.teableAuth.getCurrentSession();
    if (!session.isAdmin && session.role !== 'creator') {
        alert('Access denied. Map configuration requires admin or creator privileges.');
        window.location.href = 'dashboard.html';
        return;
    }
    
    initializeMapConfig();
});

async function initializeMapConfig() {
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
        await loadAvailableTables();
        
        // Load existing configuration
        await loadMapConfiguration();
        
        // Initialize preview map
        initializePreviewMap();
        
        // Setup event listeners
        setupEventListeners();
        
        console.log('Map configuration initialized');
        
    } catch (error) {
        console.error('Map configuration initialization failed:', error);
        showError('Failed to initialize map configuration: ' + error.message);
    }
}

async function loadAvailableTables() {
    try {
        const tablesData = await window.teableAPI.getTables();
        availableTables = (tablesData.tables || tablesData || []).filter(t => 
            !t.name.startsWith('app_') && 
            !t.name.startsWith('field_') && 
            !t.name.startsWith('system_')
        );
        
        // Populate table selectors
        populateTableSelectors();
        
        console.log('Loaded available tables:', availableTables.length);
        
    } catch (error) {
        console.error('Error loading tables:', error);
        showError('Failed to load tables: ' + error.message);
    }
}

function populateTableSelectors() {
    const selectors = [
        'publicLayerTable',
        'fieldLayerSelector', 
        'popupLayerSelector',
        'styleLayerSelector',
        'labelLayerSelector',
        'centerToLayerSelector'
    ];
    
    selectors.forEach(selectorId => {
        const selector = document.getElementById(selectorId);
        if (selector) {
            const currentValue = selector.value;
            selector.innerHTML = selectorId === 'centerToLayerSelector' ? 
                '<option value="">Select layer to center map...</option>' :
                '<option value="">Select table...</option>';
            
            availableTables.forEach(table => {
                const option = document.createElement('option');
                option.value = table.id;
                option.textContent = table.name;
                selector.appendChild(option);
            });
            
            // Restore previous selection
            if (currentValue) {
                selector.value = currentValue;
            }
        }
    });
}

async function loadMapConfiguration() {
    try {
        // Try to load existing configuration from a system table or localStorage
        const savedConfig = localStorage.getItem('teable_map_config');
        
        if (savedConfig) {
            mapConfig = JSON.parse(savedConfig);
            populateConfigurationForm();
        } else {
            // Set default configuration
            mapConfig = getDefaultConfiguration();
            populateConfigurationForm();
        }
        
        console.log('Loaded map configuration:', mapConfig);
        
    } catch (error) {
        console.error('Error loading map configuration:', error);
        mapConfig = getDefaultConfiguration();
        populateConfigurationForm();
    }
}

function getDefaultConfiguration() {
    return {
        general: {
            title: 'Public GIS Map',
            description: 'Interactive map with geospatial data',
            defaultBasemap: 'openstreetmap',
            defaultZoom: 10,
            centerLat: 20.5937,
            centerLng: 78.9629,
            enablePublicAccess: true
        },
        features: {
            enableMeasurement: true,
            enableDistance: true,
            enableArea: true,
            enableFiltering: true,
            enableQuickSearch: true,
            enableAdvancedFilters: false,
            enableBasemapSwitcher: true,
            enableExport: false,
            enablePopups: true,
            enableLegend: true,
            enableCoordinates: false
        },
        permissions: {
            allowPublicEditing: false,
            allowPublicExport: false,
            allowPublicPrint: true,
            enableMapSharing: true,
            enableEmbedding: false
        },
        layers: [],
        styling: {},
        labels: {}
    };
}

function populateConfigurationForm() {
    // General settings
    document.getElementById('mapTitle').value = mapConfig.general?.title || '';
    document.getElementById('mapDescription').value = mapConfig.general?.description || '';
    document.getElementById('defaultBasemap').value = mapConfig.general?.defaultBasemap || 'openstreetmap';
    document.getElementById('defaultZoom').value = mapConfig.general?.defaultZoom || 10;
    document.getElementById('centerLat').value = mapConfig.general?.centerLat || 20.5937;
    document.getElementById('centerLng').value = mapConfig.general?.centerLng || 78.9629;
    document.getElementById('enablePublicAccess').checked = mapConfig.general?.enablePublicAccess !== false;
    
    // Update zoom display
    updateZoomDisplay(mapConfig.general?.defaultZoom || 10);
    
    // Features
    const features = mapConfig.features || {};
    Object.keys(features).forEach(feature => {
        const element = document.getElementById(feature);
        if (element) {
            element.checked = features[feature];
        }
    });
    
    // Permissions
    const permissions = mapConfig.permissions || {};
    Object.keys(permissions).forEach(permission => {
        const element = document.getElementById(permission);
        if (element) {
            element.checked = permissions[permission];
        }
    });
    
    // Update feature toggles
    updateFeatureToggles();
    
    // Load public layers
    publicLayers = mapConfig.layers || [];
    updatePublicLayersList();
}

function setupEventListeners() {
    // Track changes for save indicator
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        input.addEventListener('change', () => {
            hasUnsavedChanges = true;
            updateSaveIndicator();
        });
    });
    
    // Feature toggle listeners
    document.getElementById('enableMeasurement').addEventListener('change', updateFeatureToggles);
    document.getElementById('enableFiltering').addEventListener('change', updateFeatureToggles);
    document.getElementById('enablePopups').addEventListener('change', updateFeatureToggles);
    document.getElementById('enableLabels').addEventListener('change', updateLabelOptions);
    
    // Styling listeners
    document.getElementById('fillColor').addEventListener('change', updateStylePreview);
    document.getElementById('borderColor').addEventListener('change', updateStylePreview);
    document.getElementById('fillOpacity').addEventListener('input', function() {
        document.getElementById('opacityDisplay').textContent = Math.round(this.value * 100) + '%';
        updateStylePreview();
    });
}

function updateFeatureToggles() {
    // Measurement tools
    const measurementEnabled = document.getElementById('enableMeasurement').checked;
    const measurementOptions = document.getElementById('measurementOptions');
    const measurementToggle = document.getElementById('measurementToggle');
    
    if (measurementEnabled) {
        measurementOptions.style.display = 'block';
        measurementToggle.classList.add('enabled');
    } else {
        measurementOptions.style.display = 'none';
        measurementToggle.classList.remove('enabled');
    }
    
    // Filtering
    const filteringEnabled = document.getElementById('enableFiltering').checked;
    const filterOptions = document.getElementById('filterOptions');
    const filterToggle = document.getElementById('filterToggle');
    
    if (filteringEnabled) {
        filterOptions.style.display = 'block';
        filterToggle.classList.add('enabled');
    } else {
        filterOptions.style.display = 'none';
        filterToggle.classList.remove('enabled');
    }
    
    // Popups
    const popupsEnabled = document.getElementById('enablePopups').checked;
    const popupOptions = document.getElementById('popupOptions');
    const popupToggle = document.getElementById('popupToggle');
    
    if (popupsEnabled) {
        if (popupOptions) popupOptions.style.display = 'block';
        popupToggle.classList.add('enabled');
    } else {
        if (popupOptions) popupOptions.style.display = 'none';
        popupToggle.classList.remove('enabled');
    }
}

function updateLabelOptions() {
    const labelsEnabled = document.getElementById('enableLabels').checked;
    const labelOptions = document.getElementById('labelOptions');
    
    if (labelOptions) {
        labelOptions.style.display = labelsEnabled ? 'block' : 'none';
    }
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.config-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    document.getElementById(tabName + 'Tab').style.display = 'block';
}

function updateZoomDisplay(value) {
    document.getElementById('zoomDisplay').textContent = value;
}

function initializePreviewMap() {
    try {
        const lat = parseFloat(document.getElementById('centerLat').value) || 20.5937;
        const lng = parseFloat(document.getElementById('centerLng').value) || 78.9629;
        const zoom = parseInt(document.getElementById('defaultZoom').value) || 10;
        
        previewMap = L.map('previewMap').setView([lat, lng], zoom);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(previewMap);
        
        // Add center marker
        addCenterMarker();
        
        // Add sample data with proper geometry rendering
        addSampleGeometryData();
        
        console.log('Preview map initialized');
        
    } catch (error) {
        console.error('Error initializing preview map:', error);
    }
}

function addSampleGeometryData() {
    try {
        const lat = parseFloat(document.getElementById('centerLat').value) || 20.5937;
        const lng = parseFloat(document.getElementById('centerLng').value) || 78.9629;
        
        // Create sample polygon using WKT-like coordinates
        const sampleWKT = `POLYGON((${lng-0.05} ${lat-0.05}, ${lng+0.05} ${lat-0.05}, ${lng+0.05} ${lat+0.05}, ${lng-0.05} ${lat+0.05}, ${lng-0.05} ${lat-0.05}))`;
        
        // Parse and render the geometry
        const coordinates = parseWKTToLeaflet(sampleWKT);
        if (coordinates && coordinates.length > 0) {
            const polygon = L.polygon(coordinates[0], {
                fillColor: '#3498db',
                color: '#2c3e50',
                weight: 2,
                fillOpacity: 0.7
            }).addTo(previewMap);
            
            polygon.bindPopup('<strong>Sample Feature</strong><br>This is how features will appear to public users');
        }
        
        console.log('Sample geometry data added to preview');
        
    } catch (error) {
        console.error('Error adding sample geometry data:', error);
    }
}

function parseWKTToLeaflet(wkt) {
    try {
        // Remove WKT type prefix and clean up
        let cleanWkt = wkt.replace(/^(MULTI)?POLYGON\s*\(/i, '').replace(/\)$/, '');
        
        // Handle MULTIPOLYGON
        if (wkt.toUpperCase().startsWith('MULTIPOLYGON')) {
            cleanWkt = cleanWkt.replace(/^\(\(/, '').replace(/\)\)$/, '');
            const polygonStrings = cleanWkt.split(')),((');
            
            return polygonStrings.map(polygonString => {
                const rings = polygonString.split('),(');
                return rings.map(ring => {
                    const coords = ring.replace(/[()]/g, '').split(',');
                    return coords.map(coord => {
                        const [lon, lat] = coord.trim().split(' ').map(Number);
                        return [lat, lon]; // Leaflet uses [lat, lon]
                    });
                });
            });
        } else {
            // Handle single POLYGON
            cleanWkt = cleanWkt.replace(/^\(/, '').replace(/\)$/, '');
            const rings = cleanWkt.split('),(');
            
            return [rings.map(ring => {
                const coords = ring.replace(/[()]/g, '').split(',');
                return coords.map(coord => {
                    const [lon, lat] = coord.trim().split(' ').map(Number);
                    return [lat, lon]; // Leaflet uses [lat, lon]
                });
            })];
        }
    } catch (error) {
        console.error('Error parsing WKT:', error);
        return null;
    }
}

function addCenterMarker() {
    const lat = parseFloat(document.getElementById('centerLat').value);
    const lng = parseFloat(document.getElementById('centerLng').value);
    
    if (!isNaN(lat) && !isNaN(lng) && previewMap) {
        // Remove existing center marker
        if (centerMarker) {
            previewMap.removeLayer(centerMarker);
        }
        
        // Add new center marker
        centerMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'center-marker',
                html: '<i class="fas fa-crosshairs" style="color: #e74c3c; font-size: 20px;"></i>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(previewMap);
        
        centerMarker.bindPopup('<strong>Map Center</strong><br>Lat: ' + lat + '<br>Lng: ' + lng);
    }
}

function updatePreviewCenter() {
    const lat = parseFloat(document.getElementById('centerLat').value);
    const lng = parseFloat(document.getElementById('centerLng').value);
    
    if (!isNaN(lat) && !isNaN(lng) && previewMap) {
        previewMap.setView([lat, lng]);
        addCenterMarker();
    }
}

async function centerToLayer() {
    const layerTableId = document.getElementById('centerToLayerSelector').value;
    
    if (!layerTableId) {
        showError('Please select a layer to center the map to.');
        return;
    }
    
    try {
        // Get sample data from the selected table
        const recordsData = await window.teableAPI.getRecords(layerTableId, { limit: 10 });
        const records = recordsData.records || [];
        
        if (records.length === 0) {
            showError('No data found in the selected layer.');
            return;
        }
        
        // Find geometry field and calculate bounds
        let bounds = null;
        let geometryFound = false;
        
        records.forEach(record => {
            const geometryField = findGeometryField(record.fields);
            if (geometryField && record.fields[geometryField]) {
                const geometry = record.fields[geometryField];
                const coordinates = parseWKTToLeaflet(geometry);
                
                if (coordinates && coordinates.length > 0) {
                    geometryFound = true;
                    coordinates.forEach(ring => {
                        ring.forEach(coord => {
                            if (!bounds) {
                                bounds = { 
                                    minLat: coord[0], maxLat: coord[0], 
                                    minLng: coord[1], maxLng: coord[1] 
                                };
                            } else {
                                bounds.minLat = Math.min(bounds.minLat, coord[0]);
                                bounds.maxLat = Math.max(bounds.maxLat, coord[0]);
                                bounds.minLng = Math.min(bounds.minLng, coord[1]);
                                bounds.maxLng = Math.max(bounds.maxLng, coord[1]);
                            }
                        });
                    });
                }
            }
        });
        
        if (!geometryFound) {
            showError('No valid geometry data found in the selected layer.');
            return;
        }
        
        // Calculate center
        const centerLat = (bounds.minLat + bounds.maxLat) / 2;
        const centerLng = (bounds.minLng + bounds.maxLng) / 2;
        
        // Update form values
        document.getElementById('centerLat').value = centerLat.toFixed(6);
        document.getElementById('centerLng').value = centerLng.toFixed(6);
        
        // Update preview
        updatePreviewCenter();
        
        showSuccess('Map centered to layer bounds successfully!');
        
    } catch (error) {
        console.error('Error centering to layer:', error);
        showError('Failed to center to layer: ' + error.message);
    }
}

function findGeometryField(fields) {
    const geometryFieldNames = ['geometry', 'geom', 'wkt', 'shape', 'polygon', 'point', 'location'];
    
    for (const fieldName of Object.keys(fields)) {
        const lowerFieldName = fieldName.toLowerCase();
        if (geometryFieldNames.some(geoName => lowerFieldName.includes(geoName))) {
            return fieldName;
        }
    }
    
    return null;
}

function updatePreview() {
    if (!previewMap) return;
    
    try {
        const lat = parseFloat(document.getElementById('centerLat').value) || 20.5937;
        const lng = parseFloat(document.getElementById('centerLng').value) || 78.9629;
        const zoom = parseInt(document.getElementById('defaultZoom').value) || 10;
        
        previewMap.setView([lat, lng], zoom);
        
        // Update base map
        const basemap = document.getElementById('defaultBasemap').value;
        updatePreviewBasemap(basemap);
        
        // Update center marker
        addCenterMarker();
        
        // Re-add sample geometry data
        addSampleGeometryData();
        
        showSuccess('Preview updated successfully!');
        
    } catch (error) {
        console.error('Error updating preview:', error);
        showError('Failed to update preview: ' + error.message);
    }
}

function updatePreviewBasemap(basemapType) {
    if (!previewMap) return;
    
    // Remove existing tile layers
    previewMap.eachLayer(layer => {
        if (layer._url && layer._url.includes('tile')) {
            previewMap.removeLayer(layer);
        }
    });
    
    // Add new base layer
    let newBaseLayer;
    switch (basemapType) {
        case 'satellite':
            newBaseLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: '© Esri'
            });
            break;
        case 'terrain':
            newBaseLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenTopoMap'
            });
            break;
        case 'dark':
            newBaseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '© CartoDB'
            });
            break;
        case 'light':
            newBaseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                attribution: '© CartoDB'
            });
            break;
        default:
            newBaseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            });
    }
    
    newBaseLayer.addTo(previewMap);
}

function addPublicLayer() {
    const modal = new bootstrap.Modal(document.getElementById('addPublicLayerModal'));
    modal.show();
}

async function savePublicLayer() {
    try {
        const tableId = document.getElementById('publicLayerTable').value;
        const layerName = document.getElementById('publicLayerName').value.trim();
        const visibility = document.getElementById('publicLayerVisibility').value;
        const order = parseInt(document.getElementById('publicLayerOrder').value) || 1;
        const description = document.getElementById('publicLayerDescription').value.trim();
        
        if (!tableId || !layerName) {
            throw new Error('Please select a table and enter a layer name');
        }
        
        const table = availableTables.find(t => t.id === tableId);
        
        const newLayer = {
            id: Date.now().toString(),
            tableId: tableId,
            tableName: table?.name || 'Unknown',
            name: layerName,
            description: description,
            visibility: visibility,
            order: order,
            visibleFields: [],
            popupFields: [],
            styling: {
                type: 'single',
                fillColor: '#3498db',
                borderColor: '#2c3e50',
                fillOpacity: 0.7
            },
            labels: {
                enabled: false,
                field: '',
                fontSize: 12,
                color: '#333333',
                background: true
            }
        };
        
        publicLayers.push(newLayer);
        updatePublicLayersList();
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('addPublicLayerModal'));
        modal.hide();
        
        // Clear form
        document.getElementById('publicLayerTable').value = '';
        document.getElementById('publicLayerName').value = '';
        document.getElementById('publicLayerDescription').value = '';
        
        hasUnsavedChanges = true;
        updateSaveIndicator();
        
        showSuccess('Public layer added successfully!');
        
    } catch (error) {
        console.error('Error adding public layer:', error);
        showError('Failed to add public layer: ' + error.message);
    }
}

function updatePublicLayersList() {
    const container = document.getElementById('publicLayersList');
    
    if (publicLayers.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="fas fa-layer-group fa-3x mb-3"></i>
                <h6>No Public Layers</h6>
                <p>Add layers to make data visible to public users</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    publicLayers.sort((a, b) => a.order - b.order).forEach(layer => {
        const visibilityIcon = layer.visibility === 'visible' ? 'fa-eye text-success' : 'fa-eye-slash text-muted';
        
        html += `
            <div class="layer-config-item" data-layer-id="${layer.id}">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h6 class="mb-1">
                            <i class="fas ${visibilityIcon} me-2"></i>
                            ${layer.name}
                        </h6>
                        <p class="text-muted small mb-1">Source: ${layer.tableName}</p>
                        ${layer.description ? `<p class="small mb-2">${layer.description}</p>` : ''}
                        <div class="small text-muted">
                            Order: ${layer.order} • 
                            Fields: ${layer.visibleFields.length} visible • 
                            Popup: ${layer.popupFields.length} fields •
                            Style: ${layer.styling.type}
                        </div>
                    </div>
                    <div class="d-flex gap-1">
                        <button class="btn btn-sm btn-outline-primary" onclick="configureLayerFields('${layer.id}')" title="Configure Fields">
                            <i class="fas fa-list"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-info" onclick="configureLayerStyling('${layer.id}')" title="Configure Styling">
                            <i class="fas fa-palette"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="removePublicLayer('${layer.id}')" title="Remove Layer">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Update layer selectors in other tabs
    updateLayerSelectors();
}

function updateLayerSelectors() {
    const selectors = ['fieldLayerSelector', 'popupLayerSelector', 'styleLayerSelector', 'labelLayerSelector'];
    
    selectors.forEach(selectorId => {
        const selector = document.getElementById(selectorId);
        if (selector) {
            const currentValue = selector.value;
            selector.innerHTML = '<option value="">Choose a layer...</option>';
            
            publicLayers.forEach(layer => {
                const option = document.createElement('option');
                option.value = layer.id;
                option.textContent = layer.name;
                selector.appendChild(option);
            });
            
            // Restore selection if it still exists
            if (currentValue && publicLayers.find(l => l.id === currentValue)) {
                selector.value = currentValue;
            }
        }
    });
}

function removePublicLayer(layerId) {
    if (!confirm('Are you sure you want to remove this public layer?')) return;
    
    const index = publicLayers.findIndex(l => l.id === layerId);
    if (index !== -1) {
        publicLayers.splice(index, 1);
        updatePublicLayersList();
        
        hasUnsavedChanges = true;
        updateSaveIndicator();
        
        showSuccess('Public layer removed successfully!');
    }
}

async function loadLayerFields() {
    const layerId = document.getElementById('fieldLayerSelector').value;
    const container = document.getElementById('layerFieldsList');
    
    if (!layerId) {
        container.innerHTML = '<p class="text-muted text-center py-3">Select a layer to configure field visibility</p>';
        return;
    }
    
    try {
        const layer = publicLayers.find(l => l.id === layerId);
        if (!layer) return;
        
        // Get table fields
        const recordsData = await window.teableAPI.getRecords(layer.tableId, { limit: 1 });
        if (!recordsData.records || recordsData.records.length === 0) {
            container.innerHTML = '<p class="text-muted text-center py-3">No data found in this table</p>';
            return;
        }
        
        const fieldNames = Object.keys(recordsData.records[0].fields || {});
        const selectionMode = document.getElementById('fieldSelectionMode').value;
        
        let html = '';
        fieldNames.forEach(fieldName => {
            const isSelected = layer.visibleFields.includes(fieldName);
            const checked = (selectionMode === 'whitelist' && isSelected) || 
                           (selectionMode === 'blacklist' && !isSelected);
            
            html += `
                <div class="field-checkbox">
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="field_${fieldName}" 
                               ${checked ? 'checked' : ''} onchange="updateLayerFieldVisibility('${layerId}', '${fieldName}', this.checked)">
                        <label class="form-check-label" for="field_${fieldName}">
                            ${fieldName}
                        </label>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Error loading layer fields:', error);
        container.innerHTML = '<p class="text-danger text-center py-3">Error loading fields</p>';
    }
}

async function loadPopupFields() {
    const layerId = document.getElementById('popupLayerSelector').value;
    const container = document.getElementById('popupFieldsList');
    
    if (!layerId) {
        container.innerHTML = '<p class="text-muted text-center py-3">Select a layer to configure popup fields</p>';
        return;
    }
    
    try {
        const layer = publicLayers.find(l => l.id === layerId);
        if (!layer) return;
        
        // Get table fields
        const recordsData = await window.teableAPI.getRecords(layer.tableId, { limit: 1 });
        if (!recordsData.records || recordsData.records.length === 0) {
            container.innerHTML = '<p class="text-muted text-center py-3">No data found in this table</p>';
            return;
        }
        
        const fieldNames = Object.keys(recordsData.records[0].fields || {});
        
        let html = '';
        fieldNames.forEach(fieldName => {
            const isSelected = layer.popupFields.includes(fieldName);
            
            html += `
                <div class="field-checkbox">
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="popup_${fieldName}" 
                               ${isSelected ? 'checked' : ''} onchange="updateLayerPopupField('${layerId}', '${fieldName}', this.checked)">
                        <label class="form-check-label" for="popup_${fieldName}">
                            ${fieldName}
                        </label>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Error loading popup fields:', error);
        container.innerHTML = '<p class="text-danger text-center py-3">Error loading fields</p>';
    }
}

function updateLayerPopupField(layerId, fieldName, isSelected) {
    const layer = publicLayers.find(l => l.id === layerId);
    if (!layer) return;
    
    if (isSelected && !layer.popupFields.includes(fieldName)) {
        layer.popupFields.push(fieldName);
    } else if (!isSelected) {
        layer.popupFields = layer.popupFields.filter(f => f !== fieldName);
    }
    
    hasUnsavedChanges = true;
    updateSaveIndicator();
    updatePublicLayersList();
}

function updateLayerFieldVisibility(layerId, fieldName, isVisible) {
    const layer = publicLayers.find(l => l.id === layerId);
    if (!layer) return;
    
    const selectionMode = document.getElementById('fieldSelectionMode').value;
    
    if (selectionMode === 'whitelist') {
        if (isVisible && !layer.visibleFields.includes(fieldName)) {
            layer.visibleFields.push(fieldName);
        } else if (!isVisible) {
            layer.visibleFields = layer.visibleFields.filter(f => f !== fieldName);
        }
    } else {
        // Blacklist mode - store hidden fields
        if (!layer.hiddenFields) layer.hiddenFields = [];
        
        if (!isVisible && !layer.hiddenFields.includes(fieldName)) {
            layer.hiddenFields.push(fieldName);
        } else if (isVisible) {
            layer.hiddenFields = layer.hiddenFields.filter(f => f !== fieldName);
        }
    }
    
    hasUnsavedChanges = true;
    updateSaveIndicator();
    updatePublicLayersList();
}

function updateFieldSelection() {
    // Reload fields when selection mode changes
    loadLayerFields();
}

function updateStylingType() {
    const stylingType = document.getElementById('stylingType').value;
    const singleControls = document.getElementById('singleColorControls');
    const graduatedControls = document.getElementById('graduatedControls');
    const categorizedControls = document.getElementById('categorizedControls');
    
    // Hide all controls first
    singleControls.style.display = 'none';
    graduatedControls.style.display = 'none';
    categorizedControls.style.display = 'none';
    
    // Show relevant controls
    switch (stylingType) {
        case 'single':
            singleControls.style.display = 'block';
            break;
        case 'graduated':
            graduatedControls.style.display = 'block';
            loadFieldsForStyling('graduatedField');
            break;
        case 'categorized':
            categorizedControls.style.display = 'block';
            loadFieldsForStyling('categorizedField');
            break;
    }
}

async function loadFieldsForStyling(selectId) {
    const layerId = document.getElementById('styleLayerSelector').value;
    const fieldSelect = document.getElementById(selectId);
    
    if (!layerId || !fieldSelect) return;
    
    try {
        const layer = publicLayers.find(l => l.id === layerId);
        if (!layer) return;
        
        // Get table fields
        const recordsData = await window.teableAPI.getRecords(layer.tableId, { limit: 1 });
        if (!recordsData.records || recordsData.records.length === 0) return;
        
        const fieldNames = Object.keys(recordsData.records[0].fields || {});
        
        fieldSelect.innerHTML = '<option value="">Select field...</option>';
        fieldNames.forEach(fieldName => {
            const option = document.createElement('option');
            option.value = fieldName;
            option.textContent = fieldName;
            fieldSelect.appendChild(option);
        });
        
    } catch (error) {
        console.error('Error loading fields for styling:', error);
    }
}

function loadLayerStyling() {
    const layerId = document.getElementById('styleLayerSelector').value;
    if (!layerId) return;
    
    const layer = publicLayers.find(l => l.id === layerId);
    if (!layer) return;
    
    // Update styling type selector
    document.getElementById('stylingType').value = layer.styling.type || 'single';
    updateStylingType();
    
    // Update color controls
    if (layer.styling.fillColor) {
        document.getElementById('fillColor').value = layer.styling.fillColor;
    }
    if (layer.styling.borderColor) {
        document.getElementById('borderColor').value = layer.styling.borderColor;
    }
    if (layer.styling.fillOpacity !== undefined) {
        document.getElementById('fillOpacity').value = layer.styling.fillOpacity;
        document.getElementById('opacityDisplay').textContent = Math.round(layer.styling.fillOpacity * 100) + '%';
    }
    
    updateStylePreview();
}

function loadLayerLabelling() {
    const layerId = document.getElementById('labelLayerSelector').value;
    if (!layerId) return;
    
    const layer = publicLayers.find(l => l.id === layerId);
    if (!layer) return;
    
    // Update label controls
    document.getElementById('enableLabels').checked = layer.labels.enabled || false;
    updateLabelOptions();
    
    // Load fields for labelling
    loadFieldsForLabelling();
}

async function loadFieldsForLabelling() {
    const layerId = document.getElementById('labelLayerSelector').value;
    const fieldSelect = document.getElementById('labelField');
    
    if (!layerId || !fieldSelect) return;
    
    try {
        const layer = publicLayers.find(l => l.id === layerId);
        if (!layer) return;
        
        // Get table fields
        const recordsData = await window.teableAPI.getRecords(layer.tableId, { limit: 1 });
        if (!recordsData.records || recordsData.records.length === 0) return;
        
        const fieldNames = Object.keys(recordsData.records[0].fields || {});
        
        fieldSelect.innerHTML = '<option value="">Select field for labels...</option>';
        fieldNames.forEach(fieldName => {
            const option = document.createElement('option');
            option.value = fieldName;
            option.textContent = fieldName;
            fieldSelect.appendChild(option);
        });
        
        // Restore previous selection
        if (layer.labels.field) {
            fieldSelect.value = layer.labels.field;
        }
        
    } catch (error) {
        console.error('Error loading fields for labelling:', error);
    }
}

async function generateCategorizedColors() {
    const layerId = document.getElementById('styleLayerSelector').value;
    const fieldName = document.getElementById('categorizedField').value;
    
    if (!layerId || !fieldName) {
        showError('Please select a layer and field for categorized styling.');
        return;
    }
    
    try {
        const layer = publicLayers.find(l => l.id === layerId);
        if (!layer) return;
        
        // Get unique values from the field
        const recordsData = await window.teableAPI.getRecords(layer.tableId, { limit: 100 });
        const records = recordsData.records || [];
        
        if (records.length === 0) {
            showError('No data found in the selected layer.');
            return;
        }
        
        // Extract unique values
        const uniqueValues = [...new Set(records.map(record => record.fields[fieldName]).filter(val => val != null))];
        
        if (uniqueValues.length === 0) {
            showError('No values found in the selected field.');
            return;
        }
        
        // Generate colors for each unique value
        const colors = generateColorPalette(uniqueValues.length);
        const categorizedRules = [];
        
        uniqueValues.forEach((value, index) => {
            categorizedRules.push({
                value: value,
                color: colors[index],
                label: String(value)
            });
        });
        
        // Update layer styling
        layer.styling = {
            ...layer.styling,
            type: 'categorized',
            field: fieldName,
            rules: categorizedRules
        };
        
        // Display the generated categories
        displayCategorizedRules(categorizedRules);
        
        hasUnsavedChanges = true;
        updateSaveIndicator();
        updatePublicLayersList();
        
        showSuccess(`Generated ${categorizedRules.length} categories for field "${fieldName}"`);
        
    } catch (error) {
        console.error('Error generating categorized colors:', error);
        showError('Failed to generate categorized colors: ' + error.message);
    }
}

function generateColorPalette(count) {
    const colors = [];
    const hueStep = 360 / count;
    
    for (let i = 0; i < count; i++) {
        const hue = (i * hueStep) % 360;
        const saturation = 70 + (i % 3) * 10; // Vary saturation slightly
        const lightness = 50 + (i % 2) * 10;  // Vary lightness slightly
        
        colors.push(hslToHex(hue, saturation, lightness));
    }
    
    return colors;
}

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function displayCategorizedRules(rules) {
    const container = document.getElementById('categorizedRulesList');
    if (!container) return;
    
    let html = '<div class="categorized-rules-list">';
    
    rules.forEach((rule, index) => {
        html += `
            <div class="categorized-rule-item d-flex align-items-center mb-2">
                <div class="color-preview me-3" style="width: 20px; height: 20px; background-color: ${rule.color}; border: 1px solid #ccc; border-radius: 3px;"></div>
                <div class="flex-grow-1">
                    <strong>${rule.label}</strong>
                    <small class="text-muted ms-2">(${rule.value})</small>
                </div>
                <input type="color" class="form-control form-control-color" value="${rule.color}" 
                       onchange="updateCategorizedRuleColor(${index}, this.value)" style="width: 40px; height: 30px;">
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

function updateCategorizedRuleColor(ruleIndex, newColor) {
    const layerId = document.getElementById('styleLayerSelector').value;
    const layer = publicLayers.find(l => l.id === layerId);
    
    if (layer && layer.styling.rules && layer.styling.rules[ruleIndex]) {
        layer.styling.rules[ruleIndex].color = newColor;
        
        hasUnsavedChanges = true;
        updateSaveIndicator();
        
        // Update the color preview
        const colorPreview = document.querySelectorAll('.color-preview')[ruleIndex];
        if (colorPreview) {
            colorPreview.style.backgroundColor = newColor;
        }
    }
}

async function saveAllConfigurations() {
    try {
        // Collect all configuration data
        const config = {
            general: {
                title: document.getElementById('mapTitle').value,
                description: document.getElementById('mapDescription').value,
                defaultBasemap: document.getElementById('defaultBasemap').value,
                defaultZoom: parseInt(document.getElementById('defaultZoom').value),
                centerLat: parseFloat(document.getElementById('centerLat').value),
                centerLng: parseFloat(document.getElementById('centerLng').value),
                enablePublicAccess: document.getElementById('enablePublicAccess').checked
            },
            features: {
                enableMeasurement: document.getElementById('enableMeasurement').checked,
                enableDistance: document.getElementById('enableDistance').checked,
                enableArea: document.getElementById('enableArea').checked,
                enableFiltering: document.getElementById('enableFiltering').checked,
                enableQuickSearch: document.getElementById('enableQuickSearch').checked,
                enableAdvancedFilters: document.getElementById('enableAdvancedFilters').checked,
                enableBasemapSwitcher: document.getElementById('enableBasemapSwitcher').checked,
                enableExport: document.getElementById('enableExport').checked,
                enablePopups: document.getElementById('enablePopups').checked,
                enableLegend: document.getElementById('enableLegend').checked,
                enableCoordinates: document.getElementById('enableCoordinates').checked
            },
            permissions: {
                allowPublicEditing: document.getElementById('allowPublicEditing').checked,
                allowPublicExport: document.getElementById('allowPublicExport').checked,
                allowPublicPrint: document.getElementById('allowPublicPrint').checked,
                enableMapSharing: document.getElementById('enableMapSharing').checked,
                enableEmbedding: document.getElementById('enableEmbedding').checked
            },
            layers: publicLayers,
            lastUpdated: new Date().toISOString(),
            updatedBy: currentUser.email
        };
        
        // Save to localStorage (in production, this would be saved to a database)
        localStorage.setItem('teable_map_config', JSON.stringify(config));
        
        // Log activity
        try {
            await window.teableAPI.logActivity(
                currentUser.email,
                'map_config_updated',
                'Updated public map configuration'
            );
        } catch (logError) {
            console.log('Failed to log activity:', logError.message);
        }
        
        mapConfig = config;
        hasUnsavedChanges = false;
        updateSaveIndicator();
        
        showSaveSuccess('All map configurations saved successfully!');
        
    } catch (error) {
        console.error('Error saving configuration:', error);
        showError('Failed to save configuration: ' + error.message);
    }
}

function updateSaveIndicator() {
    const indicator = document.getElementById('saveIndicator');
    
    if (hasUnsavedChanges) {
        indicator.innerHTML = `
            <div class="alert alert-warning alert-dismissible fade show">
                <i class="fas fa-exclamation-triangle me-2"></i>
                <span>You have unsaved changes</span>
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        indicator.style.display = 'block';
    } else {
        indicator.style.display = 'none';
    }
}

function showSaveSuccess(message) {
    const indicator = document.getElementById('saveIndicator');
    indicator.innerHTML = `
        <div class="alert alert-success alert-dismissible fade show">
            <i class="fas fa-check-circle me-2"></i>
            <span>${message}</span>
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;
    indicator.style.display = 'block';
    
    setTimeout(() => {
        indicator.style.display = 'none';
    }, 5000);
}

function previewPublicMap() {
    // Open public map in new window/tab
    const publicMapUrl = 'public-map.html';
    window.open(publicMapUrl, '_blank');
}

function updateStylePreview() {
    const fillColor = document.getElementById('fillColor').value;
    const borderColor = document.getElementById('borderColor').value;
    
    document.getElementById('fillPreview').style.background = fillColor;
    document.getElementById('borderPreview').style.background = borderColor;
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

// Make functions globally available
window.switchTab = switchTab;
window.updateZoomDisplay = updateZoomDisplay;
window.updatePreview = updatePreview;
window.updatePreviewCenter = updatePreviewCenter;
window.addCenterMarker = addCenterMarker;
window.centerToLayer = centerToLayer;
window.addPublicLayer = addPublicLayer;
window.savePublicLayer = savePublicLayer;
window.removePublicLayer = removePublicLayer;
window.loadLayerFields = loadLayerFields;
window.loadPopupFields = loadPopupFields;
window.updateLayerFieldVisibility = updateLayerFieldVisibility;
window.updateLayerPopupField = updateLayerPopupField;
window.updateFieldSelection = updateFieldSelection;
window.updateStylingType = updateStylingType;
window.loadLayerStyling = loadLayerStyling;
window.loadLayerLabelling = loadLayerLabelling;
window.generateCategorizedColors = generateCategorizedColors;
window.updateCategorizedRuleColor = updateCategorizedRuleColor;
window.saveAllConfigurations = saveAllConfigurations;
window.previewPublicMap = previewPublicMap;
window.updateStylePreview = updateStylePreview;