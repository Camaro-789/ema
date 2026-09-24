/**
 * prueba_render_splitter.js
 *
 * Carga en un DOM simulado: ftth-colores.js + ftth-plantillas.js +
 * plantillas-visuales/splitter.js + ftth-diagrama.js, y verifica que
 *
 *   1. los cuatro módulos se registran en window como manda el proyecto;
 *   2. la plantilla 'splitter_1x8' queda registrada en FTTHPlantillas;
 *   3. la tarjeta dibuja la estructura visual de referencia (cabecera,
 *      entrada IN, tabla de salidas, pie) con clases .pv-splitter__*;
 *   4. los colores de los puertos son EXACTAMENTE los TIA-598-C del backend,
 *      en orden, y que un color_hex explícito manda sobre el de posición;
 *   5. no hay valores fijos: dos juegos de datos distintos dan HTML distinto;
 *   6. no se cuela ningún «undefined», «NaN» ni title="" (lo que ya vigila
 *      prueba_render_diagrama.js para el diagrama completo);
 *   7. el diagrama real inserta la tarjeta dentro de #diag-body y la tarjeta
 *      clásica de dispositivos sigue intacta.
 *
 * Uso (desde frontend/):
 *     node scripts/prueba_render_splitter.js
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

// Los 8 primeros colores TIA-598-C, tal como los define el backend en
// app/models/ftth_logica.py (TIA598_HEX).
const TIA598_8 = [
  '#1E90FF', '#FF8C00', '#22C55E', '#8B4513',
  '#708090', '#F1F5F9', '#EF4444', '#111111',
];

function coloresPintados(html) {
  const salida = [];
  const re = /--pv-color:(#[0-9A-Fa-f]{6})/g;
  let m = re.exec(html);
  while (m) {
    salida.push(m[1].toUpperCase());
    m = re.exec(html);
  }
  return salida;
}

// ── DOM simulado ────────────────────────────────────────────────────────────
function crearElemento(id) {
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
      toggle: (c, activo) => {
        if (activo === undefined) {
          if (clases.has(c)) clases.delete(c); else clases.add(c);
        } else if (activo) clases.add(c); else clases.delete(c);
        return clases.has(c);
      },
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    closest: () => null,
    _clases: clases,
  };
}

function crearDom() {
  const elementos = {};
  const ids = ['ftth-diagrama-modal', 'diag-body', 'diag-pie', 'diag-title', 'diag-badge',
    'diag-mark', 'diag-sub', 'diag-btn-close', 'diag-btn-reload', 'element-properties-modal',
    'diag-identity-name', 'diag-identity-code',
    'diag-splitter-picker', 'btn-diag-confirm-splitter', 'diag-select-splitter'];
  ids.forEach((id) => { elementos[id] = crearElemento(id); });
  // El <select> del selector de tipo: el primero de la lista queda elegido.
  elementos['diag-select-splitter'].value = '39';
  elementos['ftth-diagrama-modal'].classList.add('hidden');
  return {
    elementos,
    document: {
      getElementById: (id) => elementos[id] || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => crearElemento(tag),
      addEventListener() {},
    },
  };
}

function cargarTodo(dom, payload, extra) {
  const e = extra || {};
  const codigo = [
    leer('ftth-tipos.js'),
    leer('ftth-colores.js'),
    leer('ftth-plantillas.js'),
    leer(path.join('plantillas-visuales', 'splitter.js')),
    leer('ftth-diagrama.js'),
  ].join('\n;\n');

  const windowObj = {
    location: { origin: 'http://prueba.local' },
    FTTHIconos: { imgHtml: (cat) => `<img src="assets/icons/${cat}.svg" alt="${cat}">` },
  };
  Object.assign(windowObj, e.window || {});
  const fetchStub = e.fetch || (async (url) => ({ ok: true, status: 200, url, json: async () => payload }));

  const fabrica = new Function('window', 'document', 'fetch', 'console', 'setTimeout',
    `${codigo}
return {
  diagrama: window.FTTHDiagrama,
  colores: window.FTTHColores,
  plantillas: window.FTTHPlantillas,
  splitter: window.FTTHPlantillaSplitter,
  tipos: window.FTTHTipos,
};`);

  return { api: fabrica(windowObj, dom.document, fetchStub, console, (fn) => fn()), windowObj };
}

// ── Datos de prueba: el DTO de GET /api/elementos/{id}/nodo ─────────────────
function payloadNodo(opts) {
  const o = opts || {};

  const puertos = [{
    id: 100, dispositivo_id: 1, etiqueta: 'IN-1', direccion: 'in', estado: 'ocupado',
    tipo_conector: 'SC/APC', potencia_dbm: null, otdr_dbm: null, color: '', color_hex: '',
  }];

  for (let i = 1; i <= 8; i += 1) {
    const preferido = o.colorExplicito && i === 1;
    puertos.push({
      id: 100 + i,
      dispositivo_id: 1,
      etiqueta: `OUT-${i}`,
      direccion: 'out',
      estado: i <= 3 ? 'libre' : 'ocupado',
      tipo_conector: 'SC/APC',
      potencia_dbm: null,
      otdr_dbm: null,
      color: preferido ? 'Rojo' : '',
      color_hex: preferido ? '#EF4444' : '',
    });
  }

  if (o.conAdaptador) {
    for (let i = 1; i <= 12; i += 1) {
      puertos.push({
        id: 200 + i,
        dispositivo_id: 2,
        direccion: 'BIDI',
        puerto_no: i,
        etiqueta: `BIDI-${i}`,
        tipo_conector: 'SC/APC',
        estado: 'libre',
        cliente: null,
      });
    }
  }

  const dispositivos = [{
    id: 1, tipo: 'splitter', tipo_id: 7, division: '1x8', serie: 'SN-PRUEBA-001',
    puertos_in: 1, puertos_out: 8, atenuacion_db: 10.7, bandeja_id: null, estado: 'operativo',
  }];
  if (o.conAdaptador) {
    dispositivos.push({
      id: 2, tipo: 'adaptador', tipo_id: null, division: null, serie: null,
      puertos_in: 0, puertos_out: 12, atenuacion_db: 0.3, bandeja_id: null, estado: 'operativo',
    });
  }

  return {
    nodo: {
      box_id: 23, categoria: 'cajanap', tipo_nombre: 'Caja NAP 16P', estado: 'Activo',
      conmuta_hilos: true, capacidad_puertos: 16,
      propiedades_tipo: { plantilla_visual: 'splitter_1x8' },
      propiedades_instancia: {},
    },
    bandejas: [],
    dispositivos,
    puertos,
    hilos_que_terminan: [],
    resumen: {
      bandejas: 0, slots_totales: 0, slots_ocupados: 0, dispositivos: dispositivos.length,
      puertos: puertos.length, puertos_libres: 3, hilos_anclados: 0, empalmes: 0,
    },
    advertencias: [],
  };
}

async function main() {
  console.log('='.repeat(74));
  console.log('PRUEBA DE RENDER — plantilla visual del splitter 1x8');
  console.log('='.repeat(74));

  const dom = crearDom();
  const { api, windowObj } = cargarTodo(dom, payloadNodo());

  console.log('\n1) Módulos y registro central');
  check(!!api.colores && !!api.plantillas && !!api.splitter && !!api.diagrama,
    'Se cargan los cuatro módulos');
  check(windowObj.FTTHColores === api.colores, 'ftth-colores.js expone window.FTTHColores');
  check(windowObj.FTTHPlantillas === api.plantillas, 'ftth-plantillas.js expone window.FTTHPlantillas');
  check(windowObj.FTTHPlantillaSplitter === api.splitter, 'splitter.js expone window.FTTHPlantillaSplitter');
  check(api.plantillas.existe('splitter_1x8'),
    'Queda registrada con la clave plantilla_visual = splitter_1x8');
  check(api.plantillas.obtener('splitter_1x8').meta.categoria === 'splitter',
    'La plantilla declara su categoría (splitter)');
  check(api.plantillas.clavesDeCategoria('splitter').includes('splitter_1x8'),
    'El registro la puede listar por categoría');

  console.log('\n2) Paleta TIA-598 compartida (una sola fuente)');
  check(api.colores.TOTAL === 12, 'La paleta tiene 12 posiciones');
  check(api.colores.hex(1) === '#1E90FF' && api.colores.nombre(1) === 'Azul', 'Posición 1 = Azul');
  check(api.colores.hex(13) === api.colores.hex(1), 'Cicla cada 12 posiciones (13 → 1)');
  check(api.colores.hexPorNombre('marron') === '#8B4513', 'Acepta el nombre sin tilde (marron)');
  check(api.colores.nombrePorHex('#ef4444') === 'Rojo', 'Reconoce el nombre a partir del hex');

  console.log('\n3) Estructura visual de la tarjeta (del .htm, sin valores fijos)');
  const base = payloadNodo();
  const datos = api.plantillas.datosSplitter(base.dispositivos[0], base.puertos, 'Splitter PLC');
  const html = api.splitter.render(datos);
  check(html.startsWith('<div class="pv-splitter'), 'Raíz .pv-splitter con su estado de color');
  check(html.includes('pv-splitter__cab') && html.includes('pv-splitter__titulo')
    && html.includes('pv-splitter__icono'), 'Cabecera con ícono y textos');
  check(html.includes('pv-splitter__badge') && html.includes('1 : 8'), 'Badge con la división (1 : 8)');
  check(html.includes('pv-splitter__entrada') && html.includes('pv-splitter__in-label')
    && html.includes('IN-1'), 'Sección de entrada con la etiqueta del puerto (IN-1)');
  check(html.includes('pv-splitter__thead') && html.includes('Teórica') && html.includes('OTDR'),
    'Cabecera de la tabla (Teórica / OTDR)');
  check((html.match(/class="pv-splitter__fila"/g) || []).length === 8, 'Dibuja las 8 filas de salida');
  check(html.includes('data-borrar="dispositivo:1"'),
    'La tarjeta lleva data-borrar (se puede borrar desde el diagrama)');
  check(html.includes('pv-splitter__pie') && html.includes('pv-splitter__pie-tag'), 'Pie de la tarjeta');
  check(html.includes('pv-boton-paleta'), 'Botón para alternar colores norma / neutro');
  check(html.includes('Splitter PLC'), 'El nombre sale de los datos');
  check(html.includes('Atenuación') && html.includes('10.70 dB'), 'La atenuación sale de los datos');
  check(/<strong>8<\/strong> puertos/.test(html), 'El pie cuenta los puertos de los datos');
  check(html.includes('S/N SN-PRUEBA-001'), 'La serie sale en el subtítulo (S/N)');
  check(/<strong>3<\/strong> libres/.test(html), 'El pie cuenta los puertos libres');
  check(html.includes('— dBm'), 'Sin medidas pintadas usa «— dBm» en vez de inventarlas');
  check(html.includes('data-puerto="101"'),
    'Las filas de puerto llevan data-puerto (clic heredado del diagrama)');
  check(html.includes('data-puerto="100"'), 'La entrada IN también es clicable');

  const datosSel = api.plantillas.datosSplitter(
    base.dispositivos[0], base.puertos, 'Splitter', { puertoSeleccionado: 103 }
  );
  const htmlSel = api.splitter.render(datosSel);
  check(htmlSel.includes('pv-splitter__fila--sel'), 'Marca la fila del puerto seleccionado');
  check((htmlSel.match(/pv-splitter__fila--sel/g) || []).length === 1, 'Solo una fila queda marcada');

  console.log('\n4) Colores de puerto = TIA-598-C del backend');
  const pintados = coloresPintados(html);
  check(pintados.length === 8, 'Pinta un color por puerto de salida', `encontrados=${pintados.length}`);
  check(JSON.stringify(pintados) === JSON.stringify(TIA598_8),
    'Son los 8 colores TIA-598-C en orden', pintados.join(' '));

  const conColor = payloadNodo({ colorExplicito: true });
  const htmlRojo = api.splitter.render(
    api.plantillas.datosSplitter(conColor.dispositivos[0], conColor.puertos, 'Splitter')
  );
  const pintadosRojo = coloresPintados(htmlRojo);
  check(pintadosRojo[0] === '#EF4444',
    'Si el puerto trae color_hex, ese manda sobre la posición', pintadosRojo[0]);
  check(pintadosRojo[1] === TIA598_8[1], 'Los demás siguen la posición TIA-598', pintadosRojo[1]);

  console.log('\n5) Sin datos fijos: dos juegos distintos dan HTML distinto');
  const uno = api.splitter.render({
    nombre: 'A', modelo: 'A', relacion: '1 : 16', atenuacion_db: 13.7,
    salidas: Array.from({ length: 16 }, (_, i) => ({ numero: i + 1 })),
  });
  const otro = api.splitter.render({
    nombre: 'B', modelo: 'B', relacion: '2 : 32', atenuacion_db: 16.9,
    salidas: Array.from({ length: 32 }, (_, i) => ({ numero: i + 1 })),
  });
  check(uno !== otro && uno.includes('1 : 16') && otro.includes('2 : 32'),
    'El HTML cambia con los datos (no hay nada clavado)');
  check(coloresPintados(otro).length === 32, '32 puertos → 32 colores (cicla cada 12)');

  console.log('\n6) Casos borde: sin datos y sin puertos');
  const vacio = api.splitter.render({});
  check(vacio.includes('pv-splitter'), 'Sin datos sigue devolviendo una tarjeta válida');
  check(!vacio.includes('undefined') && !vacio.includes('NaN'),
    'Sin datos no se cuela «undefined» ni «NaN»');
  check(!/title=""/.test(vacio), 'Sin datos no queda ningún title vacío');
  check(vacio.includes('no tiene puertos de salida'), 'Sin puertos lo dice en vez de quedar en blanco');
  check(api.splitter.render() === vacio, 'Llamarla sin argumentos no revienta');

  console.log('\n7) Resolución por plantilla_visual (el campo del catálogo)');
  check(api.plantillas.resolverTipo({ categoria: 'splitter' }) === 'splitter_generico',
    'Sin campo declarado cae al fallback por categoría');
  check(api.plantillas.resolverTipo({
    categoria: 'splitter', propiedades: { plantilla_visual: 'no_existe' },
  }) === 'splitter_generico', 'Con una clave inexistente también cae al fallback');
  check(api.plantillas.resolverTipo({
    categoria: 'splitter', propiedades: { plantilla_visual: 'splitter_1x8' },
  }) === 'splitter_1x8', 'Respeta la clave declarada en propiedades.plantilla_visual');
  check(api.plantillas.paraDispositivo({ tipo: 'adaptador' }, []) === '',
    'Sin plantilla aplicable devuelve vacío (la tarjeta clásica se queda)');
  check(api.plantillas.paraDispositivo({ tipo: 'adaptador' }, [], { plantilla_visual: 'splitter_1x8' }) === '',
    'El plantilla_visual del NODO no se filtra a los dispositivos de dentro');
  check(api.plantillas.paraDispositivo({ tipo: 'splitter', division: '1x8' }, []).includes('pv-splitter'),
    'El splitter sí encuentra su plantilla por su propia categoría');

  console.log('\n8) Integración real en el diagrama (#diag-body)');
  const domIntegracion = crearDom();
  const carga = cargarTodo(domIntegracion, payloadNodo({ conAdaptador: true }));
  carga.api.diagrama.abrir(23, { categoria: 'cajanap', tipoNombre: 'Caja NAP 16P' });
  await new Promise((r) => setTimeout(r, 10));
  const body = domIntegracion.elementos['diag-body'].innerHTML;

  check(body.includes('pv-splitter'), 'El diagrama inserta la tarjeta del splitter');
  check(body.includes('diag-dispositivo-vista'), 'La inserta en su hueco dentro del dispositivo');
  check((body.match(/class="diag-dispositivo"/g) || []).length === 1,
    'Solo el dispositivo sin plantilla usa la tarjeta clasica de respaldo');
  check(body.includes('Splitter'), 'La tarjeta lleva el título del dispositivo');
  check(body.includes('data-puerto='), 'La tarjeta insertada conserva los puertos clicables');

  console.log('\n9) Lo que ya funcionaba sigue igual');
  check(body.includes('1 : 8'), 'La división sigue visible, ahora en el badge de la tarjeta nueva');
  check(body.includes('10.70 dB'), 'La atenuación sigue visible, ahora en el pie de la tarjeta nueva');
  check(body.includes('SN-PRUEBA-001'), 'Se conserva la serie');
  check(body.includes('diag-puerto--bidi'),
    'El adaptador conserva sus puertos BIDI en la tarjeta de respaldo');
  check(body.includes('IN-1') && body.includes('OUT-8'), 'Se conservan las etiquetas de puerto');
  check(body.includes('adaptador'), 'El dispositivo sin plantilla se sigue dibujando igual');
  check((body.match(/class="pv-splitter /g) || []).length === 1,
    'Solo el splitter lleva tarjeta visual (el adaptador no)',
    String((body.match(/class="pv-splitter /g) || []).length));

  console.log('\n10) Calidad del HTML generado');
  check(!body.includes('undefined'), 'No aparece «undefined» en el cuerpo del diagrama');
  check(!body.includes('NaN'), 'No aparece «NaN»');
  check(!/title=""/.test(body), 'Ningún atributo title quedó vacío');

  console.log('\n11) Flujo real: agregar splitter y verlo al instante');
  const domFlujo = crearDom();
  let agregado = false;
  const llamadas = { get: 0, post: 0 };
  const fetchFlujo = async (url, opciones) => {
    const metodo = (opciones && opciones.method) || 'GET';
    if (metodo === 'POST') {
      llamadas.post += 1;
      agregado = true;   // el backend ya lo guardo
      return {
        ok: true, status: 200, url,
        json: async () => ({ dispositivo: { id: 9 }, puertos_creados: { IN: 1, OUT: 8 } }),
      };
    }
    llamadas.get += 1;
    const sinDispositivos = () => {
      const p = payloadNodo();
      p.dispositivos = [];
      p.puertos = [];
      return p;
    };
    return {
      ok: true, status: 200, url,
      json: async () => (agregado ? payloadNodo() : sinDispositivos()),
    };
  };
  const cargaFlujo = cargarTodo(domFlujo, null, { fetch: fetchFlujo });
  // El doble de FTTHTipos se pone DESPUES de cargar los modulos: ftth-tipos.js se
  // registra en window al cargarse y pisaria el doble si se pasara antes.
  cargaFlujo.windowObj.FTTHTipos = {
    getTipos: async () => [{ id: 39, nombre_id: 'Splitter 1x8', propiedades: { relacion_division: '1x8' } }],
    showToast: () => {},
  };

  cargaFlujo.api.diagrama.abrir(41, { categoria: 'cajanap', tipoNombre: 'Caja NAP 16P' });
  await new Promise((r) => setTimeout(r, 10));
  const antes = domFlujo.elementos['diag-body'].innerHTML;
  check(!antes.includes('pv-splitter'), 'Antes de agregar no hay ninguna tarjeta de splitter');

  await cargaFlujo.api.diagrama.mostrarModalAgregarSplitter();
  const confirmar = domFlujo.elementos['btn-diag-confirm-splitter'];
  check(typeof confirmar.onclick === 'function',
    'El selector de tipo deja listo el boton de confirmar');
  const opciones = String(domFlujo.elementos['diag-splitter-picker'].innerHTML);
  check(opciones.includes('1x8'),
    'La opcion del selector muestra la division del tipo (no se elige a ciegas)');
  await confirmar.onclick();
  await new Promise((r) => setTimeout(r, 10));

  const despues = domFlujo.elementos['diag-body'].innerHTML;
  check(llamadas.post === 1, 'Se envio un solo POST de dispositivo', `post=${llamadas.post}`);
  check(llamadas.get >= 2, 'Se releyo el nodo para refrescar', `get=${llamadas.get}`);
  check(despues.includes('pv-splitter'),
    'El splitter aparece AL INSTANTE, sin cerrar el diagrama');
  check((despues.match(/class="pv-splitter__fila"/g) || []).length === 8,
    'Aparece ya con sus 8 puertos, sin volver a entrar');
  check(!despues.includes('undefined') && !despues.includes('NaN'),
    'El refresco automatico no ensucia el HTML');

  console.log('\n12) Un solo diseno sirve para cualquier tamano (hasta 1x64)');
  const puertos64 = Array.from({ length: 65 }, (_, k) => ({
    id: 300 + k,
    dispositivo_id: 9,
    direccion: k === 0 ? 'IN' : 'OUT',
    puerto_no: k,
    etiqueta: k === 0 ? 'IN-1' : `OUT-${k}`,
    tipo_conector: 'SC/APC',
    estado: 'libre',
  }));
  const datos64 = api.plantillas.datosSplitter(
    { id: 9, tipo: 'splitter', division: '1x64', puertos_in: 1, puertos_out: 64, atenuacion_db: 20.5 },
    puertos64,
    'Splitter 1x64'
  );
  const html64 = api.splitter.render(datos64);
  check(html64.includes('1 : 64'), 'El badge sale de los datos (1 : 64)');
  check((html64.match(/class="pv-splitter__fila"/g) || []).length === 64,
    'Dibuja las 64 filas de salida', String((html64.match(/class="pv-splitter__fila"/g) || []).length));
  const colores64 = coloresPintados(html64);
  check(colores64.length === 64, 'Pinta 64 colores', String(colores64.length));
  check(colores64[12] === colores64[0], 'El color 13 vuelve a ser el 1 (ciclo TIA-598 de 12)');
  check(/<strong>64<\/strong> puertos/.test(html64), 'El pie cuenta los 64 puertos');
  check(html64.includes('20.50 dB'), 'La atenuacion del 1x64 sale de los datos');
  check(html64.includes('data-borrar="dispositivo:9"'), 'La tarjeta del 1x64 tambien es borrable');
  check(!html64.includes('undefined') && !html64.includes('NaN'), 'Sin undefined ni NaN en 64 filas');

  check(api.plantillas.existe('splitter_generico'), 'La clave generica esta registrada');
  check(api.plantillas.existe('splitter_1x8'), 'La clave 1x8 sigue como alias (compatibilidad)');
  check(api.plantillas.paraDispositivo({ tipo: 'splitter', division: '1x64' }, []).includes('1 : 64'),
    'Un 1x64 del diagrama se pinta con el mismo diseno');
  check(api.plantillas.paraDispositivo({ tipo: 'splitter', division: '1x16' }, []).includes('1 : 16'),
    'Un 1x16 tambien');

  console.log('\n13) Limites de tamano (el 1x64 es el mayor)');
  const tiposJs = leer('ftth-tipos.js');
  check(tiposJs.includes('SPLITTER_MAX_SALIDAS = 64'), 'El catalogo declara el maximo de 64 salidas');
  check(tiposJs.includes('divisionSplitter'), 'El catalogo tabula las divisiones validas (con su dB)');
  check(tiposJs.includes("id: 'division'") && tiposJs.includes('OP.divisionSplitter'),
    'El formulario del splitter pide la DIVISION (un solo campo, sin ambiguedad)');
  check(!tiposJs.includes("id: 'salidas'"),
    'Ya no hay campo numerico de salidas: no se puede dejar vacio por error');
  check(tiposJs.includes('valores.relacion_division = division'),
    'Al guardar, la division se guarda como relacion_division + entradas/salidas');
  check(tiposJs.includes('_ajustarAlLimite'),
    'Un valor fuera de rango se ajusta al limite al guardar (y avisa)');
  const logicaPy = fs.readFileSync(
    path.join(RAIZ_JS, '..', '..', 'backend', 'app', 'routers', 'ftth_logica.py'), 'utf8'
  );
  check(logicaPy.includes('if salidas > logica.MAX_SPLITTER_SALIDAS'),
    'El backend rechaza mas de 64 salidas con 400');
  check(logicaPy.includes('"1x64": 20.5'), 'La atenuacion nominal del 1x64 ya estaba tabulada');
  const modeloPy = fs.readFileSync(
    path.join(RAIZ_JS, '..', '..', 'backend', 'app', 'models', 'ftth_logica.py'), 'utf8'
  );
  check(modeloPy.includes('MAX_SPLITTER_SALIDAS = 64'),
    'El tope vive en el modelo (un solo numero para catalogo y materializacion)');
  const tiposPy = fs.readFileSync(
    path.join(RAIZ_JS, '..', '..', 'backend', 'app', 'routers', 'ftth_tipos.py'), 'utf8'
  );
  check(tiposPy.includes('_validar_propiedades'),
    'El catalogo valida al guardar: un splitter sin division no se guarda');
  check(tiposPy.includes('from app.models.ftth_logica import MAX_SPLITTER'),
    'El catalogo usa el mismo tope del modelo');

  console.log('\n14) Formulario: division, nominal sugerida y al reabrir el tipo');
  const T = api.tipos;
  check(!!T && typeof T.divisionDe === 'function', 'El catalogo expone divisionDe()');
  check(T.divisionDe({ relacion_division: '1x16' }) === '1x16', 'divisionDe lee relacion_division');
  check(T.divisionDe({ entradas: 1, salidas: 32 }) === '1x32', 'divisionDe deduce de entradas/salidas');
  check(T.divisionDe({ relacion_division: '1x8 (10.7 dB)' }) === '1x8',
    'divisionDe acepta el formato antiguo del catalogo');
  check(T.divisionDe({}) === '', 'divisionDe devuelve vacio si el tipo no tiene division');

  check(T.nominalDe('1x16') === 13.7, 'nominalDe(1x16) = 13.7');
  check(T.nominalDe('1x64') === 20.5, 'nominalDe(1x64) = 20.5');
  check(T.nominalDe('9x9') === null, 'nominalDe devuelve null si no esta tabulada');

  // Paridad de la tabla de atenuacion: JS vs Python (misma fuente de verdad).
  const bloquePy = logicaPy.slice(logicaPy.indexOf('ATENUACION_SPLITTER = {'));
  const cierrePy = bloquePy.indexOf('}');
  const paresPy = {};
  ((bloquePy.slice(0, cierrePy).match(/"\d+x\d+":\s*[\d.]+/g)) || []).forEach((par) => {
    const m = par.match(/"(\d+x\d+)":\s*([\d.]+)/);
    if (m) paresPy[m[1]] = Number(m[2]);
  });
  const clavesPy = Object.keys(paresPy).sort();
  check(clavesPy.length >= 6, 'Se leyo la tabla del backend', JSON.stringify(paresPy));
  check(JSON.stringify(clavesPy) === JSON.stringify(Object.keys(T.NOMINAL_SPLITTER).sort()),
    'La tabla JS y la de Python tienen las mismas divisiones',
    `${Object.keys(T.NOMINAL_SPLITTER).sort().join(',')} vs ${clavesPy.join(',')}`);
  const distintas = clavesPy.filter((k) => T.NOMINAL_SPLITTER[k] !== paresPy[k]);
  check(distintas.length === 0, 'Y los mismos valores en dB', distintas.join(','));

  check(tiposJs.includes("onchange: 'FTTHTipos.sugerirAtenuacion(this)'"),
    'Al cambiar la division se sugiere la nominal en el campo');
  check((tiposJs.match(/\{ v: '2x/g) || []).length === 0,
    'El formulario ya no ofrece opciones de entradas (solo 1xN)');
  check(tiposJs.includes('datos.division = division'),
    'Al reabrir un tipo, su division guardada vuelve al formulario');
  check(tiposJs.includes('if (!esEdicion || sinAtenuacion) datos.atenuacion = nominalDe(division)'),
    'Al crear se sugiere la nominal; al editar se respeta la guardada');

  const campoAten = crearElemento('f_atenuacion');
  dom.elementos['f_atenuacion'] = campoAten;
  T.sugerirAtenuacion({ value: '1x32' });
  check(campoAten.value === '16.9', 'sugerirAtenuacion escribe 16.9 al elegir 1x32', campoAten.value);
  T.sugerirAtenuacion({ value: '1x8' });
  check(campoAten.value === '10.7', 'Y 10.7 al elegir 1x8', campoAten.value);

  console.log('\n' + '='.repeat(74));
  console.log(`RESULTADO: ${OK.n} comprobaciones OK, ${OK.fallos.length} fallos`);
  OK.fallos.forEach((f) => console.log(`  - ${f}`));
  console.log('='.repeat(74));
  return OK.fallos.length ? 1 : 0;
}

main().then((codigo) => process.exit(codigo));


