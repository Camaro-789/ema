/**
 * panel-izquierdo.js — Panel de CABLES del POP (paso 2).
 *
 * Copia el panel de cables de la plantilla: tarjetas con el nombre del cable,
 * sus hilos y el detalle expandible. Si el armario está vacío se ve el mensaje
 * y el botón «+ CABLE», que **ancla un cable existente** (no crea cables).
 */
export function renderPanelIzquierdo(host, diagrama, opciones) {
  const { alAnclar, alPedirCables, alNuevoEquipo } = opciones;
  const cables = diagrama.cables || [];
  const equipos = (diagrama.dispositivos || []).length;
  const vacio = cables.length === 0 && equipos === 0;

  const filas = cables.map((cable) => {
    const items = (cable.hilos && cable.hilos.items) || [];
    const filasHilo = items.slice(0, 8).map((hilo) => `
      <li class="pop-cable-hilo">
        <i style="background:${hilo.color_hex || '#999'}"></i>${hilo.nombre}
      </li>`).join('');
    const resto = (cable.hilos_total || 0) - Math.min(8, items.length);
    return `
      <article class="pop-panel-cable" data-cable="${cable.id}">
        <header>
          <b>${cable.nombre}</b>
          <span>${cable.hilos_total} hilos</span>
        </header>
        <ul>${filasHilo}</ul>
        ${resto > 0 ? `<button type="button" class="pop-panel-mas" data-cable-mas="${cable.id}">
          ver ${resto} más</button>` : ''}
      </article>`;
  }).join('');

  host.innerHTML = `
    <div class="pop-panel-cabecera">
      <b>CABLES</b>
      <small>${cables.length} en este POP</small>
    </div>
    <div class="pop-panel-acciones">
      <button type="button" class="pop-btn" data-accion="nuevo-cable">+ CABLE</button>
      <button type="button" class="pop-btn pop-btn--oscuro" data-accion="nuevo-equipo">+ EQUIPO</button>
    </div>
    <div class="pop-panel-cuerpo">
      ${vacio
        ? `<p class="pop-panel-vacio">Este POP está vacío.<br>
             Ancla un cable existente con <b>+ CABLE</b> o agrega equipos con
             <b>+ EQUIPO</b>.</p>`
        : (filas || '<p class="pop-panel-vacio">Sin cables anclados todavía.</p>')}
    </div>
    <div class="pop-panel-selector" hidden>
      <label>Cable del proyecto</label>
      <select data-selector-cable></select>
      <div class="pop-panel-selector-acciones">
        <button type="button" class="pop-btn" data-accion="cancelar-cable">CANCELAR</button>
        <button type="button" class="pop-btn pop-btn--oscuro" data-accion="anclar-cable">ANCLAR</button>
      </div>
    </div>`;

  const selector = host.querySelector('.pop-panel-selector');
  const combo = host.querySelector('[data-selector-cable]');

  host.querySelector('[data-accion="nuevo-equipo"]').addEventListener('click',
    () => { if (alNuevoEquipo) alNuevoEquipo(); });

  host.querySelector('[data-accion="nuevo-cable"]').addEventListener('click', async () => {
    try {
      const datos = await alPedirCables();
      const disponibles = (datos.cables || []).filter((cable) => cable.anclable);
      combo.innerHTML = disponibles.length
        ? disponibles.map((cable) => `<option value="${cable.id}">
            #${cable.id} · ${cable.nombre} · ${cable.hilos} hilos ·
            ${cable.libre_a ? 'extremo A libre' : `A=#${cable.extremo_a_id}`}
          </option>`).join('')
        : '<option disabled>(no hay cables con extremo libre)</option>';
      selector.hidden = false;
    } catch (error) {
      host.dispatchEvent(new CustomEvent('pop-error', { bubbles: true, detail: error }));
    }
  });

  host.querySelector('[data-accion="cancelar-cable"]').addEventListener('click',
    () => { selector.hidden = true; });

  host.querySelector('[data-accion="anclar-cable"]').addEventListener('click', async () => {
    const valor = combo.value;
    if (!valor) return;
    selector.hidden = true;
    try {
      await alAnclar(Number(valor));
    } catch (error) {
      host.dispatchEvent(new CustomEvent('pop-error', { bubbles: true, detail: error }));
    }
  });
}
