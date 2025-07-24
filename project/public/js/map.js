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

document.addEventListener('DOMContentLoaded', function() {
    // Check authentication
    if (!window.teableAuth.requireAuth()) return;

    initializeMap();
});

async function initializeMap() {
    try {
        currentUser = window.teableAuth.getCurrentSession();
        document.getElementById('userDisplay').textContent = 
            `${currentUser.firstName} ${currentUser.lastName} (${currentUser.role})`;

        // Initialize API if needed
        if (currentUser.userType === 'space_owner') {
            window.teableAPI.init(window.teableAuth.clientConfig);
        }

        // Initialize Leaflet map
        map = L.map('map').setView([20.5937, 78.9629], 5);

        // Add default base layer
        L.tileLayer(baseMaps.openstreetmap.url, {
            attribution: baseMaps.openstreetmap.attribution
        }).addTo(map);

        // Initialize measurement group
        measurementGroup = L.layerGroup().addTo(map);

        // Load available tables
        await loadAvailableTables();

        // Setup drag and drop for GeoJSON
        setupGeoJSONDragDrop();

        console.log('Map initialized successfully');

    } catch (error) {
        console.error('Map initialization failed:', error);
        showError('Failed to initialize map: ' + error.message);
    }
}

async function loadAvailableTables() {
    try {
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
    let content = `<div class="feature-popup">`;
    content += `<h6 class="popup-title">${layerConfig.name}</h6>`;

    // Get all available fields (excluding geometry field)
    const allFields = Object.keys(fields).filter(field => field !== layerConfig.geometryField);
    
    // Get the selected popup fields from layer properties
    const selectedFields = layerConfig.properties?.popup?.fields;
    
    // Determine which fields to show
    let fieldsToShow = [];
    
    // Check if popup fields are configured in layer properties
    if (layerConfig.properties?.popup?.configured && selectedFields && Array.isArray(selectedFields)) {
        // If popup configuration exists, use ONLY the selected fields (even if empty array)
        fieldsToShow = selectedFields.filter(field => 
            field !== layerConfig.geometryField && 
            allFields.includes(field)
        );
    } else {
        // If no popup configuration exists at all, show all fields as fallback
        fieldsToShow = allFields;
    }

    // Show the determined fields
    fieldsToShow.forEach(key => {
        let value = fields[key];
        
        // Handle null, undefined, or empty values
        if (value === null || value === undefined) {
            value = '<em>No data</em>';
        } else if (value === '') {
            value = '<em>Empty</em>';
        } else if (typeof value === 'string' && value.length > 100) {
            value = value.substring(0, 100) + '...';
        }
        
        content += `<div class="popup-field"><strong>${key}:</strong> ${value}</div>`;
    });

    // Add zoom controls to popup
    content += `
        <div class="popup-controls mt-2">
            <button class="btn btn-xs btn-outline-primary me-1" onclick="window.zoomToCurrentPopupFeature('close')" title="Zoom Close">
                <i class="fas fa-search-plus"></i>
            </button>
            <button class="btn btn-xs btn-outline-secondary me-1" onclick="window.zoomToCurrentPopupFeature('medium')" title="Zoom Medium">
                <i class="fas fa-search"></i>
            </button>
            <button class="btn btn-xs btn-outline-info" onclick="window.centerCurrentPopupFeature()" title="Center">
                <i class="fas fa-crosshairs"></i>
            </button>
        </div>
    `;

    content += '</div>';
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
        layer.visible = false;
    } else {
        layer.leafletLayer.addTo(map);
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

function createDockedAttributeTable(layer) {
    // Remove existing docked table if present
    const existingTable = document.getElementById('dockedAttributeTable');
    if (existingTable) {
        existingTable.remove();
    }

    // Create docked attribute table HTML
    const dockedTableHTML = `
        <div id="dockedAttributeTable" class="docked-attribute-table">
            <div class="docked-table-header">
                <div class="d-flex justify-content-between align-items-center">
                    <h6 class="mb-0">
                        <i class="fas fa-table me-2"></i>Attribute Table - ${layer.name}
                    </h6>
                    <div class="docked-table-controls">
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
                    <div class="col-md-6">
                        <div class="d-flex gap-2">
                            <button class="btn btn-sm btn-outline-primary" onclick="selectAllRows('${layer.id}')">
                                <i class="fas fa-check-square me-1"></i>Select All
                            </button>
                            <button class="btn btn-sm btn-outline-secondary" onclick="clearSelection('${layer.id}')">
                                <i class="fas fa-square me-1"></i>Clear Selection
                            </button>
                            <button class="btn btn-sm btn-outline-success" onclick="zoomToSelection('${layer.id}')" id="zoomToSelectionBtn" disabled>
                                <i class="fas fa-search-plus me-1"></i>Zoom to Selection
                            </button>
                            <button class="btn btn-sm btn-outline-info" onclick="exportTableData('${layer.id}')">
                                <i class="fas fa-download me-1"></i>Export CSV
                            </button>
                        </div>
                    </div>
                    <div class="col-md-6 text-end">
                        <span class="text-muted">
                            <span id="selectedCount">0</span> of ${layer.records.length} features selected
                        </span>
                    </div>
                </div>
            </div>
            <div class="docked-table-content">
                <table class="table table-sm table-striped mb-0" id="attributeTable">
                    <thead class="table-dark sticky-top">
                        ${createTableHeader(layer)}
                    </thead>
                    <tbody>
                        ${createTableBody(layer)}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Add docked table to map container
    const mapContainer = document.querySelector('.map-container');
    mapContainer.insertAdjacentHTML('beforeend', dockedTableHTML);

    // Adjust map height to accommodate the docked table
    adjustMapForDockedTable();
}

function createTableHeader(layer) {
    if (!layer.records || layer.records.length === 0) return '';

    const fields = Object.keys(layer.records[0].fields || {});
    let headerHTML = '<tr>';

    // Add selection checkbox column
    headerHTML += '<th style="width: 40px;"><input type="checkbox" onchange="toggleAllRows(this, \'' + layer.id + '\')"></th>';

    // Add field columns
    fields.forEach(field => {
        if (field !== layer.geometryField) {
            headerHTML += `<th>${field}</th>`;
        }
    });

    // Add actions column
    headerHTML += '<th style="width: 100px;">Actions</th>';
    headerHTML += '</tr>';

    return headerHTML;
}

function createTableBody(layer) {
    if (!layer.records || layer.records.length === 0) return '';

    const fields = Object.keys(layer.records[0].fields || {});
    let bodyHTML = '';

    layer.records.forEach((record, index) => {
        bodyHTML += `<tr data-record-id="${record.id}" data-feature-index="${index}">`;

        // Add selection checkbox
        bodyHTML += `<td><input type="checkbox" class="row-selector" onchange="toggleRowSelection('${layer.id}', ${index}, this.checked)"></td>`;

        // Add field data
        fields.forEach(field => {
            if (field !== layer.geometryField) {
                let value = record.fields[field];
                if (value === null || value === undefined) {
                    value = '';
                } else if (typeof value === 'string' && value.length > 50) {
                    value = value.substring(0, 50) + '...';
                }
                bodyHTML += `<td title="${record.fields[field] || ''}">${value}</td>`;
            }
        });

        // Add actions
        bodyHTML += `
            <td>
                <button class="btn btn-xs btn-outline-primary" onclick="zoomToFeature('${layer.id}', ${index})" title="Zoom to Feature">
                    <i class="fas fa-search-plus"></i>
                </button>
                <button class="btn btn-xs btn-outline-info" onclick="showFeatureInfo('${layer.id}', ${index})" title="Show Info">
                    <i class="fas fa-info-circle"></i>
                </button>
            </td>
        `;

        bodyHTML += '</tr>';
    });

    return bodyHTML;
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

    // Symbology tab
        const symbology = layer.properties?.symbology || {};
        const propSymbologyType = document.getElementById('propSymbologyType');
        const propFillColor = document.getElementById('propFillColor');
        const propBorderColor = document.getElementById('propBorderColor');
        const propBorderWidth = document.getElementById('propBorderWidth');
        const propFillOpacity = document.getElementById('propFillOpacity');
        const fillOpacityValue = document.getElementById('fillOpacityValue');
        const borderWidthValue = document.getElementById('borderWidthValue');
        
        if (propSymbologyType) propSymbologyType.value = symbology.type || 'single';
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
        const propMaxPopupWidth = document.getElementById('propMaxPopupWidth');
        if (propMaxPopupWidth) propMaxPopupWidth.value = layer.properties?.popup?.maxWidth || 300;

        // Update symbology type display
        updateSymbologyType();
        
    } catch (error) {
        console.error('Error populating properties modal:', error);
        showError('Failed to load layer properties: ' + error.message);
    }
}

function populateFieldSelectors(layer) {
    if (!layer.records || layer.records.length === 0) return;

    const fields = Object.keys(layer.records[0].fields || {}).filter(field => field !== layer.geometryField);

    // Populate label field selector
    const labelFieldSelect = document.getElementById('propLabelField');
    if (labelFieldSelect) {
        const currentValue = labelFieldSelect.value;
        labelFieldSelect.innerHTML = '<option value="">Select field...</option>';
        fields.forEach(field => {
            const option = document.createElement('option');
            option.value = field;
            option.textContent = field;
            labelFieldSelect.appendChild(option);
        });
        if (currentValue) labelFieldSelect.value = currentValue;
    }

    // Populate graduated field selector
    const graduatedFieldSelect = document.getElementById('propGraduatedField');
    if (graduatedFieldSelect) {
        const currentValue = graduatedFieldSelect.value;
        graduatedFieldSelect.innerHTML = '<option value="">Select numeric field...</option>';
        fields.forEach(field => {
            // Try to determine if field is numeric by checking sample values
            const isNumeric = layer.records.some(record => {
                const value = record.fields[field];
                return !isNaN(parseFloat(value)) && isFinite(value);
            });

            if (isNumeric) {
                const option = document.createElement('option');
                option.value = field;
                option.textContent = field;
                graduatedFieldSelect.appendChild(option);
            }
        });
        if (currentValue) graduatedFieldSelect.value = currentValue;
    }

    // Populate categorized field selector
    const categorizedFieldSelect = document.getElementById('propCategorizedField');
    if (categorizedFieldSelect) {
        const currentValue = categorizedFieldSelect.value;
        categorizedFieldSelect.innerHTML = '<option value="">Select field...</option>';
        fields.forEach(field => {
            const option = document.createElement('option');
            option.value = field;
            option.textContent = field;
            categorizedFieldSelect.appendChild(option);
        });
        if (currentValue) categorizedFieldSelect.value = currentValue;
    }
}

function populatePopupFieldsSelector(layer) {
    const container = document.getElementById('propPopupFields');
    if (!container || !layer.records || layer.records.length === 0) return;

    const fields = Object.keys(layer.records[0].fields || {}).filter(field => field !== layer.geometryField);
    const selectedFields = layer.properties?.popup?.fields || [];

    let html = '';
    fields.forEach(field => {
        const isSelected = selectedFields.includes(field);
        html += `
            <div class="field-checkbox">
                <input class="form-check-input" type="checkbox" id="popup_field_${field}" 
                       ${isSelected ? 'checked' : ''} onchange="updatePopupFieldSelection('${field}', this.checked)">
                <label class="form-check-label" for="popup_field_${field}">
                    ${field}
                </label>
            </div>
        `;
    });

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

    // Update selection count
    updateSelectionCount();
}

function updateSelectionCount() {
    const countElement = document.getElementById('selectedCount');
    const zoomButton = document.getElementById('zoomToSelectionBtn');

    if (countElement) {
        countElement.textContent = selectedFeatures.length;
    }

    if (zoomButton) {
        zoomButton.disabled = selectedFeatures.length === 0;
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
    if (!layer || !layer.features[featureIndex]) return;

    const feature = layer.features[featureIndex];

    // Store reference for popup zoom controls
    window.currentPopupFeature = feature;

    const defaultOptions = {
        padding: 0.3,
        maxZoom: 18,
        minZoom: 10
    };

    const zoomOptions = { ...defaultOptions, ...options };

    if (feature.getBounds) {
        // Polygon or complex geometry
        const bounds = feature.getBounds();
        map.fitBounds(bounds.pad(zoomOptions.padding), {
            maxZoom: zoomOptions.maxZoom
        });
    } else if (feature.getLatLng) {
        // Point geometry
        const latlng = feature.getLatLng();
        map.setView(latlng, Math.max(zoomOptions.minZoom, map.getZoom()));
    }

    // Open popup if feature has one
    if (feature.getPopup && feature.getPopup()) {
        feature.openPopup();
    }

    showSuccess('Zoomed to feature');
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

    // Create popup content
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
}

function exportTableData(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer || !layer.records) {
        showError('No data to export');
        return;
    }

    try {
        // Prepare CSV data
        const fields = Object.keys(layer.records[0].fields || {}).filter(field => field !== layer.geometryField);

        // Create CSV header
        let csvContent = fields.join(',') + '\n';

        // Add data rows
        layer.records.forEach(record => {
            const row = fields.map(field => {
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

        showSuccess('Data exported successfully');
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

    // Add new base layer
    const basemap = baseMaps[basemapType];
    if (basemap) {
        L.tileLayer(basemap.url, {
            attribution: basemap.attribution
        }).addTo(map);
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
    const symbologyType = document.getElementById('propSymbologyType').value;
    const singleControls = document.getElementById('propSingleSymbol');
    const graduatedControls = document.getElementById('propGraduated');
    const categorizedControls = document.getElementById('propCategorized');

    // Hide all controls first
    if (singleControls) singleControls.style.display = 'none';
    if (graduatedControls) graduatedControls.style.display = 'none';
    if (categorizedControls) categorizedControls.style.display = 'none';

    // Show relevant controls
    switch (symbologyType) {
        case 'single':
            if (singleControls) singleControls.style.display = 'block';
            break;
        case 'graduated':
            if (graduatedControls) graduatedControls.style.display = 'block';
            break;
        case 'categorized':
            if (categorizedControls) categorizedControls.style.display = 'block';
            break;
    }
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

    // Update the actual layer reference in mapLayers array immediately
    const layerIndex = mapLayers.findIndex(l => l.id === layer.id);
    if (layerIndex !== -1) {
        // Deep copy to ensure changes are reflected
        if (!mapLayers[layerIndex].properties) mapLayers[layerIndex].properties = {};
        if (!mapLayers[layerIndex].properties.popup) mapLayers[layerIndex].properties.popup = {};
        mapLayers[layerIndex].properties.popup.fields = [...layer.properties.popup.fields];

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
    const classes = parseInt(document.getElementById('propGraduatedClasses').value);
    const colorRamp = document.getElementById('propColorRamp').value;

    if (!field || !window.currentPropertiesLayer) {
        showError('Please select a field for graduated symbology');
        return;
    }

    const layer = window.currentPropertiesLayer;
    const values = layer.records.map(record => parseFloat(record.fields[field])).filter(v => !isNaN(v));

    if (values.length === 0) {
        showError('No numeric values found in the selected field');
        return;
    }

    // Calculate class breaks
    values.sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];
    const interval = (max - min) / classes;

    // Generate color ramp
    const colors = generateColorRamp(colorRamp, classes);

    // Create legend
    let legendHTML = '<div class="graduated-legend">';
    for (let i = 0; i < classes; i++) {
        const minVal = (min + i * interval).toFixed(2);
        const maxVal = (min + (i + 1) * interval).toFixed(2);
        legendHTML += `
            <div class="legend-item">
                <div class="legend-color" style="background-color: ${colors[i]}"></div>
                <span>${minVal} - ${maxVal}</span>
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
    layer.properties.symbology = {
        type: 'graduated',
        field: field,
        classes: classes,
        colorRamp: colorRamp,
        breaks: Array.from({length: classes}, (_, i) => min + (i + 1) * interval),
        colors: colors
    };

    showSuccess('Graduated symbology generated successfully');
}

function generateCategorizedSymbology() {
    const field = document.getElementById('propCategorizedField').value;

    if (!field || !window.currentPropertiesLayer) {
        showError('Please select a field for categorized symbology');
        return;
    }

    const layer = window.currentPropertiesLayer;
    const uniqueValues = [...new Set(layer.records.map(record => record.fields[field]).filter(v => v != null))];

    if (uniqueValues.length === 0) {
        showError('No values found in the selected field');
        return;
    }

    // Generate colors
    const colors = generateColorPalette(uniqueValues.length);

    // Create legend
    let legendHTML = '<div class="categorized-legend">';
    uniqueValues.forEach((value, index) => {
        legendHTML += `
            <div class="legend-item">
                <div class="legend-color" style="background-color: ${colors[index]}"></div>
                <span>${value}</span>
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
    layer.properties.symbology = {
        type: 'categorized',
        field: field,
        categories: uniqueValues.map((value, index) => ({
            value: value,
            color: colors[index],
            label: String(value)
        }))
    };

    showSuccess('Categorized symbology generated successfully');
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

    layer.properties.symbology.fillColor = document.getElementById('propFillColor').value;
    layer.properties.symbology.borderColor = document.getElementById('propBorderColor').value;
    layer.properties.symbology.borderWidth = parseInt(document.getElementById('propBorderWidth').value);
    layer.properties.symbology.fillOpacity = parseFloat(document.getElementById('propFillOpacity').value);

    // Update labels properties
    if (!layer.properties.labels) layer.properties.labels = {};
    layer.properties.labels.enabled = document.getElementById('propEnableLabels').checked;
    layer.properties.labels.field = document.getElementById('propLabelField').value;
    layer.properties.labels.fontSize = parseInt(document.getElementById('propLabelSize').value);
    layer.properties.labels.color = document.getElementById('propLabelColor').value;
    layer.properties.labels.background = document.getElementById('propLabelBackground').checked;

    // Update popup properties
    if (!layer.properties.popup) layer.properties.popup = {};
    layer.properties.popup.maxWidth = parseInt(document.getElementById('propMaxPopupWidth').value);
    
    // Collect selected popup fields from checkboxes
    const selectedPopupFields = [];
    const popupCheckboxes = document.querySelectorAll('#propPopupFields input[type="checkbox"]:checked');
    popupCheckboxes.forEach(checkbox => {
        const fieldName = checkbox.id.replace('popup_field_', '');
        selectedPopupFields.push(fieldName);
    });
    
    // Update popup fields in layer properties - ensure it's always an array
    layer.properties.popup.fields = selectedPopupFields;
    
    // Mark that popup configuration has been set
    layer.properties.popup.configured = true;

    // Update the actual layer reference in mapLayers array
    const layerIndex = mapLayers.findIndex(l => l.id === layer.id);
    if (layerIndex !== -1) {
        // Update the layer properties in the main array
        mapLayers[layerIndex].properties = { ...layer.properties };
        mapLayers[layerIndex].name = layer.name;

        // Refresh popup content for all features in this layer to apply new field selections
        mapLayers[layerIndex].features.forEach((feature, index) => {
            if (feature.recordData) {
                const newPopupContent = createFeaturePopup(feature.recordData, mapLayers[layerIndex]);
                feature.bindPopup(newPopupContent);
            } else if (mapLayers[layerIndex].records && mapLayers[layerIndex].records[index]) {
                // Use record data if feature.recordData is not available
                const newPopupContent = createFeaturePopup(mapLayers[layerIndex].records[index].fields, mapLayers[layerIndex]);
                feature.bindPopup(newPopupContent);
            }
        });
    }

    // Apply changes to map features
    applyLayerStyling(layer);

    // Update layers list
    updateLayersList();

    showSuccess(`Layer properties applied successfully! Popup will show ${selectedPopupFields.length} selected field(s).`);
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
    if (!layer.features || !layer.properties) return;

    const symbology = layer.properties.symbology;

    layer.features.forEach(feature => {
        if (feature.setStyle) {
            feature.setStyle({
                fillColor: symbology.fillColor || '#3498db',
                color: symbology.borderColor || '#2c3e50',
                weight: symbology.borderWidth || 2,
                fillOpacity: symbology.fillOpacity || 0.7
            });
        }
    });

    // Apply labels if enabled
    if (layer.properties.labels && layer.properties.labels.enabled) {
        applyLabelsToLayer(layer);
    }
}

function applyLabelsToLayer(layer) {
    // Remove existing labels
    if (layer.labelGroup) {
        map.removeLayer(layer.labelGroup);
    }

    const labels = layer.properties.labels;
    if (!labels.enabled || !labels.field) return;

    const labelMarkers = [];

    layer.features.forEach((feature, index) => {
        const record = layer.records[index];
        if (!record || !record.fields[labels.field]) return;

        let labelPosition;
        if (feature.getLatLng) {
            labelPosition = feature.getLatLng();
        } else if (feature.getBounds) {
            labelPosition = feature.getBounds().getCenter();
        } else {
            return;
        }

        const labelText = record.fields[labels.field];
        const labelMarker = L.marker(labelPosition, {
            icon: L.divIcon({
                className: 'enhanced-feature-label',
                html: labelText,
                iconSize: [null, null],
                iconAnchor: [0, 0]
            })
        });

        labelMarkers.push(labelMarker);
    });

    if (labelMarkers.length > 0) {
        layer.labelGroup = L.layerGroup(labelMarkers).addTo(map);
    }
}

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
window.updatePopupFieldSelection = updatePopupFieldSelection;

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
    if (!window.currentPopupFeature) return;

    const options = {
        close: { padding: 0.8, maxZoom: 20, minZoom: 16 },
        medium: { padding: 0.4, maxZoom: 16, minZoom: 12 },
        far: { padding: 0.2, maxZoom: 12, minZoom: 8 }
    };

    zoomToFeature(window.currentPopupFeature, options[zoomType] || options.close);
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

    // Calculate adaptive padding
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lngSpan = bounds.getEast() - bounds.getWest();
    const maxSpan = Math.max(latSpan, lngSpan);

    let padding = maxSpan < 0.01 ? 0.3 : maxSpan < 0.1 ? 0.2 : 0.1;

    map.fitBounds(bounds.pad(padding), { animate: true, duration: 1 });

    showSuccess(`Zoomed to ${visibleLayers.length} visible layer(s) with ${allFeatures.length} features`);
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

        const fields = Object.keys(layer.records[0].fields || {});
        fields.forEach(field => {
            if (field !== layer.geometryField) {
                const option = document.createElement('option');
                option.value = field;
                option.textContent = field;
                fieldSelect.appendChild(option);
            }
        });
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

    mapLayers.forEach(layer => {
        if (!layer.visible) return;

        const layerFilters = currentFilters.filter(f => f.layerId === layer.id);

        layer.features.forEach(feature => {
            totalCount++;
            let showFeature = true;

            // Apply all filters for this layer
            layerFilters.forEach(filter => {
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

    showSuccess(`Filters applied: showing ${filteredCount} of ${totalCount} features`);
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
    showInfo('Map fullscreen functionality would be implemented here');
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
        
        // Create popup content with all fields if no specific selection, or selected fields if configured
        const popupContent = createFeaturePopup(feature.recordData, layerConfig);
        
        // Open popup with updated content
        if (feature.bindPopup) {
            feature.bindPopup(popupContent).openPopup();
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