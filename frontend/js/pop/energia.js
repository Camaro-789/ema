/**
 * energia.js — Potencia (dBm) desde el ORIGEN de la traza (paso 5 · Fase 3.3).
 *
 * Réplica de `computeEnergy` del HTML v25 (~697) con las constantes del SERVIDOR
 * (`GET /api/config/reglas`), no con números escritos aquí:
 *   · cada conexión descuenta el conector (0.3 dB);
 *   · el paso interno A↔B del ODF descuenta empalme/ODF (0.1 dB);
 *   · cada salida del splitter descuenta su pérdida por división (1x8 → 10.7 dB);
 *   · el TX de partida es `tx_por_defecto_dbm` según el kind del puerto
 *     (PON +3 · SFP −2 · RJ45 0 · HILO −2), editable por el técnico.
 * No valida nada: es una pista visual; la autoridad sigue en el servidor.
 */
import { reglasCargadas, infoPuerto, perdidaSplitter } from './reglas.js';

const TX_FALLBACK = { PON: 3, SFP: -2, RJ45: 0, HILO: -2 };

function num(valor, porDefecto) {
  const n = Number(valor);
  return valor === null || valor === undefined || Number.isNaN(n) ? porDefecto : n;
}

function perdidas() {
  const tabla = (reglasCargadas() || {}).perdidas_db || {};
  return {
    conector: num(tabla.conector, 0.3),
    empalme: num(tabla.empalme, 0.1),
    odf: num(tabla.odf, 0.1),
  };
}

function cara(etiqueta) {
  const ultimo = String(etiqueta || '').trim().slice(-1).toUpperCase();
  return ultimo === 'A' || ultimo === 'B' ? ultimo : null;
}

function caraOpuesta(etiqueta) {
  const c = cara(etiqueta);
  return c === 'A' ? 'B' : (c === 'B' ? 'A' : null);
}

function tipoDe(diagrama, puerto) {
  const equipo = (diagrama.dispositivos || []).find((d) => d.id === puerto.dispositivo_id);
  return String((equipo && equipo.tipo) || '').toUpperCase();
}

/** TX por defecto de un puerto según su kind (igual que `TX_KIND` del HTML). */
export function txPorDefecto(tipoEquipo, etiqueta) {
  const kind = infoPuerto(tipoEquipo, etiqueta).kind;
  const tabla = (reglasCargadas() || {}).tx_por_defecto_dbm || {};
  return num(tabla[kind], num(TX_FALLBACK[kind], 0));
}

/** Puertos e hilos que pueden iniciar la potencia (como `origin:true` del HTML). */
export function candidatosOrigen(diagrama) {
  const conexiones = diagrama.conexiones || [];
  const puertosConectados = new Set(conexiones.map((c) => c.puerto_id).filter(Boolean));
  const hilosConectados = new Set();
  conexiones.forEach((c) => {
    if (c.fibra_a_id) hilosConectados.add(c.fibra_a_id);
    if (c.fibra_b_id) hilosConectados.add(c.fibra_b_id);
  });
  const nombres = new Map((diagrama.dispositivos || [])
    .map((d) => [d.id, d.nombre || String(d.tipo).toUpperCase()]));

  const dePuerto = (diagrama.puertos || [])
    .filter((p) => puertosConectados.has(p.id))
    .map((p) => {
      const tipo = tipoDe(diagrama, p);
      const info = infoPuerto(tipo, p.etiqueta);
      return {
        clave: `P:${p.id}`,
        id: p.id,
        etiqueta: `${nombres.get(p.dispositivo_id) || 'equipo'} · ${p.etiqueta}`,
        tipo,
        kind: info.kind,
        dominio: info.dominio,
        cobre: info.medio === 'cobre',
        tx: txPorDefecto(tipo, p.etiqueta),
        esOrigen: !!info.es_origen,
      };
    })
    .filter((p) => p.esOrigen);

  const deHilo = [];
  (diagrama.cables || []).forEach((cable) => {
    (cable.hilos.items || []).forEach((hilo) => {
      if (!hilosConectados.has(hilo.fibra_id)) return;
      const info = infoPuerto('CABLE', hilo.nombre);
      deHilo.push({
        clave: `H:${hilo.fibra_id}`,
        id: hilo.fibra_id,
        etiqueta: `${cable.nombre} · ${hilo.nombre}`,
        tipo: 'CABLE',
        kind: info.kind,
        dominio: info.dominio,
        cobre: info.medio === 'cobre',
        tx: txPorDefecto('CABLE', hilo.nombre),
        esOrigen: info.es_origen !== false,
      });
    });
  });
  return [...dePuerto, ...deHilo];
}

/**
 * Recorre la red desde el origen y devuelve la potencia por nodo y por tramo.
 * `{ origen, candidatos, tx, potencia: Map<clave, dBm>, tramos: [{conexion_id, dbm}] }`
 */
export function recorrerEnergia(diagrama, opciones = {}) {
  const puertos = diagrama.puertos || [];
  const L = perdidas();
  const candidatos = candidatosOrigen(diagrama);
  const origen = candidatos.find((c) => c.clave === opciones.origenClave)
    || candidatos[0] || null;
  const potencia = new Map();
  const tramos = [];
  const resultado = { origen, candidatos, potencia, tramos, tx: null };
  if (!origen) return resultado;
  resultado.tx = num(opciones.txDbm, origen.tx);

  const porNodo = new Map();
  (diagrama.conexiones || []).forEach((conexion) => {
    [`H:${conexion.fibra_a_id}`,
      conexion.puerto_id ? `P:${conexion.puerto_id}` : `H:${conexion.fibra_b_id}`,
    ].forEach((nodo) => {
      if (!porNodo.has(nodo)) porNodo.set(nodo, []);
      porNodo.get(nodo).push(conexion);
    });
  });

  // Pasos internos de un equipo (no son conexiones): ODF A↔B y splitter IN↔OUT.
  const pasosInternos = (nodo, dbm) => {
    const puerto = puertos.find((p) => `P:${p.id}` === nodo);
    if (!puerto) return [];
    const equipo = (diagrama.dispositivos || []).find((d) => d.id === puerto.dispositivo_id) || {};
    const tipo = String(equipo.tipo || '').toUpperCase();
    if (tipo === 'ODF') {
      const opuesta = caraOpuesta(puerto.etiqueta);
      const hermana = opuesta && puertos.find((p) => p.dispositivo_id === puerto.dispositivo_id
        && p.id !== puerto.id && cara(p.etiqueta) === opuesta);
      return hermana ? [{ nodo: `P:${hermana.id}`, dbm: dbm - Math.max(L.odf, L.empalme) }] : [];
    }
    if (tipo === 'SPLITTER') {
      const perdida = equipo.perdida_db !== null && equipo.perdida_db !== undefined
        ? Number(equipo.perdida_db) : perdidaSplitter(equipo.division);
      return puertos
        .filter((p) => p.dispositivo_id === puerto.dispositivo_id && p.id !== puerto.id
          && !/^IN/i.test(String(p.etiqueta || '')))
        .map((p) => ({ nodo: `P:${p.id}`, dbm: dbm - perdida }));
    }
    return [];
  };

  const visitados = new Set();
  const pila = [{ nodo: origen.clave, dbm: resultado.tx, dominio: origen.dominio, cobre: origen.cobre }];
  while (pila.length) {
    const actual = pila.pop();
    if (visitados.has(actual.nodo)) continue;
    visitados.add(actual.nodo);
    potencia.set(actual.nodo, actual.dbm);
    (porNodo.get(actual.nodo) || []).forEach((conexion) => {
      const otros = [`H:${conexion.fibra_a_id}`,
        conexion.puerto_id ? `P:${conexion.puerto_id}` : `H:${conexion.fibra_b_id}`];
      const otro = otros[0] === actual.nodo ? otros[1] : otros[0];
      if (visitados.has(otro)) return;
      const llega = actual.dbm - L.conector;
      tramos.push({
        conexion_id: conexion.id, desde: actual.nodo, hasta: otro,
        dbm: llega, dominio: actual.dominio, cobre: actual.cobre,
      });
      potencia.set(otro, llega);
      pila.push({ nodo: otro, dbm: llega, dominio: actual.dominio, cobre: actual.cobre });
      pasosInternos(otro, llega).forEach((paso) => {
        potencia.set(paso.nodo, paso.dbm);
        pila.push({ nodo: paso.nodo, dbm: paso.dbm, dominio: actual.dominio, cobre: actual.cobre });
      });
    });
  }
  return resultado;
}

/** dBm que llega al punto MÁS LEJANO de la ruta (el peor caso, el que se mide). */
export function dbmDeRuta(energia, ruta) {
  if (!energia || !ruta || !ruta.cadena) return null;
  const valores = (ruta.cadena.nodos || [])
    .map((nodo) => energia.potencia.get(nodo))
    .filter((v) => typeof v === 'number');
  return valores.length ? Math.min(...valores) : null;
}
