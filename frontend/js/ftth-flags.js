/**
 * Interruptores de la integración POP v25 — Fase 1.4.
 *
 * Lee `GET /api/config/flags` UNA vez al arrancar y deja el resultado en
 * `window.FTTH_FLAGS`. Mientras no llegue la respuesta (o si el backend no
 * está), se usa el valor por defecto: ENCENDIDO, para no romper el desarrollo.
 *
 * Lo consumen:
 *   - ftth-mapa.js     (tieneDiagrama / abrirDiagramaGlobal)
 *   - ftth-pop-papel.js (abrir)
 *
 * Apagado = no aparece ningún acceso al diagrama; el mapa sigue funcionando.
 */
(function () {
  'use strict';

  const POR_DEFECTO = { pop_v25_enabled: true, pop_nativo_en_armario: true, version_contrato_diagrama: 1 };

  window.FTTH_FLAGS = Object.assign({}, POR_DEFECTO, window.FTTH_FLAGS || {});

  function marcarDocumento() {
    document.documentElement.dataset.popV25 = window.FTTH_FLAGS.pop_v25_enabled === false ? 'off' : 'on';
  }

  function aplicar(datos) {
    if (!datos || typeof datos !== 'object') return;
    Object.keys(POR_DEFECTO).forEach(function (clave) {
      if (datos[clave] !== undefined) window.FTTH_FLAGS[clave] = datos[clave];
    });
    marcarDocumento();
  }

  async function cargar() {
    try {
      const respuesta = await fetch(`${window.location.origin}/api/config/flags`, { cache: 'no-store' });
      if (respuesta.ok) aplicar(await respuesta.json());
    } catch (error) {
      // Sin backend o sin red: se queda con el valor por defecto (encendido).
    }
    marcarDocumento();
  }

  window.FTTHFlags = {
    activo: function () { return window.FTTH_FLAGS.pop_v25_enabled !== false; },
    recargar: cargar,
  };

  marcarDocumento();
  cargar();
})();
