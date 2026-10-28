/**
 * plantillas-visuales/splitter.js
 * Estructura visual de un splitter óptico, para el diagrama del nodo.
 *
 * Extraída de la referencia Splitter1x8.htm, pero sin NADA fijo:
 *   - nombre, subtítulo, relación de división, atenuación, potencias
 *     (teórica y OTDR), serie y número de puertos llegan en `datos`;
 *   - los colores de los puertos salen de window.FTTHColores (TIA-598-C),
 *     nunca de este archivo.
 *
 * Se registra sola en FTTHPlantillas con la clave que se guarda en
 * `ftth_tipos.propiedades.plantilla_visual` = 'splitter_1x8'.
 */
const FTTHPlantillaSplitter = (() => {

  const CLAVE = 'splitter_1x8';
  const ICONO = 'fa-solid fa-code-branch';

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Texto limpio: '' en vez de undefined/null/'null'. */
  function texto(v) {
    const s = String(v == null ? '' : v).trim();
    return s === 'null' || s === 'undefined' ? '' : s;
  }

  function numero(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** '— dBm' cuando no hay medida; si la hay, 2 decimales. */
  function fDbm(v) {
    const n = numero(v);
    return n === null ? '— dBm' : `${n.toFixed(2)} dBm`;
  }

  /** '— dB' cuando no hay valor; si lo hay, 2 decimales. */
  function fDb(v) {
    const n = numero(v);
    return n === null ? '— dB' : `${n.toFixed(2)} dB`;
  }

  /**
   * Color del puerto: manda el color que venga en los datos (el de la BD) y,
   * si no viene, la posición TIA-598 que le toca por índice (cicla cada 12).
   */
  function colorDeSalida(salida, indice) {
    const col = window.FTTHColores;
    const s = salida || {};

    const hexDirecto = texto(s.color_hex);
    if (hexDirecto) {
      return { hex: hexDirecto, nombre: col ? col.nombrePorHex(hexDirecto) : '' };
    }
    const hexPorNombre = (col && texto(s.color)) ? col.hexPorNombre(s.color) : '';
    if (hexPorNombre) return { hex: hexPorNombre, nombre: texto(s.color) };

    if (!col) return { hex: '', nombre: '' };
    return { hex: col.hex(indice + 1), nombre: col.nombre(indice + 1) };
  }

  /** Una fila de puerto de salida (número · teórica · OTDR · color). */
  function filaSalida(salida, indice) {
    const s = salida || {};
    const color = colorDeSalida(s, indice);
    const numeroPuerto = numero(s.numero) === null ? indice + 1 : numero(s.numero);

    const detalles = [texto(s.etiqueta), texto(s.estado), texto(s.conector)].filter(Boolean);
    const titulo = detalles.length ? ` title="${escapeHtml(detalles.join(' · '))}"` : '';

    const id = numero(s.id);
    // data-puerto: el diagrama ya escucha [data-puerto] dentro de #diag-body,
    // asi que la fila se selecciona igual que en la tarjeta clasica.
    const clic = id === null ? '' : ` data-puerto="${id}" data-puerto-no="${numeroPuerto}" data-color="${escapeHtml(color.nombre)}" data-hex="${escapeHtml(color.hex)}" data-dbm="${escapeHtml(fDbm(s.teorica_dbm))}"`;

    const pintura = color.hex ? ` style="--pv-color:${escapeHtml(color.hex)}"` : '';
    const atajo = color.nombre ? ` title="${escapeHtml(color.nombre)}"` : '';

    const clases = 'pv-splitter__fila' + (s.seleccionado ? ' pv-splitter__fila--sel' : '');

    return `<div class="${clases}"${clic}${titulo}>`
      + `<span class="pv-splitter__num">${escapeHtml(numeroPuerto)}</span>`
      + `<span class="pv-splitter__val">${escapeHtml(fDbm(s.teorica_dbm))}</span>`
      + `<span class="pv-splitter__val">${escapeHtml(fDbm(s.otdr_dbm))}</span>`
      + `<span class="pv-splitter__def">`
      + `<span class="pv-splitter__color"${pintura}${atajo}></span>`
      + '</span></div>';
  }

  /**
   * Alterna la vista de colores de la tarjeta (norma TIA-598 ↔ neutro).
   * Se llama desde el propio botón de la tarjeta.
   */
  function alternarColores(boton) {
    if (!boton || typeof boton.closest !== 'function') return;
    const tarjeta = boton.closest('.pv-splitter');
    if (!tarjeta || !tarjeta.classList) return;

    const pasaANeutro = !tarjeta.classList.contains('pv-neutro');
    tarjeta.classList.toggle('pv-neutro', pasaANeutro);
    tarjeta.classList.toggle('pv-coloreado', !pasaANeutro);

    const icono = typeof boton.querySelector === 'function' ? boton.querySelector('i') : null;
    if (icono) icono.className = pasaANeutro ? 'fa-solid fa-eye-slash' : 'fa-solid fa-palette';
    if (boton.style) boton.style.opacity = pasaANeutro ? '0.5' : '1';
  }

  /**
   * Devuelve el HTML de la tarjeta del splitter.
   *
   * @param {Object} datos
   *   nombre, modelo, subtitulo, relacion, serie, estado, atenuacion_db,
   *   salidasDeclaradas, colorPorHilo,
   *   entrada: { etiqueta, potencia_dbm },
   *   salidas: [{ numero, etiqueta, estado, conector, teorica_dbm, otdr_dbm,
   *               color, color_hex }]
   */
  function render(datos) {
    const d = datos || {};

    const modelo = texto(d.modelo) || texto(d.nombre) || 'Splitter';
    const serie = texto(d.serie);
    // La serie del aparato es mas util que la leyenda decorativa: si existe, manda.
    const subtitulo = serie ? `S/N ${serie}` : texto(d.subtitulo);
    const relacion = texto(d.relacion);
    const icono = texto(d.icono) || ICONO;
    const listaSalidas = Array.isArray(d.salidas) ? d.salidas : [];
    const totalSalidas = listaSalidas.length || (numero(d.salidasDeclaradas) || 0);
    const arrancaNeutro = d.colorPorHilo === false;

    const herramienta = [texto(d.serie), texto(d.estado)].filter(Boolean).join(' · ');
    const attrTarjeta = herramienta ? ` title="${escapeHtml(herramienta)}"` : '';
    // data-borrar: permite que el modo eliminar del diagrama identifique la
    // tarjeta (el clic sobre ella borra el aparato). El id tiene que ser SIEMPRE
    // el del DISPOSITIVO: se pide por su nombre (`dispositivo_id`) y solo se cae a
    // `id` para no romper a quien ya lo pasa bien (un cable, por ejemplo, NO es un
    // dispositivo y jamás debe llegar por aquí).
    const idDev = numero(d.dispositivo_id !== undefined ? d.dispositivo_id : d.id);
    const attrBorrar = idDev === null ? '' : ` data-borrar="dispositivo:${idDev}"`;

    // ── Cabecera ──
    let html = `<div class="pv-splitter ${arrancaNeutro ? 'pv-neutro' : 'pv-coloreado'}"`
      + ` data-pv-plantilla="${escapeHtml(CLAVE)}"${attrTarjeta}${attrBorrar}>`
      + '<div class="pv-splitter__cab">'
      + '<span class="pv-splitter__cab-izq">'
      + `<span class="pv-splitter__icono"><i class="${escapeHtml(icono)}"></i></span>`
      + '<span class="pv-splitter__textos">'
      + `<span class="pv-splitter__titulo">${escapeHtml(modelo)}</span>`
      + (subtitulo ? `<span class="pv-splitter__subtitulo">${escapeHtml(subtitulo)}</span>` : '')
      + '</span></span>'
      + (relacion ? `<span class="pv-splitter__badge">${escapeHtml(relacion)}</span>` : '')
      + '</div>';

    // ── Cuerpo: entrada + salidas ──
    const entrada = d.entrada || {};
    const etiquetaIn = texto(entrada.etiqueta) || 'IN';

    const idIn = numero(entrada.id);
    const clicIn = idIn === null ? '' : ` data-puerto="${idIn}" data-color="Entrada" data-hex="#1d1d1f" data-dbm="${escapeHtml(fDbm(entrada.potencia_dbm))}"`;
    const claseIn = 'pv-splitter__entrada' + (entrada.seleccionado ? ' pv-splitter__entrada--sel' : '');

    html += '<div class="pv-splitter__cuerpo">'
      + `<div class="${claseIn}"${clicIn}>`
      + '<span class="pv-splitter__nodo"></span>'
      + `<span class="pv-splitter__in-label">${escapeHtml(etiquetaIn)}</span>`
      + `<span class="pv-splitter__in-val">${escapeHtml(fDbm(entrada.potencia_dbm))}</span>`
      + '</div>'
      + '<div class="pv-splitter__salidas">'
      + '<div class="pv-splitter__thead">'
      + '<span class="pv-splitter__th">#</span>'
      + '<span class="pv-splitter__th"><i class="fa-solid fa-calculator"></i>Teórica</span>'
      + '<span class="pv-splitter__th"><i class="fa-solid fa-wave-square"></i>OTDR</span>'
      + '<span class="pv-splitter__th pv-splitter__th--accion">'
      + '<button type="button" class="pv-boton-paleta" data-pv-accion="colores"'
      + ' title="Alternar colores norma / neutro"'
      + ' onclick="window.FTTHPlantillaSplitter.alternarColores(this)">'
      + '<i class="fa-solid fa-palette"></i></button>'
      + '</span></div>'
      + '<div class="pv-splitter__filas">'
      + (listaSalidas.length
          ? listaSalidas.map(filaSalida).join('')
          : '<div class="pv-splitter__vacio">Este splitter no tiene puertos de salida.</div>')
      + '</div></div></div>';

    // ── Pie ──
    html += '<div class="pv-splitter__pie">'
      + `<span class="pv-splitter__pie-tag">${escapeHtml(modelo)}</span>`
      + `<span class="pv-splitter__pie-item">Atenuación <strong>${escapeHtml(fDb(d.atenuacion_db))}</strong></span>`
      + '<span class="pv-splitter__pie-dot"></span>'
      + `<span class="pv-splitter__pie-item"><strong>${escapeHtml(totalSalidas)}</strong> puerto${totalSalidas === 1 ? '' : 's'}</span>`
      + (numero(d.salidasLibres) === null ? ''
          : '<span class="pv-splitter__pie-dot"></span>'
            + `<span class="pv-splitter__pie-item"><strong>${escapeHtml(numero(d.salidasLibres))}</strong> libre${numero(d.salidasLibres) === 1 ? '' : 's'}</span>`)
      + '</div>';

    return html + '</div>';
  }

  // Auto-registro en el registro central: la clave es el valor que se guarda
  // en `ftth_tipos.propiedades.plantilla_visual`.
  if (window.FTTHPlantillas && typeof window.FTTHPlantillas.registrar === 'function') {
    // La MISMA plantilla sirve para 1x2 ... 1x64: el badge y las filas salen de
    // los datos. 'splitter_generico' es la clave preferida; 'splitter_1x8' se
    // mantiene como alias para los tipos que ya la tuvieran guardada.
    window.FTTHPlantillas.registrar('splitter_generico', render, {
      etiqueta: 'Splitter PLC (cualquier division)',
      categoria: 'splitter',
      generica: true,
    });
    window.FTTHPlantillas.registrar(CLAVE, render, {
      etiqueta: 'Splitter PLC 1x8',
      categoria: 'splitter',
      descripcion: 'Entrada IN, sus puertos de salida con potencia teórica y OTDR, y la atenuación.',
      generica: true,
    });
  }

  return { CLAVE, render, alternarColores };

})();

window.FTTHPlantillaSplitter = FTTHPlantillaSplitter;
