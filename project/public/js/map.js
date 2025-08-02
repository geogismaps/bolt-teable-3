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
    // Detect customer context from current URL or configuration
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    
    // Try to extract customer ID from various sources
    let customerId = null;
    
    // Method 1: Check for customer subdirectory in path
    const pathMatch = pathname.match(/\/customer(\d+)\//);
    if (pathMatch) {
        customerId = pathMatch[1];
    }
    
    // Method 2: Check for customer subdomain
    const subdomainMatch = hostname.match(/^customer(\d+)\./);
    if (subdomainMatch) {
        customerId = subdomainMatch[1];
    }
    
    // Method 3: Check localStorage or configuration
    if (!customerId) {
        customerId = localStorage.getItem('customer_id') || 
                    window.teableAuth?.getCurrentSession()?.customerId ||
                    'default';
    }
    
    return customerId;
}

// Generate customer-specific tile URL
function getCustomerTileUrl(customerId) {
    // For deployment on Linode, each customer will have their own folder
    if (customerId && customerId !== 'default') {
        return `customer${customerId}/tiles/{z}/{x}/{y}.png`;
    } else {
        return 'tiles/{z}/{x}/{y}.png';
    }
}

// Check if custom tiles exist for current customer
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

// Initialize basemaps with customer context
async function initializeCustomerBaseMaps() {
    const customerId = getCustomerContext();
    console.log('Detected customer context:', customerId);
    
    // Check if customer has custom drone imagery tiles
    const hasCustomTiles = await checkCustomTilesAvailability(customerId);
    
    if (hasCustomTiles) {
        // Update drone imagery basemap with customer-specific URL
        baseMaps.drone_imagery.url = getCustomerTileUrl(customerId);
        baseMaps.drone_imagery.attribution = `© Customer ${customerId} Drone Imagery`;
        
        console.log(`Custom drone imagery tiles enabled for customer ${customerId}`);
        
        // Update basemap selector to show drone imagery option
        updateBasemapSelector(true);
    } else {
        console.log('No custom drone imagery tiles found for customer:', customerId);
        // Remove drone imagery option if not available
        updateBasemapSelector(false);
    }
}

// Update basemap selector based on tile availability
function updateBasemapSelector(showDroneImagery) {
    const basemapSelector = document.getElementById('basemapSelector');
    if (!basemapSelector) return;
    
    // Check if drone imagery option already exists
    const droneOption = basemapSelector.querySelector('option[value="drone_imagery"]');
    
    if (showDroneImagery && !droneOption) {
        // Add drone imagery option
        const option = document.createElement('option');
        option.value = 'drone_imagery';
        option.textContent = 'Drone Imagery (High Detail)';
        basemapSelector.appendChild(option);
        
        // Add zoom level indicator
        const zoomInfo = document.createElement('small');
        zoomInfo.className = 'text-muted d-block';
        zoomInfo.textContent = 'Available at zoom levels 18-25';
        basemapSelector.parentNode.appendChild(zoomInfo);
        
    } else if (!showDroneImagery && droneOption) {
        // Remove drone imagery option if it exists
        droneOption.remove();
        
        // Remove zoom info if it exists
        const zoomInfo = basemapSelector.parentNode.querySelector('small');
        if (zoomInfo) zoomInfo.remove();
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication first
    if (!window.teableAuth.requireAuth()) return;

    // Wait for authentication to be fully ready before initializing map
    setTimeout(() => {
        initializeMap();
    }, 100);
});

async function initializeMap() {
    try {
        // Ensure we have a valid session
        currentUser = window.teableAuth.getCurrentSession();
        if (!currentUser) {
            console.error('No authenticated user found');
            window.location.href = 'login.html';
            return;
        }

        document.getElementById('userDisplay').textContent = 
            `${currentUser.firstName} ${currentUser.lastName} (${currentUser.role})`;

        // Initialize API if needed and ensure it's properly configured
        if (currentUser.userType === 'space_owner') {
            const clientConfig = window.teableAuth.clientConfig;
            if (!clientConfig) {
                console.error('No client configuration found');
                return;
            }
            window.teableAPI.init(clientConfig);
            
            // Wait for API to be ready
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Initialize customer-specific basemaps
        await initializeCustomerBaseMaps();

        // Initialize Leaflet map with maximum zoom level 25
        map = L.map('map', {
            maxZoom: 25,
            zoomControl: true,
            zoomSnap: 0.5,
            zoomDelta: 0.5
        }).setView([20.5937, 78.9629], 5);

        // Add default base layer with maximum zoom level 25
        L.tileLayer(baseMaps.openstreetmap.url, {
            attribution: baseMaps.openstreetmap.attribution,
            maxZoom: baseMaps.openstreetmap.maxZoom || 25
        }).addTo(map);

        // Initialize measurement group
        measurementGroup = L.layerGroup().addTo(map);

        // Add zoom level display
        addZoomLevelDisplay();

        // Add zoom event listener to show appropriate basemap recommendations
        map.on('zoomend', handleZoomChange);

        // Load available tables
        await loadAvailableTables();

        // Setup drag and drop for GeoJSON
        setupGeoJSONDragDrop();

        console.log('Map initialized successfully with customer context');

    } catch (error) {
        console.error('Map initialization failed:', error);
        showError('Failed to initialize map: ' + error.message);
    }
}

// Add zoom level display to map
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
    
    // Update zoom display on zoom change
    map.on('zoomend', function() {
        const zoomElements = document.querySelectorAll('.zoom-display');
        zoomElements.forEach(element => {
            element.innerHTML = `Zoom: ${map.getZoom()}`;
        });
    });
}

// Handle zoom level changes and show basemap recommendations
function handleZoomChange() {
    const currentZoom = map.getZoom();
    const basemapSelector = document.getElementById('basemapSelector');
    const droneOption = basemapSelector?.querySelector('option[value="drone_imagery"]');
    
    // Show recommendation for drone imagery at high zoom levels
    if (currentZoom >= 18 && droneOption) {
        // Highlight drone imagery option if available and not selected
        if (basemapSelector.value !== 'drone_imagery') {
            showInfo(`🚁 High-detail drone imagery is available at this zoom level! Switch to "Drone Imagery" for maximum detail.`);
        }
    }
    
    // Show warning if zoomed beyond standard basemap capabilities
    if (currentZoom > 21 && basemapSelector?.value !== 'drone_imagery') {
        showWarning(`⚠️ Current zoom level (${currentZoom}) exceeds standard basemap detail. Consider switching to Drone Imagery for better resolution.`);
    }
}

async function loadAvailableTables() {
    try {
        // Ensure user is authenticated and API is ready
        if (!currentUser || !window.teableAPI || !window.teableAPI.config.baseUrl) {
            console.log('Authentication or API not ready, skipping table loading');
            return;
        }

        const tablesData = await window.teableAPI.getTables();
        const tables = tablesData.tables || tablesData || [];

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
        }

        console.log(`Loaded ${userTables.length} available tables`);

    } catch (error) {
        console.error('Error loading tables:', error);
        showError('Failed to load tables: ' + error.message);
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
        // Get sample records to detect fields
        const recordsData = await window.teableAPI.getRecords(tableId, { limit: 5 });

        if (recordsData.records && recordsData.records.length > 0) {
            const fields = Object.keys(recordsData.records[0].fields || {});

            // Auto-detect geometry field
            let detectedGeometryField = null;
            const geometryFieldCandidates = fields.filter(field => {
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
                    showSuccess(`Auto-detected geometry field: ${detectedGeometryField}`);
                }
            }
	    if (linkedTablesInfo) {
                linkedTablesInfo.innerHTML = `
                    <div class="small">
                        <strong>Available Fields:</strong> ${fields.length}<br>
                        <strong>Geometry Field:</strong> ${detectedGeometryField || 'Not detected'}<br>
                        <strong>Sample Fields:</strong> ${fields.slice(0, 3).join(', ')}${fields.length > 3 ? '...' : ''}
                    </div>
                `;
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

        // Load field permissions for this table
        const fieldPermissions = await loadFieldPermissionsForTable(tableId);
        
        // Create layer
        const layer = await createLayerFromData(records, {
            id: Date.now().toString(),
            name: layerName,
            tableId: tableId,
            geometryField: detectedGeometryField,
            color: layerColor,
            visible: true,
            type: 'table',
            fieldPermissions: fieldPermissions
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

        // Detect media layer type
        const mediaType = detectMediaLayerType(layerConfig.name, records);
        
        // Store layer configuration with media type
        const layer = {
            ...layerConfig,
            leafletLayer: layerGroup,
            features: features,
            records: records,
            featureCount: validFeatureCount,
            bounds: null,
            mediaType: mediaType, // Store detected media type
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
        
        // Log media type detection
        if (mediaType) {
            console.log(`Detected media layer type "${mediaType}" for layer "${layerConfig.name}"`);
        }

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
    
    // Check if popups are enabled for this layer
    if (popupSettings.enabled === false) {
        console.log(`Popups disabled for layer "${layerConfig.name}" - not creating popup`);
        return '<div class="popup-disabled"><em>Popups disabled for this layer</em></div>';
    }
    
    const template = popupSettings.template || 'default';
    const maxWidth = popupSettings.maxWidth || 300;
    const maxFieldLength = popupSettings.maxFieldLength || 100;
    const showEmptyFields = popupSettings.showEmptyFields || false;
    const showFieldIcons = popupSettings.showFieldIcons !== false;
    const highlightLinks = popupSettings.highlightLinks !== false;
    const showCopyButtons = popupSettings.showCopyButtons || false;
    const enableSearch = popupSettings.enableSearch || false;

    let content = `<div class="feature-popup" style="max-width: ${maxWidth}px;">`;
    
    // Popup header with user role indicator
    content += `<div class="popup-header d-flex justify-content-between align-items-center mb-2">`;
    content += `<h6 class="popup-title mb-0">${layerConfig.name} ${getUserRoleBadge()}</h6>`;
    
    // Add search if enabled
    if (enableSearch) {
        content += `<input type="text" class="form-control form-control-sm" placeholder="Search..." 
                   onkeyup="filterPopupFields(this.value)" style="width: 120px;">`;
    }
    content += `</div>`;

    // Get fields to display - filter by permissions first
    const allFields = Object.keys(fields).filter(field => field !== layerConfig.geometryField);
    console.log(`Creating popup for layer "${layerConfig.name}" - all fields:`, allFields);
    
    const permittedFields = filterFieldsByPermissions(allFields, layerConfig);
    console.log(`Permitted fields after filtering:`, permittedFields);
    
    const selectedFields = layerConfig.properties?.popup?.fields;
    let fieldsToShow = [];
    
    // Check if popup fields have been specifically configured
    if (selectedFields && Array.isArray(selectedFields)) {
        // Only show the specifically selected fields that user has permission to see
        fieldsToShow = selectedFields.filter(field => 
            field !== layerConfig.geometryField && 
            permittedFields.includes(field) &&
            fields.hasOwnProperty(field)
        );
        console.log(`Popup configured for layer "${layerConfig.name}": showing ${fieldsToShow.length} permitted selected fields:`, fieldsToShow);
    } else {
        // If popup fields haven't been configured yet, show all permitted fields
        fieldsToShow = permittedFields;
        console.log(`Popup not configured for layer "${layerConfig.name}": showing all ${fieldsToShow.length} permitted fields`);
    }
    
    if (fieldsToShow.length !== allFields.length) {
        console.log(`🔒 Field permissions active: ${allFields.length - fieldsToShow.length} field(s) hidden from ${fieldsToShow.length} visible`);
    }

    // Apply template
    if (template === 'custom' && popupSettings.customTemplate) {
        content += renderCustomTemplate(popupSettings.customTemplate, fields, fieldsToShow);
    } else if (template === 'table') {
        content += renderTableTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength, layerConfig);
    } else if (template === 'card') {
        content += renderCardTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength, layerConfig);
    } else {
        content += renderDefaultTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength, layerConfig);
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

function renderDefaultTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength, layerConfig = null) {
    let content = '<div class="popup-fields">';
    
    fieldsToShow.forEach(key => {
        let value = fields[key];
        
        // Skip empty fields if not showing them
        if (!showEmptyFields && (value === null || value === undefined || value === '')) {
            return;
        }
        
        // Get field permission for styling
        const permission = layerConfig ? getFieldPermission(key, layerConfig) : 'view';
        const permissionIndicator = getFieldPermissionIndicator(permission);
        
        // Format value with enhanced media detection
        const formattedValue = formatFieldValue(value, highlightLinks, maxFieldLength, layerConfig);
        const fieldType = getFieldType(value);
        const fieldIcon = showFieldIcons ? `<i class="${getFieldIcon(fieldType)} me-2"></i>` : '';
        
        // Check if this is a media field for enhanced styling
        const layerName = layerConfig ? layerConfig.name : null;
        const isMediaField = typeof value === 'string' && value.match(/^https?:\/\//) && detectURLMediaType(value, layerName);
        const fieldClass = isMediaField ? 'popup-field media-popup-field' : 'popup-field';
        
        content += `<div class="${fieldClass}" data-field="${key}">`;
        content += `<div class="field-label mb-1"><strong>${permissionIndicator}${fieldIcon}${key}:</strong></div>`;
        content += `<div class="field-value">${formattedValue}</div>`;
        
        if (showCopyButtons && !isMediaField) {
            content += `<button class="btn btn-xs btn-outline-secondary mt-1" onclick="copyToClipboard('${value?.replace(/'/g, "\\'")}')" title="Copy">
                        <i class="fas fa-copy"></i></button>`;
        }
        content += `</div>`;
    });
    
    if (fieldsToShow.length === 0) {
        content += `<div class="text-muted text-center py-2"><em>No accessible fields to display</em></div>`;
    }
    
    content += '</div>';
    return content;
}

function renderTableTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength, layerConfig = null) {
    let content = '<div class="popup-table-wrapper" style="max-height: 300px; overflow-y: auto;">';
    content += '<table class="table table-sm table-bordered mb-0">';
    
    fieldsToShow.forEach(key => {
        let value = fields[key];
        
        if (!showEmptyFields && (value === null || value === undefined || value === '')) {
            return;
        }
        
        // Get field permission for styling
        const permission = layerConfig ? getFieldPermission(key, layerConfig) : 'view';
        const permissionIndicator = getFieldPermissionIndicator(permission);
        
        const formattedValue = formatFieldValue(value, highlightLinks, maxFieldLength, layerConfig);
        const fieldType = getFieldType(value);
        const fieldIcon = showFieldIcons ? `<i class="${getFieldIcon(fieldType)} me-1"></i>` : '';
        
        content += `<tr data-field="${key}">`;
        content += `<td class="fw-bold" style="width: 40%;">${permissionIndicator}${fieldIcon}${key}</td>`;
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

function renderCardTemplate(fields, fieldsToShow, showEmptyFields, showFieldIcons, highlightLinks, showCopyButtons, maxFieldLength, layerConfig = null) {
    let content = '<div class="popup-cards">';
    
    fieldsToShow.forEach(key => {
        let value = fields[key];
        
        if (!showEmptyFields && (value === null || value === undefined || value === '')) {
            return;
        }
        
        // Get field permission for styling
        const permission = layerConfig ? getFieldPermission(key, layerConfig) : 'view';
        const permissionIndicator = getFieldPermissionIndicator(permission);
        
        const formattedValue = formatFieldValue(value, highlightLinks, maxFieldLength, layerConfig);
        const fieldType = getFieldType(value);
        const fieldIcon = showFieldIcons ? `<i class="${getFieldIcon(fieldType)} me-2"></i>` : '';
        
        content += `<div class="card mb-2" data-field="${key}">`;
        content += `<div class="card-body p-2">`;
        content += `<h6 class="card-title mb-1">${permissionIndicator}${fieldIcon}${key}</h6>`;
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

function formatFieldValue(value, highlightLinks, maxLength, layerConfig = null) {
    if (value === null || value === undefined) {
        return '<em class="text-muted">No data</em>';
    }
    
    if (value === '') {
        return '<em class="text-muted">Empty</em>';
    }
    
    let formattedValue = String(value);
    
    // Check if this is a media URL and enhance the display
    if (highlightLinks && typeof value === 'string' && value.match(/^https?:\/\//)) {
        const layerName = layerConfig ? layerConfig.name : null;
        const mediaType = detectURLMediaType(value, layerName);
        
        if (mediaType) {
            // Get media type icon and action text
            const mediaInfo = getMediaTypeInfo(mediaType);
            
            // Create shortened URL for display
            let displayUrl = formattedValue;
            if (maxLength && formattedValue.length > maxLength) {
                displayUrl = formattedValue.substring(0, maxLength - 3) + '...';
            }
            
            // Create enhanced media field display
            return `
                <div class="media-field-container">
                    <div class="d-flex align-items-center gap-2">
                        <span class="media-type-icon">${mediaInfo.icon}</span>
                        <button class="btn btn-sm btn-outline-primary media-view-btn" 
                                onclick="openMediaFromURL('${value.replace(/'/g, "\\'").replace(/"/g, "&quot;")}', '${mediaType}', '${mediaInfo.title}')"
                                title="View ${mediaInfo.title}">
                            ${mediaInfo.buttonText}
                        </button>
                        <small class="text-muted flex-grow-1">${displayUrl}</small>
                    </div>
                </div>
            `;
        } else {
            // Regular URL - truncate if needed
            if (maxLength && formattedValue.length > maxLength) {
                formattedValue = formattedValue.substring(0, maxLength) + '...';
            }
            return `<a href="${value}" target="_blank" class="text-primary">${formattedValue}</a>`;
        }
    }
    
    // Handle email addresses
    if (highlightLinks && typeof value === 'string' && value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        return `<a href="mailto:${value}" class="text-primary">${formattedValue}</a>`;
    }
    
    // Regular text value - truncate if needed
    if (maxLength && formattedValue.length > maxLength) {
        formattedValue = formattedValue.substring(0, maxLength) + '...';
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
        const geometryIcon = getGeometryIcon(layer);
        const mediaTypeBadge = layer.mediaType ? `<span class="badge bg-info ms-2">${layer.mediaType}</span>` : '';

        html += `
            <div class="layer-item ${layer.visible ? 'active' : ''}" data-layer-id="${layer.id}">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-1">
                            <i class="fas ${visibilityIcon} me-2" onclick="toggleLayerVisibility('${layer.id}')"></i>
                            <i class="${geometryIcon} me-2"></i>
                            <strong>${layer.name}</strong>
                            ${mediaTypeBadge}
                        </div>
                        <div class="small text-muted">
                            ${layer.featureCount} features • ${layer.mediaType || layer.type}
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

function getGeometryIcon(layer) {
    // Check for media type first
    if (layer.mediaType) {
        switch (layer.mediaType) {
            case 'video': return 'fas fa-video text-danger';
            case 'audio': return 'fas fa-music text-purple';
            case 'image': return 'fas fa-camera text-info';
            case 'pdf': return 'fas fa-file-pdf text-danger';
            case '360': return 'fas fa-globe text-primary';
        }
    }
    
    // Fallback to geometry type
    switch (layer.type) {
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
    if (!layer) {
        showError('Layer not found for zooming');
        return;
    }

    try {
        // If layer has precalculated bounds, use them
        if (layer.bounds && layer.bounds.isValid()) {
            zoomToLayerBounds(layer);
            return;
        }

        // Calculate bounds from features if not available
        if (!layer.features || layer.features.length === 0) {
            showWarning(`Layer "${layer.name}" has no features to zoom to`);
            return;
        }

        const validFeatures = [];
        layer.features.forEach(feature => {
            if (feature.getLatLng) {
                const latlng = feature.getLatLng();
                if (latlng && !isNaN(latlng.lat) && !isNaN(latlng.lng)) {
                    validFeatures.push(feature);
                }
            } else if (feature.getLatLngs) {
                const latlngs = feature.getLatLngs();
                if (latlngs && latlngs.length > 0) {
                    validFeatures.push(feature);
                }
            } else if (feature.getBounds) {
                const bounds = feature.getBounds();
                if (bounds && bounds.isValid()) {
                    validFeatures.push(feature);
                }
            }
        });

        if (validFeatures.length === 0) {
            showError(`No valid features found in layer "${layer.name}"`);
            return;
        }

        // Create feature group to calculate bounds
        const featureGroup = new L.featureGroup(validFeatures);
        const bounds = featureGroup.getBounds();

        if (!bounds.isValid()) {
            showError('Unable to calculate valid bounds for layer');
            return;
        }

        // Update layer bounds for future use
        layer.bounds = bounds;

        // Zoom to calculated bounds
        zoomToLayerBounds(layer);

    } catch (error) {
        console.error('Error zooming to layer:', error);
        showError(`Failed to zoom to layer "${layer.name}": ${error.message}`);
    }
}

function zoomToLayerBounds(layer) {
    const bounds = layer.bounds;
    
    // Calculate appropriate zoom level and padding based on layer size
    const boundsSize = bounds.getNorthEast().distanceTo(bounds.getSouthWest());
    
    let maxZoom, padding;
    
    if (boundsSize < 50) { // Very small layer (< 50 meters)
        maxZoom = 25;
        padding = 0.4;
    } else if (boundsSize < 500) { // Small layer (< 500 meters)
        maxZoom = 25;
        padding = 0.3;
    } else if (boundsSize < 5000) { // Medium layer (< 5 km)
        maxZoom = 23;
        padding = 0.2;
    } else if (boundsSize < 50000) { // Large layer (< 50 km)
        maxZoom = 21;
        padding = 0.1;
    } else { // Very large layer
        maxZoom = 19;
        padding = 0.05;
    }
    
    map.fitBounds(bounds.pad(padding), {
        maxZoom: maxZoom,
        animate: true,
        duration: 1
    });

    const sizeText = boundsSize < 1000 ? 
        Math.round(boundsSize) + 'm' : 
        (boundsSize / 1000).toFixed(1) + 'km';

    showSuccess(`Zoomed to layer "${layer.name}" with ${layer.featureCount} features (extent: ${sizeText})`);
}

function showAttributeTable(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) {
        showError('Layer not found');
        return;
    }

    if (!layer.records || layer.records.length === 0) {
        showError('No data available for this layer');
        return;
    }

    // Create and show docked attribute table
    createDockedAttributeTable(layer);
}

function showLayerProperties(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) {
        showError('Layer not found');
        return;
    }

    try {
        // Store current layer for properties modal
        window.currentPropertiesLayer = layer;

        // Populate properties modal with layer data
        populatePropertiesModal(layer);

        // Show the modal
        const modal = new bootstrap.Modal(document.getElementById('layerPropertiesModal'));
        modal.show();
    } catch (error) {
        console.error('Error opening layer properties:', error);
        showError('Failed to open layer properties: ' + error.message);
    }
}

async function createDockedAttributeTable(layer) {
    // Remove existing docked table if present
    const existingTable = document.getElementById('dockedAttributeTable');
    if (existingTable) {
        existingTable.remove();
    }

    // Only load field permissions if user is properly authenticated
    let fieldPermissions = {};
    try {
        if (currentUser && window.teableAPI && window.teableAPI.config.baseUrl) {
            fieldPermissions = await loadFieldPermissionsForTable(layer.tableId);
        }
    } catch (error) {
        console.log('Could not load field permissions, using defaults:', error.message);
        fieldPermissions = {};
    }
    
    // Store permissions on layer for later use
    layer.fieldPermissions = fieldPermissions;

    // Create docked attribute table HTML with enhanced permissions
    const dockedTableHTML = `
        <div id="dockedAttributeTable" class="docked-attribute-table">
            <div class="docked-table-header">
                <div class="d-flex justify-content-between align-items-center">
                    <h6 class="mb-0">
                        <i class="fas fa-table me-2"></i>Attribute Table - ${layer.name}
                        <span class="badge bg-info ms-2">${getUserRoleBadge()}</span>
                    </h6>
                    <div class="docked-table-controls">
                        <button class="btn btn-sm btn-outline-light" onclick="refreshAttributeTable('${layer.id}')" title="Refresh">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" onclick="toggleDockedTableSize()" title="Toggle Size">
                            <i class="fas fa-expand-alt" id="tableToggleIcon"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-light" onclick="closeDockedTable()" title="Close">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div class="docked-table-toolbar">
                <div class="row align-items-center">
                    <div class="col-md-12">
                        <div class="d-flex gap-2 flex-wrap justify-content-between align-items-center">
                            <div class="d-flex gap-2 flex-wrap">
                                <button class="btn btn-sm btn-outline-primary" onclick="selectAllRows('${layer.id}')">
                                    <i class="fas fa-check-square me-1"></i>Select All
                                </button>
                                <button class="btn btn-sm btn-outline-secondary" onclick="clearSelection('${layer.id}')">
                                    <i class="fas fa-square me-1"></i>Clear Selection
                                </button>
                                <button class="btn btn-sm btn-outline-success" onclick="zoomToSelection('${layer.id}')" id="zoomToSelectionBtn" disabled>
                                    <i class="fas fa-search-plus me-1"></i>Zoom to Selection
                                </button>
                                ${canEditRecords() ? `
                                    <button class="btn btn-sm btn-primary" onclick="startTableEditing('${layer.id}')" id="startEditingBtn">
                                        <i class="fas fa-edit me-1"></i>Start Editing
                                    </button>
                                    <button class="btn btn-sm btn-success" onclick="saveTableEditing('${layer.id}')" id="saveEditingBtn" style="display: none;">
                                        <i class="fas fa-save me-1"></i>Save Editing
                                    </button>
                                    
                                    <button class="btn btn-sm btn-outline-danger" onclick="deleteSelectedRecords('${layer.id}')" id="deleteSelectedBtn" disabled>
                                        <i class="fas fa-trash me-1"></i>Delete Selected
                                    </button>
                                ` : ''}
                                <button class="btn btn-sm btn-outline-info" onclick="exportTableData('${layer.id}')">
                                    <i class="fas fa-download me-1"></i>Export CSV
                                </button>
                            </div>
                            <div class="text-muted small">
                                <div><span id="selectedCount">0</span> of ${layer.records.length} features selected</div>
                                <div class="permission-indicator">
                                    ${getPermissionIndicator()}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="docked-table-content">
                <div id="attributeTableContainer">
                    <table class="table table-sm table-striped mb-0" id="attributeTable">
                        <thead class="table-dark sticky-top">
                            ${await createEnhancedTableHeader(layer)}
                        </thead>
                        <tbody>
                            ${await createEnhancedTableBody(layer)}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Add docked table to map container
    const mapContainer = document.querySelector('.map-container');
    mapContainer.insertAdjacentHTML('beforeend', dockedTableHTML);

    // Adjust map height to accommodate the docked table
    adjustMapForDockedTable();
    
    // Setup inline editing handlers
    setupInlineEditing(layer);
}

async function loadFieldPermissionsForTable(tableId) {
    try {
        // Check authentication first
        const currentUser = window.teableAuth.getCurrentSession();
        if (!currentUser) {
            console.log('No authenticated user, using default permissions');
            return {};
        }

        // Check if API is ready
        if (!window.teableAPI || !window.teableAPI.config || !window.teableAPI.config.baseUrl) {
            console.log('API not ready, using default permissions');
            return {};
        }

        // Check cache first
        if (fieldPermissionsCache[tableId]) {
            console.log(`Using cached field permissions for table ${tableId}`);
            return fieldPermissionsCache[tableId];
        }

        // Ensure system tables exist
        try {
            await window.teableAPI.ensureSystemTables();
        } catch (systemError) {
            console.log('System tables not available, using role-based defaults');
            return {};
        }

        // Get field permissions for current user and table
        const permissionsData = await window.teableAPI.getRecords(window.teableAPI.systemTables.permissions);
        const permissions = permissionsData.records || [];

        const fieldPermissions = {};
        permissions.forEach(perm => {
            const fields = perm.fields;
            if (fields.user_email === currentUser.email && fields.table_id === tableId) {
                fieldPermissions[fields.field_name] = fields.permission_type;
            }
        });

        // Cache the permissions
        fieldPermissionsCache[tableId] = fieldPermissions;

        console.log(`Loaded field permissions for table ${tableId}:`, Object.keys(fieldPermissions).length, 'permissions found');
        return fieldPermissions;
    } catch (error) {
        console.error('Error loading field permissions:', error);
        return {};
    }
}

function getFieldPermission(fieldName, layer) {
    if (!layer.fieldPermissions) {
        return getDefaultPermissionByRole();
    }
    
    return layer.fieldPermissions[fieldName] || getDefaultPermissionByRole();
}

function getDefaultPermissionByRole() {
    const currentUser = window.teableAuth.getCurrentSession();
    if (!currentUser) return 'view';
    
    const role = currentUser.role?.toLowerCase() || 'viewer';
    
    // Map roles to permissions - matches table.js logic
    const rolePermissions = {
        'creator': 'edit',
        'owner': 'edit', 
        'editor': 'edit',
        'commenter': 'view',
        'viewer': 'view'
    };
    
    return rolePermissions[role] || 'view';
}

function canEditRecords() {
    const currentUser = window.teableAuth.getCurrentSession();
    if (!currentUser) return false;
    
    const role = currentUser.role?.toLowerCase() || 'viewer';
    return role === 'creator' || role === 'owner' || role === 'editor';
}

function getUserRoleBadge() {
    const currentUser = window.teableAuth.getCurrentSession();
    if (!currentUser) return 'Unknown';
    
    const role = currentUser.role || 'Viewer';
    const roleColors = {
        'creator': 'danger',
        'owner': 'danger',
        'editor': 'success', 
        'commenter': 'warning',
        'viewer': 'secondary'
    };
    
    const colorClass = roleColors[role.toLowerCase()] || 'secondary';
    return `<span class="badge bg-${colorClass}">${role}</span>`;
}

function getPermissionIndicator() {
    const editCount = document.querySelectorAll('.field-editable').length;
    const viewCount = document.querySelectorAll('.field-viewonly').length;
    const hiddenCount = document.querySelectorAll('.field-hidden').length;
    
    return `
        <span class="text-success" title="Editable fields"><i class="fas fa-edit"></i> ${editCount}</span>
        <span class="text-info ms-2" title="View-only fields"><i class="fas fa-eye"></i> ${viewCount}</span>
        ${hiddenCount > 0 ? `<span class="text-danger ms-2" title="Hidden fields"><i class="fas fa-eye-slash"></i> ${hiddenCount}</span>` : ''}
    `;
}

function getFieldPermissionIndicator(permission) {
    const indicators = {
        'view': '<span class="permission-indicator permission-view" title="View only"></span>',
        'edit': '<span class="permission-indicator permission-edit" title="Can edit"></span>',
        'hidden': '<span class="permission-indicator permission-hidden" title="Hidden"></span>'
    };
    return indicators[permission] || indicators['view'];
}

function filterFieldsByPermissions(fields, layer) {
    if (!layer || !layer.fieldPermissions) {
        console.log('No field permissions configured, showing all fields');
        return fields; // Return all fields if no permissions configured
    }
    
    const filteredFields = fields.filter(fieldName => {
        const permission = getFieldPermission(fieldName, layer);
        const isVisible = permission !== 'hidden';
        if (!isVisible) {
            console.log(`Filtering out hidden field: ${fieldName}`);
        }
        return isVisible;
    });
    
    console.log(`Filtered ${fields.length} fields to ${filteredFields.length} visible fields`);
    return filteredFields;
}

function getFieldPermission(fieldName, layer) {
    if (!layer.fieldPermissions) {
        return getDefaultPermissionByRole();
    }
    
    return layer.fieldPermissions[fieldName] || getDefaultPermissionByRole();
}

function getDefaultPermissionByRole() {
    const currentUser = window.teableAuth.getCurrentSession();
    if (!currentUser) return 'view';
    
    const role = currentUser.role?.toLowerCase() || 'viewer';
    
    // Map roles to permissions
    const rolePermissions = {
        'creator': 'edit',
        'owner': 'edit', 
        'editor': 'edit',
        'commenter': 'view',
        'viewer': 'view'
    };
    
    return rolePermissions[role] || 'view';
}

function canEditRecords() {
    const currentUser = window.teableAuth.getCurrentSession();
    if (!currentUser) return false;
    
    const role = currentUser.role?.toLowerCase() || 'viewer';
    return role === 'creator' || role === 'owner' || role === 'editor';
}

function getUserRoleBadge() {
    const currentUser = window.teableAuth.getCurrentSession();
    if (!currentUser) return 'Unknown';
    
    const role = currentUser.role || 'Viewer';
    const roleColors = {
        'creator': 'danger',
        'owner': 'danger',
        'editor': 'success', 
        'commenter': 'warning',
        'viewer': 'secondary'
    };
    
    const colorClass = roleColors[role.toLowerCase()] || 'secondary';
    return `<span class="badge bg-${colorClass}">${role}</span>`;
}

function getPermissionIndicator() {
    const editCount = document.querySelectorAll('.field-editable').length;
    const viewCount = document.querySelectorAll('.field-viewonly').length;
    const hiddenCount = document.querySelectorAll('.field-hidden').length;
    
    return `
        <span class="text-success" title="Editable fields"><i class="fas fa-edit"></i> ${editCount}</span>
        <span class="text-info ms-2" title="View-only fields"><i class="fas fa-eye"></i> ${viewCount}</span>
        ${hiddenCount > 0 ? `<span class="text-danger ms-2" title="Hidden fields"><i class="fas fa-eye-slash"></i> ${hiddenCount}</span>` : ''}
    `;
}

async function createEnhancedTableHeader(layer) {
    if (!layer.records || layer.records.length === 0) return '';

    const fields = Object.keys(layer.records[0].fields || {});
    let headerHTML = '<tr>';

    // Add selection checkbox column
    headerHTML += '<th style="width: 40px;"><input type="checkbox" onchange="toggleAllRows(this, \'' + layer.id + '\')"></th>';

    // Get all fields except geometry field
    const allFields = fields.filter(f => f !== layer.geometryField);
    console.log('All fields before permission filtering:', allFields);
    
    // Filter out hidden fields based on permissions
    const permittedFields = filterFieldsByPermissions(allFields, layer);
    console.log('Permitted fields after filtering:', permittedFields);
    
    permittedFields.forEach(field => {
        const permission = getFieldPermission(field, layer);
        const permissionClass = permission === 'edit' ? 'field-editable' : 'field-viewonly';
        const permissionIndicator = getFieldPermissionIndicator(permission);
        
        headerHTML += `
            <th class="${permissionClass}">
                <div class="d-flex align-items-center">
                    ${permissionIndicator}
                    <span class="ms-1">${field}</span>
                </div>
            </th>
        `;
    });

    // Add actions column
    headerHTML += '<th style="width: 120px;">Actions</th>';
    headerHTML += '</tr>';

    return headerHTML;
}

async function createEnhancedTableBody(layer) {
    if (!layer.records || layer.records.length === 0) return '';

    const allFields = Object.keys(layer.records[0].fields || {});
    const nonGeometryFields = allFields.filter(f => f !== layer.geometryField);
    console.log('All non-geometry fields:', nonGeometryFields);
    
    const permittedFields = filterFieldsByPermissions(nonGeometryFields, layer);
    console.log('Permitted fields for table body:', permittedFields);
    let bodyHTML = '';

    layer.records.forEach((record, index) => {
        bodyHTML += `<tr data-record-id="${record.id}" data-feature-index="${index}" data-table-id="${layer.tableId}">`;

        // Add selection checkbox
        bodyHTML += `<td><input type="checkbox" class="row-selector" onchange="toggleRowSelection('${layer.id}', ${index}, this.checked)"></td>`;

        // Add field data with permission-based editing - only show permitted fields
        permittedFields.forEach(field => {
            const permission = getFieldPermission(field, layer);
            
            let value = record.fields[field];
            const originalValue = value;
            
            if (value === null || value === undefined) {
                value = '';
            }
            
            const displayValue = typeof value === 'string' && value.length > 50 ? 
                value.substring(0, 50) + '...' : value;
            
            const cellClass = permission === 'edit' ? 'editable-cell' : 'readonly-cell';
            const borderColor = permission === 'edit' ? 'border-success' : 'border-info';
            
            bodyHTML += `
                <td class="${cellClass} ${borderColor}" 
                    data-field="${field}" 
                    data-record-id="${record.id}"
                    data-original-value="${escapeHtml(originalValue || '')}"
                    title="${permission === 'edit' ? 'Editable field' : 'View only'}: ${originalValue || ''}">
                    <div class="${permission === 'edit' ? 'editable-content' : 'readonly-content'}">
                        ${escapeHtml(displayValue)}
                    </div>
                </td>
            `;
        });

        // Add actions with permission-based controls
        bodyHTML += `
            <td>
                <div class="btn-group" role="group">
                    <button class="btn btn-xs btn-outline-primary" onclick="zoomToFeature('${layer.id}', ${index})" title="Zoom to Feature">
                        <i class="fas fa-search-plus"></i>
                    </button>
                    <button class="btn btn-xs btn-outline-info" onclick="showFeatureInfo('${layer.id}', ${index})" title="Show Info">
                        <i class="fas fa-info-circle"></i>
                    </button>
                    ${canEditRecords() ? `
                        <button class="btn btn-xs btn-outline-warning" onclick="editRecord('${layer.id}', '${record.id}', ${index})" title="Edit Record">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-xs btn-outline-danger" onclick="deleteRecord('${layer.id}', '${record.id}', ${index})" title="Delete Record">
                            <i class="fas fa-trash"></i>
                        </button>
                    ` : ''}
                </div>
            </td>
        `;

        bodyHTML += '</tr>';
    });

    return bodyHTML;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function populatePropertiesModal(layer) {
    try {
        // Information tab
        const propLayerName = document.getElementById('propLayerName');
        const propDataSource = document.getElementById('propDataSource');
        const propGeometryType = document.getElementById('propGeometryType');
        const propFeatureCount = document.getElementById('propFeatureCount');
        
        if (propLayerName) propLayerName.value = layer.name || '';
        if (propDataSource) propDataSource.value = layer.tableId || '';
        if (propGeometryType) propGeometryType.value = determineGeometryType(layer);
        if (propFeatureCount) propFeatureCount.value = layer.featureCount || 0;

    // Populate field selectors
    populateFieldSelectors(layer);

    // Symbology tab - ensure defaults are set
        let symbology = layer.properties?.symbology || {};
        
        // Initialize symbology with defaults if missing
        if (!layer.properties) layer.properties = {};
        if (!layer.properties.symbology) {
            layer.properties.symbology = {
                type: 'single',
                fillColor: '#3498db',
                borderColor: '#2c3e50',
                borderWidth: 2,
                fillOpacity: 0.7
            };
            symbology = layer.properties.symbology;
            console.log('Initialized default symbology for layer:', layer.name);
        }
        
        const propSymbologyType = document.getElementById('propSymbologyType');
        const propFillColor = document.getElementById('propFillColor');
        const propBorderColor = document.getElementById('propBorderColor');
        const propBorderWidth = document.getElementById('propBorderWidth');
        const propFillOpacity = document.getElementById('propFillOpacity');
        const fillOpacityValue = document.getElementById('fillOpacityValue');
        const borderWidthValue = document.getElementById('borderWidthValue');
        
        if (propSymbologyType) {
            propSymbologyType.value = symbology.type || 'single';
            console.log('Set symbology type to:', symbology.type || 'single');
        }
        if (propFillColor) propFillColor.value = symbology.fillColor || '#3498db';
        if (propBorderColor) propBorderColor.value = symbology.borderColor || '#2c3e50';
        if (propBorderWidth) propBorderWidth.value = symbology.borderWidth || 2;
        if (propFillOpacity) propFillOpacity.value = symbology.fillOpacity || 0.7;

        // Update opacity display
        if (fillOpacityValue) fillOpacityValue.textContent = Math.round((symbology.fillOpacity || 0.7) * 100) + '%';
        if (borderWidthValue) borderWidthValue.textContent = (symbology.borderWidth || 2) + 'px';

    // Labels tab
        const labels = layer.properties?.labels || {};
        const propEnableLabels = document.getElementById('propEnableLabels');
        const propLabelField = document.getElementById('propLabelField');
        const propLabelSize = document.getElementById('propLabelSize');
        const propLabelColor = document.getElementById('propLabelColor');
        const propLabelBackground = document.getElementById('propLabelBackground');
        const propLabelControls = document.getElementById('propLabelControls');
        
        if (propEnableLabels) propEnableLabels.checked = labels.enabled || false;
        if (propLabelField) propLabelField.value = labels.field || '';
        if (propLabelSize) propLabelSize.value = labels.fontSize || 12;
        if (propLabelColor) propLabelColor.value = labels.color || '#333333';
        if (propLabelBackground) propLabelBackground.checked = labels.background !== false;

        // Update label controls visibility
        if (propLabelControls) propLabelControls.style.display = labels.enabled ? 'block' : 'none';

    // iTool tab
        populatePopupFieldsSelector(layer);
        const popup = layer.properties?.popup || {};
        
        // Basic popup settings
        const propEnablePopups = document.getElementById('propEnablePopups');
        const propPopupTemplate = document.getElementById('propPopupTemplate');
        const propMaxPopupWidth = document.getElementById('propMaxPopupWidth');
        const propMaxFieldLength = document.getElementById('propMaxFieldLength');
        const propPopupPosition = document.getElementById('propPopupPosition');
        
        if (propEnablePopups) propEnablePopups.checked = popup.enabled !== false;
        if (propPopupTemplate) propPopupTemplate.value = popup.template || 'default';
        if (propMaxPopupWidth) propMaxPopupWidth.value = popup.maxWidth || 300;
        if (propMaxFieldLength) propMaxFieldLength.value = popup.maxFieldLength || 100;
        if (propPopupPosition) propPopupPosition.value = popup.position || 'auto';
        
        // Advanced settings
        const propShowEmptyFields = document.getElementById('propShowEmptyFields');
        const propShowFieldIcons = document.getElementById('propShowFieldIcons');
        const propHighlightLinks = document.getElementById('propHighlightLinks');
        const propShowTooltips = document.getElementById('propShowTooltips');
        const propEnableSearch = document.getElementById('propEnableSearch');
        const propShowCopyButtons = document.getElementById('propShowCopyButtons');
        const propEnableFieldSorting = document.getElementById('propEnableFieldSorting');
        const propCustomTemplate = document.getElementById('propCustomTemplate');
        
        if (propShowEmptyFields) propShowEmptyFields.checked = popup.showEmptyFields || false;
        if (propShowFieldIcons) propShowFieldIcons.checked = popup.showFieldIcons !== false;
        if (propHighlightLinks) propHighlightLinks.checked = popup.highlightLinks !== false;
        if (propShowTooltips) propShowTooltips.checked = popup.showTooltips || false;
        if (propEnableSearch) propEnableSearch.checked = popup.enableSearch || false;
        if (propShowCopyButtons) propShowCopyButtons.checked = popup.showCopyButtons || false;
        if (propEnableFieldSorting) propEnableFieldSorting.checked = popup.enableFieldSorting || false;
        if (propCustomTemplate) propCustomTemplate.value = popup.customTemplate || '';
        
        // Control settings
        const controls = popup.controls || {};
        const propShowZoomControls = document.getElementById('propShowZoomControls');
        const propShowCenterControl = document.getElementById('propShowCenterControl');
        const propShowExportControl = document.getElementById('propShowExportControl');
        const propShowEditControl = document.getElementById('propShowEditControl');
        
        if (propShowZoomControls) propShowZoomControls.checked = controls.showZoomControls !== false;
        if (propShowCenterControl) propShowCenterControl.checked = controls.showCenterControl !== false;
        if (propShowExportControl) propShowExportControl.checked = controls.showExportControl || false;
        if (propShowEditControl) propShowEditControl.checked = controls.showEditControl || false;
        
        // Handle template change and popup toggle
        handleTemplateChange();
        handlePopupToggle();
        
        // Ensure popup toggle state is correctly reflected in UI
        const popupEnabled = popup.enabled !== false;
        const propEnablePopupsCheckbox = document.getElementById('propEnablePopups');
        if (propEnablePopupsCheckbox) {
            propEnablePopupsCheckbox.checked = popupEnabled;
            // Trigger change event to ensure proper visibility
            propEnablePopupsCheckbox.dispatchEvent(new Event('change'));
        }

        // Update symbology type display - call this after all values are set
        setTimeout(() => {
            updateSymbologyType();
        }, 100);
        
    } catch (error) {
        console.error('Error populating properties modal:', error);
        showError('Failed to load layer properties: ' + error.message);
    }
}

function populateFieldSelectors(layer) {
    if (!layer.records || layer.records.length === 0) return;

    const allFields = Object.keys(layer.records[0].fields || {}).filter(field => field !== layer.geometryField);
    const permittedFields = filterFieldsByPermissions(allFields, layer);

    // Populate label field selector - only show permitted fields
    const labelFieldSelect = document.getElementById('propLabelField');
    if (labelFieldSelect) {
        const currentValue = labelFieldSelect.value;
        labelFieldSelect.innerHTML = '<option value="">Select field...</option>';
        permittedFields.forEach(field => {
            const permission = getFieldPermission(field, layer);
            const permissionIcon = permission === 'edit' ? '✏️' : '👁️';
            const option = document.createElement('option');
            option.value = field;
            option.textContent = `${permissionIcon} ${field}`;
            labelFieldSelect.appendChild(option);
        });
        if (currentValue) labelFieldSelect.value = currentValue;
    }

    // Populate graduated field selector with proper numeric detection - only show permitted fields
    const graduatedFieldSelect = document.getElementById('propGraduatedField');
    if (graduatedFieldSelect) {
        const currentValue = graduatedFieldSelect.value;
        graduatedFieldSelect.innerHTML = '<option value="">Select numeric field...</option>';
        
        permittedFields.forEach(field => {
            // Check if field contains numeric values
            let numericCount = 0;
            let totalCount = 0;
            
            layer.records.forEach(record => {
                const value = record.fields[field];
                if (value !== null && value !== undefined && value !== '') {
                    totalCount++;
                    const numValue = parseFloat(value);
                    if (!isNaN(numValue) && isFinite(numValue)) {
                        numericCount++;
                    }
                }
            });
            
            // Consider field numeric if at least 80% of values are numeric
            const isNumeric = totalCount > 0 && (numericCount / totalCount) >= 0.8;
            
            if (isNumeric) {
                const permission = getFieldPermission(field, layer);
                const permissionIcon = permission === 'edit' ? '✏️' : '👁️';
                const option = document.createElement('option');
                option.value = field;
                option.textContent = `${permissionIcon} ${field} (${numericCount}/${totalCount} numeric)`;
                graduatedFieldSelect.appendChild(option);
            }
        });
        
        if (currentValue) graduatedFieldSelect.value = currentValue;
    }

    // Populate categorized field selector - only show permitted fields
    const categorizedFieldSelect = document.getElementById('propCategorizedField');
    if (categorizedFieldSelect) {
        const currentValue = categorizedFieldSelect.value;
        categorizedFieldSelect.innerHTML = '<option value="">Select field...</option>';
        permittedFields.forEach(field => {
            // Count unique values for categorization
            const uniqueValues = new Set();
            layer.records.forEach(record => {
                const value = record.fields[field];
                if (value !== null && value !== undefined && value !== '') {
                    uniqueValues.add(value);
                }
            });
            
            const permission = getFieldPermission(field, layer);
            const permissionIcon = permission === 'edit' ? '✏️' : '👁️';
            const option = document.createElement('option');
            option.value = field;
            option.textContent = `${permissionIcon} ${field} (${uniqueValues.size} unique values)`;
            categorizedFieldSelect.appendChild(option);
        });
        if (currentValue) categorizedFieldSelect.value = currentValue;
    }
}

function populatePopupFieldsSelector(layer) {
    const container = document.getElementById('propPopupFields');
    if (!container || !layer.records || layer.records.length === 0) return;

    const allFields = Object.keys(layer.records[0].fields || {}).filter(field => field !== layer.geometryField);
    const permittedFields = filterFieldsByPermissions(allFields, layer);
    const selectedFields = layer.properties?.popup?.fields || [];

    let html = '';
    
    if (permittedFields.length === 0) {
        html = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle me-2"></i>
                No fields available for popup display based on your permissions.
            </div>
        `;
    } else {
        permittedFields.forEach(field => {
            const isSelected = selectedFields.includes(field);
            const fieldType = getFieldType(layer.records[0].fields[field]);
            const fieldIcon = getFieldIcon(fieldType);
            const permission = getFieldPermission(field, layer);
            const permissionIcon = permission === 'edit' ? '✏️' : '👁️';
            const permissionIndicator = getFieldPermissionIndicator(permission);
            
            html += `
                <div class="field-checkbox d-flex align-items-center mb-2">
                    <input class="form-check-input me-2" type="checkbox" id="popup_field_${field}" 
                           ${isSelected ? 'checked' : ''} onchange="updatePopupFieldSelection('${field}', this.checked)">
                    ${permissionIndicator}
                    <i class="${fieldIcon} me-2 text-muted" title="${fieldType}"></i>
                    <label class="form-check-label flex-grow-1" for="popup_field_${field}">
                        ${permissionIcon} ${field}
                    </label>
                    <small class="text-muted">(${fieldType})</small>
                </div>
            `;
        });
    }

    container.innerHTML = html;
    
    // Update available fields for custom template - only permitted fields
    updateAvailableFieldsHelp(permittedFields);
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

function updateAvailableFieldsHelp(fields) {
    const container = document.getElementById('availableFieldsHelp');
    if (!container) return;
    
    let html = '<div class="row">';
    fields.forEach((field, index) => {
        if (index > 0 && index % 3 === 0) html += '</div><div class="row">';
        html += `<div class="col-md-4"><code>{{${field}}}</code></div>`;
    });
    html += '</div>';
    
    container.innerHTML = html;
}

function determineGeometryType(layer) {
    if (!layer.features || layer.features.length === 0) return 'Unknown';

    const feature = layer.features[0];
    if (feature.getLatLng) return 'Point';
    if (feature.getLatLngs) return 'Polygon';
    return 'Unknown';
}

function selectAllRows(layerId) {
    const checkboxes = document.querySelectorAll('#dockedAttributeTable .row-selector');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
        const featureIndex = parseInt(checkbox.closest('tr').dataset.featureIndex);
        toggleRowSelection(layerId, featureIndex, true);
    });
}

function clearSelection(layerId) {
    const checkboxes = document.querySelectorAll('#dockedAttributeTable .row-selector');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
        const featureIndex = parseInt(checkbox.closest('tr').dataset.featureIndex);
        toggleRowSelection(layerId, featureIndex, false);
    });
}

function toggleAllRows(masterCheckbox, layerId) {
    const checkboxes = document.querySelectorAll('#dockedAttributeTable .row-selector');
    checkboxes.forEach(checkbox => {
        checkbox.checked = masterCheckbox.checked;
        const featureIndex = parseInt(checkbox.closest('tr').dataset.featureIndex);
        toggleRowSelection(layerId, featureIndex, masterCheckbox.checked);
    });
}

function toggleRowSelection(layerId, featureIndex, isSelected) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer || !layer.features[featureIndex]) return;

    const feature = layer.features[featureIndex];

    if (isSelected) {
        // Add to selection
        if (!selectedFeatures.includes(feature)) {
            selectedFeatures.push(feature);

            // Highlight feature on map in yellow
            if (feature.setStyle) {
                feature.setStyle({
                    fillColor: '#ffff00',   // Yellow highlight
                    color: '#000000',       // Black border
                    weight: 3,              // Thicker border
                    fillOpacity: 0.8        // More opaque when selected
                });
            }
        }
    } else {
        // Remove from selection
        const index = selectedFeatures.indexOf(feature);
        if (index !== -1) {
            selectedFeatures.splice(index, 1);

            // Reset feature style to original
            if (feature.setStyle) {
                const originalStyle = layer.properties?.symbology || {};
                feature.setStyle({
                    fillColor: originalStyle.fillColor || '#3498db',
                    color: originalStyle.borderColor || '#2c3e50',
                    weight: originalStyle.borderWidth || 2,
                    fillOpacity: originalStyle.fillOpacity || 0.7
                });
            }
        }
    }

    // Update selection count and info
    updateSelectionCount();
    updateSelectionInfo();
}

function updateSelectionCount() {
    const countElement = document.getElementById('selectedCount');
    const zoomButton = document.getElementById('zoomToSelectionBtn');
    const deleteButton = document.getElementById('deleteSelectedBtn');

    if (countElement) {
        countElement.textContent = selectedFeatures.length;
    }

    if (zoomButton) {
        zoomButton.disabled = selectedFeatures.length === 0;
    }
    
    if (deleteButton) {
        deleteButton.disabled = selectedFeatures.length === 0;
    }
    
    // Update selection info text
    updateSelectionInfo();
}

function updateSelectionInfo() {
    const selectedCheckboxes = document.querySelectorAll('#dockedAttributeTable .row-selector:checked');
    const selectedCount = selectedCheckboxes.length;
    const totalFeatures = document.querySelectorAll('#dockedAttributeTable tbody tr').length;
    
    // Update selection counter in the toolbar
    const selectionInfo = document.querySelector('.docked-table-toolbar .text-muted div');
    if (selectionInfo) {
        if (selectedCount === 0) {
            selectionInfo.innerHTML = `<span id="selectedCount">0</span> of ${totalFeatures} features selected`;
        } else {
            selectionInfo.innerHTML = `<span id="selectedCount">${selectedCount}</span> of ${totalFeatures} features selected`;
        }
    }
    
    // Enable/disable action buttons based on selection
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    const zoomBtn = document.getElementById('zoomToSelectionBtn');
    
    if (deleteBtn) {
        deleteBtn.disabled = selectedCount === 0;
        if (selectedCount > 0) {
            deleteBtn.title = `Delete ${selectedCount} selected record(s)`;
        } else {
            deleteBtn.title = 'Select records to delete';
        }
    }
    
    if (zoomBtn) {
        zoomBtn.disabled = selectedCount === 0;
        if (selectedCount > 0) {
            zoomBtn.title = `Zoom to ${selectedCount} selected feature(s)`;
        } else {
            zoomBtn.title = 'Select features to zoom to';
        }
    }
}

function zoomToSelection(layerId) {
    if (selectedFeatures.length === 0) {
        showWarning('No features selected');
        return;
    }

    // Create bounds from selected features
    let bounds = null;
    selectedFeatures.forEach(feature => {
        if (feature.getBounds) {
            const featureBounds = feature.getBounds();
            if (!bounds) {
                bounds = featureBounds;
            } else {
                bounds.extend(featureBounds);
            }
        } else if (feature.getLatLng) {
            const latlng = feature.getLatLng();
            if (!bounds) {
                bounds = L.latLngBounds([latlng, latlng]);
            } else {
                bounds.extend(latlng);
            }
        }
    });

    if (bounds) {
        map.fitBounds(bounds.pad(0.1));
        showSuccess(`Zoomed to ${selectedFeatures.length} selected feature(s)`);
    }
}

function zoomToFeature(layerId, featureIndex, options = null) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer || !layer.features[featureIndex]) {
        showError('Feature not found for zooming');
        return;
    }

    const feature = layer.features[featureIndex];

    // Store reference for popup zoom controls
    window.currentPopupFeature = feature;

    const defaultOptions = {
        padding: 0.05,
        maxZoom: 25, // Maximum possible zoom level
        minZoom: 10,
        animate: true,
        duration: 1
    };

    const zoomOptions = { ...defaultOptions, ...options };

    try {
        if (feature.getBounds) {
            // Polygon or complex geometry
            const bounds = feature.getBounds();
            
            if (!bounds.isValid()) {
                showError('Invalid bounds for feature');
                return;
            }
            
            // Calculate the size of the feature
            const boundsSize = bounds.getNorthEast().distanceTo(bounds.getSouthWest());
            
            // Enhanced zoom levels for maximum detail viewing
            let targetZoom;
            let padding;
            
            if (boundsSize < 1) { // Extremely small features (< 1 meter)
                targetZoom = 25; // Maximum zoom
                padding = 0.5;   // More padding for very small features
            } else if (boundsSize < 5) { // Very small features (< 5 meters)
                targetZoom = 25;
                padding = 0.4;
            } else if (boundsSize < 10) { // Small features (< 10 meters)
                targetZoom = 25;
                padding = 0.3;
            } else if (boundsSize < 25) { // Small features (< 25 meters)
                targetZoom = 24;
                padding = 0.25;
            } else if (boundsSize < 50) { // Medium-small features (< 50 meters)
                targetZoom = 23;
                padding = 0.2;
            } else if (boundsSize < 100) { // Medium features (< 100 meters)
                targetZoom = 22;
                padding = 0.15;
            } else if (boundsSize < 500) { // Medium-large features (< 500 meters)
                targetZoom = 21;
                padding = 0.1;
            } else if (boundsSize < 1000) { // Large features (< 1 km)
                targetZoom = 20;
                padding = 0.08;
            } else if (boundsSize < 5000) { // Very large features (< 5 km)
                targetZoom = 19;
                padding = 0.06;
            } else if (boundsSize < 10000) { // Huge features (< 10 km)
                targetZoom = 18;
                padding = 0.05;
            } else { // Massive features
                targetZoom = 17;
                padding = 0.03;
            }
            
            // Apply zoom with calculated parameters - always use maximum zoom possible
            map.fitBounds(bounds.pad(padding), {
                maxZoom: targetZoom, // Use calculated target zoom for maximum detail
                animate: zoomOptions.animate,
                duration: zoomOptions.duration
            });
            
        } else if (feature.getLatLng) {
            // Point geometry - use maximum zoom for points
            const latlng = feature.getLatLng();
            
            if (!latlng || isNaN(latlng.lat) || isNaN(latlng.lng)) {
                showError('Invalid coordinates for point feature');
                return;
            }
            
            // For points, use maximum zoom level for ultimate detail
            const targetZoom = 25; // Maximum possible zoom
            map.setView(latlng, targetZoom, {
                animate: zoomOptions.animate,
                duration: zoomOptions.duration
            });
            
        } else {
            showError('Feature does not have valid geometry for zooming');
            return;
        }

        // Wait a moment then open popup
        setTimeout(() => {
            if (feature.getPopup && feature.getPopup()) {
                feature.openPopup();
            } else if (feature.bindPopup) {
                // Create popup if it doesn't exist
                const record = layer.records[featureIndex];
                if (record && record.fields) {
                    const popupContent = createFeaturePopup(record.fields, layer);
                    feature.bindPopup(popupContent).openPopup();
                }
            }
        }, zoomOptions.animate ? 500 : 100);

        const sizeText = feature.getBounds ? 
            (boundsSize < 1000 ? Math.round(boundsSize) + 'm' : (boundsSize / 1000).toFixed(1) + 'km') : 
            'point';
        showSuccess(`Zoomed to feature with maximum detail (size: ${sizeText}, zoom: ${feature.getBounds ? targetZoom : 25})`);
        
    } catch (error) {
        console.error('Error zooming to feature:', error);
        showError('Failed to zoom to feature: ' + error.message);
    }
}

function showFeatureInfo(layerId, featureIndex) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer || !layer.records[featureIndex]) return;

    const record = layer.records[featureIndex];
    const feature = layer.features[featureIndex];

    // Store reference for popup controls
    window.currentPopupFeature = feature;

    // Highlight the feature in yellow
    if (feature.setStyle) {
        feature.setStyle({
            fillColor: '#ffff00',   // Yellow highlight
            color: '#000000',       // Black border
            weight: 3,              // Thicker border
            fillOpacity: 0.8        // More opaque when selected
        });
    }

    // Add to selected features if not already selected
    if (!selectedFeatures.includes(feature)) {
        selectedFeatures.push(feature);
        updateSelectionCount();
        
        // Update the corresponding checkbox in attribute table if visible
        const checkbox = document.querySelector(`tr[data-feature-index="${featureIndex}"] .row-selector`);
        if (checkbox) {
            checkbox.checked = true;
        }
    }

    // Ensure we have the latest record data
    feature.recordData = record.fields;
    feature.layerId = layerId;
    feature.featureIndex = featureIndex;

    // Create popup content using current layer configuration (respects popup field selection)
    const popupContent = createFeaturePopup(record.fields, layer);

    // Show popup on map
    if (feature.getBounds) {
        const center = feature.getBounds().getCenter();
        L.popup()
            .setLatLng(center)
            .setContent(popupContent)
            .openOn(map);
    } else if (feature.getLatLng) {
        feature.bindPopup(popupContent).openPopup();
    }
    
    console.log(`Feature info displayed for feature ${featureIndex} in layer "${layer.name}" with ${layer.properties?.popup?.fields?.length || 0} configured popup fields`);
}

function exportTableData(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer || !layer.records) {
        showError('No data to export');
        return;
    }

    try {
        // Prepare CSV data - only export permitted fields
        const allFields = Object.keys(layer.records[0].fields || {}).filter(field => field !== layer.geometryField);
        const permittedFields = filterFieldsByPermissions(allFields, layer);

        if (permittedFields.length === 0) {
            showError('No fields available for export based on your permissions');
            return;
        }

        // Create CSV header
        let csvContent = permittedFields.join(',') + '\n';

        // Add data rows
        layer.records.forEach(record => {
            const row = permittedFields.map(field => {
                let value = record.fields[field] || '';
                // Escape commas and quotes
                if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                    value = '"' + value.replace(/"/g, '""') + '"';
                }
                return value;
            });
            csvContent += row.join(',') + '\n';
        });

        // Create and download file
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${layer.name}_data.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showSuccess(`Data exported successfully (${permittedFields.length} permitted fields)`);
    } catch (error) {
        console.error('Export error:', error);
        showError('Failed to export data: ' + error.message);
    }
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

    // Remove current base layer
    map.eachLayer(layer => {
        if (layer._url && layer._url.includes('tile')) {
            map.removeLayer(layer);
        }
    });

    // Add new base layer with appropriate zoom constraints
    const basemap = baseMaps[basemapType];
    if (basemap) {
        const tileLayerOptions = {
            attribution: basemap.attribution,
            maxZoom: basemap.maxZoom || 25
        };
        
        // Add minZoom for custom tiles like drone imagery
        if (basemap.minZoom) {
            tileLayerOptions.minZoom = basemap.minZoom;
        }
        
        // Special handling for drone imagery
        if (basemapType === 'drone_imagery') {
            tileLayerOptions.errorTileUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='; // Transparent 1x1 pixel
            
            const currentZoom = map.getZoom();
            
            // Show info about zoom requirements for drone imagery
            if (currentZoom < basemap.minZoom) {
                showInfo(`🚁 Drone imagery is available at zoom level ${basemap.minZoom} and above. Current zoom: ${currentZoom}`);
            } else {
                showSuccess(`🚁 High-resolution drone imagery activated! Zoom levels ${basemap.minZoom}-${basemap.maxZoom} available.`);
            }
        }
        
        // Create and add the tile layer
        const tileLayer = L.tileLayer(basemap.url, tileLayerOptions);
        
        // Add error handling for missing tiles
        tileLayer.on('tileerror', function(error) {
            console.warn('Tile loading error:', error);
            if (basemapType === 'drone_imagery') {
                // Only show error once per session to avoid spam
                if (!window.droneImageryErrorShown) {
                    showWarning('Some drone imagery tiles may not be available at this location/zoom level.');
                    window.droneImageryErrorShown = true;
                }
            }
        });
        
        tileLayer.addTo(map);
        
        // Update map's max zoom if necessary
        if (basemap.maxZoom) {
            map.options.maxZoom = Math.max(map.options.maxZoom, basemap.maxZoom);
        }
        
        console.log(`Switched to ${basemapType} basemap (zoom: ${basemap.minZoom || 0}-${basemap.maxZoom || 25})`);
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
    if (!geoJSONData) {
        showError('No GeoJSON data to upload');
        return;
    }

    const tableName = document.getElementById('geoJSONTableName').value.trim();
    if (!tableName) {
        showError('Please enter a table name');
        return;
    }

    try {
        // Show progress
        const uploadProgress = document.getElementById('uploadProgress');
        const uploadStatus = document.getElementById('uploadStatus');

        if (uploadProgress) uploadProgress.style.display = 'block';
        if (uploadStatus) uploadStatus.textContent = 'Creating table...';

        // Create table schema from GeoJSON
        const tableSchema = createTableSchemaFromGeoJSON(geoJSONData, tableName);

        // Create table
        const newTable = await window.teableAPI.createTable(tableSchema);

        if (uploadStatus) uploadStatus.textContent = 'Uploading features...';

        // Upload features
        const records = geoJSONData.features.map(feature => {
            const fields = {
                geometry: JSON.stringify(feature.geometry), // Store as WKT or GeoJSON string
                ...feature.properties
            };
            return fields;
        });

        // Upload in batches
        const batchSize = 100;
        for (let i = 0; i < records.length; i += batchSize) {
            const batch = records.slice(i, i + batchSize);
            for (const record of batch) {
                await window.teableAPI.createRecord(newTable.id, record);
            }

            const progress = Math.round(((i + batch.length) / records.length) * 100);
            const progressBar = document.querySelector('.progress-bar');
            if (progressBar) progressBar.style.width = progress + '%';
            if (uploadStatus) uploadStatus.textContent = `Uploading... ${progress}%`;
        }

        // Create layer from uploaded data
        const layerConfig = {
            id: Date.now().toString(),
            name: tableName,
            tableId: newTable.id,
            geometryField: 'geometry',
            color: '#3498db',
            visible: true,
            type: 'geojson'
        };

        // Convert GeoJSON to records format
        const layerRecords = geoJSONData.features.map((feature, index) => ({
            id: `geojson_${index}`,
            fields: {
                geometry: JSON.stringify(feature.geometry),
                ...feature.properties
            }
        }));

        await createLayerFromData(layerRecords, layerConfig);

        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('addLayerModal'));
        modal.hide();

        // Reset form
        const geoJSONTableName = document.getElementById('geoJSONTableName');
        const geoJSONPreview = document.getElementById('geoJSONPreview');
        const progressBar = document.querySelector('.progress-bar');

        if (geoJSONTableName) geoJSONTableName.value = '';
        if (geoJSONPreview) geoJSONPreview.style.display = 'none';
        if (uploadProgress) uploadProgress.style.display = 'none';
        if (progressBar) progressBar.style.width = '0%';

        geoJSONData = null;

        showSuccess(`GeoJSON uploaded successfully! Created table "${tableName}" with ${records.length} features.`);
        updateLayersList();
	updateMapStatistics();

    } catch (error) {
        console.error('Error uploading GeoJSON:', error);
        showError('Failed to upload GeoJSON: ' + error.message);

        // Hide progress
        const uploadProgress = document.getElementById('uploadProgress');
        if (uploadProgress) uploadProgress.style.display = 'none';
    }
}

function createTableSchemaFromGeoJSON(geoJSON, tableName) {
    const fields = [
        { name: 'geometry', type: 'longText' } // Store geometry as text
    ];

    // Analyze properties to determine field types
    const propertyTypes = {};

    if (geoJSON.features && geoJSON.features.length > 0) {
        geoJSON.features.forEach(feature => {
            if (feature.properties) {
                Object.keys(feature.properties).forEach(key => {
                    const value = feature.properties[key];
                    if (value !== null && value !== undefined) {
                        const type = typeof value;
                        if (!propertyTypes[key]) {
                            propertyTypes[key] = new Set();
                        }
                        propertyTypes[key].add(type);
                    }
                });
            }
        });
    }

    // Create fields based on detected types
    Object.keys(propertyTypes).forEach(key => {
        const types = Array.from(propertyTypes[key]);
        let fieldType = 'singleLineText'; // default

        if (types.includes('number')) {
            fieldType = 'number';
        } else if (types.includes('boolean')) {
            fieldType = 'checkbox';
        } else if (types.length === 1 && types[0] === 'string') {
            fieldType = 'singleLineText';
        }

        fields.push({
            name: key,
            type: fieldType
        });
    });

    return {
        name: tableName,
        description: `Table created from GeoJSON upload`,
        fields: fields
    };
}

// Layer sorting
function setupLayerSorting() {
    // Implementation would go here
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

// Properties modal functions
function switchPropertiesTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.properties-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-pane').forEach(content => {
        content.style.display = 'none';
    });
    document.getElementById(tabName + '-tab').style.display = 'block';
}

function updateSymbologyType() {
    const symbologyTypeSelect = document.getElementById('propSymbologyType');
    if (!symbologyTypeSelect) {
        console.error('Symbology type selector not found');
        return;
    }
    
    const symbologyType = symbologyTypeSelect.value;
    console.log('Updating symbology type to:', symbologyType);
    
    // Get all symbology control sections
    const singleControls = document.getElementById('propSingleSymbol');
    const graduatedControls = document.getElementById('propGraduated');
    const categorizedControls = document.getElementById('propCategorized');

    // Debug: Check if elements exist
    console.log('Control elements found:', {
        single: !!singleControls,
        graduated: !!graduatedControls,
        categorized: !!categorizedControls
    });

    // Hide all controls first
    if (singleControls) {
        singleControls.style.display = 'none';
        console.log('Hidden single controls');
    }
    if (graduatedControls) {
        graduatedControls.style.display = 'none';
        console.log('Hidden graduated controls');
    }
    if (categorizedControls) {
        categorizedControls.style.display = 'none';
        console.log('Hidden categorized controls');
    }

    // Show relevant controls based on selection
    switch (symbologyType) {
        case 'single':
            if (singleControls) {
                singleControls.style.display = 'block';
                console.log('✅ Showing single symbology controls');
                
                // Ensure the single symbol styling is properly initialized
                if (window.currentPropertiesLayer) {
                    const layer = window.currentPropertiesLayer;
                    if (!layer.properties) layer.properties = {};
                    if (!layer.properties.symbology) layer.properties.symbology = {};
                    
                    // Set default single symbol properties if not already set
                    if (layer.properties.symbology.type !== 'single') {
                        layer.properties.symbology.type = 'single';
                        layer.properties.symbology.fillColor = layer.properties.symbology.fillColor || '#3498db';
                        layer.properties.symbology.borderColor = layer.properties.symbology.borderColor || '#2c3e50';
                        layer.properties.symbology.borderWidth = layer.properties.symbology.borderWidth || 2;
                        layer.properties.symbology.fillOpacity = layer.properties.symbology.fillOpacity || 0.7;
                        
                        console.log('Initialized single symbol properties for layer:', layer.name);
                    }
                }
            } else {
                console.error('❌ Single symbol controls not found - element with ID "propSingleSymbol" missing');
            }
            break;
            
        case 'graduated':
            if (graduatedControls) {
                graduatedControls.style.display = 'block';
                console.log('✅ Showing graduated symbology controls');
                
                // Populate field selectors when switching to graduated
                if (window.currentPropertiesLayer) {
                    populateFieldSelectors(window.currentPropertiesLayer);
                    
                    // Initialize graduated properties
                    const layer = window.currentPropertiesLayer;
                    if (!layer.properties) layer.properties = {};
                    if (!layer.properties.symbology) layer.properties.symbology = {};
                    layer.properties.symbology.type = 'graduated';
                }
            } else {
                console.error('❌ Graduated controls not found');
            }
            break;
            
        case 'categorized':
            if (categorizedControls) {
                categorizedControls.style.display = 'block';
                console.log('✅ Showing categorized symbology controls');
                
                // Populate field selectors when switching to categorized
                if (window.currentPropertiesLayer) {
                    populateFieldSelectors(window.currentPropertiesLayer);
                    
                    // Initialize categorized properties
                    const layer = window.currentPropertiesLayer;
                    if (!layer.properties) layer.properties = {};
                    if (!layer.properties.symbology) layer.properties.symbology = {};
                    layer.properties.symbology.type = 'categorized';
                }
            } else {
                console.error('❌ Categorized controls not found');
            }
            break;
            
        default:
            // Default to single symbol if no valid type selected or empty
            if (singleControls) {
                singleControls.style.display = 'block';
                console.log('⚠️ Defaulting to single symbology controls for type:', symbologyType);
                
                // Set default to single if undefined
                const symbologySelect = document.getElementById('propSymbologyType');
                if (symbologySelect && (!symbologyType || symbologyType === '')) {
                    symbologySelect.value = 'single';
                }
            }
            console.warn('Unknown or empty symbology type:', symbologyType, '- defaulting to single');
    }
    
    // Force a UI update to ensure visibility changes take effect
    setTimeout(() => {
        console.log('Final visibility states:', {
            single: singleControls ? singleControls.style.display : 'not found',
            graduated: graduatedControls ? graduatedControls.style.display : 'not found',
            categorized: categorizedControls ? categorizedControls.style.display : 'not found'
        });
    }, 100);
}

function updatePopupFieldSelection(fieldName, isSelected) {
    if (!window.currentPropertiesLayer) return;

    const layer = window.currentPropertiesLayer;
    if (!layer.properties) layer.properties = {};
    if (!layer.properties.popup) layer.properties.popup = {};
    if (!layer.properties.popup.fields) layer.properties.popup.fields = [];

    if (isSelected && !layer.properties.popup.fields.includes(fieldName)) {
        layer.properties.popup.fields.push(fieldName);
    } else if (!isSelected) {
        layer.properties.popup.fields = layer.properties.popup.fields.filter(f => f !== fieldName);
    }

    // Mark as configured when any field selection is made
    layer.properties.popup.configured = true;

    // Update the actual layer reference in mapLayers array immediately
    const layerIndex = mapLayers.findIndex(l => l.id === layer.id);
    if (layerIndex !== -1) {
        // Deep copy to ensure changes are reflected
        if (!mapLayers[layerIndex].properties) mapLayers[layerIndex].properties = {};
        if (!mapLayers[layerIndex].properties.popup) mapLayers[layerIndex].properties.popup = {};
        mapLayers[layerIndex].properties.popup.fields = [...layer.properties.popup.fields];
        mapLayers[layerIndex].properties.popup.configured = true;

        console.log(`Updated popup fields for layer "${layer.name}": ${layer.properties.popup.fields.join(', ')}`);
        console.log('Fields will be applied when "Apply" button is clicked.');
    }
}

function selectAllPopupFields() {
    const checkboxes = document.querySelectorAll('#propPopupFields input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
        const fieldName = checkbox.id.replace('popup_field_', '');
        updatePopupFieldSelection(fieldName, true);
    });
}

function deselectAllPopupFields() {
    const checkboxes = document.querySelectorAll('#propPopupFields input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
        const fieldName = checkbox.id.replace('popup_field_', '');
        updatePopupFieldSelection(fieldName, false);
    });
}

function generateGraduatedSymbology() {
    const field = document.getElementById('propGraduatedField').value;
    const classesInput = document.getElementById('propGraduatedClasses');
    const colorRampSelect = document.getElementById('propColorRamp');

    if (!field || !window.currentPropertiesLayer) {
        showError('Please select a field for graduated symbology');
        return;
    }

    if (!classesInput || !colorRampSelect) {
        showError('Graduated symbology controls not found');
        return;
    }

    const classes = parseInt(classesInput.value) || 5;
    const colorRamp = colorRampSelect.value || 'blues';

    const layer = window.currentPropertiesLayer;
    
    // Extract numeric values from the selected field
    const values = [];
    layer.records.forEach(record => {
        const value = record.fields[field];
        const numValue = parseFloat(value);
        if (!isNaN(numValue) && isFinite(numValue)) {
            values.push(numValue);
        }
    });

    if (values.length === 0) {
        showError('No numeric values found in the selected field');
        return;
    }

    // Calculate class breaks using equal intervals
    values.sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];
    
    if (min === max) {
        showError('All values are the same, cannot create graduated symbology');
        return;
    }
    
    const interval = (max - min) / classes;
    const breaks = [];
    const colors = generateColorRamp(colorRamp, classes);

    // Create legend with proper styling
    let legendHTML = '<div class="graduated-legend mt-3">';
    legendHTML += '<h6>Legend Preview</h6>';
    
    for (let i = 0; i < classes; i++) {
        const minVal = min + (i * interval);
        const maxVal = min + ((i + 1) * interval);
        breaks.push(maxVal);
        
        legendHTML += `
            <div class="legend-item d-flex align-items-center mb-2">
                <div class="legend-color me-2" style="
                    background-color: ${colors[i]}; 
                    width: 20px; 
                    height: 20px; 
                    border: 1px solid #ccc;
                    border-radius: 3px;
                "></div>
                <span class="small">${minVal.toFixed(2)} - ${maxVal.toFixed(2)}</span>
            </div>
        `;
    }
    legendHTML += '</div>';

    const legendContainer = document.getElementById('propGraduatedLegend');
    if (legendContainer) {
        legendContainer.innerHTML = legendHTML;
    }

    // Update layer properties
    if (!layer.properties) layer.properties = {};
    if (!layer.properties.symbology) layer.properties.symbology = {};
    
    layer.properties.symbology = {
        type: 'graduated',
        field: field,
        classes: classes,
        colorRamp: colorRamp,
        breaks: breaks,
        colors: colors,
        min: min,
        max: max,
        interval: interval
    };

    showSuccess(`Graduated symbology generated with ${classes} classes for field "${field}"`);
    console.log('Generated graduated symbology:', layer.properties.symbology);
}

function generateCategorizedSymbology() {
    const field = document.getElementById('propCategorizedField').value;

    if (!field || !window.currentPropertiesLayer) {
        showError('Please select a field for categorized symbology');
        return;
    }

    const layer = window.currentPropertiesLayer;
    
    // Extract unique values with counts
    const valueCount = new Map();
    layer.records.forEach(record => {
        const value = record.fields[field];
        if (value !== null && value !== undefined && value !== '') {
            const stringValue = String(value);
            valueCount.set(stringValue, (valueCount.get(stringValue) || 0) + 1);
        }
    });

    const uniqueValues = Array.from(valueCount.keys());

    if (uniqueValues.length === 0) {
        showError('No values found in the selected field');
        return;
    }

    if (uniqueValues.length > 20) {
        showWarning(`Field has ${uniqueValues.length} unique values. Consider using a field with fewer categories for better visualization.`);
    }

    // Generate colors using a better color palette
    const colors = generateColorPalette(uniqueValues.length);

    // Create legend with counts and better styling
    let legendHTML = '<div class="categorized-legend mt-3">';
    legendHTML += '<h6>Legend Preview</h6>';
    
    uniqueValues.forEach((value, index) => {
        const count = valueCount.get(value);
        legendHTML += `
            <div class="legend-item d-flex align-items-center mb-2">
                <div class="legend-color me-2" style="
                    background-color: ${colors[index]}; 
                    width: 20px; 
                    height: 20px; 
                    border: 1px solid #ccc;
                    border-radius: 3px;
                "></div>
                <span class="small flex-grow-1">${value}</span>
                <span class="badge bg-secondary ms-2">${count}</span>
            </div>
        `;
    });
    legendHTML += '</div>';

    const legendContainer = document.getElementById('propCategorizedLegend');
    if (legendContainer) {
        legendContainer.innerHTML = legendHTML;
    }

    // Update layer properties
    if (!layer.properties) layer.properties = {};
    if (!layer.properties.symbology) layer.properties.symbology = {};
    
    layer.properties.symbology = {
        type: 'categorized',
        field: field,
        categories: uniqueValues.map((value, index) => ({
            value: value,
            color: colors[index],
            label: String(value),
            count: valueCount.get(value)
        }))
    };

    showSuccess(`Categorized symbology generated with ${uniqueValues.length} categories for field "${field}"`);
    console.log('Generated categorized symbology:', layer.properties.symbology);
}

function generateColorRamp(rampName, count) {
    const ramps = {
        blues: ['#08519c', '#3182bd', '#6baed6', '#9ecae1', '#c6dbef'],
        greens: ['#006d2c', '#31a354', '#74c476', '#a1d99b', '#c7e9c0'],
        reds: ['#a50f15', '#de2d26', '#fb6a4a', '#fc9272', '#fcbba1'],
        oranges: ['#b30000', '#e34a33', '#fc8d59', '#fdbb84', '#fdd49e'],
        purples: ['#54278f', '#756bb1', '#9e9ac8', '#bcbddc', '#dadaeb']
    };

    const baseColors = ramps[rampName] || ramps.blues;

    if (count <= baseColors.length) {
        return baseColors.slice(0, count);
    }

    // Interpolate colors if we need more than available
    const colors = [];
    for (let i = 0; i < count; i++) {
        const ratio = i / (count - 1);
        const index = ratio * (baseColors.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);

        if (lower === upper) {
            colors.push(baseColors[lower]);
        } else {
            // Simple interpolation
            colors.push(baseColors[lower]); // For simplicity, just use the lower color
        }
    }

    return colors;
}

function generateColorPalette(count) {
    const colors = [];
    const hueStep = 360 / count;

    for (let i = 0; i < count; i++) {
        const hue = (i * hueStep) % 360;
        const saturation = 70 + (i % 3) * 10;
        const lightness = 50 + (i % 2) * 10;

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

function applyProperties() {
    if (!window.currentPropertiesLayer) {
        showError('No layer selected for properties update');
        return;
    }

    const layer = window.currentPropertiesLayer;

    // Update layer name
    layer.name = document.getElementById('propLayerName').value;

    // Update symbology properties
    if (!layer.properties) layer.properties = {};
    if (!layer.properties.symbology) layer.properties.symbology = {};

    // Get current symbology type
    const symbologyType = document.getElementById('propSymbologyType').value || 'single';
    layer.properties.symbology.type = symbologyType;
    
    // Update common properties
    const fillColor = document.getElementById('propFillColor').value;
    const borderColor = document.getElementById('propBorderColor').value;
    const borderWidth = parseInt(document.getElementById('propBorderWidth').value);
    const fillOpacity = parseFloat(document.getElementById('propFillOpacity').value);
    
    if (fillColor) layer.properties.symbology.fillColor = fillColor;
    if (borderColor) layer.properties.symbology.borderColor = borderColor;
    if (!isNaN(borderWidth)) layer.properties.symbology.borderWidth = borderWidth;
    if (!isNaN(fillOpacity)) layer.properties.symbology.fillOpacity = fillOpacity;
    
    console.log('Updated symbology properties:', {
        type: symbologyType,
        fillColor: fillColor,
        borderColor: borderColor,
        borderWidth: borderWidth,
        fillOpacity: fillOpacity
    });

    // Update labels properties
    if (!layer.properties.labels) layer.properties.labels = {};
    layer.properties.labels.enabled = document.getElementById('propEnableLabels').checked;
    layer.properties.labels.field = document.getElementById('propLabelField').value;
    layer.properties.labels.fontSize = parseInt(document.getElementById('propLabelSize').value);
    layer.properties.labels.color = document.getElementById('propLabelColor').value;
    layer.properties.labels.background = document.getElementById('propLabelBackground').checked;

    // Update popup properties with all iTool settings
    if (!layer.properties.popup) layer.properties.popup = {};
    
    // Get popup enabled state FIRST before applying other settings
    const popupEnabledCheckbox = document.getElementById('propEnablePopups');
    const popupEnabled = popupEnabledCheckbox ? popupEnabledCheckbox.checked : true;
    layer.properties.popup.enabled = popupEnabled;
    
    console.log(`Applying popup enabled state: ${popupEnabled} for layer "${layer.name}"`);
    
    // Apply all popup settings
    updateLayerPopupSettings(layer);
    
    // Collect selected popup fields from checkboxes
    const selectedPopupFields = [];
    const popupCheckboxes = document.querySelectorAll('#propPopupFields input[type="checkbox"]:checked');
    popupCheckboxes.forEach(checkbox => {
        const fieldName = checkbox.id.replace('popup_field_', '');
        selectedPopupFields.push(fieldName);
    });
    
    // Update popup fields in layer properties and mark as configured
    layer.properties.popup.fields = selectedPopupFields;
    layer.properties.popup.configured = true;
    
    console.log(`Applying popup configuration for layer "${layer.name}"`);
    console.log(`Selected popup fields: ${selectedPopupFields.join(', ')}`);
    console.log(`Total selected fields: ${selectedPopupFields.length}`);

    // Update the actual layer reference in mapLayers array
    const layerIndex = mapLayers.findIndex(l => l.id === layer.id);
    if (layerIndex !== -1) {
        // Deep copy the updated properties to ensure changes persist
        mapLayers[layerIndex].properties = JSON.parse(JSON.stringify(layer.properties));
        mapLayers[layerIndex].name = layer.name;

        // Force update all existing feature popups with new field configuration
        if (mapLayers[layerIndex].features && mapLayers[layerIndex].records) {
            console.log(`Updating popups for ${mapLayers[layerIndex].features.length} features`);
            
            mapLayers[layerIndex].features.forEach((feature, index) => {
                // Get the record data for this feature
                const recordData = mapLayers[layerIndex].records[index]?.fields;
                
                if (recordData) {
                    // Update the cached record data on the feature
                    feature.recordData = recordData;
                    feature.layerId = mapLayers[layerIndex].id;
                    feature.featureIndex = index;
                    
                    // Create new popup content with updated field configuration
                    const newPopupContent = createFeaturePopup(recordData, mapLayers[layerIndex]);
                    
                    // Remove existing popup if it exists
                    if (feature.getPopup()) {
                        feature.unbindPopup();
                    }
                    
                    // Bind new popup with updated content
                    feature.bindPopup(newPopupContent);
                    
                    // Update click handler to use new configuration
                    feature.off('click');
                    feature.on('click', function(e) {
                        window.currentPopupFeature = this;
                        handleFeatureClick(this, index, mapLayers[layerIndex]);
                    });
                }
            });
            
            console.log(`Successfully updated popups for all features in layer "${layer.name}"`);
        }
    }

    // Apply visual styling changes to map features
    applyLayerStyling(layer);

    // Apply labels if enabled
    if (layer.properties.labels && layer.properties.labels.enabled) {
        applyLabelsToLayer(layer);
    } else {
        // Remove labels if disabled
        if (layer.labelGroup) {
            map.removeLayer(layer.labelGroup);
            layer.labelGroup = null;
        }
    }

    // Update layers list to reflect changes
    updateLayersList();

    const fieldCount = selectedPopupFields.length;
    const message = fieldCount === 0 ? 
        'Layer properties applied! Popup will show no fields.' : 
        `Layer properties applied! Popup will show ${fieldCount} selected field(s): ${selectedPopupFields.join(', ')}.`;
    
    showSuccess(message);
}

function applyAndCloseProperties() {
    applyProperties();
    const modal = bootstrap.Modal.getInstance(document.getElementById('layerPropertiesModal'));
    if (modal) {
        modal.hide();
    }
}

function cancelProperties() {
    const modal = bootstrap.Modal.getInstance(document.getElementById('layerPropertiesModal'));
    if (modal) {
        modal.hide();
    }
}

function applyLayerStyling(layer) {
    if (!layer.features || !layer.properties) {
        console.warn('Layer missing features or properties for styling');
        return;
    }

    // Ensure symbology exists with defaults
    if (!layer.properties.symbology) {
        layer.properties.symbology = {
            type: 'single',
            fillColor: '#3498db',
            borderColor: '#2c3e50',
            borderWidth: 2,
            fillOpacity: 0.7
        };
        console.log('Created default symbology for layer:', layer.name);
    }

    const symbology = layer.properties.symbology;
    console.log(`Applying ${symbology.type} symbology to layer "${layer.name}" with ${layer.features.length} features`);

    let styledCount = 0;

    layer.features.forEach((feature, index) => {
        if (!feature.setStyle) {
            console.warn(`Feature ${index} does not have setStyle method`);
            return;
        }

        // Base style properties
        let style = {
            weight: symbology.borderWidth || 2,
            fillOpacity: symbology.fillOpacity || 0.7,
            opacity: 1
        };

        // Apply styling based on symbology type
        switch (symbology.type) {
            case 'single':
                style.fillColor = symbology.fillColor || '#3498db';
                style.color = symbology.borderColor || '#2c3e50';
                console.log(`Applied single color: fill=${style.fillColor}, border=${style.color}`);
                break;

            case 'graduated':
                if (symbology.field && feature.recordData && feature.recordData[symbology.field] !== undefined) {
                    const featureValue = parseFloat(feature.recordData[symbology.field]);
                    if (!isNaN(featureValue) && symbology.breaks && symbology.colors) {
                        // Find which class the value belongs to
                        let classIndex = 0;
                        for (let i = 0; i < symbology.breaks.length; i++) {
                            if (featureValue <= symbology.breaks[i]) {
                                classIndex = i;
                                break;
                            }
                        }
                        style.fillColor = symbology.colors[classIndex] || '#3498db';
                        style.color = symbology.borderColor || '#2c3e50';
                    } else {
                        // Use default color for non-numeric values
                        style.fillColor = '#cccccc';
                        style.color = '#999999';
                    }
                } else {
                    // No field specified or no data - use default
                    style.fillColor = symbology.fillColor || '#3498db';
                    style.color = symbology.borderColor || '#2c3e50';
                }
                break;

            case 'categorized':
                if (symbology.field && feature.recordData && feature.recordData[symbology.field] !== undefined) {
                    const featureCategory = String(feature.recordData[symbology.field]);
                    const category = symbology.categories && symbology.categories.find(cat => String(cat.value) === featureCategory);
                    if (category) {
                        style.fillColor = category.color;
                        style.color = symbology.borderColor || '#2c3e50';
                    } else {
                        // Use default color for uncategorized values
                        style.fillColor = '#cccccc';
                        style.color = '#999999';
                    }
                } else {
                    // No field specified or no data - use default
                    style.fillColor = symbology.fillColor || '#3498db';
                    style.color = symbology.borderColor || '#2c3e50';
                }
                break;

            default:
                // Fallback to single symbol styling
                style.fillColor = symbology.fillColor || '#3498db';
                style.color = symbology.borderColor || '#2c3e50';
                console.warn(`Unknown symbology type "${symbology.type}", using single symbol fallback`);
        }

        // Apply the style to the feature
        try {
            feature.setStyle(style);
            styledCount++;
        } catch (error) {
            console.error(`Error applying style to feature ${index}:`, error);
        }
    });

    console.log(`✅ Successfully styled ${styledCount}/${layer.features.length} features with ${symbology.type} symbology`);

    // Apply labels if enabled
    if (layer.properties.labels && layer.properties.labels.enabled) {
        applyLabelsToLayer(layer);
    }
}

function applyLabelsToLayer(layer) {
    // Remove existing labels
    if (layer.labelGroup) {
        map.removeLayer(layer.labelGroup);
        layer.labelGroup = null;
    }

    const labels = layer.properties.labels;
    if (!labels.enabled || !labels.field) return;

    const labelElements = [];

    layer.features.forEach((feature, index) => {
        const record = layer.records[index];
        if (!record || !record.fields[labels.field]) return;

        const labelText = String(record.fields[labels.field]);
        const fontSize = labels.fontSize || 12;
        const color = labels.color || '#2c3e50';
        const background = labels.background !== false;

        // For polygons, use tooltip approach for better integration
        if (feature.getBounds) {
            // Calculate the visual center of the polygon for better label placement
            const bounds = feature.getBounds();
            const center = bounds.getCenter();
            
            // Create a transparent marker at the center for label positioning
            const labelMarker = L.marker(center, {
                icon: L.divIcon({
                    className: 'polygon-label-marker',
                    html: `<div class="polygon-label" style="
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        font-size: ${fontSize}px;
                        color: ${color};
                        font-weight: 600;
                        text-align: center;
                        white-space: nowrap;
                        pointer-events: none;
                        line-height: 1.2;
                        position: absolute;
                        transform: translate(-50%, -50%);
                        z-index: 1000;
                        ${background ? `
                            background: rgba(255, 255, 255, 0.9);
                            padding: 2px 6px;
                            border-radius: 4px;
                            border: 1px solid ${color};
                            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                        ` : `
                            text-shadow: 
                                -1px -1px 0px rgba(255,255,255,0.8),
                                1px -1px 0px rgba(255,255,255,0.8),
                                -1px 1px 0px rgba(255,255,255,0.8),
                                1px 1px 0px rgba(255,255,255,0.8),
                                0px 0px 2px rgba(0,0,0,0.8);
                        `}
                    ">${truncateText(labelText, 10)}</div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0]
                }),
                interactive: false
            });

            labelElements.push(labelMarker);

        } else if (feature.getLatLng) {
            // For point features, use the existing approach but improved
            const labelPosition = feature.getLatLng();
            
            const labelMarker = L.marker(labelPosition, {
                icon: L.divIcon({
                    className: 'point-label-marker',
                    html: `<div class="point-label" style="
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        font-size: ${fontSize}px;
                        color: ${color};
                        font-weight: 600;
                        text-align: center;
                        white-space: nowrap;
                        pointer-events: none;
                        line-height: 1.2;
                        position: absolute;
                        transform: translate(-50%, -200%);
                        z-index: 1000;
                        ${background ? `
                            background: rgba(255, 255, 255, 0.9);
                            padding: 2px 6px;
                            border-radius: 4px;
                            border: 1px solid ${color};
                            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                        ` : `
                            text-shadow: 
                                -1px -1px 0px rgba(255,255,255,0.8),
                                1px -1px 0px rgba(255,255,255,0.8),
                                -1px 1px 0px rgba(255,255,255,0.8),
                                1px 1px 0px rgba(255,255,255,0.8),
                                0px 0px 2px rgba(0,0,0,0.8);
                        `}
                    ">${truncateText(labelText, 10)}</div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0]
                }),
                interactive: false
            });

            labelElements.push(labelMarker);
        }
    });

    if (labelElements.length > 0) {
        layer.labelGroup = L.layerGroup(labelElements);
        if (layer.visible) {
            layer.labelGroup.addTo(map);
        }
    }
}

function calculateLabelOffset(position, index, totalLabels) {
    // Calculate smart positioning to reduce overlap
    const baseOffset = 15;
    const spacing = 25;
    
    // For small numbers of features, use center positioning
    if (totalLabels < 10) {
        return { x: 0, y: 0 };
    }
    
    // For larger numbers, create a slight offset pattern
    const angle = (index * 45) % 360; // Rotate through different angles
    const radius = baseOffset + (index % 3) * 5; // Vary the distance
    
    const x = Math.cos(angle * Math.PI / 180) * radius;
    const y = Math.sin(angle * Math.PI / 180) * radius;
    
    return { x: Math.round(x), y: Math.round(y) };
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 1) + '…';
}

// Additional iTool utility functions
function filterPopupFields(searchTerm) {
    const fields = document.querySelectorAll('.popup-field, tr[data-field], .card[data-field]');
    fields.forEach(field => {
        const fieldName = field.dataset.field || '';
        const fieldContent = field.textContent.toLowerCase();
        const isVisible = fieldName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         fieldContent.includes(searchTerm.toLowerCase());
        field.style.display = isVisible ? '' : 'none';
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showSuccess('Copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showSuccess('Copied to clipboard!');
    });
}

function previewPopup() {
    if (!window.currentPropertiesLayer || !window.currentPropertiesLayer.records) {
        showError('No layer selected or no data available for preview');
        return;
    }
    
    const layer = window.currentPropertiesLayer;
    const sampleRecord = layer.records[0];
    
    if (!sampleRecord || !sampleRecord.fields) {
        showError('No sample data available for preview');
        return;
    }
    
    // Apply current settings to layer temporarily for preview
    updateLayerPopupSettings(layer);
    
    // Generate preview content
    const previewContent = createFeaturePopup(sampleRecord.fields, layer);
    
    // Display in preview area
    document.getElementById('popupPreview').innerHTML = previewContent;
}

function updateLayerPopupSettings(layer) {
    if (!layer.properties) layer.properties = {};
    if (!layer.properties.popup) layer.properties.popup = {};
    
    // Get popup enabled state - this should already be set but ensure consistency
    const enablePopupsCheckbox = document.getElementById('propEnablePopups');
    const popupEnabled = enablePopupsCheckbox ? enablePopupsCheckbox.checked : true;
    layer.properties.popup.enabled = popupEnabled;
    
    // Only update other popup settings if popups are enabled
    if (!popupEnabled) {
        console.log(`Popups disabled for layer "${layer.name}" - skipping detailed popup configuration`);
        return;
    }
    layer.properties.popup.template = document.getElementById('propPopupTemplate')?.value || 'default';
    layer.properties.popup.maxWidth = parseInt(document.getElementById('propMaxPopupWidth')?.value) || 300;
    layer.properties.popup.maxFieldLength = parseInt(document.getElementById('propMaxFieldLength')?.value) || 100;
    layer.properties.popup.position = document.getElementById('propPopupPosition')?.value || 'auto';
    layer.properties.popup.showEmptyFields = document.getElementById('propShowEmptyFields')?.checked || false;
    layer.properties.popup.showFieldIcons = document.getElementById('propShowFieldIcons')?.checked !== false;
    layer.properties.popup.highlightLinks = document.getElementById('propHighlightLinks')?.checked !== false;
    layer.properties.popup.showTooltips = document.getElementById('propShowTooltips')?.checked || false;
    layer.properties.popup.enableSearch = document.getElementById('propEnableSearch')?.checked || false;
    layer.properties.popup.showCopyButtons = document.getElementById('propShowCopyButtons')?.checked || false;
    layer.properties.popup.enableFieldSorting = document.getElementById('propEnableFieldSorting')?.checked || false;
    layer.properties.popup.customTemplate = document.getElementById('propCustomTemplate')?.value || '';
    
    // Controls
    if (!layer.properties.popup.controls) layer.properties.popup.controls = {};
    layer.properties.popup.controls.showZoomControls = document.getElementById('propShowZoomControls')?.checked !== false;
    layer.properties.popup.controls.showCenterControl = document.getElementById('propShowCenterControl')?.checked !== false;
    layer.properties.popup.controls.showExportControl = document.getElementById('propShowExportControl')?.checked || false;
    layer.properties.popup.controls.showEditControl = document.getElementById('propShowEditControl')?.checked || false;
}

function exportCurrentFeature() {
    if (!window.currentPopupFeature || !window.currentPopupFeature.recordData) {
        showError('No feature data available for export');
        return;
    }
    
    const data = window.currentPopupFeature.recordData;
    const csvContent = Object.keys(data).map(key => `${key},"${data[key]}"`).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'feature_data.csv';
    link.click();
    URL.revokeObjectURL(url);
    
    showSuccess('Feature data exported successfully!');
}

function editCurrentFeature() {
    showInfo('Feature editing functionality would be implemented here based on permissions');
}

// Template change handler
function handleTemplateChange() {
    const template = document.getElementById('propPopupTemplate')?.value;
    const customSection = document.getElementById('customTemplateSection');
    
    if (template === 'custom' && customSection) {
        customSection.style.display = 'block';
    } else if (customSection) {
        customSection.style.display = 'none';
    }
}

// Popup enable/disable handler
function handlePopupToggle() {
    const enabledCheckbox = document.getElementById('propEnablePopups');
    if (!enabledCheckbox) {
        console.error('Enable popups checkbox not found');
        return;
    }
    
    const enabled = enabledCheckbox.checked;
    console.log('Popup toggle changed to:', enabled);
    
    // Find all popup configuration sections that should be toggled
    const configSections = [
        'popupConfigSection',
        'popupTemplateSection', 
        'popupFieldsSection',
        'popupAdvancedSection',
        'popupControlsSection'
    ];
    
    configSections.forEach(sectionId => {
        const section = document.getElementById(sectionId);
        if (section) {
            section.style.display = enabled ? 'block' : 'none';
            console.log(`Section ${sectionId} ${enabled ? 'shown' : 'hidden'}`);
        }
    });
    
    // Also toggle individual popup configuration controls
    const popupControls = document.querySelectorAll('.popup-config-control');
    popupControls.forEach(control => {
        control.style.display = enabled ? 'block' : 'none';
    });
    
    // Toggle the main popup configuration container
    const mainPopupConfig = document.querySelector('.popup-configuration');
    if (mainPopupConfig) {
        mainPopupConfig.style.display = enabled ? 'block' : 'none';
    }
    
    // Update the layer's popup enabled state immediately
    if (window.currentPropertiesLayer) {
        if (!window.currentPropertiesLayer.properties) {
            window.currentPropertiesLayer.properties = {};
        }
        if (!window.currentPropertiesLayer.properties.popup) {
            window.currentPropertiesLayer.properties.popup = {};
        }
        window.currentPropertiesLayer.properties.popup.enabled = enabled;
        
        console.log(`✅ Popup ${enabled ? 'enabled' : 'disabled'} for layer: ${window.currentPropertiesLayer.name}`);
        
        // If disabling popups, also update all existing feature popups
        if (!enabled && window.currentPropertiesLayer.features) {
            window.currentPropertiesLayer.features.forEach(feature => {
                if (feature.getPopup && feature.getPopup()) {
                    feature.unbindPopup();
                }
            });
            console.log('Removed existing popups from all features');
        }
        
        // If enabling popups, rebind popups to all features
        if (enabled && window.currentPropertiesLayer.features && window.currentPropertiesLayer.records) {
            window.currentPropertiesLayer.features.forEach((feature, index) => {
                const recordData = window.currentPropertiesLayer.records[index]?.fields;
                if (recordData) {
                    const popupContent = createFeaturePopup(recordData, window.currentPropertiesLayer);
                    feature.bindPopup(popupContent);
                }
            });
            console.log('Rebound popups to all features');
        }
    }
    
    // Show user feedback
    if (enabled) {
        showSuccess('Popups enabled for this layer');
    } else {
        showInfo('Popups disabled for this layer');
    }
}

// Inline editing functionality
function setupInlineEditing(layer) {
    // Add CSS for inline editing if not already added
    if (!document.getElementById('inlineEditingStyles')) {
        const styles = document.createElement('style');
        styles.id = 'inlineEditingStyles';
        styles.textContent = `
            .editable-cell {
                cursor: pointer;
                transition: background-color 0.2s;
                border-left: 3px solid transparent;
            }
            .editable-cell:hover {
                background-color: #f8f9fa;
            }
            .readonly-cell {
                border-left: 3px solid transparent;
            }
            .border-success {
                border-left-color: #28a745 !important;
            }
            .border-info {
                border-left-color: #17a2b8 !important;
            }
            .border-danger {
                border-left-color: #dc3545 !important;
            }
            .edit-icon, .view-icon {
                opacity: 0.6;
                font-size: 0.75em;
            }
            .editable-cell:hover .edit-icon {
                opacity: 1;
            }
            .inline-editor {
                width: 100%;
                border: 2px solid #007bff;
                border-radius: 4px;
                padding: 4px 8px;
                font-size: 0.875rem;
                background: #fff;
            }
            .inline-editor:focus {
                outline: none;
                border-color: #0056b3;
                box-shadow: 0 0 0 0.2rem rgba(0, 123, 255, 0.25);
            }
            .save-cancel-buttons {
                margin-top: 4px;
            }
            .permission-indicator .badge {
                font-size: 0.7em;
            }
        `;
        document.head.appendChild(styles);
    }
}

function startInlineEdit(cell) {
    // Only allow editing in editing mode
    if (!isTableEditingMode) {
        showWarning('Please click "Start Editing" button first to enable editing mode.');
        return;
    }
    
    if (cell.querySelector('.inline-editor')) {
        return; // Already editing
    }
    
    const fieldName = cell.getAttribute('data-field');
    const recordId = cell.getAttribute('data-record-id');
    const originalValue = cell.getAttribute('data-original-value') || '';
    
    // Get table ID and layer for field type detection
    const row = cell.closest('tr');
    const tableId = row.getAttribute('data-table-id');
    const layer = mapLayers.find(l => l.tableId === tableId);
    
    // Detect field type
    const fieldType = layer ? detectFieldType(layer, fieldName, originalValue) : 'text';
    
    // Create input element with appropriate type and validation
    const input = document.createElement('input');
    input.className = 'inline-editor';
    input.value = originalValue;
    
    // Set input type and attributes based on field type
    switch (fieldType) {
        case 'number':
            input.type = 'number';
            input.step = 'any';
            input.placeholder = 'Enter number';
            break;
        case 'boolean':
            input.type = 'text';
            input.placeholder = 'true or false';
            input.setAttribute('list', 'booleanOptions');
            // Create datalist for boolean options
            if (!document.getElementById('booleanOptions')) {
                const datalist = document.createElement('datalist');
                datalist.id = 'booleanOptions';
                datalist.innerHTML = '<option value="true"><option value="false">';
                document.body.appendChild(datalist);
            }
            break;
        case 'date':
            input.type = 'date';
            input.placeholder = 'YYYY-MM-DD';
            break;
        default:
            input.type = 'text';
            input.placeholder = 'Enter text';
    }
    
    // Create save/cancel buttons with field type indicator
    const buttonsDiv = document.createElement('div');
    buttonsDiv.className = 'save-cancel-buttons';
    buttonsDiv.innerHTML = `
        <small class="text-muted me-2">${fieldType}</small>
        <button class="btn btn-xs btn-success me-1" onclick="saveInlineEdit(this, '${recordId}', '${fieldName}')">
            <i class="fas fa-check"></i>
        </button>
        <button class="btn btn-xs btn-secondary" onclick="cancelInlineEdit(this, '${escapeHtml(originalValue)}')">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Replace cell content
    cell.innerHTML = '';
    cell.appendChild(input);
    cell.appendChild(buttonsDiv);
    
    // Focus and select input
    input.focus();
    input.select();
    
    // Handle Enter and Escape keys
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            saveInlineEdit(buttonsDiv.querySelector('.btn-success'), recordId, fieldName);
        } else if (e.key === 'Escape') {
            cancelInlineEdit(buttonsDiv.querySelector('.btn-secondary'), originalValue);
        }
    });
    
    // Add real-time validation feedback
    input.addEventListener('input', function() {
        const value = this.value;
        let isValid = true;
        let errorMessage = '';
        
        if (value !== '' && value !== null && value !== undefined) {
            try {
                convertValueByType(value, fieldType);
            } catch (error) {
                isValid = false;
                errorMessage = error.message;
            }
        }
        
        // Update input styling based on validation
        if (isValid) {
            this.style.borderColor = '#28a745';
            this.style.backgroundColor = '#f8fff9';
            this.title = '';
        } else {
            this.style.borderColor = '#dc3545';
            this.style.backgroundColor = '#fff5f5';
            this.title = errorMessage;
        }
        
        // Enable/disable save button
        const saveButton = buttonsDiv.querySelector('.btn-success');
        if (saveButton) {
            saveButton.disabled = !isValid;
        }
    });
}

async function saveInlineEdit(button, recordId, fieldName) {
    const cell = button.closest('td');
    const input = cell.querySelector('.inline-editor');
    const rawValue = input.value;
    const originalValue = cell.getAttribute('data-original-value') || '';
    
    if (rawValue === originalValue) {
        cancelInlineEdit(button, originalValue);
        return;
    }
    
    try {
        // Get table ID from row
        const row = cell.closest('tr');
        const tableId = row.getAttribute('data-table-id');
        
        if (!tableId) {
            throw new Error('Table ID not found');
        }
        
        // Get layer and field information for type validation
        const layer = mapLayers.find(l => l.tableId === tableId);
        if (!layer) {
            throw new Error('Layer not found');
        }
        
        // Detect field type and convert value accordingly
        let convertedValue = rawValue;
        const fieldType = detectFieldType(layer, fieldName, rawValue);
        
        try {
            convertedValue = convertValueByType(rawValue, fieldType);
        } catch (conversionError) {
            throw new Error(`Invalid ${fieldType} value: ${rawValue}`);
        }
        
        // Store the change for batch saving
        const changeKey = `${recordId}_${fieldName}`;
        editingChanges.set(changeKey, {
            recordId: recordId,
            fieldName: fieldName,
            newValue: convertedValue,
            originalValue: originalValue,
            fieldType: fieldType
        });
        
        // Update cell display with new value
        const displayValue = String(convertedValue).length > 50 ? 
            String(convertedValue).substring(0, 50) + '...' : String(convertedValue);
        cell.setAttribute('data-original-value', convertedValue);
        cell.title = `Modified: ${convertedValue} (will be saved when you click Save Editing)`;
        cell.innerHTML = `
            <div class="editable-content modified">
                ${escapeHtml(displayValue)}
                <i class="fas fa-edit edit-icon ms-1" style="color: #ffc107;"></i>
                <i class="fas fa-clock ms-1 text-warning" title="Pending save"></i>
            </div>
        `;
        
        // Re-add click handler for further editing
        cell.onclick = function() { startInlineEdit(this); };
        
        // Update save button to show pending changes count
        const saveBtn = document.getElementById('saveEditingBtn');
        if (saveBtn) {
            saveBtn.innerHTML = `<i class="fas fa-save me-1"></i>Save Editing (${editingChanges.size})`;
            saveBtn.classList.add('btn-warning');
            saveBtn.classList.remove('btn-success');
        }
        
        showInfo(`Field "${fieldName}" marked for saving. Click "Save Editing" to commit all changes.`);
        
    } catch (error) {
        console.error('Error processing field change:', error);
        showError(`Invalid value: ${error.message}`);
        
        // Restore original content
        cancelInlineEdit(button, originalValue);
    }
}

function detectFieldType(layer, fieldName, value) {
    // First check existing data to determine field type
    if (layer.records && layer.records.length > 0) {
        for (const record of layer.records) {
            const existingValue = record.fields[fieldName];
            if (existingValue !== null && existingValue !== undefined && existingValue !== '') {
                if (typeof existingValue === 'number') {
                    return 'number';
                } else if (typeof existingValue === 'boolean') {
                    return 'boolean';
                } else if (typeof existingValue === 'string') {
                    // Check if it's a date string
                    if (existingValue.match(/^\d{4}-\d{2}-\d{2}/)) {
                        return 'date';
                    }
                    return 'text';
                }
            }
        }
    }
    
    // If no existing data, try to infer from the input value
    if (value === '' || value === null || value === undefined) {
        return 'text';
    }
    
    // Check if it's a number
    if (!isNaN(parseFloat(value)) && isFinite(value)) {
        return 'number';
    }
    
    // Check if it's a boolean
    if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
        return 'boolean';
    }
    
    // Check if it's a date
    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
        return 'date';
    }
    
    return 'text';
}

function convertValueByType(value, fieldType) {
    if (value === '' || value === null || value === undefined) {
        return null;
    }
    
    switch (fieldType) {
        case 'number':
            const numValue = parseFloat(value);
            if (isNaN(numValue) || !isFinite(numValue)) {
                throw new Error(`"${value}" is not a valid number`);
            }
            return numValue;
            
        case 'boolean':
            if (typeof value === 'boolean') {
                return value;
            }
            const strValue = String(value).toLowerCase();
            if (strValue === 'true' || strValue === '1' || strValue === 'yes') {
                return true;
            } else if (strValue === 'false' || strValue === '0' || strValue === 'no') {
                return false;
            } else {
                throw new Error(`"${value}" is not a valid boolean value`);
            }
            
        case 'date':
            // Basic date validation
            if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
                const date = new Date(value);
                if (isNaN(date.getTime())) {
                    throw new Error(`"${value}" is not a valid date`);
                }
                return value;
            } else {
                throw new Error(`"${value}" is not a valid date format (YYYY-MM-DD)`);
            }
            
        case 'text':
        default:
            return String(value);
    }
}

function cancelInlineEdit(button, originalValue) {
    const cell = button.closest('td');
    const displayValue = originalValue.length > 50 ? originalValue.substring(0, 50) + '...' : originalValue;
    
    // Check if this field had pending changes and remove them
    const recordId = cell.getAttribute('data-record-id');
    const fieldName = cell.getAttribute('data-field');
    const changeKey = `${recordId}_${fieldName}`;
    
    if (editingChanges.has(changeKey)) {
        editingChanges.delete(changeKey);
        
        // Update save button
        const saveBtn = document.getElementById('saveEditingBtn');
        if (saveBtn) {
            if (editingChanges.size === 0) {
                saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save Editing';
                saveBtn.classList.remove('btn-warning');
                saveBtn.classList.add('btn-success');
            } else {
                saveBtn.innerHTML = `<i class="fas fa-save me-1"></i>Save Editing (${editingChanges.size})`;
            }
        }
    }
    
    cell.innerHTML = `
        <div class="editable-content">
            ${escapeHtml(displayValue)}
            <i class="fas fa-edit edit-icon ms-1 text-success"></i>
        </div>
    `;
    
    // Re-add click handler if in editing mode
    if (isTableEditingMode) {
        cell.onclick = function() { startInlineEdit(this); };
    }
}

async function addNewRecord(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) {
        showError('Layer not found');
        return;
    }
    
    if (!canEditRecords()) {
        showError('You do not have permission to add records');
        return;
    }
    
    try {
        // Get all fields from layer (not just first record)
        let allFields = [];
        if (layer.records && layer.records.length > 0) {
            // Get all unique field names from all records
            const fieldSet = new Set();
            layer.records.forEach(record => {
                if (record.fields) {
                    Object.keys(record.fields).forEach(field => {
                        if (field !== layer.geometryField) {
                            fieldSet.add(field);
                        }
                    });
                }
            });
            allFields = Array.from(fieldSet);
        } else {
            // If no records exist, get fields from table schema
            try {
                const tableFields = await window.teableAPI.getTableFields(layer.tableId);
                allFields = tableFields.map(field => field.name).filter(name => name !== layer.geometryField);
            } catch (error) {
                console.warn('Could not get table fields:', error);
                allFields = [];
            }
        }
        
        // Filter to only editable fields
        const editableFields = allFields.filter(field => 
            getFieldPermission(field, layer) === 'edit'
        );
        
        if (editableFields.length === 0) {
            showWarning('No editable fields available. You can still create a record, but it will only contain default values.');
            // Still allow creation with empty record
        }
        
        // Show modal for new record
        showNewRecordModal(layer, editableFields);
        
    } catch (error) {
        console.error('Error preparing new record:', error);
        showError('Failed to prepare new record: ' + error.message);
    }
}

function showNewRecordModal(layer, editableFields) {
    // Get field types for better input controls
    const getInputType = (fieldName) => {
        if (layer.records && layer.records.length > 0) {
            // Analyze existing data to determine field type
            for (const record of layer.records) {
                const value = record.fields[fieldName];
                if (value !== null && value !== undefined && value !== '') {
                    if (typeof value === 'number') {
                        return 'number';
                    } else if (typeof value === 'boolean') {
                        return 'checkbox';
                    } else if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
                        return 'date';
                    }
                }
            }
        }
        return 'text';
    };

    const createFieldInput = (field) => {
        const inputType = getInputType(field);
        let inputHTML = '';
        
        switch (inputType) {
            case 'number':
                inputHTML = `<input type="number" step="any" class="form-control" name="${field}" placeholder="Enter ${field}">`;
                break;
            case 'checkbox':
                inputHTML = `
                    <select class="form-control" name="${field}">
                        <option value="">Select...</option>
                        <option value="true">True</option>
                        <option value="false">False</option>
                    </select>
                `;
                break;
            case 'date':
                inputHTML = `<input type="date" class="form-control" name="${field}" placeholder="Enter ${field}">`;
                break;
            default:
                inputHTML = `<input type="text" class="form-control" name="${field}" placeholder="Enter ${field}">`;
        }
        
        return `
            <div class="col-md-6 mb-3">
                <label class="form-label">
                    ${field}
                    <span class="badge bg-success ms-1">Editable</span>
                    <small class="text-muted">(${inputType})</small>
                </label>
                ${inputHTML}
                <div class="invalid-feedback"></div>
            </div>
        `;
    };

    const modalHTML = `
        <div class="modal fade" id="newRecordModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-plus me-2"></i>Add New Record - ${layer.name}
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-info">
                            <i class="fas fa-info-circle me-2"></i>
                            This will create a new record in the Teable.io table "${layer.name}". 
                            ${editableFields.length > 0 ? `${editableFields.length} editable fields available.` : 'No specific fields configured - record will be created with default values.'}
                        </div>
                        <form id="newRecordForm" novalidate>
                            ${editableFields.length > 0 ? `
                                <div class="row">
                                    ${editableFields.map(field => createFieldInput(field)).join('')}
                                </div>
                            ` : `
                                <div class="alert alert-warning">
                                    <i class="fas fa-exclamation-triangle me-2"></i>
                                    No editable fields configured. A basic record will be created.
                                </div>
                            `}
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-success" onclick="saveNewRecord('${layer.id}')" id="saveNewRecordBtn">
                            <i class="fas fa-save me-1"></i>Save Record
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal
    const existingModal = document.getElementById('newRecordModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('newRecordModal'));
    modal.show();
    
    // Add form validation
    const form = document.getElementById('newRecordForm');
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            saveNewRecord(layer.id);
        });
        
        // Add real-time validation
        const inputs = form.querySelectorAll('input, select');
        inputs.forEach(input => {
            input.addEventListener('blur', function() {
                validateField(this);
            });
        });
    }
}

async function saveNewRecord(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) {
        showError('Layer not found');
        return;
    }
    
    const saveBtn = document.getElementById('saveNewRecordBtn');
    const originalText = saveBtn ? saveBtn.innerHTML : '';
    
    try {
        // Show saving state
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
            saveBtn.disabled = true;
        }
        
        // Get and validate form data
        const form = document.getElementById('newRecordForm');
        if (!form) {
            throw new Error('Form not found');
        }
        
        // Validate form first
        if (!validateNewRecordForm(form)) {
            throw new Error('Please fix the validation errors before saving');
        }
        
        const formData = new FormData(form);
        const recordData = {};
        
        // Process form data with proper type conversion
        for (const [key, value] of formData.entries()) {
            if (value !== '' && value !== null && value !== undefined) {
                // Convert value based on field type
                const fieldType = detectFieldType(layer, key, value);
                try {
                    recordData[key] = convertValueByType(value, fieldType);
                } catch (conversionError) {
                    throw new Error(`Invalid ${fieldType} value for field "${key}": ${value}`);
                }
            } else {
                // Leave empty fields as null
                recordData[key] = null;
            }
        }
        
        // Add geometry field as empty if it exists
        if (layer.geometryField && !recordData.hasOwnProperty(layer.geometryField)) {
            recordData[layer.geometryField] = '';
        }
        
        console.log('Creating new record with data:', recordData);
        
        // Create record in Teable.io
        const newRecord = await window.teableAPI.createRecord(layer.tableId, recordData);
        
        console.log('Successfully created record:', newRecord);
        
        // Add to local layer data
        if (newRecord) {
            layer.records.push(newRecord);
            layer.featureCount = layer.records.length;
            
            // Update layer bounds if needed
            updateLayerBounds(layer);
            
            // Refresh the attribute table to show the new record
            await refreshAttributeTable(layerId);
            
            // Update layer statistics
            updateLayersList();
            updateMapStatistics();
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('newRecordModal'));
            if (modal) {
                modal.hide();
            }
            
            showSuccess(`✅ New record added successfully to "${layer.name}"!
            
📊 Record created in Teable.io table
📋 Attribute table updated
📈 Layer statistics refreshed`);
            
            // Log the activity
            try {
                const currentUser = window.teableAuth?.getCurrentSession();
                if (currentUser && window.teableAPI?.logActivity) {
                    await window.teableAPI.logActivity(
                        currentUser.email,
                        'record_created',
                        `Created new record in layer "${layer.name}"`
                    );
                }
            } catch (logError) {
                console.log('Failed to log activity:', logError.message);
            }
        } else {
            throw new Error('Record creation returned empty result');
        }
        
    } catch (error) {
        console.error('Error saving new record:', error);
        
        // Show detailed error message
        let errorMessage = 'Failed to save new record: ' + error.message;
        
        if (error.message.includes('400')) {
            errorMessage += '\n\nThis usually means there\'s a validation error. Please check:';
            errorMessage += '\n• All required fields are filled';
            errorMessage += '\n• Data types match field requirements';
            errorMessage += '\n• Field values are within acceptable ranges';
        }
        
        showError(errorMessage);
        
        // Restore button state
        if (saveBtn) {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    }
}

// Helper function to validate the new record form
function validateNewRecordForm(form) {
    let isValid = true;
    const inputs = form.querySelectorAll('input, select');
    
    inputs.forEach(input => {
        if (!validateField(input)) {
            isValid = false;
        }
    });
    
    return isValid;
}

// Helper function to validate individual fields
function validateField(input) {
    const value = input.value;
    const fieldName = input.name;
    const type = input.type;
    let isValid = true;
    let errorMessage = '';
    
    // Skip validation for empty optional fields
    if (value === '' || value === null || value === undefined) {
        input.classList.remove('is-invalid');
        return true;
    }
    
    // Type-specific validation
    switch (type) {
        case 'number':
            if (isNaN(parseFloat(value)) || !isFinite(value)) {
                isValid = false;
                errorMessage = 'Must be a valid number';
            }
            break;
        case 'date':
            if (!value.match(/^\d{4}-\d{2}-\d{2}$/)) {
                isValid = false;
                errorMessage = 'Must be a valid date (YYYY-MM-DD)';
            }
            break;
        case 'email':
            if (!value.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
                isValid = false;
                errorMessage = 'Must be a valid email address';
            }
            break;
    }
    
    // Update field styling and error message
    if (isValid) {
        input.classList.remove('is-invalid');
        input.classList.add('is-valid');
    } else {
        input.classList.remove('is-valid');
        input.classList.add('is-invalid');
        const feedback = input.parentNode.querySelector('.invalid-feedback');
        if (feedback) {
            feedback.textContent = errorMessage;
        }
    }
    
    return isValid;
}

// Helper function to update layer bounds after adding records
function updateLayerBounds(layer) {
    if (!layer.features || layer.features.length === 0) return;
    
    try {
        const validFeatures = layer.features.filter(feature => 
            (feature.getLatLng && feature.getLatLng()) || 
            (feature.getBounds && feature.getBounds().isValid())
        );
        
        if (validFeatures.length > 0) {
            const group = new L.featureGroup(validFeatures);
            layer.bounds = group.getBounds();
        }
    } catch (error) {
        console.warn('Could not update layer bounds:', error);
    }
}

async function deleteRecord(layerId, recordId, featureIndex) {
    if (!canEditRecords()) {
        showError('You do not have permission to delete records');
        return;
    }
    
    if (!confirm('Are you sure you want to delete this record? This action cannot be undone.')) {
        return;
    }
    
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) {
        showError('Layer not found');
        return;
    }
    
    try {
        // Delete from Teable.io
        await window.teableAPI.deleteRecord(layer.tableId, recordId);
        
        // Remove from local data
        layer.records = layer.records.filter(r => r.id !== recordId);
        layer.featureCount--;
        
        // Remove feature from map if it exists
        if (layer.features[featureIndex]) {
            if (layer.leafletLayer.hasLayer(layer.features[featureIndex])) {
                layer.leafletLayer.removeLayer(layer.features[featureIndex]);
            }
            layer.features.splice(featureIndex, 1);
        }
        
        // Refresh the attribute table
        await refreshAttributeTable(layerId);
        
        // Update layer list and statistics
        updateLayersList();
        updateMapStatistics();
        
        showSuccess('Record deleted successfully!');
        
    } catch (error) {
        console.error('Error deleting record:', error);
        showError('Failed to delete record: ' + error.message);
    }
}

async function deleteSelectedRecords(layerId) {
    if (!canEditRecords()) {
        showError('You do not have permission to delete records');
        return;
    }
    
    const selectedCheckboxes = document.querySelectorAll('#dockedAttributeTable .row-selector:checked');
    if (selectedCheckboxes.length === 0) {
        showWarning('No records selected for deletion');
        return;
    }
    
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) {
        showError('Layer not found');
        return;
    }
    
    const recordsToDelete = [];
    const featuresToDelete = [];
    
    // Collect records and their corresponding features
    selectedCheckboxes.forEach(checkbox => {
        const row = checkbox.closest('tr');
        const recordId = row.getAttribute('data-record-id');
        const featureIndex = parseInt(row.getAttribute('data-feature-index'));
        
        if (recordId) {
            recordsToDelete.push(recordId);
            
            // Find corresponding feature
            const feature = layer.features.find(f => f.recordId === recordId);
            if (feature) {
                featuresToDelete.push(feature);
            }
        }
    });
    
    // Enhanced confirmation dialog with detailed information
    const confirmationMessage = `🗑️ DELETE CONFIRMATION
    
You are about to permanently delete:
• ${recordsToDelete.length} record(s) from the attribute table
• ${featuresToDelete.length} geometry feature(s) from the map
• All associated data from Teable.io table "${layer.name}"

⚠️ THIS ACTION CANNOT BE UNDONE ⚠️

Are you sure you want to proceed with the deletion?`;
    
    // Show enhanced confirmation dialog
    const confirmed = confirm(confirmationMessage);
    if (!confirmed) {
        showInfo('Deletion cancelled by user');
        return;
    }
    
    try {
        // Show progress indicator
        showInfo(`🔄 Deleting ${recordsToDelete.length} selected record(s)...`);
        
        let successCount = 0;
        let errorCount = 0;
        const failedRecords = [];
        
        // Delete records from Teable.io one by one with progress tracking
        for (let i = 0; i < recordsToDelete.length; i++) {
            const recordId = recordsToDelete[i];
            
            try {
                console.log(`🗑️ Deleting record ${i + 1}/${recordsToDelete.length}: ${recordId}`);
                await window.teableAPI.deleteRecord(layer.tableId, recordId);
                successCount++;
                
                // Update progress
                if (recordsToDelete.length > 5) {
                    showInfo(`⏳ Deleting... ${successCount}/${recordsToDelete.length} completed`);
                }
                
            } catch (deleteError) {
                console.error(`❌ Failed to delete record ${recordId}:`, deleteError);
                errorCount++;
                failedRecords.push(recordId);
            }
        }
        
        // Remove successfully deleted records from local data
        const successfullyDeleted = recordsToDelete.filter(id => !failedRecords.includes(id));
        
        if (successfullyDeleted.length > 0) {
            // Update layer records
            layer.records = layer.records.filter(r => !successfullyDeleted.includes(r.id));
            layer.featureCount = Math.max(0, layer.featureCount - successfullyDeleted.length);
            
            // Remove features from map and clear from selectedFeatures
            layer.features = layer.features.filter((feature, index) => {
                if (successfullyDeleted.includes(feature.recordId)) {
                    // Remove from map display
                    if (layer.leafletLayer && layer.leafletLayer.hasLayer(feature)) {
                        layer.leafletLayer.removeLayer(feature);
                    }
                    
                    // Remove from global selectedFeatures array
                    const selectedIndex = selectedFeatures.indexOf(feature);
                    if (selectedIndex !== -1) {
                        selectedFeatures.splice(selectedIndex, 1);
                    }
                    
                    // Remove feature popup if open
                    if (feature.getPopup && feature.getPopup() && map.hasLayer(feature.getPopup())) {
                        map.closePopup(feature.getPopup());
                    }
                    
                    console.log(`✅ Removed feature from map for record: ${feature.recordId}`);
                    return false; // Remove from features array
                }
                return true; // Keep in features array
            });
            
            // Update feature indices for remaining features
            layer.features.forEach((feature, newIndex) => {
                feature.featureIndex = newIndex;
            });
        }
        
        // Clear all row selections in the attribute table
        const allCheckboxes = document.querySelectorAll('#dockedAttributeTable .row-selector');
        allCheckboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
        
        // Clear master checkbox
        const masterCheckbox = document.querySelector('#dockedAttributeTable thead .row-selector input[type="checkbox"]');
        if (masterCheckbox) {
            masterCheckbox.checked = false;
        }
        
        // Refresh the attribute table to reflect changes
        await refreshAttributeTable(layerId);
        
        // Update UI components
        updateLayersList();
        updateMapStatistics();
        updateSelectionCount();
        
        // Enable/disable buttons based on new selection state
        const deleteBtn = document.getElementById('deleteSelectedBtn');
        if (deleteBtn) {
            deleteBtn.disabled = true;
        }
        
        const zoomToSelectionBtn = document.getElementById('zoomToSelectionBtn');
        if (zoomToSelectionBtn) {
            zoomToSelectionBtn.disabled = true;
        }
        
        // Show final result message
        if (errorCount === 0) {
            showSuccess(`✅ Successfully deleted ${successCount} record(s) and their geometry features!
            
🗺️ Map updated: ${successCount} feature(s) removed
📊 Teable.io updated: All records permanently deleted
📈 Layer statistics refreshed`);
        } else if (successCount > 0) {
            showWarning(`⚠️ Deletion completed with some issues:
            
✅ Successfully deleted: ${successCount} record(s)
❌ Failed to delete: ${errorCount} record(s)
            
The successfully deleted features have been removed from both the map and Teable.io.
Failed deletions: ${failedRecords.join(', ')}`);
        } else {
            showError(`❌ Failed to delete any of the selected ${recordsToDelete.length} record(s).
            
Please check your connection and permissions, then try again.`);
        }
        
        // Log the deletion activity
        try {
            const currentUser = window.teableAuth?.getCurrentSession();
            if (currentUser && window.teableAPI?.logActivity) {
                await window.teableAPI.logActivity(
                    currentUser.email,
                    'records_deleted',
                    `Bulk deleted ${successCount} records from layer "${layer.name}"`
                );
            }
        } catch (logError) {
            console.log('Failed to log deletion activity:', logError.message);
        }
        
    } catch (error) {
        console.error('Error in bulk delete operation:', error);
        showError(`Failed to delete selected records: ${error.message}
        
Please try the following:
1. Check your internet connection
2. Verify you have delete permissions
3. Try deleting fewer records at once
4. Contact your administrator if the problem persists`);
    }
}

async function refreshAttributeTable(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) return;
    
    try {
        console.log(`Refreshing attribute table for layer: ${layer.name}`);
        
        // Reload fresh data from Teable.io
        const recordsData = await window.teableAPI.getRecords(layer.tableId, { limit: 1000 });
        const records = recordsData.records || [];
        
        console.log(`Loaded ${records.length} records from Teable.io`);
        
        // Update layer data
        const oldRecordCount = layer.records.length;
        layer.records = records;
        layer.featureCount = records.length;
        
        // Update the attribute table if it's currently visible
        const tableContainer = document.getElementById('attributeTableContainer');
        if (tableContainer) {
            // Show loading indicator
            tableContainer.innerHTML = '<div class="text-center p-3"><i class="fas fa-spinner fa-spin"></i> Refreshing...</div>';
            
            // Recreate the attribute table with fresh data
            setTimeout(async () => {
                try {
                    tableContainer.innerHTML = `
                        <table class="table table-sm table-striped mb-0" id="attributeTable">
                            <thead class="table-dark sticky-top">
                                ${await createEnhancedTableHeader(layer)}
                            </thead>
                            <tbody>
                                ${await createEnhancedTableBody(layer)}
                            </tbody>
                        </table>
                    `;
                    
                    // Reapply inline editing functionality
                    setupInlineEditing(layer);
                    
                    // Update table header with new count
                    const headerElement = document.querySelector('.docked-table-header h6');
                    if (headerElement) {
                        headerElement.innerHTML = `
                            <i class="fas fa-table me-2"></i>Attribute Table - ${layer.name}
                            <span class="badge bg-info ms-2">${getUserRoleBadge()}</span>
                        `;
                    }
                    
                    // Update record count in toolbar
                    const recordCountElements = document.querySelectorAll('.docked-table-toolbar .text-muted');
                    recordCountElements.forEach(element => {
                        if (element.textContent.includes('features selected')) {
                            element.innerHTML = `<span id="selectedCount">0</span> of ${records.length} features selected`;
                        }
                    });
                    
                    console.log(`Attribute table refreshed: ${oldRecordCount} → ${records.length} records`);
                    
                } catch (tableError) {
                    console.error('Error recreating table:', tableError);
                    tableContainer.innerHTML = `
                        <div class="alert alert-danger">
                            <i class="fas fa-exclamation-triangle me-2"></i>
                            Error loading table data: ${tableError.message}
                        </div>
                    `;
                }
            }, 100);
        }
        
        // Clear any selections since data has changed
        selectedFeatures.length = 0;
        updateSelectionCount();
        
        // Update layer statistics
        updateLayersList();
        updateMapStatistics();
        
        // Show success message if record count changed
        if (oldRecordCount !== records.length) {
            const changeText = records.length > oldRecordCount ? 
                `Added ${records.length - oldRecordCount} record(s)` : 
                `Removed ${oldRecordCount - records.length} record(s)`;
            showInfo(`Attribute table refreshed - ${changeText}. Total: ${records.length} records`);
        }
        
    } catch (error) {
        console.error('Error refreshing attribute table:', error);
        showError('Failed to refresh attribute table: ' + error.message);
        
        // Show error in table if it exists
        const tableContainer = document.getElementById('attributeTableContainer');
        if (tableContainer) {
            tableContainer.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Failed to load fresh data: ${error.message}
                    <button class="btn btn-sm btn-outline-danger ms-2" onclick="refreshAttributeTable('${layerId}')">
                        <i class="fas fa-retry me-1"></i>Retry
                    </button>
                </div>
            `;
        }
    }
}

// Table editing mode management
let isTableEditingMode = false;
let editingChanges = new Map(); // Store pending changes

// Initialize editing changes map
if (typeof editingChanges === 'undefined') {
    editingChanges = new Map();
}

function startTableEditing(layerId) {
    isTableEditingMode = true;
    editingChanges.clear();
    
    // Toggle button visibility
    document.getElementById('startEditingBtn').style.display = 'none';
    document.getElementById('saveEditingBtn').style.display = 'inline-block';
    
    // Enable inline editing for all editable cells
    const editableCells = document.querySelectorAll('.editable-cell');
    editableCells.forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.style.backgroundColor = '#f8f9fa';
        cell.onclick = function() { startInlineEdit(this); };
        
        // Add visual indicator for editing mode
        cell.style.borderLeft = '3px solid #007bff';
        cell.title = 'Click to edit this field';
    });
    
    // Show editing mode indicator
    showSuccess('Editing mode enabled. Click on blue-bordered cells to modify values.');
    
    // Add editing mode visual indicators
    const toolbar = document.querySelector('.docked-table-toolbar');
    if (toolbar) {
        toolbar.classList.add('editing-mode');
    }
}

async function saveTableEditing(layerId) {
    if (editingChanges.size === 0) {
        // No changes to save, just exit editing mode
        exitTableEditing();
        showInfo('No changes to save. Editing mode disabled.');
        return;
    }
    
    try {
        const layer = mapLayers.find(l => l.id === layerId);
        if (!layer) {
            throw new Error('Layer not found');
        }
        
        // Check if API is available
        if (!window.teableAPI) {
            throw new Error('Teable API not available. Please check your configuration.');
        }
        
        // Show saving indicator
        const saveBtn = document.getElementById('saveEditingBtn');
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Saving...';
        saveBtn.disabled = true;
        
        // Group changes by record ID for batch processing
        const recordChanges = new Map();
        
        for (const [key, change] of editingChanges) {
            if (!recordChanges.has(change.recordId)) {
                recordChanges.set(change.recordId, {});
            }
            recordChanges.get(change.recordId)[change.fieldName] = change.newValue;
        }
        
        console.log(`Saving ${editingChanges.size} changes across ${recordChanges.size} records...`);
        
        // Save all pending changes
        let successCount = 0;
        let errorCount = 0;
        const failedChanges = [];
        
        for (const [recordId, fieldsToUpdate] of recordChanges) {
            try {
                console.log(`Updating record ${recordId} with fields:`, fieldsToUpdate);
                
                // Check if updateRecord method exists
                if (typeof window.teableAPI.updateRecord !== 'function') {
                    // Fallback: try to use other available methods
                    if (typeof window.teableAPI.modifyRecord === 'function') {
                        await window.teableAPI.modifyRecord(layer.tableId, recordId, fieldsToUpdate);
                    } else if (typeof window.teableAPI.patchRecord === 'function') {
                        await window.teableAPI.patchRecord(layer.tableId, recordId, fieldsToUpdate);
                    } else {
                        throw new Error('No suitable update method found in teableAPI');
                    }
                } else {
                    // Use the standard updateRecord method
                    await window.teableAPI.updateRecord(layer.tableId, recordId, fieldsToUpdate);
                }
                
                // Update local data
                const record = layer.records.find(r => r.id === recordId);
                if (record) {
                    // Update all changed fields in the record
                    Object.keys(fieldsToUpdate).forEach(fieldName => {
                        record.fields[fieldName] = fieldsToUpdate[fieldName];
                    });
                    
                    // Update corresponding map feature
                    const featureIndex = layer.features.findIndex(f => f.recordId === recordId);
                    if (featureIndex !== -1 && layer.features[featureIndex]) {
                        layer.features[featureIndex].recordData = record.fields;
                        
                        // Update popup if it exists
                        if (layer.features[featureIndex].getPopup()) {
                            const newPopupContent = createFeaturePopup(record.fields, layer);
                            layer.features[featureIndex].getPopup().setContent(newPopupContent);
                        }
                    }
                }
                
                // Mark cells as successfully saved
                Object.keys(fieldsToUpdate).forEach(fieldName => {
                    const cell = document.querySelector(`td[data-record-id="${recordId}"][data-field="${fieldName}"]`);
                    if (cell) {
                        cell.style.backgroundColor = '#d4edda';
                        cell.style.borderColor = '#28a745';
                        cell.title = 'Successfully saved to Teable.io';
                        
                        // Update the original value to the new value
                        cell.setAttribute('data-original-value', fieldsToUpdate[fieldName]);
                    }
                });
                
                successCount += Object.keys(fieldsToUpdate).length;
                console.log(`✅ Successfully updated record ${recordId}`);
                
            } catch (error) {
                console.error(`❌ Error saving changes for record ${recordId}:`, error);
                errorCount += Object.keys(fieldsToUpdate).length;
                
                // Store failed changes
                Object.keys(fieldsToUpdate).forEach(fieldName => {
                    failedChanges.push(`${recordId}_${fieldName}`);
                });
                
                // Mark failed cells visually
                Object.keys(fieldsToUpdate).forEach(fieldName => {
                    const cell = document.querySelector(`td[data-record-id="${recordId}"][data-field="${fieldName}"]`);
                    if (cell) {
                        cell.style.backgroundColor = '#f8d7da';
                        cell.style.borderColor = '#dc3545';
                        cell.title = `Failed to save: ${error.message}`;
                    }
                });
            }
        }
        
        // Clear only successful changes from the pending changes map
        const changesToRemove = [];
        for (const [key, change] of editingChanges) {
            if (!failedChanges.includes(key)) {
                changesToRemove.push(key);
            }
        }
        
        changesToRemove.forEach(key => {
            editingChanges.delete(key);
        });
        
        // Show results and update UI
        if (errorCount === 0) {
            showSuccess(`All ${successCount} field changes saved successfully to Teable.io!`);
            
            // Reset save button and exit editing mode
            saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save Editing';
            saveBtn.disabled = false;
            
            // Auto-exit editing mode after successful save
            setTimeout(() => {
                exitTableEditing();
            }, 1500);
            
        } else if (successCount > 0) {
            showWarning(`${successCount} changes saved successfully, ${errorCount} failed. Failed changes remain for retry.`);
            
            // Update save button to show remaining changes
            saveBtn.innerHTML = `<i class="fas fa-save me-1"></i>Retry Save (${editingChanges.size})`;
            saveBtn.disabled = false;
            saveBtn.classList.add('btn-warning');
            saveBtn.classList.remove('btn-success');
            
        } else {
            showError(`All ${errorCount} changes failed to save. Check your connection and permissions.`);
            
            // Restore save button
            saveBtn.innerHTML = `<i class="fas fa-save me-1"></i>Save Editing (${editingChanges.size})`;
            saveBtn.disabled = false;
            saveBtn.classList.add('btn-danger');
            saveBtn.classList.remove('btn-success');
        }
        
        // Show detailed error information if available
        if (errorCount > 0) {
            console.log('Failed to save the following changes:', failedChanges);
            showError(`Save failed for ${errorCount} field(s). Check console for details.`);
        }
        
    } catch (error) {
        console.error('Error in saveTableEditing:', error);
        showError('Failed to save changes: ' + error.message);
        
        // Restore button state
        const saveBtn = document.getElementById('saveEditingBtn');
        if (saveBtn) {
            saveBtn.innerHTML = `<i class="fas fa-save me-1"></i>Save Editing (${editingChanges.size})`;
            saveBtn.disabled = false;
            saveBtn.classList.add('btn-danger');
            saveBtn.classList.remove('btn-success');
        }
    }
}

function exitTableEditing() {
    isTableEditingMode = false;
    editingChanges.clear();
    
    // Toggle button visibility
    const startBtn = document.getElementById('startEditingBtn');
    const saveBtn = document.getElementById('saveEditingBtn');
    
    if (startBtn) {
        startBtn.style.display = 'inline-block';
    }
    
    if (saveBtn) {
        saveBtn.style.display = 'none';
        // Reset save button classes and text
        saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save Editing';
        saveBtn.classList.remove('btn-warning', 'btn-danger');
        saveBtn.classList.add('btn-success');
        saveBtn.disabled = false;
    }
    
    // Disable inline editing and reset cell styles
    const editableCells = document.querySelectorAll('.editable-cell');
    editableCells.forEach(cell => {
        cell.style.cursor = 'default';
        cell.style.backgroundColor = '';
        cell.onclick = null;
        
        // Reset visual indicators
        cell.style.borderLeft = '3px solid #28a745';
        cell.title = 'Editable field (click Start Editing to modify)';
        
        // Remove any success/error styling
        if (cell.style.backgroundColor === 'rgb(212, 237, 218)' || 
            cell.style.backgroundColor === 'rgb(248, 215, 218)') {
            cell.style.backgroundColor = '';
            cell.style.borderColor = '';
        }
    });
    
    // Remove editing mode visual indicators
    const toolbar = document.querySelector('.docked-table-toolbar');
    if (toolbar) {
        toolbar.classList.remove('editing-mode');
    }
    
    // Remove any modified content indicators
    const modifiedElements = document.querySelectorAll('.editable-content.modified');
    modifiedElements.forEach(element => {
        element.classList.remove('modified');
        element.style.backgroundColor = '';
        element.style.borderLeft = '';
        
        // Remove pending save indicators
        const pendingIcons = element.querySelectorAll('.fa-clock');
        pendingIcons.forEach(icon => icon.remove());
    });
    
    showInfo('Editing mode disabled. All changes have been processed.');
}

// Drone imagery utility functions
window.zoomToDroneImageryLevel = function() {
    const currentBasemap = document.getElementById('basemapSelector').value;
    const droneOption = document.querySelector('option[value="drone_imagery"]');
    
    if (!droneOption) {
        showWarning('Drone imagery is not available for this customer context.');
        return;
    }
    
    // Switch to drone imagery if not already selected
    if (currentBasemap !== 'drone_imagery') {
        document.getElementById('basemapSelector').value = 'drone_imagery';
        changeBasemap();
    }
    
    // Zoom to minimum drone imagery level
    const currentZoom = map.getZoom();
    const minDroneZoom = baseMaps.drone_imagery.minZoom;
    
    if (currentZoom < minDroneZoom) {
        map.setZoom(minDroneZoom);
        showSuccess(`Zoomed to drone imagery level (${minDroneZoom}). Use +/- to explore higher detail levels up to ${baseMaps.drone_imagery.maxZoom}.`);
    } else {
        showInfo(`Already at drone imagery zoom level ${currentZoom}. Maximum detail available at level ${baseMaps.drone_imagery.maxZoom}.`);
    }
};

// Customer context management
window.getCustomerInfo = function() {
    const customerId = getCustomerContext();
    const hasCustomTiles = document.querySelector('option[value="drone_imagery"]') !== null;
    
    console.log('Customer Context Information:');
    console.log('Customer ID:', customerId);
    console.log('Has Custom Drone Tiles:', hasCustomTiles);
    console.log('Tile URL Pattern:', hasCustomTiles ? baseMaps.drone_imagery.url : 'Not available');
    
    if (hasCustomTiles) {
        showInfo(`Customer ${customerId} context active with drone imagery support (zoom levels ${baseMaps.drone_imagery.minZoom}-${baseMaps.drone_imagery.maxZoom})`);
    } else {
        showInfo(`Customer ${customerId} context active (no custom drone imagery available)`);
    }
};

// Debug function to test tile availability
window.testCustomTiles = async function() {
    const customerId = getCustomerContext();
    const available = await checkCustomTilesAvailability(customerId);
    
    console.log('Tile availability test for customer', customerId, ':', available);
    
    if (available) {
        showSuccess('Custom drone imagery tiles are accessible for this customer.');
    } else {
        showWarning('Custom drone imagery tiles are not available or accessible for this customer.');
    }
};

// Media modal utility functions
window.downloadCurrentMedia = function() {
    // Get the currently active modal
    const activeModal = document.querySelector('.modal.show');
    if (!activeModal) {
        showError('No active media to download');
        return;
    }
    
    let mediaUrl = null;
    
    // Extract media URL based on modal type
    if (activeModal.id === 'videoModal') {
        const videoElement = activeModal.querySelector('#videoPlayer source');
        mediaUrl = videoElement ? videoElement.src : null;
    } else if (activeModal.id === 'audioModal') {
        const audioElement = activeModal.querySelector('audio source');
        mediaUrl = audioElement ? audioElement.src : null;
    } else if (activeModal.id === 'imageModal') {
        const imageElement = activeModal.querySelector('img');
        mediaUrl = imageElement ? imageElement.src : null;
    } else if (activeModal.id === 'pdfModal') {
        const iframeElement = activeModal.querySelector('iframe');
        mediaUrl = iframeElement ? iframeElement.src : null;
    }
    
    if (mediaUrl) {
        const link = document.createElement('a');
        link.href = mediaUrl;
        link.download = '';
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showSuccess('Download started');
    } else {
        showError('Could not find media URL for download');
    }
};

window.fullscreenVideo = function() {
    const videoElement = document.getElementById('videoPlayer');
    if (videoElement) {
        if (videoElement.requestFullscreen) {
            videoElement.requestFullscreen();
        } else if (videoElement.webkitRequestFullscreen) {
            videoElement.webkitRequestFullscreen();
        } else if (videoElement.msRequestFullscreen) {
            videoElement.msRequestFullscreen();
        }
        showSuccess('Video entered fullscreen mode');
    }
};

window.fullscreenImage = function() {
    const activeModal = document.querySelector('.modal.show');
    const imageElement = activeModal ? activeModal.querySelector('img') : null;
    
    if (imageElement) {
        if (imageElement.requestFullscreen) {
            imageElement.requestFullscreen();
        } else if (imageElement.webkitRequestFullscreen) {
            imageElement.webkitRequestFullscreen();
        } else if (imageElement.msRequestFullscreen) {
            imageElement.msRequestFullscreen();
        }
        showSuccess('Image entered fullscreen mode');
    }
};

window.adjustPlaybackRate = function(adjustment) {
    const audioElement = document.querySelector('#audioModal audio');
    if (audioElement) {
        if (adjustment === 0) {
            audioElement.playbackRate = 1.0;
        } else {
            audioElement.playbackRate = Math.max(0.25, Math.min(2.0, audioElement.playbackRate + adjustment));
        }
        showSuccess(`Playback rate: ${audioElement.playbackRate}x`);
    }
};

// Make functions globally available
window.toggleSection = toggleSection;
window.showAddLayerModal = showAddLayerModal;
window.addNewLayer = addNewLayer;
window.loadTableFields = loadTableFields;
window.toggleLayerVisibility = toggleLayerVisibility;
window.zoomToLayer = zoomToLayer;
window.showAttributeTable = showAttributeTable;
window.showLayerProperties = showLayerProperties;
window.removeLayer = removeLayer;
window.changeBasemap = changeBasemap;
window.toggleDockedTableSize = toggleDockedTableSize;
window.closeDockedTable = closeDockedTable;
window.startMeasurement = startMeasurement;
window.clearMeasurements = clearMeasurements;
window.loadFilterFields = loadFilterFields;
window.loadFilterValues = loadFilterValues;
window.addFilterRule = addFilterRule;
window.removeFilterRule = removeFilterRule;
window.applyFilters = applyFilters;
window.clearAllFilters = clearAllFilters;
window.exportMap = exportMap;
window.fullscreenMap = fullscreenMap;
window.switchPropertiesTab = switchPropertiesTab;
window.updateSymbologyType = updateSymbologyType;
window.applyProperties = applyProperties;
window.applyAndCloseProperties = applyAndCloseProperties;
window.cancelProperties = cancelProperties;
window.selectAllRows = selectAllRows;
window.toggleRowSelection = toggleRowSelection;
window.zoomToSelection = zoomToSelection;
window.generateGraduatedSymbology = generateGraduatedSymbology;
window.generateCategorizedSymbology = generateCategorizedSymbology;
window.selectAllPopupFields = selectAllPopupFields;
window.deselectAllPopupFields = deselectAllPopupFields;
window.zoomToFeature = zoomToFeature;
window.showFeatureInfo = showFeatureInfo;
window.exportTableData = exportTableData;
window.clearSelection = clearSelection;
window.toggleAllRows = toggleAllRows;
window.startInlineEdit = startInlineEdit;
window.saveInlineEdit = saveInlineEdit;
window.cancelInlineEdit = cancelInlineEdit;
window.addNewRecord = addNewRecord;
window.saveNewRecord = saveNewRecord;
window.deleteRecord = deleteRecord;
window.deleteSelectedRecords = deleteSelectedRecords;
window.refreshAttributeTable = refreshAttributeTable;
window.updatePopupFieldSelection = updatePopupFieldSelection;
window.startTableEditing = startTableEditing;
window.saveTableEditing = saveTableEditing;
window.exitTableEditing = exitTableEditing;
window.filterPopupFields = filterPopupFields;
window.copyToClipboard = copyToClipboard;
window.previewPopup = previewPopup;
window.exportCurrentFeature = exportCurrentFeature;
window.editCurrentFeature = editCurrentFeature;
window.handleTemplateChange = handleTemplateChange;
window.handlePopupToggle = handlePopupToggle;

// Docked table utility functions
function toggleDockedTableSize() {
    const dockedTable = document.getElementById('dockedAttributeTable');
    const toggleIcon = document.getElementById('tableToggleIcon');

    if (!dockedTable) return;

    if (dockedTable.classList.contains('expanded')) {
        dockedTable.classList.remove('expanded');
        toggleIcon.className = 'fas fa-expand-alt';
    } else {
        dockedTable.classList.add('expanded');
        toggleIcon.className = 'fas fa-compress-alt';
    }

    adjustMapForDockedTable();
}

function closeDockedTable() {
    const dockedTable = document.getElementById('dockedAttributeTable');
    if (dockedTable) {
        dockedTable.remove();
        adjustMapForDockedTable();
    }
}

function adjustMapForDockedTable() {
    const mapElement = document.getElementById('map');
    const dockedTable = document.getElementById('dockedAttributeTable');

    if (!mapElement) return;

    if (dockedTable) {
        const isExpanded = dockedTable.classList.contains('expanded');
        const tableHeight = isExpanded ? '60%' : '30%';
        const mapHeight = isExpanded ? '40%' : '70%';

        mapElement.style.height = mapHeight;
        dockedTable.style.height = tableHeight;
    } else {
        mapElement.style.height = '100%';
    }

    // Invalidate map size to ensure proper rendering
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 100);
}

// Global functions for popup zoom controls
window.zoomToCurrentPopupFeature = function(zoomType = 'close') {
    if (!window.currentPopupFeature) {
        showError('No feature selected for zooming');
        return;
    }

    const feature = window.currentPopupFeature;

    try {
        if (feature.getBounds) {
            // Polygon geometry
            const bounds = feature.getBounds();
            
            if (!bounds.isValid()) {
                showError('Invalid bounds for feature zoom');
                return;
            }
            
            const boundsSize = bounds.getNorthEast().distanceTo(bounds.getSouthWest());
            
            let zoomConfig;
            switch (zoomType) {
                case 'close':
                    // Maximum zoom configuration for closest view
                    if (boundsSize < 1) {
                        zoomConfig = { padding: 0.5, maxZoom: 25 };
                    } else if (boundsSize < 10) {
                        zoomConfig = { padding: 0.4, maxZoom: 25 };
                    } else if (boundsSize < 50) {
                        zoomConfig = { padding: 0.3, maxZoom: 24 };
                    } else if (boundsSize < 100) {
                        zoomConfig = { padding: 0.2, maxZoom: 23 };
                    } else {
                        zoomConfig = { padding: 0.15, maxZoom: 22 };
                    }
                    break;
                case 'medium':
                    zoomConfig = { 
                        padding: 0.3, 
                        maxZoom: Math.max(18, Math.min(22, 25 - Math.floor(Math.log10(boundsSize + 1))))
                    };
                    break;
                case 'far':
                    zoomConfig = { 
                        padding: 0.5, 
                        maxZoom: Math.max(15, Math.min(20, 23 - Math.floor(Math.log10(boundsSize + 1))))
                    };
                    break;
                default:
                    // Default to close view for maximum detail
                    if (boundsSize < 1) {
                        zoomConfig = { padding: 0.5, maxZoom: 25 };
                    } else if (boundsSize < 25) {
                        zoomConfig = { padding: 0.3, maxZoom: 24 };
                    } else {
                        zoomConfig = { padding: 0.2, maxZoom: 23 };
                    }
            }
            
            map.fitBounds(bounds.pad(zoomConfig.padding), {
                maxZoom: zoomConfig.maxZoom,
                animate: true,
                duration: 0.8
            });
            
        } else if (feature.getLatLng) {
            // Point geometry - use maximum zoom levels
            const latlng = feature.getLatLng();
            
            if (!latlng || isNaN(latlng.lat) || isNaN(latlng.lng)) {
                showError('Invalid coordinates for point zoom');
                return;
            }
            
            let targetZoom;
            switch (zoomType) {
                case 'close':
                    targetZoom = 25; // Maximum possible zoom
                    break;
                case 'medium':
                    targetZoom = 22;
                    break;
                case 'far':
                    targetZoom = 19;
                    break;
                default:
                    targetZoom = 25; // Default to maximum zoom
            }
            
            map.setView(latlng, targetZoom, {
                animate: true,
                duration: 0.8
            });
            
        } else {
            showError('Feature does not have valid geometry for zooming');
            return;
        }
        
        const actualZoom = map.getZoom();
        showSuccess(`Zoomed to feature - ${zoomType} view (zoom level: ${actualZoom})`);
        
    } catch (error) {
        console.error('Error in popup zoom:', error);
        showError('Failed to zoom to feature: ' + error.message);
    }
};

window.centerCurrentPopupFeature = function() {
    if (!window.currentPopupFeature) return;

    let center;
    if (window.currentPopupFeature.getLatLng) {
        center = window.currentPopupFeature.getLatLng();
    } else if (window.currentPopupFeature.getBounds) {
        center = window.currentPopupFeature.getBounds().getCenter();
    }

    if (center) {
        map.panTo(center, { animate: true, duration: 0.5 });
    }
};

// Additional zoom control functions
window.resetMapView = function() {
    map.setView([20.5937, 78.9629], 5, { animate: true, duration: 1 });
    showInfo('Map view reset to default');
};

window.zoomToAllLayers = function() {
    const visibleLayers = mapLayers.filter(layer => layer.visible && layer.features && layer.features.length > 0);

    if (visibleLayers.length === 0) {
        showWarning('No visible layers to zoom to');
        return;
    }

    // Collect all features from visible layers
    const allFeatures = [];
    visibleLayers.forEach(layer => {
        layer.features.forEach(feature => {
            if ((feature.getLatLng && feature.getLatLng()) || (feature.getLatLngs && feature.getLatLngs().length > 0)) {
                allFeatures.push(feature);
            }
        });
    });

    if (allFeatures.length === 0) {
        showWarning('No valid features found to zoom to');
        return;
    }

    // Create feature group and fit bounds
    const group = new L.featureGroup(allFeatures);
    const bounds = group.getBounds();

    // Calculate adaptive padding and zoom level
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lngSpan = bounds.getEast() - bounds.getWest();
    const maxSpan = Math.max(latSpan, lngSpan);

    let padding, maxZoom;
    if (maxSpan < 0.001) { // Very small area
        padding = 0.5;
        maxZoom = 25;
    } else if (maxSpan < 0.01) { // Small area
        padding = 0.3;
        maxZoom = 23;
    } else if (maxSpan < 0.1) { // Medium area
        padding = 0.15;
        maxZoom = 21;
    } else { // Large area
        padding = 0.05;
        maxZoom = 19;
    }

    map.fitBounds(bounds.pad(padding), { 
        animate: true, 
        duration: 1,
        maxZoom: maxZoom
    });

    showSuccess(`Zoomed to ${visibleLayers.length} visible layer(s) with ${allFeatures.length} features at enhanced detail level`);
};

// Event listeners for property controls
document.addEventListener('DOMContentLoaded', function() {
    // Opacity slider
    const opacitySlider = document.getElementById('propFillOpacity');
    if (opacitySlider) {
        opacitySlider.addEventListener('input', function() {
            const fillOpacityValue = document.getElementById('fillOpacityValue');
            if (fillOpacityValue) {
                fillOpacityValue.textContent = Math.round(this.value * 100) + '%';
            }
        });
    }

    // Border width slider
    const borderSlider = document.getElementById('propBorderWidth');
    if (borderSlider) {
        borderSlider.addEventListener('input', function() {
            const borderWidthValue = document.getElementById('borderWidthValue');
            if (borderWidthValue) {
                borderWidthValue.textContent = this.value + 'px';
            }
        });
    }

    // Labels checkbox
    const labelsCheckbox = document.getElementById('propEnableLabels');
    if (labelsCheckbox) {
        labelsCheckbox.addEventListener('change', function() {
            const propLabelControls = document.getElementById('propLabelControls');
            if (propLabelControls) {
                propLabelControls.style.display = this.checked ? 'block' : 'none';
            }
        });
    }

    // iTool event listeners
    const popupEnableCheckbox = document.getElementById('propEnablePopups');
    if (popupEnableCheckbox) {
        popupEnableCheckbox.addEventListener('change', function(e) {
            console.log('Popup checkbox changed:', e.target.checked);
            handlePopupToggle();
            // Mark as having unsaved changes
            if (window.currentPropertiesLayer) {
                console.log('Popup toggle changed for layer:', window.currentPropertiesLayer.name);
                
                // Immediately update the layer properties to reflect the change
                if (!window.currentPropertiesLayer.properties) {
                    window.currentPropertiesLayer.properties = {};
                }
                if (!window.currentPropertiesLayer.properties.popup) {
                    window.currentPropertiesLayer.properties.popup = {};
                }
                window.currentPropertiesLayer.properties.popup.enabled = e.target.checked;
            }
        });
    }

    const popupTemplateSelect = document.getElementById('propPopupTemplate');
    if (popupTemplateSelect) {
        popupTemplateSelect.addEventListener('change', handleTemplateChange);
    }

    // Symbology type change listener
    const symbologyTypeSelect = document.getElementById('propSymbologyType');
    if (symbologyTypeSelect) {
        symbologyTypeSelect.addEventListener('change', updateSymbologyType);
    }

     // Tab switching for layer source
    const tabButtons = document.querySelectorAll('#layerSourceTabs .nav-link');
    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetTab = this.getAttribute('data-bs-target');

            // Update button visibility based on active tab
            const addLayerBtn = document.getElementById('addLayerBtn');
            const uploadGeoJSONBtn = document.getElementById('uploadGeoJSONBtn');

            if (targetTab === '#geojson-pane') {
                if (addLayerBtn) addLayerBtn.style.display = 'none';
                if (uploadGeoJSONBtn) uploadGeoJSONBtn.style.display = 'inline-block';
            } else {
                if (addLayerBtn) addLayerBtn.style.display = 'inline-block';
                if (uploadGeoJSONBtn) uploadGeoJSONBtn.style.display = 'none';
            }
        });
    });
});

// Measurement tools
function startMeasurement(type) {
    clearMeasurements();
    currentMeasurement = type;
    measurementPoints = [];

    if (type === 'distance') {
        map.on('click', onDistanceMeasureClick);
        map.getContainer().style.cursor = 'crosshair';
        showInfo('Click on the map to start measuring distance');
    } else if (type === 'area') {
        map.on('click', onAreaMeasureClick);
        map.getContainer().style.cursor = 'crosshair';
        showInfo('Click on the map to start measuring area');
    }
}

function onDistanceMeasureClick(e) {
    measurementPoints.push(e.latlng);

    // Add marker
    const marker = L.circleMarker(e.latlng, {
        radius: 4,
        fillColor: '#e74c3c',
        color: '#c0392b',
        weight: 2,
        fillOpacity: 1
    }).addTo(measurementGroup);

    if (measurementPoints.length > 1) {
        // Draw line
        const line = L.polyline(measurementPoints, {
            color: '#e74c3c',
            weight: 3
        }).addTo(measurementGroup);

        // Calculate distance
        const distance = calculateDistance(measurementPoints);

        // Add distance label
        const midpoint = L.latLng(
            (measurementPoints[measurementPoints.length - 2].lat + e.latlng.lat) / 2,
            (measurementPoints[measurementPoints.length - 2].lng + e.latlng.lng) / 2
        );

        L.marker(midpoint, {
            icon: L.divIcon({
                className: 'distance-label',
                html: `<div class="measurement-result">${distance}</div>`,
                iconSize: [60, 20],
                iconAnchor: [30, 10]
            })
        }).addTo(measurementGroup);
    }
}

function onAreaMeasureClick(e) {
    measurementPoints.push(e.latlng);

    // Add marker
    L.circleMarker(e.latlng, {
        radius: 4,
        fillColor: '#27ae60',
        color: '#229954',
        weight: 2,
        fillOpacity: 1
    }).addTo(measurementGroup);

    if (measurementPoints.length > 2) {
        // Draw polygon
        const polygon = L.polygon(measurementPoints, {
            color: '#27ae60',
            weight: 3,
            fillOpacity: 0.2
        }).addTo(measurementGroup);

        // Calculate area
        const area = calculateArea(measurementPoints);

        // Add area label at centroid
        const centroid = polygon.getBounds().getCenter();
        L.marker(centroid, {
            icon: L.divIcon({
                className: 'area-label',
                html: `<div class="measurement-result">${area}</div>`,
                iconSize: [80, 20],
                iconAnchor: [40, 10]
            })
        }).addTo(measurementGroup);
    }
}

function calculateDistance(points) {
    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
        totalDistance += points[i - 1].distanceTo(points[i]);
    }

    if (totalDistance < 1000) {
        return Math.round(totalDistance) + ' m';
    } else {
        return (totalDistance / 1000).toFixed(2) + ' km';
    }
}

function calculateArea(points) {
    if (points.length < 3) return '0 m²';

    // Simple area calculation using shoelace formula
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].lat * points[j].lng;
        area -= points[j].lat * points[i].lng;
    }
    area = Math.abs(area) / 2;

    // Convert to approximate square meters (rough calculation)
    area = area * 111320 * 111320 * Math.cos(points[0].lat * Math.PI / 180);

    if (area < 10000) {
        return Math.round(area) + ' m²';
    } else {
        return (area / 10000).toFixed(2) + ' ha';
    }
}

function clearMeasurements() {
    measurementGroup.clearLayers();
    measurementPoints = [];
    currentMeasurement = null;

    // Reset cursor
    map.getContainer().style.cursor = '';

    // Remove event listeners
    map.off('click', onDistanceMeasureClick);
    map.off('click', onAreaMeasureClick);
}

// Filter functionality
function loadFilterFields() {
    const layerId = document.getElementById('filterLayer').value;
    const fieldSelect = document.getElementById('filterField');

    if (fieldSelect) {
        fieldSelect.innerHTML = '<option value="">Select field...</option>';

        if (!layerId) return;

        const layer = mapLayers.find(l => l.id === layerId);
        if (!layer || !layer.records || layer.records.length === 0) return;

        // Get all fields except geometry field
        const allFields = Object.keys(layer.records[0].fields || {}).filter(field => field !== layer.geometryField);
        console.log(`Loading filter fields for layer "${layer.name}" - all fields:`, allFields);
        
        // Filter out hidden fields based on permissions
        const permittedFields = filterFieldsByPermissions(allFields, layer);
        console.log(`Permitted fields for filtering:`, permittedFields);
        
        permittedFields.forEach(field => {
            const permission = getFieldPermission(field, layer);
            const permissionIcon = permission === 'edit' ? '✏️' : '👁️';
            const option = document.createElement('option');
            option.value = field;
            option.textContent = `${permissionIcon} ${field}`;
            fieldSelect.appendChild(option);
        });
        
        if (permittedFields.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "No accessible fields for filtering";
            option.disabled = true;
            fieldSelect.appendChild(option);
        }
        
        console.log(`Filter field selector populated with ${permittedFields.length} permitted fields`);
    }
}

function loadFilterValues() {
    const layerId = document.getElementById('filterLayer').value;
    const fieldName = document.getElementById('filterField').value;
    const valueSelect = document.getElementById('filterValue');

    if (valueSelect) {
        valueSelect.innerHTML = '<option value="">Select value...</option>';

        if (!layerId || !fieldName) return;

        const layer = mapLayers.find(l => l.id === layerId);
        if (!layer || !layer.records) return;

        // Check if user has permission to access this field
        const permission = getFieldPermission(fieldName, layer);
        if (permission === 'hidden') {
            console.log(`Field "${fieldName}" is hidden - not loading values`);
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "Field not accessible";
            option.disabled = true;
            valueSelect.appendChild(option);
            return;
        }

        // Get unique values for the field
        const uniqueValues = [...new Set(layer.records.map(record => record.fields[fieldName]))];
        uniqueValues.forEach(value => {
            if (value !== null && value !== undefined) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = value;
                valueSelect.appendChild(option);
            }
        });
        
        console.log(`Loaded ${uniqueValues.length} unique values for permitted field "${fieldName}"`);
    }
}

function addFilterRule() {
    const layerId = document.getElementById('filterLayer').value;
    const field = document.getElementById('filterField').value;
    const operator = document.getElementById('filterOperator').value;
    const value = document.getElementById('filterValue').value;

    if (!layerId || !field || !operator || !value) {
        showWarning('Please fill in all filter fields');
        return;
    }

    // Validate field permissions before adding filter
    const layer = mapLayers.find(l => l.id === layerId);
    if (layer) {
        const permission = getFieldPermission(field, layer);
        if (permission === 'hidden') {
            showError(`Cannot filter on field "${field}" - field is not accessible due to permissions`);
            return;
        }
    }

    const filter = {
        id: Date.now().toString(),
        layerId: layerId,
        field: field,
        operator: operator,
        value: value
    };

    currentFilters.push(filter);
    updateFilterRulesDisplay();

    // Clear form
    const filterLayer = document.getElementById('filterLayer');
    const filterField = document.getElementById('filterField');
    const filterValue = document.getElementById('filterValue');

    if (filterLayer) filterLayer.value = '';
    if (filterField) filterField.innerHTML = '<option value="">Select field...</option>';
    if (filterValue) filterValue.innerHTML = '<option value="">Select value...</option>';
    
    console.log(`Added filter rule for permitted field "${field}" with ${operator} "${value}"`);
}

function updateFilterRulesDisplay() {
    const container = document.getElementById('filterRules');

    if (!container) return;

    if (currentFilters.length === 0) {
        container.innerHTML = '<p class="text-muted">No filters applied</p>';
        return;
    }

    let html = '';
    currentFilters.forEach(filter => {
        const layer = mapLayers.find(l => l.id === filter.layerId);
        const layerName = layer ? layer.name : 'Unknown Layer';

        html += `
            <div class="filter-rule">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${layerName}</strong> → ${filter.field} ${filter.operator} "${filter.value}"
                    </div>
                    <button class="btn btn-sm btn-outline-danger" onclick="removeFilterRule('${filter.id}')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function removeFilterRule(filterId) {
    const index = currentFilters.findIndex(f => f.id === filterId);
    if (index !== -1) {
        currentFilters.splice(index, 1);
        updateFilterRulesDisplay();
        applyFilters(); // Re-apply remaining filters
    }
}

function applyFilters() {
    if (currentFilters.length === 0) {
        // Show all features
        mapLayers.forEach(layer => {
            if (layer.visible && layer.leafletLayer) {
                layer.features.forEach(feature => {
                    if (!layer.leafletLayer.hasLayer(feature)) {
                        layer.leafletLayer.addLayer(feature);
                    }
                });
            }
        });
        showSuccess('All filters cleared - showing all features');
        return;
    }

    let filteredCount = 0;
    let totalCount = 0;
    let skippedFilters = 0;

    mapLayers.forEach(layer => {
        if (!layer.visible) return;

        const layerFilters = currentFilters.filter(f => f.layerId === layer.id);

        layer.features.forEach(feature => {
            totalCount++;
            let showFeature = true;

            // Apply all filters for this layer
            layerFilters.forEach(filter => {
                // Check if user still has permission to access this field
                const permission = getFieldPermission(filter.field, layer);
                if (permission === 'hidden') {
                    console.warn(`Skipping filter on hidden field "${filter.field}"`);
                    skippedFilters++;
                    return; // Skip this filter - don't apply it
                }

                const fieldValue = feature.recordData[filter.field];

                switch (filter.operator) {
                    case 'equals':
                        if (String(fieldValue) !== String(filter.value)) showFeature = false;
                        break;
                    case 'contains':
                        if (!String(fieldValue).toLowerCase().includes(String(filter.value).toLowerCase())) showFeature = false;
                        break;
                    case 'starts_with':
                        if (!String(fieldValue).toLowerCase().startsWith(String(filter.value).toLowerCase())) showFeature = false;
                        break;
                    case 'greater_than':
                        if (!(parseFloat(fieldValue) > parseFloat(filter.value))) showFeature = false;
                        break;
                    case 'less_than':
                        if (!(parseFloat(fieldValue) < parseFloat(filter.value))) showFeature = false;
                        break;
                }
            });

            // Show/hide feature based on filter result
            if (showFeature) {
                if (!layer.leafletLayer.hasLayer(feature)) {
                    layer.leafletLayer.addLayer(feature);
                }
                filteredCount++;
            } else {
                if (layer.leafletLayer.hasLayer(feature)) {
                    layer.leafletLayer.removeLayer(feature);
                }
            }
        });
    });

    let message = `Filters applied: showing ${filteredCount} of ${totalCount} features`;
    if (skippedFilters > 0) {
        message += ` (${skippedFilters} filter(s) skipped due to field permissions)`;
    }
    showSuccess(message);
}

function clearAllFilters() {
    currentFilters = [];
    updateFilterRulesDisplay();
    applyFilters(); // This will show all features
}

// Populate layer selector in filters
function updateLayerSelectors() {
    const filterLayerSelect = document.getElementById('filterLayer');

    if (filterLayerSelect) {
        filterLayerSelect.innerHTML = '<option value="">Select layer...</option>';
        mapLayers.forEach(layer => {
            const option = document.createElement('option');
            option.value = layer.id;
            option.textContent = layer.name;
            filterLayerSelect.appendChild(option);
        });
    }
}

function updateMapStatistics() {
    const totalLayers = mapLayers.length;
    const visibleLayers = mapLayers.filter(l => l.visible).length;
    const totalFeatures = mapLayers.reduce((sum, layer) => sum + layer.featureCount, 0);
    const visibleFeatures = mapLayers.filter(l => l.visible).reduce((sum, layer) => {
        if (layer.leafletLayer) {
            return sum + layer.leafletLayer.getLayers().length;
        }
        return sum;
    }, 0);

    const totalLayersElement = document.getElementById('totalLayers');
    const totalFeaturesElement = document.getElementById('totalFeatures');
    const visibleFeaturesElement = document.getElementById('visibleFeatures');
    const filteredFeaturesElement = document.getElementById('filteredFeatures');

    if (totalLayersElement) totalLayersElement.textContent = totalLayers;
    if (totalFeaturesElement) totalFeaturesElement.textContent = totalFeatures;
    if (visibleFeaturesElement) visibleFeaturesElement.textContent = visibleFeatures;
    if (filteredFeaturesElement) filteredFeaturesElement.textContent = totalFeatures - visibleFeatures;

    // Update layer selectors
    updateLayerSelectors();
}

// Export functionality
function exportMap() {
    showInfo('Map export functionality would be implemented here');
}

function fullscreenMap() {
    const mapContainer = document.getElementById('map');
    
    if (!mapContainer) {
        showError('Map container not found');
        return;
    }

    try {
        if (!document.fullscreenElement) {
            // Enter fullscreen
            if (mapContainer.requestFullscreen) {
                mapContainer.requestFullscreen();
            } else if (mapContainer.webkitRequestFullscreen) {
                mapContainer.webkitRequestFullscreen();
            } else if (mapContainer.msRequestFullscreen) {
                mapContainer.msRequestFullscreen();
            } else if (mapContainer.mozRequestFullScreen) {
                mapContainer.mozRequestFullScreen();
            } else {
                showError('Fullscreen not supported by this browser');
                return;
            }
            
            // Add fullscreen class for styling
            mapContainer.classList.add('fullscreen-map');
            
            // Show success message
            showSuccess('Map is now in fullscreen mode. Press ESC to exit.');
            
        } else {
            // Exit fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            }
        }
        
        // Listen for fullscreen changes to update map size and remove class
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('msfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        
    } catch (error) {
        console.error('Fullscreen error:', error);
        showError('Failed to toggle fullscreen: ' + error.message);
    }
}

function handleFullscreenChange() {
    const mapContainer = document.getElementById('map');
    
    if (!document.fullscreenElement && 
        !document.webkitFullscreenElement && 
        !document.msFullscreenElement && 
        !document.mozFullScreenElement) {
        
        // Exited fullscreen
        if (mapContainer) {
            mapContainer.classList.remove('fullscreen-map');
        }
        
        showInfo('Exited fullscreen mode');
    }
    
    // Invalidate map size to ensure proper rendering
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 100);
}

// Detect media type specifically from URL
function detectURLMediaType(url, layerName = null) {
    if (!url || typeof url !== 'string') return null;
    
    const urlLower = url.toLowerCase();
    const nameCheck = layerName ? layerName.toLowerCase() : '';
    
    // 360° detection (highest priority) - check both URL and layer name
    if (nameCheck === '360' || urlLower.includes('360') || urlLower.includes('panorama') || urlLower.includes('streetview')) {
        console.log(`URL detected as 360° content: ${url}`);
        return '360';
    }
    
    // Video detection
    if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be') || 
        urlLower.includes('.mp4') || urlLower.includes('.webm') || urlLower.includes('.avi') ||
        urlLower.includes('vimeo.com') || urlLower.includes('video')) {
        return 'video';
    }
    
    // Audio detection
    if (urlLower.includes('.mp3') || urlLower.includes('.wav') || urlLower.includes('.ogg') ||
        urlLower.includes('soundcloud.com') || urlLower.includes('audio')) {
        return 'audio';
    }
    
    // Image detection - but not if layer is named "360"
    if (nameCheck !== '360' && (urlLower.includes('.jpg') || urlLower.includes('.jpeg') || urlLower.includes('.png') ||
        urlLower.includes('.gif') || urlLower.includes('.webp') || urlLower.includes('image'))) {
        return 'image';
    }
    
    // PDF detection
    if (urlLower.includes('.pdf') || urlLower.includes('document')) {
        return 'pdf';
    }
    
    return null;
}

// Get media type information for display
function getMediaTypeInfo(mediaType) {
    const mediaTypes = {
        'video': {
            icon: '🎥',
            title: 'Video',
            buttonText: 'View Video'
        },
        'audio': {
            icon: '🎵',
            title: 'Audio',
            buttonText: 'Play Audio'
        },
        'image': {
            icon: '📷',
            title: 'Image',
            buttonText: 'View Image'
        },
        'pdf': {
            icon: '📄',
            title: 'PDF',
            buttonText: 'View PDF'
        },
        '360': {
            icon: '🌐',
            title: '360° View',
            buttonText: 'View 360°'
        }
    };
    
    return mediaTypes[mediaType] || {
        icon: '🔗',
        title: 'Link',
        buttonText: 'Open Link'
    };
}

// Open media from URL with appropriate modal
window.openMediaFromURL = function(url, mediaType, title = 'Media') {
    try {
        switch (mediaType) {
            case 'video':
                openVideoModal(url, title);
                break;
            case 'audio':
                openAudioModal(url, title);
                break;
            case 'image':
                openImageModal(url, title);
                break;
            case 'pdf':
                openPdfModal(url, title);
                break;
            case '360':
                open360Modal(url, title);
                break;
            default:
                // Fallback to opening in new tab
                window.open(url, '_blank');
        }
        
        console.log(`Opened ${mediaType} modal for URL: ${url}`);
    } catch (error) {
        console.error('Error opening media:', error);
        showError('Failed to open media: ' + error.message);
        // Fallback to opening in new tab
        window.open(url, '_blank');
    }
};

// Enhanced media layer detection function
function detectMediaLayerType(layerName, records) {
    const name = layerName.toLowerCase();
    
    // Check layer name first - prioritize 360 detection with exact match for "360"
    if (name === '360' || name.includes('360') || name.includes('panorama') || name.includes('streetview')) {
        console.log(`Layer "${layerName}" detected as 360° layer based on name`);
        return '360';
    }
    if (name.includes('video')) return 'video';
    if (name.includes('audio')) return 'audio';
    if (name.includes('image') || name.includes('photo')) return 'image';
    if (name.includes('pdf') || name.includes('document')) return 'pdf';
    
    // If name doesn't match, analyze URL patterns from data
    if (records && records.length > 0) {
        for (const record of records.slice(0, 5)) { // Check first 5 records
            const fields = record.fields || {};
            
            for (const fieldName of Object.keys(fields)) {
                const fieldValue = fields[fieldName];
                
                if (typeof fieldValue === 'string' && fieldValue.startsWith('http')) {
                    const url = fieldValue.toLowerCase();
                    
                    // 360 detection (check first for priority)
                    if (url.includes('360') || url.includes('panorama') || url.includes('streetview')) {
                        console.log(`URL contains 360° indicators: ${url}`);
                        return '360';
                    }
                    
                    // Video detection
                    if (url.includes('youtube.com') || url.includes('youtu.be') || 
                        url.includes('.mp4') || url.includes('.webm') || url.includes('.avi') ||
                        url.includes('vimeo.com') || url.includes('video')) {
                        return 'video';
                    }
                    
                    // Audio detection
                    if (url.includes('.mp3') || url.includes('.wav') || url.includes('.ogg') ||
                        url.includes('soundcloud.com') || url.includes('audio')) {
                        return 'audio';
                    }
                    
                    // Image detection - but only if layer name is NOT "360"
                    if (name !== '360' && (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') ||
                        url.includes('.gif') || url.includes('.webp') || url.includes('image'))) {
                        return 'image';
                    }
                    
                    // PDF detection
                    if (url.includes('.pdf') || url.includes('document')) {
                        return 'pdf';
                    }
                }
            }
        }
        
        // Special case: If layer name is "360" but no 360 URLs found, still treat as 360 layer
        if (name === '360') {
            console.log(`Layer named "360" will use Pannellum viewer regardless of URL content`);
            return '360';
        }
    }
    
    return null; // Standard layer
}

// Function to find URL field in record data
function findUrlField(recordData) {
    const urlFieldNames = ['360_url', 'url', 'link', 'video_url', 'audio_url', 'image_url', 'pdf_url', 'file_url', 'media_url', 'src', 'source', 'panorama_url'];
    
    for (const fieldName of urlFieldNames) {
        if (recordData[fieldName] && typeof recordData[fieldName] === 'string' && recordData[fieldName].startsWith('http')) {
            return recordData[fieldName];
        }
    }
    
    // Check all fields for URL-like values (prioritize 360-related fields)
    for (const [fieldName, value] of Object.entries(recordData)) {
        if (typeof value === 'string' && value.startsWith('http')) {
            // Prioritize 360-related URLs
            if (fieldName.toLowerCase().includes('360') || fieldName.toLowerCase().includes('panorama')) {
                return value;
            }
        }
    }
    
    // Fallback to any HTTP URL
    for (const [fieldName, value] of Object.entries(recordData)) {
        if (typeof value === 'string' && value.startsWith('http')) {
            return value;
        }
    }
    
    return null;
}

// Video player modal
function openVideoModal(url, title = 'Video Player') {
    const modal = document.getElementById('videoModal');
    const videoElement = document.getElementById('videoPlayer');
    const videoSource = document.getElementById('videoSource');
    const videoInfo = document.getElementById('videoInfo');
    const modalTitle = modal.querySelector('.modal-title');
    
    if (modalTitle) {
        modalTitle.innerHTML = `<i class="fas fa-play-circle me-2"></i>${title}`;
    }
    
    if (videoSource && videoElement) {
        // Handle different video URL types
        let finalUrl = url;
        
        // Convert YouTube URLs to embed format
        if (url.includes('youtube.com/watch?v=')) {
            const videoId = url.split('v=')[1].split('&')[0];
            finalUrl = `https://www.youtube.com/embed/${videoId}`;
            
            // For YouTube, we'll use an iframe instead
            videoElement.style.display = 'none';
            const container = videoElement.parentElement;
            container.innerHTML = `
                <iframe src="${finalUrl}" 
                    style="width: 100%; height: 100%; border: none;" 
                    allow="autoplay; encrypted-media" allowfullscreen>
                </iframe>
            `;
        } else if (url.includes('youtu.be/')) {
            const videoId = url.split('youtu.be/')[1].split('?')[0];
            finalUrl = `https://www.youtube.com/embed/${videoId}`;
            
            videoElement.style.display = 'none';
            const container = videoElement.parentElement;
            container.innerHTML = `
                <iframe src="${finalUrl}" 
                    style="width: 100%; height: 100%; border: none;" 
                    allow="autoplay; encrypted-media" allowfullscreen>
                </iframe>
            `;
        } else {
            // Regular video file
            videoSource.src = finalUrl;
            videoElement.load();
            videoElement.style.display = 'block';
        }
        
        if (videoInfo) {
            videoInfo.innerHTML = `<strong>Source:</strong> ${url}`;
        }
    }
    
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
    
    console.log(`Opened video modal for: ${title}`);
}

// Audio player modal
function openAudioModal(url, title = 'Audio Player') {
    const modal = document.getElementById('audioModal');
    const audioElements = modal.querySelectorAll('audio source');
    const audioInfo = document.getElementById('audioInfo');
    const modalTitle = modal.querySelector('.modal-title');
    
    if (modalTitle) {
        modalTitle.innerHTML = `<i class="fas fa-music me-2"></i>${title}`;
    }
    
    // Update all audio source elements
    audioElements.forEach(source => {
        source.src = url;
    });
    
    // Load the audio
    const audioElement = modal.querySelector('audio');
    if (audioElement) {
        audioElement.load();
    }
    
    if (audioInfo) {
        audioInfo.innerHTML = `<strong>Source:</strong> ${url}`;
    }
    
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
    
    console.log(`Opened audio modal for: ${title}`);
}

// Image viewer modal
function openImageModal(url, title = 'Image Viewer') {
    const modal = document.getElementById('imageModal');
    const imageElement = modal.querySelector('img');
    const modalTitle = modal.querySelector('.modal-title');
    
    if (modalTitle) {
        modalTitle.innerHTML = `<i class="fas fa-image me-2"></i>${title}`;
    }
    
    if (imageElement) {
        imageElement.src = url;
        imageElement.alt = title;
    }
    
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
    
    console.log(`Opened image modal for: ${title}`);
}

// PDF viewer modal
function openPdfModal(url, title = 'PDF Viewer') {
    const modal = document.getElementById('pdfModal');
    const iframeElement = modal.querySelector('iframe');
    const modalTitle = modal.querySelector('.modal-title');
    
    if (modalTitle) {
        modalTitle.innerHTML = `<i class="fas fa-file-pdf me-2"></i>${title}`;
    }
    
    if (iframeElement) {
        iframeElement.src = url;
    }
    
    const bootstrapModal = new bootstrap.Modal(modal);
    bootstrapModal.show();
    
    console.log(`Opened PDF modal for: ${title}`);
}

// 360° viewer modal (using Pannellum)
function open360Modal(url, title = '360° Viewer') {
    const modal = document.getElementById('image360Modal');
    const pannellumContainer = document.getElementById('panorama360');
    const modalTitle = modal ? modal.querySelector('.modal-title') : null;
    
    if (!modal) {
        console.error('360° modal not found with ID "image360Modal"');
        // Fallback to opening in new tab
        window.open(url, '_blank');
        return;
    }
    
    if (modalTitle) {
        modalTitle.innerHTML = `<i class="fas fa-globe me-2"></i>${title}`;
    }
    
    const bootstrapModal = new bootstrap.Modal(modal);
    let viewer = null;
    let autoRotateInterval = null;
    
    // Initialize 360 viewer when modal is shown
    modal.addEventListener('shown.bs.modal', function() {
        if (typeof pannellum !== 'undefined' && pannellumContainer) {
            try {
                viewer = pannellum.viewer('panorama360', {
                    type: 'equirectangular',
                    panorama: url,
                    autoLoad: true,
                    showControls: true,
                    showZoomCtrl: true,
                    showFullscreenCtrl: true,
                    mouseZoom: true,
                    compass: true,
                    northOffset: 0,
                    pitch: 0,
                    yaw: 0,
                    hfov: 100,
                    minHfov: 50,
                    maxHfov: 120,
                    autoRotate: 0, // Start with auto-rotation off
                    keyboardZoom: true,
                    mouseZoom: true,
                    draggable: true
                });
                
                // Add custom navigation and control buttons
                addPannellumControls(viewer);
                
                console.log('Pannellum 360 viewer initialized with enhanced controls');
            } catch (error) {
                console.error('Error initializing Pannellum:', error);
                pannellumContainer.innerHTML = `
                    <div class="alert alert-warning text-center">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        360° viewer could not be initialized.
                        <br><a href="${url}" target="_blank" class="btn btn-outline-primary mt-2">
                            <i class="fas fa-external-link-alt me-1"></i>View image directly
                        </a>
                    </div>
                `;
            }
        } else {
            // Fallback to regular image display
            if (pannellumContainer) {
                pannellumContainer.innerHTML = `
                    <div class="text-center">
                        <img src="${url}" class="img-fluid" style="max-height: 60vh;" alt="360° Image">
                        <div class="alert alert-info mt-3">
                            <i class="fas fa-info-circle me-2"></i>
                            360° viewer library not loaded. Displaying as regular image.
                            <br><a href="${url}" target="_blank" class="btn btn-outline-primary mt-2">
                                <i class="fas fa-external-link-alt me-1"></i>View original
                            </a>
                        </div>
                    </div>
                `;
            }
        }
    });
    
    // Clean up when modal is hidden
    modal.addEventListener('hidden.bs.modal', function() {
        if (autoRotateInterval) {
            clearInterval(autoRotateInterval);
            autoRotateInterval = null;
        }
        if (viewer) {
            viewer.destroy();
            viewer = null;
        }
        // Remove custom controls
        const customControls = document.querySelector('.pannellum-custom-controls');
        if (customControls) {
            customControls.remove();
        }
    });
    
    bootstrapModal.show();
    console.log(`Opened 360° modal for: ${title}`);
}

// Add custom navigation and control buttons to Pannellum viewer
function addPannellumControls(viewer) {
    // Wait for viewer to be ready
    setTimeout(() => {
        const pannellumContainer = document.getElementById('panorama360');
        if (!pannellumContainer) return;
        
        // Create custom controls container
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'pannellum-custom-controls';
        controlsContainer.style.cssText = `
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: 10px;
            background: rgba(0, 0, 0, 0.7);
            padding: 15px;
            border-radius: 8px;
            color: white;
        `;
        
        // Arrow navigation controls
        const navigationSection = document.createElement('div');
        navigationSection.innerHTML = `
            <div style="text-align: center; margin-bottom: 10px; font-size: 12px; font-weight: bold;">
                <i class="fas fa-arrows-alt me-1"></i>Navigation
            </div>
            <div style="display: grid; grid-template-columns: repeat(3, 40px); gap: 5px; justify-content: center;">
                <div></div>
                <button id="pan-up" class="pan-btn" title="Look Up">
                    <i class="fas fa-chevron-up"></i>
                </button>
                <div></div>
                <button id="pan-left" class="pan-btn" title="Look Left">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <button id="pan-center" class="pan-btn" title="Reset View">
                    <i class="fas fa-crosshairs"></i>
                </button>
                <button id="pan-right" class="pan-btn" title="Look Right">
                    <i class="fas fa-chevron-right"></i>
                </button>
                <div></div>
                <button id="pan-down" class="pan-btn" title="Look Down">
                    <i class="fas fa-chevron-down"></i>
                </button>
                <div></div>
            </div>
        `;
        
        // Auto-rotation controls
        const autoRotateSection = document.createElement('div');
        autoRotateSection.innerHTML = `
            <div style="text-align: center; margin-bottom: 10px; margin-top: 15px; font-size: 12px; font-weight: bold;">
                <i class="fas fa-sync-alt me-1"></i>Auto Rotation
            </div>
            <div style="display: flex; gap: 5px; justify-content: center;">
                <button id="auto-rotate-start" class="control-btn" title="Start Auto Rotation">
                    <i class="fas fa-play"></i>
                </button>
                <button id="auto-rotate-stop" class="control-btn" title="Stop Auto Rotation">
                    <i class="fas fa-pause"></i>
                </button>
                <button id="auto-rotate-reverse" class="control-btn" title="Reverse Direction">
                    <i class="fas fa-undo"></i>
                </button>
            </div>
            <div style="margin-top: 8px; font-size: 11px; text-align: center;">
                <label style="display: flex; align-items: center; justify-content: center; gap: 5px;">
                    <span>Speed:</span>
                    <input type="range" id="rotation-speed" min="0.5" max="5" step="0.5" value="2" 
                           style="width: 80px; height: 15px;">
                    <span id="speed-value">2x</span>
                </label>
            </div>
        `;
        
        // Zoom controls
        const zoomSection = document.createElement('div');
        zoomSection.innerHTML = `
            <div style="text-align: center; margin-bottom: 10px; margin-top: 15px; font-size: 12px; font-weight: bold;">
                <i class="fas fa-search me-1"></i>Zoom
            </div>
            <div style="display: flex; gap: 5px; justify-content: center;">
                <button id="zoom-in" class="control-btn" title="Zoom In">
                    <i class="fas fa-plus"></i>
                </button>
                <button id="zoom-out" class="control-btn" title="Zoom Out">
                    <i class="fas fa-minus"></i>
                </button>
                <button id="zoom-reset" class="control-btn" title="Reset Zoom">
                    <i class="fas fa-home"></i>
                </button>
            </div>
        `;
        
        controlsContainer.appendChild(navigationSection);
        controlsContainer.appendChild(autoRotateSection);
        controlsContainer.appendChild(zoomSection);
        
        // Add styles for buttons
        const style = document.createElement('style');
        style.textContent = `
            .pan-btn, .control-btn {
                background: rgba(255, 255, 255, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.3);
                color: white;
                width: 40px;
                height: 35px;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                transition: all 0.2s;
            }
            .pan-btn:hover, .control-btn:hover {
                background: rgba(255, 255, 255, 0.4);
                border-color: rgba(255, 255, 255, 0.6);
                transform: scale(1.05);
            }
            .pan-btn:active, .control-btn:active {
                background: rgba(255, 255, 255, 0.6);
                transform: scale(0.95);
            }
            #rotation-speed {
                background: rgba(255, 255, 255, 0.3);
                border: none;
                border-radius: 10px;
            }
            #rotation-speed::-webkit-slider-thumb {
                background: white;
                border-radius: 50%;
                width: 12px;
                height: 12px;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
        
        pannellumContainer.appendChild(controlsContainer);
        
        // Add event listeners
        let isAutoRotating = false;
        let rotationDirection = 1; // 1 for right, -1 for left
        
        // Navigation controls
        document.getElementById('pan-up').addEventListener('click', () => {
            const currentPitch = viewer.getPitch();
            viewer.setPitch(Math.min(currentPitch + 10, 90));
        });
        
        document.getElementById('pan-down').addEventListener('click', () => {
            const currentPitch = viewer.getPitch();
            viewer.setPitch(Math.max(currentPitch - 10, -90));
        });
        
        document.getElementById('pan-left').addEventListener('click', () => {
            const currentYaw = viewer.getYaw();
            viewer.setYaw(currentYaw - 15);
        });
        
        document.getElementById('pan-right').addEventListener('click', () => {
            const currentYaw = viewer.getYaw();
            viewer.setYaw(currentYaw + 15);
        });
        
        document.getElementById('pan-center').addEventListener('click', () => {
            viewer.setPitch(0);
            viewer.setYaw(0);
            viewer.setHfov(100);
        });
        
        // Auto-rotation controls
        document.getElementById('auto-rotate-start').addEventListener('click', () => {
            if (!isAutoRotating) {
                const speed = parseFloat(document.getElementById('rotation-speed').value);
                viewer.setAutoRotate(speed * rotationDirection);
                isAutoRotating = true;
                console.log(`Started auto-rotation at ${speed}x speed`);
            }
        });
        
        document.getElementById('auto-rotate-stop').addEventListener('click', () => {
            viewer.setAutoRotate(0);
            isAutoRotating = false;
            console.log('Stopped auto-rotation');
        });
        
        document.getElementById('auto-rotate-reverse').addEventListener('click', () => {
            rotationDirection *= -1;
            if (isAutoRotating) {
                const speed = parseFloat(document.getElementById('rotation-speed').value);
                viewer.setAutoRotate(speed * rotationDirection);
            }
            console.log(`Rotation direction: ${rotationDirection > 0 ? 'right' : 'left'}`);
        });
        
        // Speed control
        document.getElementById('rotation-speed').addEventListener('input', (e) => {
            const speed = parseFloat(e.target.value);
            document.getElementById('speed-value').textContent = speed + 'x';
            if (isAutoRotating) {
                viewer.setAutoRotate(speed * rotationDirection);
            }
        });
        
        // Zoom controls
        document.getElementById('zoom-in').addEventListener('click', () => {
            const currentHfov = viewer.getHfov();
            viewer.setHfov(Math.max(currentHfov - 10, 50));
        });
        
        document.getElementById('zoom-out').addEventListener('click', () => {
            const currentHfov = viewer.getHfov();
            viewer.setHfov(Math.min(currentHfov + 10, 120));
        });
        
        document.getElementById('zoom-reset').addEventListener('click', () => {
            viewer.setHfov(100);
        });
        
        console.log('Pannellum custom controls added successfully');
        
    }, 500); // Wait for Pannellum to fully initialize
}

function handleFeatureClick(feature, featureIndex, layerConfig) {
    // Check if the feature is already selected
    const isSelected = selectedFeatures.includes(feature);

    // Toggle selection state
    toggleRowSelection(layerConfig.id, featureIndex, !isSelected);

    // Highlight if selected, reset style if deselected
    if (!isSelected) {
        // Highlight in yellow
        if (feature.setStyle) {
            feature.setStyle({
                fillColor: '#ffff00',   // Yellow highlight color
                color: '#000000',       // Black border
                weight: 3,              // Thicker border
                fillOpacity: 0.8        // More opaque when selected
            });
        }
        
        // Get the latest layer configuration from mapLayers array to ensure we have current popup settings
        const currentLayer = mapLayers.find(l => l.id === layerConfig.id) || layerConfig;
        
        // Ensure we have the record data for this feature
        let recordData = feature.recordData;
        if (!recordData && currentLayer.records && currentLayer.records[featureIndex]) {
            recordData = currentLayer.records[featureIndex].fields;
            feature.recordData = recordData; // Cache for future use
        }
        
        if (recordData) {
            // Detect media layer type and handle accordingly
            const mediaType = detectMediaLayerType(currentLayer.name, currentLayer.records);
            const mediaUrl = findUrlField(recordData);
            
            if (mediaType && mediaUrl) {
                // Handle media layers with modals
                const title = recordData.title || recordData.name || `${currentLayer.name} Media`;
                
                switch (mediaType) {
                    case 'video':
                        openVideoModal(mediaUrl, title);
                        break;
                    case 'audio':
                        openAudioModal(mediaUrl, title);
                        break;
                    case 'image':
                        openImageModal(mediaUrl, title);
                        break;
                    case 'pdf':
                        openPdfModal(mediaUrl, title);
                        break;
                    case '360':
                        open360Modal(mediaUrl, title);
                        break;
                    default:
                        // Fallback to regular popup
                        showRegularPopup(feature, recordData, currentLayer);
                }
                
                console.log(`Opened ${mediaType} modal for feature ${featureIndex} in layer "${currentLayer.name}"`);
            } else {
                // Regular layer - show popup
                showRegularPopup(feature, recordData, currentLayer);
            }
        }
    } else {
        // Reset to original style
        if (feature.setStyle) {
            const originalStyle = layerConfig.properties?.symbology || {};
            feature.setStyle({
                fillColor: originalStyle.fillColor || '#3498db',
                color: originalStyle.borderColor || '#2c3e50',
                weight: originalStyle.borderWidth || 2,
                fillOpacity: originalStyle.fillOpacity || 0.7
            });
        }
    }
}

function showRegularPopup(feature, recordData, currentLayer) {
    // Check if popups are enabled for this layer
    const popupEnabled = currentLayer.properties?.popup?.enabled !== false;
    
    if (popupEnabled) {
        // Create popup content using the current layer configuration (which includes updated popup fields)
        const popupContent = createFeaturePopup(recordData, currentLayer);
        
        // Update the popup with the new content that respects field selection
        if (feature.getPopup()) {
            feature.getPopup().setContent(popupContent);
            feature.openPopup();
        } else {
            feature.bindPopup(popupContent).openPopup();
        }
        
        console.log(`Regular popup opened for feature in layer "${currentLayer.name}" with ${currentLayer.properties?.popup?.fields?.length || 0} configured fields`);
    } else {
        console.log(`Popups disabled for layer "${currentLayer.name}" - not showing popup`);
        showInfo(`Popups are disabled for layer "${currentLayer.name}"`);
    }
}