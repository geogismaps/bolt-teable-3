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
        const fieldType = getFieldType(layer.records[0].fields[field]);
        const fieldIcon = getFieldIcon(fieldType);

        html += `
            <div class="field-checkbox d-flex align-items-center mb-2">
                <input class="form-check-input me-2" type="checkbox" id="popup_field_${field}" 
                       ${isSelected ? 'checked' : ''} onchange="updatePopupFieldSelection('${field}', this.checked)">
                <i class="${fieldIcon} me-2 text-muted" title="${fieldType}"></i>
                <label class="form-check-label flex-grow-1" for="popup_field_${field}">
                    ${field}
                </label>
                <small class="text-muted">(${fieldType})</small>
            </div>
        `;
    });

    container.innerHTML = html;

    // Update available fields for custom template
    updateAvailableFieldsHelp(fields);
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

    // Update popup properties with all iTool settings
    if (!layer.properties.popup) layer.properties.popup = {};

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

                    // Apply updated styling if feature supports it
                    if (feature.setStyle) {
                        const symbology = mapLayers[layerIndex].properties.symbology;
                        feature.setStyle({
                            fillColor: symbology.fillColor,
                            color: symbology.borderColor,
                            weight: symbology.borderWidth,
                            fillOpacity: symbology.fillOpacity
                        });
                    }
                }
            });

            console.log(`✅ Updated ${mapLayers[layerIndex].features.length} feature popups with new configuration`);
        }

        // Apply label updates if needed
        applyLabelsToLayer(mapLayers[layerIndex]);

        // Update layer list display
        updateLayersList();

        showSuccess(`Properties applied to layer "${layer.name}" successfully!`);
    }
}

function updateLayerPopupSettings(layer) {
    // Basic settings
    layer.properties.popup.enabled = document.getElementById('propEnablePopups').checked;
    layer.properties.popup.template = document.getElementById('propPopupTemplate').value;
    layer.properties.popup.maxWidth = parseInt(document.getElementById('propMaxPopupWidth').value);
    layer.properties.popup.maxFieldLength = parseInt(document.getElementById('propMaxFieldLength').value);
    layer.properties.popup.position = document.getElementById('propPopupPosition').value;

    // Advanced settings
    layer.properties.popup.showEmptyFields = document.getElementById('propShowEmptyFields').checked;
    layer.properties.popup.showFieldIcons = document.getElementById('propShowFieldIcons').checked;
    layer.properties.popup.highlightLinks = document.getElementById('propHighlightLinks').checked;
    layer.properties.popup.showTooltips = document.getElementById('propShowTooltips').checked;
    layer.properties.popup.enableSearch = document.getElementById('propEnableSearch').checked;
    layer.properties.popup.showCopyButtons = document.getElementById('propShowCopyButtons').checked;
    layer.properties.popup.enableFieldSorting = document.getElementById('propEnableFieldSorting').checked;
    layer.properties.popup.customTemplate = document.getElementById('propCustomTemplate').value;

    // Control settings
    if (!layer.properties.popup.controls) layer.properties.popup.controls = {};
    layer.properties.popup.controls.showZoomControls = document.getElementById('propShowZoomControls').checked;
    layer.properties.popup.controls.showCenterControl = document.getElementById('propShowCenterControl').checked;
    layer.properties.popup.controls.showExportControl = document.getElementById('propShowExportControl').checked;
    layer.properties.popup.controls.showEditControl = document.getElementById('propShowEditControl').checked;
}

function applyLabelsToLayer(layer) {
    // Remove existing labels if any
    if (layer.labelGroup) {
        map.removeLayer(layer.labelGroup);
        layer.labelGroup = null;
    }

    const labels = layer.properties?.labels;
    if (!labels || !labels.enabled || !labels.field) {
        return;
    }

    // Create label group
    const labelFeatures = [];

    layer.features.forEach((feature, index) => {
        const record = layer.records[index];
        if (!record) return;

        const labelText = record.fields[labels.field];
        if (!labelText) return;

        let labelPosition;
        if (feature.getLatLng) {
            // Point feature
            labelPosition = feature.getLatLng();
        } else if (feature.getBounds) {
            // Polygon feature - use center
            labelPosition = feature.getBounds().getCenter();
        } else {
            return;
        }

        // Create label marker
        const labelIcon = L.divIcon({
            className: 'enhanced-feature-label',
            html: String(labelText),
            iconSize: [null, null],
            iconAnchor: [null, null]
        });

        const labelMarker = L.marker(labelPosition, { icon: labelIcon });
        labelFeatures.push(labelMarker);
    });

    if (labelFeatures.length > 0) {
        layer.labelGroup = L.layerGroup(labelFeatures);
        if (layer.visible) {
            layer.labelGroup.addTo(map);
        }
    }
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

function handleTemplateChange() {
    const template = document.getElementById('propPopupTemplate').value;
    const customSection = document.getElementById('customTemplateSection');

    if (customSection) {
        customSection.style.display = template === 'custom' ? 'block' : 'none';
    }
}

function handlePopupToggle() {
    const enabled = document.getElementById('propEnablePopups').checked;
    const configSection = document.getElementById('popupConfigSection');

    if (configSection) {
        configSection.style.display = enabled ? 'block' : 'none';
    }
}

// Event listener for popup enable toggle
document.addEventListener('DOMContentLoaded', function() {
    const propEnablePopups = document.getElementById('propEnablePopups');
    if (propEnablePopups) {
        propEnablePopups.addEventListener('change', handlePopupToggle);
    }

    const propPopupTemplate = document.getElementById('propPopupTemplate');
    if (propPopupTemplate) {
        propPopupTemplate.addEventListener('change', handleTemplateChange);
    }

    const propEnableLabels = document.getElementById('propEnableLabels');
    if (propEnableLabels) {
        propEnableLabels.addEventListener('change', function() {
            const labelControls = document.getElementById('propLabelControls');
            if (labelControls) {
                labelControls.style.display = this.checked ? 'block' : 'none';
            }
        });
    }

    // Add event listeners for opacity and border width sliders
    const propFillOpacity = document.getElementById('propFillOpacity');
    if (propFillOpacity) {
        propFillOpacity.addEventListener('input', function() {
            const fillOpacityValue = document.getElementById('fillOpacityValue');
            if (fillOpacityValue) {
                fillOpacityValue.textContent = Math.round(parseFloat(this.value) * 100) + '%';
            }
        });
    }

    const propBorderWidth = document.getElementById('propBorderWidth');
    if (propBorderWidth) {
        propBorderWidth.addEventListener('input', function() {
            const borderWidthValue = document.getElementById('borderWidthValue');
            if (borderWidthValue) {
                borderWidthValue.textContent = this.value + 'px';
            }
        });
    }
});

// Missing function implementations
function updateMapStatistics() {
    // Implementation for updating map statistics
    console.log('Map statistics updated');
}

function adjustMapForDockedTable() {
    // Adjust map height when docked table is shown
    const mapElement = document.getElementById('map');
    if (mapElement) {
        setTimeout(() => {
            map.invalidateSize();
        }, 300);
    }
}

function toggleDockedTableSize() {
    const dockedTable = document.getElementById('dockedAttributeTable');
    const toggleIcon = document.getElementById('tableToggleIcon');

    if (dockedTable && toggleIcon) {
        dockedTable.classList.toggle('expanded');

        if (dockedTable.classList.contains('expanded')) {
            toggleIcon.classList.remove('fa-expand-alt');
            toggleIcon.classList.add('fa-compress-alt');
        } else {
            toggleIcon.classList.remove('fa-compress-alt');
            toggleIcon.classList.add('fa-expand-alt');
        }

        // Invalidate map size after transition
        setTimeout(() => {
            map.invalidateSize();
        }, 350);
    }
}

function closeDockedTable() {
    const dockedTable = document.getElementById('dockedAttributeTable');
    if (dockedTable) {
        dockedTable.remove();
        // Invalidate map size to reclaim space
        setTimeout(() => {
            map.invalidateSize();
        }, 100);
    }
}

function handleFeatureClick(feature, index, layerConfig) {
    // Implementation for handling feature clicks
    console.log('Feature clicked:', feature, index, layerConfig);
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

    showInfo('Feature editing functionality will be implemented in a future version');
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

function previewPopup() {
    if (!window.currentPropertiesLayer) {
        showError('No layer selected for preview');
        return;
    }

    const layer = window.currentPropertiesLayer;
    if (!layer.records || layer.records.length === 0) {
        showError('No data available for preview');
        return;
    }

    // Use first record for preview
    const sampleRecord = layer.records[0];
    const previewContent = createFeaturePopup(sampleRecord.fields, layer);

    const previewContainer = document.getElementById('popupPreview');
    if (previewContainer) {
        previewContainer.innerHTML = previewContent;
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

// Export/fullscreen functionality
function exportMap() {
    showInfo('Map export functionality will be implemented in a future version');
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

// Additional utility functions that might be missing
function resetMapView() {
    map.setView([20.5937, 78.9629], 5);
    showSuccess('Map view reset to default');
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

// Logout function
function logout() {
    if (window.teableAuth && window.teableAuth.logout) {
        window.teableAuth.logout();
    } else {
        window.location.href = 'login.html';
    }
}