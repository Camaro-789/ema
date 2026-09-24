/**
 * plantillas-visuales/fibra.js
 * Plantilla visual de un cable de fibra óptica para el diagrama del nodo.
 *
 * UNA sola plantilla de fibra, PARAMETRIZADA por el tipo del cable: recibe el
 * número de hilos (y el envase: looses × fibras por loose) y dibuja esa cantidad
 * exacta. Dentro de este archivo NO hay ninguna cantidad de hilos escrita a mano:
 * el fan-out, los colores y los conectores se generan con bucles a partir de los
 * parámetros (ver repartirHilos + svgFibra).
 *
 *   con buffer → agrupa por buffer: número_de_looses contenedores de
 *                fibras_por_loose hilos (el último puede quedar parcial)
 *   drop       → SIN buffer: los hilos salen directos del jacket
 *
 * Los colores de buffers e hilos salen siempre de window.FTTHColores (la paleta
 * manda su propio ciclo: aquí no se repite el 12).
 * Se auto-registra en FTTHPlantillas con dos claves, que son solo el MODO:
 *   'fibra_cable'      → con buffer
 *   'fibra_cable_drop' → plano (drop)
 */
const FTTHPlantillaFibra = (() => {

  const CLAVE = 'fibra_cable';
  const ICONO = 'fa-solid fa-cable-car'; // ícono representativo

  // Si el total de hilos ≤ este umbral → es cable DROP (sin buffer).
  // OJO: es solo el criterio de respaldo para tipos ANTIGUOS que no declaran su
  // estructura. Lo que manda es `estructura` ('con_buffer' | 'drop') de la
  // plantilla: un drop de 6 u 8 hilos también va sin buffer.
  const UMBRAL_DROP = 4;

  // Clave de la estructura «drop» (misma que FTTHCableReglas / backend)
  const ESTRUCTURA_DROP = 'drop';
  const CLAVE_DROP = 'fibra_cable_drop';

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function texto(v) {
    const s = String(v == null ? '' : v).trim();
    return s === 'null' || s === 'undefined' ? '' : s;
  }

  function numero(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * ¿Este cable es un drop (sin buffer)?
   * Manda la ESTRUCTURA declarada por la plantilla del tipo ('drop'). Si el tipo
   * es antiguo y no la declara, se cae al criterio de siempre (≤ 4 hilos).
   */
  function esDrop(totalFibras, estructura) {
    const est = String(estructura == null ? '' : estructura).trim().toLowerCase();
    if (est) return est === ESTRUCTURA_DROP;
    return (numero(totalFibras) || 0) <= UMBRAL_DROP;
  }

  /** Color TIA-598 de una posición. El ciclo lo manda la paleta (FTTHColores.TOTAL). */
  function colorDePosicion(n) {
    const col = window.FTTHColores;
    if (!col) return { hex: '#888888', nombre: '' };
    const total = col.TOTAL || 1;
    const idx = ((Math.max(1, Math.trunc(n || 1)) - 1) % total) + 1;
    return { hex: col.hex(idx), nombre: col.nombre(idx) };
  }

  /** ¿Este hex es «blanco»? (para que el trazo se vea sobre el fondo blanco) */
  function esBlanco(hex) {
    const h = String(hex || '').toLowerCase();
    return h === '#ffffff' || h === '#f1f5f9';
  }

  /** '— dBm' cuando no hay valor; si lo hay, 2 decimales (misma regla que el splitter). */
  function fDbm(v) {
    const n = numero(v);
    return n === null ? '— dBm' : `${n.toFixed(2)} dBm`;
  }

  /**
   * Potencia de un hilo con la regla ya definida: manda la MEDIDA (OTDR) y, solo
   * si no hay ninguna medida, se usa la TEÓRICA. Sin dato → '— dBm' (nunca se
   * inventa una potencia).
   * @returns {{valor: number|null, origen: 'medido'|'teorico'|''}}
   */
  function potenciaDeHilo(hilo) {
    const h = hilo || {};
    const medida = numero(h.otdr_dbm !== undefined ? h.otdr_dbm : h.dbm_medido);
    const teorica = numero(
      h.teorica_dbm !== undefined ? h.teorica_dbm
        : (h.potencia_dbm !== undefined ? h.potencia_dbm : h.dbm_teorico)
    );
    if (medida !== null) return { valor: medida, origen: 'medido' };
    if (teorica !== null) return { valor: teorica, origen: 'teorico' };
    return { valor: null, origen: '' };
  }

  /**
   * Reparte los hilos del TIPO en sus contenedores. ÚNICA fuente de la estructura.
   *
   *   con buffer → `looses` contenedores de `fibrasLoose` hilos cada uno.
   *                Si el total no llena el último, queda PARCIAL: no se inventan
   *                hilos que el tipo no declara.
   *   drop       → UN solo tramo SIN buffer: los hilos salen directos del jacket.
   *
   * Reglas de respaldo, para tipos viejos sin envase declarado (nunca un número
   * inventado): si falta `fibrasLoose` se reparte total ÷ looses; si tampoco hay
   * `looses`, un único contenedor con todos los hilos.
   *
   * @param {number} hilos        nº TOTAL de hilos del tipo (con o sin buffer)
   * @param {number} [looses]     nº de buffers del tipo (null/0 en un drop)
   * @param {number} [fibrasLoose] hilos por buffer del tipo (null/0 en un drop)
   * @param {string} [estructura] 'con_buffer' | 'drop'
   * @returns {Array<{bufferNo:number|null, esBuffer:boolean, hilos:number}>}
   */
  function repartirHilos({ hilos, looses, fibrasLoose, estructura } = {}) {
    const total = Math.max(0, Math.trunc(numero(hilos) || 0));
    if (total === 0) return [];                    // sin hilos declarados: nada que dibujar

    if (esDrop(total, estructura)) {
      return [{ bufferNo: null, esBuffer: false, hilos: total }];
    }

    const nLooses = Math.max(1, Math.trunc(numero(looses) || 1));
    const porBuffer = Math.max(1, Math.trunc(numero(fibrasLoose) || Math.ceil(total / nLooses)));

    const contenedores = [];
    let repartidos = 0;
    for (let i = 0; i < nLooses && repartidos < total; i++) {
      const enEste = Math.min(porBuffer, total - repartidos);
      contenedores.push({ bufferNo: i + 1, esBuffer: true, hilos: enEste });
      repartidos += enEste;
    }
    return contenedores;
  }

  /**
   * Compatibilidad: la lista de buffers (solo los contenedores «con buffer»).
   * Delega en repartirHilos, así que no hay dos maneras de calcular el envase.
   * Retorna: [{ bufferNo, colorHex, colorNombre, fibras }]
   */
  function calcularBuffers(totalFibras, fibrasLoose, estructura) {
    return repartirHilos({ hilos: totalFibras, fibrasLoose, estructura })
      .filter((c) => c.esBuffer)
      .map((c) => {
        const col = colorDePosicion(c.bufferNo);
        return { bufferNo: c.bufferNo, colorHex: col.hex, colorNombre: col.nombre, fibras: c.hilos };
      });
  }

  /** Chip de resumen de ocupación. */
  function chipOcupacion(usadas, total) {
    const pct = total > 0 ? Math.round((usadas / total) * 100) : 0;
    const clase = pct >= 90 ? 'pv-fibra__chip--rojo'
      : pct >= 60 ? 'pv-fibra__chip--naranja'
      : 'pv-fibra__chip--verde';
    return `<span class="pv-fibra__chip ${clase}">${usadas}/${total} hilos</span>`;
  }

  // ── Geometría del dibujo (posiciones del viewBox, NO cantidades de hilos) ──
  const HILO_SEP = 22;            // separación vertical entre hilos
  const VIEW_W = 380;
  const ALTO_MIN = 140;
  const X_CHAQUETA = 10;
  const ANCHO_CHAQUETA = 44;
  const X_BUFFER = 60;
  const ANCHO_BUFFER = 76;
  const X_NODO = X_BUFFER + ANCHO_BUFFER;   // nodo del borde derecho del buffer
  const X_QUIEBRE = X_NODO + 55;            // quiebre del abanico
  const X_TERMINAL = VIEW_W - 24;           // círculo terminal del hilo

  /**
   * LA plantilla de fibra: dibuja chaqueta → buffers → hilos.
   * Sirve para CUALQUIER cantidad de hilos (1, 2, 4, 6, 8, 12, 144…): el fan-out,
   * los colores y los conectores se generan con bucles a partir de los parámetros.
   * Aquí no hay ninguna cantidad de hilos escrita a mano.
   *
   * @param {Object} cable
   * @param {number} cable.hilos         nº TOTAL de hilos del tipo (parámetro clave)
   * @param {number} [cable.looses]      nº de buffers del tipo (solo «con buffer»)
   * @param {number} [cable.fibrasLoose] hilos por buffer del tipo (solo «con buffer»)
   * @param {string} [cable.estructura]  'con_buffer' | 'drop'
   * @param {Array}  [cable.hilosReales] hilos de la BD (color/estado reales, opcional)
   * @returns {string} SVG listo para insertar ('' si el tipo no declara hilos)
   */
  function svgFibra({ hilos, looses, fibrasLoose, estructura, hilosReales } = {}) {
    const contenedores = repartirHilos({ hilos, looses, fibrasLoose, estructura });
    const total = contenedores.reduce((n, c) => n + c.hilos, 0);
    if (!total) return '';

    const reales = Array.isArray(hilosReales) ? hilosReales : [];
    const viewH = Math.max(ALTO_MIN, total * HILO_SEP + 40);
    const centroY = viewH / 2;
    const yPrimero = centroY - ((total - 1) * HILO_SEP) / 2;

    let svg = `<svg viewBox="0 0 ${VIEW_W} ${viewH}" xmlns="http://www.w3.org/2000/svg" class="pv-fibra-svg" style="width:100%;height:auto;overflow:visible;display:block;">`;

    // ── Chaqueta exterior (jacket) ─────────────────────────────────────────
    const jacketH = Math.min(60, Math.max(40, total * HILO_SEP * 0.45));
    svg += `<rect x="${X_CHAQUETA}" y="${centroY - jacketH / 2}" width="${ANCHO_CHAQUETA}" height="${jacketH}" rx="10" fill="#1e293b"/>`;

    let nHilo = 0;                                   // posición 1..N dentro del cable
    contenedores.forEach((cont) => {
      const yIni = yPrimero + nHilo * HILO_SEP;
      const yFin = yPrimero + (nHilo + cont.hilos - 1) * HILO_SEP;
      const yMedio = (yIni + yFin) / 2;

      if (cont.esBuffer) {
        const colBuf = colorDePosicion(cont.bufferNo);
        const alto = Math.max(HILO_SEP + 20, cont.hilos * HILO_SEP - 6);
        // Caja del buffer (fondo con el color del buffer)
        svg += `<rect x="${X_BUFFER}" y="${yMedio - alto / 2}" width="${ANCHO_BUFFER}" height="${alto}" rx="8" fill="${escapeHtml(colBuf.hex)}"/>`;
        svg += `<text x="${X_BUFFER + ANCHO_BUFFER / 2}" y="${yMedio - 4}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#ffffff" letter-spacing="0.5px" pointer-events="none">BUFFER</text>`;
        svg += `<text x="${X_BUFFER + ANCHO_BUFFER / 2}" y="${yMedio + 8}" text-anchor="middle" font-size="8.5" font-weight="800" fill="#ffffff" letter-spacing="0.5px" pointer-events="none">${escapeHtml(String(colBuf.nombre).toUpperCase())}</text>`;
        // Conector chaqueta → buffer
        svg += `<path d="M${X_CHAQUETA + ANCHO_CHAQUETA},${centroY} L${X_BUFFER},${yMedio}" fill="none" stroke="#94a3b8" stroke-width="2" opacity="0.5"/>`;
        // Nodo concéntrico de salida del buffer
        svg += `<circle cx="${X_NODO}" cy="${yMedio}" r="7" fill="#ffffff" stroke="${escapeHtml(colBuf.hex)}" stroke-width="3"/>`;
        svg += `<circle cx="${X_NODO}" cy="${yMedio}" r="3" fill="${escapeHtml(colBuf.hex)}"/>`;
      }

      for (let k = 0; k < cont.hilos; k++) {         // ← tantos hilos como diga el tipo
        const y = yPrimero + nHilo * HILO_SEP;
        const real = reales[nHilo] || null;
        // Manda el color REAL del hilo (BD); si no viene, su posición en el contenedor
        const colHilo = (real && real.color_hex)
          ? { hex: real.color_hex, nombre: real.color || '' }
          : colorDePosicion(k + 1);
        const trazo = esBlanco(colHilo.hex) ? '#cbd5e1' : colHilo.hex;
        const estado = (real && real.estado && real.estado !== 'libre') ? real.estado : '';
        const xOrigen = cont.esBuffer ? X_NODO : X_CHAQUETA + ANCHO_CHAQUETA;
        const yOrigen = cont.esBuffer ? yMedio : centroY;
        const d = `M ${xOrigen},${yOrigen} L ${X_QUIEBRE},${y} L ${X_TERMINAL},${y}`;

        // Potencia del hilo: MEDIDA si existe, si no la TEÓRICA, si no '— dBm'
        const pot = potenciaDeHilo(real);
        const dbmTexto = fDbm(pot.valor);

        svg += `<g class="strand" data-hilo-global="${nHilo + 1}" data-buffer="${cont.bufferNo || 0}" data-color="${escapeHtml(colHilo.nombre)}" data-hex="${escapeHtml(colHilo.hex)}" data-dbm="${escapeHtml(dbmTexto)}" data-dbm-origen="${pot.origen}" data-estado="${escapeHtml(estado)}">`;
        // 1) Línea + conector (trazado invisible de 16px para el cursor, y el visible)
        svg += `<path d="${d}" fill="none" stroke="transparent" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" pointer-events="stroke"/>`;
        svg += `<path class="strand-line" d="${d}" fill="none" stroke="${escapeHtml(trazo)}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
        // 2) Punto terminal del hilo
        svg += `<circle class="strand-dot" cx="${X_TERMINAL}" cy="${y}" r="6.5" fill="${escapeHtml(colHilo.hex)}" stroke="${escapeHtml(trazo)}" stroke-width="1.4"/>`;
        // 3) Etiqueta de potencia en la punta (aparece al pasar el cursor por el hilo)
        svg += `<text class="strand-dbm" x="${X_TERMINAL - 11}" y="${y + 3.5}" text-anchor="end">${escapeHtml(dbmTexto)}</text>`;
        svg += `</g>`;
        nHilo++;
      }
    });

    svg += `</svg>`;
    return svg;
  }

  /**
   * HTML completo de la tarjeta de fibra.
   *
   * Los hilos son un PARÁMETRO (los del tipo): si el tipo no los declara, NO se
   * dibuja ningún diseño por defecto — se avisa en la propia tarjeta (decisión (b)).
   */
  function render(datos) {
    const d = datos || {};

    const modelo = texto(d.modelo) || texto(d.nombre) || 'Fibra Óptica';
    const hilos = numero(d.fibras);                 // ← nº de hilos del TIPO (nunca 12 por defecto)
    const estructura = texto(d.estructura);         // 'con_buffer' | 'drop' | ''
    const contenedores = repartirHilos({ hilos, looses: d.looses, fibrasLoose: d.fibrasLoose, estructura });
    const total = contenedores.reduce((n, c) => n + c.hilos, 0);
    const buffers = contenedores.filter((c) => c.esBuffer);
    const esPlano = total > 0 && esDrop(total, estructura);
    const nivel = texto(d.nivel);
    const ocupacion = d.ocupacion || { usadas: 0, total };

    // Sub-description
    let subDescripcion;
    if (!total) {
      subDescripcion = 'Sin hilos declarados en el tipo';
    } else if (esPlano) {
      subDescripcion = `DROP (sin buffer) · ${total} Hilos`;
    } else {
      const bufNombre = buffers.length ? ` (${buffers[0].esBuffer ? colorDePosicion(buffers[0].bufferNo).nombre : ''})` : '';
      subDescripcion = `${buffers.length} Buffer${bufNombre} · ${total} Hilos`;
    }

    // El id del CABLE (una fibra NO es un dispositivo). `data-cable-id` lo usa
    // «Propiedades de fibra» y `data-borrar` lo lee el modo eliminar del diagrama:
    // ahí borrar una fibra = quitarla de ese nodo (desanclar sus hilos), NUNCA
    // mandar el id del cable al endpoint de dispositivos (eso daba
    // "El dispositivo #N no esta en el elemento #M" al intentar borrarla).
    const idCable = numero(d.cable_id != null ? d.cable_id : d.id);
    const attrBorrar = idCable === null ? '' : ` data-borrar="cable:${idCable}"`;

    // ── HTML de la tarjeta de fibra ───────────────────────────────────────
    let html = `<div class="pv-fibra fiber-card" data-cable-id="${idCable || ''}" data-pv-plantilla="${escapeHtml(CLAVE)}" data-estructura="${escapeHtml(estructura)}"${attrBorrar}>`;

    // Cabecera
    html += `<div class="pv-fibra__cab fiber-header">`;
    html += `<div class="pv-fibra__titulo fiber-title">${escapeHtml(modelo)}</div>`;
    html += `<div class="pv-fibra__subtitulo fiber-subtitle">${escapeHtml(subDescripcion)}</div>`;
    html += `</div>`;

    // SVG de la fibra: tantos hilos como declare el tipo
    html += `<div class="pv-fibra__svg-wrap fiber-canvas">`;
    if (total) {
      html += svgFibra({
        hilos,
        looses: d.looses,
        fibrasLoose: d.fibrasLoose,
        estructura,
        hilosReales: d.hilosReales,
      });
    } else {
      html += '<div class="pv-fibra__aviso">Este tipo no declara sus hilos: '
        + 'ponle «Número total de fibras» (con buffer) o «Número total de hilos» (drop) '
        + 'en Tipos de objetos.</div>';
    }
    html += `</div>`;

    // Pie con ocupación e interacción
    html += `<div class="pv-fibra__pie fiber-footer">`;
    html += `<span>Ocupación: <strong>${ocupacion.usadas || 0}/${total}</strong></span>`;
    html += `<span class="click-hint"><i class="fa-solid fa-computer-mouse"></i> Clic derecho → Propiedades</span>`;
    html += `</div>`;

    html += `</div>`;
    return html;
  }

  /**
   * Tarjeta del cable DROP: la MISMA tarjeta pero forzada a la estructura plana
   * (sin buffers), porque el tipo declara plantilla_visual = 'fibra_cable_drop'.
   */
  function renderDrop(datos) {
    return render(Object.assign({}, datos || {}, { estructura: ESTRUCTURA_DROP }));
  }

  // ── Auto-registro ─────────────────────────────────────────────────────────
  // Dos plantillas visuales distintas, que es lo que declara el tipo del cable:
  //   'fibra_cable'      → agrupa por buffer (fondo con la franja de color)
  //   'fibra_cable_drop' → plana: los hilos salen directos del jacket
  if (window.FTTHPlantillas && typeof window.FTTHPlantillas.registrar === 'function') {
    window.FTTHPlantillas.registrar(CLAVE, render, {
      etiqueta: 'Cable de Fibra Óptica',
      categoria: 'cables',
      descripcion: 'Tarjeta visual del cable: jacket, buffers TIA-598 e hilos codificados por color.',
      generica: true,
    });
    window.FTTHPlantillas.registrar(CLAVE_DROP, renderDrop, {
      etiqueta: 'Cable DROP (sin buffer)',
      categoria: 'cables',
      descripcion: 'Tarjeta plana del cable DROP: sin buffers, los hilos salen directos del jacket.',
    });
  }

  // ── Tooltip y Menú Contextual de Fibra Óptica ─────────────────────────────

  function _ensureTooltipEl() {
    let tip = document.getElementById('fiberTooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'fiberTooltip';
      tip.className = 'fiber-tooltip';
      document.body.appendChild(tip);
    }
    return tip;
  }

  function showTip(e, colorName, hex, dbm) {
    const tip = _ensureTooltipEl();
    const dotStyle = (hex === '#FFFFFF' || hex === '#ffffff' || hex === '#F1F5F9' || hex === '#f1f5f9')
      ? 'background:#fff;box-shadow:inset 0 0 0 1px #c7c7cc;'
      : 'background:' + hex + ';';
    const dbmVal = (dbm !== undefined && dbm !== null && dbm !== '') ? dbm : '';

    tip.innerHTML =
      '<span class="tip-dot" style="' + dotStyle + '"></span>' +
      '<span class="tip-name">' + escapeHtml(colorName) + '</span>' +
      '<span class="tip-dbm">(<span class="dbm-value">' + escapeHtml(dbmVal) + '</span> dBm)</span>';

    tip.classList.add('visible');
    moveTip(e);
  }

  function moveTip(e) {
    const tip = document.getElementById('fiberTooltip');
    if (!tip || !tip.classList.contains('visible')) return;
    const off = 16;
    let x = e.clientX + off;
    let y = e.clientY + off;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - off;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - off;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function hideTip() {
    const tip = document.getElementById('fiberTooltip');
    if (tip) tip.classList.remove('visible');
  }

  function _ensureContextMenu() {
    let menu = document.getElementById('contextMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'contextMenu';
      menu.className = 'context-menu';
      menu.innerHTML = `
        <div class="context-item" id="ctxProperties">
          <i class="fa-solid fa-circle-info"></i> Propiedades
        </div>
      `;
      document.body.appendChild(menu);
      menu.querySelector('#ctxProperties')?.addEventListener('click', () => {
        hideContextMenu();
        const cableId = menu.getAttribute('data-cable-id');
        if (cableId && window.FTTHFibraInspector && typeof window.FTTHFibraInspector.abrir === 'function') {
          window.FTTHFibraInspector.abrir(cableId);
        } else if (cableId && window.showPropertiesModalById) {
          window.showPropertiesModalById(cableId);
        }
      });
    }
    return menu;
  }

  function showContextMenu(x, y, cableId) {
    const menu = _ensureContextMenu();
    menu.setAttribute('data-cable-id', cableId || '');
    menu.classList.add('visible');
    const r = menu.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }

  function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    if (menu) menu.classList.remove('visible');
  }

  // Bindings globales de ratón para Tooltip y Menú Contextual
  document.addEventListener('mouseover', (e) => {
    const strand = e.target && e.target.closest && e.target.closest('.strand');
    if (!strand) return;
    const color = strand.getAttribute('data-color') || 'Hilo';
    const hex = strand.getAttribute('data-hex') || '#888';
    const dbm = strand.getAttribute('data-dbm') || '';
    showTip(e, color, hex, dbm);
  });

  document.addEventListener('mousemove', (e) => {
    const strand = e.target && e.target.closest && e.target.closest('.strand');
    if (strand) moveTip(e);
  });

  document.addEventListener('mouseout', (e) => {
    const strand = e.target && e.target.closest && e.target.closest('.strand');
    if (strand) hideTip();
  });

  document.addEventListener('contextmenu', (e) => {
    const card = e.target && e.target.closest && e.target.closest('.pv-fibra, .fiber-card');
    if (!card) return;
    e.preventDefault();
    const cableId = card.getAttribute('data-cable-id') || '';
    showContextMenu(e.clientX, e.clientY, cableId);
  });

  document.addEventListener('mousedown', (e) => {
    const menu = document.getElementById('contextMenu');
    if (menu && !menu.contains(e.target)) hideContextMenu();
  });

  window.addEventListener('blur', hideContextMenu);
  window.addEventListener('resize', hideContextMenu);

  return {
    CLAVE,
    CLAVE_DROP,
    render,
    renderDrop,
    // LA plantilla parametrizada y sus piezas puras (las usan las pruebas)
    svgFibra,
    repartirHilos,
    colorDePosicion,
    potenciaDeHilo,
    fDbm,
    calcularBuffers,
    esDrop,
  };

})();

window.FTTHPlantillaFibra = FTTHPlantillaFibra;
