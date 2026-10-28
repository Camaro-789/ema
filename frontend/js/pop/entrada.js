/**
 * entrada.js — Módulo nativo del POP (Fase 4). Punto de entrada.
 *
 * · Sin iframe, sin postMessage, sin tocar el HTML de referencia.
 * · Cada acción llama a la API y redibuja la respuesta del SERVIDOR.
 * · Si el servidor rechaza, se muestra `mensaje_es` y no cambia nada en pantalla.
 * · Si responde 409, se recarga el diagrama y se avisa.
 *
 * Uso:  import { abrir } from './pop/entrada.js';  abrir(21, { categoria: 'armario' });
 * También queda expuesto como `window.POPNativo`.
 */
import { api, ErrorApi } from './api.js';
import * as store from './store.js';
import { cargarReglas, estadoPotencia } from './reglas.js';
import { crearVistaPapel } from './vista-papel.js';
import { renderRack } from './vista-rack.js';
import { renderMatriz } from './vista-matriz.js';
import { renderPanelIzquierdo } from './panel-izquierdo.js';
import { renderPanelDerecho } from './panel-derecho.js';
import { abrirDialogoEquipo } from './dialogo-equipo.js';
import { cadenas } from './trazabilidad.js';
import { recorrerEnergia, dbmDeRuta } from './energia.js';
import { iniciarLinterna, detenerLinterna, linternaActiva, direccionEtiqueta } from './linterna.js';

let modal = null;
let vistaPapel = null;
let contenedorId = null;
let pestana = 'papel';
let rutaActiva = null;
// Paso 5: origen/TX elegidos por el técnico y sentido del pulso (L/R).
let origenClave = null;
let txDbm = null;
let sentido = 'R';

function cargarCss() {
  if (document.querySelector('link[data-pop-diagrama]')) return;
  const enlace = document.createElement('link');
  enlace.rel = 'stylesheet';
  enlace.href = 'css/pop-diagrama.css?v=202610280100';
  enlace.dataset.popDiagrama = '1';
  document.head.appendChild(enlace);
}

export function aviso(mensaje, tipo = 'error') {
  const caja = modal && modal.querySelector('.pop-avisos');
  if (!caja) { console.warn('[pop]', mensaje); return; }
  const item = document.createElement('div');
  item.className = `pop-aviso pop-aviso--${tipo}`;
  item.textContent = mensaje;
  caja.appendChild(item);
  setTimeout(() => item.remove(), 5000);
}

function alConflicto(error) {
  aviso(`${error.message} Se recargó el diagrama.`, 'aviso');
}

function marcarPestana(nombre) {
  pestana = nombre;
  if (!modal) return;
  modal.querySelectorAll('[data-pestana]').forEach((boton) => {
    boton.classList.toggle('is-on', boton.dataset.pestana === nombre);
  });
  pintar(store.diagramaActual());
}

function pintar(diagrama) {
  if (!modal || !diagrama) return;
  // El lienzo se reconstruye: se cancela el pulso para no dejar un rAF huérfano.
  if (linternaActiva()) detenerLinterna();
  const cuerpo = modal.querySelector('.pop-cuerpo');
  const titulo = modal.querySelector('[data-titulo]');
  const revision = modal.querySelector('[data-revision]');
  if (titulo) {
    titulo.textContent = `${(diagrama.contenedor.categoria || 'POP').toUpperCase()} #${diagrama.contenedor.id}`;
  }
  if (revision) revision.textContent = `revisión ${diagrama.revision}`;

  // Tres zonas, como la plantilla: CABLES | RACK·PAPEL·MATRIZ | TRAZABILIDAD
  cuerpo.innerHTML = `
    <div class="pop-layout">
      <aside class="pop-panel pop-panel--izq"></aside>
      <section class="pop-centro"></section>
      <aside class="pop-panel pop-panel--der"></aside>
    </div>`;
  const izquierda = cuerpo.querySelector('.pop-panel--izq');
  const centro = cuerpo.querySelector('.pop-centro');
  const derecha = cuerpo.querySelector('.pop-panel--der');

  izquierda.addEventListener('pop-error', (evento) => aviso(evento.detail.message));
  renderPanelIzquierdo(izquierda, diagrama, {
    alAnclar: anclarCable,
    alPedirCables: () => api.cables(contenedorId),
    alNuevoEquipo: nuevoEquipo,
  });

  // Paso 5: potencia teórica desde el origen elegido (constantes del servidor).
  // Es una pista visual: si el recorrido falla, el diagrama se pinta igual.
  let energia = { candidatos: [], origen: null, potencia: new Map(), tramos: [], tx: null };
  try {
    energia = recorrerEnergia(diagrama, { origenClave, txDbm });
    if (energia.origen) origenClave = energia.origen.clave;
  } catch (error) {
    console.warn('[pop] no se pudo calcular la energía:', error);
  }
  renderPanelDerecho(derecha, rutasDe(diagrama, energia), {
    alEncender: encenderRuta,
    alDetener: detenerRuta,
    activa: rutaActiva,
    energia,
    sentido,
    alOrigen: cambiarClave,
    alTx: cambiarTx,
    alSentido: cambiarSentido,
  });

  centro.innerHTML = '<div class="pop-vista"></div>';
  const host = centro.querySelector('.pop-vista');

  if (pestana === 'rack') { renderRack(host, diagrama); return; }
  if (pestana === 'matriz') {
    renderMatriz(host, diagrama, {
      alEditar: editar,
      alEliminar: eliminar,
      alNuevo: nuevoEquipo,
      alMover: moverEquipo,
      alConectar: () => aviso('Selecciona dos puertos en el papel dinámico para conectar.', 'aviso'),
      alDesconectar: desconectar,
    });
    return;
  }

  if (vistaPapel) vistaPapel.destruir();
  vistaPapel = crearVistaPapel(host, {
    contenedorId,
    diagrama,
    alConectar: conectar,
    alSoltar: guardarPosicion,
    alEditar: editar,
  });
  // Si la linterna estaba encendida, se vuelve a encender sobre el lienzo nuevo.
  if (rutaActiva) {
    const svg = host.querySelector('.pop-papel-svg');
    if (svg) iniciarLinterna(svg, rutaActiva.cadena, { sentido });
  }
}

async function recargar() {
  try {
    const dto = await store.cargar(contenedorId, 96);
    pintar(dto);
  } catch (error) {
    aviso(error.message);
  }
}

async function ejecutar(accion, mensajeOk) {
  try {
    await store.ejecutar((revision) => accion(revision), { alConflicto });
    pintar(store.diagramaActual());
    if (mensajeOk) aviso(mensajeOk, 'ok');
  } catch (error) {
    if (error instanceof ErrorApi && error.esConflicto) return;
    aviso(error.message);
  }
}

function conectar(origen, destino) {
  return ejecutar(
    (revision) => api.conectar(contenedorId, origen, destino, revision),
    'Conexión guardada.',
  );
}

function desconectar(conexionId) {
  return ejecutar(
    (revision) => api.desconectar(contenedorId, conexionId, revision),
    'Conexión eliminada.',
  );
}

function guardarPosicion(dispositivoId, x, y) {
  return ejecutar(
    (revision) => api.guardarPosiciones(
      contenedorId, [{ dispositivo_id: dispositivoId, x, y }], revision,
    ),
  );
}

async function eliminar(dispositivoId) {
  if (!window.confirm('¿Eliminar este equipo? No se puede deshacer.')) return;
  await ejecutar(
    (revision) => api.eliminarDispositivo(contenedorId, dispositivoId, revision),
    'Equipo eliminado.',
  );
}

function editar(dispositivoId) {
  const diagrama = store.diagramaActual();
  const equipo = ((diagrama && diagrama.dispositivos) || []).find((d) => d.id === dispositivoId);
  if (!equipo) return;
  const nombre = window.prompt('Nombre del equipo:', equipo.nombre || '');
  if (nombre === null) return;
  const estado = window.prompt('Estado (Implementado | En proyecto | Certificado):',
    equipo.estado || 'Implementado');
  if (estado === null) return;
  const cambios = { nombre, estado };
  if (equipo.tipo === 'splitter') {
    const perdida = window.prompt('Pérdida del splitter (dB):',
      String(equipo.perdida_db === null || equipo.perdida_db === undefined ? '' : equipo.perdida_db));
    if (perdida !== null && perdida !== '') cambios.perdida_db = Number(perdida);
  }
  return ejecutar(
    (revision) => api.editarDispositivo(contenedorId, dispositivoId, cambios, revision),
    'Equipo actualizado.',
  );
}

function rutasDe(diagrama, energia) {
  return cadenas(diagrama || {}).map((cadena) => {
    const ruta = {
      id: cadena.id,
      etiqueta: cadena.etiqueta,
      origen: cadena.puntos.length ? cadena.puntos[0].etiqueta : '—',
      direccion: direccionEtiqueta(cadena, 'SEÑAL', sentido),
      pon: String(cadena.etiqueta).toUpperCase().includes('PON'),
      tramos: Math.max(0, cadena.puntos.length - 1),
      equipos: cadena.puntos.length,
      dbm: null,
      estado: 'ok',
      cadena,
    };
    // Paso 5: dBm teóricos al final de la traza, con el umbral del dominio.
    const dbm = dbmDeRuta(energia, ruta);
    if (dbm !== null) {
      ruta.dbm = dbm;
      ruta.estado = estadoPotencia(
        energia && energia.origen ? energia.origen.dominio : null,
        dbm,
        !!(energia && energia.origen && energia.origen.cobre),
      );
    }
    return ruta;
  });
}

/** Paso 5: cambiar el ORIGEN de la potencia (puerto o hilo; el TX vuelve a su valor por defecto). */
function cambiarClave(clave) {
  origenClave = String(clave);
  txDbm = null;
  pintar(store.diagramaActual());
}

/** Paso 5: TX manual en dBm (se conserva mientras no cambie el origen). */
function cambiarTx(valor) {
  if (!Number.isFinite(valor)) return;
  txDbm = valor;
  pintar(store.diagramaActual());
}

/** Paso 5: sentido del pulso (L = final → origen · R = origen → final). */
function cambiarSentido(direccion) {
  sentido = direccion === 'L' ? 'L' : 'R';
  pintar(store.diagramaActual());
}

function encenderRuta(ruta) {
  if (!ruta) return;
  rutaActiva = ruta;
  if (pestana !== 'papel') pestana = 'papel';
  pintar(store.diagramaActual());
  aviso(`Luz encendida · ${ruta.etiqueta}`, 'ok');
}

function detenerRuta() {
  rutaActiva = null;
  pintar(store.diagramaActual());
}

function alternarLinterna() {
  if (rutaActiva) { detenerRuta(); return; }
  const lista = rutasDe(store.diagramaActual());
  if (!lista.length) {
    aviso('No hay trazas: conecta primero dos extremos.', 'aviso');
    return;
  }
  encenderRuta(lista[0]);
}

async function anclarCable(cableId) {
  return ejecutar(
    (revision) => api.anclarCable(contenedorId, cableId, revision),
    'Cable anclado al POP.',
  );
}

async function moverEquipo(dispositivoId) {
  const diagrama = store.diagramaActual();
  if (!diagrama) return;
  const destinos = (diagrama.relacionados || [])
    .filter((r) => Number(r.id) !== Number(diagrama.contenedor.id))
    .map((r) => ({ id: r.id, nombre: `${r.nombre}${r.numero ? ` ${r.numero}` : ''}` }));
  if (!destinos.length) {
    aviso('No hay otro gabinete unido por cables para mover el equipo.', 'aviso');
    return;
  }
  const host = modal.querySelector('.pop-cuerpo');
  const capa = document.createElement('div');
  capa.className = 'pop-dialogo';
  capa.innerHTML = `
    <div class="pop-dialogo-caja">
      <header><b>MOVER EQUIPO</b><button type="button" data-cerrar>✕</button></header>
      <div class="pop-dialogo-cuerpo">
        <label>Gabinete destino</label>
        <select data-destino>${destinos.map((d) => `<option value="${d.id}">${d.nombre}</option>`).join('')}</select>
        <p class="pop-dialogo-nota">Se mueve con sus puertos y su posición en el lienzo.</p>
      </div>
      <footer>
        <button type="button" class="pop-btn" data-cancelar>CANCELAR</button>
        <button type="button" class="pop-btn pop-btn--oscuro" data-mover>MOVER</button>
      </footer>
    </div>`;
  host.appendChild(capa);
  const cerrar = () => capa.remove();
  capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  capa.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  capa.querySelector('[data-mover]').addEventListener('click', async () => {
    const destino = Number(capa.querySelector('[data-destino]').value);
    cerrar();
    await ejecutar(
      (revision) => api.moverDispositivo(contenedorId, dispositivoId, destino, revision),
      'Equipo movido de gabinete.',
    );
  });
}

async function nuevoEquipo() {
  const diagrama = store.diagramaActual();
  if (!diagrama) return;
  const host = modal.querySelector('.pop-cuerpo');
  try {
    await abrirDialogoEquipo(host, {
      proyectoId: diagrama.contenedor.proyecto_id,
      alCrear: (datos) => ejecutar(
        (revision) => api.crearDispositivo(contenedorId, datos, revision),
        'Equipo creado: aparece en papel, rack y matriz.',
      ),
    });
  } catch (error) {
    aviso(error.message);
  }
}

function construir() {
  if (modal) { modal.classList.remove('is-oculto'); return; }
  cargarCss();
  modal = document.createElement('div');
  modal.className = 'pop-modal';
  modal.innerHTML = `
    <div class="pop-caja" role="dialog" aria-modal="true" aria-label="Diagrama POP">
      <header class="pop-cabecera">
        <b data-titulo>POP</b>
        <span class="pop-badge" data-revision>—</span>
        <button type="button" class="pop-tab" data-pestana="rack">RACK</button>
        <button type="button" class="pop-tab is-on" data-pestana="papel">PAPEL</button>
        <button type="button" class="pop-tab" data-pestana="matriz">MATRIZ</button>
        <span class="pop-direccion" data-direccion></span>
        <span class="pop-espacio"></span>
        <button type="button" class="pop-btn pop-btn--oscuro" data-accion="linterna">VER COMUNICACIÓN</button>
        <button type="button" class="pop-btn" data-accion="plantilla">PLANTILLA</button>
        <button type="button" class="pop-btn" data-accion="cerrar">CERRAR</button>
      </header>
      <div class="pop-cuerpo"></div>
      <div class="pop-avisos"></div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelectorAll('[data-pestana]').forEach((boton) => boton.addEventListener('click',
    () => marcarPestana(boton.dataset.pestana)));
  modal.querySelector('[data-accion="cerrar"]').addEventListener('click', cerrar);
  modal.querySelector('[data-accion="linterna"]').addEventListener('click', alternarLinterna);
  modal.querySelector('[data-accion="plantilla"]').addEventListener('click', () => {
    window.open('pop_gestor_v25.html?plantilla=1', '_blank', 'noopener');
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && modal && !modal.classList.contains('is-oculto')) cerrar();
  });
}

export async function abrir(contenedor, opciones = {}) {
  contenedorId = Number(contenedor);
  pestana = opciones.pestana || 'papel';
  await cargarReglas().catch(() => {});
  construir();
  modal.classList.remove('is-oculto');
  marcarPestana(pestana);
  await recargar();
  return { contenedorId, revision: store.revisionVigente() };
}

export function cerrar() {
  detenerLinterna();
  if (vistaPapel) { vistaPapel.destruir(); vistaPapel = null; }
  if (modal) modal.classList.add('is-oculto');
}

window.POPNativo = { abrir, cerrar, aviso };
window.abrirPopNativo = abrir;
