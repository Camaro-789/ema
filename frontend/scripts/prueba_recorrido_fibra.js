/**
 * prueba_recorrido_fibra.js
 *
 * Prueba del RECORRIDO de una fibra (Propiedades de fibra → pestañas
 * «Información» y «Ruta de fibra») sin navegador:
 *   1. el trazado se limpia (puntos repetidos) y se mide su longitud total;
 *   2. se detectan los postes por los que pasa la fibra y la distancia entre
 *      postes consecutivos, medida A LO LARGO DE LA FIBRA;
 *   3. la primera y la última punta salen del propio trazado (no de datos sueltos);
 *   4. si la fibra NO pasa por postes no se dibuja ruta: sólo la longitud total;
 *   5. los íconos de la lista son los del panel general izquierdo (FTTHIconos);
 *   6. nada de lo anterior rompe el panel (no aparece «undefined»).
 *
 * Los datos usados son los REALES de la base de datos: el cable #133 pasando
 * por los postes #126…#131, con la caja NAP #132 colgada del poste #131.
 *
 * Uso (desde frontend/):
 *     node scripts/prueba_recorrido_fibra.js
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
    if (detalle !== undefined) console.log(`          ${String(detalle).slice(0, 300)}`);
  }
}

// ── Datos reales ────────────────────────────────────────────────────────────
const COORDS_CABLE_133 = [
  [-72.22688088596001, 7.764968215058403],
  [-72.22688158974051, 7.764962302442001],
  [-72.22688158974051, 7.764962302442001],
  [-72.22688158974051, 7.764962302442001],
  [-72.22663564005579, 7.76494561067139],
  [-72.22663432359695, 7.764946356752333],
  [-72.22663432359695, 7.764946356752333],
  [-72.22663432359695, 7.764946356752333],
  [-72.22643602129557, 7.764923006283155],
  [-72.22636567944713, 7.764926773681154],
  [-72.22637079656124, 7.764927255144087],
  [-72.22637079656124, 7.764927255144087],
  [-72.22637079656124, 7.764927255144087],
  [-72.22623640253609, 7.764909820388837],
  [-72.22616035729438, 7.7649041692912135],
  [-72.22603678377587, 7.764898518194272],
  [-72.22603669390082, 7.7648986857805795],
  [-72.22603669390082, 7.7648986857805795],
  [-72.22603669390082, 7.7648986857805795],
  [-72.22565275530462, 7.764860844205629],
  [-72.22565749660134, 7.764860482558916],
  [-72.22565749660134, 7.764860482558916],
  [-72.22565749660134, 7.764860482558916],
  [-72.2254531365444, 7.764849542009031],
  [-72.22545180469751, 7.764850848702466],
  [-72.22545180469751, 7.764850848702466],
  [-72.22545180469751, 7.764850848702466],
  [-72.22545180469751, 7.764850848702466]
];

function featurePunto(id, categoria, lon, lat, tipo, posteRef) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: {
      id,
      categoria,
      tipo_id: 1,
      tipo_nombre: tipo,
      color: '#000000',
      poste_ref_id: posteRef || null,
      propiedades_tipo: {},
      propiedades_instancia: {}
    }
  };
}

/** Los 6 postes del tramo + la caja NAP colgada del último poste */
function featuresPostes126a131() {
  return [
    featurePunto(126, 'poste', -72.22688166891774, 7.764962274739048, 'Poste Estándar 9m'),
    featurePunto(127, 'poste', -72.22663426827093, 7.76494635706716, 'Poste Estándar 9m'),
    featurePunto(128, 'poste', -72.2263708026471, 7.764927255859547, 'Poste Estándar 9m'),
    featurePunto(129, 'poste', -72.22603665112388, 7.764898604047758, 'Poste Estándar 9m'),
    featurePunto(130, 'poste', -72.22565751766547, 7.764860401628624, 'Poste Estándar 9m'),
    featurePunto(131, 'poste', -72.22545188595922, 7.764850851022956, 'Poste Estándar 9m'),
    featurePunto(132, 'cajanap', -72.22545180469751, 7.764851014803426, 'Caja NAP 16P', 131)
  ];
}

/** Fibra subterránea: va de una manga a un splitter sin tocar ningún poste */
function fibraSinPostes() {
  return {
    coords: [
      [-72.2300000, 7.7700000],
      [-72.2299000, 7.7700000],
      [-72.2298000, 7.7700000]
    ],
    features: [
      featurePunto(501, 'manga', -72.2300000, 7.7700000, 'Manga Fusión 48H'),
      featurePunto(502, 'splitter', -72.2298000, 7.7700000, 'Splitter 1x8')
    ]
  };
}


// ── DOM simulado ────────────────────────────────────────────────────────────
function crearElemento(tag) {
  const clases = new Set();
  const manejadores = {};
  const hijos = {};
  const el = {
    tag,
    id: '',
    className: '',
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    title: '',
    style: {},
    dataset: {},
    hijos,
    classList: {
      contains: (c) => clases.has(c),
      add: (...cs) => cs.forEach((c) => clases.add(c)),
      remove: (...cs) => cs.forEach((c) => clases.delete(c)),
      toggle: (c, activo) => {
        if (activo === undefined) {
          if (clases.has(c)) clases.delete(c); else clases.add(c);
        } else if (activo) clases.add(c); else clases.delete(c);
        return clases.has(c);
      }
    },
    // El inspector busca #id dentro de su raíz: se crea bajo demanda para poder
    // comprobar en qué pestaña quedó (Información / Ruta de fibra).
    querySelector: (sel) => {
      const clave = String(sel);
      if (!hijos[clave]) {
        if (!clave.startsWith('#')) return null;
        const nuevo = crearElemento('div');
        nuevo.id = clave.slice(1);
        hijos[clave] = nuevo;
      }
      return hijos[clave];
    },
    querySelectorAll: () => [],
    appendChild(hijo) {
      if (hijo && hijo.id) hijos['#' + hijo.id] = hijo;
      return hijo;
    },
    addEventListener(tipo, fn) {
      (manejadores[tipo] = manejadores[tipo] || []).push(fn);
    }
  };
  return el;
}

function crearDom() {
  const elementos = {};
  const body = crearElemento('body');
  body.appendChild = (el) => {
    if (el && el.id) {
      elementos[el.id] = el;
      body.hijos['#' + el.id] = el;
    }
    return el;
  };
  const document = {
    body,
    getElementById: (id) => {
      if (!elementos[id]) {
        const e = crearElemento('div');
        e.id = id;
        elementos[id] = e;
      }
      return elementos[id];
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => crearElemento(tag),
    addEventListener() {}
  };
  return { elementos, document, body };
}

/** Íconos reales del proyecto (los mismos del panel general izquierdo) */
const ICONOS_REALES = {
  poste: 'poste.svg', cajanap: 'cajanap.svg', manga: 'manga.svg', ducto: 'ducto.svg',
  luminaria: 'luminaria.svg', odf: 'odf.svg', olt: 'olt.svg', splitter: 'splitter.svg',
  armario: 'armario.svg', cables: 'cables.svg', switches: 'switches.svg',
  fusion: 'fusion.svg', reserva: 'reserva.svg'
};

function cargarModulo(dom, respuestas) {
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'js', 'ftth-fibra-inspector.js'), 'utf8');
  const llamadas = [];
  const windowObj = {
    location: { origin: 'http://prueba.local' },
    currentProjectId: 7,
    apiUrl: (p) => 'http://prueba.local' + p,
    FTTHIconos: {
      ICONOS: ICONOS_REALES,
      imgHtml: (cat, size = 16, extraClass = '') =>
        `<img src="assets/icons/${cat}.svg" alt="${cat}" class="${('ftth-icono ' + extraClass).trim()}">`
    },
    FTTHTipos: { getTipos: async () => [], showToast() {} },
    FTTHMapa: { _currentFeatures: [] }
  };
  const fetchStub = async (url, opciones) => {
    llamadas.push({ metodo: (opciones && opciones.method) || 'GET', url: String(url) });
    const clave = Object.keys(respuestas).find((k) => String(url).includes(k));
    if (!clave) return { ok: false, status: 404, json: async () => ({ detail: 'no encontrado' }) };
    return { ok: true, status: 200, url, json: async () => respuestas[clave] };
  };
  const fabrica = new Function('window', 'document', 'fetch', 'console', 'setTimeout',
    `${codigo}\nreturn window.FTTHFibraInspector;`);
  const api = fabrica(windowObj, dom.document, fetchStub, console, (fn) => fn());
  return { api, windowObj, llamadas };
}

/** La misma feature que entrega el mapa al abrir las propiedades de un cable */
function featureCable(id, coords, instProps) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: {
      id,
      categoria: 'cables',
      tipo_id: 3,
      tipo_nombre: 'ADSS 144H',
      color: '#0284c7',
      propiedades_tipo: { looses: 12, fibras: 144 },
      propiedades_instancia: Object.assign({ reserva_m: 30 }, instProps || {})
    }
  };
}

// ── Prueba ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(74));
  console.log('PRUEBA DEL RECORRIDO DE UNA FIBRA (Propiedades de fibra)');
  console.log('='.repeat(74));

  const dom = crearDom();
  const { api, windowObj } = cargarModulo(dom, {
    '/api/cables/133/hilos': { cable_id: 133, tubos: [], resumen: {} },
    '/api/elementos/todos': { type: 'FeatureCollection', features: [] }
  });

  console.log('\n1) API del módulo');
  check(typeof api === 'object' && api !== null, 'El módulo se carga y exporta una API');
  ['abrir', 'cerrarInspector', 'resolverRecorridoFibra', 'normalizarTrazado',
    'longitudTrazado', 'calcularDistanciaGeo'].forEach((fn) => {
    check(typeof api[fn] === 'function', `La API expone ${fn}()`);
  });
  check(windowObj.FTTHFibraInspector === api, 'Se registra en window.FTTHFibraInspector');

  console.log('\n2) Trazado: limpieza y longitud total');
  const limpio = api.normalizarTrazado(COORDS_CABLE_133);
  check(limpio.length === 14, 'Funde los puntos repetidos (28 puntos → 14)', limpio.length);
  const largo = api.longitudTrazado(COORDS_CABLE_133);
  console.log(`        Longitud total del cable #133 = ${largo.toFixed(2)} m`);
  check(largo > 158 && largo < 164, 'La longitud total del trazado es la esperada', largo.toFixed(2));

  console.log('\n3) Ruta de postes del cable #133 (postes #126…#131)');
  const features = featuresPostes126a131();
  const r = api.resolverRecorridoFibra(COORDS_CABLE_133, features);
  console.log(`        postes=${r.postes.length}  total=${r.total_m.toFixed(2)} m  ` +
    `primerPoste→últimoPoste=${r.distancia_postes_m.toFixed(2)} m`);
  console.log('        tramos: ' + r.postes.map((p) => `#${p.id} +${p.paso_m.toFixed(1)}m`).join('  '));
  check(r.tiene_postes === true, 'Detecta que la fibra pasa por postes');
  check(r.postes.length === 6, 'Cuenta los 6 postes del tramo', r.postes.length);
  check(r.postes.map((p) => p.id).join(',') === '126,127,128,129,130,131',
    'Los ordena de origen a fin', r.postes.map((p) => p.id).join(','));
  check(r.postes[0].paso_m === 0, 'El primer poste arranca en 0 m');
  const pasos = r.postes.slice(1).map((p) => p.paso_m);
  check(pasos.every((d) => d > 15 && d < 60), 'Cada tramo entre postes es razonable',
    pasos.map((d) => d.toFixed(1)).join(' '));
  const suma = pasos.reduce((s, d) => s + d, 0);
  check(Math.abs(suma - r.distancia_postes_m) < 1e-6,
    'La suma de los tramos es la distancia entre el primero y el último poste', suma.toFixed(3));
  check(Math.abs(r.postes[1].paso_m - 27.3) < 1.5, 'Poste #126 → #127 ≈ 27,3 m', r.postes[1].paso_m.toFixed(2));
  check(Math.abs(r.postes[5].paso_m - 22.8) < 1.5, 'Poste #130 → #131 ≈ 22,8 m', r.postes[5].paso_m.toFixed(2));
  check(r.distancia_postes_m > 155 && r.distancia_postes_m < 166,
    'La distancia entre postes es la esperada', r.distancia_postes_m.toFixed(2));
  check(r.postes[0].acumulada_m > 0, 'El primer poste está algo después del origen del trazado',
    r.postes[0].acumulada_m.toFixed(2));

  console.log('\n3b) Ruta FÍSICA guardada (postes_intermedios): manda el ORDEN de clic');
  const conRuta = api.resolverRecorridoFibra(COORDS_CABLE_133, features, [129, 127, 126, 130]);
  check(conRuta.ruta_trazado === true, 'Se reconoce la ruta guardada del trazado');
  check(conRuta.postes_trazado.map(p => p.id).join(',') === '129,127,126,130',
    'La lista sale en el ORDEN de clic (no por id ni por posición)',
    conRuta.postes_trazado.map(p => p.id).join(','));
  check(conRuta.postes_trazado.every((p, i) => p.orden === i + 1),
    'Cada poste lleva su número de orden de trazado');
  check(conRuta.postes_trazado[0].acumulada_m !== null,
    'Si el poste está sobre el trazado, se le calculan sus distancias');
  const conFantasma = api.resolverRecorridoFibra(COORDS_CABLE_133, features, [999]);
  check(conFantasma.postes_trazado.length === 1 && conFantasma.postes_trazado[0].paso_m === null,
    'Un poste que ya no está en el inventario se lista igual (sin medida) y no rompe');
  check(api.resolverRecorridoFibra(COORDS_CABLE_133, features).ruta_trazado === false,
    'Sin ruta guardada, se usa la deducida de la geometría');

  console.log('\n4) Primera y última punta (se deducen del trazado)');
  check(r.punta_a && r.punta_a.id === 126, 'La primera punta es el poste #126',
    r.punta_a && r.punta_a.nombre);
  check(r.punta_b && r.punta_b.id === 131, 'La última punta es el poste #131',
    r.punta_b && r.punta_b.nombre);
  check(r.postes[0].nombre === 'Poste Estándar 9m #126', 'El nombre del poste lleva tipo e id',
    r.postes[0].nombre);
  const anclados = r.postes[5].otros.map((o) => `${o.categoria}#${o.id}`).join(',');
  check(anclados === 'cajanap#132', 'Detecta la caja NAP #132 colgada del último poste', anclados);

  console.log('\n5) Panel de propiedades (pestaña Información)');
  windowObj.FTTHMapa._currentFeatures = features; // camino rápido: memoria del mapa
  await api.abrir(133, featureCable(133, COORDS_CABLE_133));
  const el = dom.elementos;
  check(el['ffi-postes-ruta'].value === '6 postes', 'Informa los 6 postes de la ruta', el['ffi-postes-ruta'].value);
  check(el['ffi-punta-a'].value.includes('#126'), 'Primera punta (A) en Información', el['ffi-punta-a'].value);
  check(el['ffi-punta-b'].value.includes('#131'), 'Segunda punta (B) en Información', el['ffi-punta-b'].value);
  check(String(el['ffi-punta-a'].title).includes('origen'), 'Explica de dónde salió la punta A',
    el['ffi-punta-a'].title);
  const distPostes = parseFloat(el['ffi-dist-postes'].value);
  check(Math.abs(distPostes - r.distancia_postes_m) < 0.2, 'Distancia entre postes en Información',
    el['ffi-dist-postes'].value);
  const longitud = parseFloat(el['ffi-longitud'].value);
  check(Math.abs(longitud - r.total_m) < 0.05, 'Longitud total de la fibra en Información',
    el['ffi-longitud'].value);

  console.log('\n6) Panel de propiedades (pestaña Ruta de fibra)');
  const lista = el['ffi-route-list'].innerHTML;
  const resumen = el['ffi-route-summary'].innerHTML;
  check((lista.match(/data-poste-id=/g) || []).length === 6, 'Dibuja un renglón por poste',
    (lista.match(/data-poste-id=/g) || []).length);
  check(lista.includes('route-item start'), 'El primer poste se marca como inicio de la ruta');
  check(lista.includes('Punto de paso'), 'Los postes intermedios se marcan como punto de paso');
  check(lista.includes('+27.') && lista.includes('acum.'), 'Muestra la distancia entre postes y la acumulada');
  check(lista.includes('assets/icons/poste.svg'), 'Usa el ícono oficial del poste');
  check(lista.includes('assets/icons/cajanap.svg'), 'Usa el ícono oficial de la caja NAP anclada');
  check(lista.includes('Caja NAP 16P #132'), 'Nombra la caja colgada del poste');
  check(!lista.includes('undefined') && !resumen.includes('undefined'), 'No aparece «undefined» en el HTML');
  check(resumen.includes('postes') && resumen.includes('#126'), 'El resumen cuenta los postes y las puntas');
  const raiz = dom.body.hijos['#ftth-fibra-inspector-root'];
  check(raiz && raiz.querySelector('#ffi-tab-ruta').classList.contains('active'),
    'Con postes en la ruta, abre directamente la pestaña «Ruta de fibra»');

  console.log('\n7) Fibra que NO pasa por postes (sólo longitud total)');
  const dom2 = crearDom();
  const sinPostes = fibraSinPostes();
  const m2 = cargarModulo(dom2, {
    '/api/cables/200/hilos': { cable_id: 200, tubos: [], resumen: {} },
    '/api/elementos/todos': { type: 'FeatureCollection', features: sinPostes.features }
  });
  await m2.api.abrir(200, featureCable(200, sinPostes.coords));
  const el2 = dom2.elementos;
  const lista2 = el2['ffi-route-list'].innerHTML;
  check(!lista2.includes('route-item'), 'NO dibuja ruta de postes', lista2.slice(0, 120));
  check(lista2.includes('no pasa por postes'), 'Explica que la fibra no pasa por postes');
  check(lista2.includes('Longitud total de la fibra'), 'Informa la longitud total de la fibra');
  check(el2['ffi-postes-ruta'].value.includes('no pasa por postes'), 'Lo repite en Información',
    el2['ffi-postes-ruta'].value);
  check(el2['ffi-dist-postes'].value === '—', 'Sin postes no hay distancia entre postes',
    el2['ffi-dist-postes'].value);
  const largo2 = parseFloat(el2['ffi-longitud'].value);
  check(largo2 > 20 && largo2 < 25, 'La longitud total sigue informada', el2['ffi-longitud'].value);
  check(el2['ffi-punta-a'].value.includes('#501'), 'La punta A sale del trazado (manga #501)',
    el2['ffi-punta-a'].value);
  check(el2['ffi-punta-b'].value.includes('#502'), 'La punta B sale del trazado (splitter #502)',
    el2['ffi-punta-b'].value);
  check(m2.llamadas.some((c) => c.url.includes('/api/elementos/todos')),
    'Sin memoria del mapa, pide los elementos del proyecto a la API');
  const raiz2 = dom2.body.hijos['#ftth-fibra-inspector-root'];
  check(raiz2 && raiz2.querySelector('#ffi-tab-info').classList.contains('active'),
    'Sin postes se queda en la pestaña «Información»');

  console.log('\n8) Propiedades: la ruta guardada manda en el panel (orden de clic)');
  const dom3 = crearDom();
  const m3 = cargarModulo(dom3, {
    '/api/cables/160/hilos': { cable_id: 160, tubos: [], resumen: {} },
    '/api/elementos/todos': { type: 'FeatureCollection', features: featuresPostes126a131() }
  });
  // Ruta guardada DELIBERADAMENTE en otro orden (129 → 127 → 126) y con un poste
  // que ya no existe (999): el panel debe respetar ese orden tal cual.
  await m3.api.abrir(160, featureCable(160, COORDS_CABLE_133, { postes_intermedios: [129, 127, 126, 999] }));
  const el3 = dom3.elementos;
  const lista3 = el3['ffi-route-list'].innerHTML;
  const ordenRenglones = Array.from(lista3.matchAll(/data-poste-id="(\d+)"/g)).map((m) => m[1]);
  console.log(`        renglones en orden: ${ordenRenglones.join(' → ')}`);
  check(ordenRenglones.join(',') === '129,127,126,999',
    'Los postes salen en el ORDEN del trazado (ni por id ni por geometría)',
    ordenRenglones.join(','));
  check(el3['ffi-postes-ruta'].value.includes('ruta de trazado'),
    'Información avisa de que es la ruta del trazado', el3['ffi-postes-ruta'].value);
  check(el3['ffi-route-summary'].innerHTML.includes('orden de trazado'),
    'El resumen de la pestaña lo indica');
  check(lista3.includes('sin medida'),
    'El poste que ya no existe se muestra sin medida y no rompe el panel');
  check(!lista3.includes('undefined') && !lista3.includes('NaN'),
    'Ningún renglón queda con undefined/NaN');

  console.log('\n' + '='.repeat(74));
  console.log(`RESULTADO: ${RESULTADO.ok} comprobaciones OK, ${RESULTADO.fallos.length} fallos`);
  RESULTADO.fallos.forEach((f) => console.log(`  - ${f}`));
  console.log('='.repeat(74));
  return RESULTADO.fallos.length ? 1 : 0;
}

main().then((codigo) => { process.exitCode = codigo; }).catch((e) => {
  console.error('La prueba se cayó:', e);
  process.exitCode = 1;
});
