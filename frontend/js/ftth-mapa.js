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
  // Postes por los que PASA el trazado (puntos de paso), en el ORDEN exacto en que
  // el usuario fue haciendo clic. Se guarda con el cable (postes_intermedios) porque
  // el motor de fallas necesita la ruta física poste por poste.
  let _postesIntermedios = [];

  // La ruta COMPLETA del trazado, paso por paso y en orden:
  //   { poste: 126 }  → ese vértice se lee siempre de la lat/lon ACTUAL del poste
  //   { punto: [lon,lat] } → clic libre (se conserva tal cual)
  // Con esto la geometría del cable se puede rehacer cuando un poste se mueve,
  // sin perder los puntos libres ni el orden original.
  let _rutaTrazo = [];

  /** Apunta un paso de la ruta del trazado (poste o punto libre). */
  function _recordarPaso(paso) {
    if (!paso) return;
    if (paso.poste != null) {
      const id = Number(paso.poste);
      if (!Number.isFinite(id) || id <= 0) return;
      _rutaTrazo.push({ poste: id });
      return;
    }
    const par = paso.punto;
    if (!Array.isArray(par) || par.length < 2) return;
    const lon = Number(par[0]);
    const lat = Number(par[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    _rutaTrazo.push({ punto: [lon, lat] });
  }

  /** Apunta un poste en la ruta del trazado (sin reordenar y sin repetir el anterior). */
  function _recordarPoste(posteId) {
    const id = Number(posteId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (_postesIntermedios[_postesIntermedios.length - 1] === id) return;
    _postesIntermedios.push(id);
  }

  // Un temporizador por objeto: así dos clics seguidos no se pisan entre sí.
  const _pulsos = new Map();

  /**
   * Confirmación visual de que el trazado quedó «atado» a un objeto: sube el tamaño
   * (scale) y vuelve solo. Corto (260 ms) para no interrumpir el trazado.
   */
  function _pulsarElemento(id) {
    const map = getMap();
    if (!map || id == null) return;
    const clave = String(id);
    try {
      map.setFeatureState({ source: 'ftth-elementos', id }, { pulsado: true });
    } catch (e) {
      return;
    }
    clearTimeout(_pulsos.get(clave));
    _pulsos.set(clave, setTimeout(() => {
      try {
        map.setFeatureState({ source: 'ftth-elementos', id }, { pulsado: false });
      } catch (e) { /* el objeto pudo desaparecer: se ignora */ }
      _pulsos.delete(clave);
    }, 260));
  }

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

  /**
   * Ícono SVG oficial de una categoría. Es la MISMA imagen que muestra el panel
   * general izquierdo (fuente única: FTTHIconos → assets/icons/<categoria>.svg).
   * Si la categoría no está en el catálogo de íconos devuelve '' (nunca un ícono
   * equivocado).
   */
  function iconoHTML(categoria, size = 15, extraStyle = 'vertical-align:-3px;margin-right:5px;') {
    const cat = String(categoria || '').toLowerCase();
    const iconos = (window.FTTHIconos && window.FTTHIconos.ICONOS) || null;
    if (!iconos || !iconos[cat]) return '';
    return window.FTTHIconos.imgHtml(cat, size, '', extraStyle);
  }

  // ── Carga y renderizado de capas en MapLibre ──────────────────────────────
  async function cargarTodosElementos() {
    const map = getMap();
    if (!map || !window.currentProjectId) return;

    try {
      const res = await fetch(apiUrl(`/api/elementos/todos?proyecto_id=${window.currentProjectId}&_t=${Date.now()}`), { cache: 'no-store' });
      if (!res.ok) return;
      const geojson = await res.json();
      _currentFeatures = (geojson && geojson.features) || [];
      // Los DATOS van primero: `setData` funciona aunque el estilo esté a medio
      // cargar. Antes esta función se salía al ver `!isStyleLoaded()`, dejando el
      // refresco en cola en un `once('style.load', …)`: como ese evento YA había
      // ocurrido (solo se dispara al cargar el estilo), el refetch no se aplicaba
      // nunca y el mapa se quedaba con la geometría vieja (la línea no seguía al poste).
      _pintarColeccion(map, _currentFeatures);
      _updateStats();
      if (window.FTTHCarpetas && typeof window.FTTHCarpetas.updateMapFilter === 'function') {
        window.FTTHCarpetas.updateMapFilter();
      }
    } catch (err) {
      console.error('Error cargando elementos FTTH:', err);
    }
  }

  /**
   * Vuelca las features al source del mapa y se asegura de que las capas existan.
   * Devuelve true si la geometría quedó aplicada (lo importante para repintar).
   */
  function _pintarColeccion(map, features) {
    const coleccion = { type: 'FeatureCollection', features: features || [] };
    const src = map.getSource('ftth-elementos');

    if (src && typeof src.setData === 'function') {
      src.setData(coleccion);          // ← EL repintado real
      _asegurarCapas(map, coleccion);  // las capas, después y sin poder romper esto
      return true;
    }

    // Todavía no hay source (primer arranque): hay que esperar al estilo para
    // crearlo. En cuanto el estilo lo admita, se reintenta solo.
    const crear = () => {
      try {
        _ensureFTTHLayers(map, coleccion);
        return true;
      } catch (e) {
        console.warn('[mapa] aún no se pueden crear las capas FTTH:', e && e.message);
        return false;
      }
    };
    if (!crear()) map.once('styledata', crear);
    return false;
  }

  /** Crea las capas que falten y engancha las interacciones, sin romper nada. */
  function _asegurarCapas(map, coleccion) {
    try {
      _ensureFTTHLayers(map, coleccion);
    } catch (e) {
      console.warn('[mapa] las capas FTTH no se pudieron actualizar:', e && e.message);
    }
  }

  // Crea la capa de etiquetas una vez que los íconos SVG están registrados en MapLibre.
  function _addLabelsLayerWhenReady(map, srcId) {
    const crear = () => {
      if (map.getLayer('ftth-labels-layer')) return;
      try {
        map.addLayer({
          id: 'ftth-labels-layer',
          type: 'symbol',
          source: srcId,
          filter: ['all', ['!=', ['get', 'categoria'], 'ducto'], ['!=', ['get', 'categoria'], 'cables']],
          layout: {
            // Ícono SVG del tipo (registrado por FTTHIconos.registrarEnMapa)
            'icon-image': [
              'concat',
              'ftth-ico-',
              ['match', ['downcase', ['get', 'categoria']],
                'post', 'poste',
                'postes', 'poste',
                'caja', 'cajanap',
                'nap', 'cajanap',
                'caja-nap', 'cajanap',
                'caja_nap', 'cajanap',
                ['downcase', ['get', 'categoria']]
              ]
            ],
            'icon-size': [
              'case',
              // 'pulsado': el objeto acaba de recibir el trazado (pulso de confirmación)
              ['boolean', ['feature-state', 'pulsado'], false], 0.58,
              ['boolean', ['feature-state', 'hover'], false], 0.48,
              0.34
            ],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-offset': [0, -10],
            'icon-anchor': 'bottom',
            // Etiqueta de texto con el nombre y el NÚMERO VISIBLE (correlativo por tipo;
            // el id interno se usa solo si el objeto todavía es provisional).
            'text-field': ['case',
              ['has', 'pendiente'], ['get', 'tipo_nombre'],
              ['concat', ['get', 'tipo_nombre'], ' #',
                ['to-string', ['coalesce', ['get', 'numero'], ['get', 'id']]]]],
            'text-size': 12,
            'text-offset': [0, 1.1],
            'text-anchor': 'top',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': '#0f172a',
            'text-halo-color': '#ffffff',
            'text-halo-width': 2,
            'icon-opacity': 1,
            'text-opacity': 1,
          },
        });
      } catch (e) {
        // Un addLayer inválido (p. ej. un ícono/texto que MapLibre rechaza) NO debe
        // tumbar el resto: los datos y las capas de líneas/puntos ya están puestos.
        console.warn('[mapa] la capa de íconos/etiquetas no se pudo crear:', e && e.message);
        return;
      }

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
    let src = map.getSource(srcId);
    if (src) {
      src.setData(geojson);
    } else {
      map.addSource(srcId, { type: 'geojson', data: geojson });
    }

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

    // 2. Capa Puntos Vectoriales (Garantiza visibilidad 100% inmediata de nodos)
    if (!map.getLayer('ftth-puntos-layer')) {
      map.addLayer({
        id: 'ftth-puntos-layer',
        type: 'circle',
        source: srcId,
        filter: ['all', ['!=', ['get', 'categoria'], 'ducto'], ['!=', ['get', 'categoria'], 'cables']],
        paint: {
          'circle-color': ['coalesce', ['get', 'color'], '#3b82f6'],
          'circle-radius': [
            'case',
            // 'pulsado': el objeto acaba de recibir el trazado (pulso de confirmación)
            ['boolean', ['feature-state', 'pulsado'], false], 14,
            ['boolean', ['feature-state', 'hover'], false], 10,
            7
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.95,
        },
      });
    }

    // 3. Íconos SVG y etiquetas
    _addLabelsLayerWhenReady(map, srcId);

    // Cursor y menú contextual de todas las capas
    try {
      _bindLayerInteractions(map, ['ftth-ductos-layer', 'ftth-cables-layer', 'ftth-puntos-layer', 'ftth-labels-layer']);
    } catch (e) {
      // Si alguna capa no existe (p. ej. la de etiquetas falló), el resto sigue vivo.
      console.warn('[mapa] interacciones parciales en las capas FTTH:', e && e.message);
    }
  }

  // ── Prompt para finalizar cable ───────────────────────────────────────────
  function showReservaPrompt(onConfirm) {
    let prompt = document.getElementById('ftth-reserva-prompt');
    if (prompt) prompt.remove();

    prompt = document.createElement('div');
    prompt.id = 'ftth-reserva-prompt';
    prompt.className = 'trace-finish-prompt';
    prompt.style.cssText = [
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:120000;',
      'background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.35);',
      'padding:20px 24px;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;',
      'display:flex;flex-direction:column;gap:12px;min-width:300px;',
    ].join('');

    prompt.innerHTML = `
      <div style="font-weight:700;font-size:15px;color:#1d1d1f;display:flex;align-items:center;gap:8px;">
        <i class="fa-solid fa-anchor" style="color:#0071e3;"></i> Finalizar y Anclar Fibra
      </div>
      <div style="font-size:12px;color:#86868b;line-height:1.4;">
        Indica la reserva de cable en metros (opcional). Si no hay reserva, haz clic en <b>Sin reserva</b>.
      </div>
      <input type="number" id="reserva-input" placeholder="Ej: 30 metros" min="0" step="1" style="padding:8px 12px;border:1px solid #d1d1d6;border-radius:8px;font-size:14px;outline:none;">
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px;">
        <button type="button" id="reserva-btn-none" style="padding:7px 14px;background:#f5f5f7;color:#1d1d1f;border:1px solid #d1d1d6;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">Sin reserva</button>
        <button type="button" id="reserva-btn" style="padding:7px 14px;background:#0071e3;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">Guardar y Anclar</button>
      </div>
    `;
    document.body.appendChild(prompt);

    const input = prompt.querySelector('#reserva-input');
    const btn = prompt.querySelector('#reserva-btn');
    const btnNone = prompt.querySelector('#reserva-btn-none');
    input.focus();

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      if (prompt.parentNode) prompt.remove();
      onConfirm(val);
    };

    btn.addEventListener('click', () => finish(parseFloat(input.value) || 0));
    btnNone.addEventListener('click', () => finish(0));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish(parseFloat(input.value) || 0);
      if (e.key === 'Escape') finish(0);
    });
  }

  let _contextMenuHandled = false;

  function finishCableTraceAtPoint(coords, targetNodeId = null, pasoFinal = null) {
    if (!_modoActivo || _modoActivo.categoria !== 'cables' || _pendingLine.length === 0) return;
    if (coords && Array.isArray(coords)) {
      _pendingLine.push(coords);
      _recordarPaso(pasoFinal || { punto: coords });
    }
    const { tipoId, tipoNombre, color, nodoInicioId } = _modoActivo;
    const lineToSave = [..._pendingLine];
    // La ruta física va EN ORDEN de clic: es lo que necesita el motor de fallas
    const postesRuta = [..._postesIntermedios];
    // La ruta paso por paso (postes + puntos libres): con esto el backend rehace
    // la geometría del cable cuando un poste se mueve.
    const rutaTrazo = _rutaTrazo.length >= 2 ? [..._rutaTrazo] : [];

    _removeDuctPreview();
    _pendingLine = [];
    _postesIntermedios = [];
    _rutaTrazo = [];
    desactivarModoColocacion();

    showReservaPrompt((reservaVal) => {
      if (window.FTTHTipos) FTTHTipos.showToast('Finalizando y guardando cable de fibra...', 'info');
      colocarDucto(tipoId, tipoNombre, lineToSave, color, 'cables', targetNodeId,
                   nodoInicioId, reservaVal, postesRuta, rutaTrazo);
    });
  }

  // Cursor y menú contextual sobre una o varias capas
  function _bindLayerInteractions(map, layerIds) {
    layerIds.forEach(layerId => {
      map.on('contextmenu', layerId, e => {
        e.preventDefault();
        _contextMenuHandled = true;
        _ctxFeature = e.features && e.features[0];

        // ── Modo trazado de cables activo ─────────────────────────────────
        if (_modoActivo && _modoActivo.categoria === 'cables' && _pendingLine.length > 0) {
          const cat = (_ctxFeature && _ctxFeature.properties && _ctxFeature.properties.categoria)
            ? String(_ctxFeature.properties.categoria).toLowerCase()
            : '';

          // ── Caso A: Nodo final — anclar y terminar el trazado ──────────
          if (['cajanap', 'manga', 'odf', 'olt'].includes(cat)) {
            const ptLng = _ctxFeature.geometry.coordinates[0];
            const ptLat = _ctxFeature.geometry.coordinates[1];
            const targetNodeId = _ctxFeature.properties.id;
            finishCableTraceAtPoint([ptLng, ptLat], targetNodeId);
            return;
          }

          // ── Caso B: Poste — ofrecer opciones de paso o reserva ─────────
          if (cat === 'poste') {
            const posteId = _ctxFeature.properties.id;
            const posteNombre = _ctxFeature.properties.tipo_nombre || `Poste #${posteId}`;
            const ptLng = _ctxFeature.geometry.coordinates[0];
            const ptLat = _ctxFeature.geometry.coordinates[1];

            let posteMenu = document.getElementById('ftth-cable-poste-menu');
            if (!posteMenu) {
              posteMenu = document.createElement('div');
              posteMenu.id = 'ftth-cable-poste-menu';
              posteMenu.style.cssText = [
                'position:fixed;z-index:90000;min-width:210px;',
                'background:#fff;border:1px solid #e5e5ea;border-radius:10px;',
                'box-shadow:0 8px 24px rgba(0,0,0,0.18);padding:5px;',
                'font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;',
                'font-size:13px;',
              ].join('');
              document.body.appendChild(posteMenu);
            }

            posteMenu.innerHTML = `
              <div style="padding:6px 11px;font-size:11px;font-weight:700;color:#86868b;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(posteNombre)}</div>
              <hr style="border:none;border-top:1px solid #f0f0f2;margin:4px 0;">
              <button id="pm-anclar" style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 11px;border:none;background:none;cursor:pointer;border-radius:6px;text-align:left;font-size:13px;color:#1d1d1f;font-weight:500;">
                <i class="fa-solid fa-anchor" style="width:14px;text-align:center;color:#0071e3;"></i> Anclar al poste (con reserva)
              </button>
              <button id="pm-paso" style="width:100%;display:flex;align-items:center;gap:9px;padding:8px 11px;border:none;background:none;cursor:pointer;border-radius:6px;text-align:left;font-size:13px;color:#1d1d1f;font-weight:500;">
                <i class="fa-solid fa-circle-dot" style="width:14px;text-align:center;color:#86868b;"></i> Solo marcar como punto de paso
              </button>
            `;

            const px = Math.min(e.point.x, window.innerWidth - 230);
            const py = Math.min(e.point.y, window.innerHeight - 120);
            posteMenu.style.left = `${px}px`;
            posteMenu.style.top  = `${py}px`;
            posteMenu.style.display = 'block';

            const cerrarPosteMenu = () => { posteMenu.style.display = 'none'; };

            ['pm-anclar','pm-paso'].forEach(id => {
              const btn = posteMenu.querySelector('#' + id);
              if (btn) {
                btn.addEventListener('mouseenter', () => { btn.style.background = '#f5f5f7'; });
                btn.addEventListener('mouseleave', () => { btn.style.background = ''; });
              }
            });

            posteMenu.querySelector('#pm-anclar').addEventListener('click', () => {
              cerrarPosteMenu();
              _pulsarElemento(posteId);          // confirmación visual del clic
              // El poste donde se ancla es el último vértice del trazado
              finishCableTraceAtPoint([ptLng, ptLat], posteId, { poste: posteId });
            });

            posteMenu.querySelector('#pm-paso').addEventListener('click', () => {
              cerrarPosteMenu();
              _pendingLine.push([ptLng, ptLat]);
              _recordarPaso({ poste: posteId }); // vértice = poste (la línea lo sigue)
              _recordarPoste(posteId);           // ← queda en la ruta, en este orden
              _pulsarElemento(posteId);          // ← confirmación visual (scale y vuelve)
              _updateDuctPreview();
              if (window.FTTHTipos) FTTHTipos.showToast(`Punto de paso en ${posteNombre} marcado`, 'info');
            });

            setTimeout(() => {
              document.addEventListener('mousedown', function quitarMenu(ev) {
                if (!posteMenu.contains(ev.target)) {
                  cerrarPosteMenu();
                  document.removeEventListener('mousedown', quitarMenu);
                }
              });
            }, 10);

            return;
          }

          // Clic derecho sobre espacio libre o cualquier otra feature -> finalizar trazado libre
          finishCableTraceAtPoint([e.lngLat.lng, e.lngLat.lat]);
          return;
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
    // Número VISIBLE: el correlativo del tipo (no el id interno)
    const numero = props.numero || id;
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
        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${iconoHTML(cat, 15)}${nombre}</span>
        <span style="color:#86868b; font-weight:400; font-size:12px;">#${numero}</span>
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

      <button onclick="window.showPropertiesModalById(${id})" style="margin-top:8px; width:100%; background:#f5f5f7; color:#1d1d1f; border:1px solid #d1d1d6; padding:6px 0; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;"><i class="fa-solid fa-pen-to-square"></i> Editar Propiedades</button>
      ${tieneDiagrama(cat) ? `<button onclick="window.FTTHMapa.abrirDiagramaGlobal('${id}', '${cat}', '${props.tipo_nombre || cat}')" style="margin-top:6px; width:100%; background:#1d1d1f; color:#fff; border:none; padding:7px 0; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer; transition:background 0.2s;">${iconoHTML(cat, 14, 'filter:invert(1);')}Abrir Diagrama</button>` : ''}
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

  function _aplicarDesplazamientoVerticalPostes(rawFeatures) {
    if (!Array.isArray(rawFeatures) || !rawFeatures.length) return rawFeatures || [];

    const polesById = new Map();
    rawFeatures.forEach(f => {
      if (f && f.properties && f.properties.categoria === 'poste' && f.geometry && f.geometry.type === 'Point') {
        const id = Number(f.id || f.properties.id);
        polesById.set(id, {
          id,
          coords: [...f.geometry.coordinates],
        });
      }
    });

    const anchoredGroups = new Map();
    rawFeatures.forEach(f => {
      if (!f || !f.properties || f.geometry?.type !== 'Point') return;
      const cat = String(f.properties.categoria || '').toLowerCase();
      if (cat === 'poste' || cat === 'ducto' || cat === 'cables') return;

      let poleId = Number(f.properties.poste_ref_id);
      if (!poleId || !polesById.has(poleId)) {
        const coords = f.geometry.coordinates || [];
        const [lon, lat] = coords;
        for (const [pid, pdata] of polesById.entries()) {
          const [plon, plat] = pdata.coords;
          if (Math.abs(lon - plon) < 0.00002 && Math.abs(lat - plat) < 0.00002) {
            poleId = pid;
            f.properties.poste_ref_id = pid;
            break;
          }
        }
      }

      if (poleId && polesById.has(poleId)) {
        if (!anchoredGroups.has(poleId)) anchoredGroups.set(poleId, []);
        anchoredGroups.get(poleId).push(f);
      }
    });

    // Orden jerárquico visual: 1. Reserva -> 2. Manga -> 3. Caja
    const prioridades = {
      reserva: 1,
      luminaria: 1,
      manga: 2,
      fusion: 2,
      cajanap: 3,
      caja: 3,
      splitter: 3,
      olt: 3,
      odf: 3,
      armario: 3
    };

    return rawFeatures.map(f => {
      if (!f || !f.properties || f.geometry?.type !== 'Point') return f;
      const poleId = Number(f.properties.poste_ref_id);
      if (!poleId || !polesById.has(poleId)) return f;

      const poleData = polesById.get(poleId);
      const group = anchoredGroups.get(poleId) || [];

      group.sort((a, b) => {
        const catA = String(a.properties.categoria || '').toLowerCase();
        const catB = String(b.properties.categoria || '').toLowerCase();
        const instA = parseInstProps(a.properties.propiedades_instancia);
        const instB = parseInstProps(b.properties.propiedades_instancia);
        const isResA = instA.tipo === 'Reserva' || instA.reserva_m;
        const isResB = instB.tipo === 'Reserva' || instB.reserva_m;

        const prioA = isResA ? 1 : (prioridades[catA] || 3);
        const prioB = isResB ? 1 : (prioridades[catB] || 3);
        if (prioA !== prioB) return prioA - prioB;
        return (Number(a.id || a.properties.id) || 0) - (Number(b.id || b.properties.id) || 0);
      });

      const idxInGroup = group.indexOf(f);
      if (idxInGroup < 0) return f;

      // Desplazamiento vertical limpio hacia el norte (3.8m por nivel)
      const latStep = 0.000035 * (idxInGroup + 1);
      return {
        ...f,
        geometry: {
          ...f.geometry,
          coordinates: [poleData.coords[0], poleData.coords[1] + latStep]
        }
      };
    });
  }

  // Vuelca las features en memoria al source de MapLibre
  function _setFeatureData() {
    const src = getMap()?.getSource('ftth-elementos');
    if (src) {
      const featuresWithId = (_currentFeatures || []).map(f => {
        if (!f) return f;
        const fid = f.id || (f.properties && f.properties.id);
        return { ...f, id: fid };
      });
      const shifted = _aplicarDesplazamientoVerticalPostes(featuresWithId);
      src.setData({ type: 'FeatureCollection', features: shifted });
    }
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
    _postesIntermedios = [];      // ruta nueva: se arranca sin postes
    _rutaTrazo = [];

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
    _postesIntermedios = [];
    _rutaTrazo = [];
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
    const numero = props.numero || props.id;
    _modoMover = {
      id: props.id,
      numero,
      categoria: props.categoria,
      nombre: props.tipo_nombre || props.categoria
    };

    const map = getMap();
    if (map) map.getCanvas().style.cursor = 'crosshair';

    showPlacementHint(`Moviendo ${props.tipo_nombre || props.categoria} #${numero}: Haz clic en la nueva ubicación del mapa`, props.categoria);

    if (window.FTTHTipos) {
      FTTHTipos.showToast(`Modo Mover activo para #${numero}. Haz clic en la nueva ubicación.`, 'info', props.categoria);
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
      const etiqueta = _modoMover.numero || elemId;
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
        // El backend rehace los cables que pasan por este poste (si es un poste):
        // vuelve con la lista de cables recalculados.
        const data = await res.json().catch(() => ({}));
        const seguidos = (data && data.cables_recalculados) || [];
        console.log('[geometria] al mover el objeto #' + etiqueta + ' el servidor recalculó:',
          seguidos);

        // 1) El poste movido, con su coordenada nueva
        let featuresNuevas = _currentFeatures.map(f => {
          if (f.properties && f.properties.id === elemId) {
            return {
              ...f,
              geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] }
            };
          }
          return f;
        });

        // 2) Los cables que el servidor recalculó se parchean YA con la geometría
        //    que viene en ESTA respuesta (campo `coords`): la línea se repinta sin
        //    depender de otra petición ni del estado del estilo del mapa.
        const nuevasCoords = new Map();
        seguidos.forEach(c => {
          const id = Number(c && c.cable_id);
          if (id && Array.isArray(c.coords) && c.coords.length >= 2) nuevasCoords.set(id, c.coords);
        });
        if (nuevasCoords.size) {
          featuresNuevas = featuresNuevas.map(f => {
            const coords = f.properties && nuevasCoords.get(Number(f.properties.id));
            if (!coords) return f;
            return { ...f, geometry: { type: 'LineString', coordinates: coords } };
          });
          console.log('[geometria] líneas repintadas en el mapa desde la respuesta:',
            [...nuevasCoords.keys()]);
        }
        _currentFeatures = featuresNuevas;
        const src = getMap()?.getSource('ftth-elementos');
        if (src) src.setData({ type: 'FeatureCollection', features: _currentFeatures });

        // 3) Y además se refresca todo desde el servidor (por si hubo más cambios:
        //    numeración, postes_intermedios, etc.). Es un respaldo: si falla, la
        //    línea ya quedó bien pintada en el paso 2.
        if (seguidos.length) {
          try {
            await cargarTodosElementos();
          } catch (e) {
            console.warn('[geometria] el refresco completo falló (la línea ya está pintada):', e);
          }
        }

        if (window.FTTHCarpetas && FTTHCarpetas.loadCarpetas) {
          FTTHCarpetas.loadCarpetas();
        }

        if (window.FTTHTipos) {
          FTTHTipos.showToast(
            `✓ Objeto ${nombre} #${etiqueta} movido` +
            (seguidos.length ? ` · ${seguidos.length} cable(s) siguieron al poste` : ''),
            'success');
        }
      } catch (err) {
        console.error('Error al mover elemento:', err);
        if (window.FTTHTipos) FTTHTipos.showToast('Error al mover: ' + err.message, 'error');
      }
      return;
    }

    // Caso 2: Modo Colocación Activo
    if (!_modoActivo) {
      // No hay nada pendiente: ni colocación ni "mover". Es un clic suelto en el mapa
      // (p. ej. el segundo clic de un doble clic, que MapLibre entrega como dos
      // 'click'). NO se resetea ningún modo aquí: el arrastre/movimiento ya terminó.
      console.log('Clic en el mapa sin modo activo: no hay nada que colocar ni mover');
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
      let pasoVertice = null;   // {poste:id} si el vértice es un poste, si no null

      if (categoria === 'cables') {
        const map = getMap();
        if (map) {
          let feat = e._layerFeature || null;
          if (!feat) {
            const bbox = [
              [e.point.x - 16, e.point.y - 16],
              [e.point.x + 16, e.point.y + 16]
            ];
            // El círculo (ftth-puntos-layer) está EXACTAMENTE en el punto del poste;
            // el ícono se dibuja por encima, así que se consultan las dos capas.
            const nearby = map.queryRenderedFeatures(bbox, {
              layers: ['ftth-puntos-layer', 'ftth-labels-layer']
            });
            // Si hay varias, se prefiere un poste (es lo que ata el trazado)
            feat = nearby.find((f) => String((f.properties || {}).categoria).toLowerCase() === 'poste')
                || nearby[0] || null;
          }

          if (feat && feat.properties) {
            const catClic = (feat.properties.categoria || '').toLowerCase();
            if (['poste', 'cajanap', 'manga', 'odf', 'olt'].includes(catClic)) {
              if (feat.geometry && feat.geometry.type === 'Point') {
                ptLng = feat.geometry.coordinates[0];
                ptLat = feat.geometry.coordinates[1];
              }
              if (_pendingLine.length === 0) {
                // Primer clic: este objeto es el ORIGEN del cable
                _modoActivo.nodoInicioId = feat.properties.id;
              } else if (catClic === 'poste') {
                // El trazado YA venía andando: este poste es un punto de paso
                _recordarPoste(feat.properties.id);
              }
              // Confirmación visual: el objeto «recibe» el trazado
              _pulsarElemento(feat.properties.id);
              // El vértice es el POSTE (si es poste), así la geometría del cable
              // seguirá su lat/lon cuando el poste se mueva
              if (catClic === 'poste') pasoVertice = { poste: feat.properties.id };
            }
          }
        }
      }

      _pendingLine.push([ptLng, ptLat]);
      _recordarPaso(pasoVertice || { punto: [ptLng, ptLat] });
      
      if (_pendingLine.length === 1) {
        if (categoria === 'ducto') {
          showPlacementHint('Ducto: Clic para añadir puntos, doble clic para finalizar', 'ducto');
        } else {
          showPlacementHint('Cable: Clic en postes para trazar. Clic derecho en un poste → anclar/paso. Clic derecho en caja/manga → finalizar', 'cables');
        }
      }
      _updateDuctPreview();
      return;
    }

    // Colocar elemento puntual (se pinta al instante y se confirma con el servidor)
    colocarElemento(categoria, tipoId, tipoNombre, { lat, lon: lng }, color);
  }

  function handleMapDblClick(e) {
    if (!_modoActivo) return;
    e.preventDefault();
    if (_pendingLine.length < 2) {
      if (window.FTTHTipos) FTTHTipos.showToast('Se necesitan al menos 2 puntos para trazar', 'error');
      return;
    }
    const { categoria, tipoId, tipoNombre, color } = _modoActivo;

    if (categoria === 'cables') {
      finishCableTraceAtPoint([e.lngLat.lng, e.lngLat.lat]);
    } else {
      _removeDuctPreview();
      colocarDucto(tipoId, tipoNombre, [..._pendingLine], color);
      _pendingLine = [];
      desactivarModoColocacion();
    }
  }

  let _hoveredNodeId = null;

  function handleMapMouseMove(e) {
    const map = getMap();
    if (!map) return;

    // A) Live line preview following cursor while tracing
    if (_modoActivo && (_modoActivo.categoria === 'ducto' || _modoActivo.categoria === 'cables') && _pendingLine.length > 0) {
      _updateDuctPreview([e.lngLat.lng, e.lngLat.lat]);
    }

    // B) Visual effect: scale up node icon 40% when cursor is over a box/manga/poste during cable tracing
    if (_modoActivo && _modoActivo.categoria === 'cables' && _pendingLine.length > 0) {
      const bbox = [
        [e.point.x - 14, e.point.y - 14],
        [e.point.x + 14, e.point.y + 14]
      ];
      const nearby = map.queryRenderedFeatures(bbox, { layers: ['ftth-labels-layer'] });
      const feat = nearby.length ? nearby[0] : null;

      if (feat && feat.properties) {
        const cat = String(feat.properties.categoria || '').toLowerCase();
        if (['cajanap', 'manga', 'odf', 'olt', 'poste'].includes(cat)) {
          const fid = feat.id || feat.properties.id;
          if (_hoveredNodeId !== fid) {
            if (_hoveredNodeId !== null) {
              try { map.setFeatureState({ source: 'ftth-elementos', id: _hoveredNodeId }, { hover: false }); } catch(err){}
            }
            _hoveredNodeId = fid;
            try { map.setFeatureState({ source: 'ftth-elementos', id: _hoveredNodeId }, { hover: true }); } catch(err){}
          }
          return;
        }
      }
    }

    if (_hoveredNodeId !== null) {
      try { map.setFeatureState({ source: 'ftth-elementos', id: _hoveredNodeId }, { hover: false }); } catch(err){}
      _hoveredNodeId = null;
    }
  }

  function handleMapContextMenu(e) {
    if (!_modoActivo || _modoActivo.categoria !== 'cables' || _pendingLine.length === 0) return;
    if (_contextMenuHandled) {
      _contextMenuHandled = false;
      return;
    }
    finishCableTraceAtPoint([e.lngLat.lng, e.lngLat.lat]);
  }

  function _updateDuctPreview(mouseCoords) {
    const map = getMap();
    if (!map || _pendingLine.length < 1) return;
    const colorLinea = (_modoActivo && _modoActivo.color) ? _modoActivo.color : '#ff5722';

    const lineCoords = [..._pendingLine];
    if (mouseCoords && Array.isArray(mouseCoords)) {
      lineCoords.push(mouseCoords);
    }
    
    const features = [];
    
    // Línea si hay 2 o más puntos (incluyendo el cursor actual)
    if (lineCoords.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: lineCoords },
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
  async function colocarElemento(categoria, tipoId, tipoNombre, { lat, lon }, color, posteRefId = null, extraInstProps = {}) {
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

    const instProps = { ...extraInstProps };

    const body = {
      proyecto_id: Number(window.currentProjectId),
      tipo_id: tipoId,
      categoria: categoria,
      lat: Number(lat),
      lon: Number(lon),
      poste_ref_id: posteRefId ? Number(posteRefId) : null,
      propiedades_instancia: instProps,
    };

    // 1) PINTADO INMEDIATO (optimista): el objeto se ve en el mismo clic,
    //    sin esperar la ida y vuelta al servidor ni re-renderizar la capa.
    const provisional = _featureProvisional(categoria, tipoId, tipoNombre, color,
      { type: 'Point', coordinates: [Number(lon), Number(lat)] });
    provisional.properties.poste_ref_id = posteRefId ? Number(posteRefId) : null;
    provisional.properties.propiedades_instancia = instProps;
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

      const ancladoMsg = posteRefId ? ` (Anclado al poste #${posteRefId})` : '';
      if (window.FTTHTipos) {
        FTTHTipos.showToast(`✓ ${tipoNombre} agregado al mapa${ancladoMsg}`, 'success');
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

  async function colocarDucto(tipoId, tipoNombre, coords, color, cat_override = 'ducto',
                              nodoFinId = null, nodoInicioId = null, reserva_m = null,
                              postesIntermedios = [], rutaTrazo = []) {
    if (!window.currentProjectId) return;
    if (!tipoId) {
      if (window.FTTHTipos) FTTHTipos.showToast(`Elige una plantilla de tipo antes de dibujar el ${cat_override}`, 'error');
      return;
    }
    const propsInst = {};
    if (reserva_m !== null && reserva_m !== undefined && reserva_m !== '') {
      propsInst.reserva_m = reserva_m;
    }
    // Ruta física del cable, poste por poste y EN ORDEN de trazado (no se reordena
    // ni por id ni por posición): la usa el motor de fallas para saber por dónde va.
    if (Array.isArray(postesIntermedios) && postesIntermedios.length) {
      propsInst.postes_intermedios = postesIntermedios.map((n) => Number(n))
        .filter((n) => Number.isFinite(n));
    }
    // Ruta paso por paso (postes en vivo + puntos libres). Solo se guarda cuando el
    // trazado pasó por postes de verdad: así un trazado libre conserva sus
    // coordenadas tal cual y la geometría solo se recalcula donde hay poste.
    if (Array.isArray(postesIntermedios) && postesIntermedios.length
        && Array.isArray(rutaTrazo) && rutaTrazo.length >= 2) {
      propsInst.trazado_ruta = rutaTrazo;
    }
    
    // Log de navegador: deja ver, en vivo, qué se capturó en el trazado.
    console.log('[linea] guardando', cat_override, '→',
      'postes_intermedios=', propsInst.postes_intermedios || [],
      '| trazado_ruta=', propsInst.trazado_ruta || [],
      '| vertices=', (coords || []).length);

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

  async function agregarObjetoAlPoste(categoriaTarget, posteId, geometry) {
    let lat = null, lon = null;
    if (geometry && geometry.coordinates) {
      lon = Number(geometry.coordinates[0]);
      lat = Number(geometry.coordinates[1]);
    }
    if (!lat || !lon) {
      if (window.FTTHTipos) FTTHTipos.showToast('No se pudieron obtener las coordenadas del poste', 'error');
      return;
    }

    let tipos = [];
    if (window.FTTHTipos && window.FTTHTipos.getTipos) {
      tipos = await window.FTTHTipos.getTipos(categoriaTarget);
    }

    if (!tipos || !tipos.length) {
      if (window.FTTHTipos) {
        FTTHTipos.showToast(`Crea una plantilla de tipo para "${categoriaTarget}" primero.`, 'warning');
        FTTHTipos.openModal(categoriaTarget);
      }
      return;
    }

    const t = tipos[0];
    const color = t.color_mapa || (categoriaTarget === 'cajanap' ? '#0071e3' : (categoriaTarget === 'manga' ? '#9333ea' : '#f59e0b'));

    let extraProps = {};
    if (categoriaTarget === 'reserva') {
      const resMStr = prompt('Cantidad de metros de reserva en este poste (m):', '10');
      if (resMStr === null) return;
      const m = parseFloat(resMStr) || 10;
      extraProps.reserva_m = m;
    }

    await colocarElemento(categoriaTarget, t.id, t.nombre || t.nombre_id || categoriaTarget, { lat, lon }, color, posteId, extraProps);
  }

  function showContextMenu({ x, y }, lngLat) {
    if (!_ctxMenu || !_ctxFeature) return;
    const props = _ctxFeature.properties || {};
    const cat = String(props.categoria || 'elemento').toLowerCase();
    const id = props.id;
    // Número VISIBLE (correlativo del tipo) para el encabezado del menú
    const numero = props.numero || id;
    const isPoste = cat === 'poste' || cat === 'postes';

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

    const posteOptionsHtml = isPoste ? `
      <hr class="ctx-divider">
      <button class="ctx-item" data-action="add-caja" style="color: #0284c7; font-weight: 600;">${iconoHTML('cajanap')}Agregar Caja NAP a este poste</button>
      <button class="ctx-item" data-action="add-manga" style="color: #0284c7; font-weight: 600;">${iconoHTML('manga')}Agregar Manga a este poste</button>
      <button class="ctx-item" data-action="add-reserva" style="color: #0284c7; font-weight: 600;">${iconoHTML('reserva')}Agregar Reserva a este poste</button>
    ` : '';

    _ctxMenu.innerHTML = `
      <div class="ctx-header">${iconoHTML(cat)}${instProps.name || instProps.nombre || (props.tipo_nombre || cat)} #${numero}</div>
      <div class="ctx-props-list">
        ${propsHtml}
      </div>
      ${posteOptionsHtml}
      <hr class="ctx-divider">
      ${tieneDiagrama(cat) ? `<button class="ctx-item" style="color: #0071e3; font-weight: 600;" data-action="diagrama">${iconoHTML(cat)}Abrir Diagrama</button>` : ''}
      <button class="ctx-item" data-action="move"><i class="fa-solid fa-arrows-up-down-left-right"></i> Mover Objeto</button>
      <button class="ctx-item" data-action="properties"><i class="fa-solid fa-pen-to-square"></i> Editar Propiedades</button>
      <hr class="ctx-divider">
      <button class="ctx-item ctx-item-danger" data-action="delete"><i class="fa-solid fa-trash"></i> Eliminar</button>
    `;

    _ctxMenu.style.left = `${Math.min(x, window.innerWidth - 240)}px`;
    _ctxMenu.style.top  = `${Math.min(y, window.innerHeight - 360)}px`;
    _ctxMenu.classList.remove('hidden');

    _ctxMenu.querySelectorAll('.ctx-item').forEach(btn => {
      btn.addEventListener('click', () => {
        hideContextMenu();
        const action = btn.dataset.action;
        if (action === 'delete') {
          eliminarElemento(id, props.tipo_nombre || cat, numero);
        } else if (action === 'diagrama') {
          abrirDiagramaDelElemento(props, _ctxFeature.geometry);
        } else if (action === 'properties') {
          showPropertiesModal(props, _ctxFeature.geometry);
        } else if (action === 'move') {
          iniciarModoMoverElemento(_ctxFeature);
        } else if (action === 'add-caja') {
          agregarObjetoAlPoste('cajanap', id, _ctxFeature.geometry);
        } else if (action === 'add-manga') {
          agregarObjetoAlPoste('manga', id, _ctxFeature.geometry);
        } else if (action === 'add-reserva') {
          agregarObjetoAlPoste('reserva', id, _ctxFeature.geometry);
        }
      });
    });
  }

  function hideContextMenu() {
    if (_ctxMenu) _ctxMenu.classList.add('hidden');
  }

  async function eliminarElemento(id, nombre, numero) {
    if (!confirm(`¿Eliminar ${nombre} #${numero || id}?`)) return;
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

  async function showPropertiesModalById(id) {
    if (!id) return;
    if (_activePopup) _activePopup.remove();
    try {
      const res = await fetch(apiUrl(`/api/elementos/${id}`));
      if (res.ok) {
        const fetched = await res.json();
        showPropertiesModal(fetched.properties || fetched, fetched.geometry);
      }
    } catch (e) {
      console.warn("Error loading element properties:", e);
    }
  }

  function showPropertiesModal(props, geometry) {
    if (props && String(props.categoria || '').toLowerCase() === 'cables' && window.FTTHFibraInspector && window.FTTHFibraInspector.abrir) {
      window.FTTHFibraInspector.abrir(props.id, { properties: props, geometry });
      return;
    }
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
    const displayName = instProps.name || instProps.nombre || `${tipoNombre} #${props.numero || props.id}`;

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
      meta.innerHTML = `Registro — ID interno <b>#${props.id}</b> · ${escapeHtml(CAT_LABELS[cat] || cat)} · plantilla <b>${escapeHtml(tipoNombre)}</b>`;
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

    // Registrar eventos de clic y movimiento en MapLibre
    map.off('click', handleMapClick);
    map.on('click', handleMapClick);
    map.off('dblclick', handleMapDblClick);
    map.on('dblclick', handleMapDblClick);
    map.off('mousemove', handleMapMouseMove);
    map.on('mousemove', handleMapMouseMove);
    map.off('contextmenu', handleMapContextMenu);
    map.on('contextmenu', handleMapContextMenu);

    // Clic derecho GLOBAL en el mapa
    map.getCanvas().addEventListener('contextmenu', e => {
      e.preventDefault();
    }, { capture: false });

    // ESC para cancelar trazado de cable
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _modoActivo && _modoActivo.categoria === 'cables') {
        _removeDuctPreview();
        _pendingLine = [];
        _postesIntermedios = [];
        _rutaTrazo = [];
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

  async function irAElemento(id) {
    const map = getMap();
    if (!map || !id) return;
    id = Number(id);

    let feat = _currentFeatures.find(f => Number(f.id || (f.properties && f.properties.id)) === id);
    if (!feat) {
      try {
        const res = await fetch(apiUrl(`/api/elementos/${id}?_t=${Date.now()}`), { cache: 'no-store' });
        if (res.ok) feat = await res.json();
      } catch (e) {}
    }
    if (!feat || !feat.geometry) return;

    let center = null;
    if (feat.geometry.type === 'Point') {
      center = feat.geometry.coordinates;
    } else if (feat.geometry.type === 'LineString') {
      const coords = feat.geometry.coordinates || [];
      if (coords.length) {
        const mid = Math.floor(coords.length / 2);
        center = coords[mid];
      }
    }

    if (center && center.length >= 2) {
      map.flyTo({ center: [center[0], center[1]], zoom: 19, duration: 1200 });
      const props = feat.properties || {};
      const catLabel = props.tipo_nombre || props.categoria || 'Elemento';
      // El toast habla del número VISIBLE (el correlativo del tipo)
      if (window.FTTHTipos) FTTHTipos.showToast(`Enfocando ${catLabel} #${props.numero || id} en el mapa`, 'info');
      setTimeout(() => {
        showPropertiesPopup(feat, { lng: center[0], lat: center[1] });
      }, 1250);
    }
  }

  function fitToElements() {
    const map = getMap();
    if (!map || !_currentFeatures || _currentFeatures.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    let count = 0;
    _currentFeatures.forEach(f => {
      if (f.geometry) {
        if (f.geometry.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
          bounds.extend(f.geometry.coordinates);
          count++;
        } else if (f.geometry.type === 'LineString' && Array.isArray(f.geometry.coordinates)) {
          f.geometry.coordinates.forEach(pt => {
            if (Array.isArray(pt) && pt.length >= 2) {
              bounds.extend(pt);
              count++;
            }
          });
        }
      }
    });
    if (count > 0) {
      map.fitBounds(bounds, { padding: 80, maxZoom: 18, duration: 1000 });
      if (window.FTTHTipos) FTTHTipos.showToast('Centrado en los elementos del mapa', 'info');
    }
  }

  return {
    init,
    cargarTodosElementos,
    fitToElements,
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
    showPropertiesModalById,
    irAElemento,
    // Capa lógica (F3): diagrama del nodo
    tieneDiagrama,
    abrirDiagramaDelElemento,
    abrirDiagramaGlobal
  };

})();

window.FTTHMapa = FTTHMapa;
window.showPropertiesModal = FTTHMapa.showPropertiesModal;
window.showPropertiesModalById = FTTHMapa.showPropertiesModalById;
window.irAElemento = FTTHMapa.irAElemento;
window.fitToElements = FTTHMapa.fitToElements;
