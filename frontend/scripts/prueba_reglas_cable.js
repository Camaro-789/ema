/**
 * prueba_reglas_cable.js
 *
 * Prueba de la PLANTILLA DE CABLE por estructura (con buffer / drop):
 *
 *   1. Las reglas puras (js/ftth-cable-reglas.js): qué se acepta y qué no.
 *   2. Paridad con el backend: las tablas del JS y las de
 *      backend/app/models/ftth_logica.py tienen que ser las MISMAS.
 *   3. Casos reales del pedido: 1 buffer × 12 hilos, 4 looses × 3 fibras,
 *      drop de 2/4 hilos, y lo que NO se puede crear (7 hilos, 100/3...).
 *   4. La tarjeta visual: el drop va PLANO (sin franja de buffer) incluso con
 *      6 u 8 hilos, y el cable con buffer dibuja sus buffers.
 *   5. Que el formulario de tipos esté cableado a estas reglas (fibras por loose
 *      calculado, looses/perfil solo con buffer, total de hilos en un select).
 *
 * Uso (desde frontend/):
 *     node scripts/prueba_reglas_cable.js
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
    if (detalle !== undefined) console.log(`          ${String(detalle).slice(0, 400)}`);
  }
}

const RAIZ = path.join(__dirname, '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

// ── Carga de los módulos JS (sin navegador) ─────────────────────────────────
function cargarReglas() {
  const codigo = leer(path.join('js', 'ftth-cable-reglas.js'));
  const windowObj = {};
  const fabrica = new Function('window', `${codigo}\nreturn window.FTTHCableReglas;`);
  return { reglas: fabrica(windowObj), windowObj };
}

function crearElemento(tag) {
  const clases = new Set();
  return {
    tag,
    id: '',
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    dataset: {},
    classList: {
      contains: (c) => clases.has(c),
      add: (...cs) => cs.forEach((c) => clases.add(c)),
      remove: (...cs) => cs.forEach((c) => clases.delete(c)),
      toggle: (c, a) => { if (a) clases.add(c); else clases.delete(c); return clases.has(c); },
    },
    appendChild: (h) => h,
    addEventListener() {},
  };
}

/** Carga colores + registro de plantillas + la tarjeta de fibra. */
function cargarPlantillasVisuales() {
  const codigo = [
    leer(path.join('js', 'ftth-colores.js')),
    leer(path.join('js', 'ftth-plantillas.js')),
    leer(path.join('js', 'plantillas-visuales', 'fibra.js')),
  ].join('\n;\n');
  const windowObj = { addEventListener() {} };
  const documentStub = {
    addEventListener() {},
    getElementById: () => null,
    createElement: (tag) => crearElemento(tag),
    body: { appendChild() {} },
  };
  const fabrica = new Function('window', 'document', 'console',
    `${codigo}\nreturn { plantillas: window.FTTHPlantillas, fibra: window.FTTHPlantillaFibra };`);
  return { api: fabrica(windowObj, documentStub, console), windowObj };
}


// ── Prueba ──────────────────────────────────────────────────────────────────
function main() {
  console.log('='.repeat(74));
  console.log('PRUEBA — plantilla de cable: con buffer / drop');
  console.log('='.repeat(74));

  const { reglas: R } = cargarReglas();
  const tiposJs = leer(path.join('js', 'ftth-tipos.js'));
  const logicaPy = leer(path.join('..', 'backend', 'app', 'models', 'ftth_logica.py'));

  console.log('\n1) Reglas puras (js/ftth-cable-reglas.js)');
  check(!!R && typeof R.normalizar === 'function', 'El módulo se carga y expone normalizar()');
  check(R.ESTRUCTURAS.length === 2, 'Ofrece dos estructuras', R.ESTRUCTURAS.map(e => e.v).join(','));
  check(R.ESTRUCTURAS[0].v === 'con_buffer' && R.ESTRUCTURAS[1].v === 'drop',
    'Son «con buffer» y «drop (sin buffer)»');

  console.log('\n2) Con buffer: la división tiene que ser EXACTA');
  const uno = R.normalizar({ estructura: 'con_buffer', looses: 1, fibras: 12, perfil: 'eia598a' });
  check(uno.ok && uno.props.fibrasLoose === 12, '1 buffer × 12 hilos = 12 hilos por buffer', uno.error);
  check(uno.props.plantilla_visual === 'fibra_cable', 'Guarda la plantilla visual con buffer',
    uno.props.plantilla_visual);

  const cuatro = R.normalizar({ estructura: 'con_buffer', looses: 4, fibras: 12, perfil: 'eia598a' });
  check(cuatro.ok && cuatro.props.fibrasLoose === 3,
    '4 looses × 3 fibras por loose = 12 hilos', cuatro.error);

  const conBuffer = R.normalizar({ estructura: 'con_buffer', looses: 12, fibras: 144, perfil: 'eia598a' });
  check(conBuffer.ok && conBuffer.props.fibrasLoose === 12, '144 hilos en 12 looses = 12 por loose');

  const noDivisible = R.normalizar({ estructura: 'con_buffer', looses: 3, fibras: 100, perfil: 'eia598a' });
  check(!noDivisible.ok && /no se reparten/.test(noDivisible.error),
    '100 fibras entre 3 looses se RECHAZA (sobra 1)', noDivisible.error);

  const fueraPerfil = R.normalizar({ estructura: 'con_buffer', looses: 12, fibras: 288, perfil: 'eia598a' });
  check(!fueraPerfil.ok && /superan el máximo de 12/.test(fueraPerfil.error),
    '288 en 12 looses (24 por buffer) se rechaza con perfil EIA598-A', fueraPerfil.error);

  const abnt = R.normalizar({ estructura: 'con_buffer', looses: 12, fibras: 288, perfil: 'abnt' });
  check(abnt.ok && abnt.props.fibrasLoose === 24,
    'Con perfil ABNT (hasta 24 por buffer) sí se acepta', abnt.error);

  const sinLooses = R.normalizar({ estructura: 'con_buffer', looses: 0, fibras: 12 });
  check(!sinLooses.ok, 'Un cable con buffer sin looses se rechaza', sinLooses.error);
  const muchosLooses = R.normalizar({ estructura: 'con_buffer', looses: 97, fibras: 97 });
  check(!muchosLooses.ok && /máximo es 96/.test(muchosLooses.error),
    'Más de 96 looses se rechaza', muchosLooses.error);

  console.log('\n3) Drop: sin buffer y solo tamaños de mercado');
  const drop4 = R.normalizar({ estructura: 'drop', fibras: 4, perfil: 'eia598a', looses: 9 });
  check(drop4.ok && drop4.props.looses === 1, 'El drop se guarda con looses = 1 (interno)', drop4.error);
  check(drop4.props.fibrasLoose === 4, 'Fibras por loose = total de hilos (sin agrupación)');
  check(drop4.props.perfil === undefined, 'El drop no guarda perfil de buffer');
  check(drop4.props.plantilla_visual === 'fibra_cable_drop',
    'Guarda la plantilla visual PLANA del drop', drop4.props.plantilla_visual);
  check(R.HILOS_DROP.join(',') === '1,2,4,6,8', 'Los totales válidos son 1, 2, 4, 6 y 8');
  check(R.normalizar({ estructura: 'drop', fibras: 7 }).ok === false, 'Un drop de 7 hilos se rechaza');
  check(R.normalizar({ estructura: 'drop', fibras: 15 }).ok === false, 'Un drop de 15 hilos se rechaza');
  check(R.normalizar({ estructura: 'drop' }).ok === false, 'Un drop sin total se rechaza');
  check(R.normalizar({ estructura: 'drop', fibras: 8 }).props.fibrasLoose === 8,
    'Un drop de 8 hilos guarda 8 fibras por loose (interno)');

  console.log('\n4) Estructura desconocida y utilidades');
  check(R.normalizar({ estructura: 'otra', fibras: 12 }).ok === false,
    'Una estructura que no existe se rechaza');
  check(R.fibrasPorBuffer(12, 4) === 3, 'fibrasPorBuffer(12, 4) = 3');
  check(R.fibrasPorBuffer(100, 3) === null, 'fibrasPorBuffer devuelve null si no es exacta');
  check(/4 buffer\(es\) × 3/.test(R.describir({ estructura: 'con_buffer', looses: 4, fibras: 12 })),
    'describir() resume el envase del cable');
  check(/sin buffer/.test(R.describir({ estructura: 'drop', fibras: 2 })),
    'describir() avisa que un drop va sin buffer');


  console.log('\n5) Paridad con el backend (misma fuente de verdad)');
  const py = {};
  ['ESTRUCTURA_CON_BUFFER', 'ESTRUCTURA_DROP', 'MAX_LOOSES_CABLE', 'LOOSES_DROP'].forEach((k) => {
    const m = logicaPy.match(new RegExp(`^${k}\\s*=\\s*(?:"([^"]+)"|(\\d+))`, 'm'));
    py[k] = m ? (m[1] !== undefined ? m[1] : Number(m[2])) : null;
  });
  const bloqueHilos = (logicaPy.match(/^HILOS_DROP\s*=\s*\(([^)]*)\)/m) || [])[1] || '';
  py.hilos = bloqueHilos.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  const bloquePerfil = logicaPy.slice(logicaPy.indexOf('MAX_FIBRAS_POR_BUFFER_POR_PERFIL = {'));
  const bloqueCierre = bloquePerfil.indexOf('}');
  py.perfiles = {};
  ((bloquePerfil.slice(0, bloqueCierre).match(/"(\w+)":\s*(\d+)/g)) || []).forEach((par) => {
    const m = par.match(/"(\w+)":\s*(\d+)/);
    if (m) py.perfiles[m[1]] = Number(m[2]);
  });
  check(py.ESTRUCTURA_CON_BUFFER === R.ESTRUCTURA_CON_BUFFER
    && py.ESTRUCTURA_DROP === R.ESTRUCTURA_DROP,
    'Las claves de estructura son las mismas', `${py.ESTRUCTURA_CON_BUFFER}/${py.ESTRUCTURA_DROP}`);
  check(JSON.stringify(py.hilos) === JSON.stringify(R.HILOS_DROP),
    'Los totales de un drop coinciden', `py=${py.hilos} js=${R.HILOS_DROP}`);
  check(py.MAX_LOOSES_CABLE === R.MAX_LOOSES, 'El máximo de looses coincide',
    `py=${py.MAX_LOOSES_CABLE} js=${R.MAX_LOOSES}`);
  check(py.LOOSES_DROP === R.LOOSES_DROP, 'Los looses de un drop coinciden');
  check(JSON.stringify(py.perfiles) === JSON.stringify(R.MAX_FIBRAS_POR_BUFFER_POR_PERFIL),
    'La tabla de máximos por perfil coincide',
    `py=${JSON.stringify(py.perfiles)} js=${JSON.stringify(R.MAX_FIBRAS_POR_BUFFER_POR_PERFIL)}`);
  check(/PLANTILLA_VISUAL_CABLE\s*=\s*\{/.test(logicaPy)
    && logicaPy.includes('"fibra_cable_drop"'),
    'El backend declara la plantilla visual del drop');

  console.log('\n6) UNA plantilla parametrizada: los 4 casos de la tabla');
  const visual = cargarPlantillasVisuales();
  const { plantillas, fibra } = visual.api;
  check(plantillas.existe('fibra_cable'), 'La plantilla con buffer está registrada');
  check(plantillas.existe('fibra_cable_drop'), 'La plantilla PLANA del drop está registrada');
  check(plantillas.obtener('fibra_cable_drop').meta.categoria === 'cables',
    'La plantilla del drop declara su categoría (cables)');

  // Paleta real del proyecto (para comparar los colores dibujados)
  const NOMBRES = [];
  for (let i = 1; i <= visual.windowObj.FTTHColores.TOTAL; i++) {
    NOMBRES.push(visual.windowObj.FTTHColores.nombre(i));
  }

  const hilosDibujados = (html) => (html.match(/class="strand-dot"/g) || []).length;
  const buffersDibujados = (html) => (html.match(/>BUFFER</g) || []).length;
  const etiquetasDbm = (html) => (html.match(/class="strand-dbm"/g) || []).length;
  const coloresDibujados = (html) =>
    Array.from(html.matchAll(/<g class="strand"[^>]*data-color="([^"]*)"/g)).map((m) => m[1]);

  const CASOS = [
    { nombre: 'DROP 1 hilo',
      datos: { fibras: 1, looses: 1, fibrasLoose: 1, estructura: 'drop' },
      hilos: 1, buffers: 0, colores: ['Azul'] },
    { nombre: 'DROP 4 hilos',
      datos: { fibras: 4, looses: 1, fibrasLoose: 4, estructura: 'drop' },
      hilos: 4, buffers: 0, colores: ['Azul', 'Naranja', 'Verde', 'Marrón'] },
    { nombre: 'con buffer 4x3',
      datos: { fibras: 12, looses: 4, fibrasLoose: 3, estructura: 'con_buffer' },
      hilos: 12, buffers: 4,
      colores: ['Azul', 'Naranja', 'Verde', 'Azul', 'Naranja', 'Verde', 'Azul', 'Naranja', 'Verde', 'Azul', 'Naranja', 'Verde'] },
    { nombre: '144 en 12 looses',
      datos: { fibras: 144, looses: 12, fibrasLoose: 12, estructura: 'con_buffer' },
      hilos: 144, buffers: 12, colores: null },
  ];

  CASOS.forEach((caso) => {
    const html = fibra.render(Object.assign({ nombre: caso.nombre }, caso.datos));
    const h = hilosDibujados(html);
    const b = buffersDibujados(html);
    const colores = coloresDibujados(html);
    const dbm = etiquetasDbm(html);
    console.log(`        ${caso.nombre.padEnd(20)} hilos dibujados=${String(h).padStart(3)}  buffers=${b}  etiquetas dBm=${dbm}`);
    check(h === caso.hilos, `${caso.nombre}: dibuja ${caso.hilos} hilos`, `dibujados=${h}`);
    check(b === caso.buffers, `${caso.nombre}: dibuja ${caso.buffers} buffer(es)`, `dibujados=${b}`);
    check(colores.length === caso.hilos, `${caso.nombre}: un color por hilo`,
      `colores=${colores.length}`);
    // La potencia va en CADA punta, dentro del mismo bucle que la línea y el punto
    check(dbm === caso.hilos, `${caso.nombre}: cada punta lleva su etiqueta de dBm`,
      `etiquetas=${dbm}`);
    check((html.match(/>— dBm<\/text>/g) || []).length === caso.hilos,
      `${caso.nombre}: sin medida la etiqueta dice «— dBm» (nunca se inventa)`,
      (html.match(/>— dBm<\/text>/g) || []).length);
    if (caso.colores) {
      check(JSON.stringify(colores) === JSON.stringify(caso.colores),
        `${caso.nombre}: los colores son los TIA-598 que tocan`, colores.join(' '));
    }
    if (caso.buffers === 0) {
      check(!/>BUFFER</.test(html), `${caso.nombre}: sin franja de buffer`);
      check(html.includes('DROP (sin buffer)'), `${caso.nombre}: se rotula sin buffer`);
    }
  });

  // El caso grande: el primer buffer lleva los 12 colores y el 2º reinicia en Azul
  const html144 = fibra.render({ nombre: '144', fibras: 144, looses: 12, fibrasLoose: 12, estructura: 'con_buffer' });
  const col144 = coloresDibujados(html144);
  check(col144.slice(0, 12).join(',') === NOMBRES.join(','),
    '144: el primer buffer lleva los 12 colores de la norma', col144.slice(0, 12).join(','));
  check(col144[12] === 'Azul' && col144[143] === 'Aguamarina',
    '144: cada buffer reinicia el ciclo (buffer 12 acaba en Aguamarina)', col144[12]);

  console.log('\n7) Regresión del bug y reglas de respaldo');
  const sinDatos = fibra.render({ nombre: 'Tipo sin hilos' });
  check(!/class="strand/.test(sinDatos),
    'REGRESIÓN: sin hilos declarados NO se dibuja ningún hilo (ni 12)', sinDatos.slice(0, 160));
  check(sinDatos.includes('pv-fibra__aviso'), 'Sin hilos declarados la tarjeta AVISA (decisión b)');
  check(!/class="strand/.test(fibra.render({ fibras: 0, estructura: 'con_buffer' })),
    'Con fibras = 0 tampoco se inventa nada');
  check(fibra.render({ fibras: 1, estructura: 'drop' }).match(/class="strand-dot"/g).length === 1,
    'REGRESIÓN: un tipo de 1 hilo dibuja 1 hilo, no 12');

  const repartoSinLoose = fibra.repartirHilos({ hilos: 12, looses: 4, estructura: 'con_buffer' });
  check(repartoSinLoose.length === 4 && repartoSinLoose.every((c) => c.hilos === 3),
    '(a) sin fibrasLoose se reparte total ÷ looses', JSON.stringify(repartoSinLoose));
  const unico = fibra.repartirHilos({ hilos: 12, estructura: 'con_buffer' });
  check(unico.length === 1 && unico[0].hilos === 12,
    '(a) sin looses ni fibrasLoose: un solo contenedor con todos los hilos');
  check(fibra.repartirHilos({ hilos: 0, estructura: 'con_buffer' }).length === 0,
    'sin hilos no hay contenedores');
  check(fibra.repartirHilos({ hilos: 100, looses: 3, fibrasLoose: 40, estructura: 'con_buffer' })
    .reduce((n, c) => n + c.hilos, 0) === 100,
    'el reparto nunca dibuja más hilos de los que declara el tipo');

  const conReales = fibra.render({
    fibras: 2, estructura: 'drop',
    hilosReales: [{ color_hex: '#EF4444', color: 'Rojo', estado: 'reservado' },
                  { color_hex: '#1E90FF', color: 'Azul', estado: 'libre' }],
  });
  check(conReales.includes('#EF4444') && conReales.includes('reservado'),
    'Si llegan los hilos reales de la BD, mandan su color y su estado');

  check(plantillas.resolverTipo({ categoria: 'cables', propiedades: { plantilla_visual: 'fibra_cable_drop' } })
    === 'fibra_cable_drop', 'El tipo resuelve su plantilla visual por lo que declara');
  check(plantillas.resolverTipo({ categoria: 'cables', propiedades: {} }) === 'fibra_cable',
    'Sin plantilla declarada cae al respaldo por categoría');
  check(fibra.esDrop(6, 'drop') === true && fibra.esDrop(6, 'con_buffer') === false,
    'La estructura manda sobre el criterio antiguo de ≤ 4 hilos');

  console.log('\n8) La potencia de cada punta: MEDIDO manda, si no TEÓRICO');
  const conMedida = fibra.render({
    fibras: 2, estructura: 'drop',
    hilosReales: [
      { color_hex: '#EF4444', color: 'Rojo', estado: 'reservado', otdr_dbm: -12.345, teorica_dbm: -10.0 },
      { color_hex: '#1E90FF', color: 'Azul', teorica_dbm: -9.5 },
    ],
  });
  const dbms = Array.from(conMedida.matchAll(/<text class="strand-dbm"[^>]*>([^<]*)<\/text>/g))
    .map((m) => m[1]);
  console.log(`        etiquetas: ${dbms.join('   |   ')}`);
  check(dbms[0] === '-12.35 dBm', 'Con medida (OTDR) manda la MEDIDA', dbms[0]);
  check(dbms[1] === '-9.50 dBm', 'Sin medida se usa la TEÓRICA', dbms[1]);
  check(conMedida.includes('data-dbm-origen="medido"') && conMedida.includes('data-dbm-origen="teorico"'),
    'El origen de cada valor queda registrado en el dato (medido / teorico)');
  // Los tres elementos de cada hilo salen de la MISMA iteración del bucle
  const grupos = conMedida.match(/<g class="strand"[\s\S]*?<\/g>/g) || [];
  check(grupos.length === 2, 'Dos grupos de hilo (uno por hilo)', `grupos=${grupos.length}`);
  check(grupos.every((g) => g.includes('strand-line') && g.includes('strand-dot') && g.includes('strand-dbm')),
    'Cada iteración produce línea + punto + etiqueta de dBm juntos');
  check(fibra.potenciaDeHilo({ otdr_dbm: null, teorica_dbm: 1.234 }).origen === 'teorico',
    'potenciaDeHilo() cae a la teórica cuando no hay medida');
  check(fibra.potenciaDeHilo({}).valor === null, 'Sin ningún dato no inventa potencia');
  check(fibra.fDbm(null) === '— dBm' && fibra.fDbm(-3.456) === '-3.46 dBm',
    'fDbm() formatea a 2 decimales o pone «— dBm»');

  console.log('\n9) Modo eliminar del diagrama: una fibra NO es un dispositivo');
  const caja = fibra.render({ id: 150, cable_id: 150, nombre: 'ADSS 12', fibras: 12, looses: 1, fibrasLoose: 12, estructura: 'con_buffer' });
  check(caja.includes('data-borrar="cable:150"'),
    'La tarjeta se marca con el id del CABLE (cable:150)',
    (caja.match(/data-borrar="[^"]*"/) || [''])[0]);
  check(!caja.includes('data-borrar="dispositivo:'),
    'NUNCA manda el id del cable al endpoint de dispositivos (ese era el error de borrado)');
  check(caja.includes('data-cable-id="150"'),
    'data-cable-id sigue siendo el id del cable (Propiedades de fibra)');
  const sinId = fibra.render({ nombre: 'sin id', fibras: 2, estructura: 'drop' });
  check(!sinId.includes('data-borrar='),
    'Sin id de cable no se emite data-borrar (no hay nada que borrar)');
  const soloId = fibra.render({ id: 99, nombre: 'solo id', fibras: 2, estructura: 'drop' });
  check(soloId.includes('data-borrar="cable:99"'),
    'Prefiere cable_id y, si no viene, cae al id — siempre como cable:',
    (soloId.match(/data-borrar="[^"]*"/) || [''])[0]);

  console.log('\n7) Formulario de tipos cableado a las reglas');
  check(tiposJs.includes("id: 'estructura'") && tiposJs.includes('OP.estructuraCable'),
    'El formulario de cable tiene el selector de estructura');
  check(tiposJs.includes("type: 'calculo'") && tiposJs.includes('campo-calculado'),
    '«Fibras por loose» es un campo calculado (no editable)');
  check(/id: 'looses'[^\n]*soloSi: 'conBuffer'/.test(tiposJs),
    'Los looses solo se muestran con buffer');
  check(/id: 'total_hilos'[^\n]*soloSi: 'drop'/.test(tiposJs),
    'El total de hilos (select) solo se muestra en un drop');
  check(tiposJs.includes('hilosDrop: [1, 2, 4, 6, 8]'),
    'El total de un drop es un select cerrado (no se puede escribir 7)');
  check(/id: 'perfil'[^\n]*soloSi: 'conBuffer'/.test(tiposJs),
    'El perfil de fibra se oculta en un drop');
  check(tiposJs.includes('aplicarEstructuraCable') && tiposJs.includes('data-solo-si'),
    'El formulario oculta/muestra los campos al cambiar de estructura');
  check(tiposJs.includes('_reglasCable()') && tiposJs.includes('reglas.normalizar'),
    'Guardar usa las MISMAS reglas que valida el backend');
  check(tiposJs.includes('delete valores.perfil') && tiposJs.includes('delete valores.total_hilos'),
    'El payload se normaliza antes de enviarlo');
  check(tiposJs.includes('datos.total_hilos = datos.fibras'),
    'Al reabrir un drop, su total vuelve al select del formulario');

  console.log('\n8) Cableado de la aplicación');
  const index = leer('index.html');
  check(index.includes('js/ftth-cable-reglas.js'), 'index.html carga el módulo de reglas');
  const posReglas = index.indexOf('js/ftth-cable-reglas.js');
  const posTipos = index.indexOf('js/ftth-tipos.js');
  check(posReglas !== -1 && posTipos !== -1 && posReglas < posTipos,
    'Se carga ANTES de ftth-tipos.js');
  const hilosJs = leer(path.join('js', 'ftth-hilos.js'));
  check(hilosJs.includes('Sin buffer'), 'La pestaña Hilos rotula el drop como «Sin buffer»');
  const logicaRouter = leer(path.join('..', 'backend', 'app', 'routers', 'ftth_logica.py'));
  check(logicaRouter.includes('ETIQUETA_SIN_BUFFER'),
    'El backend marca el contenedor del drop (SIN BUFFER)');
  const tiposRouter = leer(path.join('..', 'backend', 'app', 'routers', 'ftth_tipos.py'));
  check(tiposRouter.includes('logica.normalizar_cable') && tiposRouter.includes('_fusiones_del_tipo'),
    'El catálogo valida en el backend y bloquea el cambio de estructura con fusiones');

  console.log('\n' + '='.repeat(74));
  console.log(`RESULTADO: ${RESULTADO.ok} comprobaciones OK, ${RESULTADO.fallos.length} fallos`);
  RESULTADO.fallos.forEach((f) => console.log(`  - ${f}`));
  console.log('='.repeat(74));
  return RESULTADO.fallos.length ? 1 : 0;
}

process.exitCode = main();


