from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from app.database import get_db
import app.models.ftth_models as models
import json

router = APIRouter(prefix="/api/elementos", tags=["ftth-elementos"])

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
    # Autogenerar un nombre_id o dejarlo vacío (se puede actualizar luego)
    # Por ahora asginamos un placeholder hasta que lo cree y le asigne el ID
    nuevo = models.FtthElemento(
        proyecto_id=payload.proyecto_id,
        tipo_id=payload.tipo_id,
        categoria=payload.categoria,
        lat=payload.lat,
        lon=payload.lon,
        coords_json=payload.coords_json,
        poste_ref_id=payload.poste_ref_id,
        propiedades_instancia=payload.propiedades_instancia
    )
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    
    # Formatear el geojson feature para retornar
    db_tipo = db.query(models.FtthTipo).filter(models.FtthTipo.id == nuevo.tipo_id).first()
    return feature_from_elemento(nuevo, db_tipo)

@router.get("/todos", summary="Obtener todos los elementos en GeoJSON")
def obtener_todos(proyecto_id: int, db: Session = Depends(get_db)):
    elementos = db.query(models.FtthElemento).filter(models.FtthElemento.proyecto_id == proyecto_id).all()
    
    # Pre-cargar tipos para armar features ricas
    tipos_dict = {t.id: t for t in db.query(models.FtthTipo).filter(models.FtthTipo.proyecto_id == proyecto_id).all()}
    
    features = []
    for el in elementos:
        t = tipos_dict.get(el.tipo_id)
        if t:
            features.append(feature_from_elemento(el, t))
            
    return {"type": "FeatureCollection", "features": features}

@router.put("/{elem_id}")
def actualizar_elemento(elem_id: int, payload: Dict[str, Any], db: Session = Depends(get_db)):
    # Actualización genérica de instancia
    el = db.query(models.FtthElemento).filter(models.FtthElemento.id == elem_id).first()
    if not el:
        raise HTTPException(404, "Elemento no encontrado")

    nuevo_propiedades = dict(el.propiedades_instancia or {})

    if "lat" in payload and "lon" in payload:
        el.lat = payload["lat"]
        el.lon = payload["lon"]
    if "coords_json" in payload:
        el.coords_json = payload["coords_json"]
    if "propiedades_instancia" in payload:
        nuevo_propiedades.update(payload["propiedades_instancia"] or {})

    for key, value in payload.items():
        if key in {"lat", "lon", "coords_json", "propiedades_instancia"}:
            continue
        if key in {"id", "categoria", "tipo_id", "tipo_nombre"}:
            continue
        nuevo_propiedades[key] = value

    el.propiedades_instancia = nuevo_propiedades

    db.commit()
    db.refresh(el)
    return {"status": "ok"}

@router.delete("/{elem_id}")
def eliminar_elemento(elem_id: int, db: Session = Depends(get_db)):
    el = db.query(models.FtthElemento).filter(models.FtthElemento.id == elem_id).first()
    if not el:
        raise HTTPException(404)
    db.delete(el)
    db.commit()
    return {"status": "eliminado"}

def feature_from_elemento(el: models.FtthElemento, tipo: models.FtthTipo) -> dict:
    # GeoJSON estándar
    geom = None
    if el.lat is not None and el.lon is not None:
        geom = {"type": "Point", "coordinates": [el.lon, el.lat]}
    elif el.coords_json is not None:
        geom = {"type": "LineString", "coordinates": el.coords_json}
        
    props = {
        "id": el.id,
        "categoria": el.categoria,
        "tipo_id": el.tipo_id,
        "tipo_nombre": tipo.nombre_id,
        "color": tipo.color_mapa,
        "foto": tipo.foto,
        "observaciones": tipo.observaciones,
        "poste_ref_id": el.poste_ref_id,
        "propiedades_tipo": tipo.propiedades,
        "propiedades_instancia": el.propiedades_instancia
    }
    
    return {
        "type": "Feature",
        "geometry": geom,
        "properties": props
    }
