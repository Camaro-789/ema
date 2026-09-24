/**
 * ftth-hilos.js
 * Pestaña "Hilos" del modal de Propiedades — capa LÓGICA (Fase F2).
 *
 * Qué hace:
 *   - Muestra el árbol tubo → hilo de un cable (T01-H07 · G31) con colores TIA-598.
 *   - Permite materializar los hilos desde la plantilla del cable.
 *   - Permite cambiar el estado de un hilo (libre / reservado / averiado...).
 *   - Permite ver en qué nodo está anclado cada extremo (A / B).
 *
 * Qué NO hace (por diseño, ver docs/DISENO_CAPA_LOGICA.md §12):
 *   - No toca el mapa, ni los tipos, ni los iconos, ni los objetos.
 *   - Solo se añade una pestaña al modal existente.
 *   - Si el elemento no es un cable, la pestaña se oculta.
 */
const FTTHHilos = (() => {

  const ESTADOS = ['libre', 'empalmado', 'conectado', 'reservado', 'averiado'];
  const ETIQUETA_ESTADO = {
    libre: 'Libre',
    empalmado: 'Empalmado',
    conectado: 'Conectado',
    reservado: 'Reservado',
    averiado: 'Averiado',
  };

  let _cableId = null;
  let _datos = null;
  let _hiloSel = null;
  let _ocupado = false;
  let _avisoForzar = null;

  // ── Utilidades (mismo criterio que ftth-mapa.js) ──────────────────────────
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
    else console.log('[hilos]', msg);
  }

  // ── Referencias del modal existente ───────────────────────────────────────
  function btnTab() { return document.getElementById('prop-tab-btn-hilos'); }
  function cuerpo() { return document.getElementById('prop-hilos-body'); }
  function contador() { return document.getElementById('prop-hilos-count'); }

  function mostrarPestana(visible) {
    const btn = btnTab();
    if (btn) btn.style.display = visible ? '' : 'none';
    if (!visible) {
      // Si el usuario estaba viendo "Hilos" de un objeto que no es cable, volver a Información
      const activa = btn && btn.classList.contains('active');
      if (activa && window.FTTHMapa && window.FTTHMapa.switchPropTab) window.FTTHMapa.switchPropTab('info', true);
    }
  }

  function pintarMensaje(texto) {
    const c = cuerpo();
    if (c) c.innerHTML = `<div class="hilos-vacio">${escapeHtml(texto)}</div>`;
    const n = contador();
    if (n) n.textContent = '0';
  }

  // ── Carga principal (la llama ftth-mapa.js al abrir Propiedades) ───────────
  async function cargar(props) {
    const categoria = (props && props.categoria) || '';
    const id = props && props.id;
    _cableId = null;
    _datos = null;
    _hiloSel = null;

    if (!id || String(id).startsWith('tmp-')) {
      mostrarPestana(false);
      pintarMensaje('Este objeto aún no está guardado en el servidor.');
      return;
    }
    if (categoria !== 'cables') {
      mostrarPestana(false);
      pintarMensaje(`«${categoria}» no contiene hilos. Solo los cables agrupan tubos e hilos.`);
      return;
    }

    mostrarPestana(true);
    _cableId = Number(id);
    pintarMensaje('Cargando hilos del cable…');
    await recargar();
  }

  async function recargar() {
    if (!_cableId) return;
    const c = cuerpo();
    try {
      const res = await fetch(apiUrl(`/api/cables/${_cableId}/hilos`));
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pintarMensaje(err.detail || `No se pudieron leer los hilos (error ${res.status}).`);
        return;
      }
      _datos = await res.json();
      pintar();
    } catch (e) {
      console.error('[hilos] error de red:', e);
      if (c) c.innerHTML = '<div class="hilos-vacio">No se pudo contactar al servidor.</div>';
    }
  }

  function chipResumen(texto, clase) {
    return `<span class="hilos-chip ${clase || ''}">${escapeHtml(texto)}</span>`;
  }

  /** ¿Este cable es un DROP (sin buffer)? Lo declara la plantilla del tipo. */
  function _esCableDrop() {
    const props = (_datos && _datos.plantilla && _datos.plantilla.propiedades) || {};
    const estructura = String(props.estructura || '').trim().toLowerCase();
    if (estructura) return estructura === 'drop';
    // Tipos antiguos sin el campo: un único contenedor marcado SIN BUFFER
    const tubos = (_datos && _datos.tubos) || [];
    return tubos.length === 1
      && String(tubos[0].etiqueta || '').toUpperCase().includes('SIN BUFFER');
  }

  function _esContenedorSinBuffer(tubo, esDrop) {
    return !!esDrop
      || String((tubo && tubo.etiqueta) || '').toUpperCase().includes('SIN BUFFER');
  }

  function pintar() {
    const c = cuerpo();
    if (!c || !_datos) return;

    const r = _datos.resumen || {};
    const porEstado = r.por_estado || {};
    const n = contador();
    if (n) n.textContent = String(r.hilos || 0);

    // ── Resumen + acciones ────────────────────────────────────────────────
    let html = '<div class="hilos-resumen">';
    html += chipResumen(`${r.tubos || 0} tubo(s)`);
    html += chipResumen(`${r.hilos || 0} hilo(s)`);
    ESTADOS.forEach((e) => {
      const n = porEstado[e];
      if (!n) return;
      // "1 libre" / "9 libres"
      const etiqueta = ETIQUETA_ESTADO[e].toLowerCase() + (n === 1 ? '' : 's');
      html += chipResumen(`${n} ${etiqueta}`, `hilos-chip--${e}`);
    });
    if (_datos.plantilla && _datos.plantilla.existe === false) {
      html += chipResumen('sin plantilla', 'hilos-chip--averiado');
    }
    html += '</div>';

    html += '<div class="hilos-acciones">';
    html += r.materializado
      ? `<button type="button" class="hilos-btn" onclick="FTTHHilos.materializar(false)">Volver a generar hilos</button>`
      : `<button type="button" class="hilos-btn hilos-btn--primario" onclick="FTTHHilos.materializar(false)">Materializar hilos</button>`;
    html += `<span class="hilos-nota">Plantilla: <b>${escapeHtml((_datos.plantilla && _datos.plantilla.nombre_id) || 'sin plantilla')}</b></span>`;
    html += '</div>';

    // ── Avisos ────────────────────────────────────────────────────────────
    const avisos = (_datos.advertencias || []).slice();
    if (_avisoForzar) avisos.push(_avisoForzar);
    if (avisos.length) {
      html += '<div class="hilos-avisos">';
      avisos.forEach((a) => { html += `<div class="hilos-aviso">${escapeHtml(a)}</div>`; });
      if (_avisoForzar) {
        html += '<button type="button" class="hilos-btn hilos-btn--riesgo" onclick="FTTHHilos.materializar(true)">Materializar de todos modos (forzar)</button>';
      }
      html += '</div>';
    }

    // ── Árbol tubo → hilo ─────────────────────────────────────────────────
    if (!(_datos.tubos || []).length) {
      html += '<div class="hilos-vacio">Este cable aún no tiene tubos ni hilos. Usa «Materializar hilos» para crearlos desde su plantilla.</div>';
    } else {
      html += '<div class="hilos-tubos">';
      const esDrop = _esCableDrop();
      _datos.tubos.forEach((t) => {
        const sinBuffer = _esContenedorSinBuffer(t, esDrop);
        const titulo = sinBuffer ? 'Sin buffer' : `Tubo ${String(t.tubo_no).padStart(2, '0')}`;
        const info = sinBuffer
          ? `${(t.hilos || []).length} hilo(s) sueltos (salen directos del jacket)`
          : `${escapeHtml(t.color || '')} · ${t.capacidad_fibras || 0} fibras`;
        html += '<div class="hilos-tubo">';
        html += '<div class="hilos-tubo-cab">'
          + `<span class="hilos-color" style="background:${escapeHtml(t.color_hex || '#888')}"></span>`
          + `<strong>${escapeHtml(titulo)}</strong>`
          + `<span class="hilos-tubo-info">${info}</span>`
          + '</div>';
        html += '<div class="hilos-lista">';
        (t.hilos || []).forEach((h) => {
          const sel = _hiloSel === h.id ? ' hilos-hilo--sel' : '';
          // En un drop no hay tubo: el nombre del hilo se muestra sin la «T01-»
          const etiquetaHilo = sinBuffer
            ? `H${String(h.hilo_no_en_tubo).padStart(2, '0')}`
            : h.nombre;
          html += `<button type="button" class="hilos-hilo${sel}" data-hilo="${h.id}" onclick="FTTHHilos.verHilo(${h.id})" title="${escapeHtml(h.nombre + ' · ' + h.estado + ' · global ' + h.hilo_global_no)}" style="--hilo-color:${escapeHtml(h.color_hex || '#888')}">`
            + `<span class="hilos-hilo-top" style="background:${escapeHtml(h.color_hex || '#888')}"></span>`
            + `<span class="hilos-hilo-nombre">${escapeHtml(etiquetaHilo)}</span>`
            + `<span class="hilos-hilo-g">G${h.hilo_global_no}</span>`
            + `<span class="hilos-estado hilos-estado--${escapeHtml(h.estado)}">${escapeHtml((ETIQUETA_ESTADO[h.estado] || h.estado).charAt(0))}</span>`
            + '</button>';
        });
        html += '</div></div>';
      });
      html += '</div>';
      html += '<div class="hilos-leyenda">Cada cuadro es un hilo. El color es el código TIA-598; la letra es el estado '
        + '(L libre · E empalmado · C conectado · R reservado · A averiado).</div>';
    }

    // ── Detalle del hilo seleccionado ─────────────────────────────────────
    html += _panelDetalle();
    c.innerHTML = html;
  }


  // ── Detalle y acciones ───────────────────────────────────────────────────

  function _buscarHilo(id) {
    if (!_datos) return null;
    for (const t of _datos.tubos || []) {
      const h = (t.hilos || []).find((x) => x.id === id);
      if (h) return { tubo: t, hilo: h };
    }
    return null;
  }

  function _textoExtremo(ext) {
    if (!ext || !ext.nodo_id) return 'sin anclar';
    const holgura = ext.holgura_m ? ` · holgura ${ext.holgura_m} m` : '';
    return `#${ext.nodo_id}${holgura}`;
  }

  function _panelDetalle() {
    if (!_hiloSel) {
      return '<div class="hilos-detalle hilos-detalle--vacio">Selecciona un hilo para ver su detalle.</div>';
    }
    const encontrado = _buscarHilo(_hiloSel);
    if (!encontrado) return '<div class="hilos-detalle hilos-detalle--vacio">Hilo no encontrado.</div>';
    const tubo = encontrado.tubo;
    const hilo = encontrado.hilo;
    const extA = (hilo.extremos && hilo.extremos.A) || {};
    const extB = (hilo.extremos && hilo.extremos.B) || {};

    let html = '<div class="hilos-detalle">';
    html += '<div class="hilos-detalle-cab">'
      + `<span class="hilos-color" style="background:${escapeHtml(hilo.color_hex || '#888')}"></span>`
      + `<strong>${escapeHtml(hilo.nombre)}</strong>`
      + `<span class="hilos-hilo-g">global ${hilo.hilo_global_no}</span>`
      + `<span class="hilos-estado hilos-estado--${escapeHtml(hilo.estado)}">${escapeHtml(ETIQUETA_ESTADO[hilo.estado] || hilo.estado)}</span>`
      + '</div>';
    const sinBuffer = _esContenedorSinBuffer(tubo, _esCableDrop());
    const ubicacion = sinBuffer
      ? 'Sin buffer (fibra suelta del drop)'
      : `${String(tubo.tubo_no).padStart(2, '0')} · ${escapeHtml(tubo.color || '')}`;
    html += '<div class="hilos-detalle-grid">'
      + `<div><label>Ubicación</label><span>${ubicacion}</span></div>`
      + `<div><label>Posición en tubo</label><span>hilo ${hilo.hilo_no_en_tubo}</span></div>`
      + `<div><label>Perfil</label><span>${escapeHtml(hilo.perfil || '—')}</span></div>`
      + `<div><label>Color</label><span>${escapeHtml(hilo.color || '—')}</span></div>`
      + `<div><label>Extremo A</label><span>${escapeHtml(_textoExtremo(extA))}</span></div>`
      + `<div><label>Extremo B</label><span>${escapeHtml(_textoExtremo(extB))}</span></div>`
      + '</div>';
    html += '<div class="hilos-detalle-acciones">'
      + '<label for="hilos-sel-estado">Estado del hilo</label>'
      + '<select id="hilos-sel-estado">'
      + ESTADOS.map((e) => `<option value="${e}"${e === hilo.estado ? ' selected' : ''}>${escapeHtml(ETIQUETA_ESTADO[e])}</option>`).join('')
      + '</select>'
      + '<button type="button" class="hilos-btn hilos-btn--primario" onclick="FTTHHilos.guardarEstado()">Guardar estado</button>'
      + '</div>';
    html += '<div class="hilos-nota">Los extremos se anclarán a un nodo (caja, manga, ODF) en la fase de empalmes.</div>';
    html += '</div>';
    return html;
  }

  function verHilo(id) {
    _hiloSel = Number(id);
    pintar();
  }

  async function guardarEstado() {
    if (!_hiloSel || _ocupado) return;
    const sel = document.getElementById('hilos-sel-estado');
    if (!sel) return;
    _ocupado = true;
    try {
      const res = await fetch(apiUrl(`/api/fibras/${_hiloSel}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: sel.value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        aviso(err.detail || `No se pudo guardar (error ${res.status})`, 'error');
        return;
      }
      const data = await res.json();
      const encontrado = _buscarHilo(_hiloSel);
      if (encontrado) encontrado.hilo.estado = data.estado;
      aviso(`Hilo ${data.nombre} → ${ETIQUETA_ESTADO[data.estado] || data.estado}`, 'success');
      pintar();
    } catch (e) {
      console.error('[hilos] error guardando estado:', e);
      aviso('Error de red al guardar el estado', 'error');
    } finally {
      _ocupado = false;
    }
  }

  async function materializar(forzar) {
    if (!_cableId || _ocupado) return;
    _ocupado = true;
    _avisoForzar = null;
    try {
      const url = apiUrl(`/api/cables/${_cableId}/materializar-hilos?forzar=${forzar ? 'true' : 'false'}`);
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detalle = data.detail || `Error ${res.status}`;
        if (String(detalle).includes('forzar=true')) {
          _avisoForzar = detalle;
          pintar();
        } else {
          aviso(detalle, 'error');
        }
        return;
      }
      const rr = data.resultado || {};
      aviso(
        `Hilos: ${rr.tubos_creados || 0} tubo(s) y ${rr.hilos_creados || 0} hilo(s) creados`
        + ((rr.hilos_existentes || 0) ? `, ${rr.hilos_existentes} ya existían` : ''),
        'success'
      );
      (data.advertencias || []).forEach((a) => aviso(a, 'info'));
      await recargar();
    } catch (e) {
      console.error('[hilos] error materializando:', e);
      aviso('Error de red al materializar los hilos', 'error');
    } finally {
      _ocupado = false;
    }
  }

  return { cargar, recargar, verHilo, guardarEstado, materializar };
})();

window.FTTHHilos = FTTHHilos;
