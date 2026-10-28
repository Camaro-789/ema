/**
 * vista-matriz.js — Matriz del POP (paso 4), réplica de la plantilla:
 * tarjeta por gabinete colapsable, tarjeta por equipo con banner azul y los
 * iconos ✎ ⇄ ✕ EN EL BANNER, y un chip por hilo («Gab2 ➔ ODF-02:P4»).
 */
const COLAPSADOS = new Set();

export function renderMatriz(host, diagrama, opciones) {
  const { alEditar, alEliminar, alMover, alNuevo, alDesconectar } = opciones;
  const contenedor = diagrama.contenedor || {};
  const dispositivos = diagrama.dispositivos || [];
  const puertos = diagrama.puertos || [];
  const conexiones = diagrama.conexiones || [];
  const cables = diagrama.cables || [];
  const relacionados = diagrama.relacionados || [];
  const colapsados = COLAPSADOS;

  const nombreEquipo = (id) => {
    const equipo = dispositivos.find((d) => d.id === id);
    return equipo ? (equipo.nombre || equipo.tipo.toUpperCase()) : `equipo #${id}`;
  };
  const nombrePuerto = (id) => {
    const puerto = puertos.find((p) => p.id === id);
    return puerto ? `${nombreEquipo(puerto.dispositivo_id)}:${puerto.etiqueta}` : `puerto #${id}`;
  };
  const fibraMap = new Map();
  cables.forEach((cable) => {
    (cable.hilos.items || []).forEach((hilo) => fibraMap.set(hilo.fibra_id, { cable, hilo }));
  });
  const etiquetaContenedor = (id) => {
    if (!id) return '—';
    if (Number(id) === Number(contenedor.id)) {
      return String(contenedor.categoria || 'POP').toUpperCase();
    }
    const otro = relacionados.find((r) => Number(r.id) === Number(id));
    if (otro) return `${otro.nombre}${otro.numero ? ` ${otro.numero}` : ''}`;
    return `#${id}`;
  };

  function chipDe(conexion) {
    const info = fibraMap.get(conexion.fibra_a_id) || fibraMap.get(conexion.fibra_b_id);
    let origen = '—';
    if (info) {
      const otro = Number(info.cable.extremo_a_id) === Number(contenedor.id)
        ? info.cable.extremo_b_id : info.cable.extremo_a_id;
      origen = etiquetaContenedor(otro);
    }
    const hiloB = fibraMap.get(conexion.fibra_b_id);
    const destino = conexion.puerto_id
      ? nombrePuerto(conexion.puerto_id)
      : (hiloB ? `${hiloB.cable.nombre}:${hiloB.hilo.nombre}` : `hilo #${conexion.fibra_b_id}`);
    const equipo = conexion.puerto_id
      ? (puertos.find((p) => p.id === conexion.puerto_id) || {}).dispositivo_id : null;
    return { texto: `${origen} ➔ ${destino}`, equipo, id: conexion.id, tipo: conexion.tipo };
  }
  const chips = conexiones.map(chipDe);

  const tarjetas = dispositivos.map((dispositivo) => {
    const propios = chips.filter((chip) => Number(chip.equipo) === Number(dispositivo.id));
    const chipsHtml = propios.map((chip) => `
      <span class="pop-chip" title="${chip.tipo}">↗ ${chip.texto}
        <button type="button" class="pop-chip-x" data-desconectar="${chip.id}">✕</button>
      </span>`).join('');
    const abierto = !colapsados.has(dispositivo.id);
    return `
      <article class="pop-eq-card" data-eq="${dispositivo.id}">
        <div class="pop-eq-banner">
          <b>${dispositivo.nombre || dispositivo.tipo.toUpperCase()}</b>
          <small>${dispositivo.tipo.toUpperCase()}${dispositivo.division ? ` · ${dispositivo.division}` : ''}
            · ${dispositivo.estado || 'Implementado'}</small>
          <span class="pop-eq-acciones">
            <button type="button" data-editar="${dispositivo.id}" title="Editar">✎</button>
            <button type="button" data-mover="${dispositivo.id}" title="Mover">⇄</button>
            <button type="button" data-eliminar="${dispositivo.id}" title="Eliminar">✕</button>
          </span>
        </div>
        <div class="pop-eq-cuerpo" ${abierto ? '' : 'hidden'}>
          <div class="pop-matriz-chips">
            ${chipsHtml || '<span class="pop-vacio">Sin conexiones.</span>'}
          </div>
        </div>
        <button type="button" class="pop-eq-toggle" data-colapsar="${dispositivo.id}">
          ${abierto ? '▾ ocultar' : '▸ mostrar'}
        </button>
      </article>`;
  }).join('');

  const huerfanos = chips.filter((chip) => !chip.equipo);
  host.innerHTML = `
    <div class="pop-matriz">
      <div class="pop-matriz-tarjeta">
        <div class="pop-matriz-banner">
          <b>${String(contenedor.categoria || 'CONTENEDOR').toUpperCase()} #${contenedor.id || ''}</b>
          <small>${dispositivos.length} equipos · ${conexiones.length} conexiones ·
            ${relacionados.length} gabinete(s) unido(s)</small>
          <span class="pop-eq-acciones">
            <button type="button" data-nuevo="1" title="Agregar equipo">+ EQUIPO</button>
          </span>
        </div>
        <div class="pop-matriz-cuerpo">${tarjetas || '<p class="pop-vacio">Sin equipos.</p>'}</div>
        ${huerfanos.length ? `<div class="pop-matriz-chips is-fusion">
          <b>FUSIONES</b>
          ${huerfanos.map((chip) => `<span class="pop-chip">${chip.texto}
            <button type="button" class="pop-chip-x" data-desconectar="${chip.id}">✕</button>
          </span>`).join('')}
        </div>` : ''}
      </div>
    </div>`;

  host.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click',
    () => alEditar(Number(b.dataset.editar))));
  host.querySelectorAll('[data-eliminar]').forEach((b) => b.addEventListener('click',
    () => alEliminar(Number(b.dataset.eliminar))));
  host.querySelectorAll('[data-mover]').forEach((b) => b.addEventListener('click',
    () => alMover(Number(b.dataset.mover))));
  host.querySelectorAll('[data-desconectar]').forEach((b) => b.addEventListener('click',
    () => alDesconectar(Number(b.dataset.desconectar))));
  host.querySelectorAll('[data-nuevo]').forEach((b) => b.addEventListener('click',
    () => (alNuevo ? alNuevo() : null)));
  host.querySelectorAll('[data-colapsar]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.colapsar);
    if (colapsados.has(id)) colapsados.delete(id); else colapsados.add(id);
    renderMatriz(host, diagrama, opciones);
  }));
}
