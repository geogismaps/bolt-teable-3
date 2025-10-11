/**
 * Public Map View - No Authentication Required
 */

let map;
let mapConfig = {};
let publicLayers = [];
let measurementGroup;
let currentMeasurement = null;

document.addEventListener('DOMContentLoaded', function() {
    initializePublicMap();
});

async function initializePublicMap() {
    try {
        // Load map configuration
        await loadMapConfiguration();
        
        // Initialize map
        initializeMap();
        
        // Load public layers with real data
        await loadPublicLayers();
        
        // Setup controls based on configuration
        setupMapControls();
        
        // Hide loading indicator
        document.getElementById('loading').style.display = 'none';
        
        console.log('✅ Public map initialized successfully');
        
    } catch (error) {
        console.error('❌ Failed to initialize public map:', error);
        showError('Failed to load map. Please try again later.');
    }
}

async function loadMapConfiguration() {
    try {
        // Load configuration from localStorage (in production, this would come from an API)
        const configData = localStorage.getItem('teable_map_config');
        
        if (configData) {
            mapConfig = JSON.parse(configData);
            console.log('📋 Loaded map configuration:', mapConfig);
        } else {
            // Default configuration if none exists
            mapConfig = {
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
                    enableFiltering: true,
                    enableQuickSearch: true,
                    enableBasemapSwitcher: true,
                    enablePopups: true,
                    enableLegend: true,
                    enableCoordinates: false
                },
                layers: []
            };
            console.log('📋 Using default map configuration');
        }
        
        // Check if public access is enabled
        if (!mapConfig.general?.enablePublicAccess) {
            throw new Error('Public access is not enabled for this map');
        }
        
        // Update page title and description
        document.getElementById('mapTitle').textContent = mapConfig.general?.title || 'Public GIS Map';
        document.getElementById('mapDescription').textContent = mapConfig.general?.description || '';
        
        console.log('✅ Map configuration loaded successfully');
        
    } catch (error) {
        console.error('❌ Error loading map configuration:', error);
        throw error;
    }
}

function initializeMap() {
    const config = mapConfig.general || {};
    
    // Initialize Leaflet map
    map = L.map('map').setView([
        config.centerLat || 20.5937,
        config.centerLng || 78.9629
    ], config.defaultZoom || 10);
    
    // Add base layer
    addBaseLayer(config.defaultBasemap || 'openstreetmap');
    
    // Initialize measurement group
    measurementGroup = L.layerGroup().addTo(map);
    
    // Setup mouse coordinate tracking if enabled
    if (mapConfig.features?.enableCoordinates) {
        setupCoordinateTracking();
    }
    
    console.log('🗺️ Map initialized');
}

function addBaseLayer(basemapType) {
    // Remove existing tile layers
    map.eachLayer(layer => {
        if (layer._url && layer._url.includes('tile')) {
            map.removeLayer(layer);
        }
    });
    
    let baseLayer;
    switch (basemapType) {
        case 'satellite':
            baseLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: '© Esri'
            });
            break;
        case 'terrain':
            baseLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenTopoMap'
            });
            break;
        case 'dark':
            baseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '© CartoDB'
            });
            break;
        case 'light':
            baseLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                attribution: '© CartoDB'
            });
            break;
        default:
            baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            });
    }
    
    baseLayer.addTo(map);
}

async function loadPublicLayers() {
    try {
        publicLayers = mapConfig.layers || [];
        
        if (publicLayers.length === 0) {
            console.log('⚠️ No public layers configured');
            return;
        }
        
        console.log(`📋 Loading ${publicLayers.length} public layers`);
        
        // Sort layers by order
        publicLayers.sort((a, b) => (a.order || 0) - (b.order || 0));
        
        // Load each layer with real data
        for (const layerConfig of publicLayers) {
            await loadPublicLayerWithRealData(layerConfig);
        }
        
        // Update layer controls
        updateLayerControls();
        
        // Update legend if enabled
        if (mapConfig.features?.enableLegend) {
            updateLegend();
        }
        
        console.log(`✅ Public layers loaded: ${publicLayers.length}`);
        
    } catch (error) {
        console.error('❌ Error loading public layers:', error);
    }
}

async function loadPublicLayerWithRealData(layerConfig) {
    try {
        console.log(`🔍 Loading real data for layer: ${layerConfig.name}`);
        
        // Get client configuration to access Teable API
        const clientConfig = JSON.parse(localStorage.getItem('teable_client_config') || '{}');
        
        if (!clientConfig.baseUrl || !clientConfig.accessToken) {
            console.warn('⚠️ No client configuration found, using sample data for layer:', layerConfig.name);
            await loadPublicLayerWithSampleData(layerConfig);
            return;
        }
        
        // Initialize a temporary API instance for data loading
        const tempAPI = {
            config: clientConfig,
            async request(endpoint, options = {}) {
                const url = `${this.config.baseUrl}${endpoint}`;
                const requestOptions = {
                    headers: {
                        'Authorization': `Bearer ${this.config.accessToken}`,
                        'Content-Type': 'application/json',
                        ...options.headers
                    },
                    ...options
                };
                
                const response = await fetch(url, requestOptions);
                if (!response.ok) {
                    throw new Error(`API Error: ${response.status}`);
                }
                return await response.json();
            },
            async getRecords(tableId, options = {}) {
                let endpoint = `/api/table/${tableId}/record`;
                const params = new URLSearchParams();
                if (options.limit) params.append('limit', options.limit);
                if (params.toString()) endpoint += `?${params.toString()}`;
                return await this.request(endpoint);
            }
        };
        
        // Load real data from Teable
        console.log(`📡 Fetching data from table: ${layerConfig.tableId}`);
        const recordsData = await tempAPI.getRecords(layerConfig.tableId, { limit: 1000 });
        const records = recordsData.records || [];
        
        console.log(`📊 Loaded ${records.length} records for layer: ${layerConfig.name}`);
        
        if (records.length === 0) {
            console.warn(`⚠️ No data found for layer: ${layerConfig.name}`);
            return;
        }
        
        // Find geometry field
        const geometryField = findGeometryField(records[0].fields);
        console.log(`🗺️ Detected geometry field: ${geometryField}`);
        
        if (!geometryField) {
            console.warn(`⚠️ No geometry field found for layer: ${layerConfig.name}`);
            return;
        }
        
        // Create features from real data
        const features = [];
        let validFeatureCount = 0;
        
        records.forEach((record, index) => {
            const geometry = record.fields[geometryField];
            
            if (geometry && typeof geometry === 'string') {
                try {
                    const leafletGeometry = parseWKTToLeaflet(geometry);
                    
                    if (leafletGeometry) {
                        validFeatureCount++;
                        
                        // Handle different geometry types
                        if (leafletGeometry.lat && leafletGeometry.lng) {
                            // Point geometry
                            const marker = L.marker([leafletGeometry.lat, leafletGeometry.lng]);
                            
                            if (mapConfig.features?.enablePopups) {
                                const popupContent = createPublicPopup(layerConfig, record.fields);
                                marker.bindPopup(popupContent);
                            }
                            
                            // Add labels if configured
                            if (layerConfig.labels?.enabled && layerConfig.labels?.field && record.fields[layerConfig.labels.field]) {
                                marker.bindTooltip(String(record.fields[layerConfig.labels.field]), {
                                    permanent: true,
                                    direction: 'center',
                                    className: 'feature-label'
                                });
                            }
                            
                            features.push(marker);
                            
                        } else if (Array.isArray(leafletGeometry)) {
                            // Polygon or MultiPolygon geometry
                            leafletGeometry.forEach(polygonCoords => {
                                if (Array.isArray(polygonCoords) && polygonCoords.length > 0) {
                                    const polygon = L.polygon(polygonCoords, {
                                        fillColor: layerConfig.styling?.fillColor || '#3498db',
                                        color: layerConfig.styling?.borderColor || '#2c3e50',
                                        weight: 2,
                                        fillOpacity: layerConfig.styling?.fillOpacity || 0.7
                                    });
                                    
                                    if (mapConfig.features?.enablePopups) {
                                        const popupContent = createPublicPopup(layerConfig, record.fields);
                                        polygon.bindPopup(popupContent);
                                    }
                                    
                                    // Add labels if configured
                                    if (layerConfig.labels?.enabled && layerConfig.labels?.field && record.fields[layerConfig.labels.field]) {
                                        polygon.bindTooltip(String(record.fields[layerConfig.labels.field]), {
                                            permanent: true,
                                            direction: 'center',
                                            className: 'feature-label'
                                        });
                                    }
                                    
                                    features.push(polygon);
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.error(`❌ Error parsing geometry for record ${index}:`, error);
                }
            }
        });
        
        console.log(`✅ Created ${features.length} features from ${validFeatureCount} valid geometries`);
        
        // Create layer group
        if (features.length > 0) {
            layerConfig.leafletLayer = L.layerGroup(features);
            
            // Add to map if visible by default
            if (layerConfig.visibility === 'visible') {
                layerConfig.leafletLayer.addTo(map);
                layerConfig.isVisible = true;
                
                // Fit map to data bounds on first visible layer
                if (publicLayers.filter(l => l.isVisible).length === 1) {
                    const group = new L.featureGroup(features);
                    const bounds = group.getBounds();
                    if (bounds.isValid()) {
                        map.fitBounds(bounds.pad(0.1));
                        console.log('🎯 Map fitted to layer data bounds');
                    }
                }
            } else {
                layerConfig.isVisible = false;
            }
            
            console.log(`✅ Successfully loaded layer: ${layerConfig.name} with ${features.length} features`);
        } else {
            console.warn(`⚠️ No valid features created for layer: ${layerConfig.name}`);
        }
        
    } catch (error) {
        console.error(`❌ Error loading real data for layer ${layerConfig.name}:`, error);
        console.log(`🔄 Falling back to sample data for layer: ${layerConfig.name}`);
        await loadPublicLayerWithSampleData(layerConfig);
    }
}

async function loadPublicLayerWithSampleData(layerConfig) {
    try {
        console.log(`🎲 Loading sample data for layer: ${layerConfig.name}`);
        
        const features = [];
        
        // Create sample polygon features around the map center
        const centerLat = mapConfig.general?.centerLat || 20.5937;
        const centerLng = mapConfig.general?.centerLng || 78.9629;
        
        for (let i = 0; i < 5; i++) {
            const lat = centerLat + (Math.random() - 0.5) * 0.5;
            const lng = centerLng + (Math.random() - 0.5) * 0.5;
            
            const polygon = L.polygon([
                [lat, lng],
                [lat + 0.05, lng],
                [lat + 0.05, lng + 0.05],
                [lat, lng + 0.05]
            ], {
                fillColor: layerConfig.styling?.fillColor || '#3498db',
                color: layerConfig.styling?.borderColor || '#2c3e50',
                weight: 2,
                fillOpacity: layerConfig.styling?.fillOpacity || 0.7
            });
            
            // Create popup content based on visible fields
            const popupContent = createPublicPopup(layerConfig, {
                id: `sample_${i + 1}`,
                name: `${layerConfig.name} Sample ${i + 1}`,
                description: `Sample feature from ${layerConfig.name}`,
                area: Math.round(Math.random() * 1000) + ' sq m',
                type: ['Residential', 'Commercial', 'Industrial'][Math.floor(Math.random() * 3)]
            });
            
            if (mapConfig.features?.enablePopups) {
                polygon.bindPopup(popupContent);
            }
            
            // Add labels if configured
            if (layerConfig.labels?.enabled && layerConfig.labels?.field) {
                polygon.bindTooltip(`Sample ${i + 1}`, {
                    permanent: true,
                    direction: 'center',
                    className: 'feature-label'
                });
            }
            
            features.push(polygon);
        }
        
        // Create layer group
        layerConfig.leafletLayer = L.layerGroup(features);
        
        // Add to map if visible by default
        if (layerConfig.visibility === 'visible') {
            layerConfig.leafletLayer.addTo(map);
            layerConfig.isVisible = true;
        } else {
            layerConfig.isVisible = false;
        }
        
        console.log(`✅ Loaded sample data for layer: ${layerConfig.name}`);
        
    } catch (error) {
        console.error(`❌ Error loading sample data for layer ${layerConfig.name}:`, error);
    }
}

// Find geometry field in record fields
function findGeometryField(fields) {
    const geometryFieldNames = ['geometry', 'geom', 'wkt', 'shape', 'polygon', 'point', 'location'];
    
    // First, try exact matches
    for (const geoName of geometryFieldNames) {
        if (fields[geoName]) {
            return geoName;
        }
    }
    
    // Then try partial matches
    for (const fieldName of Object.keys(fields)) {
        const lowerFieldName = fieldName.toLowerCase();
        if (geometryFieldNames.some(geoName => lowerFieldName.includes(geoName))) {
            return fieldName;
        }
    }
    
    return null;
}

// Parse WKT to Leaflet coordinates (same as map.js)
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
        } else if (upperWKT.startsWith('MULTIPOINT')) {
            return parseMultiPoint(wkt);
        } else if (upperWKT.startsWith('LINESTRING')) {
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
            
            return coords.map(coord => {
                const parts = coord.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const lon = parseFloat(parts[0]);
                    const lat = parseFloat(parts[1]);
                    
                    if (!isNaN(lat) && !isNaN(lon)) {
                        return [lat, lon]; // Leaflet uses [lat, lon]
                    }
                }
                return null;
            }).filter(coord => coord !== null);
        }).filter(ring => ring.length > 0);
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
            
            if (!isNaN(lat) && !isNaN(lon)) {
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
                
                if (!isNaN(lat) && !isNaN(lon)) {
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

function createPublicPopup(layerConfig, featureData) {
    let content = '<div class="popup-content">';
    
    // Add layer name as header
    content += `<h6 style="margin-bottom: 10px; color: #2c3e50;">${layerConfig.name}</h6>`;
    
    // Add description if available
    if (layerConfig.description) {
        content += `<p style="font-size: 0.9rem; color: #7f8c8d; margin-bottom: 10px;">${layerConfig.description}</p>`;
    }
    
    // Add fields based on configuration
    const visibleFields = layerConfig.popupFields || layerConfig.visibleFields || Object.keys(featureData);
    
    visibleFields.forEach(fieldName => {
        if (featureData[fieldName] !== undefined && featureData[fieldName] !== null) {
            content += `
                <div class="popup-field">
                    <strong>${fieldName}:</strong> ${featureData[fieldName]}
                </div>
            `;
        }
    });
    
    content += '</div>';
    return content;
}

function setupMapControls() {
    const features = mapConfig.features || {};
    
    // Show/hide control panels based on configuration
    if (features.enableQuickSearch) {
        document.getElementById('searchPanel').style.display = 'block';
    }
    
    if (features.enableMeasurement) {
        document.getElementById('measurementPanel').style.display = 'block';
    }
    
    if (features.enableBasemapSwitcher) {
        document.getElementById('basemapPanel').style.display = 'block';
        document.getElementById('basemapSelector').value = mapConfig.general?.defaultBasemap || 'openstreetmap';
    }
    
    if (features.enableCoordinates) {
        document.getElementById('coordinates').style.display = 'block';
    }
    
    if (features.enableLegend && publicLayers.length > 0) {
        document.getElementById('legend').style.display = 'block';
    }
}

function updateLayerControls() {
    const container = document.getElementById('layerControls');
    
    if (publicLayers.length === 0) {
        container.innerHTML = '<p style="color: #7f8c8d; font-size: 0.9rem;">No layers available</p>';
        return;
    }
    
    let html = '';
    publicLayers.forEach(layer => {
        html += `
            <div class="layer-control">
                <label>
                    <input type="checkbox" ${layer.isVisible ? 'checked' : ''} 
                           onchange="toggleLayer('${layer.id}', this.checked)">
                    ${layer.name}
                </label>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function toggleLayer(layerId, isVisible) {
    const layer = publicLayers.find(l => l.id === layerId);
    if (!layer || !layer.leafletLayer) return;
    
    if (isVisible) {
        layer.leafletLayer.addTo(map);
        layer.isVisible = true;
    } else {
        map.removeLayer(layer.leafletLayer);
        layer.isVisible = false;
    }
    
    // Update legend
    if (mapConfig.features?.enableLegend) {
        updateLegend();
    }
}

function updateLegend() {
    const container = document.getElementById('legendContent');
    const visibleLayers = publicLayers.filter(l => l.isVisible);
    
    if (visibleLayers.length === 0) {
        container.innerHTML = '<p style="color: #7f8c8d; font-size: 0.9rem;">No visible layers</p>';
        return;
    }
    
    let html = '';
    visibleLayers.forEach(layer => {
        const fillColor = layer.styling?.fillColor || '#3498db';
        html += `
            <div class="legend-item">
                <div class="legend-color" style="background-color: ${fillColor};"></div>
                <span>${layer.name}</span>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

function setupCoordinateTracking() {
    map.on('mousemove', function(e) {
        const lat = e.latlng.lat.toFixed(6);
        const lng = e.latlng.lng.toFixed(6);
        document.getElementById('coordinatesText').textContent = `Lat: ${lat}, Lng: ${lng}`;
    });
}

function performSearch() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    
    if (!searchTerm) {
        // Reset all layers to normal style
        publicLayers.forEach(layer => {
            if (layer.leafletLayer) {
                layer.leafletLayer.eachLayer(feature => {
                    feature.setStyle({
                        fillColor: layer.styling?.fillColor || '#3498db',
                        color: layer.styling?.borderColor || '#2c3e50',
                        weight: 2,
                        fillOpacity: layer.styling?.fillOpacity || 0.7
                    });
                });
            }
        });
        return;
    }
    
    // Highlight matching features
    publicLayers.forEach(layer => {
        if (layer.leafletLayer && layer.isVisible) {
            layer.leafletLayer.eachLayer(feature => {
                // Check if feature matches search term
                const popupContent = feature.getPopup()?.getContent() || '';
                const matches = popupContent.toLowerCase().includes(searchTerm);
                
                if (matches) {
                    feature.setStyle({
                        fillColor: '#e74c3c',
                        color: '#c0392b',
                        weight: 3,
                        fillOpacity: 0.8
                    });
                } else {
                    feature.setStyle({
                        fillColor: layer.styling?.fillColor || '#3498db',
                        color: layer.styling?.borderColor || '#2c3e50',
                        weight: 2,
                        fillOpacity: 0.3
                    });
                }
            });
        }
    });
}

function changeBasemap() {
    const basemapType = document.getElementById('basemapSelector').value;
    addBaseLayer(basemapType);
}

function startMeasurement(type) {
    // Clear previous measurements
    clearMeasurements();
    
    // Update button states
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(type + 'Btn').classList.add('active');
    
    currentMeasurement = type;
    
    if (type === 'distance') {
        map.on('click', onDistanceMeasureClick);
        map.getContainer().style.cursor = 'crosshair';
    } else if (type === 'area') {
        map.on('click', onAreaMeasureClick);
        map.getContainer().style.cursor = 'crosshair';
    }
}

let measurementPoints = [];

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
                html: `<div style="background: white; padding: 2px 6px; border-radius: 3px; font-size: 12px; border: 1px solid #333;">${distance}</div>`,
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
                html: `<div style="background: white; padding: 2px 6px; border-radius: 3px; font-size: 12px; border: 1px solid #333;">${area}</div>`,
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
    
    // Reset button states
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    
    // Reset cursor
    map.getContainer().style.cursor = '';
    
    // Remove event listeners
    map.off('click', onDistanceMeasureClick);
    map.off('click', onAreaMeasureClick);
}

function showError(message) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('errorText').textContent = message;
    document.getElementById('errorMessage').style.display = 'block';
}

// Make functions globally available
window.toggleLayer = toggleLayer;
window.performSearch = performSearch;
window.changeBasemap = changeBasemap;
window.startMeasurement = startMeasurement;
window.clearMeasurements = clearMeasurements;