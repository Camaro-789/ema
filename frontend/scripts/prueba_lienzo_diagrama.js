/**
 * prueba_lienzo_diagrama.js
 *
 * Verifica que el diagrama se comporta como un LIENZO:
 *   1. la API expone zoom / encuadrar / vista / mover;
 *   2. la vista arranca en 100% y se refleja en el transform de #diag-body;
 *   3. la rueda acerca y aleja, y queda limitada entre 25% y 250%;
 *   4. el zoom mantiene quieto el punto que está bajo el cursor;
 *   5. el arrastre mueve el lienzo, pero un clic (<4 px) NO panea
 *      (para que seleccionar un puerto siga funcionando);
 *   6. tras arrastrar, el clic siguiente se traga (no selecciona por accidente);
 *   7. encuadrar ajusta y centra el contenido, y no rompe si aún no es medible;
 *   8. el CSS no deja barras de desplazamiento y las columnas van en fila;
 *   9. nada de lo anterior se rompe: el contenido sigue pintándose en #diag-body.
 *
 * Uso (desde frontend/):
 *     node scripts/prueba_lienzo_diagrama.js
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

const RAIZ = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

// ── DOM simulado con eventos ────────────────────────────────────────────────
function crearElemento(id) {
  const clases = new Set();
  const manejadores = {};
  const el = {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    dataset: {},
    escuchas: manejadores,
    clientWidth: 0,
    clientHeight: 0,
    offsetWidth: 0,
    offsetHeight: 0,
    scrollWidth: 0,
    scrollHeight: 0,
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
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: el.clientWidth, height: el.clientHeight }),
    addEventListener(tipo, fn, opciones) {
      (manejadores[tipo] = manejadores[tipo] || []).push({ fn, opciones });
    },
    disparar(tipo, evento) {
      (manejadores[tipo] || []).forEach((h) => h.fn(evento || {}));
      return (manejadores[tipo] || []).length;
    },
  };
  return el;
}

const IDS = ['ftth-diagrama-modal', 'diag-body', 'diag-pie', 'diag-title', 'diag-badge',
  'diag-mark', 'diag-sub', 'diag-btn-close', 'diag-btn-reload', 'element-properties-modal',
  'diag-identity-name', 'diag-identity-code',
  'diag-viewport', 'diag-modo', 'diag-modo-salir', 'diag-modo-texto'];

function crearDom() {
  const elementos = {};
  const delDocumento = {};
  IDS.forEach((id) => { elementos[id] = crearElemento(id); });
  elementos['diag-viewport'].clientWidth = 800;
  elementos['diag-viewport'].clientHeight = 600;
  return {
    elementos,
    delDocumento,
    document: {
      getElementById: (id) => elementos[id] || null,
      querySelector: () => null,
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

function payloadNodo() {
  return {
    nodo: {
      box_id: 41, categoria: 'manga', tipo_nombre: 'Manga 48H', estado: 'Activo',
      conmuta_hilos: true, capacidad_puertos: null, propiedades_tipo: {}, propiedades_instancia: {},
    },
    bandejas: [], dispositivos: [], puertos: [], hilos_que_terminan: [],
    resumen: { bandejas: 0, slots_totales: 0, slots_ocupados: 0, dispositivos: 0, puertos: 0, puertos_libres: 0, hilos_anclados: 0, empalmes: 0 },
    advertencias: [],
  };
}

function cargarModulo(dom) {
  const codigo = leer(path.join('js', 'ftth-diagrama.js'));
  const windowObj = {
    location: { origin: 'http://prueba.local' },
    FTTHIconos: { imgHtml: (cat) => `<img src="assets/icons/${cat}.svg" alt="${cat}">` },
  };
  const payload = payloadNodo();
  const llamadas = [];
  const fetchStub = async (url, opciones) => {
    llamadas.push({ metodo: (opciones && opciones.method) || 'GET', url: String(url) });
    return { ok: true, status: 200, url, json: async () => payload };
  };
  const fabrica = new Function('window', 'document', 'fetch', 'console', 'setTimeout',
    `${codigo}\nreturn window.FTTHDiagrama;`);
  return { api: fabrica(windowObj, dom.document, fetchStub, console, (fn) => fn()), windowObj, llamadas };
}

async function main() {
  console.log('='.repeat(74));
  console.log('PRUEBA DEL LIENZO — zoom y navegacion del diagrama');
  console.log('='.repeat(74));

  const dom = crearDom();
  const { api } = cargarModulo(dom);

  console.log('\n1) API del lienzo');
  check(!!api, 'El modulo del diagrama se carga');
  ['zoom', 'encuadrar', 'vista', 'mover'].forEach((fn) => {
    check(typeof api[fn] === 'function', `La API expone ${fn}()`);
  });

  api.abrir(41, { categoria: 'manga', tipoNombre: 'Manga 48H' });
  await new Promise((r) => setTimeout(r, 10));

  const cuerpo = dom.elementos['diag-body'];
  const vp = dom.elementos['diag-viewport'];
  const chipModo = dom.elementos['diag-modo'];

  console.log('\n2) Estado inicial y transform');
  const v0 = api.vista();
  check(v0.k === 1 && v0.x === 0 && v0.y === 0, 'Arranca al 100% y sin desplazar', JSON.stringify(v0));
  check(String(cuerpo.style.transform).includes('scale('), 'El transform se aplica a #diag-body', cuerpo.style.transform);
  check(!vp.classList.contains('modo-eliminar'), 'Arranca sin el modo eliminar activo');

  console.log('\n3) Rueda: acercar y alejar');
  vp.disparar('wheel', { deltaY: -100, clientX: 400, clientY: 300 });
  check(api.vista().k > 1, 'Rueda hacia arriba acerca', api.vista().k);
  const trasAcercar = api.vista().k;
  vp.disparar('wheel', { deltaY: 100, clientX: 400, clientY: 300 });
  check(api.vista().k < trasAcercar, 'Rueda hacia abajo aleja', api.vista().k);

  console.log('\n4) Limites de zoom (25% - 250%)');
  for (let i = 0; i < 40; i += 1) vp.disparar('wheel', { deltaY: -100, clientX: 400, clientY: 300 });
  check(api.vista().k === 2.5, 'No pasa del 250%', api.vista().k);
  for (let i = 0; i < 60; i += 1) vp.disparar('wheel', { deltaY: 100, clientX: 400, clientY: 300 });
  check(api.vista().k === 0.25, 'No baja del 25%', api.vista().k);

  console.log('\n5) El zoom respeta el punto bajo el cursor');
  const cx = 400;
  const cy = 300;
  const antesZoom = api.vista();
  const puntoX = (cx - antesZoom.x) / antesZoom.k;
  const puntoY = (cy - antesZoom.y) / antesZoom.k;
  api.zoom(1.5, cx, cy);
  const despuesZoom = api.vista();
  check(Math.abs((cx - despuesZoom.x) / despuesZoom.k - puntoX) < 0.001,
    'El punto bajo el cursor no se mueve en X',
    `${puntoX.toFixed(3)} vs ${((cx - despuesZoom.x) / despuesZoom.k).toFixed(3)}`);
  check(Math.abs((cy - despuesZoom.y) / despuesZoom.k - puntoY) < 0.001,
    'El punto bajo el cursor no se mueve en Y',
    `${puntoY.toFixed(3)} vs ${((cy - despuesZoom.y) / despuesZoom.k).toFixed(3)}`);

  console.log('\n6) Arrastrar mueve el lienzo (y el clic sigue funcionando)');
  const antesArrastre = api.vista();
  vp.disparar('mousedown', { button: 0, clientX: 100, clientY: 100 });
  dom.dispararDoc('mousemove', { clientX: 102, clientY: 101 });
  check(api.vista().x === antesArrastre.x && api.vista().y === antesArrastre.y,
    'Un movimiento de menos de 4 px NO panea (seleccionar un puerto sigue igual)');
  dom.dispararDoc('mousemove', { clientX: 160, clientY: 130 });
  const movida = api.vista();
  check(Math.round(movida.x - antesArrastre.x) === 60 && Math.round(movida.y - antesArrastre.y) === 30,
    'El arrastre desplaza el lienzo',
    `dx=${(movida.x - antesArrastre.x).toFixed(1)} dy=${(movida.y - antesArrastre.y).toFixed(1)}`);
  dom.dispararDoc('mouseup', {});
  const trampa = (dom.delDocumento.click || []).some((h) => h.opciones && h.opciones.capture === true);
  check(trampa, 'Tras arrastrar, el clic siguiente se traga (no selecciona por accidente)');
  check(!vp.classList.contains('panning'), 'El cursor vuelve a "grab" al soltar');

  console.log('\n7) Encuadrar todo');
  cuerpo.offsetWidth = 1000;
  cuerpo.offsetHeight = 500;
  api.encuadrar();
  const enc = api.vista();
  check(Math.abs(enc.k - 0.8) < 0.001, 'Ajusta la escala al contenido (1000x500 en 800x600)', enc.k);
  check(Math.abs(enc.x - 16) < 0.001, 'Deja el margen minimo a la izquierda', enc.x);
  check(Math.abs(enc.y - 100) < 0.001, 'Centra el contenido en vertical', enc.y);
  check(String(cuerpo.style.transform).includes('scale(0.8)'), 'El transform lleva la escala nueva', cuerpo.style.transform);

  const domVirgin = crearDom();
  const cargaVirgin = cargarModulo(domVirgin);
  cargaVirgin.api.encuadrar();
  const vistaVirgin = cargaVirgin.api.vista();
  check(vistaVirgin.x === 0 && vistaVirgin.y === 0 && vistaVirgin.k === 1,
    'Sin medidas (antes de abrir) no toca la vista ni rompe');

  console.log('\n8) Sin barras: el CSS del lienzo');
  const css = leer(path.join('css', 'lienzo-diagrama.css'));
  check(/\.diag-body-container\s*\{[^}]*overflow:\s*hidden/.test(css),
    'El contenedor del diagrama ya no tiene overflow:auto (la barra desaparece)');
  check(/\.diag-viewport\s*\{[^}]*overflow:\s*hidden/.test(css),
    'El viewport recorta el lienzo sin barras');
  check(/#diag-body\s*\{[^}]*display:\s*flex/.test(css),
    'El lienzo pone las columnas EN FILA (antes se apilaban en vertical)');
  check(css.includes('transform-origin: 0 0'),
    'El origen del transform es la esquina (0 0), base del zoom');
  // Se quitan los comentarios: las comprobaciones miran reglas, no prosa.
  const cssReglas = css.replace(/\/\*[\s\S]*?\*\//g, '');
  check(!/overflow:\s*auto/.test(cssReglas), 'El CSS del lienzo no introduce ningun overflow:auto');

  const html = leer('index.html');
  check(html.includes('css/lienzo-diagrama.css'), 'index.html carga css/lienzo-diagrama.css');
  check((html.match(/id="diag-viewport"/g) || []).length === 1, 'index.html tiene el viewport una sola vez');

  console.log('\n9) Lo que se pidio retirar, retirado');
  check(!html.includes('id="diag-zoom"'), 'La barra de zoom ya no esta en el HTML');
  check(!/\.diag-zoom/.test(cssReglas), 'El CSS de la barra de zoom ya no existe');
  check(!/will-change/.test(cssReglas), 'Sin will-change: el zoom deja de verse pixelado');
  check(!/cursor:\s*grab/.test(cssReglas) && !/panning/.test(cssReglas),
    'Sin cursor de mano ni "modo paneo": se navega con el raton y punto');
  check(/#ftth-diagrama-modal\s+\.app-card\s*\{[^}]*width:\s*1170px/.test(cssReglas)
    && /#ftth-diagrama-modal\s+\.app-card\s*\{[^}]*height:\s*720px/.test(cssReglas),
    'El diagrama es un 50% mas grande (1170x720)');
  check(/\.diag-viewport\.modo-eliminar/.test(cssReglas), 'El CSS incluye el modo eliminar');
  check((html.match(/id="diag-modo"/g) || []).length === 1, 'index.html tiene el aviso del modo eliminar');

  console.log('\n10) Nada anterior se rompe');
  check((html.match(/id="diag-body"/g) || []).length === 1, 'id="diag-body" sigue apareciendo una sola vez');
  check((html.match(/id="diag-pie"/g) || []).length === 1, 'id="diag-pie" sigue apareciendo una sola vez');
  check(cuerpo.innerHTML.includes('diag-col'), 'El contenido se sigue pintando en #diag-body');
  check(cuerpo.innerHTML.includes('diag-pie') === false, 'El pie no se cuela dentro del lienzo');

  console.log('\n11) Modo eliminar (la basurita actua sobre el lienzo)');
  check(typeof api.modoEliminar === 'function' && typeof api.borrarObjeto === 'function',
    'La API expone modoEliminar() y borrarObjeto()');
  api.modoEliminar(true);
  check(api.enModoEliminar() === true, 'El modo eliminar queda activo');
  check(vp.classList.contains('modo-eliminar'), 'El lienzo se marca en modo eliminar');
  check(chipModo.style.display === 'flex', 'Se muestra el aviso del modo eliminar', chipModo.style.display);
  api.modoEliminar(false);
  check(api.enModoEliminar() === false && !vp.classList.contains('modo-eliminar'),
    'Se puede salir del modo eliminar');

  const domBaja = crearDom();
  const cargaBaja = cargarModulo(domBaja);
  cargaBaja.api.abrir(41, { categoria: 'manga', tipoNombre: 'Manga 48H' });
  await new Promise((r) => setTimeout(r, 10));
  await cargaBaja.api.borrarObjeto('dispositivo:9');
  const bajas = cargaBaja.llamadas.filter((l) => l.metodo === 'DELETE');
  check(bajas.length === 1, 'La baja manda un solo DELETE', JSON.stringify(bajas));
  check(bajas[0].url.includes('/api/elementos/41/dispositivos/9'),
    'La ruta apunta al objeto elegido', bajas[0].url);
  check(!cargaBaja.api.enModoEliminar(), 'Al terminar la baja se sale del modo eliminar');

  const domBaja2 = crearDom();
  const cargaBaja2 = cargarModulo(domBaja2);
  cargaBaja2.api.abrir(41, { categoria: 'manga', tipoNombre: 'Manga 48H' });
  await new Promise((r) => setTimeout(r, 10));
  // Una FIBRA sí tiene baja propia: se quita del nodo (desancla sus hilos) y va
  // contra el endpoint de cables, NUNCA contra el de dispositivos.
  await cargaBaja2.api.borrarObjeto('cable:5');
  const bajasCable = cargaBaja2.llamadas.filter((l) => l.metodo === 'DELETE');
  check(bajasCable.length === 1 && bajasCable[0].url.includes('/api/elementos/41/cables/5'),
    'La fibra se quita del nodo por la ruta de cables (no la de dispositivos)',
    JSON.stringify(bajasCable.map((l) => l.url)));

  const domBaja3 = crearDom();
  const cargaBaja3 = cargarModulo(domBaja3);
  await cargaBaja3.api.borrarObjeto('puerto:5');
  check(cargaBaja3.llamadas.filter((l) => l.metodo === 'DELETE').length === 0,
    'Un objeto sin baja soportada avisa y no manda peticiones');

  console.log('\n' + '='.repeat(74));
  console.log(`RESULTADO: ${OK.n} comprobaciones OK, ${OK.fallos.length} fallos`);
  OK.fallos.forEach((f) => console.log(`  - ${f}`));
  console.log('='.repeat(74));
  return OK.fallos.length ? 1 : 0;
}

main().then((codigo) => process.exit(codigo));


