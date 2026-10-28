/**
 * ftth-plantillas.js
 * Registro central de plantillas VISUALES de objetos del diagrama.
 *
 * Qué resuelve:
 *   El catálogo de tipos (ftth_tipos) guarda, dentro de su JSON `propiedades`,
 *   la clave `plantilla_visual` (p. ej. "splitter_1x8"). Con esa clave el
 *   diagrama pide aquí el dibujo que corresponde al objeto, en vez de tener
 *   un `if` por cada tipo de objeto.
 *
 * Cómo se usa:
 *   FTTHPlantillas.registrar('splitter_1x8', renderFn, { categoria: 'splitter' });
 *   const html = FTTHPlantillas.render('splitter_1x8', datos);
 *
 * Contrato de una plantilla (regla del proyecto):
 *   - Es una función pura: recibe SIEMPRE un objeto de datos y devuelve un
 *     string de HTML/SVG. No consulta la API ni toca el DOM por su cuenta.
 *   - No lleva valores fijos (ni nombres, ni dBm, ni números de hilo, ni
 *     colores): los colores salen de window.FTTHColores.
 *
 * Orden de carga: ftth-colores.js → ftth-plantillas.js → plantillas-visuales/*.js
 */
const FTTHPlantillas = (() => {

  // clave (valor de `plantilla_visual`) → { render, meta }
  const REGISTRO = {};

  // Si un tipo no declara `plantilla_visual`, se usa este fallback por categoría.
  // Es solo una red de seguridad para no dejar un objeto en blanco.
  const POR_CATEGORIA = Object.freeze({
    splitter: 'splitter_generico',
    cables:   'fibra_cable',
  });

  function aviso(msg, tipo) {
    if (window.FTTHTipos && window.FTTHTipos.showToast) window.FTTHTipos.showToast(msg, tipo || 'error');
    else console.warn('[plantillas]', msg);
  }

  /** Registra (o reemplaza) una plantilla visual. */
  function registrar(clave, render, meta) {
    const nombre = String(clave == null ? '' : clave).trim();
    if (!nombre) {
      aviso('La plantilla visual necesita una clave (el valor de plantilla_visual).');
      return null;
    }
    if (typeof render !== 'function') {
      aviso(`La plantilla «${nombre}» no trae una función render().`);
      return null;
    }
    const m = meta || {};
    REGISTRO[nombre] = {
      render,
      meta: {
        clave: nombre,
        etiqueta: m.etiqueta || nombre,
        categoria: String(m.categoria || '').toLowerCase(),
        descripcion: m.descripcion || '',
        generica: !!m.generica,
      },
    };
    return REGISTRO[nombre];
  }

  function obtener(clave) {
    return REGISTRO[String(clave == null ? '' : clave).trim()] || null;
  }

  function existe(clave) {
    return !!obtener(clave);
  }

  function listar() {
    return Object.keys(REGISTRO);
  }

  /** Plantillas registradas para una categoría del catálogo (splitter, cable...). */
  function clavesDeCategoria(categoria) {
    const cat = String(categoria == null ? '' : categoria).toLowerCase();
    return listar().filter((k) => REGISTRO[k].meta.categoria === cat);
  }

  /** Pinta una plantilla. Devuelve '' si no existe (nunca lanza). */
  function render(clave, datos) {
    const entrada = obtener(clave);
    if (!entrada) return '';
    try {
      const html = entrada.render(datos || {});
      return typeof html === 'string' ? html : '';
    } catch (e) {
      console.error(`[plantillas] error al renderizar «${clave}»:`, e);
      return '';
    }
  }

  /**
   * Clave de plantilla declarada por un tipo del catálogo.
   * `tipo` es una fila de ftth_tipos o un objeto de propiedades:
   *   { categoria, propiedades: { plantilla_visual } }
   *   { categoria, propiedades_tipo: { plantilla_visual } }
   *   { categoria: 'cables', plantilla_visual: '...' }
   */
  function resolverTipo(tipo) {
    if (!tipo) return '';
    const props = (tipo && (tipo.propiedades || tipo.propiedades_tipo)) || tipo;
    const declarada = props.plantilla_visual || (tipo && tipo.plantilla_visual);
    if (declarada && existe(declarada)) return declarada;
    const cat = String(tipo.categoria || props.categoria || (props.fibras != null ? 'cables' : '')).toLowerCase();
    return POR_CATEGORIA[cat] || '';
  }

  // ── Adaptador dominio → datos de plantilla ────────────────────────────────
  // Traduce el dispositivo de `GET /api/elementos/{id}/nodo` al objeto de datos
  // que espera la plantilla. Si mañana el DTO trae más campos, se añaden aquí
  // y las plantillas no cambian.

  function _num(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  /** Ordena los puertos por su número: OUT-2 va antes que OUT-10. */
  function _ordenPuerto(puerto) {
    const etiqueta = String((puerto && puerto.etiqueta) || '');
    const m = etiqueta.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 9999;
  }

  /** Texto de potencia listo para pintar: '— dBm' cuando no hay medida. */
  function formatoDbm(valor) {
    const n = _num(valor);
    return n === null ? '— dBm' : `${n.toFixed(2)} dBm`;
  }

  /** Texto de atenuación listo para pintar: '— dB' cuando no hay valor. */
  function formatoDb(valor) {
    const n = _num(valor);
    return n === null ? '— dB' : `${n.toFixed(2)} dB`;
  }

  /**
   * Datos de plantilla para un splitter a partir del DTO del nodo.
   * No inventa medidas: lo que no llega se pinta como «—».
   *
   * @param {Object} contexto  estado de VISTA (no de identidad):
   *                           { puertoSeleccionado: id }
   */
  function datosSplitter(dev, puertos, tipoNombre, contexto) {
    const d = dev || {};
    const ctx = contexto || {};
    const lista = Array.isArray(puertos) ? puertos.slice() : [];

    const entrada = lista.find((p) => String(p.direccion || '').toLowerCase() === 'in') || null;
    const salidas = lista
      .filter((p) => String(p.direccion || '').toLowerCase() !== 'in')
      .sort((a, b) => _ordenPuerto(a) - _ordenPuerto(b));

    const division = d.division
      || (d.puertos_in && d.puertos_out ? `${d.puertos_in}x${d.puertos_out}` : '');
    const entradas = _num(d.puertos_in);
    const salidasDeclaradas = _num(d.puertos_out);

    return {
      id: d.id,
      // Id del APARATO, con nombre explícito: la tarjeta lo usa para el modo
      // eliminar del diagrama (siempre contra el endpoint de dispositivos).
      dispositivo_id: d.dispositivo_id != null ? d.dispositivo_id : d.id,
      nombre: tipoNombre || d.serie || 'Splitter',
      modelo: tipoNombre || 'Splitter',
      subtitulo: 'Fibra hasta el hogar · FTTH',
      relacion: division ? division.replace('x', ' : ') : '',
      serie: d.serie || '',
      estado: d.estado || '',
      atenuacion_db: d.atenuacion_db,
      entradas: entradas === null ? 1 : entradas,
      salidasDeclaradas: salidasDeclaradas === null ? salidas.length : salidasDeclaradas,
      salidasLibres: salidas.filter((p) => String(p.estado || '').toLowerCase() === 'libre').length,
      entrada: entrada
        ? {
            id: entrada.id,
            etiqueta: entrada.etiqueta || 'IN',
            potencia_dbm: entrada.potencia_dbm,
            color_hex: entrada.color_hex || '',
            seleccionado: entrada.id === ctx.puertoSeleccionado,
          }
        : { id: null, etiqueta: 'IN', potencia_dbm: null, color_hex: '', seleccionado: false },
      salidas: salidas.map((p, i) => {
        const orden = _ordenPuerto(p);
        return {
          id: p.id,
          numero: orden === 9999 ? i + 1 : orden,
          etiqueta: p.etiqueta || `OUT-${i + 1}`,
          estado: p.estado || '',
          conector: p.tipo_conector || '',
          teorica_dbm: p.potencia_dbm,
          otdr_dbm: p.otdr_dbm,
          color: p.color || '',
          color_hex: p.color_hex || '',
          seleccionado: p.id === ctx.puertoSeleccionado,
        };
      }),
    };
  }

  /**
   * Datos de plantilla para un cable de fibra a partir del DTO del nodo.
   *
   * @param {Object} dev       dispositivo del nodo (tipo 'cables')
   * @param {Array}  tubos     tubos con sus hilos (desde /api/cables/{id}/hilos)
   * @param {string} tipoNombre nombre del tipo de cable
   */
  function datosFibra(dev, tubos, tipoNombre) {
    const d = dev || {};
    const props = d.propiedades || d.propiedades_tipo || d;
    const instProps = d.propiedades_instancia || d;

    const totalFibras = _num(props.fibras) || _num(instProps.fibras) || 0;
    const fibrasLoose = _num(props.fibrasLoose) || _num(props.fibras_loose) || null;
    const looses = _num(props.looses) || null;
    const nivel = _texto(props.nivel) || _texto(instProps.nivel) || '';
    // Estructura del cable: 'con_buffer' | 'drop' (los tipos antiguos no la traen)
    const estructura = _texto(props.estructura) || _texto(instProps.estructura) || '';
    const modelo = tipoNombre || _texto(props.codigo) || _texto(props.nombre) || 'Cable de Fibra';

    // Ocupación: hilos usados vs total
    const tubosArr = Array.isArray(tubos) ? tubos : (Array.isArray(d.tubos) ? d.tubos : []);
    // Total de hilos: los REALES de la BD si hay tubos; si no, los que declara el
    // TIPO. Nunca un número inventado: si no hay dato, es 0 y la tarjeta avisa.
    const hTotal = tubosArr.length
      ? tubosArr.reduce((s, t) => s + ((t.hilos || []).length), 0)
      : totalFibras;
    const hUsadas = tubosArr.reduce((s, t) => {
      return s + (t.hilos || []).filter((h) => h.estado && h.estado !== 'libre').length;
    }, 0);
    // Hilos reales (color y estado de la BD) para que el dibujo use los suyos
    const hilosReales = tubosArr.reduce((acc, t) => acc.concat(t.hilos || []), []);

    // Extremos (puntas del cable)
    const extremos = { A: null, B: null };
    if (d.extremos) {
      if (d.extremos.A) extremos.A = { nombre: _texto(d.extremos.A.nombre || d.extremos.A.nodo_id) };
      if (d.extremos.B) extremos.B = { nombre: _texto(d.extremos.B.nombre || d.extremos.B.nodo_id) };
    }

    return {
      id: d.id,
      // El id del CABLE, con nombre explícito: la tarjeta lo usa para «Propiedades
      // de fibra» y para el modo eliminar del diagrama (una fibra NO es un
      // dispositivo: su baja es quitar el cable del nodo). Así la plantilla nunca
      // tiene que adivinar de qué id se trata.
      cable_id: d.cable_id != null ? d.cable_id : d.id,
      nombre: modelo,
      modelo,
      fibras: hTotal,
      fibrasLoose,
      looses,
      nivel,
      estructura,
      ocupacion: { usadas: hUsadas, total: hTotal },
      tubos: tubosArr,
      hilosReales,
      extremos,
    };
  }

  /** 'splitter' → 'Splitter'. Para no pintar la clave cruda en minúsculas. */
  function _titulo(texto) {
    const t = String(texto == null ? '' : texto).trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  /** Texto limpio: '' en vez de undefined/null/'null'. */
  function _texto(valor) {
    const s = String(valor == null ? '' : valor).trim();
    return s === 'null' || s === 'undefined' ? '' : s;
  }

  /**
   * Dibuja el dispositivo del diagrama con su plantilla visual.
   * Devuelve '' cuando no hay plantilla aplicable: el diagrama sigue pintando
   * su tarjeta clásica y nadie se queda sin ver nada.
   *
   * OJO: el `plantilla_visual` del NODO (una caja NAP, por ejemplo, con la
   * plantilla de la caja) NO se aplica a los aparatos que van dentro. Aquí
   * manda el dispositivo: lo que él declare y, si no, su propia categoría.
   * Para la tarjeta del nodo en sí está `resolverTipo()`.
   *
   * @param {Object} dev       dispositivo del DTO del nodo
   * @param {Array}  puertos   puertos de ese dispositivo
   * @param {Object} contexto  estado de vista opcional ({ puertoSeleccionado })
   */
  function paraDispositivo(dev, puertos, contexto) {
    const d = dev || {};
    const tipo = String(d.tipo || '').toLowerCase();

    let clave = _texto(d.plantilla_visual);
    if (!existe(clave)) clave = POR_CATEGORIA[tipo] || '';
    if (!existe(clave)) return '';

    const nombre = _texto(d.nombre) || _titulo(d.tipo);

    if (tipo === 'splitter' || obtener(clave).meta.categoria === 'splitter') {
      return render(clave, datosSplitter(d, puertos, nombre, contexto));
    }

    if (tipo === 'cables' || obtener(clave).meta.categoria === 'cables') {
      // Los tubos del cable pueden venir en d.tubos (si el backend los incluye en el DTO)
      return render(clave, datosFibra(d, d.tubos || [], nombre));
    }

    return render(clave, {
      dispositivo: d,
      puertos: puertos || [],
      nombre,
    });
  }

  return {
    REGISTRO,
    POR_CATEGORIA,
    registrar,
    obtener,
    existe,
    listar,
    clavesDeCategoria,
    render,
    resolverTipo,
    datosSplitter,
    datosFibra,
    formatoDbm,
    formatoDb,
    paraDispositivo,
  };

})();

window.FTTHPlantillas = FTTHPlantillas;

