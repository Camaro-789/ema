from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from app.database import get_db
import app.models.ftth_models as models
import app.models.ftth_logica as logica
import json

router = APIRouter(prefix="/api/elementos", tags=["ftth-elementos"])


def _entero(valor):
    """Entero desde un valor de formulario/JSON, o None si no lo es."""
    try:
        return int(float(valor))
    except (TypeError, ValueError):
        return None

class ElementoBase(BaseModel):
    proyecto_id: int
    tipo_id: int
    categoria: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    coords_json: Optional[List[List[float]]] = None
    poste_ref_id: Optional[int] = None
    propiedades_instancia: Dict[str, Any] = {}

class ElementoCreate(ElementoBase):
    pass

@router.post("/", summary="Crear un elemento unificado")
def crear_elemento(payload: ElementoCreate, db: Session = Depends(get_db)):
    # Validar el tipo ANTES de insertar: si la plantilla no existe (fue borrada),
    # antes se guardaba la fila huérfana y luego reventaba con AttributeError (500).
    db_tipo = db.query(models.FtthTipo).filter(models.FtthTipo.id == payload.tipo_id).first()
    if not db_tipo:
        raise HTTPException(
            status_code=400,
            detail=f"El tipo_id {payload.tipo_id} no existe (plantilla eliminada). Elige o crea otra plantilla.",
        )

    # La creación en sí (número visible, geometría armada desde la ruta, postes
    # deducidos y materialización de los hilos si es cable) vive en
    # `logica.crear_elemento_en_db`: la comparte con la DIVISIÓN de un cable, que
    # crea sus dos cables por este MISMO camino.
    nuevo = logica.crear_elemento_en_db(
        db,
        proyecto_id=payload.proyecto_id,
        tipo_id=payload.tipo_id,
        categoria=payload.categoria,
        lat=payload.lat,
        lon=payload.lon,
        coords_json=payload.coords_json,
        poste_ref_id=payload.poste_ref_id,
        propiedades_instancia=payload.propiedades_instancia,
        commit=True,
    )
    return feature_from_elemento(nuevo, db_tipo)

@router.get("/todos", summary="Obtener todos los elementos en GeoJSON")
def obtener_todos(proyecto_id: int, db: Session = Depends(get_db)):
    elementos = db.query(models.FtthElemento).filter(models.FtthElemento.proyecto_id == proyecto_id).all()
    
    # Pre-cargar tipos para armar features ricas
    tipos_dict = {t.id: t for t in db.query(models.FtthTipo).filter(models.FtthTipo.proyecto_id == proyecto_id).all()}
    
    features = []
    # IMPORTANTE: se incluyen tambien los elementos cuya plantilla fue eliminada.
    # Antes se omitian (if t:) y quedaban invisibles en el mapa para siempre.
    for el in elementos:
        features.append(feature_from_elemento(el, tipos_dict.get(el.tipo_id)))

    return {"type": "FeatureCollection", "features": features}


@router.get("/{elem_id}", summary="Obtener UN elemento como Feature GeoJSON")
def obtener_elemento(elem_id: int, db: Session = Depends(get_db)):
    """Feature completa de un elemento, con la MISMA forma que las de /todos.

    Lo usan el botón «Propiedades» del diagrama y el respaldo del inspector de
    fibra. Es la fuente CANÓNICA: la geometría que trae un evento de capa del
    mapa viene recortada por teselas, así que el cliente no puede deducir nada
    de ella (por dónde pasa un cable, por ejemplo).

    El prefijo del router es /api/elementos, así que la ruta servida es
    GET /api/elementos/{elem_id}. Se declara DESPUÉS de /todos a propósito:
    FastAPI compara en orden de declaración y esa ruta debe seguir ganando.
    """
    el = db.query(models.FtthElemento).filter(models.FtthElemento.id == elem_id).first()
    if not el:
        raise HTTPException(404, "Elemento no encontrado")
    tipo = db.query(models.FtthTipo).filter(models.FtthTipo.id == el.tipo_id).first()
    return feature_from_elemento(el, tipo)


@router.put("/{elem_id}")
def actualizar_elemento(elem_id: int, payload: Dict[str, Any], db: Session = Depends(get_db)):
    # Actualización genérica de instancia
    el = db.query(models.FtthElemento).filter(models.FtthElemento.id == elem_id).first()
    if not el:
        raise HTTPException(404, "Elemento no encontrado")

    nuevo_propiedades = dict(el.propiedades_instancia or {})

    # Posición ANTERIOR: la necesita el recálculo de los cables que pasan por este
    # poste para saber qué vértices eran suyos (y moverlos a la posición nueva).
    lat_antes, lon_antes = el.lat, el.lon

    if "lat" in payload and "lon" in payload:
        el.lat = payload["lat"]
        el.lon = payload["lon"]
    if "coords_json" in payload:
        el.coords_json = payload["coords_json"]
    if "poste_ref_id" in payload:
        el.poste_ref_id = payload["poste_ref_id"]
    if "propiedades_instancia" in payload:
        nuevo_propiedades.update(payload["propiedades_instancia"] or {})

    if "extremo_A_id" in payload:
        el.extremo_A_id = payload["extremo_A_id"]
    elif "extremo_A_id" in nuevo_propiedades:
        el.extremo_A_id = nuevo_propiedades["extremo_A_id"]

    if "extremo_B_id" in payload:
        el.extremo_B_id = payload["extremo_B_id"]
    elif "extremo_B_id" in nuevo_propiedades:
        el.extremo_B_id = nuevo_propiedades["extremo_B_id"]

    if "reserva_A_m" in payload:
        el.reserva_A_m = payload["reserva_A_m"]
    if "reserva_B_m" in payload:
        el.reserva_B_m = payload["reserva_B_m"]

    el.propiedades_instancia = nuevo_propiedades

    if (el.categoria or "").lower() == "cables":
        from app.routers import ftth_logica as logica_router
        logica_router.sincronizar_extremos_cable_a_hilos(db, el)

    # ¿Se movió un POSTE? Entonces los cables que pasan por él se rehacen para que
    # su línea siga al poste. Cubre los trazados nuevos (con ruta) y los cables que
    # YA existían (se detectan por sus vértices en la posición vieja). Un trazado
    # libre, que no toca ningún poste, no se modifica.
    recalculados: List[Dict[str, Any]] = []
    if ("lat" in payload or "lon" in payload) and (el.categoria or "").lower() in ("poste", "postes"):
        db.flush()
        recalculados = logica.recalcular_cables_del_poste(db, el, lon_antes, lat_antes)
        # Log de servidor: deja ver que el recálculo está disparando y a qué cables
        print(f"[geometria] poste #{nuevo_propiedades.get('numero')} (id {el.id}) movido "
              f"({lon_antes},{lat_antes}) -> ({el.lon},{el.lat}) · "
              f"cables recalculados={[c['cable_id'] for c in recalculados]}", flush=True)
        for c in recalculados:
            print(f"[geometria]    cable {c['cable_id']}: {c['vertices']} vertices "
                  f"({c['vertices_movidos']} movidos, modo {c['modo']}) · "
                  f"postes_intermedios={c['postes_intermedios']}", flush=True)

    db.commit()
    db.refresh(el)
    return {"status": "ok", "cables_recalculados": recalculados}

@router.delete("/{elem_id}")
def eliminar_elemento(elem_id: int, db: Session = Depends(get_db)):
    el = db.query(models.FtthElemento).filter(models.FtthElemento.id == elem_id).first()
    if not el:
        raise HTTPException(404)
    # Los hijos (tubos, hilos, extremos, puertos, bandejas...) se borran AQUÍ:
    # en SQLite los `ON DELETE CASCADE` de los modelos no se aplican solos, y sus
    # huérfanos los heredaba un elemento NUEVO al reutilizarse el id.
    hijos = logica.borrar_hijos_del_elemento(db, elem_id)
    db.delete(el)
    db.commit()
    print(f"[limpieza] elemento #{elem_id} borrado · filas hijas eliminadas={hijos}", flush=True)
    return {"status": "eliminado"}

def feature_from_elemento(el: models.FtthElemento, tipo: models.FtthTipo = None) -> dict:
    # GeoJSON estándar
    geom = None
    if el.lat is not None and el.lon is not None:
        geom = {"type": "Point", "coordinates": [el.lon, el.lat]}
    elif el.coords_json is not None:
        geom = {"type": "LineString", "coordinates": el.coords_json}

    # El tipo (plantilla) puede haber sido eliminado: se usan valores por defecto
    # en vez de reventar con AttributeError.
    props = {
        "id": el.id,
        "categoria": el.categoria,
        "tipo_id": el.tipo_id,
        "tipo_nombre": getattr(tipo, "nombre_id", None) or "Sin plantilla",
        "color": getattr(tipo, "color_mapa", None) or "#3388ff",
        "foto": getattr(tipo, "foto", None),
        "observaciones": getattr(tipo, "observaciones", None),
        "poste_ref_id": el.poste_ref_id,
        # Correlativo VISIBLE (por tipo de objeto). El id de arriba sigue siendo el
        # interno y global: sirve para todo lo que es lógica/BD, no para mostrar.
        "numero": (el.propiedades_instancia or {}).get("numero"),
        "propiedades_tipo": getattr(tipo, "propiedades", None) or {},
        "propiedades_instancia": el.propiedades_instancia,
        "sin_plantilla": tipo is None,
    }
    
    return {
        "type": "Feature",
        "id": el.id,
        "geometry": geom,
        "properties": props
    }
