// Táchira Map System - Main Application (MapLibre GL JS)

let map = null;
let currentGeoJSON = null;
let layers = [];
let activeTool = 'select';
let pendingLine = [];
let networkFeatures = [];
let basemapMenu = null;
let objectCatalog = [];
let selectedFeatureIndex = null;
let networkLayer = null;
let importedLayerId = null;
const basemapLayers = {};

const NETWORK_TOOLS = {
    post: { name: 'Poste', icon: '🪵', color: '#8e5a2a', geometry: 'Point' },
    box: { name: 'Caja', icon: '📦', color: '#9b59b6', geometry: 'Point' },
    manga: { name: 'Manga', icon: '🟣', color: '#16a085', geometry: 'Point' },
    duct: { name: 'Ducto', icon: '🛠️', color: '#34495e', geometry: 'LineString' },
    light: { name: 'Iluminaria', icon: '💡', color: '#f1c40f', geometry: 'Point' },
    olt: { name: 'OLT', icon: '🔴', color: '#e74c3c', geometry: 'Point' },
    splitter: { name: 'Splitter', icon: '🟠', color: '#e67e22', geometry: 'Point' },
    nap: { name: 'Caja NAP', icon: '🟡', color: '#f1c40f', geometry: 'Point' },
    client: { name: 'Cliente', icon: '🔵', color: '#3498db', geometry: 'Point' },
    cable: { name: 'Cable', icon: '➖', color: '#2ecc71', geometry: 'LineString' }
};

// Initialize map
function initMap() {
    window.map = map = new maplibregl.Map({
        container: 'map',
        style: 'map-style.json',
        center: [-72.225, 7.766],
        zoom: 17,
        minZoom: 8,
        maxZoom: 21,
        doubleClickZoom: false,
        attributionControl: false
    });
    map.on('error', event => console.error('MapLibre error:', event.error || event));
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({
        customAttribution: '© OpenStreetMap contributors | Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community'
    }));
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
    let layersInitialized = false;
    const initializeMapLayers = () => {
        if (layersInitialized) return;
        if (!map.isStyleLoaded()) return;
        layersInitialized = true;
        addBasemapLayers();
        networkLayer = 'network';
        map.addSource(networkLayer, { type: 'geojson', data: emptyFeatureCollection() });
        map.addLayer({ id: 'network-lines', type: 'line', source: networkLayer,
            filter: ['==', '$type', 'LineString'],
            paint: { 'line-color': ['coalesce', ['get', 'color'], '#2ecc71'], 'line-width': 4 } });
        map.addLayer({ id: 'network-points', type: 'circle', source: networkLayer,
            filter: ['==', '$type', 'Point'],
            paint: { 'circle-radius': 8, 'circle-color': ['coalesce', ['get', 'color'], '#3498db'],
                'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
        map.on('click', 'network-lines', handleNetworkFeatureClick);
        map.on('click', 'network-points', handleNetworkFeatureClick);
        restoreSavedMap();
        map.resize();
        map.triggerRepaint();
        if (window.FTTHMapa && window.FTTHMapa.init) {
            window.FTTHMapa.init();
        }
    };
    map.on('load', initializeMapLayers);
    map.on('style.load', initializeMapLayers);
    loadLayers();
    setupMapTools();
    setupMapSearch();
}

function setBasemap(type) {
    if (!map) return;
    ['osm', 'satellite', 'terrain'].forEach(layer => {
        if (map.getLayer(`${layer}-tiles`)) {
            map.setLayoutProperty(`${layer}-tiles`, 'visibility',
                (type === layer || (type === 'hybrid' && layer === 'satellite') || (type === 'hybrid' && layer === 'osm')) ? 'visible' : 'none');
            if (layer === 'osm') map.setPaintProperty('osm-tiles', 'raster-opacity', type === 'hybrid' ? 0.35 : 1);
        }
    });
}

function emptyFeatureCollection() { return { type: 'FeatureCollection', features: [] }; }

function addBasemapLayers() {
    basemapLayers.osm = 'osm-tiles';
    basemapLayers.satellite = 'satellite-tiles';
    basemapLayers.terrain = 'terrain-tiles';
}

function setupMapTools() {
    document.querySelectorAll('input[name="basemap"]').forEach(input => {
        input.addEventListener('change', event => setBasemap(event.target.value));
    });
    document.querySelectorAll('[data-tool]').forEach(button => {
        button.addEventListener('click', () => selectTool(button.dataset.tool));
    });
    // FTTHMapa maneja los eventos de clic en el mapa

    const mapLayersButton = document.getElementById('btn-map-layers');
    const mapZoomOutButton = document.getElementById('btn-map-zoom-out');
    const mapGeolocateButton = document.getElementById('btn-map-geolocate');

    if (mapLayersButton) mapLayersButton.addEventListener('click', toggleBasemapMenu);
    if (mapZoomOutButton) mapZoomOutButton.addEventListener('click', () => map.zoomOut());
    if (mapGeolocateButton) mapGeolocateButton.addEventListener('click', locateUser);
}

function setupMapSearch() {
    const input = document.getElementById('map-search-input');
    const button = document.getElementById('btn-map-search');
    if (!input || !button) return;
    const search = () => searchOpenStreetMap(input.value.trim());
    button.addEventListener('click', search);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') search();
    });
}

async function searchOpenStreetMap(query) {
    if (!query) return;
    const button = document.getElementById('btn-map-search');
    if (button) button.disabled = true;
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`,
            { headers: { Accept: 'application/json' } }
        );
        if (!response.ok) throw new Error(`OpenStreetMap respondió ${response.status}`);
        const results = await response.json();
        if (!results.length) {
            alert('No se encontró ese lugar en OpenStreetMap.');
            return;
        }
        const result = results[0];
        const center = [Number(result.lon), Number(result.lat)];
        map.flyTo({ center, zoom: Math.max(map.getZoom(), 16) });
        new maplibregl.Popup().setLngLat(center).setHTML(`<strong>${result.display_name}</strong>`).addTo(map);
    } catch (error) {
        alert(`Error buscando en OpenStreetMap: ${error.message}`);
    } finally {
        if (button) button.disabled = false;
    }
}

function locateUser() {
    if (!navigator.geolocation) {
        alert('La geolocalización no está disponible en este navegador.');
        return;
    }
    const button = document.getElementById('btn-map-geolocate');
    if (button) button.textContent = '⏳ Buscando...';
    navigator.geolocation.getCurrentPosition(
        position => {
            map.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: Math.max(map.getZoom(), 15) });
            if (button) button.textContent = '📍 Mi ubicación';
        },
        error => {
            if (button) button.textContent = '📍 Mi ubicación';
            const message = error.code === error.PERMISSION_DENIED
                ? 'Debes permitir el acceso a tu ubicación para usar esta función.'
                : 'No se pudo obtener tu ubicación. Verifica el GPS o la conexión.';
            alert(message);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
}

function toggleBasemapMenu() {
    if (!basemapMenu) {
        basemapMenu = document.createElement('div');
        basemapMenu.className = 'map-basemap-menu';
        basemapMenu.innerHTML = `
            <strong>Vista del mapa</strong>
            <button type="button" data-basemap="osm">🛣️ Calles</button>
            <button type="button" data-basemap="satellite">🛰️ Satélite</button>
            <button type="button" data-basemap="terrain">⛰️ Relieve</button>
            <button type="button" data-basemap="hybrid">🌐 Híbrida</button>
        `;
        document.getElementById('map-container').appendChild(basemapMenu);
        basemapMenu.querySelectorAll('[data-basemap]').forEach(button => {
            button.addEventListener('click', () => {
                const type = button.dataset.basemap;
                setBasemap(type);
                const radio = document.querySelector(`input[name="basemap"][value="${type}"]`);
                if (radio) radio.checked = true;
                basemapMenu.classList.remove('visible');
            });
        });
    }
    basemapMenu.classList.toggle('visible');
}

function getToolCatalogKind(tool) {
    return tool === 'post' ? 'post' : tool;
}

function getToolObjectOptions(tool) {
    const kind = getToolCatalogKind(tool);
    return objectCatalog.filter(item => (item.kind || 'post') === kind);
}

function selectTool(tool) {
    activeTool = tool;
    pendingLine = [];
    const picker = document.getElementById('post-catalog-picker');
    const options = getToolObjectOptions(tool);
    const hasOptions = !!options.length;

    if (picker) {
        picker.classList.toggle('hidden', !hasOptions || tool === 'select');
    }
    if (picker && hasOptions) {
        const select = document.getElementById('post-type-select');
        if (select) {
            select.innerHTML = options.map((item, index) => `<option value="${index}">${item.name}</option>`).join('');
            select.value = '0';
        }
    }
    document.querySelectorAll('[data-tool]').forEach(button => {
        button.classList.toggle('active', button.dataset.tool === tool);
    });
    const hint = document.getElementById('active-tool-hint');
    if (hint) {
        if (tool === 'select') {
            hint.textContent = 'Modo selección activo';
        } else if (!hasOptions) {
            hint.textContent = 'Crea primero un tipo de objeto en el catálogo';
        } else {
            hint.textContent = `${NETWORK_TOOLS[tool]?.icon || ''} ${NETWORK_TOOLS[tool]?.name || tool}: haz clic en el mapa`;
        }
    }
    if (map) map.getCanvas().style.cursor = tool === 'select' ? '' : 'crosshair';
}

function openSidebarPanel(panelName) {
    document.querySelectorAll('.nav-icon').forEach(button => {
        button.classList.toggle('active', button.dataset.sidebarPanel === panelName);
    });
    document.querySelectorAll('.sidebar-panel').forEach(panel => {
        const isActive = panel.id === `panel-${panelName}`;
        panel.classList.toggle('hidden', !isActive);
        panel.classList.toggle('active', isActive);
    });
}

function handleMapClick(event) {
    if (activeTool === 'select') return;
    const tool = NETWORK_TOOLS[activeTool];
    if (!tool) return;
    if (tool.geometry === 'LineString') {
        pendingLine.push([event.lngLat.lng, event.lngLat.lat]);
        if (pendingLine.length === 1) {
            document.getElementById('active-tool-hint').textContent = 'Haz clic para añadir puntos y doble clic para finalizar';
        }
        return;
    }
    addNetworkFeature(tool, [event.lngLat.lng, event.lngLat.lat]);
}

function finishLine(event) {
    if (!NETWORK_TOOLS[activeTool] || NETWORK_TOOLS[activeTool].geometry !== 'LineString') return;
    event.preventDefault();
    if (pendingLine.length >= 2) addNetworkFeature(NETWORK_TOOLS[activeTool], pendingLine);
    pendingLine = [];
}

function addNetworkFeature(tool, coordinates) {
    const toolKey = Object.keys(NETWORK_TOOLS).find(key => NETWORK_TOOLS[key] === tool) || tool;
    const typeOptions = getToolObjectOptions(toolKey);
    const selectedType = typeOptions.length
        ? (typeOptions[Number(document.getElementById('post-type-select')?.value) || 0] || typeOptions[0])
        : null;

    if (toolKey === 'post' && !selectedType) {
        alert('Crea y selecciona un tipo de poste antes de colocarlo.');
        return;
    }

    const feature = {
        type: 'Feature',
        geometry: { type: tool.geometry, coordinates },
        properties: {
            id: Date.now(),
            name: selectedType ? selectedType.name : tool.name,
            type: selectedType ? selectedType.name : tool.name,
            toolId: toolKey,
            color: selectedType ? selectedType.color : tool.color,
            folder: 'Red principal',
            ...(selectedType || {}),
            objectTypeId: selectedType ? selectedType.id : null
        }
    };
    networkFeatures.push({ ...feature, _style: tool });
    redrawNetworkFeatures();
    currentGeoJSON = { type: 'FeatureCollection', features: networkFeatures.map(item => ({
        type: item.type, geometry: item.geometry, properties: item.properties
    })) };
    renderNetworkLayersList();
    renderFolders();
}

function redrawNetworkFeatures() {
    if (!map || !map.getSource('network')) return;
    map.getSource('network').setData({
        type: 'FeatureCollection',
        features: networkFeatures.map((item, index) => ({
            type: item.type, geometry: item.geometry,
            properties: { ...item.properties, _index: index }
        }))
    });
}

function handleNetworkFeatureClick(event) {
    const feature = event.features && event.features[0];
    if (!feature) return;
    selectedFeatureIndex = Number(feature.properties._index);
    openElementProperties(selectedFeatureIndex);
}

function renderPostCatalog() {
    const list = document.getElementById('post-catalog-list');
    const picker = document.getElementById('post-type-select');
    if (!list) return;
    list.innerHTML = objectCatalog.length
        ? objectCatalog.map(item => `
            <div class="catalog-item">
                <span class="catalog-swatch" style="background:${item.color || '#8e5a2a'}"></span>
                <div>
                    <strong>${item.name}</strong>
                    <small>${item.kind} · ${item.height ? item.height + ' m' : 'Sin altura'} · ${item.material || 'Material no indicado'}</small>
                </div>
            </div>
        `).join('')
        : '<p class="empty-state">No hay tipos creados.</p>';
    if (picker) {
        const activeTool = activeTool || 'post';
        const options = getToolObjectOptions(activeTool);
        picker.innerHTML = options.length
            ? options.map((item, index) => `<option value="${index}">${item.name}</option>`).join('')
            : '<option value="">Sin tipos</option>';
    }
}

async function saveObjectType(typeData) {
    try {
        const response = await fetch('/api/v1/object-types', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(typeData)
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || 'No se pudo guardar el tipo');
        }
        document.getElementById('post-type-form').reset();
        document.getElementById('post-type-form').classList.add('hidden');
        await loadObjectTypes();
        return result;
    } catch (error) {
        alert(error.message);
        return null;
    }
}

async function loadObjectTypes() {
    try {
        const response = await fetch('/api/v1/object-types');
        if (!response.ok) throw new Error('No se pudo cargar la base de tipos');
        objectCatalog = await response.json();
        renderPostCatalog();
        if (activeTool) selectTool(activeTool);
    } catch (error) {
        console.error('Error cargando tipos:', error);
        objectCatalog = [];
        renderPostCatalog();
    }
}

function renderFolders() {
    // Reemplazado por ftth-carpetas.js
}

function saveMap() {
    localStorage.setItem('fibermap-network-features', JSON.stringify(networkFeatures));
    localStorage.setItem('fibermap-folders', JSON.stringify(folders));
    alert('Mapa y elementos guardados en este navegador.');
}

function restoreSavedMap() {
    const saved = JSON.parse(localStorage.getItem('fibermap-network-features') || '[]');
    if (Array.isArray(saved)) {
        networkFeatures = saved.map(item => ({
            ...item,
            _style: NETWORK_TOOLS[item.properties?.toolId] || NETWORK_TOOLS.post
        }));
        if (networkFeatures.length) redrawNetworkFeatures();
        renderNetworkLayersList();
        renderFolders();
    }
}

function openElementProperties(index) {
    const item = networkFeatures[index];
    if (!item) return;

    const modal = document.getElementById('element-properties-modal');
    const fields = document.getElementById('element-properties-fields');
    const title = document.getElementById('prop-modal-title');
    const badge = document.getElementById('prop-header-badge');
    const thumb = document.getElementById('prop-pole-thumbnail');
    const poleTitle = document.getElementById('prop-pole-info-title');
    const poleDesc = document.getElementById('prop-pole-info-desc');

    if (!modal || !fields) return;

    const properties = item.properties || {};
    const coordinates = item.geometry.type === 'Point'
        ? item.geometry.coordinates
        : (Array.isArray(item.geometry.coordinates[0]) ? item.geometry.coordinates[0] : item.geometry.coordinates);
    const lat = Number(coordinates[1]);
    const lon = Number(coordinates[0]);

    if (title) {
        title.textContent = `${properties.type || 'Elemento'} ${properties.name ? `#${properties.name}` : ''}`.trim();
    }
    if (badge) {
        badge.textContent = (properties.type || 'ACTIVO').toUpperCase();
    }
    if (thumb) thumb.src = properties.image || '';
    if (poleTitle) poleTitle.textContent = (properties.name || 'Vista de Terreno');
    if (poleDesc) poleDesc.textContent = properties.notes || 'Captura adjunta durante levantamiento de red.';

    const rows = [
        { key: 'name', label: 'Nombre', value: properties.name || '', editable: true },
        { key: 'type', label: 'Tipo', value: properties.type || '', editable: true },
        { key: 'material', label: 'Material', value: properties.material || '', editable: true },
        { key: 'height', label: 'Altura', value: properties.height || '', editable: true },
        { key: 'lat', label: 'Latitud', value: Number.isFinite(lat) ? lat.toFixed(6) : '', editable: true },
        { key: 'lon', label: 'Longitud', value: Number.isFinite(lon) ? lon.toFixed(6) : '', editable: true },
        { key: 'color', label: 'Color', value: properties.color || '#3b82f6', editable: true },
        { key: 'notes', label: 'Observaciones', value: properties.notes || '', editable: true }
    ];

    fields.innerHTML = rows.map(f => `
        <div style="display:flex; flex-direction:column; gap:2px;">
            <span class="prop-form-label">${f.label}</span>
            <input data-prop-key="${f.key}" value="${(f.value ?? '').toString().replace(/"/g, '&quot;')}" ${f.editable ? '' : 'readonly'} class="prop-form-control" ${f.key === 'color' ? 'type="color"' : 'type="text"'}>
        </div>
    `).join('');

    if (window.FTTHMapa && typeof FTTHMapa.switchPropTab === 'function') {
        FTTHMapa.switchPropTab('info');
    }

    modal.onclick = (event) => {
        if (event.target === modal) modal.classList.add('hidden');
    };

    modal.classList.remove('hidden');
}

function renderNetworkLayersList() {
    const container = document.getElementById('network-layers-list');
    if (!container) return;
    container.innerHTML = networkFeatures.length
        ? networkFeatures.map((item, index) =>
            `<div class="network-layer-item"><span>${item._style.icon} ${item._style.name} ${index + 1}</span><button type="button" data-remove-network="${index}">×</button></div>`
        ).join('')
        : '<p class="empty-state">Aún no hay elementos agregados.</p>';
    container.querySelectorAll('[data-remove-network]').forEach(button => {
        button.addEventListener('click', () => {
            networkFeatures.splice(Number(button.dataset.removeNetwork), 1);
            redrawNetworkFeatures();
            renderNetworkLayersList();
        });
    });
}

// Load layers from backend
async function loadLayers() {
    try {
        const response = await fetch('/api/v1/layers');
        layers = await response.json();
        renderLayersList();
    } catch (error) {
        console.error('Error loading layers:', error);
    }
}

// Render layers list in sidebar
function renderLayersList() {
    const container = document.getElementById('layers-list');
    if (!container) return;
    container.innerHTML = '';
    
    layers.forEach(layer => {
        const div = document.createElement('div');
        div.className = 'layer-item';
        div.innerHTML = `
            <span>${layer.name}</span>
            <button onclick="deleteLayer(${layer.id})">Delete</button>
        `;
        container.appendChild(div);
    });
}

// Import file
async function importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.kml,.kmz,.gpx,.csv,.geojson,.shp,.json';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        showLoading(true);
        
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch('/api/v1/formats/import', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.success) {
                currentGeoJSON = result.geojson;
                addGeoJSONLayer(result.geojson, file.name);
                alert(`Importado: ${result.features} features`);
            } else {
                alert('Error importando: ' + result.detail);
            }
        } catch (error) {
            alert('Error: ' + error.message);
        } finally {
            showLoading(false);
        }
    };
    
    input.click();
}

// Add GeoJSON as map layer
function addGeoJSONLayer(geojson, name) {
    if (!map.isStyleLoaded()) return;
    if (importedLayerId) {
        ['points', 'lines', 'fills'].forEach(suffix => {
            if (map.getLayer(`${importedLayerId}-${suffix}`)) map.removeLayer(`${importedLayerId}-${suffix}`);
        });
        if (map.getSource(importedLayerId)) map.removeSource(importedLayerId);
    }
    importedLayerId = `imported-${Date.now()}`;
    map.addSource(importedLayerId, { type: 'geojson', data: geojson });
    map.addLayer({ id: `${importedLayerId}-fills`, type: 'fill', source: importedLayerId,
        filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#2ecc71', 'fill-opacity': 0.35 } });
    map.addLayer({ id: `${importedLayerId}-lines`, type: 'line', source: importedLayerId,
        filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#e74c3c', 'line-width': 3 } });
    map.addLayer({ id: `${importedLayerId}-points`, type: 'circle', source: importedLayerId,
        filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#3498db',
            'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
    ['points', 'lines', 'fills'].forEach(suffix => map.on('click', `${importedLayerId}-${suffix}`, event => {
        const feature = event.features && event.features[0];
        if (feature && feature.properties) new maplibregl.Popup().setLngLat(event.lngLat)
            .setHTML(`<pre>${JSON.stringify(feature.properties, null, 2)}</pre>`).addTo(map);
    }));
    const coords = [];
    (geojson.features || []).forEach(feature => { if (feature.geometry) coords.push(...flattenCoords(feature.geometry.coordinates)); });
    if (coords.length) {
        const bounds = coords.reduce((result, coord) => result.extend(coord),
            new maplibregl.LngLatBounds(coords[0], coords[0]));
        map.fitBounds(bounds, { padding: 50 });
    }
}

// Flatten coordinates recursively
function flattenCoords(coords) {
    let result = [];
    if (typeof coords[0] === 'number') {
        result.push(coords);
    } else {
        coords.forEach(c => {
            result = result.concat(flattenCoords(c));
        });
    }
    return result;
}

// Export current data
async function exportData() {
    if (!currentGeoJSON) {
        alert('No hay datos para exportar');
        return;
    }
    
    const format = prompt('Formato (geojson, kml, csv):', 'geojson');
    if (!format) return;
    
    try {
        const response = await fetch(`/api/v1/formats/export/${format}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ features: currentGeoJSON.features })
        });
        
        const result = await response.json();
        
        if (result.content) {
            const blob = new Blob([result.content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `export.${format}`;
            a.click();
        } else {
            // GeoJSON
            const blob = new Blob([JSON.stringify(result)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'export.geojson';
            a.click();
        }
    } catch (error) {
        alert('Error exportando: ' + error.message);
    }
}

// Run AI analysis
async function runAnalysis() {
    if (!currentGeoJSON) {
        alert('Importa datos primero');
        return;
    }
    
    const analysisType = document.getElementById('analysis-type').value;
    const resultsDiv = document.getElementById('analysis-results');
    
    try {
        const response = await fetch('/api/v1/ai/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                geojson: currentGeoJSON,
                analysis_type: analysisType
            })
        });
        
        const result = await response.json();
        
        let html = `<strong>Análisis:</strong> ${result.analysis_type}<br>`;
        html += `<strong>Resultado:</strong> <pre>${JSON.stringify(result.result, null, 2)}</pre>`;
        html += '<strong>Insights:</strong><ul>';
        result.insights.forEach(i => {
            html += `<li>${i}</li>`;
        });
        html += '</ul>';
        
        resultsDiv.innerHTML = html;
    } catch (error) {
        alert('Error en análisis: ' + error.message);
    }
}

// Delete layer
async function deleteLayer(id) {
    try {
        await fetch(`/api/v1/layers/${id}`, { method: 'DELETE' });
        loadLayers();
    } catch (error) {
        alert('Error: ' + error.message);
    }
}

// Show loading
function showLoading(show) {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.toggle('hidden', !show);
}

// Event listeners
const importButton = document.getElementById('btn-import');
const exportButton = document.getElementById('btn-export');
const clearButton = document.getElementById('btn-clear');
if (importButton) importButton.addEventListener('click', importFile);
if (exportButton) exportButton.addEventListener('click', exportData);
if (clearButton) clearButton.addEventListener('click', () => {
    if (!networkFeatures.length || confirm('¿Eliminar todos los elementos agregados?')) {
        networkFeatures = [];
        currentGeoJSON = null;
        redrawNetworkFeatures();
        renderNetworkLayersList();
    }
});

// Initialize
window.addEventListener('DOMContentLoaded', initMap);

document.addEventListener('DOMContentLoaded', async () => {
    renderPostCatalog();
    renderFolders();
    await loadObjectTypes();
    document.querySelectorAll('.nav-icon').forEach(button => {
        button.addEventListener('click', () => openSidebarPanel(button.dataset.sidebarPanel));
    });
    document.getElementById('btn-add-post-type')?.addEventListener('click', () => {
        const form = document.getElementById('post-type-form');
        form.classList.toggle('hidden');
        if (!form.classList.contains('hidden')) {
            form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
    document.getElementById('post-type-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const name = document.getElementById('post-type-name').value.trim();
        const height = document.getElementById('post-type-height').value;
        const material = document.getElementById('post-type-material').value.trim();
        const color = document.getElementById('post-type-color').value;
        const kind = document.getElementById('object-type-kind').value;
        const imageFile = document.getElementById('post-type-image').files[0];

        if (!name) {
            alert('Completa el nombre del tipo de objeto.');
            return;
        }

        const newType = {
            kind,
            name,
            height: height ? Number(height) : null,
            material: material || null,
            color,
            image: '',
            icon: NETWORK_TOOLS[kind]?.icon || '📍'
        };

        if (imageFile) {
            const reader = new FileReader();
            reader.onload = async () => {
                newType.image = reader.result;
                await saveObjectType(newType);
            };
            reader.readAsDataURL(imageFile);
            return;
        }

        await saveObjectType(newType);
    });
    document.getElementById('btn-save-map')?.addEventListener('click', saveMap);
    // Eventos de carpetas eliminados para no interferir con ftth-carpetas.js
    document.getElementById('prop-btn-close')?.addEventListener('click', () => {
        document.getElementById('element-properties-modal')?.classList.add('hidden');
    });
    document.getElementById('prop-btn-save')?.addEventListener('click', () => {
        const item = networkFeatures[selectedFeatureIndex];
        if (!item) return;
        document.querySelectorAll('#element-properties-fields input[data-prop-key]').forEach(input => {
            const key = input.dataset.propKey;
            const value = input.value.trim();
            if (!key || key === 'lat' || key === 'lon') return;
            item.properties[key] = value;
        });
        redrawNetworkFeatures();
        renderNetworkLayersList();
        renderFolders();
        document.getElementById('element-properties-modal')?.classList.add('hidden');
    });
});