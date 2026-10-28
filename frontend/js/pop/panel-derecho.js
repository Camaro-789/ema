/**
 * panel-derecho.js — Panel de TRAZABILIDAD del POP (paso 2).
 *
 * Copia la «ventana de linterna» de la plantilla (`#torchWin` en el HTML v25):
 * misma cabecera negra con el icono, el título «PASANDO LUZ · ORIGEN → FINAL»,
 * el botón DETENER, y el cuerpo con el elemento seleccionado, el origen, la
 * insignia de dirección (`.dirbadge pon|dat`) y el resumen de tramos.
 *
 * Arriba se listan las rutas detectadas con su botón ENCENDER.
 */
const ICONO = `<svg width="24" height="20" viewBox="0 0 26 24" fill="none"
  stroke="#000" stroke-width="1.7" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="9" width="9" height="6" fill="#f59e0b"/>
  <path d="M11 8 L15 6 V18 L11 16Z" fill="#f59e0b"/>
  <path d="M18 8 L23 5 M19 12 H25 M18 16 L23 19"/></svg>`;

export function renderPanelDerecho(host, rutas, opciones) {
  const {
    alEncender, alDetener, activa, energia = null, sentido = 'R',
    alOrigen = null, alTx = null, alSentido = null,
  } = opciones;
  const lista = (rutas || []).map((ruta, indice) => {
    const dbm = ruta.dbm === null || ruta.dbm === undefined ? null : Number(ruta.dbm);
    return `
    <li class="pop-ruta ${activa && activa.id === ruta.id ? 'is-on' : ''}">
      <span class="pop-ruta-n">${indice + 1}</span>
      <span class="pop-ruta-txt">${ruta.etiqueta}</span>
      ${dbm === null ? '' : `<span class="pop-ruta-dbm is-${ruta.estado || 'ok'}"
        title="potencia teórica al final de la traza">${dbm.toFixed(1)} dBm</span>`}
      <button type="button" class="pop-btn" data-ruta="${ruta.id}">
        ${activa && activa.id === ruta.id ? 'DETENER' : 'ENCENDER'}
      </button>
    </li>`;
  }).join('');

  const candidatos = (energia && energia.candidatos) || [];
  const elegido = energia && energia.origen;
  const tx = energia && energia.tx !== null && energia.tx !== undefined ? energia.tx : 0;
  const selector = `
    <div class="pop-origen">
      <div class="pop-origen-h"><b>ORIGEN · TX</b><small>potencia teórica</small></div>
      ${candidatos.length
        ? `<select data-origen>${candidatos.map((c) => `<option value="${c.id}"
            ${elegido && elegido.id === c.id ? 'selected' : ''}>${c.etiqueta}</option>`).join('')}
           </select>`
        : '<p class="pop-vacio">Conecta un puerto de origen (PON · SFP · RJ45 · hilo) para calcular la potencia.</p>'}
      <label class="pop-tx">TX
        <input type="number" step="0.1" data-tx value="${Number(tx).toFixed(1)}"> dBm
      </label>
    </div>`;

  host.innerHTML = `
    <div class="pop-panel-cabecera">
      <b>TRAZABILIDAD</b>
      <small>${(rutas || []).length} ruta(s)</small>
    </div>
    ${selector}
    <div class="pop-panel-cuerpo">
      ${lista
        ? `<ul class="pop-rutas">${lista}</ul>`
        : '<p class="pop-panel-vacio">Sin rutas: conecta dos extremos para poder pasar luz.</p>'}
    </div>
    <div class="pop-torch ${activa ? '' : 'is-oculto'}" id="popTorchWin">
      <div class="tw-h">
        <span class="tw-ic ${sentido === 'L' ? 'is-izq' : ''}">${ICONO}</span>
        <b>PASANDO LUZ · ORIGEN → FINAL</b>
        <button type="button" data-accion="detener" title="Apagar la luz">DETENER</button>
      </div>
      <div class="tw-b">
        <div class="tw-dir">
          <small>Sentido</small>
          <button type="button" data-sentido="L" class="${sentido === 'L' ? 'is-on' : ''}"
            title="Pulso del final al origen">◀</button>
          <button type="button" data-sentido="R" class="${sentido === 'R' ? 'is-on' : ''}"
            title="Pulso del origen al final">▶</button>
        </div>
        <small>Elemento seleccionado</small><b>${activa ? activa.etiqueta : ''}</b>
        <small>Sale desde el origen</small><b>${activa ? activa.origen : ''}</b>
        <small>TX de partida</small><b>${energia && energia.tx !== null ? `${Number(energia.tx).toFixed(1)} dBm` : '—'}</b>
        ${activa
          ? `<div class="dirbadge ${activa.pon ? 'pon' : 'dat'}">SEÑAL ${sentido === 'L'
            ? '◀ FINAL → ORIGEN' : '▶ ORIGEN → FINAL'}</div>` : ''}
        <em>${activa
          ? `${activa.dbm === null || activa.dbm === undefined ? '—' : `${Number(activa.dbm).toFixed(1)} dBm`} · ${activa.tramos} tramo(s) · ${activa.equipos} equipo(s)/cable(s)`
          : ''}</em>
      </div>
    </div>`;

  host.querySelectorAll('[data-ruta]').forEach((boton) => boton.addEventListener('click', () => {
    const ruta = (rutas || []).find((item) => item.id === boton.dataset.ruta);
    if (activa && activa.id === boton.dataset.ruta) alDetener();
    else alEncender(ruta);
  }));
  const detener = host.querySelector('[data-accion="detener"]');
  if (detener) detener.addEventListener('click', alDetener);
  const selectOrigen = host.querySelector('[data-origen]');
  if (selectOrigen && alOrigen) {
    selectOrigen.addEventListener('change', () => alOrigen(selectOrigen.value));
  }
  const entradaTx = host.querySelector('[data-tx]');
  if (entradaTx && alTx) {
    entradaTx.addEventListener('change', () => alTx(Number(entradaTx.value)));
  }
  host.querySelectorAll('[data-sentido]').forEach((boton) => boton.addEventListener('click',
    () => (alSentido ? alSentido(boton.dataset.sentido) : null)));
}
