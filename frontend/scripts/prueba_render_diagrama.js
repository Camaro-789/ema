/**
 * prueba_render_diagrama.js
 *
 * Prueba de RENDER del diagrama del nodo (F3) con DOM simulado, sin navegador.
 * Entrega a `ftth-diagrama.js` una respuesta con la misma forma que
 * `GET /api/elementos/{id}/nodo` y verifica el HTML generado.
 *
 * Uso (desde frontend/):
 *   node scripts/prueba_render_diagrama.js
 *   node scripts/prueba_render_diagrama.js ruta/al/nodo.json
 */
const fs = require('fs');
const path = require('path');

const R = { ok: 0, fallos: [] };
function check(cond, msg, detalle) {
  if (cond) { R.ok += 1; console.log(`  [OK]    ${msg}`); }
  else {
    R.fallos.push(msg);
    console.log(`  [FALLO] ${msg}`);
    if (detalle) console.log(`          ${String(detalle).slice(0, 300)}`);
  }
}

// ── Payload con la forma real del DTO (nodo #23 del proyecto 5) ──────────────
function payloadNodo() {
  const hilos = [1, 2, 3].map((h) => ({
    fibra_id: 500 + h,
    extremo: 'B',
    extremo_id: 950 + h,
    holgura_m: 5,
    cable_id: 87,
    cable: 'ADSS 12 H 1 BUFER',
    tubo_no: 1,
    hilo_no_en_tubo: h,
    hilo_global_no: h,
    nombre: `T01-H0${h}`,
    color: 'Azul',
    color_hex: '#1E90FF',
    estado: h === 1 ? 'reservado' : 'libre',
    perfil: 'eia598a',
    empalme: null,
  }));
  const puertos = [];
  puertos.push({ id: 1, dispositivo_id: 1, direccion: 'IN', puerto_no: 1, etiqueta: 'IN-1', tipo_conector: 'SC/APC', estado: 'libre', cliente: null });
  for (let i = 1; i <= 8; i++) {
    puertos.push({ id: 10 + i, dispositivo_id: 1, direccion: 'OUT', puerto_no: i, etiqueta: `OUT-${i}`, tipo_conector: 'SC/APC', estado: 'libre', cliente: null });
  }
  for (let i = 1; i <= 12; i++) {
    puertos.push({ id: 100 + i, dispositivo_id: 2, direccion: 'BIDI', puerto_no: i, etiqueta: `BIDI-${i}`, tipo_conector: 'SC/APC', estado: 'libre', cliente: null });
  }
  return {
    nodo: {
      box_id: 23,
      categoria: 'cajanap',
      tipo_nombre: 'Caja NAP 16P',
      plantilla_existe: true,
      lat: 7.7669,
      lon: -72.225,
      poste_ref_id: null,
      capacidad_puertos: 16,
      estado: 'Activo',
      color: '#eab308',
      conmuta_hilos: true,
      propiedades_tipo: { capacidad_puertos: '16 Puertos' },
      propiedades_instancia: {},
    },
    bandejas: [
      { id: 1, bandeja_no: 1, tipo: 'empalme', slots: 12, etiqueta: null, ocupados: 0, empalmes: [] },
      { id: 2, bandeja_no: 2, tipo: 'splitter', slots: 24, etiqueta: null, ocupados: 0, empalmes: [] },
    ],
    dispositivos: [
      { id: 1, tipo: 'splitter', tipo_id: null, division: '1x8', serie: 'SN-PRUEBA-001', puertos_in: 1, puertos_out: 8, atenuacion_db: 10.7, bandeja_id: 1, estado: 'operativo' },
      { id: 2, tipo: 'adaptador', tipo_id: null, division: null, serie: null, puertos_in: 0, puertos_out: 12, atenuacion_db: 0.3, bandeja_id: null, estado: 'operativo' },
    ],
    puertos,
    empalmes: [],
    hilos_que_terminan: hilos,
    resumen: {
      bandejas: 2, slots_totales: 36, slots_ocupados: 0, dispositivos: 2,
      puertos: puertos.length, puertos_libres: puertos.length, hilos_anclados: 3, empalmes: 0,
    },
    advertencias: [
      '3 hilo(s) anclados aquí aún sin empalme registrado (la fusión se declara en la fase de empalmes).',
      '8 puerto(s) OUT libres disponibles para clientes.',
      'El nodo declara capacidad para 16 puerto(s) pero se han instalado 21.',
    ],
  };
}

// ── DOM simulado con classList real (el diagrama usa toggle) ────────────────
function crearDom() {
  const elementos = {};
  const crear = (id) => {
    const clases = new Set();
    return {
      id,
      innerHTML: '',
      textContent: '',
      style: {},
      dataset: {},
      classList: {
        contains: (c) => clases.has(c),
        add: (...cs) => cs.forEach((c) => clases.add(c)),
        remove: (...cs) => cs.forEach((c) => clases.delete(c)),
        toggle: (c, activo) => { if (activo === undefined) { clases.has(c) ? clases.delete(c) : clases.add(c); } else if (activo) clases.add(c); else clases.delete(c); },
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      _clases: clases,
    };
  };
  ['ftth-diagrama-modal', 'diag-body', 'diag-pie', 'diag-title', 'diag-badge', 'diag-mark',
   'diag-sub', 'diag-btn-close', 'diag-btn-reload', 'element-properties-modal']
    .forEach((id) => { elementos[id] = crear(id); });
  elementos['ftth-diagrama-modal'].classList.add('hidden');
  elementos['ftth-diagrama-modal'].classList.add('ftth-modal-overlay');
  return {
    elementos,
    document: {
      getElementById: (id) => elementos[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => crear(tag),
      addEventListener() {},
    },
  };
}

function cargarModulo(dom, payload) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'js', 'ftth-diagrama.js'), 'utf8');
  const windowObj = {
    location: { origin: 'http://prueba.local' },
    FTTHIconos: { imgHtml: (cat) => `<img src="assets/icons/${cat}.svg" alt="${cat}">` },
  };
  const fetchStub = async (url) => ({ ok: true, status: 200, json: async () => payload, url });
  const fabrica = new Function('window', 'document', 'fetch', 'console', 'setTimeout',
    `${codigo}\nreturn window.FTTHDiagrama;`);
  return { api: fabrica(windowObj, dom.document, fetchStub, console, (fn) => fn()), windowObj };
}


async function main() {
  const ruta = process.argv[2];
  const payload = ruta && fs.existsSync(ruta) ? JSON.parse(fs.readFileSync(ruta, 'utf8')) : payloadNodo();

  console.log('='.repeat(74));
  console.log('PRUEBA DE RENDER — diagrama del nodo (DOM simulado)');
  console.log('='.repeat(74));

  const dom = crearDom();
  const { api, windowObj } = cargarModulo(dom, payload);

  check(typeof api === 'object' && api !== null, 'El módulo se carga y exporta una API');
  ['abrir', 'cerrar', 'esNodo'].forEach((fn) => check(typeof api[fn] === 'function', `La API expone ${fn}()`));
  check(windowObj.FTTHDiagrama === api, 'Se registra en window.FTTHDiagrama');

  console.log('\n1) Qué categorías abren diagrama');
  ['cajanap', 'manga', 'odf', 'armario', 'olt', 'splitter'].forEach((c) => {
    check(api.esNodo(c) === true, `«${c}» abre diagrama`);
  });
  ['poste', 'ducto', 'luminaria', 'switches', 'cables'].forEach((c) => {
    check(api.esNodo(c) === false, `«${c}» NO abre diagrama`);
  });

  console.log('\n2) Apertura del modal');
  api.abrir(23, { categoria: 'cajanap', tipoNombre: 'Caja NAP 16P' });
  const m = dom.elementos['ftth-diagrama-modal'];
  check(!m.classList.contains('hidden'), 'El modal queda visible');
  check(dom.elementos['diag-title'].textContent.includes('#23'), 'El título lleva el box_id', dom.elementos['diag-title'].textContent);
  check(dom.elementos['diag-title'].textContent.includes('Caja NAP 16P'), 'El título lleva el tipo');

  await new Promise((r) => setTimeout(r, 10));   // deja resolver el fetch simulado

  console.log('\n3) Cabecera y resumen');
  check(dom.elementos['diag-badge'].textContent === 'Activo', 'El badge muestra el estado', dom.elementos['diag-badge'].textContent);
  check(!dom.elementos['diag-badge'].classList.contains('diag-status--off'), 'Un nodo que conmuta hilos no se marca en rojo');
  check(dom.elementos['diag-mark'].innerHTML.includes('cajanap.svg'), 'La cabecera lleva el ícono del tipo');
  const sub = dom.elementos['diag-sub'].innerHTML;
  check(sub.includes('Caja NAP'), 'El resumen identifica la categoría');
  check(sub.includes('16 puertos declarados'), 'El resumen muestra la capacidad declarada');
  check(sub.includes('2 bandeja(s)'), 'El resumen cuenta las bandejas');
  check(sub.includes('36 posiciones'), 'El resumen cuenta las posiciones');
  check(sub.includes('2 dispositivo(s)'), 'El resumen cuenta los dispositivos');
  check(sub.includes('21 puertos'), 'El resumen cuenta los puertos', sub.match(/\d+ puertos[^<]*/));

  console.log('\n4) Columna de hilos que terminan');
  const body = dom.elementos['diag-body'].innerHTML;
  check(body.includes('Hilos que terminan aquí'), 'Aparece la columna de hilos');
  check(body.includes('ADSS 12 H 1 BUFER'), 'Agrupa por cable con su nombre');
  check(body.includes('T01-H01') && body.includes('T01-H03'), 'Lista los hilos anclados');
  check(body.includes('diag-hilo-franja'), 'Cada hilo lleva su franja de color TIA-598');
  check(body.includes('#1E90FF'), 'Se usa el color del hilo');
  check(body.includes('diag-estado--reservado'), 'Refleja el estado reservado');


  console.log('\n5) Columna de bandejas');
  check(body.includes('Bandeja 01') && body.includes('Bandeja 02'), 'Dibuja las dos bandejas');
  check(body.includes('0/12 posiciones'), 'Indica ocupación de la bandeja 1');
  check(body.includes('0/24 posiciones'), 'Indica ocupación de la bandeja 2');
  const slots = (body.match(/class="diag-slot"/g) || []).length;
  check(slots === 36, 'Dibuja 36 posiciones (12+24)', `encontradas=${slots}`);
  check(body.includes('Posición 12 libre'), 'Las posiciones llevan descripción');

  console.log('\n6) Columna de dispositivos y puertos');
  check(body.includes('splitter 1x8'), 'Muestra el splitter con su división');
  check(body.includes('10.7 dB'), 'Muestra la atenuación del splitter');
  check(body.includes('SN-PRUEBA-001'), 'Muestra la serie del splitter');
  check(body.includes('adaptador'), 'Muestra el panel de adaptadores');
  check(body.includes('diag-puerto--in'), 'Distingue el puerto IN');
  check(body.includes('diag-puerto--out'), 'Distingue los puertos OUT');
  check(body.includes('diag-puerto--bidi'), 'Distingue los puertos BIDI');
  check(body.includes('IN-1') && body.includes('OUT-8') && body.includes('BIDI-12'), 'Enumera los puertos');
  check(body.includes('SC/APC'), 'Muestra el tipo de conector');

  console.log('\n7) Pie de avisos');
  const pie = dom.elementos['diag-pie'].innerHTML;
  check(pie.includes('sin empalme registrado'), 'Muestra el aviso de hilos sin empalme');
  check(pie.includes('OUT libres'), 'Muestra el aviso de puertos libres');
  check(pie.includes('capacidad para 16'), 'Muestra el aviso de capacidad excedida');

  console.log('\n8) Calidad del HTML generado');
  check(!body.includes('undefined'), 'No aparece «undefined»', body.match(/.{0,60}undefined.{0,60}/));
  check(!body.includes('NaN'), 'No aparece «NaN»');
  check(!body.includes('title=""'), 'Ningún atributo title quedó vacío');
  check(!sub.includes('undefined'), 'El resumen no tiene «undefined»');

  console.log('\n9) Cierre del modal');
  api.cerrar();
  check(m.classList.contains('hidden'), 'El modal se oculta al cerrar');

  console.log('\n10) Nodo que NO conmuta hilos (poste) y sin contenido');
  const payloadPoste = payloadNodo();
  payloadPoste.nodo.categoria = 'poste';
  payloadPoste.nodo.tipo_nombre = 'Poste Estándar 9m';
  payloadPoste.nodo.conmuta_hilos = false;
  payloadPoste.nodo.capacidad_puertos = null;
  payloadPoste.bandejas = [];
  payloadPoste.dispositivos = [];
  payloadPoste.puertos = [];
  payloadPoste.hilos_que_terminan = [];
  payloadPoste.advertencias = ['«poste» no conmuta hilos: no puede alojar bandejas, splitters ni empalmes. Solo sostiene o encauza.'];
  const dom2 = crearDom();
  const m2 = cargarModulo(dom2, payloadPoste);
  m2.api.abrir(21, { categoria: 'poste', tipoNombre: 'Poste Estándar 9m' });
  await new Promise((r) => setTimeout(r, 10));
  check(dom2.elementos['diag-badge'].classList.contains('diag-status--off'), 'El badge se marca cuando no conmuta hilos');
  check(dom2.elementos['diag-sub'].innerHTML.includes('no conmuta hilos'), 'El resumen avisa que no conmuta');
  const body2 = dom2.elementos['diag-body'].innerHTML;
  check(body2.includes('no tiene bandejas'), 'Explica que no hay bandejas');
  check(body2.includes('Sin splitters'), 'Explica que no hay dispositivos');
  check(body2.includes('Ningún hilo'), 'Explica que no hay hilos anclados');
  check(dom2.elementos['diag-pie'].innerHTML.includes('no conmuta hilos'), 'El pie trae la advertencia del backend');

  console.log('\n' + '='.repeat(74));
  console.log(`RESULTADO: ${R.ok} comprobaciones OK, ${R.fallos.length} fallos`);
  R.fallos.forEach((f) => console.log(`  - ${f}`));
  console.log('='.repeat(74));
  process.exit(R.fallos.length ? 1 : 0);
}

main().catch((e) => {
  console.error('Error inesperado en la prueba:', e);
  process.exit(1);
});


