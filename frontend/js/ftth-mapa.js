/**
 * ftth-mapa.js
 * Capas MapLibre, colocación directa de elementos, persistencia en BD y sincronización en tiempo real.
 */

const FTTHMapa = (() => {

  // ── Estado ────────────────────────────────────────────────────────────────
  let _modoActivo = null;        // { categoria, tipoId, tipoNombre, color }
  let _modoSimple = false;       // true = se coloca UN solo objeto (modo "+" del dock)
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
        filter: ['all', ['!=', ['get', 'categoria'], 'ducto'], ['!=', ['get', 'categoria'], 'cables']],
        layout: {
          // Ícono SVG del tipo (registrado por FTTHIconos.registrarEnMapa)
          'icon-image': ['concat', 'ftth-ico-', ['get', 'categoria']],
          'icon-size': 0.34,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-offset': [0, -10],
          'icon-anchor': 'bottom',
          // Etiqueta de texto con el nombre y el ID
          // En los objetos aún no confirmados no se muestra el id temporal
          'text-field': ['case',
            ['has', 'pendiente'], ['get', 'tipo_nombre'],
            ['concat', ['get', 'tipo_nombre'], ' #', ['to-string', ['get', 'id']]]],
          'text-size': 12,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
          // Opacidad directa (el estilo ya tiene transition: 0, sin fundidos)
          'icon-opacity': 1,
          'text-opacity': 1,
        },
      });

      // El ícono del tipo es el que recibe el cursor y el clic derecho
      _bindLayerInteractions(map, ['ftth-labels-layer']);
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

    // 1. Capa Ductos (Líneas punteadas)
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
          'line-opacity': 1,
        },
      });
    }

    // 1b. Capa Cables (Líneas sólidas)
    if (!map.getLayer('ftth-cables-layer')) {
      map.addLayer({
        id: 'ftth-cables-layer',
        type: 'line',
        source: srcId,
        filter: ['==', ['get', 'categoria'], 'cables'],
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#0284c7'],
          'line-width': 4,
          'line-opacity': 1,
        },
      });
    }

    // 2. Íconos de cada tipo de objeto (fuente única: FTTHIconos).
    //    Nota: aquí había una capa 'ftth-puntos-layer' (círculo de color) que
    //    se eliminó: ahora cada objeto se ve SOLO con su ícono.
    _addLabelsLayerWhenReady(map, srcId);

    // Cursor y menú contextual de los ductos y cables (las etiquetas lo enlazan al crearse)
    _bindLayerInteractions(map, ['ftth-ductos-layer', 'ftth-cables-layer']);
  }

  // ── Prompt para finalizar cable ───────────────────────────────────────────
  function showReservaPrompt(onConfirm) {
    let prompt = document.getElementById('ftth-reserva-prompt');
    if (prompt) prompt.remove();

    prompt = document.createElement('div');
    prompt.id = 'ftth-reserva-prompt';
    prompt.className = 'trace-finish-prompt';
    prompt.innerHTML = `
      <span>Culminar trazado, por favor indicar reserva</span>
      <input type="number" id="reserva-input" placeholder="ejm de 30m" min="0" step="1">
      <button id="reserva-btn">Guardar</button>
    `;
    document.body.appendChild(prompt);

    const input = prompt.querySelector('#reserva-input');
    const btn = prompt.querySelector('#reserva-btn');
    input.focus();

    const finish = () => {
      const val = parseFloat(input.value) || 0;
      prompt.remove();
      onConfirm(val);
    };

    btn.addEventListener('click', finish);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish();
      if (e.key === 'Escape') prompt.remove(); // Cancels prompt but doesn't abort trace entirely unless handled
    });
  }

  // Cursor y menú contextual sobre una o varias capas
  function _bindLayerInteractions(map, layerIds) {
    layerIds.forEach(layerId => {
      map.on('contextmenu', layerId, e => {
        e.preventDefault();
        _ctxFeature = e.features && e.features[0];
        
        if (_modoActivo && _modoActivo.categoria === 'cables' && _pendingLine.length > 0) {
           if (!_ctxFeature || !_ctxFeature.properties || !_ctxFeature.geometry) {
             if (window.FTTHTipos) FTTHTipos.showToast('Haz clic derecho directamente sobre el ícono de la caja para anclar', 'warning');
             return;
           }
           const cat = (_ctxFeature.properties.categoria || '').toLowerCase();
           if (['cajanap', 'manga', 'odf', 'olt'].includes(cat)) {
              
              const ptLng = _ctxFeature.geometry.coordinates[0];
              const ptLat = _ctxFeature.geometry.coordinates[1];
              _pendingLine.push([ptLng, ptLat]);
              
              const targetNodeId = _ctxFeature.properties.id;
              const { tipoId, tipoNombre, color, nodoInicioId } = _modoActivo;
              const lineToSave = [..._pendingLine];
              
              _removeDuctPreview();
              _pendingLine = [];
              desactivarModoColocacion();

              showReservaPrompt((reservaVal) => {
                if (window.FTTHTipos) FTTHTipos.showToast(`Anclando fibra a ${cat} #${targetNodeId}...`, 'info');
                colocarDucto(tipoId, tipoNombre, lineToSave, color, 'cables', targetNodeId, nodoInicioId, reservaVal);
              });
              
              return;
           } else {
              if (window.FTTHTipos) FTTHTipos.showToast('Solo puedes anclar (finalizar) la fibra en una caja, manga u OLT', 'warning');
              return;
           }
        }
        
        showContextMenu(e.point, e.lngLat);
      });
      map.on('mouseenter', layerId, () => {
        if (!_modoActivo) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        if (!_modoActivo) map.getCanvas().style.cursor = '';
      });
      // Clic izquierdo: muestra un pequeño popup (recuadro) con las propiedades del objeto.
      // EXCEPCIÓN: si hay modo cables activo, el clic en el layer PROPAGA a handleMapClick
      map.on('click', layerId, e => {
        if (_modoMover) return;
        if (_modoActivo) {
          if (_modoActivo.categoria === 'cables') {
            e._layerFeature = e.features && e.features[0];
            handleMapClick(e);
          }
          return;
        }
        const feature = e.features && e.features[0];
        if (!feature || !feature.properties) return;
        
        showPropertiesPopup(feature, e.lngLat);
      });
    });
  }

  // ── Popup de Propiedades (Clic Izquierdo) ──────────────────────────────────
  let _activePopup = null;
  function showPropertiesPopup(feature, lngLat) {
    const map = getMap();
    if (!map) return;
    if (_activePopup) _activePopup.remove();

    const props = feature.properties || {};
    const cat = props.categoria || 'elemento';
    const id = props.id;
    const instProps = parseInstProps(props.propiedades_instancia);
    const tipoProps = parseInstProps(props.propiedades_tipo);
    
    const nombre = instProps.nombre || instProps.name || props.tipo_nombre || cat;
    const codigo = tipoProps.codigo || props.tipo_nombre || 'N/A';
    const descripcion = instProps.descripcion || instProps.desc || tipoProps.descripcion || tipoProps.desc || 'Sin descripción';
    
    const lat = lngLat.lat.toFixed(5);
    const lng = lngLat.lng.toFixed(5);

    const allProps = { ...tipoProps, ...instProps };
    const ignoreKeys = ['name', 'nombre', 'estado', 'color', 'etiquetas', 'tipo_poste', 'codigo', 'desc', 'descripcion'];
    
    let extraHtml = '';
    if (instProps.reserva_m) {
      extraHtml += `<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="color:#86868b;">Reserva:</span><span style="font-weight:500;">${instProps.reserva_m}m</span></div>`;
    }
    
    Object.entries(allProps).forEach(([k, v]) => {
      const keyLower = k.toLowerCase();
      if (!ignoreKeys.includes(keyLower) && v !== null && v !== '') {
        const formattedKey = k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
        extraHtml += `<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="color:#86868b;">${formattedKey}:</span><span style="font-weight:500; text-align:right; max-width:60%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${v}">${v}</span></div>`;
      }
    });

    const div = document.createElement('div');
    div.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    div.style.width = '230px';
    div.style.color = '#1d1d1f';
    div.style.padding = '4px';

    div.innerHTML = `
      <div style="font-size:14px; font-weight:600; margin-bottom:8px; border-bottom:1px solid #e5e5e5; padding-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${nombre}</span>
        <span style="color:#86868b; font-weight:400; font-size:12px;">#${id}</span>
      </div>
      
      <div style="font-size:12px; line-height:1.5;">
        <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
          <span style="color:#86868b;">Código:</span>
          <span style="font-weight:500; text-align:right; max-width:65%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${codigo}">${codigo}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
          <span style="color:#86868b;">Coordenadas:</span>
          <span style="font-weight:500;">${lat}, ${lng}</span>
        </div>
        <div style="margin-top:6px; margin-bottom:6px;">
          <span style="color:#86868b; display:block; margin-bottom:2px;">Descripción:</span>
          <span style="font-weight:500; display:block; color:#1d1d1f;">${descripcion}</span>
        </div>
      </div>

      ${extraHtml ? `<div style="border-top:1px solid #e5e5e5; padding-top:6px; margin-top:6px; font-size:12px; line-height:1.5;">${extraHtml}</div>` : ''}

      ${tieneDiagrama(cat) ? `<button onclick="window.FTTHMapa.abrirDiagramaGlobal('${id}', '${cat}', '${props.tipo_nombre || cat}')" style="margin-top:12px; width:100%; background:#1d1d1f; color:#fff; border:none; padding:8px 0; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer; transition:background 0.2s;">Abrir Diagrama</button>` : ''}
    `;

    _activePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, maxWidth: '260px' })
      .setLngLat(lngLat)
      .setDOMContent(div)
      .addTo(map);
  }

  // Permite abrir el diagrama desde el botón del popup HTML inyectado
  function abrirDiagramaGlobal(id, categoria, tipoNombre) {
    if (_activePopup) _activePopup.remove();
    if (window.FTTHDiagrama && window.FTTHDiagrama.abrir) {
      window.FTTHDiagrama.abrir(id, { categoria, tipoNombre });
    }
  }

  // ── Diagrama lógico del nodo (F3) ─────────────────────────────────────────
  const CATEGORIAS_CON_DIAGRAMA = ['cajanap', 'manga', 'odf', 'armario', 'olt', 'splitter', 'fusion'];

  function tieneDiagrama(categoria) {
    return CATEGORIAS_CON_DIAGRAMA.includes(String(categoria || '').toLowerCase());
  }

  function abrirDiagramaDelElemento(props, geometry) {
    if (!props || !tieneDiagrama(props.categoria)) return false;
    if (window.FTTHDiagrama && window.FTTHDiagrama.abrir) {
      window.FTTHDiagrama.abrir(props.id, {
        categoria: props.categoria,
        tipoNombre: props.tipo_nombre,
      });
      return true;
    }
    // Fallback
    showPropertiesModal(props, geometry);
    return false;
  }

  // Vuelca las features en memoria al source de MapLibre
  function _setFeatureData() {
    const src = getMap()?.getSource('ftth-elementos');
    if (src) src.setData({ type: 'FeatureCollection', features: _currentFeatures });
  }

  // Feature provisional para pintar el objeto en el mismo clic,
  // sin esperar la respuesta del servidor (se sustituye al confirmarse).
  function _featureProvisional(categoria, tipoId, tipoNombre, color, geometry) {
    return {
      type: 'Feature',
      geometry: geometry,
      properties: {
        id: 'tmp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        pendiente: true,
        categoria: categoria,
        tipo_id: tipoId,
        tipo_nombre: tipoNombre || categoria,
        color: color || '#1d68bd',
        propiedades_tipo: {},
        propiedades_instancia: {},
      },
    };
  }

  // Sustituye la provisional por la feature confirmada del servidor
  function _replaceFeature(tempId, feature) {
    let encontrada = false;
    _currentFeatures = _currentFeatures.map(f => {
      if (f.properties && f.properties.id === tempId) { encontrada = true; return feature; }
      return f;
    });
    if (!encontrada) _currentFeatures.push(feature);
    _setFeatureData();
    _updateStats();
  }

  // Descarta la provisional si el guardado falló
  function _quitarFeature(tempId) {
    _currentFeatures = _currentFeatures.filter(f => !(f.properties && f.properties.id === tempId));
    _setFeatureData();
    _updateStats();
  }

  function _addFeatureToMap(feature) {
    const map = getMap();
    if (!map) return;
    _currentFeatures.push(feature);
    if (map.getSource('ftth-elementos')) {
      _setFeatureData();
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

    const modoTxt = _modoSimple ? '1 objeto' : 'varios objetos';
    showPlacementHint(
      categoria === 'ducto'
        ? `Ducto (${modoTxt}): clic para marcar puntos, doble clic para terminar`
        : `${tipoNombre} (${modoTxt}): haz clic en el mapa`,
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

    // ANTI-DOBLE-DISPARO: MapLibre dispara el click en el layer Y luego el global.
    // Para el modo cables: si este es el click global (sin _layerFeature) y ya fue
    // procesado por el layer handler (flag _maplibreClickHandled), ignorarlo.
    if (_modoActivo && _modoActivo.categoria === 'cables' && !e._layerFeature && _maplibreClickHandled) {
      return;
    }

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

    const { categoria, tipoId, tipoNombre, color } = _modoActivo;
    console.log('Clic en mapa capturado (MapLibre):', { categoria, tipoId, tipoNombre, lng, lat });

    if (categoria === 'ducto' || categoria === 'cables') {
      let ptLng = lng;
      let ptLat = lat;
      let elemClicked = null;

      if (categoria === 'cables') {
        const map = getMap();
        if (map) {
          // Primero intentar usar la feature ya resuelta por el layer click handler
          let feat = e._layerFeature || null;
          
          console.log('[CABLE] clic - _layerFeature:', feat ? `${feat.properties.categoria}#${feat.properties.id}` : 'null');

          // Si no hay feature del layer, intentar con bbox (clic en área vacía)
          if (!feat) {
            const bbox = [
              [e.point.x - 14, e.point.y - 14],
              [e.point.x + 14, e.point.y + 14]
            ];
            const nearby = map.queryRenderedFeatures(bbox, { layers: ['ftth-labels-layer'] });
            feat = nearby.length ? nearby[0] : null;
            console.log('[CABLE] bbox query encontró:', feat ? `${feat.properties.categoria}#${feat.properties.id}` : 'nada');
          }
          
          if (!feat) {
            if (window.FTTHTipos) FTTHTipos.showToast('Haz clic directamente sobre el ícono de un poste o caja para trazar la ruta', 'warning');
            return;
          }
          
          const catClic = (feat.properties.categoria || '').toLowerCase();
          console.log('[CABLE] categoría del nodo clickeado:', catClic);
          if (!['poste', 'cajanap', 'manga', 'odf', 'olt'].includes(catClic)) {
            if (window.FTTHTipos) FTTHTipos.showToast('La fibra solo puede pasar por postes, cajas NAP, mangas, ODF u OLT', 'warning');
            return;
          }
          
          // Usar las coordenadas exactas del poste/caja
          if (feat.geometry && feat.geometry.type === 'Point') {
            ptLng = feat.geometry.coordinates[0];
            ptLat = feat.geometry.coordinates[1];
          }
          
          if (_pendingLine.length === 0) {
            _modoActivo.nodoInicioId = feat.properties.id;
            console.log('[CABLE] Nodo inicio fijado:', feat.properties.id);
          }
          console.log('[CABLE] punto añadido, total puntos:', _pendingLine.length + 1);
        }
      }

      _pendingLine.push([ptLng, ptLat]);
      
      if (_pendingLine.length === 1) {
        if (categoria === 'ducto') {
          showPlacementHint('Ducto: Clic para añadir puntos, doble clic para finalizar', 'ducto');
        } else {
          showPlacementHint('Cable: Haz clic en postes. Clic derecho en una caja para "Anclar fibra a caja"', 'cables');
        }
      }
      _updateDuctPreview();
      return;
    }

    // Colocar elemento puntual (se pinta al instante y se confirma con el servidor)
    colocarElemento(categoria, tipoId, tipoNombre, { lat, lon: lng }, color);
  }

  function handleMapDblClick(e) {
    if (!_modoActivo || _modoActivo.categoria !== 'ducto') return;
    e.preventDefault();
    if (_pendingLine.length < 2) {
      if (window.FTTHTipos) FTTHTipos.showToast('Un ducto necesita al menos 2 puntos', 'error');
      return;
    }
    const { tipoId, tipoNombre, color } = _modoActivo;
    _removeDuctPreview();
    colocarDucto(tipoId, tipoNombre, [..._pendingLine], color);
    _pendingLine = [];
    desactivarModoColocacion();
  }

  function _updateDuctPreview() {
    const map = getMap();
    if (!map || _pendingLine.length < 1) return;
    const colorLinea = (_modoActivo && _modoActivo.color) ? _modoActivo.color : '#ff5722';
    
    const features = [];
    
    // Línea si hay 2 o más puntos
    if (_pendingLine.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: _pendingLine },
        properties: { tipo: 'linea' },
      });
    }
    
    // Punto(s) del primer y último nodo marcado (feedback visual)
    _pendingLine.forEach((pt, i) => {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pt },
        properties: { tipo: 'punto', primero: i === 0 },
      });
    });

    const data = { type: 'FeatureCollection', features };
    
    let src = map.getSource('ftth-duct-preview');
    if (!src) {
      map.addSource('ftth-duct-preview', { type: 'geojson', data });
    } else {
      src.setData(data);
    }
    
    // Garantizar que exista la capa de línea
    if (!map.getLayer('ftth-duct-preview-layer')) {
      const isCable = _modoActivo && _modoActivo.categoria === 'cables';
      map.addLayer({
        id: 'ftth-duct-preview-layer',
        type: 'line',
        source: 'ftth-duct-preview',
        filter: ['==', ['get', 'tipo'], 'linea'],
        paint: { 
          'line-color': colorLinea, 
          'line-width': 3, 
          'line-opacity': 1 
        }
      });
      // Set dasharray only if not a cable
      if (!isCable) {
        map.setPaintProperty('ftth-duct-preview-layer', 'line-dasharray', [3, 2]);
      }
    } else {
      // Actualizar el color por si cambió de ducto a cable
      map.setPaintProperty('ftth-duct-preview-layer', 'line-color', colorLinea);
      const isCable = _modoActivo && _modoActivo.categoria === 'cables';
      if (isCable) {
        map.setPaintProperty('ftth-duct-preview-layer', 'line-dasharray', undefined); // solid
      } else {
        map.setPaintProperty('ftth-duct-preview-layer', 'line-dasharray', [3, 2]); // dashed
      }
    }
    
    // Garantizar que exista la capa de puntos
    if (!map.getLayer('ftth-duct-preview-puntos')) {
      map.addLayer({
        id: 'ftth-duct-preview-puntos',
        type: 'circle',
        source: 'ftth-duct-preview',
        filter: ['==', ['get', 'tipo'], 'punto'],
        paint: {
          'circle-radius': 6,
          'circle-color': colorLinea,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 1,
        },
      });
    } else {
      map.setPaintProperty('ftth-duct-preview-puntos', 'circle-color', colorLinea);
    }
  }

  function _removeDuctPreview() {
    const map = getMap();
    if (!map) return;
    if (map.getLayer('ftth-duct-preview-puntos')) map.removeLayer('ftth-duct-preview-puntos');
    if (map.getLayer('ftth-duct-preview-layer')) map.removeLayer('ftth-duct-preview-layer');
    if (map.getSource('ftth-duct-preview')) map.removeSource('ftth-duct-preview');
  }

  // ── Guardado en Base de Datos de Elementos ────────────────────────────────
  async function colocarElemento(categoria, tipoId, tipoNombre, { lat, lon }, color) {
    if (!window.currentProjectId) {
      alert("⚠️ Selecciona un proyecto primero.");
      return;
    }

    // Sin plantilla (tipo) no se puede insertar: el backend exige tipo_id válido.
    if (!tipoId) {
      if (window.FTTHTipos) FTTHTipos.showToast('Elige una plantilla de tipo antes de colocar el objeto', 'error');
      desactivarModoColocacion();
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

    // 1) PINTADO INMEDIATO (optimista): el objeto se ve en el mismo clic,
    //    sin esperar la ida y vuelta al servidor ni re-renderizar la capa.
    const provisional = _featureProvisional(categoria, tipoId, tipoNombre, color,
      { type: 'Point', coordinates: [Number(lon), Number(lat)] });
    const tempId = provisional.properties.id;
    _addFeatureToMap(provisional);

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

      // 2) Confirmación del servidor: se sustituye la provisional (misma posición)
      const feature = await res.json();
      _replaceFeature(tempId, feature);

      // Recargar árbol de capas en el panel derecho inmediatamente
      if (window.FTTHCarpetas && FTTHCarpetas.loadCarpetas) {
        FTTHCarpetas.loadCarpetas();
      }

      if (window.FTTHTipos) {
        FTTHTipos.showToast(`✓ ${tipoNombre} agregado al mapa`, 'success');
      }

      // Modo "+" (un solo objeto): se cierra la burbuja sin recargar todo de nuevo
      if (_modoSimple) {
        document.dispatchEvent(new CustomEvent('ftth-objeto-colocado', { detail: { modoSimple: true } }));
        desactivarModoColocacion();
        _modoSimple = false;
      }
    } catch (err) {
      // 3) Si falla el guardado se retira el objeto provisional (no queda pintado)
      _quitarFeature(tempId);
      console.error('Error al colocar elemento:', err);
      if (window.FTTHTipos) FTTHTipos.showToast('Error al colocar: ' + err.message, 'error');
    }
  }

  async function colocarDucto(tipoId, tipoNombre, coords, color, cat_override = 'ducto', nodoFinId = null, nodoInicioId = null, reserva_m = null) {
    if (!window.currentProjectId) return;
    if (!tipoId) {
      if (window.FTTHTipos) FTTHTipos.showToast(`Elige una plantilla de tipo antes de dibujar el ${cat_override}`, 'error');
      return;
    }
    const propsInst = {};
    if (reserva_m !== null && reserva_m !== undefined && reserva_m !== '') {
      propsInst.reserva_m = reserva_m;
    }
    
    const body = {
      proyecto_id: Number(window.currentProjectId),
      tipo_id: tipoId,
      categoria: cat_override,
      coords_json: coords,
      propiedades_instancia: propsInst,
    };

    // Pintado inmediato del trazo (sin esperar al servidor)
    const provisional = _featureProvisional(cat_override, tipoId, tipoNombre, color,
      { type: 'LineString', coordinates: coords });
    const tempId = provisional.properties.id;
    _addFeatureToMap(provisional);

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
      _replaceFeature(tempId, feature);

      if (window.FTTHCarpetas && FTTHCarpetas.loadCarpetas) {
        FTTHCarpetas.loadCarpetas();
      }

      if (window.FTTHTipos) {
        FTTHTipos.showToast(`✓ ${cat_override === 'cables' ? 'Cable' : 'Ducto'} "${tipoNombre}" agregado`, 'success');
      }

      // Si es un cable de fibra, materializar sus hilos y anclar si corresponde
      if (cat_override === 'cables') {
        try {
          const mRes = await fetch(apiUrl(`/api/cables/${feature.properties.id}/materializar-hilos`), {
            method: 'POST'
          });
          if (mRes.ok) {
            console.log("Hilos materializados");
            if (nodoInicioId || nodoFinId) {
              const hRes = await fetch(apiUrl(`/api/cables/${feature.properties.id}/hilos`));
              if (hRes.ok) {
                const hData = await hRes.json();
                const promises = [];
                for (const t of hData.tubos) {
                  for (const h of t.hilos) {
                    if (nodoInicioId) {
                      promises.push(fetch(apiUrl(`/api/fibras/${h.id}/extremos/A`), {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nodo_id: nodoInicioId })
                      }));
                    }
                    if (nodoFinId) {
                      promises.push(fetch(apiUrl(`/api/fibras/${h.id}/extremos/B`), {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ nodo_id: nodoFinId })
                      }));
                    }
                  }
                }
                await Promise.allSettled(promises);
                console.log(`Extremos anclados: A=${nodoInicioId}, B=${nodoFinId}`);
              }
            }
          }
        } catch (e) {
          console.warn("Error materializando o anclando", e);
        }
      }

      // Modo "+" (un solo objeto): se cierra la burbuja
      if (_modoSimple) {
        document.dispatchEvent(new CustomEvent('ftth-objeto-colocado', { detail: { modoSimple: true } }));
        desactivarModoColocacion();
        _modoSimple = false;
      }
    } catch (err) {
      _quitarFeature(tempId);
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

    const instProps = parseInstProps(props.propiedades_instancia);
    let propsHtml = '';
    const ignoreKeys = ['name', 'nombre', 'estado', 'color', 'etiquetas', 'tipo_poste', 'reserva_m'];
    
    // Default general info
    propsHtml += `<div><strong>Tipo:</strong> ${props.tipo_nombre || cat}</div>`;
    
    if (instProps.reserva_m) {
      propsHtml += `<div><strong>Reserva:</strong> ${instProps.reserva_m}m</div>`;
    }
    
    Object.entries(instProps).forEach(([k, v]) => {
      if (!ignoreKeys.includes(k) && v !== null && v !== '') {
        const formattedKey = k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
        propsHtml += `<div><strong>${formattedKey}:</strong> ${v}</div>`;
      }
    });

    _ctxMenu.innerHTML = `
      <div class="ctx-header">${instProps.name || instProps.nombre || (props.tipo_nombre || cat)} #${id}</div>
      <div class="ctx-props-list">
        ${propsHtml}
      </div>
      <hr class="ctx-divider">
      ${tieneDiagrama(cat) ? `<button class="ctx-item" style="color: #0071e3; font-weight: 600;" data-action="diagrama">🧩 Abrir Diagrama</button>` : ''}
      <button class="ctx-item" data-action="move">🎯 Mover Objeto</button>
      <button class="ctx-item" data-action="properties">🔍 Editar Propiedades</button>
      <hr class="ctx-divider">
      <button class="ctx-item ctx-item-danger" data-action="delete">🗑️ Eliminar</button>
    `;

    _ctxMenu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
    _ctxMenu.style.top  = `${Math.min(y, window.innerHeight - 300)}px`;
    _ctxMenu.classList.remove('hidden');

    _ctxMenu.querySelectorAll('.ctx-item').forEach(btn => {
      btn.addEventListener('click', () => {
        hideContextMenu();
        const action = btn.dataset.action;
        if (action === 'delete') {
          eliminarElemento(id, props.tipo_nombre || cat);
        } else if (action === 'diagrama') {
          abrirDiagramaDelElemento(props, _ctxFeature.geometry);
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

    // Capa lógica (F2): pestaña "Hilos". Se oculta sola si el objeto no es un cable.
    if (window.FTTHHilos && window.FTTHHilos.cargar) window.FTTHHilos.cargar(props);

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

    // Clic derecho GLOBAL en el mapa (para anclar cables cuando se hace clic derecho en el icono)
    map.getCanvas().addEventListener('contextmenu', e => {
      e.preventDefault();
    }, { capture: false });

    // ESC para cancelar trazado de cable
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _modoActivo && _modoActivo.categoria === 'cables') {
        _removeDuctPreview();
        _pendingLine = [];
        desactivarModoColocacion();
        if (window.FTTHTipos) FTTHTipos.showToast('Trazado de cable cancelado', 'info');
      }
    });

    document.removeEventListener('project-changed', cargarTodosElementos);
    document.addEventListener('project-changed', cargarTodosElementos);

    if (map && typeof map.isStyleLoaded === 'function' && map.isStyleLoaded()) {
      cargarTodosElementos();
    } else {
      map.once('load', cargarTodosElementos);
    }
  }

  // ── Modo de colocación del dock ("+" = uno solo · "∞" = ilimitados) ──────
  function setModoSimple(soloUno) {
    _modoSimple = !!soloUno;
  }

  // Botón "Guardar" del dock: refresca desde el servidor, cierra el modo y anuncia
  async function guardarObjetos() {
    try {
      if (window.FTTHCarpetas && FTTHCarpetas.loadCarpetas) FTTHCarpetas.loadCarpetas();
      await cargarTodosElementos();
      _updateStats();
      desactivarModoColocacion();
      _modoSimple = false;
      if (window.FTTHTipos) FTTHTipos.showToast('✓ Objetos guardados correctamente', 'success');
    } catch (err) {
      if (window.FTTHTipos) FTTHTipos.showToast('Error al guardar: ' + err.message, 'error');
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
    setModoSimple,
    guardarObjetos,
    cerrarPickerModal,
    mostrarPickerDeTipos,
    eliminarElementoDirecto,
    guardarPropiedadesElemento,
    switchPropTab,
    loadPropHistory,
    loadPropPhotos,
    showPropertiesModal,
    // Capa lógica (F3): diagrama del nodo
    tieneDiagrama,
    abrirDiagramaDelElemento,
    abrirDiagramaGlobal
  };

})();

window.FTTHMapa = FTTHMapa;
