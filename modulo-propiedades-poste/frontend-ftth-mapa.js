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
    splitter:  { nombre: 'Splitter 1x8',     color: '#f97316', props: { relacion_division: '1x8 (10.7 dB)', tipo_conector: 'SC/APC' } }
  };

  const CAT_LABELS = {
    poste: 'Poste',
    cajanap: 'Caja NAP',
    manga: 'Manga',
    ducto: 'Ducto',
    luminaria: 'Luminaria',
    odf: 'ODF',
    olt: 'OLT',
    splitter: 'Splitter'
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

    // 3. Etiquetas de Texto en el Mapa con Iconos Replicados
    if (!map.getLayer('ftth-labels-layer')) {
      map.addLayer({
        id: 'ftth-labels-layer',
        type: 'symbol',
        source: srcId,
        filter: ['!=', ['get', 'categoria'], 'ducto'],
        layout: {
          'text-field': [
            'concat',
            ['match', ['get', 'categoria'],
              'poste', '🪵 ',
              'cajanap', '📦 ',
              'manga', '🗜️ ',
              'luminaria', '💡 ',
              'odf', '🗄️ ',
              'olt', '🖥️ ',
              'splitter', '🔀 ',
              '📍 '
            ],
            ['get', 'tipo_nombre'], ' #', ['to-string', ['get', 'id']]
          ],
          'text-size': 12,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      });
    }

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
          <span class="catalog-swatch" style="background-color: ${color}; width: 14px; height: 14px; border-radius: 50%; display: inline-block; flex-shrink:0;"></span>
          <div style="flex:1; min-width:0;">
            <strong>${t.nombre_id}</strong>
            <small style="display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${propsSummary || 'Sin propiedades adicionales'}</small>
          </div>
          <span style="font-size:11px; background:#2563eb; color:#fff; padding:3px 8px; border-radius:4px; font-weight:600; flex-shrink:0;">Usar 📍</span>
        </div>
      `;
    }).join('');

    modal.innerHTML = `
      <div class="type-picker-card">
        <div class="type-picker-header">
          <span>📦 Selecciona el tipo de ${catLabel}</span>
          <button type="button" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;line-height:1;" onclick="FTTHMapa.cerrarPickerModal()">✕</button>
        </div>
        <div class="picker-tipos-list">
          ${itemsHtml}
        </div>
        <div style="padding: 9px 10px; border-top: 1px solid var(--border-light); background: #f8fafc; display:flex; gap:8px;">
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
        ? `🛠️ Ducto: Clic para marcar puntos, doble clic para terminar trazado`
        : `📍 ${tipoNombre}: Haz clic en el mapa para colocar el objeto`
    );

    if (window.FTTHTipos) {
      FTTHTipos.showToast(`✅ Modo activo: ${tipoNombre}. Haz clic en el mapa.`, 'success');
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

  function showPlacementHint(msg) {
    let hint = document.getElementById('ftth-placement-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'ftth-placement-hint';
      hint.className = 'placement-hint';
      document.getElementById('map-container').appendChild(hint);
    }
    hint.textContent = msg;
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

    showPlacementHint(`🎯 Moviendo ${props.tipo_nombre || props.categoria} #${props.id}: Haz clic en la nueva ubicación del mapa`);

    if (window.FTTHTipos) {
      FTTHTipos.showToast(`🎯 Modo Mover activo para #${props.id}. Haz clic en la nueva ubicación.`, 'info');
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
        showPlacementHint('🛠️ Ducto: Clic para añadir puntos, doble clic para finalizar');
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

  function showPropertiesModal(props, geometry) {
    const modal = document.getElementById('element-properties-modal');
    const fields = document.getElementById('element-properties-fields');
    const title = document.getElementById('prop-modal-title');
    const badge = document.getElementById('prop-header-badge');
    if (!modal || !fields) return;

    _activePropElemId = props.id;

    if (title) {
      const cat = props.categoria || 'Objeto';
      const iconoMap = { poste: '🪵', cajanap: '📦', manga: '🗜️', ducto: '🛠️', luminaria: '💡', odf: '🗄️', olt: '🖥️', splitter: '🔀' };
      title.textContent = `${iconoMap[cat] || '📍'} ${props.tipo_nombre || cat} #${props.id}`;
    }
    if (badge) {
      badge.textContent = (props.categoria || 'ACTIVO').toUpperCase();
    }

    const displayFields = [];

    // Coordenadas
    if (geometry && geometry.coordinates && geometry.type === 'Point') {
      const [lon, lat] = geometry.coordinates;
      displayFields.push({ key: 'lat', label: 'Latitud', value: Number(lat).toFixed(6), editable: true });
      displayFields.push({ key: 'lon', label: 'Longitud', value: Number(lon).toFixed(6), editable: true });
    } else if (props.lat && props.lon) {
      displayFields.push({ key: 'lat', label: 'Latitud', value: Number(props.lat).toFixed(6), editable: true });
      displayFields.push({ key: 'lon', label: 'Longitud', value: Number(props.lon).toFixed(6), editable: true });
    }

    // Datos principales
    displayFields.push({ key: 'id', label: 'ID', value: props.id, editable: false });
    displayFields.push({ key: 'categoria', label: 'Categoría', value: props.categoria, editable: false });
    displayFields.push({ key: 'tipo_nombre', label: 'Tipo / Plantilla', value: props.tipo_nombre || '', editable: false });

    // Solo mostrar propiedades reales de la instancia. Algunas respuestas antiguas
    // contienen arrays o claves numéricas que no representan campos editables.
    let instProps = props.propiedades_instancia;
    if (typeof instProps === 'string') {
      try {
        instProps = JSON.parse(instProps);
      } catch {
        instProps = {};
      }
    }
    if (!instProps || Array.isArray(instProps) || typeof instProps !== 'object') {
      instProps = {};
    }
    const allowedInstanceKeys = new Set([
      'material', 'tipo_poste', 'altura', 'altura_m', 'height',
      'notes', 'observaciones', 'estado', 'color'
    ]);
    Object.entries(instProps).forEach(([key, value]) => {
      if (!allowedInstanceKeys.has(key) || /^\d+$/.test(key) || value === null || value === undefined || value === '') return;
      const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (!displayValue || displayValue === '{}') return;
      displayFields.push({ key: `inst_${key}`, label: key, value: displayValue, editable: true });
    });

    const rows = displayFields.map(f => `
      <div style="display:flex; flex-direction:column; gap:2px;">
        <span class="prop-form-label">${f.label}</span>
        <input data-prop-key="${f.key}" value="${f.value ?? ''}" ${f.editable ? '' : 'readonly'} class="prop-form-control">
      </div>
    `).join('');

    fields.innerHTML = rows;

    // Miniatura
    const thumb = document.getElementById('prop-pole-thumbnail');
    const poleTitle = document.getElementById('prop-pole-info-title');
    const poleDesc = document.getElementById('prop-pole-info-desc');
    if (thumb) thumb.src = props.foto_url || '';
    if (poleTitle) poleTitle.textContent = `Vista de Terreno (${props.tipoNombre || props.tipo_nombre || 'Elemento'})`;
    if (poleDesc) poleDesc.textContent = (props.propiedades_instancia && props.propiedades_instancia.notes) || 'Captura adjunta durante levantamiento de red.';

    // Cargar historial y fotos
    loadPropHistory(props.id);
    loadPropPhotos(props.id);

    // Resetear a pestaña info
    switchPropTab('info');

    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    };

    modal.classList.remove('hidden');
  }

  function switchPropTab(tabId) {
    document.querySelectorAll('.prop-tab-button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.propTab === tabId);
    });

    document.querySelectorAll('.prop-tab-content').forEach(tab => {
      const isActive = tab.id === `prop-tab-${tabId}`;
      if (isActive) {
        // Primero ocultar la animación anterior quitando la clase
        tab.classList.remove('active', 'prop-tab-fade-in');
        // Forzar reflow
        void tab.offsetWidth;
        // Activar animación y visibilidad
        tab.classList.add('active', 'prop-tab-fade-in');
      } else {
        tab.classList.remove('active', 'prop-tab-fade-in');
      }
    });
  }

  async function loadPropHistory(elemId) {
    const list = document.getElementById('prop-timeline-list');
    if (!list) return;
    try {
      const res = await fetch(apiUrl(`/api/elementos/${elemId}/historial`));
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) {
        list.innerHTML = '<li class="prop-timeline-item"><span class="prop-timeline-dot"></span><div class="prop-timeline-title">Sin historial</div><div class="prop-timeline-meta">Aún no hay cambios registrados.</div></li>';
        return;
      }
      list.innerHTML = data.map(h => `
        <li class="prop-timeline-item">
          <span class="prop-timeline-dot"></span>
          <div class="prop-timeline-title">${h.accion || h.title || 'Actualización'}</div>
          <div class="prop-timeline-meta">
            ${h.fecha || h.date || ''} ${h.fecha ? '·' : ''} ${h.dispositivo || h.user || ''}
          </div>
        </li>
      `).join('');
    } catch (e) {
      list.innerHTML = '<li class="prop-timeline-item"><span class="prop-timeline-dot"></span><div class="prop-timeline-title">Error cargando historial</div></li>';
    }
  }

  async function loadPropPhotos(elemId) {
    const grid = document.getElementById('prop-photos-grid');
    if (!grid) return;
    try {
      const res = await fetch(apiUrl(`/api/elementos/${elemId}/fotos`));
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) {
        grid.innerHTML = '<div class="prop-placeholder-tab"><i data-lucide="camera" style="width:40px;height:40px;margin-bottom:12px;"></i><p style="font-weight:700;font-size:14px;text-transform:uppercase;">SIN FOTOS</p><p style="font-size:13px;margin-top:4px;">No hay fotografías registradas.</p></div>';
        return;
      }
      grid.innerHTML = data.map(url => `
        <div style="border:1px solid #0f172a;padding:6px;background:#f8fafc;">
          <img src="${url}" style="width:100%;height:140px;object-fit:cover;display:block;">
        </div>
      `).join('');
    } catch (e) {
      grid.innerHTML = '<div class="prop-placeholder-tab"><p>Error cargando fotos</p></div>';
    }
  }

  async function guardarPropiedadesElemento() {
    if (!_activePropElemId) return;
    const modal = document.getElementById('element-properties-modal');
    const fields = document.querySelectorAll('#element-properties-fields input[data-prop-key]');

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
