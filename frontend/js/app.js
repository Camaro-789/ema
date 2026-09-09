// Táchira Map System - Main Application
// Uses MapLibre GL JS (open-source, no API key required)

let map = null;
let currentGeoJSON = null;
let layers = [];
let activeTool = 'select';
let pendingLine = [];
let networkFeatures = [];
let basemapMenu = null;
let postCatalog = JSON.parse(localStorage.getItem('fibermap-post-catalog') || '[]');
let folders = JSON.parse(localStorage.getItem('fibermap-folders') || '[{"name":"Red principal","children":["Postes","Cajas","Ductos","Iluminarias"]}]');
let selectedFeatureIndex = null;

const NETWORK_TOOLS = {
    post: { name: 'Poste', icon: '🪵', color: '#8e5a2a', geometry: 'Point' },
    box: { name: 'Caja', icon: '📦', color: '#9b59b6', geometry: 'Point' },
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
    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'osm': {
                    type: 'raster',
                    tiles: [
                        'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
                    ],
                    tileSize: 256,
                    attribution: '© OpenStreetMap contributors'
                },
                'esri-satellite': {
                    type: 'raster',
                    tiles: [
                        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                    ],
                    tileSize: 256,
                    attribution: '© Esri'
                },
                'esri-terrain': {
                    type: 'raster',
                    tiles: [
                        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'
                    ],
                    tileSize: 256,
                    attribution: '© Esri'
                }
            },
            layers: [
                {
                    id: 'osm-layer',
                    type: 'raster',
                    source: 'osm'
                },
                {
                    id: 'satellite-layer',
                    type: 'raster',
                    source: 'esri-satellite',
                    layout: { visibility: 'none' }
                },
                {
                    id: 'terrain-layer',
                    type: 'raster',
                    source: 'esri-terrain',
                    layout: { visibility: 'none' }
                }
            ]
        },
        center: [-72.225, 7.766], // San Cristóbal, Táchira
        zoom: 12,
        minZoom: 8,
        maxZoom: 17
    });

    map.on('load', () => {
        console.log('Map loaded');
        loadLayers();
        setupMapTools();
        restoreSavedMap();
    });

    // Add navigation controls
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl());
    map.addControl(new maplibregl.FullscreenControl());
}

function setBasemap(type) {
    if (!map) return;
    const visibility = {
        osm: type === 'osm' || type === 'hybrid',
        satellite: type === 'satellite' || type === 'hybrid',
        terrain: type === 'terrain'
    };
    map.setLayoutProperty('osm-layer', 'visibility', visibility.osm ? 'visible' : 'none');
    map.setLayoutProperty('satellite-layer', 'visibility', visibility.satellite ? 'visible' : 'none');
    map.setLayoutProperty('terrain-layer', 'visibility', visibility.terrain ? 'visible' : 'none');
    if (type === 'hybrid') {
        map.setPaintProperty('osm-layer', 'raster-opacity', 0.65);
    } else {
        map.setPaintProperty('osm-layer', 'raster-opacity', 1);
    }
}

function setupMapTools() {
    document.querySelectorAll('input[name="basemap"]').forEach(input => {
        input.addEventListener('change', event => setBasemap(event.target.value));
    });
    document.querySelectorAll('[data-tool]').forEach(button => {
        button.addEventListener('click', () => selectTool(button.dataset.tool));
    });
    map.on('click', handleMapClick);
    map.on('dblclick', finishLine);
    map.doubleClickZoom.disable();

    const mapLayersButton = document.getElementById('btn-map-layers');
    const mapZoomOutButton = document.getElementById('btn-map-zoom-out');
    const mapGeolocateButton = document.getElementById('btn-map-geolocate');

    if (mapLayersButton) mapLayersButton.addEventListener('click', toggleBasemapMenu);
    if (mapZoomOutButton) mapZoomOutButton.addEventListener('click', () => map.zoomOut());
    if (mapGeolocateButton) mapGeolocateButton.addEventListener('click', locateUser);
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
            map.flyTo({
                center: [position.coords.longitude, position.coords.latitude],
                zoom: Math.max(map.getZoom(), 15),
                essential: true
            });
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

function selectTool(tool) {
    activeTool = tool;
    pendingLine = [];
    const picker = document.getElementById('post-catalog-picker');
    if (picker) picker.classList.toggle('hidden', tool !== 'post');
    if (tool === 'post' && !postCatalog.length) {
        document.getElementById('active-tool-hint').textContent = 'Crea primero un tipo de poste en el catálogo';
    }
    document.querySelectorAll('[data-tool]').forEach(button => {
        button.classList.toggle('active', button.dataset.tool === tool);
    });
    const hint = document.getElementById('active-tool-hint');
    if (hint) {
        hint.textContent = tool === 'select'
            ? 'Modo selección activo'
            : `${NETWORK_TOOLS[tool]?.icon || ''} ${NETWORK_TOOLS[tool]?.name || tool}: haz clic en el mapa`;
    }
    if (map) map.getCanvas().style.cursor = tool === 'select' ? '' : 'crosshair';
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
    const postType = tool === NETWORK_TOOLS.post && postCatalog.length
        ? postCatalog[Number(document.getElementById('post-type-select').value) || 0]
        : null;
    if (tool === NETWORK_TOOLS.post && !postType) {
        alert('Crea y selecciona un tipo de poste antes de colocarlo.');
        return;
    }
    const feature = {
        type: 'Feature',
        geometry: { type: tool.geometry, coordinates },
        properties: {
            id: Date.now(),
            name: postType ? postType.name : tool.name,
            type: tool.name,
            toolId: Object.keys(NETWORK_TOOLS).find(key => NETWORK_TOOLS[key] === tool),
            color: tool.color,
            folder: 'Red principal',
            ...(postType || {})
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
    if (!map) return;
    const sourceId = 'network-elements';
    if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData({
            type: 'FeatureCollection',
            features: networkFeatures.map(item => ({ type: item.type, geometry: item.geometry, properties: item.properties }))
        });
        return;
    }
    map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
    map.addLayer({
        id: 'network-lines',
        type: 'line',
        source: sourceId,
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#2ecc71'], 'line-width': 4 }
    });
    map.addLayer({
        id: 'network-points',
        type: 'circle',
        source: sourceId,
        filter: ['==', '$type', 'Point'],
        paint: {
            'circle-radius': 8,
            'circle-color': ['coalesce', ['get', 'color'], '#3498db'],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 2
        }
    });
    map.on('click', 'network-points', event => {
        const featureId = Number(event.features[0].properties.id);
        selectedFeatureIndex = networkFeatures.findIndex(item => item.properties.id === featureId);
        if (selectedFeatureIndex >= 0) openElementProperties(selectedFeatureIndex);
    });
}

function renderPostCatalog() {
    const list = document.getElementById('post-catalog-list');
    const picker = document.getElementById('post-type-select');
    if (!list || !picker) return;
    list.innerHTML = postCatalog.length
        ? postCatalog.map(item => `<div class="catalog-item"><strong>${item.name}</strong><br>${item.height} m · ${item.material || 'Material no indicado'}</div>`).join('')
        : '<p class="empty-state">No hay tipos creados.</p>';
    picker.innerHTML = postCatalog.map((item, index) =>
        `<option value="${index}">${item.name} (${item.height} m)</option>`).join('');
}

function renderFolders() {
    const tree = document.getElementById('folders-tree');
    if (!tree) return;
    tree.innerHTML = folders.map((folder, index) => `
        <div class="folder-item">📁 ${folder.name}
            <button type="button" class="add-subfolder" data-folder-index="${index}">＋ subcarpeta</button>
            <div class="folder-children">${folder.children.map(child => `<div>└─ 📂 ${child}</div>`).join('')}</div>
            <small>${networkFeatures.filter(item => (item.properties.folder || folder.name) === folder.name).length} elementos</small>
        </div>`).join('');
    tree.querySelectorAll('.add-subfolder').forEach(button => {
        button.addEventListener('click', () => {
            const name = prompt('Nombre de la subcarpeta:');
            if (!name || !name.trim()) return;
            folders[Number(button.dataset.folderIndex)].children.push(name.trim());
            renderFolders();
        });
    });
}

function saveMap() {
    localStorage.setItem('fibermap-network-features', JSON.stringify(networkFeatures));
    localStorage.setItem('fibermap-post-catalog', JSON.stringify(postCatalog));
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
    const properties = item.properties;
    const fields = document.getElementById('element-properties-fields');
    const coordinates = item.geometry.type === 'Point'
        ? item.geometry.coordinates
        : item.geometry.coordinates[0];
    fields.innerHTML = `
        <label>Tipo<input value="${properties.type}" disabled></label>
        <label>Nombre<input name="name" value="${properties.name || ''}" required></label>
        <label>Coordenadas<input value="${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}" disabled></label>
        <label>Altura (m)<input name="height" type="number" step="0.1" value="${properties.height || ''}"></label>
        <label>Imagen<input name="image" type="file" accept="image/*"></label>
        ${properties.image ? '<small>Imagen cargada. Selecciona otra para reemplazarla.</small>' : ''}
    `;
    document.getElementById('element-properties-modal').classList.remove('hidden');
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
    const layerId = `layer-${Date.now()}`;
    
    // Add source
    map.addSource(layerId, {
        type: 'geojson',
        data: geojson
    });
    
    // Determine geometry types
    const types = new Set(geojson.features.map(f => f.geometry?.type));
    
    // Add layers for each geometry type
    if (types.has('Point') || types.has('MultiPoint')) {
        map.addLayer({
            id: `${layerId}-points`,
            type: 'circle',
            source: layerId,
            paint: {
                'circle-radius': 6,
                'circle-color': '#3498db',
                'circle-opacity': 0.8
            }
        });
    }
    
    if (types.has('LineString') || types.has('MultiLineString')) {
        map.addLayer({
            id: `${layerId}-lines`,
            type: 'line',
            source: layerId,
            paint: {
                'line-width': 3,
                'line-color': '#e74c3c',
                'line-opacity': 0.8
            }
        });
    }
    
    if (types.has('Polygon') || types.has('MultiPolygon')) {
        map.addLayer({
            id: `${layerId}-polygons`,
            type: 'fill',
            source: layerId,
            paint: {
                'fill-color': '#2ecc71',
                'fill-opacity': 0.5
            }
        });
    }
    
    // Fit bounds
    const bounds = new maplibregl.LngLatBounds();
    geojson.features.forEach(f => {
        if (f.geometry?.coordinates) {
            flattenCoords(f.geometry.coordinates).forEach(c => {
                bounds.extend([c[0], c[1]]);
            });
        }
    });
    
    map.fitBounds(bounds, { padding: 50 });
    
    // Add popup on click
    map.on('click', `${layerId}-points`, (e) => {
        if (e.features[0].properties) {
            new maplibregl.Popup()
                .setHTML(JSON.stringify(e.features[0].properties, null, 2))
                .setLngLat(e.lngLat)
                .addTo(map);
        }
    });
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

document.addEventListener('DOMContentLoaded', () => {
    renderPostCatalog();
    renderFolders();
    document.getElementById('btn-toggle-add-tools')?.addEventListener('click', event => {
        const content = document.getElementById('add-tools-content');
        const expanded = content.classList.toggle('hidden') === false;
        event.currentTarget.setAttribute('aria-expanded', String(expanded));
        event.currentTarget.textContent = expanded ? '−' : '＋';
        event.currentTarget.title = expanded ? 'Ocultar herramientas' : 'Mostrar herramientas';
    });
    document.getElementById('btn-new-post-type')?.addEventListener('click', () => {
        document.getElementById('post-type-form').classList.toggle('hidden');
    });
    document.getElementById('post-type-form')?.addEventListener('submit', event => {
        event.preventDefault();
        postCatalog.push({
            name: document.getElementById('post-type-name').value.trim(),
            height: document.getElementById('post-type-height').value,
            material: document.getElementById('post-type-material').value.trim()
        });
        localStorage.setItem('fibermap-post-catalog', JSON.stringify(postCatalog));
        event.target.reset();
        event.target.classList.add('hidden');
        renderPostCatalog();
    });
    document.getElementById('btn-save-map')?.addEventListener('click', saveMap);
    document.getElementById('btn-new-folder')?.addEventListener('click', () => {
        document.getElementById('folder-form').classList.toggle('hidden');
    });
    document.getElementById('btn-create-folder')?.addEventListener('click', () => {
        const input = document.getElementById('folder-name');
        const name = input.value.trim();
        if (!name) return;
        folders.push({ name, children: [] });
        input.value = '';
        document.getElementById('folder-form').classList.add('hidden');
        renderFolders();
    });
    document.getElementById('btn-close-properties')?.addEventListener('click', () => {
        document.getElementById('element-properties-modal').classList.add('hidden');
    });
    document.getElementById('element-properties-form')?.addEventListener('submit', event => {
        event.preventDefault();
        const item = networkFeatures[selectedFeatureIndex];
        if (!item) return;
        const form = event.target;
        item.properties.name = form.elements.name.value;
        item.properties.height = form.elements.height.value;
        const image = form.elements.image.files[0];
        const finish = () => {
            redrawNetworkFeatures();
            renderNetworkLayersList();
            renderFolders();
            document.getElementById('element-properties-modal').classList.add('hidden');
        };
        if (image) {
            const reader = new FileReader();
            reader.onload = () => { item.properties.image = reader.result; finish(); };
            reader.onerror = () => alert('No se pudo cargar la imagen.');
            reader.readAsDataURL(image);
        } else finish();
    });
});