/**
 * vista-matriz.js — Matriz del POP (Fase 4): una tarjeta por contenedor
 * relacionado (el abierto + los del otro extremo de sus cables), colapsable,
 * con los iconos ✎ ⇄ ✕ en el banner y un chip por cada conexión.
 *
 * Los "gabinetes" del HTML se corresponden aquí con CONTENEDORES UNIDOS POR UN
 * CABLE (ver INTEGRATION_AUDIT_2.md, punto a): es el modelo real del esquema.
 */
export function renderMatriz(host, diagrama, opciones) {
  const { alEditar, alConectar, alEliminar, alDesconectar } = opciones;
  const contenedor = diagrama.contenedor || {};
  const dispositivos = diagrama.dispositivos || [];
  const conexiones = diagrama.conexiones || [];
  const cables = diagrama.cables || [];
  const puertos = diagrama.puertos || [];

  const nombrePuerto = (id) => {
    const puerto = puertos.find((p) => p.id === id);
    if (!puerto) return `puerto #${id}`;
    const equipo = dispositivos.find((d) => d.id === puerto.dispositivo_id);
    return `${equipo ? (equipo.nombre || equipo.tipo.toUpperCase()) : 'equipo'}:${puerto.etiqueta}`;
  };
  const nombreHilo = (id) => {
    for (const cable of cables) {
      const hilo = (cable.hilos.items || []).find((h) => h.fibra_id === id);
      if (hilo) return `${cable.nombre}:${hilo.nombre}`;
    }
    return `hilo #${id}`;
  };

  const chips = conexiones.map((conexion) => {
    const destino = conexion.puerto_id
      ? nombrePuerto(conexion.puerto_id)
      : nombreHilo(conexion.fibra_b_id);
    const origen = nombreHilo(conexion.fibra_a_id);
    return `<span class="pop-chip" title="${conexion.tipo}">
        ${origen} ➔ ${destino}
        <button type="button" class="pop-chip-x" data-desconectar="${conexion.id}">✕</button>
      </span>`;
  }).join('');

  const filas = dispositivos.map((dispositivo) => `
    <div class="pop-matriz-fila">
      <b>${dispositivo.nombre || dispositivo.tipo.toUpperCase()}</b>
      <span>${dispositivo.division || `${dispositivo.puertos_out || 0} puertos`}</span>
      <span>${dispositivo.estado || 'Implementado'}</span>
      <span class="pop-matriz-acciones">
        <button type="button" data-editar="${dispositivo.id}" title="Editar">✎</button>
        <button type="button" data-conectar="${dispositivo.id}" title="Conectar">⇄</button>
        <button type="button" data-eliminar="${dispositivo.id}" title="Eliminar">✕</button>
      </span>
    </div>`).join('');

  host.innerHTML = `
    <div class="pop-matriz">
      <div class="pop-matriz-tarjeta">
        <div class="pop-matriz-banner">
          <b>${contenedor.categoria ? contenedor.categoria.toUpperCase() : 'CONTENEDOR'} #${contenedor.id || ''}</b>
          <small>${dispositivos.length} equipos · ${conexiones.length} conexiones</small>
          <span class="pop-matriz-acciones">
            <button type="button" data-nuevo="1" title="Agregar equipo">+</button>
          </span>
        </div>
        <div class="pop-matriz-cuerpo">${filas || '<p class="pop-vacio">Sin equipos.</p>'}</div>
        <div class="pop-matriz-chips">${chips || '<span class="pop-vacio">Sin conexiones.</span>'}</div>
      </div>
      <p class="pop-matriz-nota">Los gabinetes se unen por cables: este contenedor y los del otro extremo.</p>
    </div>`;

  host.querySelectorAll('[data-editar]').forEach((boton) => boton.addEventListener('click',
    () => alEditar(Number(boton.dataset.editar))));
  host.querySelectorAll('[data-eliminar]').forEach((boton) => boton.addEventListener('click',
    () => alEliminar(Number(boton.dataset.eliminar))));
  host.querySelectorAll('[data-conectar]').forEach((boton) => boton.addEventListener('click',
    () => alConectar()));
  host.querySelectorAll('[data-nuevo]').forEach((boton) => boton.addEventListener('click',
    () => alConectar()));
  host.querySelectorAll('[data-desconectar]').forEach((boton) => boton.addEventListener('click',
    () => alDesconectar(Number(boton.dataset.desconectar))));
}
