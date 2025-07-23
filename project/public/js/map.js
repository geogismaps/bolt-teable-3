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
        const userDisplayElement = document.getElementById('userDisplay');
        if (userDisplayElement) {
            userDisplayElement.textContent = 
                `${currentUser.firstName} ${currentUser.lastName} (${currentUser.role})`;
        }

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

        // Setup layer list sortable
        setupLayerSorting();

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
        if (linkedTablesInfo) {
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

            // If no obvious candidates, check field content for geometry patterns
            if (geometryFieldCandidates.length === 0) {
                for (const field of fields) {
                    const sampleValue = recordsData.records[0].fields[field];
                    if (typeof sampleValue === 'string' && sampleValue.length > 10) {
                        const upperValue = sampleValue.toUpperCase();
                        if (upperValue.includes('POINT') || 
                            upperValue.includes('POLYGON') || 
                            upperValue.includes('LINESTRING') ||
                            upperValue.includes('MULTIPOLYGON') ||
                            upperValue.includes('MULTIPOINT')) {
                            geometryFieldCandidates.push(field);
                            break;
                        }
                    }
                }
            }

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

                // If we detected a geometry field, show it in the info
                if (detectedGeometryField) {
                    showSuccess(`Auto-detected geometry field: ${detectedGeometryField}`);
                }
            }

            // Show linked tables info
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

            // If no obvious candidates, check field content for geometry patterns
            if (geometryFieldCandidates.length === 0) {
                for (const field of sampleFields) {
                    const sampleValue = records[0].fields[field];
                    if (typeof sampleValue === 'string' && sampleValue.length > 10) {
                        const upperValue = sampleValue.toUpperCase();
                        if (upperValue.includes('POINT') || 
                            upperValue.includes('POLYGON') || 
                            upperValue.includes('LINESTRING') ||
                            upperValue.includes('MULTIPOLYGON') ||
                            upperValue.includes('MULTIPOINT')) {
                            geometryFieldCandidates.push(field);
                            break;
                        }
                    }
                }
            }

            if (geometryFieldCandidates.length > 0) {
                detectedGeometryField = geometryFieldCandidates[0];
                console.log(`Auto-detected geometry field: ${detectedGeometryField}`);
            } else {
                throw new Error('No geometry field found. Please specify the geometry field manually or ensure your data contains valid WKT/GeoJSON geometry.');
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
            const newLayerTable = document.getElementById('newLayerTable');
            const newLayerName = document.getElementById('newLayerName');
            const newLayerColor = document.getElementById('newLayerColor');
            const newLayerGeometry = document.getElementById('newLayerGeometry');

            if (newLayerTable) newLayerTable.value = '';
            if (newLayerName) newLayerName.value = '';
            if (newLayerColor) newLayerColor.value = '#3498db';
            if (newLayerGeometry) newLayerGeometry.value = '';

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
                        // Handle different geometry types
                        if (leafletGeometry.lat && leafletGeometry.lng) {
                            // Point geometry - validate coordinates
                            if (leafletGeometry.lat >= -90 && leafletGeometry.lat <= 90 && 
                                leafletGeometry.lng >= -180 && leafletGeometry.lng <= 180) {

                                const marker = L.marker([leafletGeometry.lat, leafletGeometry.lng], {
                                    color: layerConfig.color
                                });

                                const popupContent = createFeaturePopup(record.fields, layerConfig);
                                marker.bindPopup(popupContent);
                                marker.recordId = record.id;
                                marker.recordData = record.fields;
                                marker.layerId = layerConfig.id;

                                // Store reference for popup zoom controls
                                marker.on('popupopen', function() {
                                    window.currentPopupFeature = marker;
                                });

                                features.push(marker);
                                validFeatureCount++;
                            } else {
                                console.warn(`Invalid coordinates for record ${index}: lat=${leafletGeometry.lat}, lng=${leafletGeometry.lng}`);
                            }

                        } else if (Array.isArray(leafletGeometry)) {
                            // Polygon or MultiPolygon geometry
                            leafletGeometry.forEach((polygonCoords, polyIndex) => {
                                if (Array.isArray(polygonCoords) && polygonCoords.length > 0) {
                                    // Validate polygon structure
                                    const validRings = [];

                                    polygonCoords.forEach((ring, ringIndex) => {
                                        if (Array.isArray(ring) && ring.length >= 3) { // Minimum 3 points for a polygon
                                            const validCoords = ring.filter(coord => 
                                                Array.isArray(coord) && coord.length >= 2 &&
                                                !isNaN(coord[0]) && !isNaN(coord[1]) &&
                                                coord[0] >= -90 && coord[0] <= 90 && 
                                                coord[1] >= -180 && coord[1] <= 180
                                            );

                                            if (validCoords.length >= 3) {
                                                // Ensure polygon is closed
                                                const firstCoord = validCoords[0];
                                                const lastCoord = validCoords[validCoords.length - 1];

                                                if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
                                                    validCoords.push([firstCoord[0], firstCoord[1]]);
                                                }

                                                validRings.push(validCoords);
                                            }
                                        }
                                    });

                                    if (validRings.length > 0) {
                                        try {
                                            const polygon = L.polygon(validRings, {
                                                fillColor: layerConfig.color,
                                                color: layerConfig.color,
                                                weight: 2,
                                                fillOpacity: 0.7,
                                                smoothFactor: 1.0
                                            });

                                            const popupContent = createFeaturePopup(record.fields, layerConfig);
                                            polygon.bindPopup(popupContent);
                                            polygon.recordId = record.id;
                                            polygon.recordData = record.fields;
                                            polygon.layerId = layerConfig.id;

                                            // Store reference for popup zoom controls
                                            polygon.on('popupopen', function() {
                                                window.currentPopupFeature = polygon;
                                            });

                                            features.push(polygon);
                                            validFeatureCount++;

                                            // Add labels if configured with smart positioning
                                            if (layerConfig.labels?.enabled && layerConfig.labels?.field && record.fields[layerConfig.labels.field]) {
                                                const labelText = String(record.fields[layerConfig.labels.field]);

                                                // Use smart positioning based on polygon size
                                                const bounds = polygon.getBounds();
                                                const latSpan = bounds.getNorth() - bounds.getSouth();
                                                const lngSpan = bounds.getEast() - bounds.getWest();
                                                const polygonSize = Math.max(latSpan, lngSpan);

                                                let direction = 'center';
                                                let offset = [0, 0];

                                                // For very small polygons, position label above
                                                if (polygonSize < 0.001) {
                                                    direction = 'top';
                                                    offset = [0, -10];
                                                } else if (polygonSize < 0.01) {
                                                    // For small polygons, slight offset to avoid overlap
                                                    offset = [Math.random() * 20 - 10, Math.random() * 20 - 10];
                                                }

                                                polygon.bindTooltip(labelText, {
                                                    permanent: true,
                                                    direction: direction,
                                                    className: 'enhanced-feature-label',
                                                    offset: offset,
                                                    opacity: 1.0
                                                });
                                            }
                                        } catch (polygonError) {
                                            console.warn(`Error creating polygon for record ${index}:`, polygonError);
                                        }
                                    } else {
                                        console.warn(`No valid rings found for polygon in record ${index}`);
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

        // Calculate bounds with improved validation
        if (features.length > 0) {
            try {
                const validFeatures = features.filter(feature => {
                    if (feature.getLatLng) {
                        // Point feature
                        const latlng = feature.getLatLng();
                        return latlng && !isNaN(latlng.lat) && !isNaN(latlng.lng);
                    } else if (feature.getLatLngs) {
                        // Polygon/line feature
                        const latlngs = feature.getLatLngs();
                        return latlngs && latlngs.length > 0;
                    }
                    return false;
                });

                if (validFeatures.length > 0) {
                    const group = new L.featureGroup(validFeatures);
                    layer.bounds = group.getBounds();

                    // Validate bounds
                    if (layer.bounds && 
                        !isNaN(layer.bounds.getNorth()) && 
                        !isNaN(layer.bounds.getSouth()) && 
                        !isNaN(layer.bounds.getEast()) && 
                        !isNaN(layer.bounds.getWest()) &&
                        layer.bounds.getNorth() >= -90 && layer.bounds.getNorth() <= 90 &&
                        layer.bounds.getSouth() >= -90 && layer.bounds.getSouth() <= 90 &&
                        layer.bounds.getEast() >= -180 && layer.bounds.getEast() <= 180 &&
                        layer.bounds.getWest() >= -180 && layer.bounds.getWest() <= 180) {

                        console.log(`Layer bounds calculated: ${layer.bounds.toBBoxString()}`);
                    } else {
                        console.warn('Invalid bounds calculated for layer');
                        layer.bounds = null;
                    }
                } else {
                    console.warn('No valid features for bounds calculation');
                    layer.bounds = null;
                }
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

    // Get the selected popup fields from layer properties
    const selectedFields = layerConfig.properties && layerConfig.properties.popup && layerConfig.properties.popup.fields 
        ? layerConfig.properties.popup.fields 
        : Object.keys(fields).filter(key => key !== layerConfig.geometryField);

    // Only show selected fields
    selectedFields.forEach(key => {
        if (key !== layerConfig.geometryField && fields[key] !== null && fields[key] !== undefined) {
            let value = fields[key];
            if (typeof value === 'string' && value.length > 100) {
                value = value.substring(0, 100) + '...';
            }
            content += `<div class="popup-field"><strong>${key}:</strong> ${value}</div>`;
        }
    });

    // Show message if no fields selected
    if (selectedFields.length === 0) {
        content += `<div class="popup-field"><em>No popup fields configured</em></div>`;
    }

    // Add zoom controls
    content += `
        <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid #eee; text-align: center;">
            <button onclick="zoomToCurrentPopupFeature('close')" 
                    class="btn btn-sm btn-primary me-1" style="font-size: 10px; padding: 3px 6px;">
                <i class="fas fa-search-plus"></i> Zoom
            </button>
            <button onclick="zoomToCurrentPopupFeature('medium')" 
                    class="btn btn-sm btn-secondary me-1" style="font-size: 10px; padding: 3px 6px;">
                <i class="fas fa-expand-arrows-alt"></i> Fit
            </button>
            <button onclick="centerCurrentPopupFeature()" 
                    class="btn btn-sm btn-info" style="font-size: 10px; padding: 3px 6px;">
                <i class="fas fa-crosshairs"></i> Center
            </button>
        </div>
    `;

    content += '</div>';
    return content;
}

// Parse WKT to Leaflet coordinates with improved coordinate handling
function parseWKTToLeaflet(wkt) {
    try {
        if (!wkt || typeof wkt !== 'string') {
            return null;
        }

        // Clean up common WKT formatting issues
        let cleanWkt = wkt.trim();

        // Remove common prefixes that might be present
        cleanWkt = cleanWkt.replace(/^SRID=\d+;/i, ''); // Remove SRID if present
        cleanWkt = cleanWkt.replace(/^\s+|\s+$/g, ''); // Trim whitespace

        const upperCleanWKT = cleanWkt.toUpperCase().trim();

        console.log('Parsing WKT:', upperCleanWKT.substring(0, 100) + '...');

        // Parse based on geometry type with better error handling
        if (upperCleanWKT.startsWith('MULTIPOLYGON')) {
            return parseMultiPolygon(cleanWkt);
        } else if (upperCleanWKT.startsWith('POLYGON')) {
            return parsePolygon(cleanWkt);
        } else if (upperCleanWKT.startsWith('POINT')) {
            return parsePoint(cleanWkt);
        } else if (upperCleanWKT.startsWith('MULTIPOINT')) {
            return parseMultiPoint(cleanWkt);
        } else if (upperCleanWKT.startsWith('LINESTRING')) {
            return parseLineString(cleanWkt);
        } else if (upperCleanWKT.startsWith('MULTILINESTRING')) {
            return parseMultiLineString(cleanWkt);
        }

        console.warn('Unknown WKT geometry type:', upperCleanWKT.split('(')[0]);
        return null;
    } catch (error) {
        console.error('Error parsing WKT:', error, 'Input WKT:', wkt?.substring(0, 100));
        return null;
    }
}

// Handle projected coordinates with improved transformation
function parseProjectedGeometry(wkt) {
    try {
        console.warn('Attempting coordinate transformation for projected data');

        const upperWKT = wkt.toUpperCase().trim();

        if (upperWKT.startsWith('MULTIPOLYGON')) {
            return parseProjectedMultiPolygon(wkt);
        } else if (upperWKT.startsWith('POLYGON')) {
            return parseProjectedPolygon(wkt);
        } else if (upperWKT.startsWith('POINT')) {
            return parseProjectedPoint(wkt);
        } else if (upperWKT.startsWith('LINESTRING')) {
            return parseProjectedLineString(wkt);
        }

        return null;
    } catch (error) {
        console.error('Error handling projected coordinates:', error);
        return null;
    }
}

// Transform projected coordinates to geographic coordinates
function transformProjectedCoordinates(x, y) {
    console.log(`Transforming projected coordinates: x=${x}, y=${y}`);

    let lon, lat;

    // Determine the scale and likely projection system
    const xMagnitude = Math.abs(x);
    const yMagnitude = Math.abs(y);

    if (xMagnitude > 1000000 || yMagnitude > 1000000) {
        // Very large coordinates - likely in a high-precision projected system
        // Apply a significant scaling factor
        const scaleFactor = 100000; // Adjust based on your data
        lon = x / scaleFactor;
        lat = y / scaleFactor;

        console.log(`Large scale transformation applied: factor=${scaleFactor}`);

    } else if (xMagnitude > 100000 || yMagnitude > 100000) {
        // UTM-like coordinates
        // Rough conversion assuming coordinates are in meters
        const metersPerDegree = 111320; // Approximate at equator
        lon = x / metersPerDegree;
        lat = y / 111000; // Slightly different for latitude

        console.log('UTM-like transformation applied');

    } else if (xMagnitude > 1000 || yMagnitude > 1000) {
        // Medium scale coordinates - possibly kilometers
        lon = x / 1000; // Rough conversion
        lat = y / 1000;

        console.log('Medium scale transformation applied');

    } else {
        // Assume already in degrees but potentially with wrong order
        lon = x;
        lat = y;

        console.log('No transformation applied - assuming degrees');
    }

    // Normalize longitude to [-180, 180]
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;

    // Clamp latitude to [-90, 90]
    lat = Math.max(-90, Math.min(90, lat));

    // If still out of range, try different scaling or swapping
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
        console.log('Coordinates still out of range after transformation, trying alternative approach');

        // Try swapping and rescaling
        if (Math.abs(y) <= 180 && Math.abs(x) <= 90) {
            lon = y;
            lat = x;
        } else {
            // Apply more aggressive scaling
            const scale = Math.max(Math.abs(x) / 100, Math.abs(y) / 100);
            lon = x / scale;
            lat = y / scale;

            // Normalize again
            while (lon > 180) lon -= 360;
            while (lon < -180) lon += 360;
            lat = Math.max(-90, Math.min(90, lat));
        }
    }

    console.log(`Transformation result: lat=${lat}, lon=${lon}`);
    return [lat, lon]; // Return in Leaflet format [lat, lon]
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
                    let x = parseFloat(parts[0]);
                    let y = parseFloat(parts[1]);

                    // Validate that coordinates are numbers
                    if (isNaN(x) || isNaN(y)) {
                        console.warn(`Invalid coordinate values: x=${parts[0]}, y=${parts[1]}`);
                        return null;
                    }

                    // Determine coordinate order - WKT standard is LONGITUDE LATITUDE (X Y)
                    let lat, lon;

                    // Check if coordinates need transformation (very large values indicate projected coordinates)
                    if (Math.abs(x) > 1000 || Math.abs(y) > 1000) {
                        console.log(`Large coordinates detected: x=${x}, y=${y} - applying transformation`);
                        const transformed = transformProjectedCoordinates(x, y);
                        lat = transformed[0];
                        lon = transformed[1];
                    } else {
                        // For geographic coordinates, WKT standard is lon, lat
                        lon = x;
                        lat = y;

                        // Validate geographic ranges
                        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
                            // If standard order doesn't work, try swapped order
                            if (Math.abs(x) <= 90 && Math.abs(y) <= 180) {
                                lat = x;
                                lon = y;
                                console.log(`Swapped coordinate order for: lat=${lat}, lon=${lon}`);
                            } else {
                                console.warn(`Coordinates out of valid range: x=${x}, y=${y}`);
                                return null;
                            }
                        }
                    }

                    // Final validation
                    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                        return [lat, lon]; // Leaflet format: [lat, lon]
                    } else {
                        console.warn(`Final validation failed: lat=${lat}, lon=${lon}`);
                        return null;
                    }
                }
                return null;
            }).filter(coord => coord !== null);

            // Ensure polygon is closed and has minimum points
            if (validCoords.length >= 3) {
                const first = validCoords[0];
                const last = validCoords[validCoords.length - 1];

                // Close polygon if not already closed
                if (Math.abs(first[0] - last[0]) > 0.0001 || Math.abs(first[1] - last[1]) > 0.0001) {
                    validCoords.push([first[0], first[1]]);
                    console.log('Polygon closed automatically');
                }

                return validCoords;
            } else {
                console.warn(`Insufficient valid coordinates for polygon ring: ${validCoords.length}`);
                return null;
            }
        }).filter(ring => ring && ring.length >= 4); // Minimum 4 points for a closed polygon
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
            let x = parseFloat(parts[0]);
            let y = parseFloat(parts[1]);

            if (isNaN(x) || isNaN```python
(y)) {
                console.warn(`Invalid point coordinate values: x=${parts[0]}, y=${parts[1]}`);
                return null;
            }

            console.log(`Parsing point: x=${x}, y=${y}`);

            let lat, lon;

            // Handle projected coordinates
            if (Math.abs(x) > 1000 || Math.abs(y) > 1000) {
                console.log('Large coordinates detected for point - applying transformation');
                const transformed = transformProjectedCoordinates(x, y);
                lat = transformed[0];
                lon = transformed[1];
            } else {
                // For geographic coordinates, WKT standard is lon, lat
                lon = x;
                lat = y;

                // Validate and potentially swap if out of range
                if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
                    if (Math.abs(x) <= 90 && Math.abs(y) <= 180) {
                        lat = x;
                        lon = y;
                        console.log(`Swapped point coordinates: lat=${lat}, lng=${lon}`);
                    } else {
                        console.warn(`Point coordinates out of valid range: x=${x}, y=${y}`);
                        return null;
                    }
                }
            }

            // Validate final coordinates
            if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
                console.log(`Valid point created: lat=${lat}, lng=${lon}`);
                return { lat: lat, lng: lon };
            } else {
                console.warn(`Final point validation failed: lat=${lat}, lng=${lon}`);
                return null;
            }
        }

        console.warn(`Insufficient coordinate parts for point: ${parts.length}`);
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

// Handle projected polygon coordinates
function parseProjectedPolygon(wkt) {
    try {
        let cleanWkt = wkt.replace(/^POLYGON\s*\(/i, '').replace(/\)$/, '');
        return [parseProjectedPolygonRings(cleanWkt)];
    } catch (error) {
        console.error('Error parsing projected POLYGON:', error);
        return null;
    }
}

function parseProjectedMultiPolygon(wkt) {
    try {
        let cleanWkt = wkt.replace(/^MULTIPOLYGON\s*\(\s*\(/i, '').replace(/\)\s*\)$/, '');
        const polygonStrings = cleanWkt.split(')),((');

        return polygonStrings.map(polygonString => {
            const cleanPolygon = polygonString.replace(/^\(+/, '').replace(/\)+$/, '');
            return parseProjectedPolygonRings(cleanPolygon);
        }).filter(polygon => polygon !== null);
    } catch (error) {
        console.error('Error parsing projected MULTIPOLYGON:', error);
        return null;
    }
}

function parseProjectedPolygonRings(polygonString) {
    try {
        const rings = polygonString.split('),(');

        return rings.map(ring => {
            const cleanRing = ring.replace(/^\(+/, '').replace(/\)+$/, '');
            const coords = cleanRing.split(',');

            // Find coordinate bounds to determine scaling
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            const rawCoords = coords.map(coord => {
                const parts = coord.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const x = parseFloat(parts[0]);
                    const y = parseFloat(parts[1]);
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                    return [x, y];
                }
                return null;
            }).filter(coord => coord !== null);

            // Simple scaling approach - assume coordinates are in meters
            // and convert to approximate degrees (very rough approximation)
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;

            // Rough conversion: 1 degree ≈ 111,000 meters at equator
            const scaleFactor = 1 / 111000;

            return rawCoords.map(([x, y]) => {
                // Convert to approximate lat/lon
                const approximateLon = (x - centerX) * scaleFactor + 78.9629; // Use map center as reference
                const approximateLat = (y - centerY) * scaleFactor + 20.5937; // Use map center as reference

                // Validate and constrain to reasonable bounds
                const constrainedLat = Math.max(-85, Math.min(85, approximateLat));
                const constrainedLon = Math.max(-180, Math.min(180, approximateLon));

                return [constrainedLat, constrainedLon];
            });
        }).filter(ring => ring.length > 0);
    } catch (error) {
        console.error('Error parsing projected polygon rings:', error);
        return null;
    }
}

function parseProjectedPoint(wkt) {
    try {
        const coordString = wkt.replace(/^POINT\s*\(/i, '').replace(/\)$/, '');
        const parts = coordString.trim().split(/\s+/);

        if (parts.length >= 2) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);

            const transformed = transformProjectedCoordinates(x, y);
            return { lat: transformed[0], lng: transformed[1] };
        }

        return null;
    } catch (error) {
        console.error('Error parsing projected POINT:', error);
        return null;
    }
}

function parseProjectedLineString(wkt) {
    try {
        const coordString = wkt.replace(/^LINESTRING\s*\(/i, '').replace(/\)$/, '');
        const coords = coordString.split(',');

        return coords.map(coord => {
            const parts = coord.trim().split(/\s+/);
            if (parts.length >= 2) {
                const x = parseFloat(parts[0]);
                const y = parseFloat(parts[1]);

                if (!isNaN(x) && !isNaN(y)) {
                    return transformProjectedCoordinates(x, y);
                }
            }
            return null;
        }).filter(coord => coord !== null);
    } catch (error) {
        console.error('Error parsing projected LINESTRING:', error);
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

    // Enhanced zoom with adaptive padding and zoom levels
    if (layer.bounds) {
        const bounds = layer.bounds;

        // Calculate adaptive padding based on bounds size
        const latSpan = bounds.getNorth() - bounds.getSouth();
        const lngSpan = bounds.getEast() - bounds.getWest();
        const maxSpan = Math.max(latSpan, lngSpan);

        // Adaptive padding: smaller for large areas, larger for small areas
        let padding = 0.1;
        if (maxSpan < 0.001) {
            // Very small features (like points) - use larger padding
            padding = 0.5;
        } else if (maxSpan < 0.01) {
            // Small features - moderate padding
            padding = 0.3;
        } else if (maxSpan < 0.1) {
            // Medium features - normal padding
            padding = 0.2;
        } else {
            // Large features - minimal padding
            padding = 0.05;
        }

        // Fit bounds with adaptive padding
        map.fitBounds(bounds.pad(padding));

        // For very small features, set a minimum zoom level
        setTimeout(() => {
            if (maxSpan < 0.001 && map.getZoom() > 18) {
                map.setZoom(18);
            } else if (maxSpan < 0.01 && map.getZoom() > 16) {
                map.setZoom(16);
            } else if (maxSpan > 10 && map.getZoom() < 6) {
                map.setZoom(6);
            }
        }, 100);

    } else if (layer.features && layer.features.length > 0) {
        // Fallback: calculate bounds from individual features
        const validFeatures = layer.features.filter(feature => {
            if (feature.getLatLng) {
                // Point feature
                const latlng = feature.getLatLng();
                return latlng && !isNaN(latlng.lat) && !isNaN(latlng.lng);
            } else if (feature.getLatLngs) {
                // Polygon/line feature
                const latlngs = feature.getLatLngs();
                return latlngs && latlngs.length > 0;
            }
            return false;
        });

        if (validFeatures.length > 0) {
            const group = new L.featureGroup(validFeatures);
            const bounds = group.getBounds();

            // Apply same adaptive logic
            const latSpan = bounds.getNorth() - bounds.getSouth();
            const lngSpan = bounds.getEast() - bounds.getWest();
            const maxSpan = Math.max(latSpan, lngSpan);

            let padding = maxSpan < 0.001 ? 0.5 : maxSpan < 0.01 ? 0.3 : maxSpan < 0.1 ? 0.2 : 0.1;

            map.fitBounds(bounds.pad(padding));

            // Set appropriate zoom level
            setTimeout(() => {
                if (maxSpan < 0.001 && map.getZoom() > 18) {
                    map.setZoom(18);
                } else if (maxSpan < 0.01 && map.getZoom() > 16) {
                    map.setZoom(16);
                }
            }, 100);
        }
    }

    showSuccess(`Zoomed to layer: ${layer.name}`);
}

function showAttributeTable(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) return;

    // Create attribute table in bottom 1/3 of the page
    createAttributeTable(layer);
}

function createAttributeTable(layer) {
    // Remove existing attribute table if any
    const existingTable = document.getElementById('attributeTableContainer');
    if (existingTable) {
        existingTable.remove();
    }

    // Create container for attribute table
    const container = document.createElement('div');
    container.id = 'attributeTableContainer';
    container.style.cssText = `
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 33vh;
        background: white;
        border-top: 2px solid #e9ecef;
        z-index: 1000;
        overflow: hidden;
        box-shadow: 0 -4px 20px rgba(0,0,0,0.1);
    `;

    // Create header
    const header = document.createElement('div');
    header.style.cssText = `
        background: #f8f9fa;
        padding: 10px 15px;
        border-bottom: 1px solid #e9ecef;
        display: flex;
        justify-content: between;
        align-items: center;
    `;
    header.innerHTML = `
        <div>
            <h6 class="mb-0">
                <i class="fas fa-table me-2"></i>
                Attribute Table: ${layer.name}
                <span class="badge bg-primary ms-2">${layer.records.length} records</span>
            </h6>
        </div>
        <div>
            <button class="btn btn-sm btn-outline-primary me-2" onclick="zoomToSelection()">
                <i class="fas fa-search-plus me-1"></i>Zoom to Selection
            </button>
            <button class="btn btn-sm btn-outline-secondary" onclick="closeAttributeTable()">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;

    // Create table content with enhanced styling for frozen headers
    const tableContent = document.createElement('div');
    tableContent.style.cssText = `
        height: calc(100% - 60px);
        overflow: auto;
        padding: 0;
        position: relative;
        border: 1px solid #dee2e6;
    `;

    // Build table with permanently frozen headers
    if (layer.records.length > 0) {
        const fields = Object.keys(layer.records[0].fields || {});

        let tableHTML = `
            <table class="table table-sm table-hover mb-0" style="border-collapse: separate; border-spacing: 0;">
                <thead class="table-light" style="position: sticky; top: 0; z-index: 100; background: #f8f9fa; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <tr style="background: #f8f9fa;">
                        <th style="
                            width: 40px; 
                            position: sticky; 
                            top: 0; 
                            background: #f8f9fa; 
                            z-index: 101;
                            border-bottom: 2px solid #dee2e6;
                            border-right: 1px solid #dee2e6;
                            padding: 8px;
                            font-weight: 600;
                            text-align: center;
                        ">
                            <input type="checkbox" onchange="selectAllRows(this.checked, '${layer.id}')">
                        </th>
                        <th style="
                            width: 60px; 
                            position: sticky; 
                            top: 0; 
                            background: #f8f9fa; 
                            z-index: 101;
                            border-bottom: 2px solid #dee2e6;
                            border-right: 1px solid #dee2e6;
                            padding: 8px;
                            font-weight: 600;
                            text-align: center;
                        ">#</th>
        `;

        fields.forEach(field => {
            if (field !== layer.geometryField) {
                tableHTML += `
                    <th style="
                        position: sticky; 
                        top: 0; 
                        background: #f8f9fa; 
                        z-index: 101;
                        border-bottom: 2px solid #dee2e6;
                        border-right: 1px solid #dee2e6;
                        padding: 8px;
                        font-weight: 600;
                        min-width: 120px;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    " title="${field}">${field}</th>
                `;
            }
        });

        tableHTML += `</tr></thead><tbody style="background: white;">`;

        layer.records.forEach((record, index) => {
            tableHTML += `
                <tr data-record-id="${record.id}" 
                    onclick="selectTableRow(this, '${layer.id}', '${record.id}')"
                    style="border-bottom: 1px solid #dee2e6;">
                    <td style="
                        padding: 8px;
                        border-right: 1px solid #dee2e6;
                        text-align: center;
                        background: white;
                    ">
                        <input type="checkbox" onclick="event.stopPropagation();" onchange="toggleRowSelection('${layer.id}', '${record.id}', this.checked)">
                    </td>
                    <td style="
                        padding: 8px;
                        border-right: 1px solid #dee2e6;
                        text-align: center;
                        background: white;
                        font-weight: 500;
                    ">${index + 1}</td>
            `;

            fields.forEach(field => {
                if (field !== layer.geometryField) {
                    let value = record.fields[field];
                    if (value === null || value === undefined) value = '';
                    if (typeof value === 'string' && value.length > 50) {
                        value = value.substring(0, 50) + '...';
                    }
                    tableHTML += `
                        <td style="
                            padding: 8px;
                            border-right: 1px solid #dee2e6;
                            background: white;
                            min-width: 120px;
                            max-width: 200px;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                        " title="${value}">${value}</td>
                    `;
                }
            });

            tableHTML += '</tr>';
        });

        tableHTML += '</tbody></table>';

        // Add custom CSS for the table
        const style = document.createElement('style');
        style.textContent = `
            #attributeTableContainer .table-active {
                background-color: #e3f2fd !important;
            }
            #attributeTableContainer .table-active td {
                background-color: #e3f2fd !important;
            }
            #attributeTableContainer tr:hover td {
                background-color: #f5f5f5 !important;
            }
            #attributeTableContainer thead th {
                user-select: none;
                cursor: default;
            }
            #attributeTableContainer tbody tr {
                cursor: pointer;
            }
            #attributeTableContainer table {
                table-layout: auto;
                width: 100%;
            }
        `;
        document.head.appendChild(style);

        tableContent.innerHTML = tableHTML;
    } else {
        tableContent.innerHTML = '<div class="text-center text-muted py-4">No records found</div>';
    }

    container.appendChild(header);
    container.appendChild(tableContent);
    document.body.appendChild(container);

    // Store current layer for selection operations
    window.currentAttributeLayer = layer;
    window.selectedTableRows = new Set();
}

function selectTableRow(row, layerId, recordId) {
    // Toggle row selection
    const isSelected = row.classList.contains('table-active');

    if (isSelected) {
        row.classList.remove('table-active');
        row.querySelector('input[type="checkbox"]').checked = false;
        window.selectedTableRows.delete(recordId);
    } else {
        row.classList.add('table-active');
        row.querySelector('input[type="checkbox"]').checked = true;
        window.selectedTableRows.add(recordId);
    }

    // Highlight corresponding feature on map
    highlightFeatureOnMap(layerId, recordId, !isSelected);
}

function toggleRowSelection(layerId, recordId, isSelected) {
    const row = document.querySelector(`tr[data-record-id="${recordId}"]`);
    if (!row) return;

    if (isSelected) {
        row.classList.add('table-active');
        window.selectedTableRows.add(recordId);
    } else {
        row.classList.remove('table-active');
        window.selectedTableRows.delete(recordId);
    }

    highlightFeatureOnMap(layerId, recordId, isSelected);
}

function selectAllRows(selectAll, layerId) {
    const checkboxes = document.querySelectorAll('#attributeTableContainer input[type="checkbox"]:not(:first-child)');
    const rows = document.querySelectorAll('#attributeTableContainer tbody tr');

    checkboxes.forEach((checkbox, index) => {
        checkbox.checked = selectAll;
        const row = rows[index];
        const recordId = row.getAttribute('data-record-id');

        if (selectAll) {
            row.classList.add('table-active');
            window.selectedTableRows.add(recordId);
        } else {
            row.classList.remove('table-active');
            window.selectedTableRows.delete(recordId);
        }

        highlightFeatureOnMap(layerId, recordId, selectAll);
    });
}

function highlightFeatureOnMap(layerId, recordId, highlight) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) return;

    const feature = layer.features.find(f => f.recordId === recordId);
    if (!feature) return;

    if (highlight) {
        feature.setStyle({
            fillColor: '#ff0000',
            color: '#ff0000',
            weight: 3,
            fillOpacity: 0.8
        });
    } else {
        // Reset to original style
        const props = layer.properties.symbology;
        feature.setStyle({
            fillColor: props.fillColor,
            color: props.borderColor,
            weight: props.borderWidth,
            fillOpacity: props.fillOpacity
        });
    }
}

function zoomToSelection() {
    if (!window.currentAttributeLayer || window.selectedTableRows.size === 0) {
        showWarning('No features selected');
        return;
    }

    const selectedFeatures = window.currentAttributeLayer.features.filter(f => 
        window.selectedTableRows.has(f.recordId)
    );

    if (selectedFeatures.length === 0) {
        showWarning('No valid features found for selection');
        return;
    }

    // Enhanced zoom for selected features
    if (selectedFeatures.length === 1) {
        // Single feature - use smart zoom
        const feature = selectedFeatures[0];

        if (feature.getLatLng) {
            // Point feature - zoom to point with appropriate level
            const latlng = feature.getLatLng();
            map.setView(latlng, Math.max(map.getZoom(), 16));
        } else if (feature.getBounds) {
            // Polygon feature - fit to bounds with adaptive padding
            const bounds = feature.getBounds();
            const latSpan = bounds.getNorth() - bounds.getSouth();
            const lngSpan = bounds.getEast() - bounds.getWest();
            const maxSpan = Math.max(latSpan, lngSpan);

            let padding = maxSpan < 0.001 ? 0.5 : maxSpan < 0.01 ? 0.3 : 0.2;
            map.fitBounds(bounds.pad(padding));

            // Set minimum zoom for very small features
            setTimeout(() => {
                if (maxSpan < 0.001 && map.getZoom() > 18) {
                    map.setZoom(18);
                } else if (maxSpan < 0.01 && map.getZoom() > 16) {
                    map.setZoom(16);
                }
            }, 100);
        }
    } else {
        // Multiple features - create group and fit bounds
        const group = new L.featureGroup(selectedFeatures);
        const bounds = group.getBounds();

        // Calculate adaptive padding for multiple features
        const latSpan = bounds.getNorth() - bounds.getSouth();
        const lngSpan = bounds.getEast() - bounds.getWest();
        const maxSpan = Math.max(latSpan, lngSpan);

        let padding = maxSpan < 0.01 ? 0.3 : maxSpan < 0.1 ? 0.2 : 0.1;
        map.fitBounds(bounds.pad(padding));

        // Ensure reasonable zoom level
        setTimeout(() => {
            if (map.getZoom() > 18) {
                map.setZoom(18);
            } else if (map.getZoom() < 8 && maxSpan < 1) {
                map.setZoom(Math.min(14, map.getZoom() + 2));
            }
        }, 100);
    }

    showSuccess(`Zoomed to ${selectedFeatures.length} selected feature(s)`);
}

function closeAttributeTable() {
    const container = document.getElementById('attributeTableContainer');
    if (container) {
        container.remove();
    }

    // Clear selections and reset feature styles
    if (window.currentAttributeLayer) {
        window.currentAttributeLayer.features.forEach(feature => {
            const props = window.currentAttributeLayer.properties.symbology;
            feature.setStyle({
                fillColor: props.fillColor,
                color: props.borderColor,
                weight: props.borderWidth,
                fillOpacity: props.fillOpacity
            });
        });
    }

    window.currentAttributeLayer = null;
    window.selectedTableRows = new Set();
}

function showLayerProperties(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) return;

    // Store current layer for properties dialog
    window.currentPropertiesLayer = layer;

    // Populate properties modal
    populatePropertiesModal(layer);

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('layerPropertiesModal'));
    modal.show();
}

function populatePropertiesModal(layer) {
    // Information tab
    const propLayerName = document.getElementById('propLayerName');
    const propDataSource = document.getElementById('propDataSource');
    const propGeometryType = document.getElementById('propGeometryType');
    const propFeatureCount = document.getElementById('propFeatureCount');

    if (propLayerName) propLayerName.value = layer.name;
    if (propDataSource) propDataSource.value = layer.tableId || 'Unknown';
    if (propGeometryType) propGeometryType.value = layer.type || 'Unknown';
    if (propFeatureCount) propFeatureCount.value = layer.featureCount;

    // Populate field dropdowns
    populateSymbologyFields(layer);
    populateLabelFields(layer);
    populatePopupFields(layer);

    // Load current properties
    loadCurrentProperties(layer);
}

function populateSymbologyFields(layer) {
    if (!layer.records || layer.records.length === 0) return;

    const fields = Object.keys(layer.records[0].fields || {});
    const numericFields = fields.filter(field => {
        const sampleValue = layer.records[0].fields[field];
        return typeof sampleValue === 'number' || !isNaN(parseFloat(sampleValue));
    });

    // Populate graduated field dropdown
    const graduatedField = document.getElementById('propGraduatedField');
    if (graduatedField) {
        graduatedField.innerHTML = '<option value="">Select numeric field...</option>';
        numericFields.forEach(field => {
            const option = document.createElement('option');
            option.value = field;
            option.textContent = field;
            graduatedField.appendChild(option);
        });
    }

    // Populate categorized field dropdown
    const categorizedField = document.getElementById('propCategorizedField');
    if (categorizedField) {
        categorizedField.innerHTML = '<option value="">Select field...</option>';
        fields.forEach(field => {
            if (field !== layer.geometryField) {
                const option = document.createElement('option');
                option.value = field;
                option.textContent = field;
                categorizedField.appendChild(option);
            }
        });
    }
}

function populateLabelFields(layer) {
    if (!layer.records || layer.records.length === 0) return;

    const fields = Object.keys(layer.records[0].fields || {});
    const labelField = document.getElementById('propLabelField');

    if (labelField) {
        labelField.innerHTML = '<option value="">Select field...</option>';
        fields.forEach(field => {
            if (field !== layer.geometryField) {
                const option = document.createElement('option');
                option.value = field;
                option.textContent = field;
                labelField.appendChild(option);
            }
        });

        // Restore current selection
        if (layer.properties.labels.field) {
            labelField.value = layer.properties.labels.field;
        }
    }
}

function populatePopupFields(layer) {
    if (!layer.records || layer.records.length === 0) return;

    const fields = Object.keys(layer.records[0].fields || {});
    const container = document.getElementById('propPopupFields');

    if (container) {
        let html = '';
        fields.forEach(field => {
            if (field !== layer.geometryField) {
                // Check if field is selected in popup configuration
                const isChecked = layer.properties && layer.properties.popup && layer.properties.popup.fields
                    ? layer.properties.popup.fields.includes(field)
                    : true; // Default to true if no configuration exists

                html += `
                    <div class="field-checkbox">
                        <input type="checkbox" id="popup_${field}" ${isChecked ? 'checked' : ''} value="${field}">
                        <label for="popup_${field}">${field}</label>
                    </div>
                `;
            }
        });

        container.innerHTML = html;
    }
}

function loadCurrentProperties(layer) {
    const props = layer.properties;

    // Symbology
    const propSymbologyType = document.getElementById('propSymbologyType');
    const propFillColor = document.getElementById('propFillColor');
    const propBorderColor = document.getElementById('propBorderColor');
    const propFillOpacity = document.getElementById('propFillOpacity');
    const propBorderWidth = document.getElementById('propBorderWidth');

    if (propSymbologyType) propSymbologyType.value = props.symbology.type;
    if (propFillColor) propFillColor.value = props.symbology.fillColor;
    if (propBorderColor) propBorderColor.value = props.symbology.borderColor;
    if (propFillOpacity) propFillOpacity.value = props.symbology.fillOpacity;
    if (propBorderWidth) propBorderWidth.value = props.symbology.borderWidth;

    // Update displays
    const fillOpacityValue = document.getElementById('fillOpacityValue');
    const borderWidthValue = document.getElementById('borderWidthValue');
    if (fillOpacityValue) fillOpacityValue.textContent = Math.round(props.symbology.fillOpacity * 100) + '%';
    if (borderWidthValue) borderWidthValue.textContent = props.symbology.borderWidth + 'px';

    // Labels
    const propEnableLabels = document.getElementById('propEnableLabels');
    const propLabelField = document.getElementById('propLabelField');
    const propLabelSize = document.getElementById('propLabelSize');
    const propLabelColor = document.getElementById('propLabelColor');
    const propLabelBackground = document.getElementById('propLabelBackground');
    const propLabelPosition = document.getElementById('propLabelPosition');

    if (propEnableLabels) propEnableLabels.checked = props.labels.enabled;
    if (propLabelField) propLabelField.value = props.labels.field;
    if (propLabelSize) propLabelSize.value = props.labels.fontSize;
    if (propLabelColor) propLabelColor.value = props.labels.color;
    if (propLabelBackground) propLabelBackground.checked = props.labels.background;
    if (propLabelPosition) propLabelPosition.value = props.labels.position || 'center';

    // Show/hide label controls
    const propLabelControls = document.getElementById('propLabelControls');
    if (propLabelControls) {
        propLabelControls.style.display = props.labels.enabled ? 'block' : 'none';
    }

    // Update symbology type display
    updateSymbologyType();
}

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
    const targetTab = document.getElementById(tabName + '-tab');
    if (targetTab) {
        targetTab.style.display = 'block';
    }
}

function updateSymbologyType() {
    const propSymbologyType = document.getElementById('propSymbologyType');
    if (!propSymbologyType) return;

    const type = propSymbologyType.value;

    const propSingleSymbol = document.getElementById('propSingleSymbol');
    const propGraduated = document.getElementById('propGraduated');
    const propCategorized = document.getElementById('propCategorized');

    if (propSingleSymbol) propSingleSymbol.style.display = type === 'single' ? 'block' : 'none';
    if (propGraduated) propGraduated.style.display = type === 'graduated' ? 'block' : 'none';
    if (propCategorized) propCategorized.style.display = type === 'categorized' ? 'block' : 'none';
}

function generateGraduatedSymbology() {
    if (!window.currentPropertiesLayer) return;

    const layer = window.currentPropertiesLayer;
    const fieldSelect = document.getElementById('propGraduatedField');
    const classesSelect = document.getElementById('propGraduatedClasses');
    const methodSelect = document.getElementById('propClassificationMethod');
    const colorRampSelect = document.getElementById('propColorRamp');

    if (!fieldSelect || !classesSelect || !methodSelect || !colorRampSelect) return;

    const field = fieldSelect.value;
    const classes = parseInt(classesSelect.value);
    const method = methodSelect.value;
    const colorRamp = colorRampSelect.value;

    if (!field) {
        showWarning('Please select a field for graduated symbology');
        return;
    }

    // Get field values
    const values = layer.records.map(record => parseFloat(record.fields[field])).filter(v => !isNaN(v));

    if (values.length === 0) {
        showWarning('No numeric values found in the selected field');
        return;
    }

    // Calculate breaks based on method
    let breaks = [];
    values.sort((a, b) => a - b);

    switch (method) {
        case 'equal':
            const min = Math.min(...values);
            const max = Math.max(...values);
            const interval = (max - min) / classes;
            for (let i = 0; i <= classes; i++) {
                breaks.push(min + (interval * i));
            }
            break;
        case 'quantile':
            for (let i = 0; i <= classes; i++) {
                const index = Math.floor((values.length - 1) * i / classes);
                breaks.push(values[index]);
            }
            break;
        case 'natural':
            // Simplified natural breaks (Jenks)
            breaks = calculateJenksBreaks(values, classes);
            break;
    }

    // Generate colors
    const colors = generateColorRamp(colorRamp, classes);

    // Update legend
    const legendContainer = document.getElementById('propGraduatedLegend');
    if (legendContainer) {
        let legendHTML = '<div class="legend-title">Legend</div>';
        for (let i = 0; i < classes; i++) {
            const min = breaks[i].toFixed(2);
            const max = breaks[i + 1].toFixed(2);
            legendHTML += `
                <div class="legend-item">
                    <div class="legend-color" style="background-color: ${colors[i]}"></div>
                    <span>${min} - ${max}</span>
                </div>
            `;
        }
        legendContainer.innerHTML = legendHTML;
    }

    showSuccess('Graduated symbology generated successfully');
}

function generateCategorizedSymbology() {
    if (!window.currentPropertiesLayer) return;

    const layer = window.currentPropertiesLayer;
    const fieldSelect = document.getElementById('propCategorizedField');

    if (!fieldSelect) return;

    const field = fieldSelect.value;

    if (!field) {
        showWarning('Please select a field for categorized symbology');
        return;
    }

    // Get unique values
    const uniqueValues = [...new Set(layer.records.map(record => record.fields[field]))];
    uniqueValues.sort();

    if (uniqueValues.length === 0) {
        showWarning('No values found in the selected field');
        return;
    }

    if (uniqueValues.length > 20) {
        showWarning('Too many unique values (>20). Consider using a different field or graduated symbology.');
        return;
    }

    // Generate colors
    const colors = generateDistinctColors(uniqueValues.length);

    // Update legend
    const legendContainer = document.getElementById('propCategorizedLegend');
    if (legendContainer) {
        let legendHTML = '<div class="legend-title">Legend</div>';
        uniqueValues.forEach((value, index) => {
            legendHTML += `
                <div class="legend-item">
                    <div class="legend-color" style="background-color: ${colors[index]}"></div>
                    <span>${value}</span>
                </div>
            `;
        });
        legendContainer.innerHTML = legendHTML;
    }

    showSuccess('Categorized symbology generated successfully');
}

function calculateJenksBreaks(values, classes) {
    // Simplified Jenks natural breaks algorithm
    const n = values.length;
    const breaks = [];

    // For simplicity, use equal intervals as fallback
    const min = Math.min(...values);
    const max = Math.max(...values);
    const interval = (max - min) / classes;

    for (let i = 0; i <= classes; i++) {
        breaks.push(min + (interval * i));
    }

    return breaks;
}

function generateColorRamp(rampName, classes) {
    const ramps = {
        blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
        greens: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
        reds: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'],
        oranges: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704'],
        purples: ['#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d']
    };

    const ramp = ramps[rampName] || ramps.blues;
    const colors = [];

    for (let i = 0; i < classes; i++) {
        const index = Math.floor((ramp.length - 1) * i / (classes - 1));
        colors.push(ramp[index]);
    }

    return colors;
}

function generateDistinctColors(count) {
    const colors = [
        '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00',
        '#ffff33', '#a65628', '#f781bf', '#999999', '#66c2a5',
        '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f',
        '#e5c494', '#b3b3b3', '#8dd3c7', '#ffffb3', '#bebada'
    ];

    const result = [];
    for (let i = 0; i < count; i++) {
        result.push(colors[i % colors.length]);
    }

    return result;
}

function selectAllPopupFields() {
    const checkboxes = document.querySelectorAll('#propPopupFields input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
    });
}

function deselectAllPopupFields() {
    const checkboxes = document.querySelectorAll('#propPopupFields input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
}

function applyProperties() {
    if (!window.currentPropertiesLayer) return;

    const layer = window.currentPropertiesLayer;

    // Update layer properties
    const propSymbologyType = document.getElementById('propSymbologyType');
    const propFillColor = document.getElementById('propFillColor');
    const propBorderColor = document.getElementById('propBorderColor');
    const propFillOpacity = document.getElementById('propFillOpacity');
    const propBorderWidth = document.getElementById('propBorderWidth');

    if (propSymbologyType && propFillColor && propBorderColor && propFillOpacity && propBorderWidth) {
        layer.properties.symbology = {
            type: propSymbologyType.value,
            fillColor: propFillColor.value,
            borderColor: propBorderColor.value,
            fillOpacity: parseFloat(propFillOpacity.value),
            borderWidth: parseInt(propBorderWidth.value)
        };
    }

    const propEnableLabels = document.getElementById('propEnableLabels');
    const propLabelField = document.getElementById('propLabelField');
    const propLabelSize = document.getElementById('propLabelSize');
    const propLabelColor = document.getElementById('propLabelColor');
    const propLabelBackground = document.getElementById('propLabelBackground');
    const propLabelPosition = document.getElementById('propLabelPosition');

    if (propEnableLabels && propLabelField && propLabelSize && propLabelColor && propLabelBackground) {
        layer.properties.labels = {
            enabled: propEnableLabels.checked,
            field: propLabelField.value,
            fontSize: parseInt(propLabelSize.value),
            color: propLabelColor.value,
            background: propLabelBackground.checked,
            position: propLabelPosition.value
        };
    }

    // Update popup fields
    const popupFields = [];
    document.querySelectorAll('#propPopupFields input[type="checkbox"]:checked').forEach(checkbox => {
        popupFields.push(checkbox.value);
    });
    if (layer.properties && layer.properties.popup) {
        layer.properties.popup.fields = popupFields;
    }

    // Update all feature popups with new field selection
    layer.features.forEach(feature => {
        if (feature.getPopup) {
            const newPopupContent = createFeaturePopup(feature.recordData, layer);
            feature.bindPopup(newPopupContent, {
                maxWidth: layer.properties.popup.maxWidth || 300
            });
        }
    });

    // Apply visual changes
    applyLayerStyling(layer);
    applyLayerLabels(layer);

    showSuccess('Layer properties applied successfully!');
}

function applyLayerStyling(layer) {
    const props = layer.properties.symbology;

    layer.features.forEach(feature => {
        if (feature.setStyle) {
            feature.setStyle({
                fillColor: props.fillColor,
                color: props.borderColor,
                weight: props.borderWidth,
                fillOpacity: props.fillOpacity
            });
        }
    });
}

function applyLayerLabels(layer) {
    const props = layer.properties.labels;

    layer.features.forEach(feature => {
        // Remove existing tooltip
        if (feature.getTooltip()) {
            feature.unbindTooltip();
        }

        // Add new tooltip if enabled
        if (props.enabled && props.field && feature.recordData[props.field]) {
            let direction = 'center';
            let offset = [0, 0];

            // Adjust label position based on properties
            switch (props.position) {
                case 'top':
                    direction = 'top';
                    offset = [0, -10];
                    break;
                case 'bottom':
                    direction = 'bottom';
                    offset = [0, 10];
                    break;
                case 'left':
                    direction = 'left';
                    offset = [-10, 0];
                    break;
                case 'right':
                    direction = 'right';
                    offset = [10, 0];
                    break;
                case 'auto':
                    // Implement smart label positioning here
                    break;
                default:
                    direction = 'center';
            }

            feature.bindTooltip(String(feature.recordData[props.field]), {
                permanent: true,
                direction: direction,
                className: 'feature-label',
                offset: offset,
                style: {
                    fontSize: props.fontSize + 'px',
                    color: props.color,
                    backgroundColor: props.background ? 'rgba(255,255,255,0.8)' : 'transparent'
                }
            });
        }
    });
}

function applyAndCloseProperties() {
    applyProperties();

    const modal = bootstrap.Modal.getInstance(document.getElementById('layerPropertiesModal'));
    modal.hide();
}

function cancelProperties() {
    const modal = bootstrap.Modal.getInstance(document.getElementById('layerPropertiesModal'));
    modal.hide();
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
        updateMapStatistics();
        showSuccess(`Layer "${layer.name}" removed successfully`);
    }
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
                    case 'greater_than':
                        if (parseFloat(fieldValue) <= parseFloat(filter.value)) showFeature = false;
                        break;
                    case 'less_than':
                        if (parseFloat(fieldValue) >= parseFloat(filter.value)) showFeature = false;
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
    updateMapStatistics();
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

// GeoJSON upload functionality
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

        } catch (error```python
) {
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
    // This would implement drag-and-drop sorting of layers
    // For now, we'll skip this implementation
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

// Export functionality
function exportMap() {
    showInfo('Map export functionality would be implemented here');
}

function fullscreenMap() {
    const mapContainer = document.querySelector('.map-container');

    if (mapContainer.requestFullscreen) {
        mapContainer.requestFullscreen();
    } else if (mapContainer.webkitRequestFullscreen) {
        mapContainer.webkitRequestFullscreen();
    } else if (mapContainer.msRequestFullscreen) {
        mapContainer.msRequestFullscreen();
    }

    // Invalidate map size after fullscreen
    setTimeout(() => {
        map.invalidateSize();
    }, 100);
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

// Enhanced zoom function for individual features
function zoomToFeature(feature, options = {}) {
    if (!feature) return;

    const {
        padding = 'auto',
        maxZoom = 18,
        minZoom = 8,
        animationDuration = 500
    } = options;

    if (feature.getLatLng) {
        // Point feature
        const latlng = feature.getLatLng();
        const targetZoom = Math.max(Math.min(maxZoom, 16), map.getZoom());

        map.setView(latlng, targetZoom, {
            animate: true,
            duration: animationDuration / 1000
        });
    } else if (feature.getBounds) {
        // Polygon/line feature
        const bounds = feature.getBounds();
        const latSpan = bounds.getNorth() - bounds.getSouth();
        const lngSpan = bounds.getEast() - bounds.getWest();
        const maxSpan = Math.max(latSpan, lngSpan);

        // Auto-calculate padding if not specified
        let finalPadding = padding;
        if (padding === 'auto') {
            if (maxSpan < 0.0001) {
                finalPadding = 1.0;  // Very small features
            } else if (maxSpan < 0.001) {
                finalPadding = 0.7;  // Small features
            } else if (maxSpan < 0.01) {
                finalPadding = 0.4;  // Medium-small features
            } else if (maxSpan < 0.1) {
                finalPadding = 0.2;  // Medium features
            } else {
                finalPadding = 0.1;  // Large features
            }
        }

        // Fit bounds with animation
        map.fitBounds(bounds.pad(finalPadding), {
            animate: true,
            duration: animationDuration / 1000
        });

        // Apply zoom constraints after animation
        setTimeout(() => {
            const currentZoom = map.getZoom();
            if (currentZoom > maxZoom) {
                map.setZoom(maxZoom);
            } else if (currentZoom < minZoom) {
                map.setZoom(minZoom);
            }
        }, animationDuration);
    }
}

// Add zoom controls to feature popups
function enhanceFeaturePopup(feature, popupContent, layerConfig) {
    const enhancedContent = `
        ${popupContent}
        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee;">
            <button onclick="zoomToFeature(window.currentPopupFeature, {maxZoom: 20, padding: 0.5})" 
                    class="btn btn-sm btn-primary me-2" style="font-size: 11px; padding: 4px 8px;">
                <i class="fas fa-search-plus"></i> Zoom In
            </button>
            <button onclick="zoomToFeature(window.currentPopupFeature, {maxZoom: 14, padding: 0.3})" 
                    class="btn btn-sm btn-secondary me-2" style="font-size: 11px; padding: 4px 8px;">
                <i class="fas fa-search-minus"></i> Zoom Out
            </button>
            <button onclick="map.setView(window.currentPopupFeature.getLatLng ? window.currentPopupFeature.getLatLng() : window.currentPopupFeature.getBounds().getCenter(), 12)" 
                    class="btn btn-sm btn-info" style="font-size: 11px; padding: 4px 8px;">
                <i class="fas fa-crosshairs"></i> Center
            </button>
        </div>
    `;

    // Store reference to current feature for popup buttons
    feature.on('popupopen', function() {
        window.currentPopupFeature = feature;
    });

    return enhancedContent;
}

// Make functions globally available
window.toggleSection = toggleSection;
window.showAddLayerModal = showAddLayerModal;
window.addNewLayer = addNewLayer;
window.loadTableFields = loadTableFields;
window.handleGeoJSONFile = handleGeoJSONFile;
window.uploadGeoJSON = uploadGeoJSON;
window.toggleLayerVisibility = toggleLayerVisibility;
window.zoomToLayer = zoomToLayer;
window.showAttributeTable = showAttributeTable;
window.showLayerProperties = showLayerProperties;
window.removeLayer = removeLayer;
window.changeBasemap = changeBasemap;
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
window.selectTableRow = selectTableRow;
window.toggleRowSelection = toggleRowSelection;
window.zoomToSelection = zoomToSelection;
window.closeAttributeTable = closeAttributeTable;
window.generateGraduatedSymbology = generateGraduatedSymbology;
window.generateCategorizedSymbology = generateCategorizedSymbology;
window.selectAllPopupFields = selectAllPopupFields;
window.deselectAllPopupFields = deselectAllPopupFields;
window.zoomToFeature = zoomToFeature;

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