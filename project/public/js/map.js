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

// Base map configurations
const baseMaps = {
    openstreetmap: {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors'
    },
    satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '© Esri'
    },
    terrain: {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: '© OpenTopoMap contributors'
    },
    dark: {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '© CartoDB'
    }
};

// Current base layer reference
let currentBaseLayer = null;

document.addEventListener('DOMContentLoaded', function() {
    // Wait for all dependencies to load
    if (typeof window.teableAuth === 'undefined') {
        console.log('Waiting for auth to load...');
        setTimeout(() => {
            document.dispatchEvent(new Event('DOMContentLoaded'));
        }, 500);
        return;
    }

    // Initialize basic map first, then try to enhance with data if possible
    console.log('🚀 Starting map initialization...');
    initializeBasicMap();
    
    // Try to load additional features if auth and config are available
    setTimeout(() => {
        try {
            if (window.teableAuth && window.teableAuth.isLoggedIn()) {
                const clientConfig = window.teableAuth.clientConfig;
                if (clientConfig && clientConfig.baseUrl && clientConfig.accessToken && window.teableAPI) {
                    console.log('Enhancing map with data features...');
                    enhanceMapWithData();
                }
            }
        } catch (error) {
            console.log('Enhanced features not available:', error.message);
        }
    }, 1000);
});

function initializeBasicMap() {
    try {
        console.log('🗺️ Initializing map in basic mode...');

        // Set user display to show basic info
        const userDisplay = document.getElementById('userDisplay');
        if (userDisplay) {
            if (window.teableAuth && window.teableAuth.isLoggedIn()) {
                const session = window.teableAuth.getCurrentSession();
                userDisplay.textContent = `${session.firstName} ${session.lastName} (${session.role})`;
            } else {
                userDisplay.textContent = 'Guest User (Basic Mode)';
            }
        }

        // Initialize Leaflet map with India center view and proper zoom for India
        map = L.map('map').setView([20.5937, 78.9629], 5);

        // Add default base layer (OpenStreetMap) and store reference
        currentBaseLayer = L.tileLayer(baseMaps.openstreetmap.url, {
            attribution: baseMaps.openstreetmap.attribution
        }).addTo(map);

        // Set the default basemap selector value
        const basemapSelector = document.getElementById('basemapSelector');
        if (basemapSelector) {
            basemapSelector.value = 'openstreetmap';
        }

        // Initialize measurement group
        measurementGroup = L.layerGroup().addTo(map);

        // Setup drag and drop for GeoJSON
        setupGeoJSONDragDrop();

        // Show success message
        showSuccess('Map initialized successfully! You can switch basemaps and upload GeoJSON files.');

        console.log('✅ Basic map initialized successfully');

    } catch (error) {
        console.error('❌ Basic map initialization failed:', error);
        showError('Failed to initialize map: ' + error.message);
    }
}

async function enhanceMapWithData() {
    try {
        console.log('🔧 Enhancing map with data features...');
        
        const clientConfig = window.teableAuth.clientConfig;
        
        // Initialize API with client config
        if (window.teableAPI && typeof window.teableAPI.init === 'function') {
            window.teableAPI.init(clientConfig);
            console.log('✅ Teable API initialized');
            
            // Load available tables
            await loadAvailableTables();
            
            showInfo('Enhanced features loaded! You can now add layers from Teable tables.');
        }
        
    } catch (error) {
        console.warn('Could not enhance map with data features:', error.message);
        showWarning('Map is running in basic mode. Some features may not be available.');
    }
}

async function initializeMap() {
    try {
        currentUser = window.teableAuth.getCurrentSession();
        if (!currentUser) {
            throw new Error('No user session found');
        }

        document.getElementById('userDisplay').textContent = 
            `${currentUser.firstName} ${currentUser.lastName} (${currentUser.role})`;

        // Get client configuration
        const clientConfig = window.teableAuth.clientConfig;
        if (!clientConfig) {
            throw new Error('No client configuration found');
        }

        console.log('Initializing map with config:', {
            clientName: clientConfig.clientName,
            baseId: clientConfig.baseId,
            hasToken: !!clientConfig.accessToken
        });

        // Initialize API with client config - do this for all users
        if (window.teableAPI && clientConfig && typeof window.teableAPI.init === 'function') {
            try {
                window.teableAPI.init(clientConfig);
                console.log('✅ Teable API initialized');
            } catch (initError) {
                console.error('Failed to initialize Teable API:', initError);
                console.warn('Falling back to basic map mode...');
                initializeBasicMap();
                return;
            }
        } else {
            console.warn('Teable API not available or client configuration missing - initializing basic map');
            initializeBasicMap();
            return;
        }

        // Initialize Leaflet map with India center view and proper zoom for India
        map = L.map('map').setView([20.5937, 78.9629], 5);

        // Add default base layer (OpenStreetMap) and store reference
        currentBaseLayer = L.tileLayer(baseMaps.openstreetmap.url, {
            attribution: baseMaps.openstreetmap.attribution
        }).addTo(map);

        // Set the default basemap selector value
        const basemapSelector = document.getElementById('basemapSelector');
        if (basemapSelector) {
            basemapSelector.value = 'openstreetmap';
        }

        // Initialize measurement group
        measurementGroup = L.layerGroup().addTo(map);

        // Load available tables after API is properly initialized
        await loadAvailableTables();

        // Setup drag and drop for GeoJSON
        setupGeoJSONDragDrop();

        console.log('✅ Map initialized successfully with India center view');

    } catch (error) {
        console.error('❌ Map initialization failed:', error);
        showError('Failed to initialize map: ' + error.message);
    }
}

async function loadAvailableTables() {
    try {
        // Check if API is available and properly configured
        if (!window.teableAPI) {
            console.warn('Teable API not available, skipping table loading');
            return;
        }

        // Check if client config is available
        const clientConfig = window.teableAuth?.clientConfig;
        if (!clientConfig || !clientConfig.baseUrl || !clientConfig.accessToken || !clientConfig.baseId) {
            console.warn('Client configuration not complete, skipping table loading');
            const tableSelector = document.getElementById('newLayerTable');
            if (tableSelector) {
                tableSelector.innerHTML = '<option value="">Please configure Teable connection first</option>';
            }
            showError('Please set up your Teable configuration first by visiting the Configuration page.');
            return;
        }

        // Ensure API is initialized with proper config
        window.teableAPI.init(clientConfig);

        console.log('Loading tables with config:', {
            baseUrl: clientConfig.baseUrl,
            baseId: clientConfig.baseId,
            hasToken: !!clientConfig.accessToken
        });

        const tablesData = await window.teableAPI.getTables();
        const tables = tablesData.tables || tablesData || [];

        console.log('Raw tables response:', tables);

        // Filter out system tables
        const userTables = tables.filter(t => 
            !t.name.startsWith('app_') && 
            !t.name.startsWith('field_') && 
            !t.name.startsWith('system_') &&
            t.name !== 'data_change_logs'
        );

        // Populate table selector
        const tableSelector = document.getElementById('newLayerTable');
        if (tableSelector) {
            tableSelector.innerHTML = '<option value="">Select table...</option>';

            userTables.forEach(table => {
                const option = document.createElement('option');
                option.value = table.id;
                option.textContent = table.name;
                tableSelector.appendChild(option);
            });

            // Auto-trigger field loading when table is selected
            tableSelector.addEventListener('change', loadTableFields);
        }

        console.log(`✅ Loaded ${userTables.length} available tables`);

    } catch (error) {
        console.error('❌ Error loading tables:', error);
        showError('Failed to load tables: ' + error.message);

        // Show error in selector
        const tableSelector = document.getElementById('newLayerTable');
        if (tableSelector) {
            tableSelector.innerHTML = '<option value="">Error loading tables</option>';
        }
    }
}

async function loadTableFields() {
    const tableId = document.getElementById('newLayerTable').value;
    const geometrySelector = document.getElementById('newLayerGeometry');
    const linkedTablesInfo = document.getElementById('linkedTablesInfo');

    if (!tableId) {
        if (geometrySelector) {
            geometrySelector.innerHTML = '<option value="">Auto-detect...</option>';
        }
        if(linkedTablesInfo) {
            linkedTablesInfo.innerHTML = 'Select a table to see linked information';
        }
        return;
    }

    try {
        // Check if API is available
        if (!window.teableAPI) {
            console.warn('Teable API not available');
            if (geometrySelector) {
                geometrySelector.innerHTML = '<option value="">API not available</option>';
            }
            return;
        }

        // Show loading indicator
        if (geometrySelector) {
            geometrySelector.innerHTML = '<option value="">Loading fields...</option>';
        }
        if (linkedTablesInfo) {
            linkedTablesInfo.innerHTML = 'Loading table information...';
        }

        // Get sample records to detect fields
        const recordsData = await window.teableAPI.getRecords(tableId, { limit: 10 });

        if (recordsData.records && recordsData.records.length > 0) {
            const fields = Object.keys(recordsData.records[0].fields || {});

            // Enhanced geometry field detection
            let detectedGeometryField = null;
            let confidence = 0;

            const geometryFieldCandidates = fields.map(field => {
                const fieldLower = field.toLowerCase();
                let score = 0;

                // Primary geometry field indicators
                if (fieldLower === 'geometry' || fieldLower === 'geom') score += 10;
                if (fieldLower === 'wkt' || fieldLower === 'shape') score += 9;
                if (fieldLower.includes('polygon') || fieldLower.includes('point')) score += 8;
                if (fieldLower.includes('coordinates') || fieldLower.includes('location')) score += 7;

                // Secondary indicators
                if (fieldLower.includes('geom')) score += 5;
                if (fieldLower.includes('wkt')) score += 5;
                if (fieldLower.includes('shape')) score += 4;

                return { field, score };
            }).filter(item => item.score > 0)
              .sort((a, b) => b.score - a.score);

            if (geometryFieldCandidates.length > 0) {
                detectedGeometryField = geometryFieldCandidates[0].field;
                confidence = geometryFieldCandidates[0].score;
            }

            // Verify the detected field contains valid geometry data
            if (detectedGeometryField) {
                const sampleGeometry = recordsData.records[0].fields[detectedGeometryField];
                if (sampleGeometry && typeof sampleGeometry === 'string') {
                    const upperGeometry = sampleGeometry.toUpperCase().trim();
                    if (!upperGeometry.startsWith('POINT') && 
                        !upperGeometry.startsWith('POLYGON') && 
                        !upperGeometry.startsWith('MULTIPOLYGON') &&
                        !upperGeometry.startsWith('LINESTRING') &&
                        !upperGeometry.startsWith('MULTIPOINT')) {
                        console.warn('Detected geometry field may not contain valid WKT data');
                        confidence = Math.max(1, confidence - 3);
                    }
                }
            }

            // Populate geometry field selector
            if (geometrySelector) {
                geometrySelector.innerHTML = '<option value="">Auto-detect...</option>';
                fields.forEach(field => {
                    const option = document.createElement('option');
                    option.value = field;
                    option.textContent = field;
                    if (field === detectedGeometryField) {
                        option.selected = true;
                    }
                    geometrySelector.appendChild(option);
                });

                if (detectedGeometryField) {
                    const confidenceText = confidence >= 8 ? 'High' : confidence >= 5 ? 'Medium' : 'Low';
                    showSuccess(`Auto-detected geometry field: ${detectedGeometryField} (${confidenceText} confidence)`);
                }
            }

            if (linkedTablesInfo) {
                const hasGeometry = detectedGeometryField ? 'Yes' : 'No';
                linkedTablesInfo.innerHTML = `
                    <div class="small">
                        <strong>Records Found:</strong> ${recordsData.records.length}<br>
                        <strong>Available Fields:</strong> ${fields.length}<br>
                        <strong>Geometry Field:</strong> ${detectedGeometryField || 'Not detected'}<br>
                        <strong>Has Geometry:</strong> <span class="${hasGeometry === 'Yes' ? 'text-success' : 'text-warning'}">${hasGeometry}</span><br>
                        <strong>Sample Fields:</strong> ${fields.slice(0, 5).join(', ')}${fields.length > 5 ? '...' : ''}
                    </div>
                `;
            }
        } else {
            if (geometrySelector) {
                geometrySelector.innerHTML = '<option value="">No data found</option>';
            }
            if (linkedTablesInfo) {
                linkedTablesInfo.innerHTML = '<span class="text-warning">No records found in this table</span>';
            }
        }

    } catch (error) {
        console.error('Error loading table fields:', error);
        if (geometrySelector) {
            geometrySelector.innerHTML = '<option value="">Error loading fields</option>';
        }
        if (linkedTablesInfo) {
            linkedTablesInfo.innerHTML = '<span class="text-danger">Error loading table information</span>';
        }
        showError('Failed to load table fields: ' + error.message);
    }
}

function showAddLayerModal() {
    const modal = new bootstrap.Modal(document.getElementById('addLayerModal'));
    modal.show();
}

async function addNewLayer() {
    const activeTab = document.querySelector('#layerSourceTabs .nav-link.active').id;

    if (activeTab === 'table-tab') {
        await addLayerFromTable();
    } else if (activeTab === 'geojson-tab') {
        await uploadGeoJSON();
    }
}

async function addLayerFromTable() {
    try {
        const tableId = document.getElementById('newLayerTable').value;
        const layerName = document.getElementById('newLayerName').value.trim();
        const layerColor = document.getElementById('newLayerColor').value;
        const geometryField = document.getElementById('newLayerGeometry').value;

        if (!tableId || !layerName) {
            throw new Error('Please select a table and enter a layer name');
        }

        // Check if API is available
        if (!window.teableAPI) {
            throw new Error('Teable API not available. Please check your configuration.');
        }

        // Get table data
        const recordsData = await window.teableAPI.getRecords(tableId, { limit: 1000 });
        const records = recordsData.records || [];

        if (records.length === 0) {
            throw new Error('No data found in the selected table');
        }

        // Auto-detect geometry field if not specified
        let detectedGeometryField = geometryField;
        if (!detectedGeometryField) {
            const sampleFields = Object.keys(records[0].fields || {});
            const geometryFieldCandidates = sampleFields.filter(field => {
                const fieldLower = field.toLowerCase();
                return fieldLower.includes('geom') || 
                       fieldLower.includes('wkt') || 
                       fieldLower.includes('shape') ||
                       fieldLower.includes('polygon') ||
                       fieldLower.includes('point') ||
                       fieldLower.includes('coordinates') ||
                       fieldLower.includes('geometry');
            });

            if (geometryFieldCandidates.length > 0) {
                detectedGeometryField = geometryFieldCandidates[0];
            } else {
                throw new Error('No geometry field found. Please specify the geometry field manually.');
            }
        }

        // Create layer
        const layer = await createLayerFromData(records, {
            id: Date.now().toString(),
            name: layerName,
            tableId: tableId,
            geometryField: detectedGeometryField,
            color: layerColor,
            visible: true,
            type: 'table'
        });

        if (layer) {
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('addLayerModal'));
            modal.hide();

            // Clear form
            document.getElementById('newLayerTable').value = '';
            document.getElementById('newLayerName').value = '';
            document.getElementById('newLayerColor').value = '#3498db';
            document.getElementById('newLayerGeometry').value = '';

            // Auto-zoom to the new layer
            if (layer.bounds) {
                setTimeout(() => {
                    map.fitBounds(layer.bounds.pad(0.1));
                    showSuccess(`Layer "${layerName}" added and zoomed to extent!`);
                }, 500);
            } else {
                showSuccess('Layer added successfully!');
            }

            updateLayersList();
            updateMapStatistics();
        }

    } catch (error) {
        console.error('Error adding layer:', error);
        showError('Failed to add layer: ' + error.message);
    }
}

async function createLayerFromData(records, layerConfig) {
    try {
        const features = [];
        let validFeatureCount = 0;

        records.forEach((record, index) => {
            const geometry = record.fields[layerConfig.geometryField];

            if (geometry && typeof geometry === 'string') {
                try {
                    const leafletGeometry = parseWKTToLeaflet(geometry);

                    if (leafletGeometry) {
                        if (leafletGeometry.lat && leafletGeometry.lng) {
                            // Point geometry
                            const marker = L.marker([leafletGeometry.lat, leafletGeometry.lng], {
                                color: layerConfig.color
                            });

                            const popupContent = createFeaturePopup(record.fields, layerConfig);
                            marker.bindPopup(popupContent);
                            marker.recordId = record.id;
                            marker.recordData = record.fields;
                            marker.layerId = layerConfig.id;
                            marker.featureIndex = index;

                            // Add click handler for selection
                            marker.on('click', function(e) {
                                // Store reference for popup controls
                                window.currentPopupFeature = this;
                                handleFeatureClick(this, index, layerConfig);
                            });

                            features.push(marker);
                            validFeatureCount++;

                        } else if (Array.isArray(leafletGeometry)) {
                            // Polygon geometry
                            leafletGeometry.forEach((polygonCoords) => {
                                if (Array.isArray(polygonCoords) && polygonCoords.length > 0) {
                                    try {
                                        const polygon = L.polygon(polygonCoords, {
                                            fillColor: layerConfig.color,
                                            color: layerConfig.color,
                                            weight: 2,
                                            fillOpacity: 0.7
                                        });

                                        const popupContent = createFeaturePopup(record.fields, layerConfig);
                                        polygon.bindPopup(popupContent);
                                        polygon.recordId = record.id;
                                        polygon.recordData = record.fields;
                                        polygon.layerId = layerConfig.id;
                                        polygon.featureIndex = index;

                                        // Add click handler for selection
                                        polygon.on('click', function(e) {
                                            // Store reference for popup controls
                                            window.currentPopupFeature = this;
                                            handleFeatureClick(this, index, layerConfig);
                                        });

                                        features.push(polygon);
                                        validFeatureCount++;
                                    } catch (polygonError) {
                                        console.warn(`Error creating polygon for record ${index}:`, polygonError);
                                    }
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.error(`Error parsing geometry for record ${index}:`, error);
                }
            }
        });

        if (features.length === 0) {
            throw new Error('No valid geometry features found in the data');
        }

        // Create layer group
        const layerGroup = L.layerGroup(features);

        // Store layer configuration
        const layer = {
            ...layerConfig,
            leafletLayer: layerGroup,
            features: features,
            records: records,
            featureCount: validFeatureCount,
            bounds: null,
            properties: {
                symbology: {
                    type: 'single',
                    fillColor: layerConfig.color,
                    borderColor: layerConfig.color,
                    fillOpacity: 0.7,
                    borderWidth: 2
                },
                labels: {
                    enabled: false,
                    field: '',
                    fontSize: 12,
                    color: '#333333',
                    background: true
                },
                popup: {
                    enabled: true,
                    fields: Object.keys(records[0].fields || {}).filter(field => field !== layerConfig.geometryField),
                    maxWidth: 300
                }
            }
        };

        // Calculate bounds
        if (features.length > 0) {
            try {
                const group = new L.featureGroup(features);
                layer.bounds = group.getBounds();
            } catch (error) {
                console.error('Error calculating layer bounds:', error);
                layer.bounds = null;
            }
        }

        // Add to map if visible
        if (layerConfig.visible) {
            layerGroup.addTo(map);
        }

        // Add to layers array
        mapLayers.push(layer);

        console.log(`Created layer "${layerConfig.name}" with ${validFeatureCount} features`);
        return layer;

    } catch (error) {
        console.error('Error creating layer:', error);
        throw error;
    }
}

function createFeaturePopup(fields, layerConfig) {
    const popupSettings = layerConfig.properties?.popup || {};
    const template = popupSettings.template || 'default';
    const maxWidth = popupSettings.maxWidth || 300;
    const maxFieldLength = popupSettings.maxFieldLength || 100;
    const showEmptyFields = popupSettings.showEmptyFields || false;
    const showFieldIcons = popupSettings.showFieldIcons !== false;
    const highlightLinks = popupSettings.highlightLinks !== false;
    const showCopyButtons = popupSettings.showCopyButtons || false;
    const enableSearch = popupSettings.enableSearch || false;

    let content = `<div class="feature-popup" style="max-width: ${maxWidth}px;">`;

    // Popup header
    content += `<div class="popup-header d-flex justify-content-between align-items-center mb-2">`;
    content += `<h6 class="popup-title mb-0">${layerConfig.name}</h6>`;

    // Add search if enabled
    if (enableSearch) {
        content += `<input type="text" class="form-control form-control-sm" placeholder="Search..." 
                   onkeyup="filterPopupFields(this.value)" style="width: 120px;">`;
    }
    content += `</div>`;

    // Get fields to display - only show selected fields if configured
    const allFields = Object.keys(fields).filter(field => field !== layerConfig.geometryField);
    const selectedFields = layerConfig.properties?.popup?.fields;
    const isPopupConfigured = layerConfig.properties?.popup?.configured === true;

    let fieldsToShow = [];

    // Check if popup fields have been specifically configured
    if (selectedFields && Array.isArray(selectedFields)) {
        // Only show the specifically selected fields, even if the array is empty
        fieldsToShow = selectedFields.filter(field => 
            field !== layerConfig.geometryField && 
            allFields.includes(field) &&
            fields.hasOwnProperty(field)
        );
        console.log(`Popup configured for layer "${layerConfig.name}": showing ${fieldsToShow.length} selected fields:`, fieldsToShow);
    } else {
        // If popup fields haven't been configured yet, show all fields
        fieldsToShow = allFields;
        console.log(`Popup not configured for layer "${layerConfig.name}": showing all ${fieldsToShow.length} fields`);
    }

    // Apply template
    if (template === 'custom' && popupSettings.customTemplate) {
        content += renderCustomTemplate(popupSettings.customTemplate, fields, fieldsToShow);
    } else if (template === 'table') {
        content += renderTableTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength);
    } else if (template === 'card') {
        content += renderCardTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength);
    } else {
        content += renderDefaultTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength);
    }

    // Add controls if enabled
    const controls = popupSettings.controls || {};
    if (controls.showZoomControls !== false || controls.showCenterControl !== false || 
        controls.showExportControl || controls.showEditControl) {
        content += createPopupControls(controls);
    }

    content += '</div>';
    return content;
}

function renderDefaultTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength) {
    let content = '<div class="popup-fields">';

    fieldsToShow.forEach(key => {
        let value = fields[key];

        // Skip empty fields if not showing them
        if (!showEmptyFields && (value === null || value === undefined || value === '')) {
            return;
        }

        // Format value
        const formattedValue = formatFieldValue(value, highlightLinks, maxFieldLength);
        const fieldType = getFieldType(value);
        const fieldIcon = showFieldIcons ? `<i class="${getFieldIcon(fieldType)} me-2"></i>` : '';

        content += `<div class="popup-field d-flex align-items-start mb-2" data-field="${key}">`;
        content += `<div class="field-label flex-shrink-0 me-2"><strong>${fieldIcon}${key}:</strong></div>`;
        content += `<div class="field-value flex-grow-1">${formattedValue}</div>`;

        if (showCopyButtons) {
            content += `<button class="btn btn-xs btn-outline-secondary ms-1" onclick="copyToClipboard('${value}')" title="Copy">
                        <i class="fas fa-copy"></i></button>`;
        }
        content += `</div>`;
    });

    if (fieldsToShow.length === 0) {
        content += `<div class="text-muted text-center py-2"><em>No fields selected for display</em></div>`;
    }

    content += '</div>';
    return content;
}

function renderTableTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength) {
    let content = '<div class="popup-table-wrapper" style="max-height: 300px; overflow-y: auto;">';
    content += '<table class="table table-sm table-bordered mb-0">';

    fieldsToShow.forEach(key => {
        let value = fields[key];

        if (!showEmptyFields && (value === null || value === undefined || value === '')) {
            return;
        }

        const formattedValue = formatFieldValue(value, highlightLinks, maxFieldLength);
        const fieldType = getFieldType(value);
        const fieldIcon = showFieldIcons ? `<i class="${getFieldIcon(fieldType)} me-1"></i>` : '';

        content += `<tr data-field="${key}">`;
        content += `<td class="fw-bold" style="width: 40%;">${fieldIcon}${key}</td>`;
        content += `<td>${formattedValue}`;

        if (showCopyButtons) {
            content += ` <button class="btn btn-xs btn-outline-secondary float-end" onclick="copyToClipboard('${value}')" title="Copy">
                        <i class="fas fa-copy"></i></button>`;
        }
        content += `</td></tr>`;
    });

    content += '</table></div>';
    return content;
}

function renderCardTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength) {
    let content = '<div class="popup-cards">';

    fieldsToShow.forEach(key => {
        let value = fields[key];

        if (!showEmptyFields && (value === null || value === undefined || value === '')) {
            return;
        }

        const formattedValue = formatFieldValue(value, highlightLinks, maxFieldLength);
        const fieldType = getFieldType(value);
        const fieldIcon = showFieldIcons ? `<i class="${getFieldIcon(fieldType)} me-2"></i>` : '';

        content += `<div class="card mb-2" data-field="${key}">`;
        content += `<div class="card-body p-2">`;
        content += `<h6 class="card-title mb-1">${fieldIcon}${key}</h6>`;
        content += `<div class="card-text">${formattedValue}`;

        if (showCopyButtons) {
            content += ` <button class="btn btn-xs btn-outline-secondary float-end" onclick="copyToClipboard('${value}')" title="Copy">
                        <i class="fas fa-copy"></i></button>`;
        }
        content += `</div></div></div>`;
    });

    content += '</div>';
    return content;
}

function renderCustomTemplate(template, fields, fieldsToShow) {
    let content = template;

    // Replace field placeholders
    fieldsToShow.forEach(field => {
        const placeholder = `{{${field}}}`;
        const value = formatFieldValue(fields[field], true, 200);
        content = content.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    });

    return content;
}

function formatFieldValue(value, highlightLinks, maxLength) {
    if (value === null || value === undefined) {
        return '<em class="text-muted">No data</em>';
    }

    if (value === '') {
        return '<em class="text-muted">Empty</em>';
    }

    let formattedValue = String(value);

    // Truncate if too long
    if (maxLength && formattedValue.length > maxLength) {
        formattedValue = formattedValue.substring(0, maxLength) + '...';
    }

    // Highlight links
    if (highlightLinks && typeof value === 'string') {
        if (value.match(/^https?:\/\//)) {
            formattedValue = `<a href="${value}" target="_blank" class="text-primary">${formattedValue}</a>`;
        } else if (value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
            formattedValue = `<a href="mailto:${value}" class="text-primary">${formattedValue}</a>`;
        }
    }

    return formattedValue;
}

function createPopupControls(controls) {
    let content = '<div class="popup-controls mt-3 pt-2 border-top">';
    content += '<div class="d-flex gap-1 flex-wrap">';

    if (controls.showZoomControls !== false) {
        content += `
            <button class="btn btn-xs btn-outline-primary" onclick="window.zoomToCurrentPopupFeature('close')" title="Zoom Close">
                <i class="fas fa-search-plus"></i>
            </button>
            <button class="btn btn-xs btn-outline-secondary" onclick="window.zoomToCurrentPopupFeature('medium')" title="Zoom Medium">
                <i class="fas fa-search"></i>
            </button>
        `;
    }

    if (controls.showCenterControl !== false) {
        content += `
            <button class="btn btn-xs btn-outline-info" onclick="window.centerCurrentPopupFeature()" title="Center">
                <i class="fas fa-crosshairs"></i>
            </button>
        `;
    }

    if (controls.showExportControl) {
        content += `
            <button class="btn btn-xs btn-outline-success" onclick="exportCurrentFeature()" title="Export Feature">
                <i class="fas fa-download"></i>
            </button>
        `;
    }

    if (controls.showEditControl) {
        content += `
            <button class="btn btn-xs btn-outline-warning" onclick="editCurrentFeature()" title="Edit Feature">
                <i class="fas fa-edit"></i>
            </button>
        `;
    }

    content += '</div></div>';
    return content;
}

// Parse WKT to Leaflet coordinates
function parseWKTToLeaflet(wkt) {
    try {
        if (!wkt || typeof wkt !== 'string') {
            return null;
        }

        const upperWKT = wkt.toUpperCase().trim();

        if (upperWKT.startsWith('MULTIPOLYGON')) {
            return parseMultiPolygon(wkt);
        } else if (upperWKT.startsWith('POLYGON')) {
            return parsePolygon(wkt);
        } else if (upperWKT.startsWith('POINT')) {
            return parsePoint(wkt);
        }else if (upperWKT.startsWith('MULTIPOINT')) {
            return parseMultiPoint(wkt);
        }else if (upperWKT.startsWith('LINESTRING')) {
            return parseLineString(wkt);
        } else if (upperWKT.startsWith('MULTILINESTRING')) {
            return parseMultiLineString(wkt);
        }

        return null;
    } catch (error) {
        console.error('Error parsing WKT:', error);
        return null;
    }
}

function parseMultiPolygon(wkt) {
    try {
        let cleanWkt = wkt.replace(/^MULTIPOLYGON\s*\(\s*\(/i, '').replace(/\)\s*\)$/, '');
        const polygonStrings = cleanWkt.split(')),((');

        return polygonStrings.map(polygonString => {
            const cleanPolygon = polygonString.replace(/^\(+/, '').replace(/\)+$/, '');
            return parsePolygonRings(cleanPolygon);
        }).filter(polygon => polygon !== null);
    } catch (error) {
        console.error('Error parsing MULTIPOLYGON:', error);
        return null;
    }
}

function parsePolygon(wkt) {
    try {
        let cleanWkt = wkt.replace(/^POLYGON\s*\(/i, '').replace(/\)$/, '');
        return [parsePolygonRings(cleanWkt)];
    } catch (error) {
        console.error('Error parsing POLYGON:', error);
        return null;
    }
}

function parsePolygonRings(polygonString) {
    try {
        const rings = polygonString.split('),(');

        return rings.map(ring => {
            const cleanRing = ring.replace(/^\(+/, '').replace(/\)+$/, '');
            const coords = cleanRing.split(',');

            const validCoords = coords.map(coord => {
                const parts = coord.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const lon = parseFloat(parts[0]);
                    const lat = parseFloat(parts[1]);

                    if (!isNaN(lat) && !isNaN(lon) && 
                        lat >= -90 && lat <= 90 && 
                        lon >= -180 && lon <= 180) {
                        return [lat, lon]; // Leaflet format: [lat, lon]
                    }
                }
                return null;
            }).filter(coord => coord !== null);

            if (validCoords.length >= 3) {
                const first = validCoords[0];
                const last = validCoords[validCoords.length - 1];

                if (first[0] !== last[0] || first[1] !== last[1]) {
                    validCoords.push([first[0], first[1]]);
                }

                return validCoords;
            }
            return null;
        }).filter(ring => ring && ring.length >= 4);
    } catch (error) {
        console.error('Error parsing polygon rings:', error);
        return null;
    }
}

function parsePoint(wkt) {
    try {
        const coordString = wkt.replace(/^POINT\s*\(/i, '').replace(/\)$/, '');
        const parts = coordString.trim().split(/\s+/);

        if (parts.length >= 2) {
            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);

            if (!isNaN(lat) && !isNaN(lon) && 
                lat >= -90 && lat <= 90 && 
                lon >= -180 && lon <= 180) {
                return { lat: lat, lng: lon };
            }
        }

        return null;
    } catch (error) {
        console.error('Error parsing POINT:', error);
        return null;
    }
}

function parseMultiPoint(wkt) {
    try {
        let cleanWkt = wkt.replace(/^MULTIPOINT\s*\(/i, '').replace(/\)$/, '');
        const pointStrings = cleanWkt.split(/\),\s*\(|\),\s*(?=\d)|\s*,\s*(?=\d)/);

        return pointStrings.map(pointString => {
            const cleanPoint = pointString.replace(/^\(+/, '').replace(/\)+$/, '');
            const parts = cleanPoint.trim().split(/\s+/);

            if (parts.length >= 2) {
                const lon = parseFloat(parts[0]);
                const lat = parseFloat(parts[1]);

                if (!isNaN(lat) && !isNaN(lon)) {
                    return { lat: lat, lng: lon };
                }
            }
            return null;
        }).filter(point => point !== null);
    } catch (error) {
        console.error('Error parsing MULTIPOINT:', error);
        return null;
    }
}

function parseLineString(wkt) {
    try {
        const coordString = wkt.replace(/^LINESTRING\s*\(/i, '').replace(/\)$/, '');
        const coords = coordString.split(',');

        return coords.map(coord => {
            const parts = coord.trim().split(/\s+/);
            if (parts.length >= 2) {
                const lon = parseFloat(parts[0]);
                const lat = parseFloat(parts[1]);

                // Validate coordinate ranges
                if (!isNaN(lat) && !isNaN(lon) && 
                    lat >= -90 && lat <= 90 && 
                    lon >= -180 && lon <= 180) {
                    return [lat, lon];
                }
            }
            return null;
        }).filter(coord => coord !== null);
    } catch (error) {
        console.error('Error parsing LINESTRING:', error);
        return null;
    }
}

function parseMultiLineString(wkt) {
    try {
        let cleanWkt = wkt.replace(/^MULTILINESTRING\s*\(/i, '').replace(/\)$/, '');
        const lineStrings = cleanWkt.split('),(');

        return lineStrings.map(lineString => {
            const cleanLine = lineString.replace(/^\(+/, '').replace(/\)+$/, '');
            const coords = cleanLine.split(',');

            return coords.map(coord => {
                const parts = coord.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const lon = parseFloat(parts[0]);
                    const lat = parseFloat(parts[1]);

                    if (!isNaN(lat) && !isNaN(lon)) {
                        return [lat, lon];
                    }
                }
                return null;
            }).filter(coord => coord !== null);
        }).filter(line => line.length > 0);
    } catch (error) {
        console.error('Error parsing MULTILINESTRING:', error);
        return null;
    }
}

function updateLayersList() {
    const container = document.getElementById('layersList');

    if (!container) return;

    if (mapLayers.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-3">
                <i class="fas fa-layer-group fa-2x mb-2"></i>
                <p>No layers added yet</p>
                <small>Use "Add Layer" to get started</small>
            </div>
        `;
        return;
    }

    let html = '';
    mapLayers.forEach((layer, index) => {
        const visibilityIcon = layer.visible ? 'fa-eye text-success' : 'fa-eye-slash text-muted';
        const geometryIcon = getGeometryIcon(layer.type);

        html += `
            <div class="layer-item ${layer.visible ? 'active' : ''}" data-layer-id="${layer.id}">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-1">
                            <i class="fas ${visibilityIcon} me-2" onclick="toggleLayerVisibility('${layer.id}')"></i>
                            <i class="${geometryIcon} me-2"></i>
                            <strong>${layer.name}</strong>
                        </div>
                        <div class="small text-muted">
                            ${layer.featureCount} features • ${layer.type}
                        </div>
                    </div>
                    <div class="layer-controls">
                        <button class="btn-zoom" onclick="zoomToLayer('${layer.id}')" title="Zoom to Layer">
                            <i class="fas fa-search-plus"></i>
                        </button>
                        <button class="btn-table" onclick="showAttributeTable('${layer.id}')" title="Attribute Table">
                            <i class="fas fa-table"></i>
                        </button>
                        <button class="btn-properties" onclick="showLayerProperties('${layer.id}')" title="Properties">
                            <i class="fas fa-cog"></i>
                        </button>
                        <button class="btn-remove" onclick="removeLayer('${layer.id}')" title="Remove Layer">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function getGeometryIcon(type) {
    switch (type) {
        case 'point': return 'fas fa-map-marker-alt text-danger';
        case 'line': return 'fas fa-route text-warning';
        case 'polygon': return 'fas fa-draw-polygon text-info';
        default: return 'fas fa-layer-group text-primary';
    }
}

function toggleLayerVisibility(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) return;

    if (layer.visible) {
        map.removeLayer(layer.leafletLayer);
        // Also hide labels when layer is hidden
        if (layer.labelGroup) {
            map.removeLayer(layer.labelGroup);
        }
        layer.visible = false;
    } else {
        layer.leafletLayer.addTo(map);
        // Show labels when layer is shown (if labels are enabled)
        if (layer.labelGroup && layer.properties?.labels?.enabled) {
            layer.labelGroup.addTo(map);
        }
        layer.visible = true;
    }

    updateLayersList();
    updateMapStatistics();
}

function zoomToLayer(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) return;

    if (layer.bounds) {
        map.fitBounds(layer.bounds.pad(0.1));
    }

    showSuccess(`Zoomed to layer: ${layer.name}`);
}

function showAttributeTable(layerId) {
    showInfo('Attribute table functionality would be implemented here');
}

function showLayerProperties(layerId) {
    showInfo('Layer properties functionality would be implemented here');
}

function removeLayer(layerId) {
    const layerIndex = mapLayers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) return;

    const layer = mapLayers[layerIndex];

    if (confirm(`Are you sure you want to remove layer "${layer.name}"?`)) {
        // Remove from map
        if (layer.leafletLayer) {
            map.removeLayer(layer.leafletLayer);
        }

        // Remove from array
        mapLayers.splice(layerIndex, 1);

        updateLayersList();
        showSuccess(`Layer "${layer.name}" removed successfully`);
    }
}

// Basemap functionality
function changeBasemap() {
    const basemapType = document.getElementById('basemapSelector').value;

    // Remove current base layer if it exists
    if (currentBaseLayer) {
        map.removeLayer(currentBaseLayer);
    }

    // Add new base layer
    const basemap = baseMaps[basemapType];
    if (basemap) {
        currentBaseLayer = L.tileLayer(basemap.url, {
            attribution: basemap.attribution
        }).addTo(map);

        showSuccess(`Switched to ${basemapType} basemap`);
        console.log(`Basemap changed to: ${basemapType}`);
    } else {
        showError(`Basemap type "${basemapType}" not found`);
    }
}

// Section toggle functionality
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

// GeoJSON drag and drop setup
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

function handleGeoJSONFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.geojson') && !file.name.toLowerCase().endsWith('.json')) {
        showError('Please select a valid GeoJSON file (.geojson or .json)');
        return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
        showError('File size too large. Please select a file smaller than 10MB.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            geoJSONData = JSON.parse(e.target.result);

            // Validate GeoJSON
            if (!geoJSONData.type || geoJSONData.type !== 'FeatureCollection') {
                throw new Error('Invalid GeoJSON format. Expected FeatureCollection.');
            }

            // Show preview
            showGeoJSONPreview(geoJSONData);

        } catch (error) {
            showError('Error parsing GeoJSON file: ' + error.message);
        }
    };

    reader.readAsText(file);
}

function showGeoJSONPreview(data) {
    const preview = document.getElementById('geoJSONPreview');
    const info = document.getElementById('geoJSONInfo');
    const uploadBtn = document.getElementById('uploadGeoJSONBtn');

    if (!preview || !info || !uploadBtn) return;

    const featureCount = data.features ? data.features.length : 0;
    const geometryTypes = new Set();

    if (data.features) {
        data.features.forEach(feature => {
            if (feature.geometry && feature.geometry.type) {
                geometryTypes.add(feature.geometry.type);
            }
        });
    }

    info.innerHTML = `
        <strong>Features:</strong> ${featureCount}<br>
        <strong>Geometry Types:</strong> ${Array.from(geometryTypes).join(', ')}<br>
        <strong>File Size:</strong> ${(JSON.stringify(data).length / 1024).toFixed(1)} KB
    `;

    preview.style.display = 'block';
    uploadBtn.disabled = false;
    uploadBtn.style.display = 'inline-block';

    const addLayerBtn = document.getElementById('addLayerBtn');
    if (addLayerBtn) {
        addLayerBtn.style.display = 'none';
    }
}

async function uploadGeoJSON() {
    showInfo('GeoJSON upload functionality would be implemented here');
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

// Export/fullscreen functionality
function exportMap() {
    showInfo('Map export functionality would be implemented here');
}

function fullscreenMap() {
    const mapContainer = document.querySelector('.app-container');

    if (!document.fullscreenElement) {
        mapContainer.requestFullscreen().then(() => {
            // Invalidate map size after entering fullscreen
            setTimeout(() => {
                map.invalidateSize();
            }, 100);
            showSuccess('Entered fullscreen mode');
        }).catch(err => {
            console.error('Error entering fullscreen:', err);
            showError('Failed to enter fullscreen mode');
        });
    } else {
        document.exitFullscreen().then(() => {
            // Invalidate map size after exiting fullscreen
            setTimeout(() => {
                map.invalidateSize();
            }, 100);
            showSuccess('Exited fullscreen mode');
        }).catch(err => {
            console.error('Error exiting fullscreen:', err);
            showError('Failed to exit fullscreen mode');
        });
    }
}

// Listen for fullscreen changes
document.addEventListener('fullscreenchange', function() {
    // Invalidate map size when fullscreen state changes
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 100);
});

// Additional utility functions
function resetMapView() {
    map.setView([20.5937, 78.9629], 5);
    showSuccess('Map view reset to India');
}

function zoomToAllLayers() {
    if (mapLayers.length === 0) {
        showWarning('No layers available to zoom to');
        return;
    }

    let bounds = null;
    mapLayers.forEach(layer => {
        if (layer.visible && layer.bounds) {
            if (!bounds) {
                bounds = layer.bounds;
            } else {
                bounds.extend(layer.bounds);
            }
        }
    });

    if (bounds) {
        map.fitBounds(bounds.pad(0.1));
        showSuccess('Zoomed to all visible layers');
    } else {
        showWarning('No visible layers with valid bounds found');
    }
}

function updateMapStatistics() {
    // Update map statistics
    console.log('Map statistics updated');
}

function handleFeatureClick(feature, index, layerConfig) {
    // Handle feature click
    console.log('Feature clicked:', feature, index, layerConfig);
}

function getFieldType(value) {
    if (value === null || value === undefined) return 'empty';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'string') {
        if (value.match(/^\d{4}-\d{2}-\d{2}/)) return 'date';
        if (value.match(/^https?:\/\//)) return 'url';
        if (value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return 'email';
        if (value.length > 100) return 'longtext';
        return 'text';
    }
    return 'unknown';
}

function getFieldIcon(fieldType) {
    const icons = {
        'text': 'fas fa-font',
        'longtext': 'fas fa-align-left',
        'number': 'fas fa-hashtag',
        'boolean': 'fas fa-check-square',
        'date': 'fas fa-calendar',
        'url': 'fas fa-link',
        'email': 'fas fa-envelope',
        'empty': 'fas fa-circle',
        'unknown': 'fas fa-question-circle'
    };
    return icons[fieldType] || 'fas fa-question-circle';
}

// Global functions for popup controls
window.zoomToCurrentPopupFeature = function(level) {
    if (!window.currentPopupFeature) return;

    const options = {};
    if (level === 'close') {
        options.padding = 0.1;
        options.maxZoom = 18;
    } else if (level === 'medium') {
        options.padding = 0.3;
        options.maxZoom = 15;
    }

    if (window.currentPopupFeature.getBounds) {
        const bounds = window.currentPopupFeature.getBounds();
        map.fitBounds(bounds.pad(options.padding || 0.2), {
            maxZoom: options.maxZoom || 16
        });
    } else if (window.currentPopupFeature.getLatLng) {
        const latlng = window.currentPopupFeature.getLatLng();
        map.setView(latlng, options.maxZoom || 16);
    }
};

window.centerCurrentPopupFeature = function() {
    if (!window.currentPopupFeature) return;

    if (window.currentPopupFeature.getBounds) {
        const center = window.currentPopupFeature.getBounds().getCenter();
        map.setView(center);
    } else if (window.currentPopupFeature.getLatLng) {
        const latlng = window.currentPopupFeature.getLatLng();
        map.setView(latlng);
    }
};

function exportCurrentFeature() {
    if (!window.currentPopupFeature) return;

    const data = {
        recordId: window.currentPopupFeature.recordId,
        recordData: window.currentPopupFeature.recordData,
        layerId: window.currentPopupFeature.layerId,
        featureIndex: window.currentPopupFeature.featureIndex
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feature_${data.recordId || 'unknown'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSuccess('Feature exported successfully');
}

function editCurrentFeature() {
    if (!window.currentPopupFeature) return;

    showInfo('Feature editing functionality would be implemented here');
}

function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            showSuccess('Copied to clipboard');
        }).catch(() => {
            showError('Failed to copy to clipboard');
        });
    } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showSuccess('Copied to clipboard');
        } catch (err) {
            showError('Failed to copy to clipboard');
        }
        document.body.removeChild(textArea);
    }
}

function filterPopupFields(searchTerm) {
    const fields = document.querySelectorAll('.popup-field');
    fields.forEach(field => {
        const fieldName = field.dataset.field;
        const fieldValue = field.textContent;

        if (fieldName.toLowerCase().includes(searchTerm.toLowerCase()) ||            fieldValue.toLowerCase().includes(searchTerm.toLowerCase())) {
            field.style.display = '';
        } else {
            field.style.display = 'none';
        }
    });
}

// Logout function
function logout() {
    if (window.teableAuth && window.teableAuth.logout) {
        window.teableAuth.logout();
    } else {
        window.location.href = 'login.html';
    }
}