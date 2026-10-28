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
 *   6. nada de lo anterior rompe el panel (no aparece «undefined»);
 *   7. REGRESIÓN: la geometría que entrega el mapa puede ser un FRAGMENTO de
 *      tesela (recortado y, si el recorte parte la línea, MultiLineString). El
 *      panel usa la geometría CANÓNICA del inventario del proyecto y la ruta
 *      sale COMPLETA igualmente; si no la encuentra, lo AVISA en el panel.
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

/** Cuenta los renglones de poste realmente pintados en «Ruta de fibra» */
function renglonesRuta(dom) {
  const html = (dom.elementos['ffi-route-list'] || {}).innerHTML || '';
  return (html.match(/class="route-item/g) || []).length;
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
  // El inventario REAL que devuelve /api/elementos/todos: los postes Y el cable.
  // El inspector resuelve la geometría del cable por id desde aquí.
  const inventario133 = features.concat([featureCable(133, COORDS_CABLE_133)]);
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
  windowObj.FTTHMapa._currentFeatures = inventario133; // memoria del mapa (con el cable)
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
    '/api/elementos/todos': { type: 'FeatureCollection', features: sinPostes.features.concat([featureCable(200, sinPostes.coords)]) }
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
    '/api/elementos/todos': { type: 'FeatureCollection', features: featuresPostes126a131().concat([featureCable(160, COORDS_CABLE_133)]) }
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

  console.log('\n9) REGRESIÓN: un recorte de tesela NO acorta la ruta');
  // Los eventos de capa de MapLibre devuelven la geometría de LA TESELA bajo el
  // cursor: un trozo recortado del cable (y, si el recorte parte la línea, un
  // MultiLineString). El panel debe resolver la geometría CANÓNICA del inventario
  // por id y mostrar la ruta COMPLETA aunque el fragmento clicado sea corto.
  const FRAGMENTO = COORDS_CABLE_133.slice(0, 8); // llega solo hasta el poste #127

  async function abrirConGeometria(geom, featuresInventario) {
    const d = crearDom();
    const mm = cargarModulo(d, {
      '/api/cables/133/hilos': { cable_id: 133, tubos: [], resumen: {} },
      '/api/elementos/todos': { type: 'FeatureCollection', features: featuresInventario }
    });
    await mm.api.abrir(133, {
      type: 'Feature',
      geometry: geom,
      properties: {
        id: 133, categoria: 'cables', tipo_id: 3, tipo_nombre: 'ADSS 144H',
        propiedades_tipo: {}, propiedades_instancia: {}
      }
    });
    return { dom: d, llamadas: mm.llamadas };
  }

  // 9a) Fragmento LineString (lo normal) con el cable en el inventario → COMPLETA
  const a9 = await abrirConGeometria({ type: 'LineString', coordinates: FRAGMENTO }, inventario133);
  const lista9 = a9.dom.elementos['ffi-route-list'].innerHTML;
  const ids9 = Array.from(lista9.matchAll(/data-poste-id="(\d+)"/g)).map((x) => x[1]);
  console.log(`        fragmento clicado: ${FRAGMENTO.length} vértices (≈2 postes)  ` +
    `→ ruta pintada: ${ids9.join(' → ')}`);
  check(ids9.length === 6, 'Con un fragmento clicado la ruta sale COMPLETA (6 postes)', ids9.join(','));
  check(ids9.join(',') === '126,127,128,129,130,131',
    'Los 6 postes salen en orden de recorrido (no solo los del fragmento)', ids9.join(','));
  const largo9 = parseFloat(a9.dom.elementos['ffi-longitud'].value);
  check(largo9 > 155,
    'La longitud es la del cable COMPLETO, no la del fragmento (≈28 m)', a9.dom.elementos['ffi-longitud'].value);
  check(!lista9.includes('puede estar recortada'),
    'Con la geometría canónica NO se muestra ningún aviso', lista9.slice(0, 120));

  // 9b) Fragmento MultiLineString (el recorte partió la línea) → también COMPLETA
  const a9b = await abrirConGeometria({ type: 'MultiLineString', coordinates: [FRAGMENTO] }, inventario133);
  check(renglonesRuta(a9b.dom) === 6,
    'Un MultiLineString de la tesela tampoco rompe la ruta (ya no sale vacía)',
    renglonesRuta(a9b.dom));
  check(parseFloat(a9b.dom.elementos['ffi-longitud'].value) > 155,
    'Y su longitud vuelve a ser la del cable completo', a9b.dom.elementos['ffi-longitud'].value);

  // 9c) Sin el cable en el inventario → se degrada al fragmento PERO AVISA
  const a9c = await abrirConGeometria({ type: 'LineString', coordinates: FRAGMENTO }, featuresPostes126a131());
  const lista9c = a9c.dom.elementos['ffi-route-list'].innerHTML;
  const ids9c = Array.from(lista9c.matchAll(/data-poste-id="(\d+)"/g)).map((x) => x[1]);
  check(ids9c.length === 2, 'Sin inventario se usa el fragmento (2 postes) como último respaldo',
    ids9c.join(','));
  check(a9c.dom.elementos['ffi-route-summary'].innerHTML.includes('puede estar recortada'),
    'Y AVISA en el resumen de que la geometría puede estar recortada (no falla en silencio)',
    a9c.dom.elementos['ffi-route-summary'].innerHTML.slice(0, 220));

  // 9d) Sin feature y con la API del elemento caída, pero con el inventario → COMPLETA
  const dom9d = crearDom();
  const m9d = cargarModulo(dom9d, {
    '/api/cables/133/hilos': { cable_id: 133, tubos: [], resumen: {} },
    '/api/elementos/todos': { type: 'FeatureCollection', features: inventario133 }
  });
  await m9d.api.abrir(133);  // sin featureObj: intenta GET /api/elementos/133 (el stub no lo sirve)
  check(renglonesRuta(dom9d) === 6,
    'Con el inventario cargado la ruta sale completa aunque falle GET /api/elementos/{id}',
    renglonesRuta(dom9d));
  check(m9d.llamadas.some((c) => c.url.includes('/api/elementos/133')),
    'Se intentó el respaldo por API del elemento');

  // 9e) Sin feature y SIN el cable en el inventario → lo DICE (antes: ruta muda)
  const dom9e = crearDom();
  const m9e = cargarModulo(dom9e, {
    '/api/cables/133/hilos': { cable_id: 133, tubos: [], resumen: {} },
    '/api/elementos/todos': { type: 'FeatureCollection', features: featuresPostes126a131() }
  });
  await m9e.api.abrir(133);
  const lista9e = dom9e.elementos['ffi-route-list'].innerHTML;
  check(m9e.llamadas.some((c) => c.url.includes('/api/elementos/133')),
    'Sin feature se pidió la fibra por id (respaldo por API)');
  check(lista9e.includes('No se encontró la geometría de la fibra #133'),
    'Si no hay geometría por ningún lado lo DICE en el panel (no falla en silencio)',
    lista9e.slice(0, 200));
  check(!lista9e.includes('undefined') && !lista9e.includes('NaN'),
    'El aviso no arrastra undefined/NaN', lista9e.slice(0, 200));

  // 9f) Utilidades de geometría (MultiLineString: la parte MÁS LARGA, sin inventar tramos)
  const corta = [[-72.2268, 7.7649], [-72.2268, 7.76491]];
  const elegida = api.coordsDeTrazado({ type: 'MultiLineString', coordinates: [corta, FRAGMENTO] });
  check(elegida.length === FRAGMENTO.length,
    'coordsDeTrazado() toma la parte más larga del MultiLineString', elegida.length);
  check(api.coordsDeTrazado({ type: 'LineString', coordinates: FRAGMENTO }).length === FRAGMENTO.length,
    'coordsDeTrazado() devuelve un LineString tal cual');
  check(api.coordsDeTrazado({ type: 'Point', coordinates: [0, 0] }).length === 0,
    'coordsDeTrazado() rechaza un Point (devuelve vacío, no rompe)');
  check(api.coordsDeTrazado(null).length === 0, 'coordsDeTrazado() sin geometría devuelve vacío');
  check(api.esTrazadoLineal({ type: 'MultiLineString', coordinates: [] }) === true,
    'esTrazadoLineal() acepta MultiLineString');
  check(api.esTrazadoLineal({ type: 'Point', coordinates: [0, 0] }) === false,
    'esTrazadoLineal() rechaza Point');

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
