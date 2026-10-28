/**
 * ftth-fibra-inspector.js
 * Panel flotante estilo Apple de propiedades e inspección de cables de fibra óptica.
 * Fiel al diseño de Fibra_propiedades.htm con pestañas "Información" y "Ruta de fibra".
 */
const FTTHFibraInspector = (() => {

  let _cableId = null;
  let _cableData = null;
  let _hilosData = null;
  let _rootEl = null;

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parseJSON(raw) {
    if (typeof raw === 'object' && raw !== null) return raw;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return {};
  }

  /** Distancia entre dos puntos en coordenadas [lon, lat] usando la fórmula de Haversine (en metros) */
  function calcularDistanciaGeo(p1, p2) {
    if (!p1 || !p2 || p1.length < 2 || p2.length < 2) return 0;
    const R = 6371000; // radio de la Tierra en metros
    const rad = Math.PI / 180;
    const dLat = (p2[1] - p1[1]) * rad;
    const dLon = (p2[0] - p1[0]) * rad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(p1[1] * rad) * Math.cos(p2[1] * rad) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /* ========================================================================
     RECORRIDO DE LA FIBRA (de su punto de origen a su punto final)
     Todo lo que muestra «Propiedades de fibra» se deduce del trazado real del
     cable (su LineString) y de los objetos que caen exactamente sobre él:
       · la ruta de postes por los que pasa y la distancia entre ellos,
       · la primera y la última punta,
       · la longitud total (que se informa siempre, pase o no por postes).
     ======================================================================== */

  /** Tolerancia (m) para dar por hecho que un punto del trazado cae sobre un objeto */
  const TOL_PUNTO_M = 2.0;
  /** Separación mínima (m) entre puntos consecutivos: los repetidos se funden en uno */
  const TOL_REPETIDO_M = 0.05;

  /** Categorías que pueden estar «colgadas» o atravesadas por una fibra */
  const CATS_RUTA = Object.freeze([
    'poste', 'cajanap', 'manga', 'splitter', 'fusion',
    'odf', 'olt', 'armario', 'switches', 'luminaria', 'reserva'
  ]);

  /** Ícono SVG oficial del objeto (los mismos del panel general izquierdo) */
  function _icono(categoria, size = 14, extraClass = '') {
    if (window.FTTHIconos && window.FTTHIconos.imgHtml) {
      return window.FTTHIconos.imgHtml(categoria, size, extraClass);
    }
    return '';
  }

  /** Etiqueta legible de un objeto (nombre propio si lo tiene; si no, tipo #número visible) */
  function nombreObjeto(props) {
    const p = props || {};
    const inst = parseJSON(p.propiedades_instancia);
    const tipo = p.tipo_nombre || p.categoria || 'Objeto';
    // El número visible es el correlativo del tipo (`numero`), no el id interno
    const numero = p.numero || inst.numero || p.id;
    return inst.nombre || inst.name || `${tipo} #${numero}`;
  }

  function esPoste(props) {
    const cat = String((props && props.categoria) || '').toLowerCase();
    return cat === 'poste' || cat === 'postes' || cat === 'post';
  }

  /**
   * Limpia el trazado: descarta coordenadas inválidas y funde los puntos
   * consecutivos repetidos (el trazado del mapa suele duplicar la coordenada
   * exacta de un poste cada vez que se marca como punto de paso).
   */
  function normalizarTrazado(coords) {
    const salida = [];
    if (!Array.isArray(coords)) return salida;
    coords.forEach(c => {
      if (!c || c.length < 2) return;
      const lon = Number(c[0]);
      const lat = Number(c[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      const punto = [lon, lat];
      const previo = salida[salida.length - 1];
      if (previo && calcularDistanciaGeo(previo, punto) <= TOL_REPETIDO_M) return;
      salida.push(punto);
    });
    return salida;
  }

  /** Longitud total del trazado en metros */
  function longitudTrazado(coords) {
    const limpio = normalizarTrazado(coords);
    let total = 0;
    for (let i = 1; i < limpio.length; i++) total += calcularDistanciaGeo(limpio[i - 1], limpio[i]);
    return total;
  }

  /**
   * ¿La geometría es un trazado lineal? (LineString o MultiLineString)
   * El MultiLineString aparece cuando el recorte por teselas parte la línea: los
   * eventos de capa de MapLibre devuelven la geometría de LA TESELA (recortada),
   * no la del source, así que un cable puede llegar dividido en varias partes.
   */
  function esTrazadoLineal(geom) {
    return !!geom
      && (geom.type === 'LineString' || geom.type === 'MultiLineString')
      && Array.isArray(geom.coordinates);
  }

  /**
   * Coordenadas de un trazado, aceptando LineString y MultiLineString.
   * De un MultiLineString se toma LA PARTE MÁS LARGA: concatenar las partes
   * inventaría un tramo recto entre trozos separados y falsearía las distancias.
   */
  function coordsDeTrazado(geom) {
    if (!esTrazadoLineal(geom)) return [];
    if (geom.type === 'LineString') return geom.coordinates;
    let mejor = [];
    let mejorLargo = -1;
    geom.coordinates.forEach((parte) => {
      if (!Array.isArray(parte)) return;
      const largo = longitudTrazado(parte);
      if (largo > mejorLargo) { mejorLargo = largo; mejor = parte; }
    });
    return mejor;
  }

  /** Objetos puntuales que pueden estar sobre el trazado (postes, cajas, mangas…) */
  function _objetosSobreTrazado(features) {
    return (features || []).filter(f => {
      if (!f || !f.geometry || f.geometry.type !== 'Point') return false;
      if (!Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) return false;
      const p = f.properties || {};
      const cat = String(p.categoria || '').toLowerCase();
      if (cat === 'cables' || cat === 'ducto' || p.pendiente) return false;
      return CATS_RUTA.includes(cat);
    });
  }

  /**
   * Recorre el trazado de una fibra y devuelve su recorrido completo.
   * Función pura (sin DOM ni red) para poder probarla fuera del navegador.
   *
   * @param {Array<Array<number>>} coords    LineString de la fibra [lon, lat]
   * @param {Array<object>}        features  Features del proyecto (para ubicar los postes)
   */
  function resolverRecorridoFibra(coords, features, postesIntermedios) {
    const trazado = normalizarTrazado(coords);
    const objetos = _objetosSobreTrazado(features);

    // Distancia acumulada en cada punto del trazado
    const acumuladas = [];
    let total = 0;
    trazado.forEach((pt, i) => {
      if (i > 0) total += calcularDistanciaGeo(trazado[i - 1], pt);
      acumuladas.push(total);
    });

    // Objetos que caen encima de cada punto (el poste manda: la fibra va en él)
    const puntos = trazado.map((pt, i) => {
      const encima = objetos
        .map(o => ({ objeto: o, distancia_m: calcularDistanciaGeo(pt, o.geometry.coordinates) }))
        .filter(m => m.distancia_m <= TOL_PUNTO_M)
        .sort((a, b) => {
          const pa = esPoste(a.objeto.properties) ? 0 : 1;
          const pb = esPoste(b.objeto.properties) ? 0 : 1;
          if (pa !== pb) return pa - pb;
          return a.distancia_m - b.distancia_m;
        })
        .map(m => {
          const p = m.objeto.properties || {};
          return {
            id: p.id,
            categoria: String(p.categoria || '').toLowerCase(),
            nombre: nombreObjeto(p),
            tipo_nombre: p.tipo_nombre || '',
            distancia_m: m.distancia_m
          };
        });
      return {
        orden: i + 1,
        coords: pt,
        acumulada_m: acumuladas[i],
        objetos: encima,
        poste: encima.find(o => o.categoria === 'poste') || null
      };
    });

    // Postes en orden de recorrido, con la distancia entre postes consecutivos.
    // OJO: el trazado del mapa suele dejar varios puntos pegados al mismo poste
    // (el punto exacto y el de la caja que cuelga de él). Se agrupan en un solo
    // paso y se conserva el punto más próximo al poste, que es el exacto.
    const crudos = [];
    puntos.forEach(p => {
      if (!p.poste) return;
      crudos.push({ punto: p, poste: p.poste, otros: p.objetos.filter(o => o !== p.poste) });
    });

    const agrupados = [];
    crudos.forEach(c => {
      const previo = agrupados[agrupados.length - 1];
      if (previo && previo.poste.id === c.poste.id) {
        if (c.poste.distancia_m < previo.poste.distancia_m) {
          previo.poste = c.poste;
          previo.punto = c.punto;
        }
        c.otros.forEach(o => {
          if (!previo.otros.some(x => x.id === o.id)) previo.otros.push(o);
        });
        return;
      }
      agrupados.push({ punto: c.punto, poste: c.poste, otros: c.otros.slice() });
    });

    const postes = agrupados.map((g, i) => {
      const acumulada = g.punto.acumulada_m;
      const previo = agrupados[i - 1];
      return {
        ...g.poste,
        orden: i + 1,
        orden_trazado: g.punto.orden,
        acumulada_m: acumulada,
        paso_m: previo ? (acumulada - previo.punto.acumulada_m) : 0,
        otros: g.otros
      };
    });

    // Primera y última punta del trazado (de dónde sale y a dónde llega la fibra)
    const conObjeto = puntos.filter(p => p.objetos.length > 0);
    const primero = conObjeto.length ? conObjeto[0] : null;
    const ultimo = conObjeto.length ? conObjeto[conObjeto.length - 1] : null;

    // ── Ruta FÍSICA del trazado (postes_intermedios) ─────────────────────────
    // Si el tramo guardó los postes por los que pasó el usuario, ESA es la ruta
    // real y en su ORDEN de clic (no se reordena por id ni por posición). Las
    // distancias se toman del trazado cuando el poste coincide con la geometría.
    const intermedios = Array.isArray(postesIntermedios)
      ? postesIntermedios.map(n => Number(n)).filter(n => Number.isFinite(n))
      : [];
    const geometriaPorId = new Map();
    postes.forEach(p => { if (!geometriaPorId.has(p.id)) geometriaPorId.set(p.id, p); });
    const objetosPuntuales = _objetosSobreTrazado(features);
    const postesTrazado = intermedios.map((id, i) => {
      const geo = geometriaPorId.get(id);
      if (geo) return { ...geo, orden: i + 1, origen_ruta: 'trazado' };
      const feat = objetosPuntuales.find(o => Number((o.properties || {}).id) === id);
      return {
        id,
        categoria: 'poste',
        nombre: feat ? nombreObjeto(feat.properties || {}) : `Poste #${id}`,
        tipo_nombre: feat ? ((feat.properties || {}).tipo_nombre || '') : '',
        paso_m: null,
        acumulada_m: null,
        orden: i + 1,
        otros: [],
        origen_ruta: 'trazado',
      };
    });

    return {
      trazado,
      total_m: total,
      puntos,
      postes,
      postes_trazado: postesTrazado,
      ruta_trazado: postesTrazado.length > 0,
      punta_a: primero ? primero.objetos[0] : null,
      punta_b: ultimo ? ultimo.objetos[0] : null,
      tiene_postes: postes.length > 0,
      distancia_postes_m: postes.length >= 2
        ? (postes[postes.length - 1].acumulada_m - postes[0].acumulada_m)
        : 0
    };
  }

  /**
   * Feature CANÓNICA de un elemento dentro del inventario del proyecto.
   * Se busca por el id de las propiedades (el id interno del elemento), que es
   * el único que comparten el mapa, el panel y la API.
   */
  function _featureEnInventario(features, id) {
    const objetivo = Number(id);
    if (!Number.isFinite(objetivo)) return null;
    return (features || []).find((f) => {
      if (!f || !f.properties) return false;
      return Number(f.properties.id) === objetivo;
    }) || null;
  }

  /** Aviso al usuario (toast si el módulo está cargado). Devuelve true si avisó. */
  function _avisar(mensaje, tipo) {
    if (window.FTTHTipos && window.FTTHTipos.showToast) {
      window.FTTHTipos.showToast(mensaje, tipo || 'warning');
      return true;
    }
    return false;
  }

  /** Deja el aviso DENTRO del panel (el usuario siempre lo ve, haya toast o no) */
  function _avisoEnPanel(mensaje) {
    const el = document.getElementById('ffi-route-list');
    if (el) el.innerHTML = `<div class="route-empty">⚠ ${escapeHtml(mensaje)}</div>`;
    _avisar(mensaje);
  }

  /** Features del proyecto activo (memoria del mapa o, si no, la API) */
  async function _featuresDelProyecto() {
    const enMemoria = (window.FTTHMapa && Array.isArray(window.FTTHMapa._currentFeatures))
      ? window.FTTHMapa._currentFeatures
      : [];
    if (enMemoria.length) return enMemoria;
    if (!window.currentProjectId) return [];

    const ruta = `/api/elementos/todos?proyecto_id=${window.currentProjectId}`;
    try {
      const res = await fetch(window.apiUrl ? window.apiUrl(ruta) : ruta);
      if (!res.ok) return [];
      const geojson = await res.json();
      return (geojson && geojson.features) || [];
    } catch (e) {
      console.warn('[FTTHFibraInspector] No se pudieron cargar los elementos del proyecto:', e);
      return [];
    }
  }

  /** Garantiza que la estructura HTML del panel inspector exista en el DOM */
  function _ensureDOM() {
    if (_rootEl && document.getElementById('ftth-fibra-inspector-root')) return;

    _rootEl = document.createElement('div');
    _rootEl.id = 'ftth-fibra-inspector-root';
    _rootEl.className = 'inspector-root';

    _rootEl.innerHTML = `
      <div class="inspector-backdrop" id="ffi-backdrop"></div>
      <aside class="inspector" id="ffi-aside" role="dialog" aria-labelledby="ffi-title">
        <header class="inspector-header">
          <div>
            <div class="inspector-eyebrow">Propiedades de fibra</div>
            <div class="inspector-title" id="ffi-title">Cargando...</div>
          </div>
          <button class="inspector-close" id="ffi-close" title="Cerrar">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </header>

        <nav class="segmented" role="tablist">
          <button class="active" id="ffi-tab-info" data-panel="ffi-panel-info" role="tab">
            <i class="fa-solid fa-circle-info"></i> Información
          </button>
          <button id="ffi-tab-ruta" data-panel="ffi-panel-ruta" role="tab">
            <i class="fa-solid fa-route"></i> Ruta de fibra
          </button>
        </nav>

        <div class="inspector-body">
          <!-- PANEL INFORMACIÓN -->
          <div class="panel active" id="ffi-panel-info">
            <div class="form-section-title">Identificación</div>

            <div class="field-row">
              <label>Nombre:</label>
              <div class="control">
                <input type="text" id="ffi-field-name" value="">
                <button class="btn-sync" id="ffi-btn-sync-name" title="Regenerar nombre por defecto"><i class="fa-solid fa-arrows-rotate"></i></button>
              </div>
            </div>

            <div class="field-row">
              <label>Tipo de cable:</label>
              <div class="control">
                <select id="ffi-field-tipo"></select>
              </div>
            </div>

            <div class="field-row">
              <label>Nivel:</label>
              <div class="control">
                <select id="ffi-field-nivel">
                  <option value="Distribución">Distribución</option>
                  <option value="Alimentación">Alimentación</option>
                  <option value="Acceso (Drop)">Acceso (Drop)</option>
                  <option value="Terciario">Terciario</option>
                </select>
              </div>
            </div>

            <div class="field-row">
              <label>Etiquetas:</label>
              <div class="control">
                <select id="ffi-field-etiquetas">
                  <option value="Fibra Óptica">Fibra Óptica</option>
                  <option value="ADSS">ADSS</option>
                  <option value="DROP">DROP</option>
                  <option value="Subterráneo">Subterráneo</option>
                </select>
              </div>
            </div>

            <div class="field-row">
              <label>Color:</label>
              <div class="control">
                <div class="color-swatch" id="ffi-color-swatch"></div>
                <select id="ffi-field-color">
                  <option value="#0071e3">Azul (#0071e3)</option>
                  <option value="#ff8c00">Naranja (#ff8c00)</option>
                  <option value="#22c55e">Verde (#22c55e)</option>
                  <option value="#111111">Negro (#111111)</option>
                  <option value="#708090">Gris (#708090)</option>
                </select>
              </div>
            </div>

            <div class="divider"></div>

            <div class="form-section-title">Estado</div>
            <div class="field-row">
              <label>Implantación:</label>
              <div class="control checkbox-group">
                <label><input type="checkbox" id="ffi-chk-implantado"> Implantado</label>
                <label><input type="checkbox" id="ffi-chk-no-implantado" checked> No implantado</label>
              </div>
            </div>

            <div class="divider"></div>

            <div class="form-section-title">Trazado</div>
            <div class="two-col" style="margin-bottom:14px;">
              <div class="field-row"><label>Primera punta (A):</label><div class="control"><input type="text" id="ffi-punta-a" readonly value="—"></div></div>
              <div class="field-row"><label>Segunda punta (B):</label><div class="control"><input type="text" id="ffi-punta-b" readonly value="—"></div></div>
            </div>

            <div class="two-col" style="margin-bottom:14px;">
              <div class="field-row"><label>Postes en ruta:</label><div class="control"><input type="text" id="ffi-postes-ruta" readonly value="—"></div></div>
              <div class="field-row"><label>Distancia entre postes:</label><div class="control"><input type="text" id="ffi-dist-postes" readonly value="—"></div></div>
            </div>

            <div class="two-col" style="margin-bottom:14px;">
              <div class="field-row"><label>Buffers (Looses):</label><div class="control"><input type="text" id="ffi-looses" readonly value="1"></div></div>
              <div class="field-row"><label>Ocupación:</label><div class="control"><span class="badge-readonly" id="ffi-ocupacion-badge">0 / 12</span></div></div>
            </div>

            <div class="two-col" style="margin-bottom:14px;">
              <div class="field-row">
                <label>Longitud plana:</label>
                <div class="control">
                  <input type="text" id="ffi-longitud" value="0">
                  <select id="ffi-longitud-unit" style="max-width:66px;"><option value="m">m</option><option value="km">km</option></select>
                </div>
              </div>
              <div class="field-row">
                <label>Longitud 3D:</label>
                <div class="control">
                  <input type="text" value="—" readonly>
                </div>
              </div>
            </div>

            <div class="divider"></div>

            <div class="field-row" style="align-items:flex-start; margin-bottom:0;">
              <label>Observaciones:</label>
              <div class="control"><textarea id="ffi-observaciones" rows="3" placeholder="Notas sobre esta fibra..."></textarea></div>
            </div>
          </div>

          <!-- PANEL RUTA DE FIBRA -->
          <div class="panel" id="ffi-panel-ruta">
            <div class="form-section-title">Recorrido de la fibra</div>
            <div class="route-summary" id="ffi-route-summary">
              <!-- Dinámico -->
            </div>
            <div class="route" id="ffi-route-list">
              <!-- Dinámico -->
            </div>
          </div>
        </div>

        <footer class="inspector-footer">
          <button class="btn" id="ffi-btn-cancel">Cancelar</button>
          <button class="btn btn-primary" id="ffi-btn-save">Guardar</button>
        </footer>
      </aside>
    `;

    document.body.appendChild(_rootEl);
    _bindEvents();
  }

  function _bindEvents() {
    if (!_rootEl) return;

    // Cerrar: solo con X, botón Cancelar, o Escape
    // (el backdrop ya no captura clics — el mapa debe seguir manejable)
    const cerrar = () => cerrarInspector();
    _rootEl.querySelector('#ffi-close')?.addEventListener('click', cerrar);
    _rootEl.querySelector('#ffi-btn-cancel')?.addEventListener('click', cerrar);

    // ESC para cerrar
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _rootEl && _rootEl.classList.contains('active')) {
        cerrarInspector();
      }
    });

    // Pestañas segmentadas
    _rootEl.querySelectorAll('.segmented button').forEach(btn => {
      btn.addEventListener('click', () => {
        _rootEl.querySelectorAll('.segmented button').forEach(b => b.classList.remove('active'));
        _rootEl.querySelectorAll('.inspector-body .panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.dataset.panel;
        _rootEl.querySelector('#' + targetId)?.classList.add('active');
      });
    });

    // Checkboxes implantación mutuamente exclusivos
    const chkImp = _rootEl.querySelector('#ffi-chk-implantado');
    const chkNoImp = _rootEl.querySelector('#ffi-chk-no-implantado');
    if (chkImp && chkNoImp) {
      chkImp.addEventListener('change', () => { if (chkImp.checked) chkNoImp.checked = false; });
      chkNoImp.addEventListener('change', () => { if (chkNoImp.checked) chkImp.checked = false; });
    }

    // Color swatch selector
    const selColor = _rootEl.querySelector('#ffi-field-color');
    const swatch = _rootEl.querySelector('#ffi-color-swatch');
    if (selColor && swatch) {
      selColor.addEventListener('change', () => { swatch.style.background = selColor.value; });
    }

    // Botón Guardar
    _rootEl.querySelector('#ffi-btn-save')?.addEventListener('click', _guardar);
  }

  /** Abre el inspector de propiedades para un cable dado su ID o feature completa */
  async function abrir(cableId, featureObj) {
    _ensureDOM();
    _cableId = Number(cableId || (featureObj && featureObj.properties && featureObj.properties.id));
    if (!_cableId) return;

    // Abrir panel con animación
    _rootEl.classList.add('active');
    document.getElementById('ffi-title').textContent = `Cargando fibra #${_cableId}...`;

    try {
      // Cargar tipos de cable para el selector
      if (window.FTTHTipos && window.FTTHTipos.getTipos) {
        const tipos = await window.FTTHTipos.getTipos('cables');
        const sel = document.getElementById('ffi-field-tipo');
        if (sel && tipos) {
          sel.innerHTML = tipos.map(t => `<option value="${t.id}">${escapeHtml(t.nombre_id || t.codigo || t.nombre)}</option>`).join('');
        }
      }

      // Cargar datos completos del elemento. Si la API no responde se AVISA: antes
      // esto fallaba en silencio y el panel se quedaba con la ruta vacía sin decir
      // por qué (el endpoint GET /api/elementos/{id} ni siquiera existía).
      let feat = featureObj;
      if (!feat || !feat.properties || !feat.geometry) {
        const rutaElem = window.apiUrl ? window.apiUrl(`/api/elementos/${_cableId}`) : `/api/elementos/${_cableId}`;
        try {
          const res = await fetch(rutaElem);
          if (res.ok) {
            feat = await res.json();
          } else {
            _avisar(`No se pudieron leer las propiedades de la fibra #${_cableId} (la API respondió ${res.status}).`);
          }
        } catch (err) {
          _avisar(`No se pudieron leer las propiedades de la fibra #${_cableId}: ${err.message}`);
        }
      }

      _cableData = feat || {};
      const props = _cableData.properties || _cableData;
      const instProps = parseJSON(props.propiedades_instancia);
      const tipoProps = parseJSON(props.propiedades_tipo);

      // Cargar hilos y tubos del cable
      try {
        const hRes = await fetch((window.apiUrl ? window.apiUrl(`/api/cables/${_cableId}/hilos`) : `/api/cables/${_cableId}/hilos`));
        if (hRes.ok) _hilosData = await hRes.json();
      } catch(e) { _hilosData = null; }

      // ── Poblar Panel Información ─────────────────────────────────────────
      const nombre = instProps.nombre || instProps.name || props.tipo_nombre || `Cable #${_cableId}`;
      document.getElementById('ffi-title').textContent = nombre;
      document.getElementById('ffi-field-name').value = nombre;

      if (props.tipo_id) {
        const selTipo = document.getElementById('ffi-field-tipo');
        if (selTipo) selTipo.value = String(props.tipo_id);
      }

      const nivel = instProps.nivel || tipoProps.nivel || 'Distribución';
      document.getElementById('ffi-field-nivel').value = nivel;

      const colorVal = instProps.color || props.color || '#0071e3';
      const selColor = document.getElementById('ffi-field-color');
      if (selColor) { selColor.value = colorVal; }
      const swatch = document.getElementById('ffi-color-swatch');
      if (swatch) swatch.style.background = colorVal;

      const imp = instProps.implantado === true;
      document.getElementById('ffi-chk-implantado').checked = imp;
      document.getElementById('ffi-chk-no-implantado').checked = !imp;

      const obs = instProps.notes || instProps.observaciones || props.observaciones || '';
      document.getElementById('ffi-observaciones').value = obs;

      // Puntas y Ocupación
      const tubos = (_hilosData && _hilosData.tubos) || [];
      const totalHilos = tubos.reduce((s, t) => s + ((t.hilos || []).length), 0) || tipoProps.fibras || 12;
      const usadasHilos = tubos.reduce((s, t) => s + (t.hilos || []).filter(h => h.estado && h.estado !== 'libre').length, 0);

      document.getElementById('ffi-looses').value = String(tubos.length || tipoProps.looses || 1);
      document.getElementById('ffi-ocupacion-badge').textContent = `${usadasHilos} / ${totalHilos}`;

      // ── Trazado: todo se deduce del recorrido real de la fibra ───────────
      // (desde su punto de origen hasta su punto final, no de datos sueltos)
      //
      // La geometría CANÓNICA es la del INVENTARIO del proyecto. La que llega en
      // `featureObj` puede ser un FRAGMENTO: los eventos de capa de MapLibre
      // devuelven la geometría de la TESELA bajo el cursor (recortada y, si el
      // recorte la parte, un MultiLineString), no la del source. Deducir la ruta
      // de ese fragmento hacía que «Ver ruta» mostrara solo los postes del trozo
      // clicado: ruta completa o incompleta según DÓNDE se hiciera clic.
      const features = await _featuresDelProyecto();
      const enInventario = _featureEnInventario(features, _cableId);
      const geomInventario = enInventario ? enInventario.geometry : null;
      const geomRecibida = featureObj ? featureObj.geometry : null;
      const lineal = (g) => (esTrazadoLineal(g) ? g : null);
      const geom = lineal(geomInventario) || lineal(_cableData.geometry) || lineal(geomRecibida) || null;
      const coords = coordsDeTrazado(geom);

      // Nunca se calla una ruta calculada con datos de menos.
      let avisoTrazado = '';
      if (!lineal(geomInventario)) {
        if (lineal(geomRecibida)) {
          avisoTrazado = 'Ruta calculada con la geometría recibida del mapa: puede estar recortada '
            + '(no se encontró esta fibra en el inventario del proyecto).';
          console.warn('[FTTHFibraInspector] Sin geometría en el inventario: se usa la del evento '
            + 'de clic (puede estar recortada por teselas).');
        } else {
          avisoTrazado = `No se encontró la geometría de la fibra #${_cableId}: no hay recorrido que mostrar.`;
        }
      }

      const recorrido = resolverRecorridoFibra(coords, features, instProps.postes_intermedios);
      const distTotal = recorrido.total_m;
      document.getElementById('ffi-longitud').value = distTotal.toFixed(2);

      // Primera y última punta: se toman del trazado (con respaldo en los extremos lógicos)
      const extA = props.extremos && props.extremos.A
        ? (props.extremos.A.nombre || `Nodo #${props.extremos.A.nodo_id}`)
        : (instProps.extremo_a || '');
      const extB = props.extremos && props.extremos.B
        ? (props.extremos.B.nombre || `Nodo #${props.extremos.B.nodo_id}`)
        : (instProps.extremo_b || '');
      const puntaA = (recorrido.punta_a && recorrido.punta_a.nombre) || extA || '—';
      const puntaB = (recorrido.punta_b && recorrido.punta_b.nombre) || extB || '—';
      _ponerPunta('ffi-punta-a', puntaA, recorrido.punta_a, 'de origen');
      _ponerPunta('ffi-punta-b', puntaB, recorrido.punta_b, 'final');

      // Resumen del recorrido (visible también en «Información»)
      const nPostes = recorrido.postes.length;
      document.getElementById('ffi-postes-ruta').value = nPostes
        ? `${nPostes}${nPostes === 1 ? ' poste' : ' postes'}${recorrido.ruta_trazado ? ' (ruta de trazado)' : ''}`
        : '— (la fibra no pasa por postes)';
      document.getElementById('ffi-dist-postes').value = nPostes >= 2
        ? `${recorrido.distancia_postes_m.toFixed(1)} m`
        : '—';

      // ── Poblar Panel Ruta de Fibra (postes y distancia entre ellos) ──────
      _poblarRuta(recorrido, puntaA, puntaB, avisoTrazado);

      // Si la fibra pasa por postes, el clic derecho abre la ruta directamente
      _activarPestana(nPostes ? 'ruta' : 'info');

    } catch (e) {
      console.error('[FTTHFibraInspector] Error cargando cable:', e);
      document.getElementById('ffi-title').textContent = `Cable #${_cableId}`;
      // Antes este camino terminaba sin decir nada al usuario (solo en consola).
      _avisoEnPanel(`No se pudieron cargar las propiedades de la fibra #${_cableId}: ${e.message || e}`);
    }
  }

  /** Escribe una punta del trazado y explica en el tooltip de dónde salió */
  function _ponerPunta(idInput, texto, objeto, etiqueta) {
    const input = document.getElementById(idInput);
    if (!input) return;
    input.value = texto;
    input.title = objeto && objeto.id != null
      ? `Punta ${etiqueta} del trazado: ${objeto.nombre} (id #${objeto.id})`
      : `Punta ${etiqueta}: no hay ningún objeto del inventario sobre ese punto`;
  }

  /** Activa una pestaña del panel segmentado (info | ruta) */
  function _activarPestana(nombre) {
    if (!_rootEl) return;
    const boton = _rootEl.querySelector('#ffi-tab-' + nombre);
    if (!boton) return;
    _rootEl.querySelectorAll('.segmented button').forEach(b => b.classList.remove('active'));
    _rootEl.querySelectorAll('.inspector-body .panel').forEach(p => p.classList.remove('active'));
    boton.classList.add('active');
    const panel = _rootEl.querySelector('#' + boton.dataset.panel);
    if (panel) panel.classList.add('active');
  }

  /** Ícono + nombre de un objeto de la ruta (usa los SVG del panel izquierdo) */
  function _filaObjeto(objeto) {
    return `<div class="route-name">${_icono(objeto.categoria, 14, 'route-ico')}`
      + `<span>${escapeHtml(objeto.nombre)}</span></div>`;
  }

  /**
   * Genera el timeline del recorrido: los postes por los que pasa la fibra y la
   * distancia entre ellos. Si la fibra no pasa por ningún poste no se dibuja
   * ruta: sólo se informa la longitud total.
   *
   * @param {string} [aviso] Si la ruta se calculó con datos de menos (geometría
   *   recibida del mapa en vez del inventario), se deja VISIBLE en el panel.
   */
  function _poblarRuta(recorrido, puntaA, puntaB, aviso) {
    const summaryEl = document.getElementById('ffi-route-summary');
    const routeListEl = document.getElementById('ffi-route-list');
    if (!summaryEl || !routeListEl || !recorrido) return;

    const total = recorrido.total_m || 0;
    // La ruta del trazado (orden de clic, guardada con el cable) MANDA sobre la
    // deducida de la geometría: es la ruta física que registró el usuario.
    const postes = (recorrido.postes_trazado && recorrido.postes_trazado.length)
      ? recorrido.postes_trazado
      : (recorrido.postes || []);

    // Requisito: sin postes no se arma ruta; sólo la longitud total
    if (!postes.length) {
      summaryEl.innerHTML = `
        <span class="rs-item">${_icono('cables', 14)} ${total.toFixed(1)} m total</span>
        <span class="rs-sep">·</span>
        <span class="rs-item"><i class="fa-solid fa-ruler-horizontal"></i> sin postes en la ruta</span>
      `;
      routeListEl.innerHTML = `
        <div class="route-empty">
          Esta fibra no pasa por postes.<br>
          Longitud total de la fibra: <b>${total.toFixed(1)} m</b>.
          ${aviso ? `<br><b>⚠ ${escapeHtml(aviso)}</b>` : ''}
        </div>
      `;
      return;
    }

    summaryEl.innerHTML = `
      <span class="rs-item">${_icono('poste', 14)} <span>${postes.length}</span> ${postes.length === 1 ? 'poste' : 'postes'}</span>
      <span class="rs-sep">·</span>
      <span class="rs-item"><i class="fa-solid fa-ruler-horizontal"></i> ${total.toFixed(1)} m total</span>
      <span class="rs-sep">·</span>
      <span class="rs-item">${recorrido.ruta_trazado
        ? `<i class="fa-solid fa-route"></i> orden de trazado`
        : `${_icono('cables', 14)} ${escapeHtml(puntaA)} → ${escapeHtml(puntaB)}`}</span>
      ${aviso ? `<span class="rs-sep">·</span><span class="rs-item">⚠ ${escapeHtml(aviso)}</span>` : ''}
    `;

    let routeHtml = '';
    postes.forEach((poste, idx) => {
      const esInicio = idx === 0;
      const esFin = idx === postes.length - 1;
      const claseItem = esInicio ? 'start' : (esFin ? 'end' : '');
      const etiqueta = esInicio ? 'Inicio' : (esFin ? 'Fin' : 'Punto de paso');
      const claseTag = esInicio ? 'tag tag-start' : (esFin ? 'tag tag-end' : 'tag');

      // Objetos colgados del poste (caja NAP, manga, reserva…) con su ícono
      const anclados = (poste.otros || [])
        .map(o => `<span class="tag tag-anclado">${_icono(o.categoria, 12)}${escapeHtml(o.nombre)}</span>`)
        .join('');

      const distTexto = esInicio
        ? '0 m'
        : (Number.isFinite(poste.paso_m) && Number.isFinite(poste.acumulada_m)
            ? `+${poste.paso_m.toFixed(1)} m<small>acum. ${poste.acumulada_m.toFixed(1)} m</small>`
            : '<small>sin medida</small>');

      routeHtml += `
        <div class="route-item ${claseItem}" data-poste-id="${poste.id}">
          <div class="route-line"><div class="route-dot">${poste.orden}</div></div>
          <div class="route-content">
            ${_filaObjeto(poste)}
            <div class="route-meta">
              <span class="${claseTag}">${etiqueta}</span>
              ${poste.tipo_nombre ? `<span>${escapeHtml(poste.tipo_nombre)}</span>` : ''}
              ${anclados}
            </div>
          </div>
          <div class="route-dist">${distTexto}</div>
        </div>
      `;
    });

    routeListEl.innerHTML = routeHtml;

    // Clic en un poste de la lista → centrar en el mapa y resaltar con pulso
    routeListEl.querySelectorAll('.route-item[data-poste-id]').forEach(item => {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        const posteId = Number(item.dataset.posteId);
        if (!Number.isFinite(posteId)) return;
        if (window.FTTHMapa && window.FTTHMapa.resaltarElemento) {
          window.FTTHMapa.resaltarElemento(posteId);
        }
        // Retroalimentación visual inmediata en el propio item de la lista
        item.style.background = 'rgba(0,113,227,0.07)';
        setTimeout(() => { item.style.background = ''; }, 1200);
      });
    });
  }

  function cerrarInspector() {
    if (_rootEl) _rootEl.classList.remove('active');
  }

  /** Guarda las modificaciones del panel de información */
  async function _guardar() {
    if (!_cableId) return;
    const nameVal = document.getElementById('ffi-field-name').value.trim();
    const tipoVal = document.getElementById('ffi-field-tipo').value;
    const nivelVal = document.getElementById('ffi-field-nivel').value;
    const colorVal = document.getElementById('ffi-field-color').value;
    const impVal = document.getElementById('ffi-chk-implantado').checked;
    const obsVal = document.getElementById('ffi-observaciones').value.trim();

    const propsOrig = (_cableData && _cableData.properties) ? _cableData.properties : {};
    const instPropsOrig = parseJSON(propsOrig.propiedades_instancia);

    instPropsOrig.nombre = nameVal;
    instPropsOrig.name = nameVal;
    instPropsOrig.nivel = nivelVal;
    instPropsOrig.color = colorVal;
    instPropsOrig.implantado = impVal;
    instPropsOrig.notes = obsVal;

    const payload = {
      tipo_id: Number(tipoVal || propsOrig.tipo_id),
      propiedades_instancia: instPropsOrig,
    };

    try {
      const url = window.apiUrl ? window.apiUrl(`/api/elementos/${_cableId}`) : `/api/elementos/${_cableId}`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Error ${res.status}`);

      if (window.FTTHTipos && window.FTTHTipos.showToast) {
        window.FTTHTipos.showToast('✓ Propiedades de fibra guardadas', 'success');
      }

      // Refrescar mapa si está disponible
      if (window.FTTHMapa && window.FTTHMapa.cargarTodosElementos) {
        window.FTTHMapa.cargarTodosElementos();
      }

      cerrarInspector();
    } catch (e) {
      console.error('[FTTHFibraInspector] Error al guardar:', e);
      if (window.FTTHTipos && window.FTTHTipos.showToast) {
        window.FTTHTipos.showToast('Error al guardar propiedades: ' + e.message, 'error');
      }
    }
  }

  return {
    abrir,
    cerrarInspector,
    // Funciones puras: las usan las pruebas y cualquier panel que necesite
    // saber por dónde pasa una fibra sin abrir el inspector.
    resolverRecorridoFibra,
    normalizarTrazado,
    longitudTrazado,
    calcularDistanciaGeo,
    // Utilidades de geometría: la geometría del evento de clic puede venir como
    // MultiLineString (recorte por teselas) y hay que saber tratarla.
    esTrazadoLineal,
    coordsDeTrazado
  };

})();

window.FTTHFibraInspector = FTTHFibraInspector;
