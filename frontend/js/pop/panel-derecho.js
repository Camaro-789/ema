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
  const { alEncender, alDetener, activa } = opciones;
  const lista = (rutas || []).map((ruta, indice) => `
    <li class="pop-ruta ${activa && activa.id === ruta.id ? 'is-on' : ''}">
      <span class="pop-ruta-n">${indice + 1}</span>
      <span class="pop-ruta-txt">${ruta.etiqueta}</span>
      <button type="button" class="pop-btn" data-ruta="${ruta.id}">
        ${activa && activa.id === ruta.id ? 'DETENER' : 'ENCENDER'}
      </button>
    </li>`).join('');

  host.innerHTML = `
    <div class="pop-panel-cabecera">
      <b>TRAZABILIDAD</b>
      <small>${(rutas || []).length} ruta(s)</small>
    </div>
    <div class="pop-panel-cuerpo">
      ${lista
        ? `<ul class="pop-rutas">${lista}</ul>`
        : '<p class="pop-panel-vacio">Sin rutas: conecta dos extremos para poder pasar luz.</p>'}
    </div>
    <div class="pop-torch ${activa ? '' : 'is-oculto'}" id="popTorchWin">
      <div class="tw-h">
        <span class="tw-ic">${ICONO}</span>
        <b>PASANDO LUZ · ORIGEN → FINAL</b>
        <button type="button" data-accion="detener" title="Apagar la luz">DETENER</button>
      </div>
      <div class="tw-b">
        <small>Elemento seleccionado</small><b>${activa ? activa.etiqueta : ''}</b>
        <small>Sale desde el origen</small><b>${activa ? activa.origen : ''}</b>
        ${activa && activa.direccion
          ? `<div class="dirbadge ${activa.pon ? 'pon' : 'dat'}">${activa.direccion}</div>` : ''}
        <em>${activa ? `${activa.tramos} tramo(s) · ${activa.equipos} equipo(s)/cable(s)` : ''}</em>
      </div>
    </div>`;

  host.querySelectorAll('[data-ruta]').forEach((boton) => boton.addEventListener('click', () => {
    const ruta = (rutas || []).find((item) => item.id === boton.dataset.ruta);
    if (activa && activa.id === boton.dataset.ruta) alDetener();
    else alEncender(ruta);
  }));
  const detener = host.querySelector('[data-accion="detener"]');
  if (detener) detener.addEventListener('click', alDetener);
}
