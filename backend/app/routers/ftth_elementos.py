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

    # El correlativo VISIBLE se reparte por tipo de objeto (categoría) con un
    # contador atómico: 40 cajas → la próxima es la #41, y las mangas llevan su
    # propia cuenta. El id interno sigue siendo único y global (no cambia).
    instancia = dict(payload.propiedades_instancia or {})
    if not _entero(instancia.get("numero")):
        instancia["numero"] = logica.siguiente_numero(db, payload.proyecto_id, payload.categoria)

    # Si el trazado pasó por postes, la geometría se arma con la posición ACTUAL de
    # esos postes (no con las coordenadas sueltas del clic): así la línea sigue al
    # poste cuando después se mueve. Un trazado libre se guarda tal cual.
    coords = payload.coords_json
    calculadas = logica.geometria_desde_trazado(db, instancia, coords)
    if len(calculadas) >= 2:
        coords = calculadas

    # Si el trazado no anotó los postes (o el clic cayó al lado del ícono), se DEDUCEN
    # de la geometría: los vértices que caen sobre un poste (a ≤2 m) son ese poste.
    # Así `postes_intermedios` queda bien con un trazado real, sin retrazar nada.
    if not instancia.get("postes_intermedios"):
        deducidos = logica.postes_de_la_geometria(db, payload.proyecto_id, coords)
        if deducidos:
            instancia["postes_intermedios"] = deducidos

    nuevo = models.FtthElemento(
        proyecto_id=payload.proyecto_id,
        tipo_id=payload.tipo_id,
        categoria=payload.categoria,
        lat=payload.lat,
        lon=payload.lon,
        coords_json=coords,
        poste_ref_id=payload.poste_ref_id,
        propiedades_instancia=instancia
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)

    # Log de servidor: sirve para comprobar en vivo el paso «el clic guarda el poste»
    print(f"[linea] {nuevo.categoria} #{instancia.get('numero')} (id {nuevo.id}) guardado: "
          f"vertices={len(coords or [])} "
          f"postes_intermedios={instancia.get('postes_intermedios')} "
          f"trazado_ruta={'si' if instancia.get('trazado_ruta') else 'no'}", flush=True)

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

    for key, value in payload.items():
        if key in {"lat", "lon", "coords_json", "propiedades_instancia"}:
            continue
        if key in {"id", "categoria", "tipo_id", "tipo_nombre"}:
            continue
        nuevo_propiedades[key] = value

    el.propiedades_instancia = nuevo_propiedades

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
        "geometry": geom,
        "properties": props
    }
