/**
 * prueba_mover_splitter.js
 *
 * Verifica lo que se pidió para la caja NAP 16P con dos splitters distintos:
 *
 *   1. los dos splitters ya NO se apilan uno debajo del otro: nacen lado a lado
 *      (rejilla de dos columnas) y cada uno tiene su propio sitio;
 *   2. se pueden mover LIBREMENTE por el diagrama (agarre de la tarjeta) y al
 *      arrastrar NO se panea el lienzo;
 *   3. el disquete GUARDA el orden (PUT /api/elementos/{id}/diagrama/posiciones);
 *   4. al volver a abrir el nodo, cada splitter reaparece donde se dejó;
 *   5. el frontend respeta el x/y que manda el backend en el DTO;
 *   6. restablecer() borra el orden guardado (DELETE) y vuelve a la rejilla.
 *
 * Uso (desde frontend/):
 *     node scripts/prueba_mover_splitter.js
 */
const fs = require('fs');
const path = require('path');

const OK = { n: 0, fallos: [] };

function check(cond, msg, detalle) {
  if (cond) {
    OK.n += 1;
    console.log(`  [OK]    ${msg}`);
  } else {
    OK.fallos.push(msg);
    console.log(`  [FALLO] ${msg}`);
    if (detalle) console.log(`          ${detalle}`);
  }
}

const RAIZ_JS = path.join(__dirname, '..', 'js');
function leer(rel) {
  return fs.readFileSync(path.join(RAIZ_JS, rel), 'utf8');
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// ── DOM simulado ────────────────────────────────────────────────────────────
function crearElemento(id) {
  const clases = new Set();
  const el = {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    dataset: {},
    atributos: {},
    offsetWidth: 0,
    offsetHeight: 0,
    oyentes: {},
    classList: {
      contains: (c) => clases.has(c),
      add: (...cs) => cs.forEach((c) => clases.add(c)),
      remove: (...cs) => cs.forEach((c) => clases.delete(c)),
      toggle: (c, activo) => {
        if (activo === undefined) {
          if (clases.has(c)) clases.delete(c); else clases.add(c);
        } else if (activo) clases.add(c); else clases.delete(c);
        return clases.has(c);
      },
    },
    setAttribute(nombre, valor) { el.atributos[nombre] = valor; },
    getAttribute(nombre) { return el.atributos[nombre]; },
    addEventListener(tipo, fn) { (el.oyentes[tipo] = el.oyentes[tipo] || []).push(fn); },
    disparar(tipo, evento) { (el.oyentes[tipo] || []).forEach((fn) => fn(evento || {})); },
    querySelector: () => null,
    querySelectorAll: () => [],
    _clases: clases,
  };
  return el;
}

const IDS = ['ftth-diagrama-modal', 'diag-body', 'diag-pie', 'diag-title', 'diag-badge',
  'diag-mark', 'diag-sub', 'diag-btn-close', 'diag-btn-reload', 'element-properties-modal',
  'diag-identity-name', 'diag-identity-code', 'diag-btn-save', 'diag-pendiente',
  'diag-viewport', 'diag-modo', 'diag-modo-salir', 'diag-area-dispositivos',
  'diag-splitter-picker', 'btn-diag-confirm-splitter', 'diag-select-splitter',
  'app-card', 'diag-btn-full', 'diag-resize'];

/** Almacenamiento simulado (el módulo recuerda ahí el tamaño del panel). */
function crearAlmacen(inicial) {
  const datos = Object.assign({}, inicial || {});
  return {
    getItem: (k) => (k in datos ? datos[k] : null),
    setItem: (k, v) => { datos[k] = String(v); },
    removeItem: (k) => { delete datos[k]; },
    _datos: datos,
  };
}

// El área de aparatos dentro del lienzo y las medidas de una tarjeta: son los
// números que el navegador daría con offsetLeft/offsetWidth.
const AREA_X = 736;      // el área va detrás de las columnas de hilos y bandejas
const AREA_Y = 24;
const TARJETA_W = 340;
const TARJETA_H = 280;

function crearDom() {
  const elementos = {};
  const delDocumento = {};
  IDS.forEach((id) => { elementos[id] = crearElemento(id); });
  const vp = elementos['diag-viewport'];
  vp.clientWidth = 900;
  vp.clientHeight = 620;
  // Marco del lienzo: sirve para comprobar que arrastrar un aparato NO corre el
  // lienzo aunque el puntero llegue al borde (eso era el autopaneo, ya quitado).
  vp.getBoundingClientRect = () => ({ left: 0, top: 0, right: 900, bottom: 620, width: 900, height: 620 });
  // El <select> del selector de splitter: el primero de la lista queda elegido.
  elementos['diag-select-splitter'].value = '39';
  // La ventana del diagrama: medible, para poder redimensionarla.
  const card = elementos['app-card'];
  card.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1170, bottom: 720, width: 1170, height: 720 });
  return {
    elementos,
    delDocumento,
    document: {
      getElementById: (id) => elementos[id] || null,
      querySelector: (sel) => (String(sel).indexOf('.app-card') >= 0 ? elementos['app-card'] : null),
      querySelectorAll: () => [],
      createElement: (tag) => crearElemento(tag),
      addEventListener(tipo, fn, opciones) {
        (delDocumento[tipo] = delDocumento[tipo] || []).push({ fn, opciones });
      },
    },
    dispararDoc(tipo, evento) {
      (delDocumento[tipo] || []).forEach((h) => h.fn(evento || {}));
    },
  };
}

// ── Tarjeta y agarre simulados (lo que el navegador resolvería con closest) ─
function crearTarjeta(id) {
  const tarjeta = crearElemento(`tarjeta-${id}`);
  tarjeta.dataset = { dispositivo: String(id) };
  tarjeta.closest = (sel) => (sel === '[data-dispositivo]' ? tarjeta : null);
  return tarjeta;
}

function crearAgarre(id, tarjeta) {
  const agarre = crearElemento(`agarre-${id}`);
  agarre.dataset = { mover: String(id) };
  agarre.getAttribute = (nombre) => (nombre === 'data-mover' ? String(id) : undefined);
  agarre.closest = (sel) => {
    if (sel === '[data-mover]') return agarre;
    if (sel === '[data-dispositivo]') return tarjeta;
    return null;
  };
  return agarre;
}

function evento(destino, clientX, clientY) {
  const ev = {
    button: 0,
    clientX,
    clientY,
    target: destino,
    propagacionCortada: false,
    prevenido: false,
    stopPropagation() { ev.propagacionCortada = true; },
    preventDefault() { ev.prevenido = true; },
  };
  return ev;
}

/**
 * Le da al DOM simulado un área de aparatos con tarjetas medibles: sin esto el
 * módulo no puede medir nada y nunca se sabría dónde quedó cada splitter.
 */
function conectarArea(dom, ids) {
  const area = dom.elementos['diag-area-dispositivos'];
  area.offsetLeft = AREA_X;
  area.offsetTop = AREA_Y;
  const tarjetas = ids.map((id) => {
    const t = crearElemento(`medida-${id}`);
    t.dataset = { dispositivo: String(id) };
    t.offsetWidth = TARJETA_W;
    t.offsetHeight = TARJETA_H;
    return t;
  });
  area.querySelectorAll = (sel) => (sel === '[data-dispositivo]' ? tarjetas : []);
  return { area, tarjetas };
}

/** Caja que deberían ocupar los aparatos, según lo que hay en `pos`. */
function cajaDeAparatos(pos, ids) {
  const usados = (ids || Object.keys(pos)).map(Number);
  const x0 = Math.min(...usados.map((id) => AREA_X + pos[id].x));
  const y0 = Math.min(...usados.map((id) => AREA_Y + pos[id].y));
  const x1 = Math.max(...usados.map((id) => AREA_X + pos[id].x + TARJETA_W));
  const y1 = Math.max(...usados.map((id) => AREA_Y + pos[id].y + TARJETA_H));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}


// ── Datos de prueba: NAP 16P con DOS splitters distintos ────────────────────
function puertosDe(dispositivoId, inPuertos, outPuertos) {
  const puertos = [];
  for (let i = 1; i <= inPuertos; i += 1) {
    puertos.push({
      id: dispositivoId * 1000 + i, dispositivo_id: dispositivoId, direccion: 'IN',
      puerto_no: i, etiqueta: `IN-${i}`, tipo_conector: 'SC/APC', estado: 'libre', cliente: null,
    });
  }
  for (let i = 1; i <= outPuertos; i += 1) {
    puertos.push({
      id: dispositivoId * 1000 + 100 + i, dispositivo_id: dispositivoId, direccion: 'OUT',
      puerto_no: i, etiqueta: `OUT-${i}`, tipo_conector: 'SC/APC', estado: 'libre', cliente: null,
    });
  }
  return puertos;
}

/**
 * DTO del nodo. `guardadas` son las posiciones que el backend ya tiene: se
 * inyectan en cada dispositivo como x/y, igual que hace la API real.
 */
function payloadNodo(guardadas) {
  const g = guardadas || {};
  const dispositivo = (id, division, salidas) => ({
    id, tipo: 'splitter', tipo_id: 39, division, serie: `SN-${id}`, puertos_in: 1,
    puertos_out: salidas, atenuacion_db: division === '1x8' ? 10.7 : 13.7,
    bandeja_id: null, estado: 'operativo',
    x: g[id] ? g[id].x : null,
    y: g[id] ? g[id].y : null,
  });
  return {
    nodo: {
      box_id: 23, categoria: 'cajanap', tipo_nombre: 'Caja NAP 16P', estado: 'Activo',
      conmuta_hilos: true, capacidad_puertos: 16, propiedades_tipo: {}, propiedades_instancia: {},
    },
    bandejas: [],
    dispositivos: [dispositivo(1, '1x8', 8), dispositivo(2, '1x16', 16)],
    puertos: [...puertosDe(1, 1, 8), ...puertosDe(2, 1, 16)],
    hilos_que_terminan: [],
    resumen: {
      bandejas: 0, slots_totales: 0, slots_ocupados: 0, dispositivos: 2,
      puertos: 26, puertos_libres: 26, hilos_anclados: 0, empalmes: 0,
    },
    advertencias: [],
  };
}

function cargarModulo(dom, guardadas, respuestaServidor, almacen) {
  const codigo = [
    leer('ftth-colores.js'),
    leer('ftth-plantillas.js'),
    leer(path.join('plantillas-visuales', 'splitter.js')),
    leer('ftth-diagrama.js'),
  ].join('\n;\n');

  const toasts = [];
  const llamadas = [];
  const windowObj = {
    location: { origin: 'http://prueba.local' },
    FTTHIconos: { imgHtml: (cat) => `<img src="assets/icons/${cat}.svg" alt="${cat}">` },
    localStorage: almacen || crearAlmacen(),
    innerWidth: 1280,
    innerHeight: 800,
  };
  const fetchStub = async (url, opciones) => {
    const metodo = (opciones && opciones.method) || 'GET';
    llamadas.push({ metodo, url: String(url), cuerpo: opciones && opciones.body });
    if (respuestaServidor) return respuestaServidor(metodo, String(url), opciones);
    return { ok: true, status: 200, url, json: async () => payloadNodo(guardadas) };
  };

  const fabrica = new Function('window', 'document', 'fetch', 'console', 'setTimeout',
    `${codigo}
return {
  diagrama: window.FTTHDiagrama,
  plantillas: window.FTTHPlantillas,
};`);

  const api = fabrica(windowObj, dom.document, fetchStub, console, (fn) => fn());
  // El doble de FTTHTipos va DESPUÉS de cargar los módulos: ese archivo se
  // registra en window al cargarse y pisaría el doble si se pasara antes.
  windowObj.FTTHTipos = {
    getTipos: async () => [{ id: 39, nombre_id: 'Splitter 1x8', propiedades: { relacion_division: '1x8' } }],
    showToast: (msg, tipo) => toasts.push({ msg, tipo }),
  };
  return { api, windowObj, toasts, llamadas };
}

async function main() {
  console.log('='.repeat(74));
  console.log('PRUEBA DE POSICIÓN — mover splitters, guardar (disquete) y reabrir');
  console.log('='.repeat(74));

  console.log('\n1) Dos splitters en la misma caja: nacen lado a lado');
  const dom = crearDom();
  const area1 = conectarArea(dom, [1, 2]);
  const carga = cargarModulo(dom, null);
  carga.api.diagrama.abrir(23, { categoria: 'cajanap', tipoNombre: 'Caja NAP 16P' });
  await esperar(10);
  const pos = carga.api.diagrama.posiciones();
  check(Object.keys(pos).length === 2, 'El diagrama sitúa los dos aparatos', JSON.stringify(pos));
  check(!!pos[1] && !!pos[2], 'Cada splitter tiene su propia posición');
  check(pos[1].y === pos[2].y, 'Los dos nacen a la MISMA altura (ya no apilados)', JSON.stringify(pos));
  check(pos[2].x > pos[1].x, 'El segundo nace al lado del primero, no debajo', JSON.stringify(pos));

  const body = dom.elementos['diag-body'].innerHTML;
  check(body.includes('diag-area-dispositivos'), 'Los aparatos viven en un área libre propia');
  check((body.match(/class="diag-nodo-dispositivo"/g) || []).length === 2, 'Hay una caja móvil por aparato');
  check((body.match(/data-mover="/g) || []).length === 2, 'Cada caja lleva su agarre para arrastrar');
  check(body.includes('pv-splitter'), 'Las tarjetas visuales se siguen pintando');
  check(body.includes('data-puerto='), 'Los puertos siguen clicables dentro de la tarjeta');

  console.log('\n2) Al abrir, la vista se centra en los splitters con zoom normal');
  const vp = dom.elementos['diag-viewport'];
  const abierta = carga.api.diagrama.vista();
  const cajaSplitters = cajaDeAparatos(pos);
  check(abierta.k === 1, 'Zoom normal: 100% (no se abre alejado)', String(abierta.k));
  const centroX = abierta.x + (cajaSplitters.x + cajaSplitters.w / 2) * abierta.k;
  const centroY = abierta.y + (cajaSplitters.y + cajaSplitters.h / 2) * abierta.k;
  check(Math.abs(centroX - vp.clientWidth / 2) < 1.5,
    'Los splitters quedan centrados en horizontal',
    `centro=${centroX} pantalla=${vp.clientWidth / 2}`);
  check(Math.abs(centroY - vp.clientHeight / 2) < 1.5,
    'Y centrados en vertical', `centro=${centroY} pantalla=${vp.clientHeight / 2}`);
  check(abierta.x < 0, 'El lienzo se desplaza para dejar los splitters en el centro', String(abierta.x));

  console.log('\n3) Arrastrar un splitter lo mueve (sin panear el lienzo)');
  const tarjeta1 = crearTarjeta(1);
  const agarre1 = crearAgarre(1, tarjeta1);
  const vistaAntes = carga.api.diagrama.vista();
  const evPresion = evento(agarre1, 100, 100);
  dom.elementos['diag-body'].disparar('mousedown', evPresion);
  check(evPresion.propagacionCortada, 'El agarre corta la propagación: el lienzo NO se panea');
  check(tarjeta1.classList.contains('diag-nodo-dispositivo--moviendo'),
    'La tarjeta se marca mientras se arrastra');
  dom.dispararDoc('mousemove', evento(null, 340, 220));
  let trasArrastre = carga.api.diagrama.posiciones();
  check(Math.round(trasArrastre[1].x) === Math.round(pos[1].x + 240),
    'Se movió en X justo lo que se arrastró', JSON.stringify(trasArrastre));
  check(Math.round(trasArrastre[1].y) === Math.round(pos[1].y + 120),
    'Se movió en Y justo lo que se arrastró');
  check(carga.api.diagrama.vista().x === vistaAntes.x && carga.api.diagrama.vista().y === vistaAntes.y,
    'La vista del lienzo no se movió');
  check(trasArrastre[2].x === pos[2].x && trasArrastre[2].y === pos[2].y,
    'El otro splitter se quedó quieto');
  dom.dispararDoc('mouseup', {});
  check(!tarjeta1.classList.contains('diag-nodo-dispositivo--moviendo'),
    'Al soltar se quita la marca de arrastre');

  // Agarrar la tarjeta por su CUERPO (no la barrita) también la mueve, y con el
  // puntero pegado al borde el lienzo se queda quieto: antes se corría solo y
  // parecía que el splitter navegaba el diagrama.
  const tarjetaCuerpo = crearTarjeta(1);
  const evCuerpo = evento(tarjetaCuerpo, 400, 300);
  dom.elementos['diag-body'].disparar('mousedown', evCuerpo);
  check(evCuerpo.propagacionCortada,
    'Agarrar la tarjeta por su cuerpo también corta la propagación (el lienzo no navega)');
  dom.dispararDoc('mousemove', evento(null, 895, 615));
  trasArrastre = carga.api.diagrama.posiciones();
  check(trasArrastre[1].x > pos[1].x + 240, 'El aparato se mueve aunque se agarre por el cuerpo',
    JSON.stringify(trasArrastre[1]));
  check(carga.api.diagrama.vista().x === vistaAntes.x && carga.api.diagrama.vista().y === vistaAntes.y,
    'El diagrama NO se corre al mover el splitter, ni con el puntero en el borde',
    JSON.stringify(carga.api.diagrama.vista()));
  dom.dispararDoc('mouseup', {});

  console.log('\n4) El disquete queda marcado hasta que se guarda');
  const btnSave = dom.elementos['diag-btn-save'];
  check(btnSave.classList.contains('diag-identity-btn--pendiente'),
    'El disquete avisa de los cambios sin guardar');
  check(dom.elementos['diag-pendiente'].style.display === 'inline', 'Se ve el aviso «Sin guardar»');

  console.log('\n5) Guardar manda las posiciones y limpia el aviso');
  const okGuarda = await carga.api.diagrama.guardar();
  const puts = carga.llamadas.filter((l) => l.metodo === 'PUT');
  check(okGuarda === true, 'guardar() confirma el guardado');
  check(puts.length === 1, 'Se envía un solo PUT', JSON.stringify(puts));
  check(puts[0].url === 'http://prueba.local/api/elementos/23/diagrama/posiciones',
    'La ruta es la del orden del diagrama', puts[0].url);
  const enviado = JSON.parse(puts[0].cuerpo);
  check(Array.isArray(enviado.posiciones) && enviado.posiciones.length === 2, 'Manda los dos aparatos');
  const seteado = enviado.posiciones.find((p) => p.dispositivo_id === 1);
  check(Math.round(seteado.x) === Math.round(trasArrastre[1].x)
    && Math.round(seteado.y) === Math.round(trasArrastre[1].y),
    'Manda la posición a la que se arrastró', JSON.stringify(seteado));
  check(carga.toasts.some((t) => t.msg.includes('Diagrama guardado correctamente')),
    'Avisa de que el diagrama se guardó', JSON.stringify(carga.toasts));
  check(!btnSave.classList.contains('diag-identity-btn--pendiente'), 'El disquete vuelve a la normalidad');
  check(dom.elementos['diag-pendiente'].style.display === 'none', 'El aviso «Sin guardar» se oculta');
  check(btnSave.getAttribute('data-tooltip') === 'Guardar diagrama',
    'El tooltip del disquete vuelve a «Guardar diagrama»', btnSave.getAttribute('data-tooltip'));

  console.log('\n6) Al reabrir el nodo, cada splitter está donde se dejó');
  const dom2 = crearDom();
  const carga2 = cargarModulo(dom2, { 1: trasArrastre[1], 2: trasArrastre[2] });
  carga2.api.diagrama.abrir(23, { categoria: 'cajanap', tipoNombre: 'Caja NAP 16P' });
  await esperar(10);
  const pos2 = carga2.api.diagrama.posiciones();
  check(Math.round(pos2[1].x) === Math.round(trasArrastre[1].x)
    && Math.round(pos2[1].y) === Math.round(trasArrastre[1].y),
    'El primer splitter reaparece donde se dejó', JSON.stringify(pos2));
  check(Math.round(pos2[2].x) === Math.round(trasArrastre[2].x)
    && Math.round(pos2[2].y) === Math.round(trasArrastre[2].y),
    'El segundo también', JSON.stringify(pos2));
  check(!dom2.elementos['diag-btn-save'].classList.contains('diag-identity-btn--pendiente'),
    'Recién abierto no hay nada pendiente de guardar');
  const body2 = dom2.elementos['diag-body'].innerHTML;
  check(body2.includes(`left:${Math.round(trasArrastre[1].x)}px`),
    'La tarjeta se pinta ya en su sitio guardado',
    body2.match(/class="diag-nodo-dispositivo".{0,90}/));

  console.log('\n7) Con el lienzo ampliado, el arrastre respeta el zoom');
  carga2.api.diagrama.zoom(2);
  const antesZoom = carga2.api.diagrama.posiciones();
  const tarjeta2 = crearTarjeta(2);
  const agarre2 = crearAgarre(2, tarjeta2);
  dom2.elementos['diag-body'].disparar('mousedown', evento(agarre2, 200, 200));
  dom2.dispararDoc('mousemove', evento(null, 300, 200));
  dom2.dispararDoc('mouseup', {});
  const trasZoom = carga2.api.diagrama.posiciones();
  check(Math.round(trasZoom[2].x - antesZoom[2].x) === 50,
    'Al 200%, 100 px de ratón son 50 px de lienzo',
    `${antesZoom[2].x} -> ${trasZoom[2].x}`);

  console.log('\n8) Restablecer: se borra el orden guardado y vuelve la rejilla');
  let guardadoServidor = { 1: { x: 720, y: 480 }, 2: { x: 400, y: 300 } };
  const respuestaServidor = (metodo) => {
    if (metodo === 'DELETE') {
      guardadoServidor = {};
      return { ok: true, status: 200, json: async () => ({ status: 'ok', posiciones_borradas: 2 }) };
    }
    return { ok: true, status: 200, json: async () => payloadNodo(guardadoServidor) };
  };
  const dom3 = crearDom();
  const carga3 = cargarModulo(dom3, null, respuestaServidor);
  carga3.api.diagrama.abrir(23, { categoria: 'cajanap', tipoNombre: 'Caja NAP 16P' });
  await esperar(10);
  const pos3a = carga3.api.diagrama.posiciones();
  check(Math.round(pos3a[1].x) === 720 && Math.round(pos3a[1].y) === 480,
    'Respeta el orden que ya tenía guardado el servidor', JSON.stringify(pos3a));
  const okRest = await carga3.api.diagrama.restablecer();
  check(okRest === true, 'restablecer() confirma');
  check(carga3.llamadas.some((l) => l.metodo === 'DELETE' && l.url.includes('/diagrama/posiciones')),
    'Manda el DELETE del orden guardado', JSON.stringify(carga3.llamadas));
  const pos3b = carga3.api.diagrama.posiciones();
  check(pos3b[1].x === 12 && pos3b[1].y === 12, 'Vuelve al margen del área (rejilla)', JSON.stringify(pos3b));
  check(pos3b[1].y === pos3b[2].y && pos3b[2].x > pos3b[1].x, 'Y los dos vuelven a estar lado a lado');

  console.log('\n9) El lienzo es libre: sin topes a la izquierda ni arriba');
  carga.api.diagrama.moverAparato(1, -820, -560);
  const libre = carga.api.diagrama.posiciones();
  check(libre[1].x === -820 && libre[1].y === -560,
    'Se mueve a la izquierda y arriba del origen (x/y negativas)', JSON.stringify(libre[1]));
  check(area1.tarjetas[0].style.left === '-820px' && area1.tarjetas[0].style.top === '-560px',
    'La tarjeta se pinta en su sitio negativo, sin recortes',
    `${area1.tarjetas[0].style.left} ${area1.tarjetas[0].style.top}`);

  const tarjetaLibre = crearTarjeta(1);
  dom.elementos['diag-body'].disparar('mousedown', evento(crearAgarre(1, tarjetaLibre), 300, 300));
  dom.dispararDoc('mousemove', evento(null, 160, 190));   // 140 px a la izquierda, 110 arriba
  dom.dispararDoc('mouseup', {});
  const arrastrado = carga.api.diagrama.posiciones();
  check(arrastrado[1].x === -960 && arrastrado[1].y === -670,
    'Arrastrar hacia la izquierda/arriba sigue avanzando (no hay pared en 0)',
    JSON.stringify(arrastrado[1]));

  carga.api.diagrama.moverAparato(1, 12 + 1e9, 12 - 1e9);
  const conTope = carga.api.diagrama.posiciones();
  check(conTope[1].x === 50000 && conTope[1].y === -50000,
    'Solo queda el tope de cordura de 50.000 px (inalcanzable a mano)',
    JSON.stringify(conTope[1]));

  console.log('\n10) Un diagrama guardado con x/y negativas se reabre igual');
  const domNeg = crearDom();
  conectarArea(domNeg, [1, 2]);
  const cargaNeg = cargarModulo(domNeg, { 1: { x: -640, y: -210 }, 2: { x: -120, y: -210 } });
  cargaNeg.api.diagrama.abrir(23, { categoria: 'cajanap', tipoNombre: 'Caja NAP 16P' });
  await esperar(10);
  const posNeg = cargaNeg.api.diagrama.posiciones();
  check(posNeg[1].x === -640 && posNeg[1].y === -210, 'El primer splitter vuelve a su x/y negativas',
    JSON.stringify(posNeg));
  check(posNeg[2].x === -120 && posNeg[2].y === -210, 'El segundo también');
  const vpNeg = domNeg.elementos['diag-viewport'];
  const vistaNeg = cargaNeg.api.diagrama.vista();
  const cajaNeg = cajaDeAparatos(posNeg);
  // A 100% los dos aparatos no caben (860 px de ancho más el aire, en 900 px de
  // ventana), así que el zoom baja lo justo; nunca sube por encima del 100%.
  const kEsperado = Math.min(
    (vpNeg.clientWidth - 112) / cajaNeg.w, (vpNeg.clientHeight - 112) / cajaNeg.h, 1);
  check(Math.abs(vistaNeg.k - kEsperado) < 0.001 && vistaNeg.k <= 1,
    'El zoom es el normal (100%) o el justo para que quepan',
    `${vistaNeg.k} vs ${kEsperado}`);
  check(Math.abs(vistaNeg.x + (cajaNeg.x + cajaNeg.w / 2) * vistaNeg.k - vpNeg.clientWidth / 2) < 1.5,
    'Y centrado en los splitters aunque estén a la izquierda del origen');

  console.log('\n11) Cualquier cambio real enciende el disquete');
  const domCambio = crearDom();
  conectarArea(domCambio, [1, 2]);
  const cargaCambio = cargarModulo(domCambio, null);
  cargaCambio.api.diagrama.abrir(23, { categoria: 'cajanap', tipoNombre: 'Caja NAP 16P' });
  await esperar(10);
  const btnCambio = domCambio.elementos['diag-btn-save'];
  const notaCambio = domCambio.elementos['diag-pendiente'];
  check(!btnCambio.classList.contains('diag-identity-btn--pendiente'),
    'Recién abierto no hay nada por guardar');

  await cargaCambio.api.diagrama.borrarObjeto('dispositivo:2');
  check(btnCambio.classList.contains('diag-identity-btn--pendiente'),
    'Eliminar un aparato enciende el disquete');
  check(notaCambio.style.display === 'inline', 'Y aparece el aviso «Sin guardar»');

  await cargaCambio.api.diagrama.guardar();
  check(!btnCambio.classList.contains('diag-identity-btn--pendiente'), 'Al guardar se apaga');

  await cargaCambio.api.diagrama.mostrarModalAgregarSplitter();
  const confirmarCambio = domCambio.elementos['btn-diag-confirm-splitter'];
  check(typeof confirmarCambio.onclick === 'function', 'El selector de tipos queda listo');
  await confirmarCambio.onclick();
  await esperar(10);
  check(btnCambio.classList.contains('diag-identity-btn--pendiente'),
    'Agregar otro splitter vuelve a encender el disquete');

  console.log('\n12) Contrato del código, del CSS y del HTML');
  const js = leer('ftth-diagrama.js');
  check(!/Math\.max\(0,\s*_mueble\.px/.test(js) && !/Math\.max\(0,\s*x\),\s*y:\s*Math\.max\(0/.test(js),
    'Nada de recortar x/y a 0: el lienzo no tiene recuadro');
  check(js.includes('function autopanear(') === false,
    'Sin autopaneo: mover un aparato no navega el diagrama');
  check(/closest\('\[data-dispositivo\]'\)/.test(js),
    'El arrastre arranca desde cualquier parte de la tarjeta, no solo la barrita');
  check(js.includes('function marcarCambio('), 'Un solo punto marca los cambios por guardar');
  check(js.includes('marcarCambio();   // hubo un cambio real'),
    'Eliminar y agregar también encienden el disquete');
  check(js.includes('function centrarEnAparatos(') && js.includes('function centrarAlAbrir('),
    'Al abrir se centra en los aparatos (con encuadre de respaldo)');
  check(/requestAnimationFrame\(centrarAlAbrir\)/.test(js), 'El enfoque se recalcula tras repintar');
  const css = fs.readFileSync(path.join(RAIZ_JS, '..', 'css', 'lienzo-diagrama.css'), 'utf8');
  check(/\.diag-area-dispositivos\s*\{[^}]*position:\s*relative/.test(css),
    'El área de aparatos es el marco de referencia de las tarjetas');
  check(/\.diag-nodo-agarre\s*\{[^}]*cursor:\s*move/.test(css), 'El agarre usa cursor move');
  check(!/cursor:\s*grab/.test(css), 'Sin cursor grab: la navegación sigue sin modo paneo');
  check(/\.diag-nodo-dispositivo\s*\{[^}]*cursor:\s*move/.test(css),
    'La tarjeta completa se ve arrastrable (cursor move)');
  check(/\.diag-nodo-dispositivo \.diag-puerto[^{]*\{[^}]*cursor:\s*pointer/.test(css),
    'Los puertos siguen clicables (cursor pointer)');
  check(/\.top-toolbar\s*\{[^}]*top:\s*48px/.test(css),
    'La barra superior arranca debajo de la de identidad (ya no se tapa)');
  check(/\.diag-body-container\s*\{[^}]*top:\s*44px/.test(css),
    'El lienzo arranca pegado a la barra de identidad (sin línea invisible)');
  check(/\.app-card\.app-card--max\s*\{[^}]*width:\s*96vw/.test(css),
    'El panel se puede poner en pantalla completa');
  check(/\.diag-resize\s*\{[^}]*cursor:\s*nwse-resize/.test(css),
    'La esquina del panel se arrastra para redimensionarlo');
  check(/\.diag-body--arrastrando\s*\{[^}]*z-index/.test(css),
    'Al arrastrar un aparato, el lienzo pasa por encima de las barras');
  check(js.includes('/diagrama/posiciones'), 'El JS guarda el orden en la ruta nueva');
  check(js.includes("method: 'PUT'"), 'Guardar usa PUT');
  check(!/aviso\('Diagrama guardado correctamente', 'success'\);\s*\n\s*\}\);/.test(js),
    'El disquete ya no es un aviso vacío: guarda de verdad');
  const html = fs.readFileSync(path.join(RAIZ_JS, '..', 'index.html'), 'utf8');
  check(html.includes('id="diag-pendiente"'), 'El aviso «Sin guardar» está en el HTML');
  check((html.match(/id="diag-btn-save"/g) || []).length === 1, 'El disquete sigue existiendo una sola vez');
  check((html.match(/id="diag-btn-full"/g) || []).length === 1,
    'El HTML trae el botón de pantalla completa');
  check((html.match(/id="diag-resize"/g) || []).length === 1,
    'El HTML trae el agarre de la esquina para redimensionar');
  check((html.match(/data-tooltip="Agregar splitter"/g) || []).length === 1,
    'Agregar splitter existe solo en la barra inferior de herramientas');
  check(!body.includes('Añadir Splitter'),
    'El diagrama ya no tiene un botón propio de añadir splitter');

  console.log('\n13) La ventana del diagrama: pantalla completa y tamaño');
  const domPanel = crearDom();
  conectarArea(domPanel, [1, 2]);
  const almacen = crearAlmacen();
  const cargaPanel = cargarModulo(domPanel, null, null, almacen);
  cargaPanel.api.diagrama.abrir(23, { categoria: 'cajanap', tipoNombre: 'Caja NAP 16P' });
  await esperar(10);
  const card = domPanel.elementos['app-card'];
  const btnFull = domPanel.elementos['diag-btn-full'];

  check(cargaPanel.api.diagrama.pantallaCompleta(true) === true, 'pantallaCompleta() maximiza el panel');
  check(card.classList.contains('app-card--max'), 'El panel queda en pantalla completa');
  check(btnFull.getAttribute('data-tooltip') === 'Restaurar tamaño',
    'El botón pasa a «Restaurar tamaño»', btnFull.getAttribute('data-tooltip'));
  check(cargaPanel.api.diagrama.pantallaCompleta(false) === false, 'pantallaCompleta(false) lo devuelve');
  check(!card.classList.contains('app-card--max'), 'El panel deja de estar maximizado');

  check(cargaPanel.api.diagrama.tamanoPanel(980, 700) === true, 'tamanoPanel() da un tamaño a mano');
  check(card.style.width === '980px' && card.style.height === '700px',
    'El panel toma el tamaño pedido', `${card.style.width} x ${card.style.height}`);
  check(card.style.maxWidth === 'none' && card.style.maxHeight === 'none',
    'El tamaño elegido manda sobre el 94vw / 88vh');
  check(/980/.test(String(almacen.getItem('ftth.diagrama.panel'))),
    'El tamaño se recuerda para la próxima vez', almacen.getItem('ftth.diagrama.panel'));

  const domPanel2 = crearDom();
  conectarArea(domPanel2, [1, 2]);
  const cargaPanel2 = cargarModulo(domPanel2, null, null, almacen);
  cargaPanel2.api.diagrama.abrir(23, { categoria: 'cajanap', tipoNombre: 'Caja NAP 16P' });
  await esperar(10);
  check(domPanel2.elementos['app-card'].style.width === '980px',
    'Al reabrir el diagrama se recupera el tamaño',
    domPanel2.elementos['app-card'].style.width);

  const esquina = domPanel.elementos['diag-resize'];
  esquina.disparar('mousedown', {
    clientX: 1170, clientY: 720,
    stopPropagation() {}, preventDefault() {},
  });
  domPanel.dispararDoc('mousemove', { clientX: 1230, clientY: 760 });
  domPanel.dispararDoc('mouseup', {});
  const cardPanel = domPanel.elementos['app-card'];
  check(cardPanel.style.width === '1230px' && cardPanel.style.height === '760px',
    'Arrastrar la esquina agranda el panel',
    `${cardPanel.style.width} x ${cardPanel.style.height}`);

  domPanel.elementos['diag-body'].disparar('mousedown', evento(crearTarjeta(1), 100, 100));
  check(domPanel.elementos['diag-body'].classList.contains('diag-body--arrastrando'),
    'Con un aparato en la mano, el lienzo pasa por encima de las barras');
  domPanel.dispararDoc('mouseup', {});
  check(!domPanel.elementos['diag-body'].classList.contains('diag-body--arrastrando'),
    'Al soltar, el lienzo vuelve a su sitio');

  console.log('\n' + '='.repeat(74));
  console.log(`RESULTADO: ${OK.n} comprobaciones OK, ${OK.fallos.length} fallos`);
  OK.fallos.forEach((f) => console.log(`  - ${f}`));
  console.log('='.repeat(74));
  return OK.fallos.length ? 1 : 0;
}

main().then((codigo) => process.exit(codigo)).catch((e) => {
  console.error('Error inesperado en la prueba:', e);
  process.exit(1);
});


