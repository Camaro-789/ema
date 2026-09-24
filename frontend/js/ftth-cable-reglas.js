/**
 * ftth-cable-reglas.js
 * Reglas de la plantilla de un CABLE DE FIBRA (estructura «con buffer» / «drop»).
 *
 * Un cable se define por su ESTRUCTURA:
 *   con_buffer → trae buffers (looses). Fibras por buffer = total / looses
 *                (división EXACTA) y no puede pasar del máximo del perfil.
 *   drop       → cable plano SIN buffer. Solo el total de hilos, y solo los
 *                tamaños reales de mercado: 1, 2, 4, 6 u 8.
 *
 * Es la copia en JS de `backend/app/models/ftth_logica.py::normalizar_cable()`:
 * el backend SIEMPRE vuelve a validar (no se fía del formulario) y una prueba
 * (frontend/scripts/prueba_reglas_cable.js) compara las dos tablas para que no
 * se separen, igual que se hace con la atenuación de los splitters.
 *
 * No toca el DOM ni la API: es una función pura y por eso se puede probar sola.
 */
const FTTHCableReglas = (() => {

  const ESTRUCTURA_CON_BUFFER = 'con_buffer';
  const ESTRUCTURA_DROP = 'drop';

  // Opciones del selector de estructura (mismo orden en el formulario)
  const ESTRUCTURAS = Object.freeze([
    { v: ESTRUCTURA_CON_BUFFER, t: 'Con buffer' },
    { v: ESTRUCTURA_DROP, t: 'Drop (sin buffer)' },
  ]);

  // Plantilla visual que le toca a cada estructura (valor de propiedades.plantilla_visual)
  const PLANTILLA_VISUAL = Object.freeze({
    [ESTRUCTURA_CON_BUFFER]: 'fibra_cable',
    [ESTRUCTURA_DROP]: 'fibra_cable_drop',
  });

  // Máximo de fibras por buffer que admite cada perfil de fibra (misma tabla que el backend)
  const MAX_FIBRAS_POR_BUFFER_POR_PERFIL = Object.freeze({
    eia598a: 12,   // EIA/TIA-598-A
    abnt: 24,      // ABNT NBR
    custom: 24,    // personalizado
  });
  const PERFIL_POR_DEFECTO = 'eia598a';

  const MAX_LOOSES = 96;              // buffers máximos de un cable
  const LOOSES_DROP = 1;              // un drop no agrupa: se guarda 1 y no se muestra
  const HILOS_DROP = Object.freeze([1, 2, 4, 6, 8]);   // totales reales de mercado

  // ── Utilidades ────────────────────────────────────────────────────────────
  function entero(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  function maxFibrasPorBuffer(perfil) {
    const clave = String(perfil || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(MAX_FIBRAS_POR_BUFFER_POR_PERFIL, clave)
      ? MAX_FIBRAS_POR_BUFFER_POR_PERFIL[clave]
      : MAX_FIBRAS_POR_BUFFER_POR_PERFIL.custom;
  }

  /** ¿Esta plantilla es un drop? (sirve también para tipos antiguos sin el campo) */
  function esDrop(props) {
    return String((props || {}).estructura || '').trim().toLowerCase() === ESTRUCTURA_DROP;
  }

  /** Fibras por buffer que saldrían con esos valores (para la vista previa). */
  function fibrasPorBuffer(total, looses) {
    const t = entero(total);
    const l = entero(looses);
    if (t === null || l === null || l < 1) return null;
    return t % l === 0 ? t / l : null;
  }

  /** Texto de vista previa del envase: lo que va a nacer al guardar. */
  function describir(props) {
    const r = normalizar(props);
    if (!r.ok) return r.error;
    const p = r.props;
    if (p.estructura === ESTRUCTURA_DROP) {
      return `DROP: ${p.fibras} hilo(s) sin buffer (salen directos del jacket).`;
    }
    return `${p.fibras} hilos = ${p.looses} buffer(es) × ${p.fibrasLoose} `
      + `(máximo ${maxFibrasPorBuffer(p.perfil)} por buffer en el perfil «${p.perfil}»).`;
  }

  /**
   * Normaliza la plantilla de un cable a sus valores canónicos.
   * @returns {{ok: boolean, props: Object, error: string}}
   *   ok=true  → props con estructura, looses, fibras, fibrasLoose y plantilla_visual
   *   ok=false → error con el motivo exacto (el formulario no deja guardar)
   */
  function normalizar(props) {
    const datos = Object.assign({}, props || {});
    const estructura = String(datos.estructura || ESTRUCTURA_CON_BUFFER).trim().toLowerCase();

    if (estructura !== ESTRUCTURA_CON_BUFFER && estructura !== ESTRUCTURA_DROP) {
      return { ok: false, props: datos, error:
        `Estructura de cable «${datos.estructura}» no válida. `
        + `Permitidas: ${ESTRUCTURAS.map(e => e.v).join(', ')}.` };
    }

    if (estructura === ESTRUCTURA_DROP) {
      const total = entero(datos.fibras);
      if (total === null) {
        return { ok: false, props: datos, error:
          'Un cable drop necesita su número total de hilos (1, 2, 4, 6 u 8).' };
      }
      if (HILOS_DROP.indexOf(total) === -1) {
        return { ok: false, props: datos, error:
          `Un cable drop solo admite ${HILOS_DROP.join(', ')} hilos (se pidieron ${total}): `
          + 'no existen cables drop de ese tamaño.' };
      }
      datos.estructura = ESTRUCTURA_DROP;
      datos.looses = LOOSES_DROP;        // fijo internamente, no se muestra
      datos.fibras = total;
      datos.fibrasLoose = total;         // sin agrupación real
      delete datos.perfil;               // un drop no tiene perfil de buffer
      datos.plantilla_visual = PLANTILLA_VISUAL[ESTRUCTURA_DROP];
      return { ok: true, props: datos, error: '' };
    }

    const looses = entero(datos.looses);
    const total = entero(datos.fibras);
    if (looses === null || looses < 1) {
      return { ok: false, props: datos, error:
        'Un cable con buffer necesita su número de looses (buffers), mayor que cero.' };
    }
    if (looses > MAX_LOOSES) {
      return { ok: false, props: datos, error:
        `Un cable no puede tener ${looses} looses: el máximo es ${MAX_LOOSES}.` };
    }
    if (total === null || total < 1) {
      return { ok: false, props: datos, error:
        'Un cable con buffer necesita su número total de fibras.' };
    }
    if (total % looses !== 0) {
      return { ok: false, props: datos, error:
        `${total} fibras no se reparten en ${looses} looses (sobra ${total % looses}): `
        + 'el total debe ser divisible exactamente entre el número de looses.' };
    }

    const porBuffer = total / looses;
    const perfil = datos.perfil || PERFIL_POR_DEFECTO;
    const tope = maxFibrasPorBuffer(perfil);
    if (porBuffer > tope) {
      return { ok: false, props: datos, error:
        `${porBuffer} fibras por buffer superan el máximo de ${tope} del perfil «${perfil}». `
        + 'Baja las fibras o sube los looses.' };
    }

    datos.estructura = ESTRUCTURA_CON_BUFFER;
    datos.looses = looses;
    datos.fibras = total;
    datos.fibrasLoose = porBuffer;
    datos.perfil = perfil;
    datos.plantilla_visual = PLANTILLA_VISUAL[ESTRUCTURA_CON_BUFFER];
    return { ok: true, props: datos, error: '' };
  }

  return {
    ESTRUCTURA_CON_BUFFER,
    ESTRUCTURA_DROP,
    ESTRUCTURAS,
    PLANTILLA_VISUAL,
    MAX_FIBRAS_POR_BUFFER_POR_PERFIL,
    PERFIL_POR_DEFECTO,
    MAX_LOOSES,
    LOOSES_DROP,
    HILOS_DROP,
    maxFibrasPorBuffer,
    esDrop,
    normalizar,
    fibrasPorBuffer,
    describir,
  };

})();

window.FTTHCableReglas = FTTHCableReglas;

