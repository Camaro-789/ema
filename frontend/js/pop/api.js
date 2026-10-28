/**
 * api.js — Cliente del módulo nativo POP (Fase 4).
 *
 * Reglas:
 *  · Toda escritura lleva `operation_id` (idempotencia) y `base_revision`
 *    (concurrencia optimista), igual que el contrato del backend.
 *  · Un error del servidor se convierte en `ErrorApi` con `codigo`, `mensaje_es`
 *    y `detalle`: la UI muestra el mensaje y NO cambia nada en pantalla.
 *  · El frontend nunca inventa estado: dibuja lo que devuelve el servidor.
 */

const ORIGEN = window.location.origin;

export class ErrorApi extends Error {
  constructor(status, cuerpo) {
    const mensaje = (cuerpo && (cuerpo.mensaje_es || cuerpo.detail)) || `Error ${status}`;
    super(typeof mensaje === 'string' ? mensaje : JSON.stringify(mensaje));
    this.status = status;
    this.codigo = (cuerpo && cuerpo.codigo) || 'error';
    this.detalle = cuerpo && cuerpo.detalle;
  }

  get esConflicto() { return this.status === 409; }
}

export function nuevoOperationId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function pedir(metodo, ruta, cuerpo) {
  const opciones = { method: metodo, cache: 'no-store' };
  if (cuerpo !== undefined) {
    opciones.headers = { 'Content-Type': 'application/json' };
    opciones.body = JSON.stringify(cuerpo);
  }
  const respuesta = await fetch(`${ORIGEN}${ruta}`, opciones);
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new ErrorApi(respuesta.status, datos);
  return datos;
}

function comando(datos, revision) {
  return { ...datos, operation_id: nuevoOperationId(), base_revision: revision };
}

export const api = {
  flags: () => pedir('GET', '/api/config/flags'),
  reglas: () => pedir('GET', '/api/config/reglas'),

  diagrama: (contenedorId, hilosPorCable = 48) => pedir(
    'GET',
    `/api/contenedores/${contenedorId}/diagrama?hilos_por_cable=${hilosPorCable}`,
  ),

  crearDispositivo: (contenedorId, datos, revision) => pedir(
    'POST', `/api/contenedores/${contenedorId}/dispositivos`, comando(datos, revision),
  ),

  editarDispositivo: (contenedorId, dispositivoId, cambios, revision) => pedir(
    'PATCH', `/api/contenedores/${contenedorId}/dispositivos/${dispositivoId}`,
    comando(cambios, revision),
  ),

  moverDispositivo: (contenedorId, dispositivoId, destinoId, revision, posicion = {}) => pedir(
    'POST', `/api/contenedores/${contenedorId}/dispositivos/${dispositivoId}/mover`,
    comando({ destino_id: destinoId, ...posicion }, revision),
  ),

  eliminarDispositivo: (contenedorId, dispositivoId, revision) => pedir(
    'DELETE',
    `/api/contenedores/${contenedorId}/dispositivos/${dispositivoId}`
      + `?operation_id=${nuevoOperationId()}&base_revision=${revision}`,
  ),

  conectar: (contenedorId, origen, destino, revision, extra = {}) => pedir(
    'POST', `/api/contenedores/${contenedorId}/conexiones`,
    comando({ origen, destino, ...extra }, revision),
  ),

  desconectar: (contenedorId, conexionId, revision) => pedir(
    'DELETE',
    `/api/contenedores/${contenedorId}/conexiones/${conexionId}`
      + `?operation_id=${nuevoOperationId()}&base_revision=${revision}`,
  ),

  marcarOrigen: (contenedorId, datos, revision) => pedir(
    'POST', `/api/contenedores/${contenedorId}/origen`, comando(datos, revision),
  ),

  guardarPosiciones: (contenedorId, posiciones, revision) => pedir(
    'POST', `/api/contenedores/${contenedorId}/posiciones`,
    comando({ posiciones }, revision),
  ),
};
