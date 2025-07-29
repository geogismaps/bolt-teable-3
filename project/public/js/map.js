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
        // Calculate appropriate zoom level based on layer size
        const boundsSize = layer.bounds.getNorthEast().distanceTo(layer.bounds.getSouthWest());
        let maxZoom = 20;
        
        if (boundsSize < 100) { // Very small area
            maxZoom = 22;
        } else if (boundsSize < 1000) { // Small area
            maxZoom = 21;
        } else if (boundsSize < 10000) { // Medium area
            maxZoom = 19;
        }
        
        map.fitBounds(layer.bounds.pad(0.05), {
            maxZoom: maxZoom
        });
    }

    showSuccess(`Zoomed to layer: ${layer.name} with enhanced detail`);
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

    // Load field permissions for current user
    const fieldPermissions = await loadFieldPermissionsForTable(layer.tableId);
    
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
                                    <button class="btn btn-sm btn-outline-warning" onclick="addNewRecord('${layer.id}')" title="Add New Record">
                                        <i class="fas fa-plus me-1"></i>Add Record
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
        if (!window.teableAPI.systemTables.permissions) {
            console.log('Permissions system not initialized, using default permissions');
            return {};
        }

        const currentUser = window.teableAuth.getCurrentSession();
        if (!currentUser) {
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

        console.log(`Loaded field permissions for table ${tableId}:`, fieldPermissions);
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

    // Add field columns with permission indicators
    fields.forEach(field => {
        if (field !== layer.geometryField) {
            const permission = getFieldPermission(field, layer);
            
            if (permission !== 'hidden') {
                const permissionClass = permission === 'edit' ? 'field-editable' : 'field-viewonly';
                
                headerHTML += `
                    <th class="${permissionClass}">
                        <span>${field}</span>
                    </th>
                `;
            }
        }
    });

    // Add actions column
    headerHTML += '<th style="width: 120px;">Actions</th>';
    headerHTML += '</tr>';

    return headerHTML;
}

async function createEnhancedTableBody(layer) {
    if (!layer.records || layer.records.length === 0) return '';

    const fields = Object.keys(layer.records[0].fields || {});
    let bodyHTML = '';

    layer.records.forEach((record, index) => {
        bodyHTML += `<tr data-record-id="${record.id}" data-feature-index="${index}" data-table-id="${layer.tableId}">`;

        // Add selection checkbox
        bodyHTML += `<td><input type="checkbox" class="row-selector" onchange="toggleRowSelection('${layer.id}', ${index}, this.checked)"></td>`;

        // Add field data with permission-based editing
        fields.forEach(field => {
            if (field !== layer.geometryField) {
                const permission = getFieldPermission(field, layer);
                
                if (permission !== 'hidden') {
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
                }
            }
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

    // Populate graduated field selector with proper numeric detection
    const graduatedFieldSelect = document.getElementById('propGraduatedField');
    if (graduatedFieldSelect) {
        const currentValue = graduatedFieldSelect.value;
        graduatedFieldSelect.innerHTML = '<option value="">Select numeric field...</option>';
        
        fields.forEach(field => {
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
                const option = document.createElement('option');
                option.value = field;
                option.textContent = `${field} (${numericCount}/${totalCount} numeric)`;
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
            // Count unique values for categorization
            const uniqueValues = new Set();
            layer.records.forEach(record => {
                const value = record.fields[field];
                if (value !== null && value !== undefined && value !== '') {
                    uniqueValues.add(value);
                }
            });
            
            const option = document.createElement('option');
            option.value = field;
            option.textContent = `${field} (${uniqueValues.size} unique values)`;
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
        padding: 0.15,
        maxZoom: 22,
        minZoom: 16
    };

    const zoomOptions = { ...defaultOptions, ...options };

    if (feature.getBounds) {
        // Polygon or complex geometry
        const bounds = feature.getBounds();
        const boundsSize = bounds.getNorthEast().distanceTo(bounds.getSouthWest());
        
        // Adjust zoom based on feature size
        let targetZoom = zoomOptions.maxZoom;
        if (boundsSize > 1000) { // Large features
            targetZoom = Math.min(zoomOptions.maxZoom - 2, 20);
        } else if (boundsSize > 100) { // Medium features
            targetZoom = Math.min(zoomOptions.maxZoom - 1, 21);
        }
        
        map.fitBounds(bounds.pad(zoomOptions.padding), {
            maxZoom: targetZoom
        });
    } else if (feature.getLatLng) {
        // Point geometry - zoom closer for points
        const latlng = feature.getLatLng();
        const targetZoom = Math.max(zoomOptions.minZoom + 2, 18);
        map.setView(latlng, targetZoom);
    }

    // Open popup if feature has one
    if (feature.getPopup && feature.getPopup()) {
        feature.openPopup();
    }

    showSuccess('Zoomed to feature with enhanced detail level');
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
    const symbologyTypeSelect = document.getElementById('propSymbologyType');
    if (!symbologyTypeSelect) {
        console.error('Symbology type selector not found');
        return;
    }
    
    const symbologyType = symbologyTypeSelect.value;
    const singleControls = document.getElementById('propSingleSymbol');
    const graduatedControls = document.getElementById('propGraduated');
    const categorizedControls = document.getElementById('propCategorized');

    // Hide all controls first
    if (singleControls) singleControls.style.display = 'none';
    if (graduatedControls) graduatedControls.style.display = 'none';
    if (categorizedControls) categorizedControls.style.display = 'none';

    // Show relevant controls based on selection
    switch (symbologyType) {
        case 'single':
            if (singleControls) {
                singleControls.style.display = 'block';
                console.log('Showing single symbology controls');
            }
            break;
        case 'graduated':
            if (graduatedControls) {
                graduatedControls.style.display = 'block';
                console.log('Showing graduated symbology controls');
                // Populate field selectors when switching to graduated
                if (window.currentPropertiesLayer) {
                    populateFieldSelectors(window.currentPropertiesLayer);
                }
            }
            break;
        case 'categorized':
            if (categorizedControls) {
                categorizedControls.style.display = 'block';
                console.log('Showing categorized symbology controls');
                // Populate field selectors when switching to categorized
                if (window.currentPropertiesLayer) {
                    populateFieldSelectors(window.currentPropertiesLayer);
                }
            }
            break;
        default:
            console.warn('Unknown symbology type:', symbologyType);
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
    if (!layer.features || !layer.properties || !layer.properties.symbology) return;

    const symbology = layer.properties.symbology;

    layer.features.forEach((feature, index) => {
        if (!feature.setStyle) return;

        let style = {
            weight: symbology.borderWidth || 2,
            fillOpacity: symbology.fillOpacity || 0.7
        };

        // Apply styling based on symbology type
        switch (symbology.type) {
            case 'single':
                style.fillColor = symbology.fillColor || '#3498db';
                style.color = symbology.borderColor || '#2c3e50';
                break;

            case 'graduated':
                const featureValue = parseFloat(feature.recordData[symbology.field]);
                if (!isNaN(featureValue)) {
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
                break;

            case 'categorized':
                const featureCategory = String(feature.recordData[symbology.field]);
                const category = symbology.categories.find(cat => String(cat.value) === featureCategory);
                if (category) {
                    style.fillColor = category.color;
                    style.color = symbology.borderColor || '#2c3e50';
                } else {
                    // Use default color for uncategorized values
                    style.fillColor = '#cccccc';
                    style.color = '#999999';
                }
                break;

            default:
                style.fillColor = symbology.fillColor || '#3498db';
                style.color = symbology.borderColor || '#2c3e50';
        }

        feature.setStyle(style);
    });

    // Apply labels if enabled
    if (layer.properties.labels && layer.properties.labels.enabled) {
        applyLabelsToLayer(layer);
    }

    console.log(`Applied ${symbology.type} symbology to layer "${layer.name}"`);
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
    
    // Collect all settings from the form
    layer.properties.popup.enabled = document.getElementById('propEnablePopups')?.checked !== false;
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
    const enabled = document.getElementById('propEnablePopups')?.checked;
    const configSection = document.getElementById('popupConfigSection');
    
    if (configSection) {
        configSection.style.display = enabled ? 'block' : 'none';
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
        // Get editable fields
        const fields = Object.keys(layer.records[0].fields || {}).filter(field => 
            field !== layer.geometryField && 
            getFieldPermission(field, layer) === 'edit'
        );
        
        if (fields.length === 0) {
            showError('No editable fields available');
            return;
        }
        
        // Show modal for new record
        showNewRecordModal(layer, fields);
        
    } catch (error) {
        console.error('Error adding new record:', error);
        showError('Failed to add new record: ' + error.message);
    }
}

function showNewRecordModal(layer, editableFields) {
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
                            This will create a new record in the Teable.io table. Only editable fields are shown.
                        </div>
                        <form id="newRecordForm">
                            <div class="row">
                                ${editableFields.map(field => `
                                    <div class="col-md-6 mb-3">
                                        <label class="form-label">
                                            ${field}
                                            <span class="badge bg-success ms-1">Editable</span>
                                        </label>
                                        <input type="text" class="form-control" name="${field}" placeholder="Enter ${field}">
                                    </div>
                                `).join('')}
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-success" onclick="saveNewRecord('${layer.id}')">
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
}

async function saveNewRecord(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) {
        showError('Layer not found');
        return;
    }
    
    try {
        // Get form data
        const form = document.getElementById('newRecordForm');
        const formData = new FormData(form);
        const recordData = {};
        
        for (const [key, value] of formData.entries()) {
            recordData[key] = value;
        }
        
        // Add geometry field if it exists (empty for now)
        if (layer.geometryField) {
            recordData[layer.geometryField] = '';
        }
        
        // Create record in Teable.io
        const newRecord = await window.teableAPI.createRecord(layer.tableId, recordData);
        
        // Add to local layer data
        layer.records.push(newRecord);
        layer.featureCount++;
        
        // Refresh the attribute table
        await refreshAttributeTable(layerId);
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('newRecordModal'));
        modal.hide();
        
        showSuccess('New record added successfully!');
        
    } catch (error) {
        console.error('Error saving new record:', error);
        showError('Failed to save new record: ' + error.message);
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
    
    if (!confirm(`Are you sure you want to delete ${selectedCheckboxes.length} selected record(s)? This action cannot be undone.`)) {
        return;
    }
    
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) {
        showError('Layer not found');
        return;
    }
    
    try {
        const recordsToDelete = [];
        selectedCheckboxes.forEach(checkbox => {
            const row = checkbox.closest('tr');
            const recordId = row.getAttribute('data-record-id');
            recordsToDelete.push(recordId);
        });
        
        // Delete from Teable.io
        for (const recordId of recordsToDelete) {
            await window.teableAPI.deleteRecord(layer.tableId, recordId);
        }
        
        // Remove from local data
        layer.records = layer.records.filter(r => !recordsToDelete.includes(r.id));
        layer.featureCount -= recordsToDelete.length;
        
        // Remove features from map
        layer.features = layer.features.filter((feature, index) => {
            if (recordsToDelete.includes(feature.recordId)) {
                if (layer.leafletLayer.hasLayer(feature)) {
                    layer.leafletLayer.removeLayer(feature);
                }
                return false;
            }
            return true;
        });
        
        // Clear selection
        selectedFeatures = [];
        
        // Refresh the attribute table
        await refreshAttributeTable(layerId);
        
        // Update layer list and statistics
        updateLayersList();
        updateMapStatistics();
        
        showSuccess(`${recordsToDelete.length} record(s) deleted successfully!`);
        
    } catch (error) {
        console.error('Error deleting selected records:', error);
        showError('Failed to delete selected records: ' + error.message);
    }
}

async function refreshAttributeTable(layerId) {
    const layer = mapLayers.find(l => l.id === layerId);
    if (!layer) return;
    
    try {
        // Reload data from Teable.io
        const recordsData = await window.teableAPI.getRecords(layer.tableId, { limit: 1000 });
        const records = recordsData.records || [];
        
        // Update layer data
        layer.records = records;
        layer.featureCount = records.length;
        
        // Recreate the attribute table
        const tableContainer = document.getElementById('attributeTableContainer');
        if (tableContainer) {
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
            
            // Reapply inline editing
            setupInlineEditing(layer);
        }
        
        // Update selection count
        updateSelectionCount();
        
    } catch (error) {
        console.error('Error refreshing attribute table:', error);
        showError('Failed to refresh attribute table: ' + error.message);
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
    if (!window.currentPopupFeature) return;

    const options = {
        close: { padding: 0.05, maxZoom: 22, minZoom: 18 },
        medium: { padding: 0.2, maxZoom: 20, minZoom: 14 },
        far: { padding: 0.4, maxZoom: 16, minZoom: 10 }
    };

    const zoomOptions = options[zoomType] || options.close;
    
    if (window.currentPopupFeature.getBounds) {
        // Polygon geometry
        const bounds = window.currentPopupFeature.getBounds();
        map.fitBounds(bounds.pad(zoomOptions.padding), {
            maxZoom: zoomOptions.maxZoom
        });
    } else if (window.currentPopupFeature.getLatLng) {
        // Point geometry
        const latlng = window.currentPopupFeature.getLatLng();
        map.setView(latlng, zoomOptions.maxZoom);
    }
    
    showSuccess(`Zoomed to feature - ${zoomType} view`);
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
        maxZoom = 22;
    } else if (maxSpan < 0.01) { // Small area
        padding = 0.3;
        maxZoom = 20;
    } else if (maxSpan < 0.1) { // Medium area
        padding = 0.15;
        maxZoom = 18;
    } else { // Large area
        padding = 0.05;
        maxZoom = 16;
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
        popupEnableCheckbox.addEventListener('change', handlePopupToggle);
    }

    const popupTemplateSelect = document.getElementById('propPopupTemplate');
    if (popupTemplateSelect) {
        popupTemplateSelect.addEventListener('change', handleTemplateChange);
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
            // Create popup content using the current layer configuration (which includes updated popup fields)
            const popupContent = createFeaturePopup(recordData, currentLayer);
            
            // Update the popup with the new content that respects field selection
            if (feature.getPopup()) {
                feature.getPopup().setContent(popupContent);
                feature.openPopup();
            } else {
                feature.bindPopup(popupContent).openPopup();
            }
            
            console.log(`Popup opened for feature ${featureIndex} in layer "${currentLayer.name}" with ${currentLayer.properties?.popup?.fields?.length || 0} configured fields`);
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