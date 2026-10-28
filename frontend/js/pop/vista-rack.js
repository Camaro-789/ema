/**
 * vista-rack.js — Rack 19" en SOLO LECTURA (Fase 4).
 *
 * Nada se conecta aquí: el rack muestra el inventario del contenedor tal como lo
 * devuelve el servidor. Las acciones viven en el papel dinámico y la matriz.
 */
export function renderRack(host, diagrama) {
  const dispositivos = diagrama.dispositivos || [];
  const filas = dispositivos.map((dispositivo) => {
    const unidades = dispositivo.tipo === 'odf' ? 2 : 1;
    return `
      <div class="pop-rack-fila" data-dispositivo="${dispositivo.id}">
        <span class="pop-rack-u">${unidades}U</span>
        <span class="pop-rack-nombre">${dispositivo.nombre || dispositivo.tipo.toUpperCase()}</span>
        <span class="pop-rack-tipo">${dispositivo.tipo.toUpperCase()}${dispositivo.division ? ` · ${dispositivo.division}` : ''}</span>
        <span class="pop-rack-estado">${dispositivo.estado || 'Implementado'}</span>
      </div>`;
  }).join('');

  host.innerHTML = `
    <div class="pop-rack">
      <div class="pop-rack-cabecera">
        <b>RACK 19"</b>
        <small>${dispositivos.length} equipos · solo lectura</small>
      </div>
      <div class="pop-rack-cuerpo">
        ${filas || '<p class="pop-vacio">Sin equipos en este contenedor.</p>'}
      </div>
    </div>`;
}
