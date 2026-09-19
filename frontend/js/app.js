// Táchira Map System - Main Application (MapLibre GL JS)
// Núcleo del mapa: inicialización, mapas base, controles rápidos, búsqueda en
// OpenStreetMap y herramientas de importar/exportar.
// Los objetos FTTH (colocación, propiedades y guardado) viven en js/ftth-mapa.js.

let map = null;
let currentGeoJSON = null;
let basemapMenu = null;
let importedLayerId = null;

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
        map.resize();
        map.triggerRepaint();
        if (window.FTTHMapa && window.FTTHMapa.init) {
            window.FTTHMapa.init();
        }
    };
    map.on('load', initializeMapLayers);
    map.on('style.load', initializeMapLayers);
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

function setupMapTools() {
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
                setBasemap(button.dataset.basemap);
                basemapMenu.classList.remove('visible');
            });
        });
    }
    basemapMenu.classList.toggle('visible');
}
// Import file (KML, KMZ, GPX, CSV, GeoJSON, Shapefile)
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
    removeImportedLayer();
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

// Remove the imported GeoJSON layer from the map
function removeImportedLayer() {
    if (!importedLayerId || !map || !map.getSource(importedLayerId)) {
        importedLayerId = null;
        return;
    }
    ['points', 'lines', 'fills'].forEach(suffix => {
        if (map.getLayer(`${importedLayerId}-${suffix}`)) map.removeLayer(`${importedLayerId}-${suffix}`);
    });
    map.removeSource(importedLayerId);
    importedLayerId = null;
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
    if (!importedLayerId) {
        alert('No hay datos importados en el mapa.');
        return;
    }
    if (confirm('¿Quitar del mapa los datos importados?')) {
        currentGeoJSON = null;
        removeImportedLayer();
    }
});

// Initialize
window.addEventListener('DOMContentLoaded', initMap);
