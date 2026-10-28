/**
 * trazabilidad.js — Recorridos del POP (Fase 4).
 *
 * Construye las "cadenas" a partir de las conexiones que devuelve el servidor:
 * hilo ↔ hilo (paso) e hilo ↔ puerto (conector). Cada cadena es una lista de
 * puntos (para la linterna) y las conexiones que la forman (para iluminarlas).
 */
function claveHilo(fibraId) {
  return `H:${fibraId}`;
}

function clavePuerto(puertoId) {
  return `P:${puertoId}`;
}

/** Devuelve [{ id, puntos: [...], conexiones: [...] }] a partir de las conexiones. */
export function cadenas(diagrama) {
  const conexiones = diagrama.conexiones || [];
  const cables = diagrama.cables || [];
  const puertos = diagrama.puertos || [];
  const dispositivos = diagrama.dispositivos || [];

  const nombreHilo = (id) => {
    for (const cable of cables) {
      const hilo = (cable.hilos.items || []).find((h) => h.fibra_id === id);
      if (hilo) return { cable: cable.nombre, hilo: hilo.nombre, cable_id: cable.id };
    }
    return { cable: `cable ${id}`, hilo: `hilo ${id}`, cable_id: null };
  };
  const nombrePuerto = (id) => {
    const puerto = puertos.find((p) => p.id === id);
    if (!puerto) return { equipo: `equipo ${id}`, puerto: `#${id}` };
    const equipo = dispositivos.find((d) => d.id === puerto.dispositivo_id);
    return {
      equipo: equipo ? (equipo.nombre || equipo.tipo.toUpperCase()) : 'equipo',
      puerto: puerto.etiqueta,
      dispositivo_id: puerto.dispositivo_id,
    };
  };

  const adyacencia = new Map();
  const unir = (a, b) => {
    if (!adyacencia.has(a)) adyacencia.set(a, []);
    if (!adyacencia.has(b)) adyacencia.set(b, []);
    adyacencia.get(a).push(b);
    adyacencia.get(b).push(a);
  };
  conexiones.forEach((conexion) => {
    const a = claveHilo(conexion.fibra_a_id);
    const b = conexion.puerto_id
      ? clavePuerto(conexion.puerto_id)
      : claveHilo(conexion.fibra_b_id);
    if (conexion.fibra_a_id && (conexion.fibra_b_id || conexion.puerto_id)) unir(a, b);
  });

  const visitados = new Set();
  const resultado = [];
  let numero = 0;
  const nodos = [...adyacencia.keys()];
  nodos.forEach((inicio) => {
    if (visitados.has(inicio)) return;
    const cola = [inicio];
    const cadena = [];
    visitados.add(inicio);
    while (cola.length) {
      const actual = cola.shift();
      cadena.push(actual);
      (adyacencia.get(actual) || []).forEach((vecino) => {
        if (!visitados.has(vecino)) {
          visitados.add(vecino);
          cola.push(vecino);
        }
      });
    }
    const puntos = cadena.map((clave, indice) => {
      if (clave.startsWith('H:')) {
        const datos = nombreHilo(Number(clave.slice(2)));
        return { etiqueta: `${datos.cable} · ${datos.hilo}`, x: 120, y: 120 + indice * 30 };
      }
      const datos = nombrePuerto(Number(clave.slice(2)));
      return { etiqueta: `${datos.equipo} · ${datos.puerto}`, x: 420, y: 120 + indice * 30 };
    });
    numero += 1;
    resultado.push({
      id: `cadena-${numero}`,
      etiqueta: puntos.map((p) => p.etiqueta).slice(0, 3).join(' → '),
      puntos,
      nodos: cadena,
    });
  });
  return resultado;
}

/** Resumen legible de una cadena (para el aviso de la linterna). */
export function resumen(cadena) {
  if (!cadena || !cadena.puntos.length) return 'Sin trazabilidad';
  return `${cadena.puntos.length} puntos · ${cadena.etiqueta}`;
}
