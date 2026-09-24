/**
 * ftth-diagrama.js
 * Diagrama lógico de un nodo (F3, solo lectura).
 *
 * Qué muestra, para una caja/manga/ODF/armario/OLT:
 *   - Cabecera con el tipo, el box_id, el estado y si conmuta hilos.
 *   - Columna 1: los hilos que TERMINAN en el nodo (con su cable, tubo, extremo y estado).
 *   - Columna 2: las bandejas con sus posiciones (slots de empalme).
 *   - Columna 3: los dispositivos (splitter, adaptador...) con sus puertos IN/OUT/BIDI.
 *   - Pie: las advertencias que calcula el backend.
 *
 * Qué NO hace (diseño no destructivo, docs/DISENO_CAPA_LOGICA.md §12):
 *   - No escribe nada: la edición de empalmes llega en F4.
 *   - No toca el mapa, ni los tipos, ni los iconos, ni los objetos.
 *
 * Se abre desde ftth-mapa.js con un clic izquierdo en un nodo (o desde el menú contextual).
 */
const FTTHDiagrama = (() => {

  const NODOS = ['cajanap', 'manga', 'odf', 'armario', 'olt', 'splitter', 'fusion'];
  const ETIQUETA = {
    cajanap: 'Caja NAP', manga: 'Manga', odf: 'ODF', armario: 'Armario',
    olt: 'OLT', splitter: 'Splitter', fusion: 'Fusión',
  };
  const ETIQUETA_ESTADO = {
    libre: 'Libre', empalmado: 'Empalmado', conectado: 'Conectado',
    reservado: 'Reservado', averiado: 'Averiado',
  };

  let _datos = null;
  let _boxId = null;
  let _sel = null;          // { tipo: 'hilo'|'puerto', id }
  let _cargando = false;
  let _uiLista = false;
  let _pos = {};            // { idDispositivo: { x, y } } orden del lienzo
  let _medidas = {};        // { idDispositivo: { w, h } } medidas reales de las tarjetas
  let _posSucias = false;   // hay aparatos movidos sin guardar (disquete pendiente)

  // ── Área libre de aparatos (arrastrar + guardar) ──────────────────────────
  // Los splitters ya no se apilan uno debajo del otro: cada uno vive en su
  // propio sitio dentro de un área donde el usuario lo coloca donde quiera y
  // el disquete guarda ese orden para encontrarlo igual al volver a abrir.
  const NODO_ANCHO = 340;      // ancho de la tarjeta de un aparato (px de lienzo)
  const NODO_ALTO = 280;       // alto de partida hasta poder medir la tarjeta
  const NODO_SEP = 18;         // separación entre tarjetas de la rejilla
  const AREA_MARGEN = 12;      // margen interior del área
  const AREA_COLUMNAS = 2;     // 2 por fila: dos splitters quedan lado a lado
  const AREA_ANCHO_MIN = NODO_ANCHO + AREA_MARGEN * 2;
  const AREA_ALTO_MIN = NODO_ALTO + AREA_MARGEN * 2;

  // El lienzo NO tiene recuadro: un aparato se puede mover a cualquier lado,
  // incluso a la izquierda o arriba del origen (x/y negativas). El único tope
  // es de cordura, para que un arrastre desbocado no guarde un número absurdo.
  const POSICION_MAX = 50000;

  // ── Ventana del diagrama: pantalla completa y tamaño ajustable ────────────
  // Como una ventana de Windows: se maximiza y se redimensiona por la esquina,
  // y el tamaño elegido se recuerda para la próxima vez.
  const PANEL_MIN_W = 640;
  const PANEL_MIN_H = 420;
  const PANEL_CLAVE = 'ftth.diagrama.panel';
  let _redimensionando = null;

  // ── Utilidades ────────────────────────────────────────────────────────────
  function apiUrl(path) {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const origin = window.location.origin;
    if (origin && origin !== 'null' && !origin.includes('file://')) {
      return origin + (path.startsWith('/') ? path : '/' + path);
    }
    return 'http://127.0.0.1:8000' + (path.startsWith('/') ? path : '/' + path);
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function aviso(msg, tipo) {
    if (window.FTTHTipos && window.FTTHTipos.showToast) window.FTTHTipos.showToast(msg, tipo || 'info');
    else console.log('[diagrama]', msg);
  }

  function esNodo(categoria) {
    return NODOS.includes(String(categoria || '').toLowerCase());
  }

  /**
   * División declarada por una plantilla del catálogo: '1x16', '2x8'...
   * Se usa solo para informar en el selector de splitter; la división real la
   * calcula el backend a partir de estas mismas propiedades.
   */
  function divisionDeTipo(tipo) {
    const props = (tipo && (tipo.propiedades || tipo.propiedades_tipo)) || {};
    const declarada = String(props.relacion_division || props.division || '').trim();
    const hallada = declarada.match(/(\d+)\s*[xX]\s*(\d+)/);
    if (hallada) return `${hallada[1]}x${hallada[2]}`;
    const salidas = Number(props.salidas);
    if (Number.isFinite(salidas) && salidas > 0) {
      const entradas = Number(props.entradas);
      return `${Number.isFinite(entradas) && entradas > 0 ? entradas : 1}x${salidas}`;
    }
    return '';
  }

  // ── Referencias del modal ─────────────────────────────────────────────────
  function modal() { return document.getElementById('ftth-diagrama-modal'); }
  function cuerpo() { return document.getElementById('diag-body'); }
  function pie() { return document.getElementById('diag-pie'); }
  function titulo() { return document.getElementById('diag-title'); }
  function badge() { return document.getElementById('diag-badge'); }
  function marca() { return document.getElementById('diag-mark'); }
  function sub() { return document.getElementById('diag-sub'); }

  function cerrar() {
    const m = modal();
    if (m) m.classList.add('hidden');
    _sel = null;
  }

  function abrir(boxId, opciones) {
    const m = modal();
    if (!m) {
      aviso('No se encontró el modal del diagrama (revisa index.html).', 'error');
      return;
    }
    const opts = opciones || {};
    _boxId = boxId;
    _sel = null;
    _datos = null;
    _pos = {};
    _medidas = {};
    _posSucias = false;
    _mueble = null;
    marcarPendiente(false);
    reiniciarVista();
    restaurarPanel();   // el tamaño que el usuario dejó la última vez

    // Un solo modal a la vez: se cierra el de propiedades si estaba abierto
    const props = document.getElementById('element-properties-modal');
    if (props) props.classList.add('hidden');

    m.classList.remove('hidden');
    bindChrome();
    if (titulo()) titulo().textContent = opts.tipoNombre ? `${opts.tipoNombre} #${boxId}` : `Nodo #${boxId}`;
    if (badge()) {
      badge().textContent = 'Cargando…';
      badge().classList.remove('diag-status--off');
    }
    if (marca()) {
      marca().innerHTML = (window.FTTHIconos && opts.categoria) ? window.FTTHIconos.imgHtml(opts.categoria, 18) : '';
    }
    if (sub()) sub().innerHTML = '';
    if (cuerpo()) cuerpo().innerHTML = '<div class="diag-vacio">Cargando el diagrama lógico…</div>';
    if (pie()) pie().innerHTML = '';

    cargar();
  }

  async function cargar() {
    if (!_boxId || _cargando) return;
    _cargando = true;
    try {
      // cache: 'no-store' → tras agregar un aparato, el refresco trae el dato real.
      // Sin esto el navegador puede devolver la copia cacheada del nodo anterior,
      // que es el bug de "agrego el splitter y el diagrama sigue igual".
      const res = await fetch(apiUrl(`/api/elementos/${_boxId}/nodo`), { cache: 'no-store' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        mostrarError(err.detail || `No se pudo leer el nodo (error ${res.status}).`);
        return;
      }
      _datos = await res.json();
      pintar();
    } catch (e) {
      console.error('[diagrama] error de red:', e);
      mostrarError('No se pudo contactar al servidor.');
    } finally {
      _cargando = false;
    }
  }

  function mostrarError(texto) {
    if (cuerpo()) cuerpo().innerHTML = `<div class="diag-error">${escapeHtml(texto)}</div>`;
    if (badge()) badge().textContent = 'Error';
  }


  function pintar() {
    const d = _datos;
    if (!d || !cuerpo()) return;
    const nodo = d.nodo || {};
    const r = d.resumen || {};

    if (titulo()) titulo().textContent = `${nodo.tipo_nombre || 'Nodo'} #${nodo.box_id}`;
    if (badge()) {
      badge().textContent = nodo.estado || 'Activo';
      badge().classList.toggle('diag-status--off', nodo.conmuta_hilos === false);
    }
    if (marca() && window.FTTHIconos) marca().innerHTML = window.FTTHIconos.imgHtml(nodo.categoria, 18);

    // ── Populate identity bar with node name and code ──
    const identName = document.getElementById('diag-identity-name');
    const identCode = document.getElementById('diag-identity-code');
    if (identName) identName.textContent = nodo.nombre || nodo.tipo_nombre || ('Nodo #' + nodo.box_id);
    if (identCode) identCode.textContent = nodo.codigo || nodo.box_id || '—';

    if (sub()) { sub().innerHTML = ''; }

    // El orden del lienzo se decide ANTES de pintar: cada tarjeta nace ya en su
    // sitio (el guardado o la rejilla de dos columnas, nunca apiladas).
    const sitios = calcularSitios(d.dispositivos || []);

    cuerpo().innerHTML =
      `<div class="diag-col">${colHilos(d)}</div>` +
      `<div class="diag-col">${colBandejas(d)}</div>` +
      colDispositivos(d, sitios);

    pintarPie();
    bindClicks();
    acomodar();   // mide las tarjetas y dimensiona el área de aparatos

    // Si el usuario no ha navegado a mano, se enfoca solo: al abrir el nodo se
    // centra en los SPLITTERS con zoom normal, y si cambia el contenido (por
    // ejemplo al agregar uno) se vuelve a encuadrar.
    if (!_vistaTocada) {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(centrarAlAbrir);
      else centrarAlAbrir();
    }
  }

  function colHilos(d) {
    const hilos = d.hilos_que_terminan || [];
    if (!hilos.length) return '';
    let h = `<div class="diag-col-title">Hilos <span>(${hilos.length})</span></div>`;
    const porCable = new Map();
    hilos.forEach((x) => {
      if (!porCable.has(x.cable_id)) {
        porCable.set(x.cable_id, {
          cable_id: x.cable_id,
          nombre: x.cable,
          // El tipo REAL del cable (lo manda el backend en cada hilo): de aquí salen
          // el número de hilos, el envase (looses/fibrasLoose) y su plantilla visual.
          tipo: x.cable_tipo || null,
          items: [],
        });
      }
      porCable.get(x.cable_id).items.push(x);
    });

    porCable.forEach((g) => {
      // Plantilla que DECLARA el tipo (fibra_cable con buffer / fibra_cable_drop).
      // Nada de claves fijas: si el tipo no la declara, se cae al respaldo por categoría.
      const propsTipo = g.tipo || {};
      const clave = window.FTTHPlantillas.resolverTipo({ categoria: 'cables', propiedades: propsTipo });
      if (window.FTTHPlantillas && typeof window.FTTHPlantillas.render === 'function' && clave) {
        const datosVisuales = window.FTTHPlantillas.datosFibra(
          { id: g.cable_id, tipo: 'cables', nombre: g.nombre, propiedades_tipo: propsTipo },
          [],
          g.nombre
        );
        // Los hilos anclados a este nodo, para pintar sus colores/estados reales
        datosVisuales.hilosReales = g.items;
        const cardHtml = window.FTTHPlantillas.render(clave, datosVisuales);
        if (cardHtml) {
          h += '<div class="diag-grupo" style="margin-bottom:12px;">';
          h += cardHtml;
          h += `<button type="button" onclick="if(window.showPropertiesModalById) window.showPropertiesModalById(${g.cable_id})" style="margin-top:6px;width:100%;padding:6px 12px;background:#f5f5f7;color:#1d1d1f;border:1px solid #d1d1d6;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">🔍 Propiedades de ${escapeHtml(g.nombre)}</button>`;
          
          h += '<div class="diag-items" style="margin-top:8px;">';
          g.items.forEach((x) => {
            const sel = (_sel && _sel.tipo === 'hilo' && _sel.id === x.fibra_id) ? ' sel' : '';
            const titulo = `${x.nombre} · extremo ${x.extremo} · ${x.estado}`;
            h += `<button type="button" class="diag-hilo${sel}" data-hilo="${x.fibra_id}" title="${escapeHtml(titulo)}">`
              + `<span class="diag-hilo-franja" style="background:${escapeHtml(x.color_hex || '#888')}"></span>`
              + `<span class="diag-hilo-nombre">${escapeHtml(x.nombre)}</span>`
              + `<span class="diag-hilo-ext">${escapeHtml(x.extremo)}</span>`
              + `<span class="diag-estado diag-estado--${escapeHtml(x.estado)}">`
              + `${escapeHtml(ETIQUETA_ESTADO[x.estado] || x.estado)}</span>`
              + '</button>';
          });
          h += '</div></div>';
          return;
        }
      }

      // Fallback si no hay plantilla visual
      h += '<div class="diag-grupo">';
      h += `<div class="diag-grupo-cab">🔌 <strong onclick="if(window.showPropertiesModalById) window.showPropertiesModalById(${g.cable_id})" style="cursor:pointer;text-decoration:underline;">${escapeHtml(g.nombre)}</strong>`
        + `<span class="diag-grupo-info">${g.items.length} hilo(s)</span></div>`;
      h += '<div class="diag-items">';
      g.items.forEach((x) => {
        const sel = (_sel && _sel.tipo === 'hilo' && _sel.id === x.fibra_id) ? ' sel' : '';
        const titulo = `${x.nombre} · extremo ${x.extremo} · ${x.estado}`;
        h += `<button type="button" class="diag-hilo${sel}" data-hilo="${x.fibra_id}" title="${escapeHtml(titulo)}">`
          + `<span class="diag-hilo-franja" style="background:${escapeHtml(x.color_hex || '#888')}"></span>`
          + `<span class="diag-hilo-nombre">${escapeHtml(x.nombre)}</span>`
          + `<span class="diag-hilo-ext">${escapeHtml(x.extremo)}</span>`
          + `<span class="diag-estado diag-estado--${escapeHtml(x.estado)}">`
          + `${escapeHtml(ETIQUETA_ESTADO[x.estado] || x.estado)}</span>`
          + '</button>';
      });
      h += '</div></div>';
    });
    return h;
  }


  function colBandejas(d) {
    const bandejas = d.bandejas || [];
    if (!bandejas.length) return '';
    let h = `<div class="diag-col-title">Bandejas <span>(${bandejas.length})</span></div>`;
    bandejas.forEach((b) => {
      const slots = b.slots || 0;
      const ocupados = b.ocupados || 0;
      h += `<div class="diag-bandeja" data-borrar="bandeja:${b.id}">`;
      h += `<div class="diag-bandeja-cab">🧰 <strong>Bandeja ${String(b.bandeja_no).padStart(2, '0')}</strong>`
        + `<span class="diag-bandeja-info">${escapeHtml(b.tipo)} · ${ocupados}/${slots} posiciones</span></div>`;
      if (slots) {
        h += '<div class="diag-slots">';
        for (let i = 1; i <= slots; i++) {
          const emp = (b.empalmes || []).find((e) => e.slot === i);
          if (emp) {
            const desc = `${emp.hilo_a ? emp.hilo_a.nombre : '?'} ↔ ${emp.hilo_b ? emp.hilo_b.nombre : '?'}`;
            h += `<div class="diag-slot diag-slot--ocupado" title="${escapeHtml('Posición ' + i + ': ' + desc)}">${i}</div>`;
          } else {
            h += `<div class="diag-slot" title="${escapeHtml('Posición ' + i + ' libre')}">${i}</div>`;
          }
        }
        h += '</div>';
      }
      h += '</div>';
    });
    return h;
  }

  /**
   * Columna de aparatos: un área libre donde cada splitter/adaptador tiene su
   * propio sitio (el guardado o la rejilla). El agarre de la tarjeta permite
   * arrastrarlo, y el disquete guarda el orden para la próxima vez.
   */
  function colDispositivos(d, sitios) {
    const dispositivos = d.dispositivos || [];
    if (!dispositivos.length) return '';
    const puertos = d.puertos || [];
    const mapaSitios = sitios || _pos || {};

    let h = '<div class="diag-col diag-col--libre">';
    h += `<div class="diag-col-title">Dispositivos <span>(${dispositivos.length})</span>`
      + '<span class="diag-col-nota"> · arrástralos y pulsa el disquete para guardar el orden</span></div>';
    h += `<div class="diag-area-dispositivos" id="diag-area-dispositivos"`
      + ` style="width:${AREA_ANCHO_MIN}px; height:${AREA_ALTO_MIN}px;">`;

    dispositivos.forEach((dev) => {
      const mios = puertos.filter((p) => p.dispositivo_id === dev.id);
      const libres = mios.filter((p) => p.estado === 'libre').length;
      const extra = (dev.atenuacion_db != null ? ` · ${dev.atenuacion_db} dB` : '')
        + (dev.serie ? ` · ${dev.serie}` : '');
      const id = Number(dev.id);
      const sitio = mapaSitios[id] || { x: AREA_MARGEN, y: AREA_MARGEN };
      const nombre = escapeHtml(dev.tipo + (dev.division ? ' ' + dev.division : ''));

      // Cada aparato va en su propia caja móvil, con su agarre arriba.
      h += `<div class="diag-nodo-dispositivo" data-dispositivo="${id}"`
        + ` style="left:${Math.round(sitio.x)}px; top:${Math.round(sitio.y)}px;">`;
      h += `<div class="diag-nodo-agarre" data-mover="${id}"`
        + ' title="Arrastra para mover este aparato dentro del diagrama">'
        + '<i class="fa-solid fa-grip-lines"></i>'
        + `<span class="diag-nodo-agarre-nombre">${nombre}</span>`
        + `<span class="diag-nodo-agarre-info">${mios.length} puerto(s) · ${libres} libre(s)</span>`
        + '</div>';

      // 1º) La plantilla visual del objeto: es la ÚNICA tarjeta que se pinta.
      if (window.FTTHPlantillas && typeof window.FTTHPlantillas.paraDispositivo === 'function') {
        const puertoSel = (_sel && _sel.tipo === 'puerto') ? _sel.id : null;
        const vistaSel = window.FTTHPlantillas.paraDispositivo(dev, mios, { puertoSeleccionado: puertoSel });
        if (vistaSel) {
          h += `<div class="diag-dispositivo-vista">${vistaSel}</div>`;
          h += '</div>';
          return;   // ya esta pintado: no se duplica con la tarjeta clasica
        }
      }

      // 2º) Respaldo para los tipos SIN plantilla (adaptador, WDM, pigtail,
      //     switch): si no, desaparecerian del diagrama sin avisar.
      h += `<div class="diag-dispositivo" data-borrar="dispositivo:${dev.id}">`;
      h += `<div class="diag-dispositivo-cab">${dev.tipo === 'splitter' ? '🔀' : '🔌'} `
        + `<strong>${escapeHtml(dev.tipo + (dev.division ? ' ' + dev.division : ''))}</strong>`
        + `<span class="diag-dispositivo-info">${mios.length} puerto(s) · ${libres} libre(s)${escapeHtml(extra)}</span></div>`;

      // (la vista visual se pinta antes, en el paso 1º)
      h += '<div class="diag-dispositivo-puertos">';
      mios.forEach((p) => {
        const sel = (_sel && _sel.tipo === 'puerto' && _sel.id === p.id) ? ' sel' : '';
        let clase = `diag-puerto--${String(p.direccion || '').toLowerCase()}`;
        if (p.estado === 'ocupado') clase += ' diag-puerto--ocupado';
        if (p.estado === 'reservado') clase += ' diag-puerto--reservado';
        const t = `${p.etiqueta} · ${p.estado}${p.tipo_conector ? ' · ' + p.tipo_conector : ''}`;
        h += `<button type="button" class="diag-puerto ${clase}${sel}" data-puerto="${p.id}" title="${escapeHtml(t)}">`
          + `<strong>${escapeHtml(p.etiqueta)}</strong>`
          + (p.tipo_conector ? `<span class="diag-hilo-ext">${escapeHtml(p.tipo_conector)}</span>` : '')
          + '</button>';
      });
      h += '</div></div></div>';
    });

    h += '</div>';   // fin del área de aparatos
    h += '</div>';   // fin de la columna
    // OJO: aquí NO va botón de "Añadir splitter". El único mando para agregar
    // aparatos es la barra inferior de herramientas del diagrama.

    return h;
  }


  function detalleTexto() {
    if (!_sel || !_datos) return '';
    if (_sel.tipo === 'hilo') {
      const x = (_datos.hilos_que_terminan || []).find((t) => t.fibra_id === _sel.id);
      if (!x) return '';
      const holgura = x.holgura_m ? ` · holgura ${x.holgura_m} m` : '';
      return `Hilo <b>${escapeHtml(x.nombre)}</b> de «${escapeHtml(x.cable)}» · tubo ${x.tubo_no}`
        + ` · posición global ${x.hilo_global_no} · extremo <b>${escapeHtml(x.extremo)}</b>${escapeHtml(holgura)}`
        + ` · estado ${escapeHtml(x.estado)}${x.perfil ? ' · perfil ' + escapeHtml(x.perfil) : ''}`;
    }
    const p = (_datos.puertos || []).find((t) => t.id === _sel.id);
    if (!p) return '';
    const dev = (_datos.dispositivos || []).find((x) => x.id === p.dispositivo_id);
    const nombreDev = dev
      ? `${dev.tipo}${dev.division ? ' ' + dev.division : ''}${dev.serie ? ' (' + dev.serie + ')' : ''}`
      : 'dispositivo';
    return `Puerto <b>${escapeHtml(p.etiqueta)}</b> del ${escapeHtml(nombreDev)} · ${escapeHtml(p.estado)}`
      + (p.tipo_conector ? ` · ${escapeHtml(p.tipo_conector)}` : '');
  }

  // Avisos del backend que no se pintan en el lienzo: siguen calculandose en el
  // API, pero son ruido para el usuario (p. ej. el recuento de puertos OUT
  // libres, que ya se ve en el pie de cada tarjeta).
  const AVISOS_OCULTOS = [/OUT libres/i, /disponibles para clientes/i];

  function avisoUtil(texto) {
    const t = String(texto == null ? '' : texto);
    return !AVISOS_OCULTOS.some((re) => re.test(t));
  }

  function pintarPie() {
    const p = pie();
    if (!p) return;
    let h = '';
    if (_sel) h += `<div class="diag-detalle">${detalleTexto()}</div>`;
    const avisos = ((_datos && _datos.advertencias) || []).filter(avisoUtil);
    avisos.forEach((a) => { h += `<div class="diag-aviso">${escapeHtml(a)}</div>`; });
    if (!h) h = '';
    p.innerHTML = h;
  }

  function bindClicks() {
    const c = cuerpo();
    if (!c) return;
    if (_modoEliminar) return;   // en modo eliminar el clic borra, no selecciona
    c.querySelectorAll('[data-hilo]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.dataset.hilo);
        _sel = (_sel && _sel.tipo === 'hilo' && _sel.id === id) ? null : { tipo: 'hilo', id };
        pintar();
      });
    });
    c.querySelectorAll('[data-puerto]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.dataset.puerto);
        _sel = (_sel && _sel.tipo === 'puerto' && _sel.id === id) ? null : { tipo: 'puerto', id };
        pintar();
      });
    });
  }

  // ── Lienzo navegable (zoom + arrastre, sin barras de desplazamiento) ──────
  // El contenido vive en #diag-body y se mueve con transform: translate+scale.
  // Como el origen es 0 0, (x, y) es la esquina del contenido y k su escala.
  // No hay scroll: el viewport recorta y el usuario navega libremente.
  const VISTA_MIN = 0.25;
  const VISTA_MAX = 2.5;
  const VISTA_PASO = 1.12;     // paso de un clic de rueda / boton
  const VISTA_MARGEN = 16;     // margen minimo al encuadrar

  let _vista = { x: 0, y: 0, k: 1 };
  let _vistaTocada = false;    // true en cuanto el usuario navega a mano
  let _lienzoListo = false;
  let _arrastre = null;

  function viewport() { return document.getElementById('diag-viewport'); }

  function limitarK(k) {
    return Math.min(VISTA_MAX, Math.max(VISTA_MIN, k));
  }

  /** Refleja el estado de la vista en el DOM (transform del lienzo). */
  function aplicarVista() {
    const c = cuerpo();
    if (c && c.style) {
      c.style.transform = `translate(${_vista.x}px, ${_vista.y}px) scale(${_vista.k})`;
    }
    planificarNitidez();
  }

  // Al hacer zoom el navegador reutiliza la copia rasterizada del lienzo, y eso
  // es lo que se ve pixelado. Cuando el usuario para de navegar se fuerza un
  // repintado para que se dibuje otra vez a la escala final: texto y circulos
  // quedan nitidos en cualquier nivel de zoom.
  let _nitidezTimer = null;
  function planificarNitidez() {
    if (_nitidezTimer) clearTimeout(_nitidezTimer);
    _nitidezTimer = setTimeout(() => {
      _nitidezTimer = null;
      const c = cuerpo();
      if (!c || !c.style) return;
      const t = c.style.transform;
      c.style.transform = 'none';
      void c.offsetWidth;                 // rompe la copia rasterizada
      c.style.transform = t;
    }, 140);
  }

  /** Vista actual, para pruebas y futuras herramientas. */
  function vista() {
    return { x: _vista.x, y: _vista.y, k: _vista.k };
  }

  /**
   * Zoom manteniendo fijo el punto (px, py) de la pantalla: lo que esta bajo el
   * cursor no se mueve, que es lo que se espera en un lienzo.
   */
  function zoom(factor, px, py) {
    const nueva = limitarK(_vista.k * factor);
    if (nueva === _vista.k) return _vista.k;
    const vp = viewport();
    if (px != null && py != null && vp && typeof vp.getBoundingClientRect === 'function') {
      const caja = vp.getBoundingClientRect();
      const ox = px - caja.left;
      const oy = py - caja.top;
      _vista.x = ox - (ox - _vista.x) * (nueva / _vista.k);
      _vista.y = oy - (oy - _vista.y) * (nueva / _vista.k);
    }
    _vista.k = nueva;
    _vistaTocada = true;
    aplicarVista();
    return _vista.k;
  }

  /** Mueve el lienzo (arrastre). */
  function mover(dx, dy) {
    _vista.x += dx;
    _vista.y += dy;
    _vistaTocada = true;
    aplicarVista();
  }

  /**
   * Pone una caja del lienzo en el centro de la ventana. El zoom nunca pasa de
   * 100% (un diagrama con dos splitters se ve a tamaño normal, no deformado).
   * `margen` es el aire (en px de pantalla) que se deja alrededor.
   * `pegarAlOrigen` mantiene el margen mínimo a la izquierda/arriba cuando el
   * contenido es más grande que la ventana (encuadrar el nodo completo).
   */
  function centrarEnCaja(caja, margen, pegarAlOrigen) {
    const vp = viewport();
    if (!vp || !caja) return false;
    const vw = vp.clientWidth || 0;
    const vh = vp.clientHeight || 0;
    if (!vw || !vh || !(caja.w > 0) || !(caja.h > 0)) return false;
    const aire = margen || 0;
    _vista.k = limitarK(Math.min((vw - aire * 2) / caja.w, (vh - aire * 2) / caja.h, 1));
    const cx = (vw - caja.w * _vista.k) / 2 - caja.x * _vista.k;
    const cy = (vh - caja.h * _vista.k) / 2 - caja.y * _vista.k;
    _vista.x = pegarAlOrigen ? Math.max(VISTA_MARGEN, cx) : cx;
    _vista.y = pegarAlOrigen ? Math.max(VISTA_MARGEN, cy) : cy;
    _vistaTocada = false;
    aplicarVista();
    return true;
  }

  /** Caja de SOLO los aparatos (splitters, adaptadores), o null si no hay. */
  function cajaDeAparatos() {
    const area = areaAparatos();
    if (!area || typeof area.querySelectorAll !== 'function') return null;
    const ax = area.offsetLeft || 0;
    const ay = area.offsetTop || 0;
    let x0 = 0;
    let y0 = 0;
    let x1 = 0;
    let y1 = 0;
    let hay = false;
    Array.prototype.forEach.call(area.querySelectorAll('[data-dispositivo]'), (t) => {
      const id = Number(t.dataset ? t.dataset.dispositivo : 0);
      const p = _pos[id];
      if (!p) return;
      const m = medidaDe(t, id);
      const x = ax + p.x;
      const y = ay + p.y;
      if (!hay) { x0 = x; y0 = y; x1 = x + m.w; y1 = y + m.h; hay = true; return; }
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + m.w); y1 = Math.max(y1, y + m.h);
    });
    return hay ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /**
   * Al abrir el nodo la vista se pone sobre los SPLITTERS, con zoom normal
   * (100%); solo baja de ahí si no cupieran. Así el diagrama se abre donde
   * está el trabajo y no en una esquina vacía del lienzo.
   */
  function centrarEnAparatos() {
    return centrarEnCaja(cajaDeAparatos(), 56);
  }

  /** Encuadre automático al (re)pintar: sobre los aparatos; si no hay, todo. */
  function centrarAlAbrir() {
    if (_vistaTocada) return;
    if (centrarEnAparatos()) return;
    encuadrar();
  }

  /**
   * Centra y ajusta TODO el contenido a la ventana del lienzo.
   * La caja sale del contenido real (columnas + aparatos), no del recuadro del
   * lienzo: un splitter movido a la izquierda del origen también entra.
   */
  function encuadrar() {
    centrarEnCaja(cajaDeContenido(), 0, true);
  }

  /**
   * Caja real de todo el contenido: las columnas (que van en flujo y por eso
   * las mide el propio lienzo) más las tarjetas de aparatos, que están
   * posicionadas y pueden estar en x/y negativas.
   */
  function cajaDeContenido() {
    const c = cuerpo();
    if (!c) return null;
    let x0 = 0;
    let y0 = 0;
    let x1 = 0;
    let y1 = 0;
    let hay = false;
    const sumar = (x, y, w, h) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0) || !(h > 0)) return;
      if (!hay) { x0 = x; y0 = y; x1 = x + w; y1 = y + h; hay = true; return; }
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
    };

    sumar(0, 0, c.offsetWidth || c.scrollWidth || 0, c.offsetHeight || c.scrollHeight || 0);

    const area = areaAparatos();
    if (area && typeof area.querySelectorAll === 'function') {
      const ax = area.offsetLeft || 0;
      const ay = area.offsetTop || 0;
      Array.prototype.forEach.call(area.querySelectorAll('[data-dispositivo]'), (t) => {
        const id = Number(t.dataset ? t.dataset.dispositivo : 0);
        const p = _pos[id];
        if (!p) return;
        const m = medidaDe(t, id);
        sumar(ax + p.x, ay + p.y, m.w, m.h);
      });
    }
    return hay ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  /** Al abrir un nodo el lienzo arranca limpio (100%, arriba a la izquierda). */
  function reiniciarVista() {
    _vista = { x: 0, y: 0, k: 1 };
    _vistaTocada = false;
    _arrastre = null;
    aplicarVista();
  }

  // ── Modo eliminar (lo activa la basurita de la barra inferior) ────────────
  // Los objetos borrables del lienzo llevan data-borrar="dispositivo:12" o
  // "bandeja:7". Las reglas finas de que se puede borrar en cada fase se
  // definiran despues: aqui solo se garantiza una baja consistente.
  let _modoEliminar = false;

  function enModoEliminar() { return _modoEliminar; }

  /** Activa o desactiva el modo eliminar (y su aviso en el lienzo). */
  function modoEliminar(activar) {
    _modoEliminar = !!activar;
    const vp = viewport();
    if (vp && vp.classList) vp.classList.toggle('modo-eliminar', _modoEliminar);
    const etiqueta = document.getElementById('diag-modo');
    if (etiqueta && etiqueta.style) etiqueta.style.display = _modoEliminar ? 'flex' : 'none';
    if (_modoEliminar) {
      _sel = null;
      aviso('Modo eliminar: haz clic en el objeto que quieras borrar', 'warning');
    }
  }

  /** data-borrar="tipo:id" → ruta de la API y como nombrarlo. */
  const BAJAS = {
    dispositivo: {
      ruta: (elem, id) => `/api/elementos/${elem}/dispositivos/${id}`,
      que: 'el dispositivo',
      hecho: 'Dispositivo eliminado',
    },
    bandeja: {
      ruta: (elem, id) => `/api/elementos/${elem}/bandejas/${id}`,
      que: 'la bandeja',
      hecho: 'Bandeja eliminada',
    },
    // Una FIBRA (cable) no es un aparato del nodo: su baja aquí es quitarla de
    // este nodo (desanclar sus hilos), no mandar el id del cable al endpoint de
    // dispositivos — eso devolvía "El dispositivo #N no esta en el elemento #M".
    cable: {
      ruta: (elem, id) => `/api/elementos/${elem}/cables/${id}`,
      que: 'la fibra',
      hecho: 'Fibra quitada del nodo',
    },
  };

  async function borrarObjeto(clave) {
    const partes = String(clave || '').split(':');
    const tipo = (partes[0] || '').toLowerCase();
    const id = parseInt(partes[1], 10);
    const baja = BAJAS[tipo];
    if (!baja || !id) {
      aviso('Ese objeto todavia no se puede eliminar desde el diagrama', 'info');
      return;
    }
    if (typeof confirm === 'function' && !confirm(`¿Eliminar ${baja.que} #${id} de este nodo?`)) return;
    try {
      const res = await fetch(apiUrl(baja.ruta(_boxId, id)), { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        aviso(err.detail || `No se pudo eliminar ${baja.que}`, 'error');
        return;
      }
      modoEliminar(false);
      await cargar();
      encuadrar();
      marcarCambio();   // hubo un cambio real: el disquete queda encendido
      aviso(baja.hecho || 'Objeto eliminado', 'success');
    } catch (e) {
      console.error('[diagrama] error al eliminar:', e);
      aviso('Error de red al eliminar', 'error');
    }
  }

  /** En modo eliminar, el clic manda el objeto marcado con data-borrar. */
  function alClicEliminar(e) {
    if (!_modoEliminar) return;
    const objetivo = (e && e.target && typeof e.target.closest === 'function')
      ? e.target.closest('[data-borrar]')
      : null;
    if (!objetivo) return;
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.preventDefault === 'function') e.preventDefault();
    borrarObjeto(objetivo.getAttribute('data-borrar'));
  }

  /** Si se arrastro el lienzo, el clic siguiente no debe seleccionar un puerto. */
  function tragarClic(e) {
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.preventDefault === 'function') e.preventDefault();
  }

  // ── Sitio de los aparatos: lo guardado o la rejilla automática ────────────
  // El orden del lienzo NO es topología: vive en `ftth_diagrama_posiciones` y
  // solo decide dónde se pinta cada splitter/adaptador dentro del diagrama.

  function areaAparatos() { return document.getElementById('diag-area-dispositivos'); }

  /** Número utilizable, o null si el valor no es un número. */
  function aNumero(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Medida real de una tarjeta; si aún no es medible, se estima. */
  function medidaDe(el, id) {
    const w = el && el.offsetWidth ? el.offsetWidth : 0;
    const h = el && el.offsetHeight ? el.offsetHeight : 0;
    if (w && h) _medidas[id] = { w, h };
    return _medidas[id] || { w: NODO_ANCHO, h: NODO_ALTO };
  }

  /**
   * Sitio de cada aparato dentro del área:
   *   1º lo que el usuario acaba de mover (aún sin guardar),
   *   2º lo que vino guardado del backend (x/y),
   *   3º la rejilla de AREA_COLUMNAS para los que nunca se han movido.
   * Con dos columnas el segundo splitter nace AL LADO del primero: apilados en
   * vertical era justo lo que había que evitar.
   */
  function calcularSitios(dispositivos) {
    const previo = _pos;
    _pos = {};
    dispositivos.forEach((dev) => {
      const id = Number(dev.id);
      if (previo[id]) { _pos[id] = previo[id]; return; }
      const gx = aNumero(dev.x);
      const gy = aNumero(dev.y);
      if (gx !== null && gy !== null) _pos[id] = { x: gx, y: gy };
    });

    let col = 0;
    let x = AREA_MARGEN;
    let y = AREA_MARGEN;
    let altoFila = 0;
    dispositivos.forEach((dev) => {
      const id = Number(dev.id);
      if (_pos[id]) return;
      if (col >= AREA_COLUMNAS) { col = 0; x = AREA_MARGEN; y += altoFila + NODO_SEP; altoFila = 0; }
      const m = _medidas[id] || { w: NODO_ANCHO, h: NODO_ALTO };
      _pos[id] = { x, y };
      x = x + m.w + NODO_SEP;
      if (m.h > altoFila) altoFila = m.h;
      col += 1;
    });
    return _pos;
  }

  /** Coloca una tarjeta en su sitio (px del lienzo, antes del zoom). */
  function colocarTarjeta(el, x, y) {
    if (!el || !el.style) return;
    el.style.position = 'absolute';
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }

  /**
   * Tras pintar: mide cada tarjeta, la coloca en su sitio y dimensiona el área
   * para que quepa todo. El área es la que da tamaño al lienzo, así que
   * arrastrar hacia la derecha o hacia abajo lo agranda y nada queda cortado.
   */
  function acomodar() {
    const area = areaAparatos();
    if (!area || typeof area.querySelectorAll !== 'function') return;
    const tarjetas = area.querySelectorAll('[data-dispositivo]');
    let maxX = AREA_ANCHO_MIN - AREA_MARGEN;
    let maxY = AREA_ALTO_MIN - AREA_MARGEN;
    Array.prototype.forEach.call(tarjetas, (t) => {
      const id = Number(t.dataset ? t.dataset.dispositivo : 0);
      const p = _pos[id] || { x: AREA_MARGEN, y: AREA_MARGEN };
      const m = medidaDe(t, id);
      colocarTarjeta(t, p.x, p.y);
      maxX = Math.max(maxX, p.x + m.w);
      maxY = Math.max(maxY, p.y + m.h);
    });
    if (area.style) {
      area.style.width = `${Math.round(maxX + AREA_MARGEN)}px`;
      area.style.height = `${Math.round(maxY + AREA_MARGEN)}px`;
    }
  }

  /** Marca el disquete mientras haya aparatos movidos sin guardar. */
  function marcarPendiente(activo) {
    const b = document.getElementById('diag-btn-save');
    if (b && b.classList) b.classList.toggle('diag-identity-btn--pendiente', !!activo);
    // El tooltip del boton se pinta con attr(data-tooltip) desde el CSS.
    if (b && typeof b.setAttribute === 'function') {
      b.setAttribute('data-tooltip', activo
        ? 'Hay cambios sin guardar: pulsa para guardar el diagrama'
        : 'Guardar diagrama');
    }
    const nota = document.getElementById('diag-pendiente');
    if (nota && nota.style) nota.style.display = activo ? 'inline' : 'none';
  }

  /**
   * Marca el diagrama como "por guardar". Cualquier cambio real —mover un
   * aparato, agregarlo o eliminarlo— enciende el disquete, para que se pueda
   * guardar sin dudar de si falta algo.
   */
  function marcarCambio(motivo) {
    const primera = !_posSucias;
    _posSucias = true;
    marcarPendiente(true);
    if (motivo && primera) aviso(`${motivo}: pulsa el disquete para guardar el diagrama`, 'info');
  }

  /**
   * Coloca un aparato en (x, y) del lienzo y deja el diagrama por guardar.
   * x/y pueden ser negativas: el lienzo es libre y no hay recuadro que valga.
   */
  function moverAparato(id, x, y) {
    const idNum = Number(id);
    if (!idNum) return;
    const tope = (v) => Math.max(-POSICION_MAX, Math.min(POSICION_MAX, Math.round(v)));
    _pos[idNum] = { x: tope(x), y: tope(y) };
    acomodar();
    marcarCambio('Aparato movido');
  }

  // ── Arrastrar un aparato dentro del lienzo (agarre de la tarjeta) ─────────
  let _mueble = null;   // { id, el, x0, y0, px, py, movido }

  /**
   * Un clic con el botón izquierdo sobre CUALQUIER parte de la tarjeta de un
   * aparato empieza a moverlo. Antes solo valía la barrita de agarre, así que
   * agarrar la tarjeta por su cuerpo arrastraba el LIENZO (parecía que el
   * splitter navegaba el diagrama). Un clic sin movimiento sigue seleccionando
   * el puerto de siempre.
   */
  function alPresionarAparato(e) {
    if (!e || (e.button !== undefined && e.button !== 0 && e.button !== 1)) return;
    const objetivo = (e.target && typeof e.target.closest === 'function')
      ? e.target.closest('[data-dispositivo]') : null;
    if (!objetivo) return;
    const agarre = (e.target && typeof e.target.closest === 'function')
      ? e.target.closest('[data-mover]') : null;
    const id = Number(objetivo.dataset ? objetivo.dataset.dispositivo
      : (agarre ? agarre.getAttribute('data-mover') : NaN));
    if (!id) return;
    const p = _pos[id] || { x: AREA_MARGEN, y: AREA_MARGEN };
    _mueble = {
      id, el: objetivo, x0: e.clientX, y0: e.clientY, px: p.x, py: p.y, movido: false,
      vx0: _vista.x, vy0: _vista.y,   // la vista al empezar (si hay zoom en medio)
    };
    // Que el lienzo NO se pane: el aparato se mueve dentro del diagrama, no navega.
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (objetivo.classList) objetivo.classList.add('diag-nodo-dispositivo--moviendo');
    // Mientras se arrastra, el lienzo va por encima de las barras: la tarjeta
    // nunca se ve cortada por el hueco entre la barra y el lienzo.
    const lienzo = cuerpo();
    if (lienzo && lienzo.classList) lienzo.classList.add('diag-body--arrastrando');
  }

  function alMoverPuntero(e) {
    if (!_mueble) return;
    const k = _vista.k || 1;          // el lienzo puede estar escalado
    // El aparato sigue al PUNTERO. La vista NO se toca: al arrastrar un aparato
    // el diagrama se queda quieto (para ver más espacio se aleja con la rueda).
    const dx = (e.clientX - _mueble.x0 + (_mueble.vx0 - _vista.x)) / k;
    const dy = (e.clientY - _mueble.y0 + (_mueble.vy0 - _vista.y)) / k;
    // Umbral de 2 px: un clic en el agarre no mueve nada.
    if (!_mueble.movido && Math.abs(dx) + Math.abs(dy) < 2) return;
    _mueble.movido = true;
    moverAparato(_mueble.id, _mueble.px + dx, _mueble.py + dy);
  }

  function alSoltarPuntero() {
    if (!_mueble) return;
    const el = _mueble.el;
    const movido = _mueble.movido;
    _mueble = null;
    if (el && el.classList) el.classList.remove('diag-nodo-dispositivo--moviendo');
    const lienzo = cuerpo();
    if (lienzo && lienzo.classList) lienzo.classList.remove('diag-body--arrastrando');
    // Tras arrastrar, el clic siguiente se traga (no selecciona un puerto).
    if (movido) document.addEventListener('click', tragarClic, { capture: true, once: true });
  }

  /** Vista de las posiciones actuales (para pruebas y herramientas). */
  function posiciones() {
    const copia = {};
    Object.keys(_pos).forEach((id) => { copia[id] = { x: _pos[id].x, y: _pos[id].y }; });
    return copia;
  }

  /** Guarda el orden del lienzo (el disquete de la barra de identidad). */
  async function guardar() {
    if (!_boxId) return false;
    const carga = {
      posiciones: Object.keys(_pos).map((id) => ({
        dispositivo_id: Number(id),
        x: Math.round(_pos[id].x),
        y: Math.round(_pos[id].y),
      })),
    };
    try {
      const res = await fetch(apiUrl(`/api/elementos/${_boxId}/diagrama/posiciones`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(carga),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        aviso(err.detail || 'No se pudo guardar el diagrama', 'error');
        return false;
      }
      _posSucias = false;
      marcarPendiente(false);
      aviso('Diagrama guardado correctamente', 'success');
      return true;
    } catch (e) {
      console.error('[diagrama] error al guardar:', e);
      aviso('Error de red al guardar el diagrama', 'error');
      return false;
    }
  }

  /** Vuelve a la rejilla automática (borra el orden guardado del nodo). */
  async function restablecer() {
    if (!_boxId) return false;
    try {
      const res = await fetch(apiUrl(`/api/elementos/${_boxId}/diagrama/posiciones`), { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        aviso(err.detail || 'No se pudo restablecer el orden', 'error');
        return false;
      }
      _pos = {};
      _posSucias = false;
      marcarPendiente(false);
      await cargar();
      aviso('Orden del diagrama restablecido', 'success');
      return true;
    } catch (e) {
      console.error('[diagrama] error al restablecer:', e);
      aviso('Error de red al restablecer el orden', 'error');
      return false;
    }
  }



  /** Engancha rueda, arrastre, doble clic y botones del lienzo (una sola vez). */
  function engancharLienzo() {
    if (_lienzoListo) return;
    const vp = viewport();
    if (!vp || typeof vp.addEventListener !== 'function') return;

    // Rueda del raton = acercar / alejar sobre el puntero
    vp.addEventListener('wheel', (e) => {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      zoom(e.deltaY < 0 ? VISTA_PASO : 1 / VISTA_PASO, e.clientX, e.clientY);
    }, { passive: false });

    // Arrastrar (boton izquierdo o central) = mover el lienzo
    vp.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      _arrastre = { x: e.clientX, y: e.clientY, movido: false };
    });

    document.addEventListener('mousemove', (e) => {
      if (!_arrastre) return;
      const dx = e.clientX - _arrastre.x;
      const dy = e.clientY - _arrastre.y;
      // Umbral de 4 px: un clic normal (seleccionar un puerto) no panea.
      if (!_arrastre.movido && Math.abs(dx) + Math.abs(dy) < 4) return;
      _arrastre.movido = true;
      _arrastre.x = e.clientX;
      _arrastre.y = e.clientY;
      mover(dx, dy);
    });

    document.addEventListener('mouseup', () => {
      if (_arrastre && _arrastre.movido) {
        document.addEventListener('click', tragarClic, { capture: true, once: true });
      }
      _arrastre = null;
    });

    // Doble clic en zona vacia = encuadrar todo
    vp.addEventListener('dblclick', (e) => {
      const objetivo = e && e.target;
      if (objetivo === vp || (objetivo && objetivo.id === 'diag-body')) encuadrar();
    });

    const bAcercar = document.getElementById('diag-zoom-in');
    if (bAcercar) bAcercar.addEventListener('click', () => zoom(VISTA_PASO));
    const bAlejar = document.getElementById('diag-zoom-out');
    if (bAlejar) bAlejar.addEventListener('click', () => zoom(1 / VISTA_PASO));
    const bEncuadrar = document.getElementById('diag-zoom-fit');
    if (bEncuadrar) bEncuadrar.addEventListener('click', encuadrar);

    // El zoom y el encuadre se hacen con el raton: rueda, arrastre y doble clic.
    // No hay barra de botones sobre el lienzo.
    _lienzoListo = true;
  }

  /**
   * Arrastre de las TARJETAS de aparatos (una sola vez).
   * El oyente va en #diag-body, que no se reemplaza: sigue valiendo después de
   * cada repintado. Al presionar una tarjeta se corta la propagación, así que
   * el gesto mueve el aparato y NUNCA navega el lienzo.
   */
  let _aparatosListos = false;

  function engancharAparatos() {
    if (_aparatosListos) return;
    const c = cuerpo();
    if (!c || typeof c.addEventListener !== 'function') return;
    c.addEventListener('mousedown', alPresionarAparato);
    document.addEventListener('mousemove', alMoverPuntero);
    document.addEventListener('mouseup', alSoltarPuntero);
    _aparatosListos = true;
  }

  // ── Ventana del diagrama: maximizar y redimensionar ───────────────────────
  // Como una ventana de Windows: botón de pantalla completa y esquina para
  // arrastrar el tamaño. El tamaño elegido se recuerda para la próxima vez.

  function tarjeta() {
    return (document.querySelector) ? document.querySelector('#ftth-diagrama-modal .app-card') : null;
  }

  /** Pantalla completa (96% de la ventana) o vuelta al tamaño anterior. */
  function pantallaCompleta(activar) {
    const card = tarjeta();
    if (!card || !card.classList) return false;
    const on = (activar === undefined) ? !card.classList.contains('app-card--max') : !!activar;
    card.classList.toggle('app-card--max', on);
    if (on && card.style) {          // maximizado manda: se limpia el tamaño a mano
      card.style.width = '';
      card.style.height = '';
      card.style.maxWidth = '';
      card.style.maxHeight = '';
    }
    const btn = document.getElementById('diag-btn-full');
    if (btn && btn.setAttribute) {
      btn.setAttribute('data-tooltip', on ? 'Restaurar tamaño' : 'Pantalla completa');
    }
    if (btn && typeof btn.querySelector === 'function') {
      const icono = btn.querySelector('i');
      if (icono && icono.classList) {
        icono.classList.toggle('fa-expand', !on);
        icono.classList.toggle('fa-compress', on);
      }
    }
    guardarPanel();
    enfocarSiLibre();
    return on;
  }

  /** Da al panel un tamaño a mano (px), acotado a la ventana del navegador. */
  function tamanoPanel(ancho, alto) {
    const card = tarjeta();
    if (!card || !card.style) return false;
    const maxW = Math.max(PANEL_MIN_W, (window.innerWidth || 1280) - 24);
    const maxH = Math.max(PANEL_MIN_H, (window.innerHeight || 800) - 24);
    const w = Math.min(maxW, Math.max(PANEL_MIN_W, Math.round(ancho)));
    const h = Math.min(maxH, Math.max(PANEL_MIN_H, Math.round(alto)));
    if (card.classList) card.classList.remove('app-card--max');
    card.style.width = `${w}px`;
    card.style.height = `${h}px`;
    card.style.maxWidth = 'none';    // el tamaño elegido manda sobre el 94vw / 88vh
    card.style.maxHeight = 'none';
    guardarPanel();
    return true;
  }

  /** Recuerda el tamaño (y si estaba maximizado) para la próxima apertura. */
  function guardarPanel() {
    const card = tarjeta();
    if (!card) return;
    try {
      if (!window.localStorage) return;
      const datos = {
        max: !!(card.classList && card.classList.contains('app-card--max')),
        w: card.style && card.style.width ? parseInt(card.style.width, 10) : 0,
        h: card.style && card.style.height ? parseInt(card.style.height, 10) : 0,
      };
      window.localStorage.setItem(PANEL_CLAVE, JSON.stringify(datos));
    } catch (e) { /* sin almacenamiento disponible: no pasa nada */ }
  }

  /** Aplica el tamaño recordado, si lo hay. */
  function restaurarPanel() {
    let datos = null;
    try {
      if (window.localStorage) datos = JSON.parse(window.localStorage.getItem(PANEL_CLAVE) || 'null');
    } catch (e) { datos = null; }
    if (!datos) return;
    if (datos.max) pantallaCompleta(true);
    else if (datos.w && datos.h) tamanoPanel(datos.w, datos.h);
  }

  /** Tras cambiar el tamaño: reencuadra solo si el usuario no movió la vista. */
  function enfocarSiLibre() {
    acomodar();
    if (!_vistaTocada) centrarAlAbrir();
  }

  /** Arrastre de la esquina inferior derecha para agrandar/achicar el panel. */
  function alPresionarEsquina(e) {
    const card = tarjeta();
    if (!card || typeof card.getBoundingClientRect !== 'function') return;
    const r = card.getBoundingClientRect();
    _redimensionando = { x0: e.clientX, y0: e.clientY, w: r.width, h: r.height };
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.preventDefault === 'function') e.preventDefault();
  }

  function alMoverEsquina(e) {
    if (!_redimensionando) return;
    tamanoPanel(_redimensionando.w + (e.clientX - _redimensionando.x0),
                _redimensionando.h + (e.clientY - _redimensionando.y0));
  }

  function alSoltarEsquina() {
    if (!_redimensionando) return;
    _redimensionando = null;
    enfocarSiLibre();
  }

  /** Engancha los mandos de la ventana del diagrama (una sola vez). */
  function engancharPanel() {
    const btn = document.getElementById('diag-btn-full');
    if (btn && typeof btn.addEventListener === 'function') {
      btn.addEventListener('click', () => pantallaCompleta());
    }
    const esquina = document.getElementById('diag-resize');
    if (esquina && typeof esquina.addEventListener === 'function') {
      esquina.addEventListener('mousedown', alPresionarEsquina);
      document.addEventListener('mousemove', alMoverEsquina);
      document.addEventListener('mouseup', alSoltarEsquina);
    }
  }

  function bindChrome() {
    if (_uiLista) return;
    const m = modal();
    if (!m) return;
    const btnCerrar = document.getElementById('diag-btn-close');
    if (btnCerrar) btnCerrar.addEventListener('click', cerrar);
    const btnRecargar = document.getElementById('diag-btn-reload');
    if (btnRecargar) btnRecargar.addEventListener('click', () => cargar());
    m.addEventListener('click', (e) => { if (e.target === m) cerrar(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !m.classList.contains('hidden')) cerrar();
    });

    // Nueva UI del Diagrama
    const buttons = document.querySelectorAll('.sidebar-btn');
    const drawer = document.getElementById('sidebarDrawer');
    const panels = document.querySelectorAll('.drawer-content');
    let activePanelId = null;

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetPanel = btn.getAttribute('data-panel');
        if (!targetPanel) return; // Ignore if no panel (e.g. close button)
        if (activePanelId === targetPanel) {
          drawer.classList.remove('open');
          btn.classList.remove('active');
          activePanelId = null;
          return;
        }
        buttons.forEach(b => b.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(targetPanel).classList.add('active');
        drawer.classList.add('open');
        activePanelId = targetPanel;
      });
    });

    const modeBtn = document.getElementById('modeBtn');
    const modeDropdown = document.getElementById('modeDropdown');
    const modeLabel = document.getElementById('modeLabel');

    if (modeBtn && modeDropdown && modeLabel) {
      modeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modeDropdown.classList.toggle('open');
        modeBtn.classList.toggle('open');
      });

      document.querySelectorAll('.mode-option').forEach(opt => {
        opt.addEventListener('click', () => {
          document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          modeLabel.textContent = opt.getAttribute('data-mode');
          modeDropdown.classList.remove('open');
          modeBtn.classList.remove('open');
        });
      });

      document.addEventListener('click', () => {
        modeDropdown.classList.remove('open');
        modeBtn.classList.remove('open');
      });
    }

    const workspace = document.getElementById('diagramWorkspace');
    ['illuminateLeft', 'illuminateRight'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn && workspace) {
        btn.addEventListener('click', () => {
          const isActive = btn.classList.contains('active');
          document.getElementById('illuminateLeft').classList.remove('active', 'illuminate');
          document.getElementById('illuminateRight').classList.remove('active', 'illuminate');
          document.getElementById('illuminateLeft').classList.add('illuminate');
          document.getElementById('illuminateRight').classList.add('illuminate');
          if (!isActive) {
            btn.classList.add('active');
            workspace.classList.add('illuminating');
          } else {
            workspace.classList.remove('illuminating');
          }
        });
      }
    });

    
    // Toolbars Logic
    const btnAddSplitter = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar splitter"]');
    if (btnAddSplitter) {
      btnAddSplitter.addEventListener('click', () => {
        mostrarModalAgregarSplitter();
      });
    }

    const btnAddSwitch = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar switch"]');
    if (btnAddSwitch) {
      btnAddSwitch.addEventListener('click', () => {
        mostrarModalAgregarSplitter('switch');
      });
    }

    const btnAddFusion = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar fusión"]');
    if (btnAddFusion) {
      btnAddFusion.addEventListener('click', () => {
        mostrarModalAgregarSplitter('fusion');
      });
    }

    const btnAddOdf = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar ODF"]');
    if (btnAddOdf) {
      btnAddOdf.addEventListener('click', () => {
        mostrarModalAgregarSplitter('odf');
      });
    }

    const btnAddCableIn = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar cable de entrada"]');
    if (btnAddCableIn) {
      btnAddCableIn.addEventListener('click', () => {
        mostrarModalEntradaFibra('A');
      });
    }

    const btnAddCableOut = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar cable de salida"]');
    if (btnAddCableOut) {
      btnAddCableOut.addEventListener('click', () => {
        mostrarModalEntradaFibra('B');
      });
    }

    const btnDelete = document.querySelector('.bottom-toolbar button[data-tooltip="Eliminar elemento"]');
    if (btnDelete) {
      // La basurita activa el MODO ELIMINAR: con el activo, el clic sobre un
      // objeto del lienzo lo borra (con confirmacion). El boton queda marcado.
      btnDelete.addEventListener('click', () => {
        modoEliminar(!_modoEliminar);
        if (btnDelete.classList) btnDelete.classList.toggle('active', _modoEliminar);
      });
    }
    
    // Wire up Select / Cut etc. to show a message for now
    const btnCut = document.querySelector('.bottom-toolbar button[data-tooltip="Cortar elemento/spliter/fusion"]');
    if (btnCut) btnCut.addEventListener('click', () => aviso('Selecciona una conexión para cortar', 'info'));

    // ── Close sidebar when clicking on the empty workspace canvas ──
    const ws = document.getElementById('diagramWorkspace');
    if (ws) {
      ws.addEventListener('click', (e) => {
        // Only close if clicking on the workspace itself (not on toolbars or children)
        if (e.target === ws || e.target.classList.contains('diag-body-container') ||
            e.target.id === 'diag-viewport' || e.target.id === 'diag-body'
            || e.target.id === 'diag-sub' || e.target.id === 'diag-pie') {
          const dr = document.getElementById('sidebarDrawer');
          if (dr && dr.classList.contains('open')) {
            dr.classList.remove('open');
            document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
          }
        }
      });
    }

    // ── Back to map button ──
    const btnBack = document.getElementById('diag-btn-back');
    if (btnBack) btnBack.addEventListener('click', cerrar);

    // ── Save button (disquete): guarda el orden del lienzo ──
    const btnSave = document.getElementById('diag-btn-save');
    if (btnSave) btnSave.addEventListener('click', () => { guardar(); });

    engancharLienzo();
    engancharAparatos();
    engancharPanel();

    // Modo eliminar: el clic en un objeto con data-borrar lo elimina. El oyente
    // va en captura y sobre #diag-body (que no se reemplaza), asi que sigue
    // funcionando despues de cada repintado.
    const cuerpoActual = cuerpo();
    if (cuerpoActual && typeof cuerpoActual.addEventListener === 'function') {
      cuerpoActual.addEventListener('click', alClicEliminar, true);
    }
    const btnSalirModo = document.getElementById('diag-modo-salir');
    if (btnSalirModo) btnSalirModo.addEventListener('click', () => modoEliminar(false));

    _uiLista = true;
  }

  // ── Aparatos que se pueden añadir al nodo ────────────────────────────────
  // Todo lo que se cree en "Tipos de objetos" con estas categorías se puede
  // instalar en el diagrama: no solo el splitter.
  const CATEGORIAS_APARATO = ['splitter', 'fusion', 'switch', 'adaptador', 'wdm', 'pigtail', 'odf'];
  const ETIQUETA_APARATO = {
    splitter: 'Splitter', fusion: 'Fusión', switch: 'Switch', adaptador: 'Adaptador',
    wdm: 'WDM', pigtail: 'Pigtail', odf: 'ODF',
  };

  function etiquetaAparato(categoria) {
    return ETIQUETA_APARATO[categoria] || categoria;
  }

  /** Sufijo de la opción del tipo. El splitter muestra su división para elegir a sabiendas. */
  function sufijoTipo(categoria, t) {
    if (categoria !== 'splitter') return '';
    const division = divisionDeTipo(t);
    return division ? ` - ${division}` : ' - SIN DIVISION (edítala en Tipos)';
  }

  async function tiposDeAparato(categoria) {
    try {
      const tipos = await window.FTTHTipos.getTipos(categoria);
      return Array.isArray(tipos) ? tipos : [];
    } catch (e) {
      console.warn('No se pudieron leer los tipos de', categoria, e);
      return [];
    }
  }

  async function mostrarModalAgregarSplitter(categoria = 'splitter') {
    if (!window.FTTHTipos) return;
    try {
      const cat = CATEGORIAS_APARATO.includes(categoria) ? categoria : 'splitter';
      const etiqueta = etiquetaAparato(cat);
      const tipos = await tiposDeAparato(cat);
      if (!tipos || !tipos.length) {
        aviso(`No hay plantillas de ${etiqueta}. Crea una en el panel primero.`, 'error');
        if (window.FTTHTipos && window.FTTHTipos.openModal) window.FTTHTipos.openModal(cat);
        return;
      }
      
      // Selector de categoría (splitter, fusión, switch…) + selector de plantilla
      const opcionesCat = CATEGORIAS_APARATO
        .map(c => `<option value="${c}"${c === cat ? ' selected' : ''}>${escapeHtml(etiquetaAparato(c))}</option>`)
        .join('');
      let selectHtml = `<select id="diag-select-categoria" title="Tipo de aparato" style="width:100%; padding: 8px; margin-bottom: 8px; border-radius: 4px; border: 1px solid #ccc;">${opcionesCat}</select>`;
      selectHtml += `<select id="diag-select-splitter" style="width:100%; padding: 8px; margin-bottom: 10px; border-radius: 4px; border: 1px solid #ccc;">`;
      tipos.forEach(t => {
        // La opción muestra la división: así se elige a sabiendas y se ve si a la
        // plantilla le falta (con eso el backend no podría materializarla).
        const sufijo = sufijoTipo(cat, t);
        selectHtml += `<option value="${t.id}">${escapeHtml(t.nombre_id + sufijo)}</option>`;
      });
      selectHtml += `</select>`;
      
      let picker = document.getElementById('diag-splitter-picker');
      if (!picker) {
        picker = document.createElement('div');
        picker.id = 'diag-splitter-picker';
        picker.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:white; padding:20px; box-shadow:0 10px 30px rgba(0,0,0,0.5); z-index:120000; border-radius:8px; width:300px; font-family: Inter, sans-serif;';
        // z-index 120000: el modal del diagrama usa 99999 inline, así que con el
        // 9999 anterior este selector quedaba DETRAS del overlay; el clic en
        // "Anadir" lo capturaba el overlay, que ademas cierra el diagrama.
        picker.addEventListener('click', (e) => e.stopPropagation());
        picker.addEventListener('mousedown', (e) => e.stopPropagation());
        document.body.appendChild(picker);
      }
      
      picker.innerHTML = `
        <h4 style="margin-top:0; margin-bottom:15px; color:#1e293b;">Añadir ${escapeHtml(etiqueta)} al Nodo</h4>
        ${selectHtml}
        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:15px;">
          <button type="button" class="btn-secondary" onclick="document.getElementById('diag-splitter-picker').style.display='none'" style="padding: 6px 12px; border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer;">Cancelar</button>
          <button type="button" class="btn-primary" id="btn-diag-confirm-splitter" style="padding: 6px 12px; background: #1d68bd; color: white; border: none; border-radius: 4px; cursor: pointer;">Añadir</button>
        </div>
      `;
      picker.style.display = 'block';

      // Cambiar de categoría (splitter → fusión → switch…) reabre el selector
      const selCat = document.getElementById('diag-select-categoria');
      if (selCat) {
        selCat.onchange = () => {
          const nueva = selCat.value;
          picker.style.display = 'none';
          mostrarModalAgregarSplitter(nueva);
        };
      }
      
      document.getElementById('btn-diag-confirm-splitter').onclick = async () => {
        const sel = document.getElementById('diag-select-splitter');
        const tipoId = sel.value;
        picker.style.display = 'none';
        if (!tipoId) {
          aviso(`Elige el tipo de ${etiqueta.toLowerCase()} para poder añadirlo`, 'error');
          return;
        }
        
        try {
          const res = await fetch(apiUrl(`/api/elementos/${_boxId}/dispositivos`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: cat, tipo_id: Number(tipoId) })
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            aviso(err.detail || `Error al añadir el ${etiqueta.toLowerCase()}`, 'error');
            return;
          }
          // Refrescar ANTES de avisar: si el toast fallara, el diagrama ya esta pintado.
          await cargar();
          encuadrar();   // el aparato nuevo entra en pantalla aunque estes navegando
          marcarCambio();   // hubo un cambio real: el disquete queda encendido
          aviso(`${etiqueta} añadido correctamente`, 'success');
        } catch(e) {
          aviso('Error de red al añadir el aparato', 'error');
        }
      };
      
    } catch(e) {
      console.warn("Error cargando tipos de splitter", e);
    }
  }

  async function mostrarModalEntradaFibra(extremo) {
    if (!window.currentProjectId) {
      aviso('Selecciona un proyecto primero', 'error');
      return;
    }
    if (!_boxId) {
      aviso('No hay un nodo abierto', 'error');
      return;
    }

    // Cargar cables del proyecto
    let cables = [];
    try {
      const res = await fetch(apiUrl(
        `/api/elementos/todos?proyecto_id=${window.currentProjectId}&categoria=cables`
      ), { cache: 'no-store' });
      if (res.ok) {
        const gj = await res.json();
        cables = ((gj && gj.features) || [])
          .filter(f => f.properties && f.properties.categoria === 'cables')
          .sort((a, b) => {
            // Los más recientes (mayor ID) van primero
            const ia = Number(a.properties.id) || 0;
            const ib = Number(b.properties.id) || 0;
            return ib - ia;
          });
      }
    } catch (e) {
      aviso('Error al cargar cables del proyecto', 'error');
      return;
    }

    if (!cables.length) {
      aviso('No hay cables de fibra trazados en este proyecto. Traza una fibra en el mapa primero.', 'error');
      return;
    }

    // Helper para parsear objetos o strings
    const _parse = (raw) => {
      if (typeof raw === 'object' && raw !== null) return raw;
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return {}; }
      }
      return {};
    };

    // Identificar cables ya anclados a este nodo (una sola vez por nodo)
    const cablesAnclados = new Set(
      ((_datos && _datos.hilos) || [])
        .map(h => Number(h.cable_id))
        .filter(id => id > 0)
    );

    // Identificar punto objetivo (coordenadas del poste o del nodo)
    let targetPt = null;
    const mapFeatures = (window.FTTHMapa && window.FTTHMapa._currentFeatures) || [];
    const poleId = _datos && _datos.nodo && _datos.nodo.poste_ref_id ? Number(_datos.nodo.poste_ref_id) : null;
    if (poleId) {
      const poleFeat = mapFeatures.find(f => f.properties && Number(f.properties.id) === poleId);
      if (poleFeat && poleFeat.geometry && poleFeat.geometry.coordinates) {
        targetPt = poleFeat.geometry.coordinates;
      }
    }
    if (!targetPt && _datos && _datos.nodo && _datos.nodo.lon && _datos.nodo.lat) {
      targetPt = [Number(_datos.nodo.lon), Number(_datos.nodo.lat)];
    }

    const distMeters = (p1, p2) => {
      if (!p1 || !p2 || p1.length < 2 || p2.length < 2) return 999999;
      const R = 6371000;
      const rad = Math.PI / 180;
      const dLat = (p2[1] - p1[1]) * rad;
      const dLon = (p2[0] - p1[0]) * rad;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(p1[1] * rad) * Math.cos(p2[1] * rad) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const cablePasaPorPunto = (f, pt) => {
      if (!pt || !f || !f.geometry) return false;
      let coords = [];
      if (f.geometry.type === 'LineString') coords = f.geometry.coordinates || [];
      else if (f.geometry.type === 'MultiLineString') coords = (f.geometry.coordinates || []).flat();

      return coords.some(c => distMeters(c, pt) <= 30.0);
    };

    // Asignar propiedades de filtrado/ordenamiento a los cables
    cables.forEach(f => {
      const cId = Number(f.properties.id);
      f._yaAnclado = cablesAnclados.has(cId);
      f._esDelPoste = cablePasaPorPunto(f, targetPt);
    });

    // Ordenar: 1º Pasa por este poste y NO anclado, 2º Otros NO anclados, 3º Ya anclados
    cables.sort((a, b) => {
      if (a._yaAnclado !== b._yaAnclado) return a._yaAnclado ? 1 : -1;
      if (a._esDelPoste !== b._esDelPoste) return a._esDelPoste ? -1 : 1;
      const ia = Number(a.properties.id) || 0;
      const ib = Number(b.properties.id) || 0;
      return ib - ia;
    });

    // Construir selector de cables
    const etiquetaExtremo = extremo === 'B' ? 'salida (extremo B)' : 'entrada (extremo A)';
    let itemsHtml = cables.map((f, idx) => {
      const p = f.properties || {};
      const instP = _parse(p.propiedades_instancia);
      const tipoP = _parse(p.propiedades_tipo);
      const nombre = instP.nombre || instP.name || p.tipo_nombre || `Cable #${p.id}`;
      const fibras = tipoP.fibras || instP.fibras || 12;
      const looses = tipoP.looses || instP.looses || (fibras > 4 ? Math.ceil(fibras / 12) : 0);
      const reserva = instP.reserva_m ? ` · ${instP.reserva_m}m reserva` : '';
      const esReciente = idx === 0 && !f._yaAnclado && !f._esDelPoste ? ' <span style="background:#0071e3;color:#fff;font-size:9px;padding:1px 6px;border-radius:4px;margin-left:6px;">Último lanzado</span>' : '';
      const badgePoste = f._esDelPoste ? ' <span style="background:#e0f2fe;color:#0284c7;font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;margin-left:6px;"><i class="fa-solid fa-bolt"></i> Pasa por este poste</span>' : '';

      let btnHtml = `<span style="font-size:11px;background:#1d1d1f;color:#fff;padding:4px 10px;border-radius:6px;font-weight:600;flex-shrink:0;">Seleccionar</span>`;
      let styleOpacity = '1';
      if (f._yaAnclado) {
        btnHtml = `<span style="font-size:11px;background:#e5e5ea;color:#86868b;padding:4px 10px;border-radius:6px;font-weight:600;flex-shrink:0;">✓ Ya anclado</span>`;
        styleOpacity = '0.65';
      }

      return `<div class="diag-fibra-picker-item" data-cable-id="${p.id}" data-ya-anclado="${f._yaAnclado ? '1' : '0'}" style="padding:10px 14px;border-bottom:1px solid #f0f0f2;cursor:${f._yaAnclado ? 'default' : 'pointer'};display:flex;align-items:center;gap:10px;transition:background 0.15s;opacity:${styleOpacity};">
        <div style="width:34px;height:34px;border-radius:8px;background:${f._esDelPoste ? '#0284c7' : '#64748b'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fa-solid fa-ethernet" style="color:#fff;font-size:14px;"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#1d1d1f;">${escapeHtml(nombre)}${badgePoste}${esReciente}</div>
          <div style="font-size:11px;color:#86868b;margin-top:2px;">${escapeHtml(String(fibras))} hilos · ${escapeHtml(String(looses))} buffer(s)${escapeHtml(reserva)}</div>
        </div>
        ${btnHtml}
      </div>`;
    }).join('');

    let picker = document.getElementById('diag-fibra-picker');
    if (!picker) {
      picker = document.createElement('div');
      picker.id = 'diag-fibra-picker';
      picker.style.cssText = [
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);',
        'background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.35);',
        'z-index:120000;width:420px;max-width:96vw;max-height:80vh;',
        'display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;',
        'overflow:hidden;',
      ].join('');
      picker.addEventListener('click', e => e.stopPropagation());
      picker.addEventListener('mousedown', e => e.stopPropagation());
      document.body.appendChild(picker);
    }

    picker.innerHTML = `
      <div style="padding:16px 18px;border-bottom:1px solid #f0f0f2;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:14px;font-weight:700;color:#1d1d1f;">Conectar fibra — ${escapeHtml(etiquetaExtremo)}</div>
          <div style="font-size:11px;color:#86868b;margin-top:2px;">Selecciona el cable a anclar en este nodo</div>
        </div>
        <button id="diag-fibra-picker-close" style="width:28px;height:28px;border:none;background:#f5f5f7;border-radius:8px;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;">
        ${itemsHtml}
      </div>
    `;
    picker.style.display = 'flex';

    // Cerrar
    picker.querySelector('#diag-fibra-picker-close').addEventListener('click', () => {
      picker.style.display = 'none';
    });

    // Hover visual en items
    picker.querySelectorAll('.diag-fibra-picker-item').forEach(item => {
      if (item.dataset.yaAnclado !== '1') {
        item.addEventListener('mouseenter', () => { item.style.background = '#f5f5f7'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
      }

      item.addEventListener('click', async () => {
        if (item.dataset.yaAnclado === '1') {
          aviso('Este cable ya se encuentra anclado a este nodo.', 'warning');
          return;
        }
        picker.style.display = 'none';
        const cableId = item.dataset.cableId;
        await anclarFibraAlNodo(cableId, extremo);
      });
    });
  }

  /**
   * Ancla todos los hilos de un cable al nodo actual en el extremo indicado (A o B).
   * Llama a GET /api/cables/{id}/hilos → luego PUT /api/fibras/{id}/extremos/{extremo}
   * por cada hilo.
   */
  async function anclarFibraAlNodo(cableId, extremo) {
    if (!cableId || !_boxId) return;
    aviso(`Anclando fibra #${cableId} al nodo #${_boxId}…`, 'info');
    try {
      // Materializar hilos de forma idempotente para garantizar que existan en BD
      await fetch(apiUrl(`/api/cables/${cableId}/materializar-hilos`), { method: 'POST' }).catch(() => {});

      const hRes = await fetch(apiUrl(`/api/cables/${cableId}/hilos`), { cache: 'no-store' });
      if (!hRes.ok) {
        const err = await hRes.json().catch(() => ({}));
        aviso(err.detail || 'No se pudieron leer los hilos del cable', 'error');
        return;
      }
      const hData = await hRes.json();
      const tubos = hData.tubos || [];
      if (!tubos.length) {
        aviso('No se pudieron obtener los hilos del cable', 'error');
        return;
      }

      const promises = [];
      for (const t of tubos) {
        for (const h of (t.hilos || [])) {
          promises.push(
            fetch(apiUrl(`/api/fibras/${h.id}/extremos/${extremo}`), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nodo_id: Number(_boxId) }),
            })
          );
        }
      }

      const resultados = await Promise.allSettled(promises);
      const errores = resultados.filter(r => r.status === 'rejected' || (r.value && !r.value.ok)).length;

      if (errores) {
        aviso(`Fibra anclada con ${errores} advertencia(s). Verifica los hilos.`, 'warning');
      } else {
        aviso(`✓ Cable #${cableId} anclado en extremo ${extremo} al nodo #${_boxId}`, 'success');
      }

      // Refrescar diagrama
      await cargar();
      encuadrar();
      marcarCambio();

    } catch (e) {
      console.error('[diagrama] error anclando fibra:', e);
      aviso('Error de red al anclar la fibra', 'error');
    }
  }

  return {
    abrir, cerrar, esNodo, mostrarModalAgregarSplitter, mostrarModalEntradaFibra,
    CATEGORIAS_APARATO, etiquetaAparato,
    zoom, encuadrar, vista, mover,
    modoEliminar, enModoEliminar, borrarObjeto,
    // Orden del lienzo: mover aparatos, guardar (disquete) y restablecer
    posiciones, moverAparato, guardar, restablecer, acomodar,
    // Enfoque del lienzo: centrar en los aparatos con zoom normal
    centrarAparatos: centrarEnAparatos,
    // Ventana del diagrama: maximizar y tamaño a mano
    pantallaCompleta, tamanoPanel,
  };
})();

window.FTTHDiagrama = FTTHDiagrama;



