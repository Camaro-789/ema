/**
 * ftth-colores.js
 * Fuente ÚNICA de la paleta de colores TIA-598-C en el frontend.
 *
 * Esta lista es un espejo exacto de la que ya existe en el backend
 * (backend/app/models/ftth_logica.py → TIA598_NOMBRES / TIA598_HEX /
 * color_tia598) y que se persiste por tubo y por hilo en las columnas
 * `color` y `color_hex` de ftth_cable_tubos / ftth_cable_fibras.
 *
 * Regla: ninguna plantilla visual define colores propios. Todas piden aquí
 * el hex de la posición de hilo que van a pintar. Si algún día cambia la
 * paleta, se cambia en el backend y en este archivo, y nada más.
 *
 * Cicla cada 12 posiciones, igual que color_tia598() en Python.
 */
const FTTHColores = (() => {

  const TOTAL = 12;

  // Posición 1..12 → nombre y hex. Idénticos a TIA598_NOMBRES / TIA598_HEX.
  const TIA598 = Object.freeze([
    Object.freeze({ n: 1,  nombre: 'Azul',       hex: '#1E90FF' }),
    Object.freeze({ n: 2,  nombre: 'Naranja',    hex: '#FF8C00' }),
    Object.freeze({ n: 3,  nombre: 'Verde',      hex: '#22C55E' }),
    Object.freeze({ n: 4,  nombre: 'Marrón',     hex: '#8B4513' }),
    Object.freeze({ n: 5,  nombre: 'Pizarra',    hex: '#708090' }),
    Object.freeze({ n: 6,  nombre: 'Blanco',     hex: '#F1F5F9' }),
    Object.freeze({ n: 7,  nombre: 'Rojo',       hex: '#EF4444' }),
    Object.freeze({ n: 8,  nombre: 'Negro',      hex: '#111111' }),
    Object.freeze({ n: 9,  nombre: 'Amarillo',   hex: '#EAB308' }),
    Object.freeze({ n: 10, nombre: 'Violeta',    hex: '#A855F7' }),
    Object.freeze({ n: 11, nombre: 'Rosa',       hex: '#EC4899' }),
    Object.freeze({ n: 12, nombre: 'Aguamarina', hex: '#06B6D4' }),
  ]);

  /** Quita acentos y pasa a minúsculas para comparar nombres escritos a mano. */
  function _norm(texto) {
    return String(texto == null ? '' : texto)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  /** Posición 1..N → { n, nombre, hex, ciclo }. Cicla cada 12, como el backend. */
  function porNumero(numero) {
    const n = parseInt(numero, 10);
    const base = Number.isFinite(n) && n > 0 ? n : 1;
    const pos = ((base - 1) % TOTAL) + 1;
    const color = TIA598[pos - 1];
    return {
      n: pos,
      nombre: color.nombre,
      hex: color.hex,
      ciclo: Math.floor((base - 1) / TOTAL) + 1,
    };
  }

  /** Hex de la posición (1..N, cicla cada 12). Devuelve '' si no se puede. */
  function hex(numero) {
    const c = porNumero(numero);
    return c ? c.hex : '';
  }

  /** Nombre del color de la posición (1..N, cicla cada 12). */
  function nombre(numero) {
    const c = porNumero(numero);
    return c ? c.nombre : '';
  }

  /** Hex a partir del nombre ('Marrón', 'marron', 'MARRON' → #8B4513). */
  function hexPorNombre(texto) {
    const buscado = _norm(texto);
    if (!buscado) return '';
    const hallado = TIA598.find((c) => _norm(c.nombre) === buscado);
    return hallado ? hallado.hex : '';
  }

  /** Nombre canónico a partir de un hex ('#1e90ff' → 'Azul'). '' si es ajeno. */
  function nombrePorHex(hexadecimal) {
    const buscado = String(hexadecimal == null ? '' : hexadecimal).trim().toLowerCase();
    if (!buscado) return '';
    const hallado = TIA598.find((c) => c.hex.toLowerCase() === buscado);
    return hallado ? hallado.nombre : '';
  }

  /** Copia plana de la paleta, para tablas y leyendas. */
  function paleta() {
    return TIA598.map((c) => ({ n: c.n, nombre: c.nombre, hex: c.hex }));
  }

  return {
    TOTAL,
    TIA598,
    porNumero,
    hex,
    nombre,
    hexPorNombre,
    nombrePorHex,
    paleta,
  };

})();

window.FTTHColores = FTTHColores;
