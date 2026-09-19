"""
Router de la CAPA LÓGICA FTTH — contención de hilos.

Diseño no destructivo (docs/DISENO_CAPA_LOGICA.md §12):
- Solo crea/lee/escribe las tablas NUEVAS `ftth_cable_tubos`, `ftth_cable_fibras`
  y `ftth_fibra_extremos`.
- No modifica el GeoJSON de `/api/elementos/todos` ni el comportamiento del mapa.
- La materialización es IDEMPOTENTE: re-ejecutarla nunca duplica ni destruye
  estado capturado (estado de hilo, extremos anclados).

Materialización de un cable (Anexo B del diseño):
    plantilla.propiedades.looses      -> número de tubos (fallback 12)
    plantilla.propiedades.fibrasLoose -> fibras por tubo (fallback 12)
    plantilla.propiedades.fibras      -> total declarado (se valida, no se impone)
"""
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

import app.models.ftth_models as fisicos
import app.models.ftth_logica as logica
from app.database import get_db

router = APIRouter(prefix="/api", tags=["ftth-logica"])

# Límites de seguridad: evitan materializaciones accidentales enormes
MAX_TUBOS = 96
MAX_FIBRAS_POR_TUBO = 48
MAX_HILOS_TOTAL = 3456

FALLBACK_TUBOS = 12
FALLBACK_FIBRAS_POR_TUBO = 12

CATEGORIAS_CON_HILOS = ("cables",)


# ── Utilidades ────────────────────────────────────────────────────────────────

def _to_int(valor: Any, default: Optional[int] = None) -> Optional[int]:
    if valor is None or valor == "":
        return default
    try:
        return int(float(valor))
    except (TypeError, ValueError):
        return default


def _to_float(valor: Any, default: Optional[float] = None) -> Optional[float]:
    if valor is None or valor == "":
        return default
    try:
        return float(valor)
    except (TypeError, ValueError):
        return default


def _propiedades_tipo(tipo) -> Dict[str, Any]:
    return dict(getattr(tipo, "propiedades", None) or {})


def _nombre_elemento(elemento, tipo) -> str:
    """Nombre visible de un elemento, sin depender de que la plantilla exista."""
    inst = dict(elemento.propiedades_instancia or {})
    props = _propiedades_tipo(tipo)
    return (
        inst.get("name")
        or inst.get("nombre")
        or props.get("codigo")
        or props.get("nombre")
        or getattr(tipo, "nombre_id", None)
        or f"Elemento #{elemento.id}"
    )


def _parametros_materializacion(tipo) -> Dict[str, Any]:
    """Lee los parámetros de contención desde la plantilla, con valores por defecto."""
    props = _propiedades_tipo(tipo)
    tubos = _to_int(props.get("looses"), FALLBACK_TUBOS)
    por_tubo = _to_int(props.get("fibrasLoose"), FALLBACK_FIBRAS_POR_TUBO)
    declarado = _to_int(props.get("fibras"), None)
    return {
        "tubos": tubos,
        "fibras_por_loose": por_tubo,
        "hilos_totales": (tubos or 0) * (por_tubo or 0),
        "fibras_declaradas": declarado,
        "perfil": props.get("perfil"),
        "atenuacion_km_db": props.get("atenuacion"),
    }


def _validar_parametros(params: Dict[str, Any], forzar: bool) -> List[str]:
    """Devuelve advertencias; lanza HTTPException si hay error bloqueante (invariante I1)."""
    advertencias: List[str] = []
    tubos = params["tubos"] or 0
    por_tubo = params["fibras_por_loose"] or 0
    total = params["hilos_totales"] or 0
    declarado = params["fibras_declaradas"]

    if tubos < 1:
        raise HTTPException(400, "La plantilla no define tubos (looses) y no se pudo usar el valor por defecto.")
    if por_tubo < 1:
        raise HTTPException(400, "La plantilla no define fibras por loose y no se pudo usar el valor por defecto.")

    if tubos > MAX_TUBOS or por_tubo > MAX_FIBRAS_POR_TUBO or total > MAX_HILOS_TOTAL:
        raise HTTPException(
            400,
            f"Contención fuera de rango: {tubos} tubos × {por_tubo} fibras = {total} hilos "
            f"(máximo permitido {MAX_HILOS_TOTAL}). Revisa la plantilla.",
        )

    if declarado is not None and declarado != total:
        mensaje = (
            f"La plantilla declara {declarado} fibras pero {tubos} tubos × {por_tubo} fibras = {total}. "
            f"Corrige la plantilla, o usa forzar=true para materializar {total} hilos."
        )
        if not forzar:
            raise HTTPException(400, mensaje)
        advertencias.append(mensaje)

    if declarado is None:
        advertencias.append(
            "La plantilla no declara el total de fibras: se usaron los valores de tubos y fibras por loose."
        )

    return advertencias


# ── Materialización ───────────────────────────────────────────────────────────

@router.post("/cables/{cable_id}/materializar-hilos", summary="Generar tubos e hilos de un cable (idempotente)")
def materializar_hilos(cable_id: int, forzar: bool = False, db: Session = Depends(get_db)) -> Dict[str, Any]:
    elemento = db.query(fisicos.FtthElemento).filter(fisicos.FtthElemento.id == cable_id).first()
    if not elemento:
        raise HTTPException(404, f"El elemento #{cable_id} no existe.")
    if elemento.categoria not in CATEGORIAS_CON_HILOS:
        raise HTTPException(
            400,
            f"El elemento #{cable_id} es de categoría '{elemento.categoria}'. "
            "Solo los elementos de categoría 'cables' contienen tubos e hilos.",
        )

    tipo = db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.id == elemento.tipo_id).first()
    params = _parametros_materializacion(tipo)
    advertencias = _validar_parametros(params, forzar)

    if tipo is None:
        advertencias.append(
            f"La plantilla (tipo_id {elemento.tipo_id}) ya no existe: se usaron "
            f"{params['tubos']} tubos × {params['fibras_por_loose']} fibras por defecto."
        )

    resumen = _materializar(
        elemento,
        params["tubos"] or 0,
        params["fibras_por_loose"] or 0,
        params["perfil"],
        db,
    )
    db.commit()

    return {
        "cable_id": cable_id,
        "nombre": _nombre_elemento(elemento, tipo),
        "plantilla": {
            "id": elemento.tipo_id,
            "nombre_id": getattr(tipo, "nombre_id", None),
            "existe": tipo is not None,
        },
        "parametros": params,
        "resultado": resumen,
        "advertencias": advertencias,
    }


def _materializar(elemento, tubos: int, por_tubo: int, perfil, db: Session) -> Dict[str, int]:
    """
    Crea o completa tubos, hilos y extremos de un cable.

    Idempotente: la llave natural de cada tubo es (elemento_id, tubo_no) y la de
    cada hilo es (tubo_id, hilo_no_en_tubo). Lo que ya existe se conserva.
    """
    cable_id = elemento.id

    # --- Tubos ---
    tubos_existentes = {
        t.tubo_no: t
        for t in db.query(logica.FtthCableTubo).filter(logica.FtthCableTubo.elemento_id == cable_id).all()
    }
    tubos_creados = 0
    for n in range(1, tubos + 1):
        nombre_color, hex_color = logica.color_tia598(n)
        tubo = tubos_existentes.get(n)
        if tubo is None:
            tubo = logica.FtthCableTubo(
                proyecto_id=elemento.proyecto_id,
                elemento_id=cable_id,
                tubo_no=n,
                color=nombre_color,
                color_hex=hex_color,
                capacidad_fibras=por_tubo,
            )
            db.add(tubo)
            tubos_existentes[n] = tubo
            tubos_creados += 1
        else:
            # Se respeta lo capturado; solo se rellenan huecos
            if not tubo.color:
                tubo.color = nombre_color
            if not tubo.color_hex:
                tubo.color_hex = hex_color
            if not tubo.capacidad_fibras:
                tubo.capacidad_fibras = por_tubo
    db.flush()

    # --- Hilos ---
    hilos_creados = 0
    hilos_existentes = 0
    hilos_ajustados = 0
    fibras_totales: List[logica.FtthCableFibra] = []
    for n in range(1, tubos + 1):
        tubo = tubos_existentes[n]
        actuales = {
            f.hilo_no_en_tubo: f
            for f in db.query(logica.FtthCableFibra).filter(logica.FtthCableFibra.tubo_id == tubo.id).all()
        }
        for h in range(1, por_tubo + 1):
            global_no = (n - 1) * por_tubo + h
            nombre_color, hex_color = logica.color_tia598(h)
            fibra = actuales.get(h)
            if fibra is None:
                fibra = logica.FtthCableFibra(
                    proyecto_id=elemento.proyecto_id,
                    elemento_id=cable_id,
                    tubo_id=tubo.id,
                    hilo_no_en_tubo=h,
                    hilo_global_no=global_no,
                    color=nombre_color,
                    color_hex=hex_color,
                    estado="libre",
                    perfil=perfil,
                )
                db.add(fibra)
                hilos_creados += 1
            else:
                hilos_existentes += 1
                if fibra.hilo_global_no != global_no:
                    fibra.hilo_global_no = global_no
                    hilos_ajustados += 1
                if not fibra.color:
                    fibra.color = nombre_color
                if not fibra.color_hex:
                    fibra.color_hex = hex_color
                if not fibra.estado:
                    fibra.estado = "libre"
                if not fibra.perfil and perfil:
                    fibra.perfil = perfil
            fibras_totales.append(fibra)
    db.flush()

    # --- Extremos A y B: se crean si faltan, nunca se reescriben ---
    extremos_creados = 0
    if fibras_totales:
        ids = [f.id for f in fibras_totales]
        existentes = {
            (e.fibra_id, e.extremo)
            for e in db.query(logica.FtthFibraExtremo).filter(logica.FtthFibraExtremo.fibra_id.in_(ids)).all()
        }
        for fibra in fibras_totales:
            for extremo in ("A", "B"):
                if (fibra.id, extremo) not in existentes:
                    db.add(
                        logica.FtthFibraExtremo(
                            proyecto_id=elemento.proyecto_id,
                            fibra_id=fibra.id,
                            extremo=extremo,
                        )
                    )
                    extremos_creados += 1
    db.flush()

    return {
        "tubos_creados": tubos_creados,
        "tubos_existentes": tubos - tubos_creados,
        "hilos_creados": hilos_creados,
        "hilos_existentes": hilos_existentes,
        "hilos_ajustados": hilos_ajustados,
        "extremos_creados": extremos_creados,
    }


# ── Consulta de hilos ─────────────────────────────────────────────────────────

def _serializar_extremos(db: Session, ids_fibras: List[int]) -> Dict[int, Dict[str, Any]]:
    """Devuelve {fibra_id: {'A': {...}, 'B': {...}}} para las fibras indicadas."""
    mapa: Dict[int, Dict[str, Any]] = {}
    if not ids_fibras:
        return mapa
    filas = (
        db.query(logica.FtthFibraExtremo)
        .filter(logica.FtthFibraExtremo.fibra_id.in_(ids_fibras))
        .all()
    )
    for e in filas:
        mapa.setdefault(e.fibra_id, {})[e.extremo] = {
            "id": e.id,
            "nodo_id": e.nodo_id,
            "holgura_m": e.holgura_m,
        }
    return mapa


@router.get("/cables/{cable_id}/hilos", summary="Árbol tubo → hilo de un cable")
def obtener_hilos(
    cable_id: int,
    estado: Optional[str] = None,
    tubo: Optional[int] = None,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    elemento = db.query(fisicos.FtthElemento).filter(fisicos.FtthElemento.id == cable_id).first()
    if not elemento:
        raise HTTPException(404, f"El elemento #{cable_id} no existe.")
    if elemento.categoria not in CATEGORIAS_CON_HILOS:
        raise HTTPException(
            400,
            f"El elemento #{cable_id} es de categoría '{elemento.categoria}': no contiene hilos.",
        )

    tipo = db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.id == elemento.tipo_id).first()
    tubos_db = (
        db.query(logica.FtthCableTubo)
        .filter(logica.FtthCableTubo.elemento_id == cable_id)
        .order_by(logica.FtthCableTubo.tubo_no)
        .all()
    )
    fibras_db = (
        db.query(logica.FtthCableFibra)
        .filter(logica.FtthCableFibra.elemento_id == cable_id)
        .order_by(logica.FtthCableFibra.hilo_global_no)
        .all()
    )
    extremos = _serializar_extremos(db, [f.id for f in fibras_db])

    conteo: Dict[str, int] = {e: 0 for e in logica.ESTADOS_FIBRA}
    sin_anclar = 0
    por_tubo: Dict[int, List[Dict[str, Any]]] = {}
    for f in fibras_db:
        conteo[f.estado] = conteo.get(f.estado, 0) + 1
        ext = extremos.get(f.id, {})
        if not any((ext.get(x) or {}).get("nodo_id") for x in ("A", "B")):
            sin_anclar += 1
        tubo_db = next((t for t in tubos_db if t.id == f.tubo_id), None)
        numero_tubo = tubo_db.tubo_no if tubo_db else None
        if estado and f.estado != estado:
            continue
        if tubo is not None and numero_tubo != tubo:
            continue
        por_tubo.setdefault(numero_tubo or 0, []).append({
            "id": f.id,
            "tubo_no": numero_tubo,
            "hilo_no_en_tubo": f.hilo_no_en_tubo,
            "hilo_global_no": f.hilo_global_no,
            "nombre": f"T{(numero_tubo or 0):02d}-H{f.hilo_no_en_tubo:02d}",
            "color": f.color,
            "color_hex": f.color_hex,
            "estado": f.estado,
            "perfil": f.perfil,
            "extremos": ext,
        })

    advertencias: List[str] = []
    if not tubos_db:
        advertencias.append(
            "Este cable aún no tiene tubos ni hilos generados. "
            "Usa «Materializar hilos» para crearlos desde su plantilla."
        )
    if sin_anclar:
        advertencias.append(
            f"{sin_anclar} hilo(s) sin extremo anclado a una caja o manga: "
            "todavía no se puede afirmar en qué nodo terminan."
        )

    return {
        "cable_id": cable_id,
        "nombre": _nombre_elemento(elemento, tipo),
        "categoria": elemento.categoria,
        "plantilla": {
            "id": elemento.tipo_id,
            "nombre_id": getattr(tipo, "nombre_id", None),
            "existe": tipo is not None,
            "propiedades": _propiedades_tipo(tipo),
        },
        "resumen": {
            "materializado": bool(tubos_db),
            "tubos": len(tubos_db),
            "hilos": len(fibras_db),
            "por_estado": conteo,
            "sin_extremo_anclado": sin_anclar,
        },
        "tubos": [
            {
                "id": t.id,
                "tubo_no": t.tubo_no,
                "color": t.color,
                "color_hex": t.color_hex,
                "capacidad_fibras": t.capacidad_fibras,
                "etiqueta": t.etiqueta,
                "hilos": por_tubo.get(t.tubo_no, []),
            }
            for t in tubos_db
        ],
        "advertencias": advertencias,
    }


@router.put("/fibras/{fibra_id}", summary="Actualizar estado o perfil de un hilo")
def actualizar_fibra(fibra_id: int, payload: Dict[str, Any], db: Session = Depends(get_db)) -> Dict[str, Any]:
    fibra = db.query(logica.FtthCableFibra).filter(logica.FtthCableFibra.id == fibra_id).first()
    if not fibra:
        raise HTTPException(404, f"El hilo #{fibra_id} no existe.")

    if "estado" in payload:
        nuevo = str(payload["estado"] or "").strip().lower()
        if nuevo not in logica.ESTADOS_FIBRA:
            raise HTTPException(
                400,
                f"Estado '{payload['estado']}' no válido. Permitidos: {', '.join(logica.ESTADOS_FIBRA)}.",
            )
        fibra.estado = nuevo
    if "perfil" in payload:
        fibra.perfil = payload["perfil"]

    tubo_db = db.query(logica.FtthCableTubo).filter(logica.FtthCableTubo.id == fibra.tubo_id).first()
    numero_tubo = tubo_db.tubo_no if tubo_db else 0
    db.commit()
    db.refresh(fibra)
    return {
        "id": fibra.id,
        "estado": fibra.estado,
        "perfil": fibra.perfil,
        "cable_id": fibra.elemento_id,
        "tubo_no": numero_tubo,
        "nombre": f"T{numero_tubo:02d}-H{fibra.hilo_no_en_tubo:02d}",
        "hilo_global_no": fibra.hilo_global_no,
    }


class ExtremoUpdate(BaseModel):
    nodo_id: Optional[int] = None
    holgura_m: Optional[float] = None


@router.put("/fibras/{fibra_id}/extremos/{extremo}", summary="Anclar el extremo de un hilo a un nodo (caja, manga, ODF...)")
def actualizar_extremo(
    fibra_id: int,
    extremo: str,
    payload: ExtremoUpdate,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    letra = (extremo or "").strip().upper()
    if letra not in ("A", "B"):
        raise HTTPException(400, f"Extremo '{extremo}' no válido: use A o B.")

    fila = (
        db.query(logica.FtthFibraExtremo)
        .filter(logica.FtthFibraExtremo.fibra_id == fibra_id, logica.FtthFibraExtremo.extremo == letra)
        .first()
    )
    if not fila:
        raise HTTPException(
            404,
            f"El hilo #{fibra_id} no tiene extremo {letra}. "
            "Materializa los hilos del cable antes de anclar extremos.",
        )

    if payload.nodo_id is not None:
        nodo = db.query(fisicos.FtthElemento).filter(fisicos.FtthElemento.id == payload.nodo_id).first()
        if not nodo:
            raise HTTPException(404, f"El nodo #{payload.nodo_id} no existe.")
        fila.nodo_id = payload.nodo_id
    # Desanclar explícitamente: si el cliente envía "nodo_id": null, se limpia el anclaje.
    # (Antes no había forma de desanclar un extremo por API.)
    enviados = getattr(payload, "model_fields_set", None)
    if enviados is None:
        enviados = getattr(payload, "__fields_set__", set()) or set()
    if "nodo_id" in enviados and payload.nodo_id is None:
        fila.nodo_id = None
    if payload.holgura_m is not None:
        fila.holgura_m = payload.holgura_m

    db.commit()
    db.refresh(fila)

    advertencias: List[str] = []
    if fila.nodo_id is not None:
        nodo = db.query(fisicos.FtthElemento).filter(fisicos.FtthElemento.id == fila.nodo_id).first()
        if nodo and nodo.categoria in ("poste", "ducto", "luminaria", "switches"):
            advertencias.append(
                f"El elemento #{nodo.id} es '{nodo.categoria}': un {'ducto' if nodo.categoria == 'ducto' else 'poste'} "
                "no conmuta hilos. El extremo quedó registrado, pero no habrá continuidad aquí."
            )

    return {
        "fibra_id": fila.fibra_id,
        "extremo": fila.extremo,
        "nodo_id": fila.nodo_id,
        "holgura_m": fila.holgura_m,
        "advertencias": advertencias,
    }


# ── Cables de un proyecto (vista para la interfaz) ────────────────────────────

def _conteos_logicos(db: Session, ids_cables: List[int]) -> Dict[str, Dict[int, int]]:
    """{'tubos': {cable_id: n}, 'hilos': {...}, 'libres': {...}} en 3 consultas."""
    if not ids_cables:
        return {"tubos": {}, "hilos": {}, "libres": {}}
    tubos = dict(
        db.query(logica.FtthCableTubo.elemento_id, func.count(logica.FtthCableTubo.id))
        .filter(logica.FtthCableTubo.elemento_id.in_(ids_cables))
        .group_by(logica.FtthCableTubo.elemento_id)
        .all()
    )
    hilos = dict(
        db.query(logica.FtthCableFibra.elemento_id, func.count(logica.FtthCableFibra.id))
        .filter(logica.FtthCableFibra.elemento_id.in_(ids_cables))
        .group_by(logica.FtthCableFibra.elemento_id)
        .all()
    )
    libres = dict(
        db.query(logica.FtthCableFibra.elemento_id, func.count(logica.FtthCableFibra.id))
        .filter(
            logica.FtthCableFibra.elemento_id.in_(ids_cables),
            logica.FtthCableFibra.estado == "libre",
        )
        .group_by(logica.FtthCableFibra.elemento_id)
        .all()
    )
    return {"tubos": tubos, "hilos": hilos, "libres": libres}


@router.get("/proyectos/{proyecto_id}/cables", summary="Cables del proyecto con su estado lógico (tubos/hilos)")
def listar_cables(proyecto_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    cables = (
        db.query(fisicos.FtthElemento)
        .filter(
            fisicos.FtthElemento.proyecto_id == proyecto_id,
            fisicos.FtthElemento.categoria == "cables",
        )
        .order_by(fisicos.FtthElemento.id)
        .all()
    )
    tipos = {
        t.id: t
        for t in db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.proyecto_id == proyecto_id).all()
    }
    conteos = _conteos_logicos(db, [c.id for c in cables])
    advertencias: List[str] = []
    salida: List[Dict[str, Any]] = []

    for cable in cables:
        tipo = tipos.get(cable.tipo_id)
        props = _propiedades_tipo(tipo)
        params = _parametros_materializacion(tipo)
        motivo = None
        try:
            avisos_cable = _validar_parametros(params, False)
        except HTTPException as e:
            avisos_cable = []
            motivo = str(e.detail)
        if tipo is None:
            motivo = motivo or (
                f"La plantilla (tipo_id {cable.tipo_id}) ya no existe; se materializaría con "
                f"{FALLBACK_TUBOS} tubos × {FALLBACK_FIBRAS_POR_TUBO} fibras por defecto."
            )
        geo = cable.coords_json or []
        avisos = avisos_cable if motivo is None else [motivo]
        salida.append({
            "cable_id": cable.id,
            "nombre": _nombre_elemento(cable, tipo),
            "categoria": cable.categoria,
            "plantilla": {
                "id": cable.tipo_id,
                "nombre_id": getattr(tipo, "nombre_id", None),
                "existe": tipo is not None,
                "looses": props.get("looses"),
                "fibras_por_loose": props.get("fibrasLoose"),
                "fibras_declaradas": props.get("fibras"),
                "perfil": props.get("perfil"),
            },
            "geometria": {"tipo": "LineString" if geo else "sin_coords", "puntos": len(geo)},
            "materializado": conteos["tubos"].get(cable.id, 0) > 0,
            "tubos": conteos["tubos"].get(cable.id, 0),
            "hilos": conteos["hilos"].get(cable.id, 0),
            "hilos_libres": conteos["libres"].get(cable.id, 0),
            "hilos_esperados": params["hilos_totales"],
            "puede_materializar": motivo is None,
            "advertencias": avisos,
        })
        advertencias.extend(f"Cable #{cable.id}: {a}" for a in avisos)

    return {
        "proyecto_id": proyecto_id,
        "total": len(salida),
        "cables": salida,
        "advertencias": advertencias,
    }


@router.post("/proyectos/{proyecto_id}/materializar-todos", summary="Materializar hilos de todos los cables (dry_run por defecto)")
def materializar_todos(
    proyecto_id: int,
    dry_run: bool = True,
    solo_faltantes: bool = True,
    forzar: bool = False,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    cables = (
        db.query(fisicos.FtthElemento)
        .filter(
            fisicos.FtthElemento.proyecto_id == proyecto_id,
            fisicos.FtthElemento.categoria == "cables",
        )
        .order_by(fisicos.FtthElemento.id)
        .all()
    )
    tipos = {
        t.id: t
        for t in db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.proyecto_id == proyecto_id).all()
    }
    conteos = _conteos_logicos(db, [c.id for c in cables])
    detalle: List[Dict[str, Any]] = []
    procesados = 0
    omitidos = 0
    errores = 0

    for cable in cables:
        tipo = tipos.get(cable.tipo_id)
        nombre = _nombre_elemento(cable, tipo)
        tubos_actuales = conteos["tubos"].get(cable.id, 0)
        if solo_faltantes and tubos_actuales > 0:
            omitidos += 1
            detalle.append({
                "cable_id": cable.id,
                "nombre": nombre,
                "accion": "omitido",
                "detalle": f"Ya tiene {tubos_actuales} tubos y {conteos['hilos'].get(cable.id, 0)} hilos.",
            })
            continue

        params = _parametros_materializacion(tipo)
        try:
            avisos_cable = _validar_parametros(params, forzar)
        except HTTPException as e:
            errores += 1
            detalle.append({
                "cable_id": cable.id,
                "nombre": nombre,
                "accion": "error",
                "detalle": str(e.detail),
            })
            continue

        if dry_run:
            procesados += 1
            detalle.append({
                "cable_id": cable.id,
                "nombre": nombre,
                "accion": "crearía",
                "detalle": (
                    f"{params['tubos']} tubos × {params['fibras_por_loose']} fibras "
                    f"= {params['hilos_totales']} hilos (+ {2 * (params['hilos_totales'] or 0)} extremos)"
                ),
                "advertencias": avisos_cable,
            })
            continue

        resumen = _materializar(
            cable,
            params["tubos"] or 0,
            params["fibras_por_loose"] or 0,
            params["perfil"],
            db,
        )
        db.commit()
        procesados += 1
        detalle.append({
            "cable_id": cable.id,
            "nombre": nombre,
            "accion": "materializado",
            "detalle": resumen,
            "advertencias": avisos_cable,
        })

    return {
        "proyecto_id": proyecto_id,
        "dry_run": dry_run,
        "solo_faltantes": solo_faltantes,
        "cables_encontrados": len(cables),
        "cables_procesados": procesados,
        "cables_omitidos": omitidos,
        "cables_con_error": errores,
        "detalle": detalle,
        "nota": "Simulación: no se escribió nada en la base de datos." if dry_run else "Cambios aplicados.",
    }


# ═════════════════════════════════════════════════════════════════════════════
# F3 — Interior del nodo: bandejas, dispositivos y puertos
# ═════════════════════════════════════════════════════════════════════════════

# Categorías que NO conmutan hilos (ver docs/DISENO_CAPA_LOGICA.md §4.6, invariante I17)
CATEGORIAS_SIN_CONMUTAR = ("poste", "ducto", "luminaria", "switches", "cables")

# Categorías que sí actúan como nodo de interconexión
CATEGORIAS_NODO = ("cajanap", "manga", "odf", "armario", "olt", "splitter", "fusion")

TIPOS_BANDEJA = ("empalme", "paso", "splitter", "mixta")
TIPOS_DISPOSITIVO = ("splitter", "adaptador", "wdm", "pigtail", "switch")

# Atenuación nominal de splitters PLC balanceados (dB)
ATENUACION_SPLITTER = {
    "1x2": 3.6, "1x4": 7.3, "1x8": 10.7, "1x16": 13.7, "1x32": 16.9, "1x64": 20.5,
    "2x2": 3.6, "2x4": 7.3, "2x8": 10.7, "2x16": 13.7, "2x32": 16.9,
}
ATENUACION_ADAPTADOR_DB = 0.3


class BandejaCreate(BaseModel):
    bandeja_no: Optional[int] = None
    tipo: str = "empalme"
    slots: Optional[int] = 12
    etiqueta: Optional[str] = None


class DispositivoCreate(BaseModel):
    tipo: str = "splitter"
    tipo_id: Optional[int] = None
    bandeja_id: Optional[int] = None
    division: Optional[str] = None
    puertos_in: Optional[int] = None
    puertos_out: Optional[int] = None
    tipo_conector: Optional[str] = None
    serie: Optional[str] = None
    atenuacion_db: Optional[float] = None
    estado: Optional[str] = None


def _parsear_division(division: Optional[str]) -> Optional[tuple]:
    """'1x8' -> (1, 8). Devuelve None si el formato no es válido."""
    if not division:
        return None
    texto = str(division).lower().replace(" ", "")
    for sep in ("x", ":"):
        if sep in texto:
            partes = texto.split(sep, 1)
            try:
                entradas, salidas = int(partes[0]), int(partes[1])
            except (TypeError, ValueError):
                return None
            if entradas < 1 or salidas < 1:
                return None
            return (entradas, salidas)
    return None


def _nodo_para_conmutar(elem_id: int, db: Session):
    """Devuelve el elemento validando que puede alojar bandejas y dispositivos."""
    elemento = db.query(fisicos.FtthElemento).filter(fisicos.FtthElemento.id == elem_id).first()
    if not elemento:
        raise HTTPException(404, f"El elemento #{elem_id} no existe.")
    categoria = (elemento.categoria or "").lower()
    if categoria in CATEGORIAS_SIN_CONMUTAR:
        nombre = "un ducto" if categoria == "ducto" else f"«{categoria}»"
        raise HTTPException(
            400,
            f"El elemento #{elem_id} es {nombre}: no conmuta hilos. "
            "Las bandejas, splitters y adaptadores van en cajas NAP, mangas, ODF, armarios u OLT.",
        )
    return elemento


@router.post("/elementos/{elem_id}/bandejas", summary="Crear una bandeja dentro de un nodo")
def crear_bandeja(elem_id: int, payload: BandejaCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    elemento = _nodo_para_conmutar(elem_id, db)

    tipo = str(payload.tipo or "empalme").strip().lower()
    if tipo not in TIPOS_BANDEJA:
        raise HTTPException(400, f"Tipo de bandeja «{payload.tipo}» no válido. Permitidos: {', '.join(TIPOS_BANDEJA)}.")

    existentes = (
        db.query(logica.FtthBandeja)
        .filter(logica.FtthBandeja.elemento_id == elem_id)
        .order_by(logica.FtthBandeja.bandeja_no)
        .all()
    )
    advertencias: List[str] = []

    if payload.bandeja_no is None:
        numero = (existentes[-1].bandeja_no + 1) if existentes else 1
    else:
        numero = int(payload.bandeja_no)
        if any(b.bandeja_no == numero for b in existentes):
            raise HTTPException(409, f"La bandeja {numero} ya existe en el elemento #{elem_id}.")

    slots = payload.slots
    if slots is not None and (slots < 1 or slots > 144):
        raise HTTPException(400, f"La bandeja no puede tener {slots} posiciones (rango 1..144).")

    bandeja = logica.FtthBandeja(
        proyecto_id=elemento.proyecto_id,
        elemento_id=elem_id,
        bandeja_no=numero,
        tipo=tipo,
        slots=slots,
        etiqueta=payload.etiqueta,
    )
    db.add(bandeja)
    db.commit()
    db.refresh(bandeja)

    if not existentes:
        advertencias.append(
            "Es la primera bandeja del nodo. Los empalmes se registrarán por bandeja y posición (slot) en la fase siguiente."
        )

    return {
        "id": bandeja.id,
        "elemento_id": bandeja.elemento_id,
        "bandeja_no": bandeja.bandeja_no,
        "tipo": bandeja.tipo,
        "slots": bandeja.slots,
        "etiqueta": bandeja.etiqueta,
        "advertencias": advertencias,
    }


@router.post("/elementos/{elem_id}/dispositivos", summary="Instalar un dispositivo y generar sus puertos")
def crear_dispositivo(elem_id: int, payload: DispositivoCreate, db: Session = Depends(get_db)) -> Dict[str, Any]:
    elemento = _nodo_para_conmutar(elem_id, db)

    tipo = str(payload.tipo or "splitter").strip().lower()
    if tipo not in TIPOS_DISPOSITIVO:
        raise HTTPException(400, f"Tipo de dispositivo «{payload.tipo}» no válido. Permitidos: {', '.join(TIPOS_DISPOSITIVO)}.")

    advertencias: List[str] = []

    # ── Plantilla opcional (reutiliza ftth_tipos) ─────────────────────────
    props: Dict[str, Any] = {}
    if payload.tipo_id is not None:
        plantilla = db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.id == payload.tipo_id).first()
        if not plantilla:
            raise HTTPException(404, f"La plantilla (tipo_id {payload.tipo_id}) no existe.")
        props = _propiedades_tipo(plantilla)

    # ── Bandeja (debe pertenecer al mismo nodo) ───────────────────────────
    bandeja_id = payload.bandeja_id
    if bandeja_id is not None:
        bandeja = db.query(logica.FtthBandeja).filter(logica.FtthBandeja.id == bandeja_id).first()
        if not bandeja:
            raise HTTPException(404, f"La bandeja #{bandeja_id} no existe.")
        if bandeja.elemento_id != elem_id:
            raise HTTPException(
                400,
                f"La bandeja #{bandeja_id} pertenece al elemento #{bandeja.elemento_id}, no al #{elem_id}.",
            )

    # ── División y número de puertos ──────────────────────────────────────
    division = payload.division or props.get("relacion_division") or props.get("division")
    entradas = payload.puertos_in
    salidas = payload.puertos_out
    parsed = _parsear_division(division)
    if parsed:
        division = f"{parsed[0]}x{parsed[1]}"
        entradas = entradas if entradas is not None else parsed[0]
        salidas = salidas if salidas is not None else parsed[1]
    if entradas is None:
        entradas = _to_int(props.get("entradas"), None)
    if salidas is None:
        salidas = _to_int(props.get("salidas"), None) or _to_int(props.get("puertos"), None)

    if tipo == "splitter":
        entradas = entradas if entradas is not None else 1
        if not salidas:
            raise HTTPException(
                400,
                "Indica la división del splitter (por ejemplo 1x8) o los puertos de salida. "
                "También puedes elegir una plantilla de splitter que ya la defina.",
            )
        division = division or f"{entradas}x{salidas}"
    else:
        # Adaptadores / WDM / pigtails / switches: puertos bidireccionales
        entradas = 0
        if not salidas:
            raise HTTPException(400, f"Indica cuántos puertos tiene el {tipo} (por ejemplo 12).")

    total = (entradas or 0) + (salidas or 0)
    if salidas > 256 or total > 256:
        raise HTTPException(400, f"Demasiados puertos ({total}). El máximo por dispositivo es 256.")

    # ── Atenuación ────────────────────────────────────────────────────────
    atenuacion = payload.atenuacion_db
    if atenuacion is None:
        atenuacion = _to_float(props.get("atenuacion"), None)
    if atenuacion is None and tipo == "splitter":
        atenuacion = ATENUACION_SPLITTER.get(division)
        if atenuacion is None:
            advertencias.append(
                f"No hay atenuación nominal conocida para «{division}»: se registrará sin pérdida y podrás ajustarla."
            )
    if atenuacion is None and tipo in ("adaptador", "wdm"):
        atenuacion = ATENUACION_ADAPTADOR_DB

    # ── Aviso si ya existe uno igual en el mismo nodo ─────────────────────
    repetidos = (
        db.query(logica.FtthDispositivo)
        .filter(
            logica.FtthDispositivo.elemento_id == elem_id,
            logica.FtthDispositivo.tipo == tipo,
            logica.FtthDispositivo.division == division,
        )
        .count()
    )
    if repetidos:
        advertencias.append(f"Ya existe(n) {repetidos} dispositivo(s) «{tipo} {division}» en este nodo.")

    return _persistir_dispositivo(
        elemento, elem_id, tipo, division, entradas, salidas, atenuacion,
        bandeja_id, payload, props, advertencias, db,
    )


def _persistir_dispositivo(elemento, elem_id, tipo, division, entradas, salidas, atenuacion,
                           bandeja_id, payload, props, advertencias, db: Session) -> Dict[str, Any]:
    """Crea el dispositivo y genera sus puertos a partir de la división (invariante I13)."""
    dispositivo = logica.FtthDispositivo(
        proyecto_id=elemento.proyecto_id,
        elemento_id=elem_id,
        bandeja_id=bandeja_id,
        tipo_id=payload.tipo_id,
        tipo=tipo,
        serie=payload.serie,
        division=division,
        puertos_in=entradas,
        puertos_out=salidas,
        atenuacion_db=atenuacion,
        estado=(payload.estado or "operativo"),
    )
    db.add(dispositivo)
    db.flush()

    conector = payload.tipo_conector or props.get("tipo_conector")
    creados = {"IN": 0, "OUT": 0, "BIDI": 0}
    puertos: List[Dict[str, Any]] = []

    def _puerto(direccion: str, numero: int) -> None:
        db.add(
            logica.FtthPuerto(
                proyecto_id=elemento.proyecto_id,
                dispositivo_id=dispositivo.id,
                elemento_id=elem_id,
                direccion=direccion,
                puerto_no=numero,
                tipo_conector=conector,
                estado="libre",
            )
        )
        creados[direccion] += 1
        puertos.append({
            "direccion": direccion,
            "puerto_no": numero,
            "etiqueta": f"{direccion}-{numero}",
            "tipo_conector": conector,
            "estado": "libre",
        })

    if tipo == "splitter":
        for i in range(1, (entradas or 0) + 1):
            _puerto("IN", i)
        for i in range(1, (salidas or 0) + 1):
            _puerto("OUT", i)
    else:
        for i in range(1, (salidas or 0) + 1):
            _puerto("BIDI", i)

    db.commit()
    db.refresh(dispositivo)

    return {
        "id": dispositivo.id,
        "elemento_id": elem_id,
        "tipo": dispositivo.tipo,
        "division": dispositivo.division,
        "puertos_in": dispositivo.puertos_in,
        "puertos_out": dispositivo.puertos_out,
        "atenuacion_db": dispositivo.atenuacion_db,
        "bandeja_id": dispositivo.bandeja_id,
        "estado": dispositivo.estado,
        "puertos_creados": creados,
        "puertos": puertos,
        "advertencias": advertencias,
    }


@router.get("/elementos/{elem_id}/puertos", summary="Listar los puertos de un nodo")
def listar_puertos(
    elem_id: int,
    estado: Optional[str] = None,
    direccion: Optional[str] = None,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    elemento = db.query(fisicos.FtthElemento).filter(fisicos.FtthElemento.id == elem_id).first()
    if not elemento:
        raise HTTPException(404, f"El elemento #{elem_id} no existe.")

    consulta = db.query(logica.FtthPuerto).filter(logica.FtthPuerto.elemento_id == elem_id)
    if estado:
        consulta = consulta.filter(logica.FtthPuerto.estado == estado.strip().lower())
    if direccion:
        consulta = consulta.filter(logica.FtthPuerto.direccion == direccion.strip().upper())
    filas = consulta.order_by(logica.FtthPuerto.dispositivo_id, logica.FtthPuerto.direccion, logica.FtthPuerto.puerto_no).all()

    libres = sum(1 for p in filas if p.estado == "libre")
    return {
        "elemento_id": elem_id,
        "categoria": elemento.categoria,
        "total": len(filas),
        "libres": libres,
        "ocupados": len(filas) - libres,
        "puertos": [
            {
                "id": p.id,
                "dispositivo_id": p.dispositivo_id,
                "direccion": p.direccion,
                "puerto_no": p.puerto_no,
                "etiqueta": f"{p.direccion}-{p.puerto_no}",
                "tipo_conector": p.tipo_conector,
                "estado": p.estado,
            }
            for p in filas
        ],
    }


def _numero_desde_texto(valor: Any) -> Optional[int]:
    """'16 Puertos' -> 16 ; 16 -> 16 ; None -> None."""
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return int(valor)
    digitos = "".join(c for c in str(valor) if c.isdigit())
    return int(digitos) if digitos else None


def _nombre_cable(cable, tipo_cable) -> str:
    return _nombre_elemento(cable, tipo_cable) if cable else "cable desconocido"


@router.get("/elementos/{elem_id}/nodo", summary="DTO del diagrama de un nodo (bandejas, dispositivos, puertos, hilos)")
def obtener_nodo(elem_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    elemento = db.query(fisicos.FtthElemento).filter(fisicos.FtthElemento.id == elem_id).first()
    if not elemento:
        raise HTTPException(404, f"El elemento #{elem_id} no existe.")

    categoria = (elemento.categoria or "").lower()
    tipo = db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.id == elemento.tipo_id).first()
    props = _propiedades_tipo(tipo)
    advertencias: List[str] = []

    if categoria in CATEGORIAS_SIN_CONMUTAR:
        advertencias.append(
            f"«{categoria}» no conmuta hilos: no puede alojar bandejas, splitters ni empalmes. "
            "Solo sostiene o encauza."
        )

    bandejas_db = (
        db.query(logica.FtthBandeja)
        .filter(logica.FtthBandeja.elemento_id == elem_id)
        .order_by(logica.FtthBandeja.bandeja_no)
        .all()
    )
    dispositivos_db = (
        db.query(logica.FtthDispositivo)
        .filter(logica.FtthDispositivo.elemento_id == elem_id)
        .order_by(logica.FtthDispositivo.id)
        .all()
    )
    puertos_db = (
        db.query(logica.FtthPuerto)
        .filter(logica.FtthPuerto.elemento_id == elem_id)
        .order_by(logica.FtthPuerto.dispositivo_id, logica.FtthPuerto.direccion, logica.FtthPuerto.puerto_no)
        .all()
    )

    # ── Hilos que terminan en este nodo (extremos anclados aquí) ───────────
    extremos = (
        db.query(logica.FtthFibraExtremo)
        .filter(logica.FtthFibraExtremo.nodo_id == elem_id)
        .order_by(logica.FtthFibraExtremo.fibra_id)
        .all()
    )
    hilos: List[Dict[str, Any]] = []
    for ext in extremos:
        fibra = db.query(logica.FtthCableFibra).filter(logica.FtthCableFibra.id == ext.fibra_id).first()
        if not fibra:
            continue
        tubo = db.query(logica.FtthCableTubo).filter(logica.FtthCableTubo.id == fibra.tubo_id).first()
        cable = db.query(fisicos.FtthElemento).filter(fisicos.FtthElemento.id == fibra.elemento_id).first()
        tipo_cable = None
        if cable:
            tipo_cable = db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.id == cable.tipo_id).first()
        numero_tubo = tubo.tubo_no if tubo else 0
        hilos.append({
            "fibra_id": fibra.id,
            "extremo": ext.extremo,
            "extremo_id": ext.id,
            "holgura_m": ext.holgura_m,
            "cable_id": fibra.elemento_id,
            "cable": _nombre_cable(cable, tipo_cable),
            "tubo_no": tubo.tubo_no if tubo else None,
            "hilo_no_en_tubo": fibra.hilo_no_en_tubo,
            "hilo_global_no": fibra.hilo_global_no,
            "nombre": f"T{numero_tubo:02d}-H{fibra.hilo_no_en_tubo:02d}",
            "color": fibra.color,
            "color_hex": fibra.color_hex,
            "estado": fibra.estado,
            "perfil": fibra.perfil,
            "empalme": None,   # se completará en la fase de empalmes (F4)
        })

    # ── Advertencias útiles (la UI no calcula reglas de negocio) ───────────
    puertos_libres = sum(1 for p in puertos_db if p.estado == "libre")
    out_libres = sum(1 for p in puertos_db if p.estado == "libre" and p.direccion == "OUT")
    if hilos and not bandejas_db:
        advertencias.append(
            f"{len(hilos)} hilo(s) terminan en este nodo pero no hay bandejas creadas para poder empalmarlos."
        )
    if hilos:
        advertencias.append(
            f"{len(hilos)} hilo(s) anclados aquí aún sin empalme registrado (la fusión se declara en la fase de empalmes)."
        )
    if out_libres:
        advertencias.append(f"{out_libres} puerto(s) OUT libres disponibles para clientes.")

    capacidad = _numero_desde_texto(props.get("capacidad_puertos")) or _numero_desde_texto(props.get("puertos"))
    if capacidad and len(puertos_db) > capacidad:
        advertencias.append(
            f"El nodo declara capacidad para {capacidad} puerto(s) pero se han instalado {len(puertos_db)}."
        )

    return _dto_nodo(elemento, tipo, props, categoria, capacidad, bandejas_db, dispositivos_db,
                     puertos_db, hilos, puertos_libres, advertencias)


def _dto_nodo(elemento, tipo, props, categoria, capacidad, bandejas_db, dispositivos_db,
              puertos_db, hilos, puertos_libres, advertencias) -> Dict[str, Any]:
    """Construye el DTO auto-contenido que pinta el diagrama del nodo."""
    return {
        "nodo": {
            "box_id": elemento.id,
            "categoria": elemento.categoria,
            "tipo_nombre": getattr(tipo, "nombre_id", None) or "Sin plantilla",
            "plantilla_existe": tipo is not None,
            "lat": elemento.lat,
            "lon": elemento.lon,
            "poste_ref_id": elemento.poste_ref_id,
            "capacidad_puertos": capacidad,
            "estado": (elemento.propiedades_instancia or {}).get("estado") or "Activo",
            "color": getattr(tipo, "color_mapa", None) or "#3388ff",
            "conmuta_hilos": categoria not in CATEGORIAS_SIN_CONMUTAR,
            "propiedades_tipo": props,
            "propiedades_instancia": elemento.propiedades_instancia or {},
        },
        "bandejas": [
            {
                "id": b.id,
                "bandeja_no": b.bandeja_no,
                "tipo": b.tipo,
                "slots": b.slots,
                "etiqueta": b.etiqueta,
                "ocupados": 0,
                "empalmes": [],
            }
            for b in bandejas_db
        ],
        "dispositivos": [
            {
                "id": d.id,
                "tipo": d.tipo,
                "tipo_id": d.tipo_id,
                "division": d.division,
                "serie": d.serie,
                "puertos_in": d.puertos_in,
                "puertos_out": d.puertos_out,
                "atenuacion_db": d.atenuacion_db,
                "bandeja_id": d.bandeja_id,
                "estado": d.estado,
            }
            for d in dispositivos_db
        ],
        "puertos": [
            {
                "id": p.id,
                "dispositivo_id": p.dispositivo_id,
                "direccion": p.direccion,
                "puerto_no": p.puerto_no,
                "etiqueta": f"{p.direccion}-{p.puerto_no}",
                "tipo_conector": p.tipo_conector,
                "estado": p.estado,
                "cliente": None,
            }
            for p in puertos_db
        ],
        "empalmes": [],   # se completan en F4
        "hilos_que_terminan": hilos,
        "resumen": {
            "bandejas": len(bandejas_db),
            "slots_totales": sum((b.slots or 0) for b in bandejas_db),
            "slots_ocupados": 0,
            "dispositivos": len(dispositivos_db),
            "puertos": len(puertos_db),
            "puertos_libres": puertos_libres,
            "hilos_anclados": len(hilos),
            "empalmes": 0,
        },
        "advertencias": advertencias,
    }



