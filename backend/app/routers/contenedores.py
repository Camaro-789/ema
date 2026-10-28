"""API del módulo nativo de contenedores (en esta entrega: armario/POP).

Contrato de lectura: `GET /api/contenedores/{id}/diagrama` (Fase 2.6) con un
número CONSTANTE de consultas, sin importar cuántos cables o hilos haya.

Comandos de escritura (Fase 2.7): todos llevan `operation_id` (idempotencia) y
`base_revision` (concurrencia optimista → 409). Responden `{revision, cambios}`.

Aquí solo se valida la entrada: la decisión está en `app.domain.servicios`.
"""
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import VERSION_CONTRATO_DIAGRAMA
from app.database import get_db
from app.domain import servicios
from app.domain.errores import ErrorConflicto
from app.models import ftth_logica as logica
from app.models import ftth_models as fisicos
from app.routers.ftth_logica import _precargar_cables

router = APIRouter(prefix="/api/contenedores", tags=["contenedores"])


class Extremo(BaseModel):
    tipo: str
    eq_id: Optional[int] = None
    puerto: Optional[str] = None
    cara: Optional[str] = None
    fibra_id: Optional[int] = None
    puerto_id: Optional[int] = None


class _Comando(BaseModel):
    operation_id: Optional[str] = None
    base_revision: Optional[int] = None


class DispositivoNuevo(_Comando):
    tipo: str
    nombre: Optional[str] = None
    division: Optional[str] = None
    tipo_id: Optional[int] = None
    bandeja_id: Optional[int] = None
    perdida_db: Optional[float] = None
    estado: Optional[str] = None
    puertos_out: Optional[int] = None


class DispositivoCambio(_Comando):
    nombre: Optional[str] = None
    etiqueta: Optional[str] = None
    estado: Optional[str] = None
    perdida_db: Optional[float] = None
    division: Optional[str] = None
    bandeja_id: Optional[int] = None


class Movimiento(_Comando):
    destino_id: int
    x: Optional[float] = None
    y: Optional[float] = None


class ConexionNueva(_Comando):
    origen: Extremo
    destino: Extremo
    tipo: Optional[str] = None
    bandeja_id: Optional[int] = None
    slot: Optional[int] = None
    etiqueta: Optional[str] = None
    extremo_a: Optional[str] = None
    extremo_b: Optional[str] = None
    es_origen: bool = True
    vista_subida: bool = False


class OrigenNuevo(_Comando):
    origen_tipo: str
    tipo_equipo: Optional[str] = None
    senal: Optional[str] = None
    tx_dbm: Optional[float] = None
    nota: Optional[str] = None
    empalme_id: Optional[int] = None
    puerto_id: Optional[int] = None
    fibra_extremo_id: Optional[int] = None
    dispositivo_id: Optional[int] = None
    cable_id: Optional[int] = None
    puerto: Optional[str] = None
    cara: Optional[str] = None


class Posicion(BaseModel):
    dispositivo_id: int
    x: float
    y: float


class PosicionesNuevas(_Comando):
    posiciones: List[Posicion] = []


def _ejecutar(db: Session, comando: _Comando, contenedor_id: int, tipo: str, accion):
    """Una transacción, idempotente por `operation_id` y con control de revisión.

    El orden importa: primero la IDEMPOTENCIA (un reintento con el mismo
    `operation_id` devuelve el resultado guardado aunque su `base_revision` ya
    esté vieja) y solo después el control de revisión.
    """
    if comando.operation_id:
        previa = (
            db.query(logica.FtthOperacion)
            .filter(logica.FtthOperacion.operation_id == comando.operation_id)
            .first()
        )
        if previa:
            return json.loads(previa.resultado or "{}"), True
    if comando.base_revision is not None:
        servicios.exigir_revision(
            servicios.contenedor(db, contenedor_id), comando.base_revision)
        # Reclamo ATÓMICO de la revisión: un UPDATE condicionado por el valor
        # esperado. Si dos escrituras compiten, solo una lo consigue y la otra
        # recibe 409 (no se pierde ninguna actualización).
        reclamadas = (
            db.query(fisicos.FtthElemento)
            .filter(
                fisicos.FtthElemento.id == contenedor_id,
                fisicos.FtthElemento.revision == int(comando.base_revision),
            )
            .update({"revision": int(comando.base_revision) + 1},
                    synchronize_session=False)
        )
        if not reclamadas:
            raise ErrorConflicto(
                "Otra escritura cambió el diagrama al mismo tiempo. Recarga y reintenta.",
                {"revision_enviada": comando.base_revision},
            )
    resultado = accion()
    # Una SOLA subida de revisión por escritura, en la base (atómica).
    if comando.base_revision is not None:
        nueva_revision = int(comando.base_revision) + 1  # la reclamó el UPDATE
    else:
        nueva_revision = servicios.subir_revision(db, contenedor_id)
    if isinstance(resultado, dict):
        resultado["revision"] = nueva_revision
    if comando.operation_id:
        db.add(logica.FtthOperacion(
            operation_id=comando.operation_id, contenedor_id=contenedor_id,
            tipo=tipo, resultado=json.dumps(resultado, default=str),
        ))
    db.commit()
    return resultado, False


@router.get("/{contenedor_id}/diagrama", summary="Diagrama del contenedor (contrato de lectura)")
def diagrama(
    contenedor_id: int,
    hilos_por_cable: int = Query(48, ge=1, le=96),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """DTO completo con 9 consultas fijas (5 de lectura + 4 de precarga de cables)."""
    elemento = servicios.contenedor(db, contenedor_id)

    bandejas = db.query(logica.FtthBandeja).filter(
        logica.FtthBandeja.elemento_id == elemento.id
    ).order_by(logica.FtthBandeja.bandeja_no).all()
    dispositivos = db.query(logica.FtthDispositivo).filter(
        logica.FtthDispositivo.elemento_id == elemento.id
    ).order_by(logica.FtthDispositivo.id).all()
    puertos = db.query(logica.FtthPuerto).filter(
        logica.FtthPuerto.elemento_id == elemento.id
    ).order_by(logica.FtthPuerto.dispositivo_id, logica.FtthPuerto.direccion,
               logica.FtthPuerto.puerto_no).all()
    posiciones = {
        fila.dispositivo_id: {"x": fila.x, "y": fila.y}
        for fila in db.query(logica.FtthDiagramaPosicion).filter(
            logica.FtthDiagramaPosicion.elemento_id == elemento.id).all()
    }
    cables = db.query(fisicos.FtthElemento).filter(
        fisicos.FtthElemento.proyecto_id == elemento.proyecto_id,
        fisicos.FtthElemento.categoria == "cables",
        (fisicos.FtthElemento.extremo_A_id == elemento.id)
        | (fisicos.FtthElemento.extremo_B_id == elemento.id),
    ).order_by(fisicos.FtthElemento.id).all()
    conexiones = db.query(logica.FtthEmpalme).filter(
        logica.FtthEmpalme.nodo_id == elemento.id
    ).order_by(logica.FtthEmpalme.id).all()
    origenes = db.query(logica.FtthConexionMeta).filter(
        logica.FtthConexionMeta.contenedor_id == elemento.id
    ).all()

    precarga = _precargar_cables(db, cables)
    cables_dto = []
    for cable in cables:
        fibras = precarga["fibras"].get(cable.id, [])
        tipo_cable = precarga["tipos"].get(cable.tipo_id)
        tramo = fibras[:hilos_por_cable]
        items = []
        for fibra in tramo:
            tubo = precarga["tubos"].get(fibra.tubo_id)
            tubo_no = tubo.tubo_no if tubo else 0
            items.append({
                "fibra_id": fibra.id, "hilo_global_no": fibra.hilo_global_no,
                "hilo_no_en_tubo": fibra.hilo_no_en_tubo, "tubo_no": tubo.tubo_no if tubo else None,
                "nombre": f"T{tubo_no:02d}-H{fibra.hilo_no_en_tubo:02d}",
                "color": fibra.color, "color_hex": fibra.color_hex,
                "estado": fibra.estado, "perfil": fibra.perfil,
            })
        cables_dto.append({
            "id": cable.id,
            "nombre": getattr(tipo_cable, "nombre_id", None) or f"Cable #{cable.id}",
            "estructura": (getattr(tipo_cable, "propiedades", None) or {}).get("estructura"),
            "extremo_a_id": cable.extremo_A_id, "extremo_b_id": cable.extremo_B_id,
            "hilos_total": len(fibras),
            "hilos": {"desde": 1, "hasta": len(tramo), "total": len(fibras), "items": items},
        })

    return {
        "version_contrato": VERSION_CONTRATO_DIAGRAMA,
        "revision": servicios.revision(elemento),
        "contenedor": {
            "id": elemento.id, "categoria": elemento.categoria, "tipo_id": elemento.tipo_id,
            "lat": elemento.lat, "lon": elemento.lon,
            "estado": (elemento.propiedades_instancia or {}).get("estado") or "Activo",
            "propiedades_instancia": elemento.propiedades_instancia or {},
        },
        "bandejas": [
            {"id": b.id, "bandeja_no": b.bandeja_no, "tipo": b.tipo, "slots": b.slots,
             "etiqueta": b.etiqueta} for b in bandejas
        ],
        "dispositivos": [
            {"id": d.id, "tipo": d.tipo, "tipo_id": d.tipo_id, "nombre": d.serie,
             "division": d.division, "puertos_in": d.puertos_in, "puertos_out": d.puertos_out,
             "perdida_db": d.atenuacion_db, "estado": d.estado, "bandeja_id": d.bandeja_id,
             "posicion": posiciones.get(d.id)} for d in dispositivos
        ],
        "puertos": [
            {"id": p.id, "dispositivo_id": p.dispositivo_id, "direccion": p.direccion,
             "puerto_no": p.puerto_no, "etiqueta": p.etiqueta,
             "tipo_conector": p.tipo_conector, "estado": p.estado} for p in puertos
        ],
        "cables": cables_dto,
        "conexiones": [
            {"id": c.id, "tipo": c.tipo, "bandeja_id": c.bandeja_id, "slot": c.slot,
             "fibra_a_id": c.fibra_a_id, "fibra_b_id": c.fibra_b_id,
             "puerto_id": c.puerto_id, "extremo_a": c.extremo_a, "extremo_b": c.extremo_b,
             "etiqueta": c.etiqueta, "propiedades": c.propiedades or {}} for c in conexiones
        ],
        "origenes": [
            {"id": m.id, "empalme_id": m.empalme_id, "puerto_id": m.puerto_id,
             "fibra_extremo_id": m.fibra_extremo_id, "origen_tipo": m.origen_tipo,
             "senal": m.senal, "tx_dbm": m.tx_dbm, "nota": m.nota} for m in origenes
        ],
        "posiciones": posiciones,
        "hilos_por_cable": hilos_por_cable,
    }


@router.post("/{contenedor_id}/dispositivos", summary="Crear un equipo en el contenedor")
def crear_dispositivo(contenedor_id: int, datos: DispositivoNuevo,
                      db: Session = Depends(get_db)) -> Dict[str, Any]:
    resultado, repetida = _ejecutar(
        db, datos, contenedor_id, "crear_dispositivo",
        lambda: servicios.crear_dispositivo(
            db, contenedor_id, datos.model_dump(exclude={"operation_id", "base_revision"})))
    return {**resultado, "idempotente": repetida}


@router.patch("/{contenedor_id}/dispositivos/{dispositivo_id}",
              summary="Editar nombre, etiqueta, estado, pérdida o división")
def editar_dispositivo(contenedor_id: int, dispositivo_id: int, datos: DispositivoCambio,
                       db: Session = Depends(get_db)) -> Dict[str, Any]:
    cambios = datos.model_dump(exclude={"operation_id", "base_revision"}, exclude_none=True)
    resultado, repetida = _ejecutar(
        db, datos, contenedor_id, "editar_dispositivo",
        lambda: servicios.editar_dispositivo(db, contenedor_id, dispositivo_id, cambios))
    return {**resultado, "idempotente": repetida}


@router.post("/{contenedor_id}/dispositivos/{dispositivo_id}/mover",
             summary="Mover un equipo a otro contenedor")
def mover_dispositivo(contenedor_id: int, dispositivo_id: int, datos: Movimiento,
                      db: Session = Depends(get_db)) -> Dict[str, Any]:
    resultado, repetida = _ejecutar(
        db, datos, contenedor_id, "mover_dispositivo",
        lambda: servicios.mover_dispositivo(
            db, contenedor_id, dispositivo_id, datos.destino_id,
            {"x": datos.x, "y": datos.y}))
    return {**resultado, "idempotente": repetida}


@router.delete("/{contenedor_id}/dispositivos/{dispositivo_id}",
               summary="Eliminar un equipo (rechaza si tiene conexiones)")
def eliminar_dispositivo(contenedor_id: int, dispositivo_id: int,
                         operation_id: Optional[str] = None,
                         base_revision: Optional[int] = None,
                         db: Session = Depends(get_db)) -> Dict[str, Any]:
    comando = _Comando(operation_id=operation_id, base_revision=base_revision)
    resultado, repetida = _ejecutar(
        db, comando, contenedor_id, "eliminar_dispositivo",
        lambda: servicios.eliminar_dispositivo(db, contenedor_id, dispositivo_id))
    return {**resultado, "idempotente": repetida}


@router.post("/{contenedor_id}/conexiones", summary="Conectar dos extremos")
def conectar(contenedor_id: int, datos: ConexionNueva,
             db: Session = Depends(get_db)) -> Dict[str, Any]:
    carga = datos.model_dump(exclude={"operation_id", "base_revision"})
    resultado, repetida = _ejecutar(
        db, datos, contenedor_id, "conectar",
        lambda: servicios.conectar(db, contenedor_id, carga))
    return {**resultado, "idempotente": repetida}


@router.delete("/{contenedor_id}/conexiones/{conexion_id}",
               summary="Desconectar (elimina la conexión y libera el puerto)")
def desconectar(contenedor_id: int, conexion_id: int,
                operation_id: Optional[str] = None,
                base_revision: Optional[int] = None,
                db: Session = Depends(get_db)) -> Dict[str, Any]:
    comando = _Comando(operation_id=operation_id, base_revision=base_revision)
    resultado, repetida = _ejecutar(
        db, comando, contenedor_id, "desconectar",
        lambda: servicios.desconectar(db, contenedor_id, conexion_id))
    return {**resultado, "idempotente": repetida}


@router.post("/{contenedor_id}/origen", summary="Marcar origen de señal y potencia TX")
def marcar_origen(contenedor_id: int, datos: OrigenNuevo,
                  db: Session = Depends(get_db)) -> Dict[str, Any]:
    carga = datos.model_dump(exclude={"operation_id", "base_revision"})
    resultado, repetida = _ejecutar(
        db, datos, contenedor_id, "marcar_origen",
        lambda: servicios.marcar_origen(db, contenedor_id, carga))
    return {**resultado, "idempotente": repetida}


@router.post("/{contenedor_id}/posiciones", summary="Guardar el orden del lienzo (x/y)")
def guardar_posiciones(contenedor_id: int, datos: PosicionesNuevas,
                       db: Session = Depends(get_db)) -> Dict[str, Any]:
    posiciones = [p.model_dump() for p in datos.posiciones]
    resultado, repetida = _ejecutar(
        db, datos, contenedor_id, "guardar_posiciones",
        lambda: servicios.guardar_posiciones(db, contenedor_id, posiciones))
    return {**resultado, "idempotente": repetida}


