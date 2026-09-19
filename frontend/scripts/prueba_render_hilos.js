/**
 * prueba_render_hilos.js
 *
 * Prueba de RENDER de la pestaña "Hilos" sin navegador.
 *
 * Carga `../js/ftth-hilos.js` con un DOM simulado, le entrega una respuesta
 * representativa de `GET /api/cables/{id}/hilos` y verifica el HTML generado.
 * Sirve para detectar errores de plantilla/comillas antes de abrir el navegador.
 *
 * Uso (desde frontend/):
 *   node scripts/prueba_render_hilos.js
 *   node scripts/prueba_render_hilos.js ruta/al/payload_real.json
 */
const fs = require('fs');
const path = require('path');

const RESULTADO = { ok: 0, fallos: [] };
function check(cond, msg, detalle) {
  if (cond) {
    RESULTADO.ok += 1;
    console.log(`  [OK]    ${msg}`);
  } else {
    RESULTADO.fallos.push(msg);
    console.log(`  [FALLO] ${msg}`);
    if (detalle) console.log(`          ${String(detalle).slice(0, 300)}`);
  }
}

// ── Payload representativo (misma forma que devuelve la API) ─────────────────
function payloadEjemplo() {
  const hilos = [];
  for (let h = 1; h <= 12; h++) {
    hilos.push({
      id: 500 + h,
      tubo_no: 1,
      hilo_no_en_tubo: h,
      hilo_global_no: h,
      nombre: `T01-H${String(h).padStart(2, '0')}`,
      color: ['Azul', 'Naranja', 'Verde'][h % 3],
      color_hex: ['#1E90FF', '#FF8C00', '#22C55E'][h % 3],
      estado: h <= 3 ? 'reservado' : 'libre',
      perfil: 'eia598a',
      extremos: {
        A: { id: 900 + h, nodo_id: null, holgura_m: null },
        B: { id: 950 + h, nodo_id: h <= 3 ? 23 : null, holgura_m: h <= 3 ? 5 : null },
      },
    });
  }
  return {
    cable_id: 87,
    nombre: 'ADSS 12 H 1 BUFER',
    categoria: 'cables',
    plantilla: { id: 36, nombre_id: 'ADSS 12 H 1 BUFER', existe: true, propiedades: {} },
    resumen: {
      materializado: true,
      tubos: 1,
      hilos: 12,
      por_estado: { libre: 9, empalmado: 0, conectado: 0, reservado: 3, averiado: 0 },
      sin_extremo_anclado: 9,
    },
    tubos: [
      {
        id: 41, tubo_no: 1, color: 'Azul', color_hex: '#1E90FF',
        capacidad_fibras: 12, etiqueta: null, hilos,
      },
    ],
    advertencias: ['9 hilo(s) sin extremo anclado a una caja o manga: todavía no se puede afirmar en qué nodo terminan.'],
  };
}

// ── DOM simulado ────────────────────────────────────────────────────────────
function crearDom() {
  const elementos = {};
  const crear = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    style: {},
    classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  });
  ['prop-tab-btn-hilos', 'prop-tab-hilos', 'prop-hilos-body', 'prop-hilos-count',
   'hilos-sel-estado'].forEach((id) => { elementos[id] = crear(id); });
  return {
    elementos,
    document: {
      getElementById: (id) => elementos[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => crear(tag),
    },
  };
}

function cargarModulo(dom, payload) {
  const ruta = path.join(__dirname, '..', 'js', 'ftth-hilos.js');
  const codigo = fs.readFileSync(ruta, 'utf8');
  const windowObj = { location: { origin: 'http://prueba.local' } };
  const fetchStub = async (url) => ({ ok: true, status: 200, json: async () => payload, url });
  const fabrica = new Function('window', 'document', 'fetch', 'console', 'setTimeout',
    `${codigo}\nreturn window.FTTHHilos;`);
  return {
    api: fabrica(windowObj, dom.document, fetchStub, console, (fn) => fn()),
    windowObj,
  };
}


async function main() {
  const rutaPayload = process.argv[2];
  const payload = rutaPayload && fs.existsSync(rutaPayload)
    ? JSON.parse(fs.readFileSync(rutaPayload, 'utf8'))
    : payloadEjemplo();

  console.log('='.repeat(74));
  console.log('PRUEBA DE RENDER — pestaña «Hilos» (DOM simulado)');
  console.log('='.repeat(74));

  const dom = crearDom();
  const { api, windowObj } = cargarModulo(dom, payload);

  check(typeof api === 'object' && api !== null, 'El módulo se carga y exporta una API');
  ['cargar', 'recargar', 'verHilo', 'guardarEstado', 'materializar'].forEach((fn) => {
    check(typeof api[fn] === 'function', `La API expone ${fn}()`);
  });
  check(windowObj.FTTHHilos === api, 'Se registra en window.FTTHHilos');

  console.log('\n1) Carga con un cable real');
  await api.cargar({ id: 87, categoria: 'cables' });
  const cuerpo = dom.elementos['prop-hilos-body'].innerHTML;
  const contador = dom.elementos['prop-hilos-count'].textContent;
  check(cuerpo.length > 0, 'Se generó HTML en la pestaña', `len=${cuerpo.length}`);
  check(contador === '12', 'El contador de la pestaña muestra 12 hilos', contador);
  check(dom.elementos['prop-tab-btn-hilos'].style.display === '', 'La pestaña queda visible para un cable');

  console.log('\n2) Contenido del render');
  check(cuerpo.includes('Tubo 01'), 'Muestra el encabezado del tubo');
  check(cuerpo.includes('T01-H01'), 'Muestra el nombre canónico del hilo');
  check(cuerpo.includes('T01-H12'), 'Muestra todos los hilos del tubo');
  check(cuerpo.includes('hilos-hilo--sel') === false, 'Ningún hilo aparece seleccionado al abrir');
  check(cuerpo.includes('class="hilos-chip'), 'Muestra los chips de resumen');
  check(cuerpo.includes('reservado'), 'Muestra el estado reservado');
  check(cuerpo.includes('9 libres'), 'Resume los 9 hilos libres');
  check(cuerpo.includes('sin extremo anclado'), 'Muestra la advertencia del backend');
  check(cuerpo.includes('hilos-leyenda'), 'Incluye la leyenda');
  check(cuerpo.includes('Selecciona un hilo'), 'Invita a seleccionar un hilo (detalle vacío)');
  check(!cuerpo.includes('undefined'), 'No aparece «undefined» en el HTML', cuerpo.match(/.{0,60}undefined.{0,60}/));
  check(!cuerpo.includes('title=""'), 'Ningún atributo title quedó vacío');
  check((cuerpo.match(/<button/g) || []).length >= 13, 'Renderiza los 12 hilos más el botón de acción');

  console.log('\n3) Selección de un hilo');
  const idPrimero = payload.tubos[0].hilos[0].id;
  api.verHilo(idPrimero);
  const conSeleccion = dom.elementos['prop-hilos-body'].innerHTML;
  check(conSeleccion.includes('hilos-hilo--sel'), 'El hilo seleccionado queda marcado');
  check(conSeleccion.includes('Estado del hilo'), 'Aparece el panel de detalle con el selector de estado');
  check(conSeleccion.includes('global 1'), 'El detalle muestra la posición global');
  check(conSeleccion.includes('#23'), 'El detalle muestra el nodo del extremo anclado');
  check(conSeleccion.includes('sin anclar'), 'El detalle distingue el extremo sin anclar');

  console.log('\n4) Objeto que no es cable');
  await api.cargar({ id: 21, categoria: 'poste' });
  check(dom.elementos['prop-tab-btn-hilos'].style.display === 'none', 'La pestaña se oculta para un poste');
  check(
    dom.elementos['prop-hilos-body'].innerHTML.includes('no contiene hilos'),
    'Explica por qué no aplica',
    dom.elementos['prop-hilos-body'].innerHTML
  );

  console.log('\n5) Objeto provisional (aún sin guardar)');
  await api.cargar({ id: 'tmp-abc123', categoria: 'cables' });
  check(dom.elementos['prop-tab-btn-hilos'].style.display === 'none', 'Se oculta para objetos provisionales');
  check(dom.elementos['prop-hilos-body'].innerHTML.includes('no está guardado'), 'Explica que falta guardarlo');

  console.log('\n6) Cable sin hilos materializados');
  const vacio = payloadEjemplo();
  vacio.resumen = { materializado: false, tubos: 0, hilos: 0, por_estado: {}, sin_extremo_anclado: 0 };
  vacio.tubos = [];
  vacio.advertencias = ['Este cable aún no tiene tubos ni hilos generados.'];
  const dom2 = crearDom();
  const m2 = cargarModulo(dom2, vacio);
  await m2.api.cargar({ id: 88, categoria: 'cables' });
  const html2 = dom2.elementos['prop-hilos-body'].innerHTML;
  check(html2.includes('Materializar hilos'), 'Ofrece el botón «Materializar hilos»');
  check(html2.includes('aún no tiene tubos'), 'Explica que falta materializar');
  check(dom2.elementos['prop-hilos-count'].textContent === '0', 'El contador queda en 0');

  console.log('\n' + '='.repeat(74));
  console.log(`RESULTADO: ${RESULTADO.ok} comprobaciones OK, ${RESULTADO.fallos.length} fallos`);
  RESULTADO.fallos.forEach((f) => console.log(`  - ${f}`));
  console.log('='.repeat(74));
  process.exit(RESULTADO.fallos.length ? 1 : 0);
}

main().catch((e) => {
  console.error('Error inesperado en la prueba:', e);
  process.exit(1);
});

