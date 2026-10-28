/**
 * vista-papel.js — Lienzo del POP (Fase 4): pan, zoom 0.25–2.5, tarjetas de
 * equipo arrastrables e hilos del cable agrupados.
 *
 * · La vista se recuerda por contenedor en `localStorage` (`popDynView:<id>`).
 * · Las posiciones se guardan en el SERVIDOR (`POST …/posiciones`).
 * · Solo se dibujan las tarjetas visibles (virtualización básica).
 */
const CLAVE_VISTA = (id) => `popDynView:${id}`;
const ANCHO = 210;
const ALTO = 132;

export function crearVistaPapel(host, opciones) {
  const { contenedorId, alConectar, alSoltar, alEditar } = opciones;
  let diagrama = opciones.diagrama;
  let zoom = 1;
  let desplazamiento = { x: 40, y: 40 };
  let seleccion = null;
  let arrastre = null;
  let abiertos = new Set();

  host.innerHTML = `
    <div class="pop-papel">
      <div class="pop-papel-lienzo" tabindex="0">
        <svg class="pop-papel-svg" xmlns="http://www.w3.org/2000/svg"><g class="pop-papel-mundo"></g></svg>
      </div>
      <div class="pop-papel-pie">
        <span class="pop-papel-zoom">100%</span>
        <span class="pop-papel-pista">fondo = mover · rueda = zoom · dos puertos = conectar</span>
        <button type="button" class="pop-btn" data-accion="zoom-out">−</button>
        <button type="button" class="pop-btn" data-accion="zoom-in">+</button>
        <button type="button" class="pop-btn" data-accion="centrar">CENTRAR</button>
      </div>
    </div>`;

  const lienzo = host.querySelector('.pop-papel-lienzo');
  const svg = host.querySelector('.pop-papel-svg');
  const mundo = host.querySelector('.pop-papel-mundo');
  const etiquetaZoom = host.querySelector('.pop-papel-zoom');

  function leerVista() {
    try {
      const guardada = JSON.parse(localStorage.getItem(CLAVE_VISTA(contenedorId)) || 'null');
      if (guardada && guardada.zoom) {
        zoom = Math.min(2.5, Math.max(0.25, Number(guardada.zoom)));
        desplazamiento = { x: Number(guardada.x) || 0, y: Number(guardada.y) || 0 };
      }
    } catch (error) { /* vista por defecto */ }
  }

  function guardarVista() {
    try {
      localStorage.setItem(CLAVE_VISTA(contenedorId),
        JSON.stringify({ zoom, x: desplazamiento.x, y: desplazamiento.y }));
    } catch (error) { /* sin localStorage */ }
  }

  function transformar() {
    mundo.setAttribute('transform',
      `translate(${desplazamiento.x},${desplazamiento.y}) scale(${zoom})`);
    etiquetaZoom.textContent = `${Math.round(zoom * 100)}%`;
  }

  function posicion(dispositivo, indice) {
    const guardada = (diagrama.posiciones || {})[dispositivo.id];
    if (guardada) return { x: Number(guardada.x) || 0, y: Number(guardada.y) || 0 };
    return { x: 240 + (indice % 3) * 250, y: 80 + Math.floor(indice / 3) * 190 };
  }

  function visible(x, y) {
    const ancho = lienzo.clientWidth / zoom;
    const alto = lienzo.clientHeight / zoom;
    const ox = -desplazamiento.x / zoom;
    const oy = -desplazamiento.y / zoom;
    return x + ANCHO > ox && x < ox + ancho && y + ALTO > oy && y < oy + alto;
  }

  function puertosHtml(dispositivo) {
    const propios = (diagrama.puertos || []).filter((p) => p.dispositivo_id === dispositivo.id);
    const filas = propios.slice(0, 12).map((puerto, fila) => `
      <g class="pop-puerto-fila" transform="translate(8,${46 + fila * 14})">
        <text class="pop-puerto-nombre">${puerto.etiqueta}</text>
        <circle class="pop-puerto${puerto.estado === 'libre' ? '' : ' is-usado'}"
                cx="${ANCHO - 16}" cy="-3" r="5" data-tipo="${dispositivo.tipo}"
                data-eq="${dispositivo.id}" data-puerto="${puerto.etiqueta}"
                data-puerto-id="${puerto.id}"></circle>
      </g>`).join('');
    const resto = propios.length > 12
      ? `<text class="pop-tarjeta-mas" x="8" y="${ALTO - 8}">+${propios.length - 12}</text>` : '';
    return filas + resto;
  }

  function tarjetaHtml(dispositivo, indice) {
    const { x, y } = posicion(dispositivo, indice);
    // Solo se descartan (culling) los equipos que el usuario ya colocó y quedaron
    // fuera del encuadre. Los de posición automática SIEMPRE se dibujan: si no,
    // un equipo recién creado podía caer fuera de la vista y desaparecer.
    const colocada = !!(diagrama.posiciones || {})[dispositivo.id];
    if (colocada && !visible(x, y)) return '';
    return `
      <g class="pop-tarjeta" data-dispositivo="${dispositivo.id}" transform="translate(${x},${y})">
        <rect class="pop-tarjeta-caja" width="${ANCHO}" height="${ALTO}" rx="2"></rect>
        <text class="pop-tarjeta-titulo" x="8" y="18">${dispositivo.nombre || dispositivo.tipo.toUpperCase()}</text>
        <text class="pop-tarjeta-sub" x="8" y="34">${dispositivo.tipo.toUpperCase()}${dispositivo.division ? ` · ${dispositivo.division}` : ''}</text>
        <text class="pop-tarjeta-editar" data-accion="editar" data-dispositivo="${dispositivo.id}"
              x="${ANCHO - 16}" y="18">✎</text>
        ${puertosHtml(dispositivo)}
      </g>`;
  }

  function cableHtml(cable, indice) {
    const hilos = cable.hilos || { items: [], total: 0 };
    const abierto = abiertos.has(cable.id);
    const items = abierto ? hilos.items : hilos.items.slice(0, 6);
    const filas = items.map((hilo, fila) => `
      <g class="pop-hilo" transform="translate(6,${44 + fila * 16})">
        <rect width="8" height="9" fill="${hilo.color_hex || '#999'}"></rect>
        <text x="14" y="8">${hilo.nombre}</text>
        <circle class="pop-hilo-punto" cx="180" cy="4" r="5" data-tipo="CABLE"
                data-eq="${cable.id}" data-puerto="${hilo.nombre}"
                data-fibra-id="${hilo.fibra_id}"></circle>
      </g>`).join('');
    const resto = hilos.total > 6
      ? `<text class="pop-cable-mas" x="8" y="${abierto ? 44 + items.length * 16 + 10 : 44}"
               data-cable-mas="${cable.id}">${abierto ? 'ver menos' : `ver ${hilos.total - 6} más`}</text>`
      : '';
    return `
      <g class="pop-cable" data-cable="${cable.id}" transform="translate(20,${90 + indice * 300})">
        <rect class="pop-cable-caja" width="200" height="46" rx="2"></rect>
        <text class="pop-tarjeta-titulo" x="8" y="18">${cable.nombre}</text>
        <text class="pop-tarjeta-sub" x="8" y="33">${cable.hilos_total} hilos</text>
        <g class="pop-cable-detalle" ${abierto ? '' : 'hidden'}>${filas}</g>
        ${resto}
      </g>`;
  }

  function dibujar() {
    mundo.innerHTML = (diagrama.cables || []).map(cableHtml).join('')
      + (diagrama.dispositivos || []).map(tarjetaHtml).join('');
    marcarSeleccion();
  }

  function marcarSeleccion() {
    mundo.querySelectorAll('.pop-puerto.is-sel').forEach((n) => n.classList.remove('is-sel'));
    if (!seleccion) return;
    const nodo = mundo.querySelector(
      `.pop-puerto[data-eq="${seleccion.eq_id}"][data-puerto="${seleccion.puerto}"]`);
    if (nodo) nodo.classList.add('is-sel');
  }

  function extremoDe(nodo) {
    const extremo = {
      tipo: nodo.dataset.tipo,
      eq_id: Number(nodo.dataset.eq),
      puerto: nodo.dataset.puerto,
      cara: null,
    };
    if (nodo.dataset.puertoId) extremo.puerto_id = Number(nodo.dataset.puertoId);
    if (nodo.dataset.fibraId) extremo.fibra_id = Number(nodo.dataset.fibraId);
    return extremo;
  }

  function pulsar(evento) {
    const mas = evento.target.closest('[data-cable-mas]');
    if (mas) {
      const cable = Number(mas.dataset.cableMas);
      if (abiertos.has(cable)) abiertos.delete(cable); else abiertos.add(cable);
      dibujar();
      return;
    }
    const editar = evento.target.closest('[data-accion="editar"]');
    if (editar) { alEditar(Number(editar.dataset.dispositivo)); return; }

    const nodo = evento.target.closest('.pop-puerto, .pop-hilo-punto');
    if (!nodo) return;
    evento.stopPropagation();
    const extremo = extremoDe(nodo);
    if (!seleccion) { seleccion = extremo; marcarSeleccion(); return; }
    const misma = seleccion.tipo === extremo.tipo && seleccion.eq_id === extremo.eq_id
      && seleccion.puerto === extremo.puerto;
    const origen = seleccion;
    seleccion = null;
    marcarSeleccion();
    if (!misma) alConectar(origen, extremo);
  }

  function empezar(evento) {
    const tarjeta = evento.target.closest('[data-dispositivo]');
    if (tarjeta && !evento.target.closest('.pop-puerto')) {
      const id = Number(tarjeta.dataset.dispositivo);
      const indice = (diagrama.dispositivos || []).findIndex((d) => d.id === id);
      arrastre = {
        tipo: 'tarjeta', id, tarjeta, inicio: { x: evento.clientX, y: evento.clientY },
        origenPos: posicion(diagrama.dispositivos[indice], indice),
      };
      lienzo.setPointerCapture(evento.pointerId);
      return;
    }
    if (evento.target.closest('.pop-puerto, .pop-hilo-punto')) return;
    arrastre = {
      tipo: 'fondo', inicio: { x: evento.clientX, y: evento.clientY },
      base: { ...desplazamiento },
    };
    lienzo.setPointerCapture(evento.pointerId);
  }

  function mover(evento) {
    if (!arrastre) return;
    if (arrastre.tipo === 'tarjeta') {
      const x = Math.round(arrastre.origenPos.x + (evento.clientX - arrastre.inicio.x) / zoom);
      const y = Math.round(arrastre.origenPos.y + (evento.clientY - arrastre.inicio.y) / zoom);
      arrastre.tarjeta.setAttribute('transform', `translate(${x},${y})`);
      arrastre.destino = { x, y };
      return;
    }
    desplazamiento = {
      x: arrastre.base.x + (evento.clientX - arrastre.inicio.x),
      y: arrastre.base.y + (evento.clientY - arrastre.inicio.y),
    };
    transformar();
  }

  function soltar() {
    if (!arrastre) return;
    if (arrastre.tipo === 'tarjeta' && arrastre.destino) {
      alSoltar(arrastre.id, arrastre.destino.x, arrastre.destino.y);
    }
    if (arrastre.tipo === 'fondo') guardarVista();
    arrastre = null;
  }

  function rueda(evento) {
    evento.preventDefault();
    const antes = zoom;
    zoom = Math.min(2.5, Math.max(0.25, zoom + (evento.deltaY < 0 ? 0.1 : -0.1)));
    if (antes !== zoom) { guardarVista(); transformar(); dibujar(); }
  }

  svg.addEventListener('pointerdown', empezar);
  svg.addEventListener('pointermove', mover);
  svg.addEventListener('pointerup', soltar);
  svg.addEventListener('pointercancel', soltar);
  svg.addEventListener('click', pulsar);
  lienzo.addEventListener('wheel', rueda, { passive: false });

  host.querySelector('[data-accion="zoom-in"]').addEventListener('click', () => {
    zoom = Math.min(2.5, zoom + 0.1); guardarVista(); transformar(); dibujar();
  });
  host.querySelector('[data-accion="zoom-out"]').addEventListener('click', () => {
    zoom = Math.max(0.25, zoom - 0.1); guardarVista(); transformar(); dibujar();
  });
  host.querySelector('[data-accion="centrar"]').addEventListener('click', () => {
    zoom = 1; desplazamiento = { x: 40, y: 40 };
    guardarVista(); transformar(); dibujar();
  });

  leerVista();
  transformar();
  dibujar();

  return {
    actualizar(nuevo) { diagrama = nuevo; dibujar(); },
    obtenerZoom: () => zoom,
    destruir() { host.innerHTML = ''; },
  };
}
