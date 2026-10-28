/**
 * store.js — Copia de LECTURA del diagrama (Fase 4).
 *
 * No hay estado propio que pueda diferir del servidor: cada acción termina con
 * `cargar()` y la vista se redibuja con la respuesta del backend. Si el servidor
 * responde 409 (revisión vieja), se recarga y se avisa.
 */
import { api } from './api.js';

const estado = {
  contenedorId: null,
  diagrama: null,
  revision: 0,
  cargando: false,
  error: null,
};

const oyentes = new Set();

export function suscribir(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function avisar() {
  oyentes.forEach((fn) => {
    try { fn(estado); } catch (error) { console.error('[pop store]', error); }
  });
}

export function instantanea() {
  return estado;
}

export function revisionVigente() {
  return estado.revision;
}

export function diagramaActual() {
  return estado.diagrama;
}

/** Carga (o recarga) el diagrama desde el servidor. */
export async function cargar(contenedorId, hilosPorCable = 96) {
  estado.cargando = true;
  estado.error = null;
  avisar();
  try {
    const dto = await api.diagrama(contenedorId, hilosPorCable);
    estado.contenedorId = contenedorId;
    estado.diagrama = dto;
    estado.revision = dto.revision;
    return dto;
  } catch (error) {
    estado.error = error;
    throw error;
  } finally {
    estado.cargando = false;
    avisar();
  }
}

/**
 * Ejecuta una escritura y deja el estado igual a lo que responde el servidor.
 * - error de regla (422): se propaga SIN tocar la pantalla;
 * - 409: recarga y avisa de que el diagrama cambió.
 */
export async function ejecutar(accion, { alConflicto } = {}) {
  try {
    const resultado = await accion(estado.revision);
    await cargar(estado.contenedorId);
    return resultado;
  } catch (error) {
    if (error && error.esConflicto) {
      await cargar(estado.contenedorId).catch(() => {});
      if (alConflicto) alConflicto(error);
    }
    throw error;
  }
}
