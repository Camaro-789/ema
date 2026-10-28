/**
 * prueba_resolver_plantilla_cable.js
 *
 * Prueba de resolución y render de plantillas visuales de cable (FTTHPlantillas y fibra.js).
 * Verifica que resolverTipo funcione en todas las variantes de entrada (anidadas, planas, DTO)
 * y que datosFibra arme la estructura de render correcta para colHilos.
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

// Entorno simulado
global.window = global;
global.window.addEventListener = () => {};
global.window.removeEventListener = () => {};
global.document = {
  createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, style: {}, classList: { add: () => {}, remove: () => {} } }),
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
};

// Cargar ftth-colores.js
const rutaColores = path.resolve(__dirname, '../js/ftth-colores.js');
eval(fs.readFileSync(rutaColores, 'utf8'));

// Cargar ftth-plantillas.js
const rutaPlantillas = path.resolve(__dirname, '../js/ftth-plantillas.js');
eval(fs.readFileSync(rutaPlantillas, 'utf8'));

// Cargar plantillas-visuales/fibra.js
const rutaFibra = path.resolve(__dirname, '../js/plantillas-visuales/fibra.js');
eval(fs.readFileSync(rutaFibra, 'utf8'));

console.log('=== PRUEBA RESOLUCIÓN Y RENDER DE PLANTILLA DE CABLE ===\n');

// 1. FTTHPlantillas está inicializado y tiene registradas las plantillas de fibra
check(typeof FTTHPlantillas.resolverTipo === 'function', 'FTTHPlantillas.resolverTipo está definido');
check(FTTHPlantillas.existe('fibra_cable'), 'Plantilla «fibra_cable» está registrada');
check(FTTHPlantillas.existe('fibra_cable_drop'), 'Plantilla «fibra_cable_drop» está registrada');

// 2. resolverTipo con formato DB estándar { categoria: 'cables', propiedades: { plantilla_visual: 'fibra_cable' } }
const tipoDb = { categoria: 'cables', propiedades: { plantilla_visual: 'fibra_cable', fibras: 12 } };
check(FTTHPlantillas.resolverTipo(tipoDb) === 'fibra_cable', 'resolverTipo funciona con formato DB estándar (propiedades)');

// 3. resolverTipo con formato DTO { categoria: 'cables', propiedades_tipo: { plantilla_visual: 'fibra_cable_drop' } }
const tipoDto = { categoria: 'cables', propiedades_tipo: { plantilla_visual: 'fibra_cable_drop', fibras: 4 } };
check(FTTHPlantillas.resolverTipo(tipoDto) === 'fibra_cable_drop', 'resolverTipo funciona con formato DTO (propiedades_tipo)');

// 4. resolverTipo con propsTipo de colHilos { categoria: 'cables', propiedades: cable_tipo }
const cableTipoDto = {
  id: 5,
  nombre: 'Cable Troncal 12H',
  plantilla_visual: 'fibra_cable',
  estructura: 'con_buffer',
  fibras: 12,
  looses: 1,
  extremo_A_id: 10,
  extremo_B_id: 20
};
const wrappedColHilos = { categoria: 'cables', propiedades: cableTipoDto };
check(FTTHPlantillas.resolverTipo(wrappedColHilos) === 'fibra_cable', 'resolverTipo funciona con el formato usado por colHilos');

// 5. resolverTipo con objeto plano de propiedades directo (sin anidar)
check(FTTHPlantillas.resolverTipo(cableTipoDto) === 'fibra_cable', 'resolverTipo funciona con objeto plano directo');

// 6. resolverTipo con categoría 'cables' sin plantilla_visual explícita (fallback automático)
const sinPlantilla = { categoria: 'cables', propiedades: { fibras: 24 } };
check(FTTHPlantillas.resolverTipo(sinPlantilla) === 'fibra_cable', 'resolverTipo aplica fallback por categoría «cables» a «fibra_cable»');

// 7. datosFibra genera la estructura visual completa
const datosVisuales = FTTHPlantillas.datosFibra(
  { id: 88, tipo: 'cables', nombre: 'Cable 12H', propiedades_tipo: cableTipoDto },
  [],
  'Cable 12H'
);
check(datosVisuales.fibras === 12, `datosFibra extrajo fibras=12 (obtenido: ${datosVisuales.fibras})`);
check(datosVisuales.estructura === 'con_buffer', `datosFibra extrajo estructura='con_buffer'`);
check(datosVisuales.cable_id === 88, `datosFibra asignó cable_id=88`);

// 8. Render de la tarjeta de fibra con hilos reales
datosVisuales.hilosReales = [
  { fibra_id: 101, cable_id: 88, nombre: 'T01-H01', color: 'Azul', color_hex: '#1E90FF', estado: 'empalmado' },
  { fibra_id: 102, cable_id: 88, nombre: 'T01-H02', color: 'Naranja', color_hex: '#FF8C00', estado: 'libre' }
];
const cardHtml = FTTHPlantillas.render('fibra_cable', datosVisuales);
check(typeof cardHtml === 'string' && cardHtml.length > 50, 'FTTHPlantillas.render genera HTML válido');
check(cardHtml.includes('pv-fibra') || cardHtml.includes('fiber-card'), 'El HTML contiene la clase de tarjeta de fibra');
check(cardHtml.includes('12 Hilos'), 'El HTML refleja los 12 hilos declarados');

console.log('\n' + '='.repeat(60));
console.log(`RESULTADO: ${RESULTADO.ok} comprobaciones OK, ${RESULTADO.fallos.length} fallos`);
console.log('='.repeat(60));

process.exit(RESULTADO.fallos.length === 0 ? 0 : 1);
