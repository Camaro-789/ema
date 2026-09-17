/**
 * ftth-mapa.js
 * Capas MapLibre, colocación directa de elementos, persistencia en BD y sincronización en tiempo real.
 */

const FTTHMapa = (() => {

  // ── Estado ────────────────────────────────────────────────────────────────
  let _modoActivo = null;        // { categoria, tipoId, tipoNombre, color }
  let _pendingLine = [];         // puntos de ducto en progreso
  let _currentFeatures = [];     // Features en memoria local del proyecto activo
  let _ctxMenu = null;
  let _ctxFeature = null;

  const DEFAULT_DEFS = {
    poste:     { nombre: 'Poste Estándar 9m', color: '#8b4513', props: { material: 'Concreto', altura_m: 9.0, tipo_poste: 'Sencillo' } },
    cajanap:   { nombre: 'Caja NAP 16P',     color: '#eab308', props: { capacidad_puertos: '16 Puertos', tipo_instalacion: 'Aérea en Poste', splitter_interno: '1x16 PLC' } },
    manga:     { nombre: 'Manga Fusión 48H', color: '#a855f7', props: { tipo_manga: 'Aérea', capacidad_fusion: '48 hilos', puertos_entrada: 4 } },
    ducto:     { nombre: 'Ducto HDPE 110mm', color: '#ff5722', props: { tipo_ducto: 'HDPE' } },
    luminaria: { nombre: 'Luminaria LED',    color: '#06b6d4', props: { estado_funcionamiento: 'Activa' } },
    odf:       { nombre: 'ODF 24P SC/APC',   color: '#3b82f6', props: { modelo_marca: 'Generico', capacidad_puertos: '24', tipo_conector: 'SC/APC' } },
    olt:       { nombre: 'OLT GPON 8P',      color: '#ef4444', props: { marca_modelo: 'Huawei', tecnologia: 'GPON', cantidad_puertos_pon: 8 } },
    splitter:  { nombre: 'Splitter 1x8',     color: '#f97316', props: { relacion_division: '1x8 (10.7 dB)', tipo_conector: 'SC/APC' } },
    armario:   { nombre: 'Armario OLT HUB',  color: '#008000', props: { prefijo: 'CO_', nivel: 'olt_hub', colorImp: '#008000', colorNoImp: '#78909c', colorProj: '#ff00ff' } },
    cables:    { nombre: 'Cable ADSS 144H',  color: '#0284c7', props: { marca: 'Prysmian', modelo: 'ADSS-144', looses: 12, fibras: 144, atenuacion: 0.4 } },
    switches:  { nombre: 'Switch 24 Puertos', color: '#6366f1', props: { marca: 'Cisco', modelo: 'Catalyst 2960', puertos: 24, administrable: true } },
    fusion:    { nombre: 'Fusión Estándar',  color: '#ec4899', props: { cliente: false, atenuacion: 0.1 } }
  };

  const CAT_LABELS = {
    poste: 'Poste',
    cajanap: 'Caja NAP',
    manga: 'Manga',
    ducto: 'Ducto',
    luminaria: 'Luminaria',
    odf: 'ODF',
    olt: 'OLT',
    splitter: 'Splitter',
    armario: 'Armario',
    cables: 'Cable de Fibra',
    switches: 'Switch',
    fusion: 'Fusión'
  };

  function apiUrl(path) {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const origin = window.location.origin;
    if (origin && origin !== 'null' && !origin.includes('file://')) {
      return origin + (path.startsWith('/') ? path : '/' + path);
    }
    return 'http://127.0.0.1:8000' + (path.startsWith('/') ? path : '/' + path);
  }

  function getMap() {
    return window.map;
  }

  // ── Carga y renderizado de capas en MapLibre ──────────────────────────────
  async function cargarTodosElementos() {
    const map = getMap();
    if (!map || !map.isStyleLoaded() || !window.currentProjectId) return;
    try {
      const res = await fetch(apiUrl(`/api/elementos/todos?proyecto_id=${window.currentProjectId}`));
      if (!res.ok) return;
      const geojson = await res.json();
      _currentFeatures = (geojson && geojson.features) || [];
      _ensureFTTHLayers(map, { type: 'FeatureCollection', features: _currentFeatures });
      _updateStats();
    } catch (err) {
      console.error('Error cargando elementos FTTH:', err);
    }
  }

  // Crea la capa de etiquetas una vez que los íconos SVG están registrados en MapLibre.
  function _addLabelsLayerWhenReady(map, srcId) {
    const crear = () => {
      if (map.getLayer('ftth-labels-layer')) return;
      map.addLayer({
        id: 'ftth-labels-layer',
        type: 'symbol',
        source: srcId,
        filter: ['!=', ['get', 'categoria'], 'ducto'],
        layout: {
          // Ícono SVG del tipo (registrado por FTTHIconos.registrarEnMapa)
          'icon-image': ['concat', 'ftth-ico-', ['get', 'categoria']],
          'icon-size': 0.34,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-offset': [0, -10],
          'icon-anchor': 'bottom',
          // Etiqueta de texto con el nombre y el ID
          'text-field': ['concat', ['get', 'tipo_nombre'], ' #', ['to-string', ['get', 'id']]],
          'text-size': 12,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      });
    };

    if (window.FTTHIconos) {
      FTTHIconos.registrarEnMapa(map, crear);
    } else {
      crear();
    }
  }

  function _ensureFTTHLayers(map, geojson) {
    const srcId = 'ftth-elementos';
    const src = map.getSource(srcId);
    if (src) {
      src.setData(geojson);
      return;
    }

    map.addSource(srcId, { type: 'geojson', data: geojson });

    // 1. Capa Ductos (Líneas)
    if (!map.getLayer('ftth-ductos-layer')) {
      map.addLayer({
        id: 'ftth-ductos-layer',
        type: 'line',
        source: srcId,
        filter: ['==', ['get', 'categoria'], 'ducto'],
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#ff5722'],
          'line-width': 4,
          'line-dasharray': [2, 1],
        },
      });
    }

    // 2. Capa Puntos (8 Categorías)
    if (!map.getLayer('ftth-puntos-layer')) {
      map.addLayer({
        id: 'ftth-puntos-layer',
        type: 'circle',
        source: srcId,
        filter: ['!=', ['get', 'categoria'], 'ducto'],
        paint: {
          'circle-radius': [
            'match', ['get', 'categoria'],
            'poste', 8,
            'olt',   10,
            'odf',   8,
            'cajanap', 8,
            'manga', 7,
            'luminaria', 6,
            'splitter', 6,
            7,
          ],
          'circle-color': ['coalesce', ['get', 'color'], '#1d68bd'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
    }

    // 3. Etiquetas con el ícono SVG de cada tipo (fuente única: FTTHIconos)
    _addLabelsLayerWhenReady(map, srcId);

    // Menú contextual al clic derecho sobre elementos
    ['ftth-puntos-layer', 'ftth-ductos-layer'].forEach(layerId => {
      map.on('contextmenu', layerId, e => {
        e.preventDefault();
        _ctxFeature = e.features && e.features[0];
        showContextMenu(e.point, e.lngLat);
      });
      map.on('mouseenter', layerId, () => {
        if (!_modoActivo) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        if (!_modoActivo) map.getCanvas().style.cursor = '';
      });
    });
  }

  function _addFeatureToMap(feature) {
    const map = getMap();
    if (!map) return;
    _currentFeatures.push(feature);
    const src = map.getSource('ftth-elementos');
    if (src) {
      src.setData({ type: 'FeatureCollection', features: _currentFeatures });
    } else {
      _ensureFTTHLayers(map, { type: 'FeatureCollection', features: _currentFeatures });
    }
    _updateStats();
  }

  function _updateStats() {
    const count = (cat) => _currentFeatures.filter(f => f.properties && f.properties.categoria === cat).length;
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('stat-postes', count('poste'));
    el('stat-cajas',  count('cajanap'));
    el('stat-mangas', count('manga'));
    el('stat-ductos', count('ducto'));
    el('stat-olts',   count('olt'));
    el('stat-odfs',   count('odf'));
  }

  // ── Selección Directa de Objeto desde la Barra Lateral ───────────────────
  async function seleccionarObjeto(categoria) {
    if (!window.currentProjectId) {
      alert("⚠️ Debes seleccionar o crear un proyecto arriba a la izquierda antes de agregar elementos.");
      return;
    }

    // Resaltar botón activo en la barra lateral
    document.querySelectorAll('.sub-obj-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.cat === categoria);
    });

    let tipos = [];
    try {
      tipos = await FTTHTipos.getTipos(categoria);
    } catch (e) {
      console.warn('Error buscando tipos:', e);
    }

    if (tipos && tipos.length > 0) {
      // Mostrar modal selector con todos los tipos existentes en la base de datos
      mostrarPickerDeTipos(categoria, tipos);
    } else {
      // Auto-crear un tipo estándar en la base de datos para que el usuario nunca se quede bloqueado
      console.log('No hay tipos para', categoria, '— auto-creando...');
      const def = DEFAULT_DEFS[categoria] || { nombre: `${CAT_LABELS[categoria]} Estándar`, color: '#1d68bd', props: {} };
      try {
        const res = await fetch(apiUrl('/api/tipos/'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proyecto_id: Number(window.currentProjectId),
            categoria: categoria,
            nombre_id: def.nombre,
            color_mapa: def.color,
            foto: null,
            observaciones: 'Creado automáticamente por selección rápida',
            propiedades: def.props
          })
        });
        if (res.ok) {
          const nuevoTipo = await res.json();
          activarModoColocacion(categoria, nuevoTipo.id, nuevoTipo.nombre_id, nuevoTipo.color_mapa);
        } else {
          if (window.FTTHTipos) FTTHTipos.openModal(categoria);
        }
      } catch (err) {
        console.error('Error auto-creando tipo:', err);
        if (window.FTTHTipos) FTTHTipos.openModal(categoria);
      }
    }
  }

  // ── Modal Selector de Tipos Existentes en BD ─────────────────────────────
  function mostrarPickerDeTipos(categoria, tipos) {
    let modal = document.getElementById('ftth-type-picker-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ftth-type-picker-modal';
      modal.className = 'type-picker-modal hidden';
      document.body.appendChild(modal);
    }

    const catLabel = CAT_LABELS[categoria] || categoria;

    let itemsHtml = tipos.map(t => {
      const color = t.color_mapa || '#1d68bd';
      const propsSummary = t.propiedades ? Object.entries(t.propiedades).map(([k, v]) => `${k}: ${v}`).join(' | ') : '';
      return `
        <div class="picker-tipo-item" data-id="${t.id}" data-nombre="${t.nombre_id}" data-color="${color}">
          <span class="ftth-elem-ico" style="width:24px; height:24px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center;">
            ${window.FTTHIconos ? FTTHIconos.imgHtml(categoria, 24) : ''}
          </span>
          <div style="flex:1; min-width:0;">
            <strong>${t.nombre_id}</strong>
            <small style="display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${propsSummary || 'Sin propiedades adicionales'}</small>
          </div>
          <span style="font-size:11px; background:#141414; color:#fff; padding:3px 8px; border-radius:4px; font-weight:600; flex-shrink:0;">Usar 📍</span>
        </div>
      `;
    }).join('');

    modal.innerHTML = `
      <div class="type-picker-card">
        <div class="type-picker-header">
          <span>${window.FTTHIconos ? FTTHIconos.imgHtml(categoria, 20) : ''} Selecciona el tipo de ${catLabel}</span>
          <button type="button" style="background:none;border:none;color:#141414;cursor:pointer;font-size:16px;line-height:1;" onclick="FTTHMapa.cerrarPickerModal()">✕</button>
        </div>
        <div class="picker-tipos-list">
          ${itemsHtml}
        </div>
        <div style="padding: 9px 10px; border-top: 1px solid var(--border-light); background: #fafafa; display:flex; gap:8px;">
          <button type="button" class="btn-primary" style="flex:1; font-size:12px; padding:7px 10px; cursor:pointer;" id="btn-picker-new-type">
            ➕ Crear nueva plantilla de ${catLabel}
          </button>
        </div>
      </div>
    `;

    modal.classList.remove('hidden');

    // Eventos de selección
    modal.querySelectorAll('.picker-tipo-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = Number(item.dataset.id);
        const nombre = item.dataset.nombre;
        const color = item.dataset.color;
        cerrarPickerModal();
        activarModoColocacion(categoria, id, nombre, color);
      });
    });

    const btnNew = modal.querySelector('#btn-picker-new-type');
    if (btnNew) {
      btnNew.addEventListener('click', () => {
        cerrarPickerModal();
        if (window.FTTHTipos) FTTHTipos.openModal(categoria);
      });
    }
  }

  function cerrarPickerModal() {
    const modal = document.getElementById('ftth-type-picker-modal');
    if (modal) modal.classList.add('hidden');
  }




  // ── Modo Colocación ───────────────────────────────────────────────────────
  function activarModoColocacion(categoria, tipoId, tipoNombre, color = '#1d68bd') {
    _modoActivo = { categoria, tipoId, tipoNombre, color };
    _pendingLine = [];

    console.log('Modo colocación activado:', _modoActivo);

    const map = getMap();
    if (map) map.getCanvas().style.cursor = 'crosshair';

    showPlacementHint(
      categoria === 'ducto'
        ? `Ducto: Clic para marcar puntos, doble clic para terminar trazado`
        : `${tipoNombre}: Haz clic en el mapa para colocar el objeto`,
      categoria
    );

    if (window.FTTHTipos) {
      FTTHTipos.showToast(`Modo activo: ${tipoNombre}. Haz clic en el mapa.`, 'success', categoria);
    }
  }


  function desactivarModoColocacion() {
    _modoActivo = null;
    _pendingLine = [];
    const map = getMap();
    if (map) map.getCanvas().style.cursor = '';
    hidePlacementHint();
    document.querySelectorAll('.sub-obj-btn').forEach(b => b.classList.remove('active'));
  }

  function showPlacementHint(msg, iconCat) {
    let hint = document.getElementById('ftth-placement-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'ftth-placement-hint';
      hint.className = 'placement-hint';
      document.getElementById('map-container').appendChild(hint);
    }
    hint.textContent = '';
    if (iconCat && window.FTTHIconos) {
      const img = document.createElement('img');
      img.src = FTTHIconos.url(iconCat);
      img.alt = '';
      img.style.cssText = 'width:16px;height:16px;object-fit:contain;vertical-align:-3px;margin-right:6px;filter:brightness(0) invert(1);';
      hint.appendChild(img);
    }
    hint.appendChild(document.createTextNode(msg));
    hint.classList.remove('hidden');
  }

  function hidePlacementHint() {
    const hint = document.getElementById('ftth-placement-hint');
    if (hint) hint.classList.add('hidden');
  }

  // ── Modo Mover Objeto ─────────────────────────────────────────────────────
  let _modoMover = null; // { id, categoria, nombre }

  function iniciarModoMoverElemento(feature) {
    if (!feature || !feature.properties) return;
    const props = feature.properties;
    _modoMover = {
      id: props.id,
      categoria: props.categoria,
      nombre: props.tipo_nombre || props.categoria
    };

    const map = getMap();
    if (map) map.getCanvas().style.cursor = 'crosshair';

    showPlacementHint(`Moviendo ${props.tipo_nombre || props.categoria} #${props.id}: Haz clic en la nueva ubicación del mapa`, props.categoria);

    if (window.FTTHTipos) {
      FTTHTipos.showToast(`Modo Mover activo para #${props.id}. Haz clic en la nueva ubicación.`, 'info', props.categoria);
    }
  }

  // ── Clic en el Mapa ───────────────────────────────────────────────────────
  let _maplibreClickHandled = false;

  async function handleMapClick(e) {
    const { lng, lat } = e.lngLat;

    // Caso 1: Modo Mover Objeto Activo
    if (_modoMover) {
      const elemId = _modoMover.id;
      const nombre = _modoMover.nombre;
      _modoMover = null;

      const map = getMap();
      if (map) map.getCanvas().style.cursor = '';
      hidePlacementHint();

      try {
        console.log(`Moviendo elemento #${elemId} a:`, { lat, lon: lng });
        if (window.FTTHTipos) FTTHTipos.showToast(`Guardando nueva ubicación...`, 'info');

        const res = await fetch(apiUrl(`/api/elementos/${elemId}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: Number(lat), lon: Number(lng) })
        });

        if (!res.ok) throw new Error(`Error ${res.status}`);

        // Actualizar coordenadas localmente
        _currentFeatures = _currentFeatures.map(f => {
          if (f.properties && f.properties.id === elemId) {
            return {
              ...f,
              geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }
            };
          }
          return f;
        });

        const src = getMap()?.getSource('ftth-elementos');
        if (src) src.setData({ type: 'FeatureCollection', features: _currentFeatures });

        if (window.FTTHCarpetas && FTTHCarpetas.loadCarpetas) {
          FTTHCarpetas.loadCarpetas();
        }

        if (window.FTTHTipos) FTTHTipos.showToast(`✓ Objeto ${nombre} #${elemId} movido a nuevas coordenadas`, 'success');
      } catch (err) {
        console.error('Error al mover elemento:', err);
        if (window.FTTHTipos) FTTHTipos.showToast('Error al mover: ' + err.message, 'error');
      }
      return;
    }

    // Caso 2: Modo Colocación Activo
    if (!_modoActivo) {
      console.log('Clic ignorado: no hay modo activo');
      return;
    }
    
    // Marcar que MapLibre procesó este click
    _maplibreClickHandled = true;
    setTimeout(() => { _maplibreClickHandled = false; }, 100);

    const { categoria, tipoId, tipoNombre } = _modoActivo;
    console.log('Clic en mapa capturado (MapLibre):', { categoria, tipoId, tipoNombre, lng, lat });

    if (categoria === 'ducto') {
      _pendingLine.push([lng, lat]);
      if (_pendingLine.length === 1) {
        showPlacementHint('Ducto: Clic para añadir puntos, doble clic para finalizar', 'ducto');
      }
      _updateDuctPreview();
      return;
    }

    // Colocar elemento puntual
    colocarElemento(categoria, tipoId, tipoNombre, { lat, lon: lng });
  }

  function handleMapDblClick(e) {
    if (!_modoActivo || _modoActivo.categoria !== 'ducto') return;
    e.preventDefault();
    if (_pendingLine.length < 2) {
      if (window.FTTHTipos) FTTHTipos.showToast('Un ducto necesita al menos 2 puntos', 'error');
      return;
    }
    const { tipoId, tipoNombre } = _modoActivo;
    _removeDuctPreview();
    colocarDucto(tipoId, tipoNombre, [..._pendingLine]);
    _pendingLine = [];
    desactivarModoColocacion();
  }

  function _updateDuctPreview() {
    const map = getMap();
    if (!map || _pendingLine.length < 1) return;
    const src = map.getSource('ftth-duct-preview');
    const data = {
      type: 'FeatureCollection',
      features: _pendingLine.length >= 2 ? [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: _pendingLine },
        properties: {},
      }] : [],
    };
    if (src) { src.setData(data); return; }
    map.addSource('ftth-duct-preview', { type: 'geojson', data });
    map.addLayer({
      id: 'ftth-duct-preview-layer',
      type: 'line',
      source: 'ftth-duct-preview',
      paint: { 'line-color': '#ff5722', 'line-width': 3, 'line-dasharray': [3, 2] },
    });
  }

  function _removeDuctPreview() {
    const map = getMap();
    if (!map) return;
    if (map.getLayer('ftth-duct-preview-layer')) map.removeLayer('ftth-duct-preview-layer');
    if (map.getSource('ftth-duct-preview')) map.removeSource('ftth-duct-preview');
  }

  // ── Guardado en Base de Datos de Elementos ────────────────────────────────
  async function colocarElemento(categoria, tipoId, tipoNombre, { lat, lon }) {
    if (!window.currentProjectId) {
      alert("⚠️ Selecciona un proyecto primero.");
      return;
    }

    const body = {
      proyecto_id: Number(window.currentProjectId),
      tipo_id: tipoId,
      categoria: categoria,
      lat: Number(lat),
      lon: Number(lon),
      propiedades_instancia: {},
    };

    console.log('Enviando payload a POST /api/elementos/:', body);
    if (window.FTTHTipos) FTTHTipos.showToast('Enviando datos al servidor...', 'info');

    try {
      const res = await fetch(apiUrl('/api/elementos/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Error de red' }));
        console.error('Error de servidor al colocar:', err);
        throw new Error(err.detail || err.message || `Error ${res.status}`);
      }

      const feature = await res.json();
      console.log('Feature creada exitosamente:', feature);
      _addFeatureToMap(feature);

      // Recargar árbol de capas en el panel derecho inmediatamente
      if (window.FTTHCarpetas && FTTHCarpetas.loadCarpetas) {
        FTTHCarpetas.loadCarpetas();
      }

      if (window.FTTHTipos) {
        FTTHTipos.showToast(`✓ ${tipoNombre} agregado al mapa y capas`, 'success');
      }
    } catch (err) {
      console.error('Error al colocar elemento (catch block):', err);
      if (window.FTTHTipos) FTTHTipos.showToast('Error al colocar: ' + err.message, 'error');
    }
  }

  async function colocarDucto(tipoId, tipoNombre, coords) {
    if (!window.currentProjectId) return;
    const body = {
      proyecto_id: Number(window.currentProjectId),
      tipo_id: tipoId,
      categoria: 'ducto',
      coords_json: coords,
      propiedades_instancia: {},
    };

    try {
      const res = await fetch(apiUrl('/api/elementos/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `Error ${res.status}`);
      }

      const feature = await res.json();
      _addFeatureToMap(feature);

      if (window.FTTHCarpetas && FTTHCarpetas.loadCarpetas) {
        FTTHCarpetas.loadCarpetas();
      }

      if (window.FTTHTipos) {
        FTTHTipos.showToast(`✓ Ducto "${tipoNombre}" agregado`, 'success');
      }
    } catch (err) {
      if (window.FTTHTipos) FTTHTipos.showToast('Error al colocar ducto: ' + err.message, 'error');
    }
  }

  // ── Menú Contextual (Clic Derecho) ────────────────────────────────────────
  function initContextMenu() {
    if (!_ctxMenu) {
      _ctxMenu = document.createElement('div');
      _ctxMenu.id = 'ftth-ctx-menu';
      _ctxMenu.className = 'ctx-menu hidden';
      document.body.appendChild(_ctxMenu);
    }
    document.addEventListener('click', hideContextMenu);
  }

  function showContextMenu({ x, y }, lngLat) {
    if (!_ctxMenu || !_ctxFeature) return;
    const props = _ctxFeature.properties || {};
    const cat = props.categoria || 'elemento';
    const id = props.id;

    _ctxMenu.innerHTML = `
      <div class="ctx-header">${props.tipo_nombre || cat} #${id}</div>
      <button class="ctx-item" data-action="move">🎯 Mover Objeto</button>
      <button class="ctx-item" data-action="properties">🔍 Ver Propiedades</button>
      <hr class="ctx-divider">
      <button class="ctx-item ctx-item-danger" data-action="delete">🗑️ Eliminar</button>
    `;

    _ctxMenu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    _ctxMenu.style.top  = `${Math.min(y, window.innerHeight - 150)}px`;
    _ctxMenu.classList.remove('hidden');

    _ctxMenu.querySelectorAll('.ctx-item').forEach(btn => {
      btn.addEventListener('click', () => {
        hideContextMenu();
        const action = btn.dataset.action;
        if (action === 'delete') {
          eliminarElemento(id, props.tipo_nombre || cat);
        } else if (action === 'properties') {
          showPropertiesModal(props, _ctxFeature.geometry);
        } else if (action === 'move') {
          iniciarModoMoverElemento(_ctxFeature);
        }
      });
    });
  }

  function hideContextMenu() {
    if (_ctxMenu) _ctxMenu.classList.add('hidden');
  }

  async function eliminarElemento(id, nombre) {
    if (!confirm(`¿Eliminar ${nombre} #${id}?`)) return;
    try {
      const res = await fetch(apiUrl(`/api/elementos/${id}`), { method: 'DELETE' });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      _currentFeatures = _currentFeatures.filter(f => f.properties.id !== id);
      const src = getMap().getSource('ftth-elementos');
      if (src) src.setData({ type: 'FeatureCollection', features: _currentFeatures });
      if (window.FTTHCarpetas) FTTHCarpetas.loadCarpetas();
      if (window.FTTHTipos) FTTHTipos.showToast('Elemento eliminado ✓', 'success');
      _updateStats();
    } catch (err) {
      if (window.FTTHTipos) FTTHTipos.showToast(err.message, 'error');
    }
  }

  let _activePropElemId = null;
  let _propTabId = 'info';
  let _propTabAnimating = false;
  let _propUiBound = false;

  function parseInstProps(raw) {
    let instProps = raw;
    if (typeof instProps === 'string') {
      try {
        instProps = JSON.parse(instProps);
      } catch {
        instProps = {};
      }
    }
    if (!instProps || Array.isArray(instProps) || typeof instProps !== 'object') {
      return {};
    }
    return instProps;
  }

  function fillSelect(select, options, current) {
    if (!select) return;
    const seen = new Set();
    const list = [];
    options.forEach((opt) => {
      const value = String(opt || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      list.push(value);
    });
    if (current && !seen.has(String(current))) list.unshift(String(current));
    select.innerHTML = list.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (current) select.value = String(current);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function placePropIndicator() {
    const indicator = document.getElementById('prop-indicator');
    const active = document.querySelector('#element-properties-modal .prop-tab-button.active');
    if (!indicator || !active) return;
    indicator.style.width = `${active.offsetWidth}px`;
    indicator.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function fitPropPagesHeight() {
    const wrap = document.getElementById('prop-pages');
    const current = wrap?.querySelector('.prop-page.current');
    if (!wrap || !current) return;
    wrap.style.height = `${current.offsetHeight}px`;
  }

  function bindPropModalChrome() {
    if (_propUiBound) return;
    _propUiBound = true;

    document.getElementById('prop-btn-copy')?.addEventListener('click', () => {
      const lat = document.getElementById('prop-field-lat')?.value;
      const lon = document.getElementById('prop-field-lon')?.value;
      if (!lat || !lon) return;
      const text = `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
      const btn = document.getElementById('prop-btn-copy');
      const label = document.getElementById('prop-copy-label');
      const done = () => {
        if (label) label.textContent = 'Copiado';
        btn?.classList.add('copied');
        setTimeout(() => {
          if (label) label.textContent = 'Copiar';
          btn?.classList.remove('copied');
        }, 1600);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => {
          window.prompt('Copia las coordenadas:', text);
        });
      } else {
        window.prompt('Copia las coordenadas:', text);
      }
    });

    document.getElementById('prop-btn-maps')?.addEventListener('click', () => {
      const lat = document.getElementById('prop-field-lat')?.value;
      const lon = document.getElementById('prop-field-lon')?.value;
      if (!lat || !lon) return;
      window.open(`https://www.google.com/maps?q=${lat},${lon}`, '_blank');
    });

    document.getElementById('prop-btn-view-gallery')?.addEventListener('click', () => {
      switchPropTab('photos');
    });

    window.addEventListener('resize', () => {
      const modal = document.getElementById('element-properties-modal');
      if (!modal || modal.classList.contains('hidden')) return;
      placePropIndicator();
      fitPropPagesHeight();
    });
  }

  function showPropertiesModal(props, geometry) {
    const modal = document.getElementById('element-properties-modal');
    const extra = document.getElementById('element-properties-fields');
    const title = document.getElementById('prop-modal-title');
    const badge = document.getElementById('prop-header-badge');
    if (!modal) return;

    bindPropModalChrome();
    _activePropElemId = props.id;

    const instProps = parseInstProps(props.propiedades_instancia);
    const cat = props.categoria || 'elemento';
    const tipoNombre = props.tipo_nombre || CAT_LABELS[cat] || cat;
    const displayName = instProps.name || instProps.nombre || `${tipoNombre} #${props.id}`;

    if (title) title.textContent = displayName;
    if (badge) badge.textContent = instProps.estado || 'Activo';

    const nameInput = document.getElementById('prop-field-name');
    if (nameInput) nameInput.value = displayName;

    fillSelect(
      document.getElementById('prop-field-etiquetas'),
      [tipoNombre, instProps.etiquetas, instProps.tipo_poste, 'PT-AC', 'PT-CONC', 'PT-MET'].filter(Boolean),
      instProps.etiquetas || instProps.tipo_poste || tipoNombre
    );

    const colorSelect = document.getElementById('prop-field-color');
    const colorValue = String(instProps.color || props.color || '#3B82F6');
    const colorOpts = [
      { v: '#3B82F6', l: 'Azul (#3B82F6)' },
      { v: '#9CA3AF', l: 'Gris (#9CA3AF)' },
      { v: '#111111', l: 'Negro (#111111)' },
      { v: '#8B4513', l: 'Café (#8B4513)' }
    ];
    if (colorSelect) {
      const known = colorOpts.some((o) => o.v.toLowerCase() === colorValue.toLowerCase());
      if (!known) colorOpts.unshift({ v: colorValue, l: colorValue });
      colorSelect.innerHTML = colorOpts.map((o) => `<option value="${escapeHtml(o.v)}">${escapeHtml(o.l)}</option>`).join('');
      colorSelect.value = colorValue;
    }

    const licencia = document.getElementById('prop-field-licencia');
    if (licencia) licencia.value = instProps.licencia || 'Desconocido';

    const notes = document.getElementById('prop-field-notes');
    if (notes) notes.value = instProps.notes || instProps.observaciones || props.observaciones || '';

    let lat = null;
    let lon = null;
    if (geometry && geometry.coordinates && geometry.type === 'Point') {
      lon = Number(geometry.coordinates[0]);
      lat = Number(geometry.coordinates[1]);
    } else if (props.lat != null && props.lon != null) {
      lat = Number(props.lat);
      lon = Number(props.lon);
    }

    const latInput = document.getElementById('prop-field-lat');
    const lonInput = document.getElementById('prop-field-lon');
    const coordText = document.getElementById('prop-coord-text');
    if (latInput) latInput.value = Number.isFinite(lat) ? lat.toFixed(6) : '';
    if (lonInput) lonInput.value = Number.isFinite(lon) ? lon.toFixed(6) : '';
    if (coordText) {
      coordText.textContent = Number.isFinite(lat) && Number.isFinite(lon)
        ? `${lat.toFixed(6)}, ${lon.toFixed(6)}`
        : 'Sin coordenadas';
    }

    const extraKeys = ['material', 'tipo_poste', 'altura', 'altura_m', 'height'];
    const extraRows = extraKeys
      .filter((key) => instProps[key] != null && instProps[key] !== '')
      .map((key) => {
        const labels = { material: 'Material', tipo_poste: 'Tipo de poste', altura: 'Altura', altura_m: 'Altura (m)', height: 'Altura' };
        return `
          <div class="prop-field">
            <label>${labels[key] || key}</label>
            <input data-prop-key="${key}" value="${escapeHtml(instProps[key])}">
          </div>
        `;
      })
      .join('');
    if (extra) extra.innerHTML = extraRows;

    const meta = document.getElementById('prop-meta-line');
    if (meta) {
      meta.innerHTML = `Registro — ID <b>#${props.id}</b> · ${escapeHtml(CAT_LABELS[cat] || cat)} · plantilla <b>${escapeHtml(tipoNombre)}</b>`;
    }

    const thumb = document.getElementById('prop-pole-thumbnail');
    const thumbWrap = document.getElementById('prop-thumb-wrap');
    const photoSrc = props.foto_url || props.foto || instProps.image || '';
    if (thumb) {
      thumb.src = photoSrc;
      thumbWrap?.classList.toggle('has-photo', Boolean(photoSrc));
    }
    const poleTitle = document.getElementById('prop-pole-info-title');
    const poleDesc = document.getElementById('prop-pole-info-desc');
    if (poleTitle) poleTitle.textContent = `Vista de Terreno (${tipoNombre})`;
    if (poleDesc) poleDesc.textContent = instProps.notes || 'Captura adjunta durante levantamiento de red física.';

    loadPropHistory(props.id);
    loadPropPhotos(props.id);

    modal.onclick = (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    };

    modal.classList.remove('hidden');
    switchPropTab('info', true);
    requestAnimationFrame(() => {
      placePropIndicator();
      fitPropPagesHeight();
    });
  }

  function switchPropTab(tabId, instant) {
    const tabs = Array.from(document.querySelectorAll('#element-properties-modal .prop-tab-button'));
    const pages = Array.from(document.querySelectorAll('#element-properties-modal .prop-page'));
    const wrap = document.getElementById('prop-pages');
    const nextIndex = tabs.findIndex((t) => t.dataset.propTab === tabId);
    if (nextIndex < 0 || !wrap) return;

    const currentIndex = tabs.findIndex((t) => t.dataset.propTab === _propTabId);
    if (!instant && (tabId === _propTabId || _propTabAnimating)) return;

    tabs.forEach((t) => t.classList.toggle('active', t.dataset.propTab === tabId));
    placePropIndicator();

    if (instant || currentIndex < 0) {
      pages.forEach((page, i) => {
        page.classList.toggle('current', i === nextIndex);
        page.style.display = i === nextIndex ? 'block' : 'none';
        page.style.opacity = '1';
        page.style.transform = 'none';
      });
      _propTabId = tabId;
      fitPropPagesHeight();
      return;
    }

    const out = pages[currentIndex];
    const inn = pages[nextIndex];
    if (!out || !inn) return;

    _propTabAnimating = true;
    _propTabId = tabId;
    wrap.style.height = `${Math.max(out.offsetHeight, inn.offsetHeight)}px`;

    out.style.transition = 'transform .22s cubic-bezier(.55,.06,.68,.19), opacity .22s';
    out.style.transform = 'translateX(-48px)';
    out.style.opacity = '0';

    inn.style.display = 'block';
    inn.style.transition = 'none';
    inn.style.transform = 'translateX(48px)';
    inn.style.opacity = '0';

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        inn.style.transition = 'transform .22s cubic-bezier(.22,.8,.3,1), opacity .22s';
        inn.style.transform = 'translateX(0)';
        inn.style.opacity = '1';
      });
    });

    setTimeout(() => {
      out.classList.remove('current');
      inn.classList.add('current');
      out.style.display = 'none';
      out.style.transition = 'none';
      out.style.transform = 'none';
      out.style.opacity = '1';
      fitPropPagesHeight();
      _propTabAnimating = false;
    }, 240);
  }

  async function loadPropHistory(elemId) {
    const list = document.getElementById('prop-timeline-list');
    const count = document.getElementById('prop-history-count');
    if (!list) return;
    const empty = '<li><span class="prop-dot"></span><div>Sin historial<div class="prop-when">Aún no hay cambios registrados.</div></div></li>';
    try {
      const res = await fetch(apiUrl(`/api/elementos/${elemId}/historial`));
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) {
        list.innerHTML = empty;
        if (count) count.textContent = '0';
        return;
      }
      if (count) count.textContent = String(data.length);
      list.innerHTML = data.map((h) => `
        <li>
          <span class="prop-dot"></span>
          <div>${escapeHtml(h.accion || h.title || 'Actualización')}
            <div class="prop-when">${escapeHtml(h.fecha || h.date || '')}${h.dispositivo || h.user ? ' · ' + escapeHtml(h.dispositivo || h.user) : ''}</div>
          </div>
        </li>
      `).join('');
    } catch (e) {
      list.innerHTML = empty;
      if (count) count.textContent = '0';
    }
    fitPropPagesHeight();
  }

  async function loadPropPhotos(elemId) {
    const grid = document.getElementById('prop-photos-grid');
    const count = document.getElementById('prop-photos-count');
    const files = document.getElementById('prop-preview-files');
    if (!grid) return;
    const addTile = '<div class="prop-photo add"><span>+ Adjuntar foto</span></div>';
    try {
      const res = await fetch(apiUrl(`/api/elementos/${elemId}/fotos`));
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) {
        grid.innerHTML = addTile;
        if (count) count.textContent = '0';
        if (files) files.textContent = 'Sin archivos fotográficos';
        return;
      }
      if (count) count.textContent = String(data.length);
      if (files) files.textContent = `${data.length} archivo${data.length === 1 ? '' : 's'} fotográfico${data.length === 1 ? '' : 's'} disponible${data.length === 1 ? '' : 's'}`;
      grid.innerHTML = data.map((url) => `
        <div class="prop-photo"><img src="${escapeHtml(url)}" alt=""></div>
      `).join('') + addTile;
    } catch (e) {
      grid.innerHTML = addTile;
      if (count) count.textContent = '0';
      if (files) files.textContent = 'Sin archivos fotográficos';
    }
    fitPropPagesHeight();
  }

  async function guardarPropiedadesElemento() {
    if (!_activePropElemId) return;
    const esFtth = _currentFeatures.some(f => f.properties && f.properties.id === _activePropElemId);
    if (!esFtth) return;
    const modal = document.getElementById('element-properties-modal');
    const fields = document.querySelectorAll('#element-properties-modal [data-prop-key]');

    let lat = null;
    let lon = null;
    const instProps = {};

    fields.forEach(input => {
      const key = input.dataset.propKey;
      const val = input.value.trim();

      if (!key) return;
      if (key === 'lat') lat = Number(val);
      else if (key === 'lon') lon = Number(val);
      else if (key !== 'id' && key !== 'categoria' && key !== 'tipo_nombre') {
        instProps[key.replace(/^inst_/, '')] = val;
      }
    });

    const body = {};
    if (lat !== null && !isNaN(lat)) body.lat = lat;
    if (lon !== null && !isNaN(lon)) body.lon = lon;
    if (Object.keys(instProps).length) body.propiedades_instancia = instProps;

    try {
      if (window.FTTHTipos) FTTHTipos.showToast('Guardando propiedades...', 'info');

      const res = await fetch(apiUrl(`/api/elementos/${_activePropElemId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Error ${res.status}`);

      if (lat !== null && lon !== null) {
        _currentFeatures = _currentFeatures.map(f => {
          if (f.properties && f.properties.id === _activePropElemId) {
            return {
              ...f,
              geometry: { type: 'Point', coordinates: [lon, lat] },
              properties: {
                ...f.properties,
                propiedades_instancia: { ...(f.properties.propiedades_instancia || {}), ...instProps }
              }
            };
          }
          return f;
        });
        const src = getMap()?.getSource('ftth-elementos');
        if (src) src.setData({ type: 'FeatureCollection', features: _currentFeatures });
      }

      if (modal) modal.classList.add('hidden');
      if (window.FTTHCarpetas) FTTHCarpetas.loadCarpetas();
      if (window.FTTHTipos) FTTHTipos.showToast('✓ Propiedades guardadas', 'success');
    } catch (err) {
      if (window.FTTHTipos) FTTHTipos.showToast('Error guardando: ' + err.message, 'error');
    }
  }

  // ── Inicialización ────────────────────────────────────────────────────────
  let _initialized = false;

  function init() {
    const map = getMap();
    if (!map) {
      console.error('FTTHMapa.init(): window.map no está disponible!');
      return;
    }

    // Evitar doble inicialización
    if (_initialized) {
      console.log('FTTHMapa.init(): ya inicializado, re-registrando handlers...');
    }
    _initialized = true;

    console.log('FTTHMapa.init(): inicializando handlers de clic...');

    initContextMenu();
    bindPropModalChrome();

    // Registrar eventos de clic en MapLibre (método estándar)
    map.off('click', handleMapClick);
    map.on('click', handleMapClick);
    map.off('dblclick', handleMapDblClick);
    map.on('dblclick', handleMapDblClick);

    document.removeEventListener('project-changed', cargarTodosElementos);
    document.addEventListener('project-changed', cargarTodosElementos);

    if (map && typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) {
      cargarTodosElementos();
    } else {
      map.once('load', cargarTodosElementos);
    }
  }

  async function eliminarElementoDirecto(id) {
    _currentFeatures = _currentFeatures.filter(f => f.properties.id !== Number(id));
    const src = getMap()?.getSource('ftth-elementos');
    if (src) src.setData({ type: 'FeatureCollection', features: _currentFeatures });
    const res = await fetch(apiUrl(`/api/elementos/${id}`), { method: 'DELETE' });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    _updateStats();
  }

  return {
    init,
    cargarTodosElementos,
    seleccionarObjeto,
    activarModoColocacion,
    desactivarModoColocacion,
    cerrarPickerModal,
    mostrarPickerDeTipos,
    eliminarElementoDirecto,
    guardarPropiedadesElemento,
    switchPropTab,
    loadPropHistory,
    loadPropPhotos,
    showPropertiesModal
  };

})();

window.FTTHMapa = FTTHMapa;
