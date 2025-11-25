const API_BASE = window.location.origin;
let currentStep = 1;
let selectedDataSource = null;
let sessionData = null;
let detectedFieldMappings = null;
let previewMapInstance = null;

function init() {
    const session = localStorage.getItem('customer_session');
    if (!session) {
        window.location.href = 'login.html';
        return;
    }

    try {
        sessionData = JSON.parse(session);
        loadOnboardingStatus();
    } catch (error) {
        console.error('Session error:', error);
        window.location.href = 'login.html';
    }
}

async function loadOnboardingStatus() {
    try {
        const response = await fetch(`${API_BASE}/api/onboarding/status/${sessionData.customerId}`);
        const data = await response.json();

        if (data.success && data.status) {
            if (data.status.is_complete) {
                goToStep(3);
            } else if (data.status.data_source_connected) {
                goToStep(2);
            }
        }
    } catch (error) {
        console.error('Error loading onboarding status:', error);
    }
}

function selectDataSource(source) {
    selectedDataSource = source;

    document.querySelectorAll('.data-source-card').forEach(card => {
        card.classList.remove('selected');
    });

    event.target.closest('.data-source-card').classList.add('selected');

    document.getElementById('teableConfig').style.display = source === 'teable' ? 'block' : 'none';
    document.getElementById('googleSheetsConfig').style.display = source === 'google_sheets' ? 'block' : 'none';
    document.getElementById('step1Actions').style.display = 'flex';
    document.getElementById('step1Next').disabled = true;
}

async function testTeableConnection() {
    const baseUrl = document.getElementById('teableBaseUrl').value;
    const spaceId = document.getElementById('teableSpaceId').value;
    const baseId = document.getElementById('teableBaseId').value;
    const apiToken = document.getElementById('teableApiToken').value;

    if (!baseUrl || !spaceId || !baseId || !apiToken) {
        alert('Please fill in all Teable connection fields');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/customers/${sessionData.customerId}/teable-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                baseUrl,
                spaceId,
                baseId,
                accessToken: apiToken
            })
        });

        const data = await response.json();

        if (data.success) {
            alert('Connection successful!');
            document.getElementById('step1Next').disabled = false;

            await updateOnboardingStep('data_source', {
                data_source_connected: true
            });
        } else {
            alert('Connection failed: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Connection error:', error);
        alert('Connection failed. Please check your credentials.');
    }
}

async function connectGoogleSheets() {
    try {
        const response = await fetch(`${API_BASE}/api/auth/google/start?customerId=${sessionData.customerId}&adminEmail=${sessionData.email}`);
        const data = await response.json();

        if (data.authUrl) {
            window.location.href = data.authUrl;
        } else {
            alert('Failed to start OAuth flow');
        }
    } catch (error) {
        console.error('OAuth error:', error);
        alert('Failed to connect to Google Sheets');
    }
}

async function loadSpreadsheets() {
    try {
        const response = await fetch(`${API_BASE}/api/google-sheets/${sessionData.customerId}/spreadsheets`);
        const data = await response.json();

        const selector = document.getElementById('spreadsheetSelector');
        selector.innerHTML = '<option value="">Choose a spreadsheet...</option>';

        data.spreadsheets.forEach(sheet => {
            const option = document.createElement('option');
            option.value = sheet.id;
            option.textContent = sheet.name;
            selector.appendChild(option);
        });

        document.getElementById('sheetsSelector').style.display = 'block';
        document.getElementById('step1Next').disabled = false;
    } catch (error) {
        console.error('Error loading spreadsheets:', error);
    }
}

async function loadSheets() {
    const spreadsheetId = document.getElementById('spreadsheetSelector').value;
    if (!spreadsheetId) return;

    try {
        const response = await fetch(`${API_BASE}/api/google-sheets/${sessionData.customerId}/sheets?spreadsheetId=${spreadsheetId}`);
        const data = await response.json();

        const selector = document.getElementById('sheetSelector');
        selector.innerHTML = '<option value="">Choose a sheet...</option>';

        data.sheets.forEach(sheet => {
            const option = document.createElement('option');
            option.value = sheet.title;
            option.textContent = sheet.title;
            selector.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading sheets:', error);
    }
}

function goToStep(step) {
    if (step === 2 && selectedDataSource) {
        detectLocationFields();
    }

    currentStep = step;

    document.querySelectorAll('.step-content').forEach(content => {
        content.classList.remove('active');
    });

    document.getElementById(`step${step}`).classList.add('active');

    document.querySelectorAll('.step').forEach((stepEl, index) => {
        stepEl.classList.remove('active', 'completed');

        if (index + 1 < step) {
            stepEl.classList.add('completed');
        } else if (index + 1 === step) {
            stepEl.classList.add('active');
        }
    });

    const progressPercent = ((step - 1) / 2) * 100;
    document.getElementById('progressBarFill').style.width = `${progressPercent}%`;

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function detectLocationFields() {
    document.getElementById('detectingLocation').style.display = 'block';
    document.getElementById('locationDetected').style.display = 'none';
    document.getElementById('noLocationData').style.display = 'none';

    try {
        let requestBody = {
            customerId: sessionData.customerId,
            dataSource: selectedDataSource
        };

        if (selectedDataSource === 'google_sheets') {
            const spreadsheetId = document.getElementById('spreadsheetSelector').value;
            const sheetName = document.getElementById('sheetSelector').value;
            requestBody.spreadsheetId = spreadsheetId;
            requestBody.sheetName = sheetName;
        }

        const response = await fetch(`${API_BASE}/api/onboarding/detect-location-fields`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        setTimeout(() => {
            document.getElementById('detectingLocation').style.display = 'none';

            if (data.success && data.detected.hasLocationData) {
                displayDetectedFields(data.detected, data.fieldMappings, data.sampleData);
                document.getElementById('locationDetected').style.display = 'block';
                document.getElementById('step2Next').disabled = false;
                detectedFieldMappings = data.fieldMappings;
            } else {
                document.getElementById('noLocationData').style.display = 'block';
            }
        }, 1500);
    } catch (error) {
        console.error('Detection error:', error);
        document.getElementById('detectingLocation').style.display = 'none';
        document.getElementById('noLocationData').style.display = 'block';
    }
}

function displayDetectedFields(detected, fieldMappings, sampleData) {
    const container = document.getElementById('detectedFields');
    let html = '<div class="row">';

    if (detected.geometryColumn) {
        html += `
            <div class="col-md-6 mb-3">
                <div class="field-mapping-item">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong><i class="fas fa-shapes me-2"></i>Geometry Column</strong>
                        <span class="badge-detected">Auto-detected</span>
                    </div>
                    <div class="text-muted">${detected.geometryColumn}</div>
                </div>
            </div>
        `;
    }

    if (detected.latitudeColumn && detected.longitudeColumn) {
        html += `
            <div class="col-md-6 mb-3">
                <div class="field-mapping-item">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong><i class="fas fa-map-pin me-2"></i>Latitude Column</strong>
                        <span class="badge-detected">Auto-detected</span>
                    </div>
                    <div class="text-muted">${detected.latitudeColumn}</div>
                </div>
            </div>
            <div class="col-md-6 mb-3">
                <div class="field-mapping-item">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong><i class="fas fa-map-pin me-2"></i>Longitude Column</strong>
                        <span class="badge-detected">Auto-detected</span>
                    </div>
                    <div class="text-muted">${detected.longitudeColumn}</div>
                </div>
            </div>
        `;
    }

    if (detected.idColumn) {
        html += `
            <div class="col-md-6 mb-3">
                <div class="field-mapping-item">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong><i class="fas fa-fingerprint me-2"></i>ID Column</strong>
                        <span class="badge-detected">Auto-detected</span>
                    </div>
                    <div class="text-muted">${detected.idColumn}</div>
                </div>
            </div>
        `;
    }

    if (detected.nameColumn) {
        html += `
            <div class="col-md-6 mb-3">
                <div class="field-mapping-item">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <strong><i class="fas fa-tag me-2"></i>Name Column</strong>
                        <span class="badge-detected">Auto-detected</span>
                    </div>
                    <div class="text-muted">${detected.nameColumn}</div>
                </div>
            </div>
        `;
    }

    html += '</div>';
    container.innerHTML = html;

    if (sampleData && sampleData.length > 0) {
        document.getElementById('previewMapContainer').style.display = 'block';
        initPreviewMap(sampleData);
    }
}

function initPreviewMap(features) {
    if (previewMapInstance) {
        previewMapInstance.remove();
    }

    previewMapInstance = L.map('previewMap').setView([0, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(previewMapInstance);

    const markers = [];

    features.forEach(feature => {
        if (feature.geometry && feature.geometry.type === 'Point') {
            const [lng, lat] = feature.geometry.coordinates;
            const marker = L.marker([lat, lng]).addTo(previewMapInstance);

            if (feature.properties && Object.keys(feature.properties).length > 0) {
                const props = Object.entries(feature.properties)
                    .slice(0, 5)
                    .map(([key, value]) => `<strong>${key}:</strong> ${value}`)
                    .join('<br>');
                marker.bindPopup(props);
            }

            markers.push([lat, lng]);
        }
    });

    if (markers.length > 0) {
        const bounds = L.latLngBounds(markers);
        previewMapInstance.fitBounds(bounds, { padding: [50, 50] });
    }
}

async function completeOnboarding() {
    try {
        if (detectedFieldMappings) {
            await fetch(`${API_BASE}/api/onboarding/save-field-mappings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerId: sessionData.customerId,
                    dataSource: selectedDataSource,
                    fieldMappings: detectedFieldMappings,
                    userEmail: sessionData.email
                })
            });
        }

        await fetch(`${API_BASE}/api/onboarding/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerId: sessionData.customerId,
                userEmail: sessionData.email
            })
        });

        goToStep(3);
    } catch (error) {
        console.error('Error completing onboarding:', error);
        alert('Failed to complete onboarding. Please try again.');
    }
}

async function updateOnboardingStep(step, data) {
    try {
        await fetch(`${API_BASE}/api/onboarding/update-step`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerId: sessionData.customerId,
                step,
                data,
                userEmail: sessionData.email
            })
        });
    } catch (error) {
        console.error('Error updating onboarding step:', error);
    }
}

function showContactSupport() {
    window.location.href = 'contact-support.html';
}

function goToDashboard() {
    window.location.href = 'dashboard.html';
}

function skipOnboarding() {
    if (confirm('Are you sure you want to skip setup? You can complete it later from your dashboard.')) {
        window.location.href = 'dashboard.html';
    }
}

document.addEventListener('DOMContentLoaded', init);

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('oauth') === 'success') {
    selectedDataSource = 'google_sheets';
    loadSpreadsheets();
}
