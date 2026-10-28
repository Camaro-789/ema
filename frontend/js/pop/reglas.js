/**
 * reglas.js — Pistas visuales a partir de las reglas del SERVIDOR (Fase 4).
 *
 * Este módulo NO valida: solo lee `GET /api/config/reglas` (el mismo JSON que usa
 * el validador del backend) para pintar pistas. La autoridad es el servidor.
 */
import { api } from './api.js';

let reglas = null;

export async function cargarReglas() {
  if (!reglas) reglas = await api.reglas();
  return reglas;
}

export function reglasCargadas() {
  return reglas;
}

/** kind/dominio/origen de un puerto, igual que PORT_TABLE del HTML. */
export function infoPuerto(tipoEquipo, puerto) {
  if (!reglas) return { kind: '?', dominio: null, activo: false, es_origen: false };
  const tipo = String(tipoEquipo || '').toUpperCase();
  const fila = (reglas.puertos || []).find(
    (item) => item.tipo_equipo === tipo && new RegExp(item.patron).test(String(puerto || '')),
  );
  return fila || { kind: '?', dominio: null, activo: false, es_origen: false };
}

export function puedeSerOrigen(tipoEquipo, puerto) {
  return !!infoPuerto(tipoEquipo, puerto).es_origen;
}

export function dominioDe(tipoEquipo, puerto) {
  return infoPuerto(tipoEquipo, puerto).dominio;
}

export function perdidaSplitter(division) {
  if (!reglas) return 10.7;
  const tabla = reglas.splitters.divisiones_balanceadas || {};
  return Number(tabla[division]) || Number(reglas.perdidas_db.splitter_por_defecto);
}

export function umbral(senal) {
  const dominios = (reglas && reglas.dominios) || {};
  return dominios[senal] || { min_dbm: null, max_dbm: null };
}

export function estadoPotencia(senal, dbm, cobre) {
  if (cobre || dbm === null || dbm === undefined) return 'ok';
  const rango = umbral(senal);
  if (rango.min_dbm !== null && rango.min_dbm !== undefined && dbm < rango.min_dbm) return 'low';
  if (rango.max_dbm !== null && rango.max_dbm !== undefined && dbm > rango.max_dbm) return 'high';
  return 'ok';
}

export function claveExtremo(extremo) {
  return `${extremo.tipo}:${extremo.eq_id}:${extremo.puerto || ''}:${extremo.cara || ''}`;
}
