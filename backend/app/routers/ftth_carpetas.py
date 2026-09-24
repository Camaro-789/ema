from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.ftth_models import Carpeta, CarpetaElemento, FtthElemento

router = APIRouter(prefix="/api/carpetas", tags=["ftth-carpetas"])

class CarpetaCreate(BaseModel):
    proyecto_id: int
    nombre: str = Field(..., min_length=1, max_length=200)
    carpeta_padre_id: Optional[int] = None
    orden: int = 0

class CarpetaUpdate(BaseModel):
    nombre: Optional[str] = None
    carpeta_padre_id: Optional[int] = None
    orden: Optional[int] = None
    visible: Optional[bool] = None

class ElementoMover(BaseModel):
    proyecto_id: Optional[int] = None
    carpeta_destino_id: int

def _serialize_carpeta(c: Carpeta, db: Session) -> dict:
    subcarpetas = db.query(Carpeta).filter(Carpeta.carpeta_padre_id == c.id).order_by(Carpeta.id).all()
    elementos = db.query(CarpetaElemento).filter(CarpetaElemento.carpeta_id == c.id).all()
    
    # Obtener categorías y demás info del elemento
    elems_data = []
    for e in elementos:
        el = db.query(FtthElemento).filter(FtthElemento.id == e.elemento_id).first()
        if el:
            elems_data.append({
                "elemento_id": e.elemento_id,
                "elemento_tipo": el.categoria,  # Se mantiene para frontend compatibility
                # Número VISIBLE del objeto (el correlativo por tipo, no el id interno)
                "numero": (el.propiedades_instancia or {}).get("numero"),
            })

    return {
        "id": c.id,
        "proyecto_id": c.proyecto_id,
        "nombre": c.nombre,
        "carpeta_padre_id": c.carpeta_padre_id,
        "visible": c.visible,
        "subcarpetas": [_serialize_carpeta(s, db) for s in subcarpetas],
        "elementos": elems_data,
    }

@router.get("")
def listar_carpetas(proyecto_id: int, db: Session = Depends(get_db)):
    carpetas_raiz = db.query(Carpeta).filter(
        Carpeta.proyecto_id == proyecto_id, 
        Carpeta.carpeta_padre_id == None
    ).order_by(Carpeta.id).all()
    return [_serialize_carpeta(c, db) for c in carpetas_raiz]

@router.post("")
def crear_carpeta(payload: CarpetaCreate, db: Session = Depends(get_db)):
    c = Carpeta(**payload.dict())
    db.add(c)
    db.commit()
    db.refresh(c)
    return _serialize_carpeta(c, db)

@router.put("/{carpeta_id}")
def actualizar_carpeta(carpeta_id: int, payload: CarpetaUpdate, db: Session = Depends(get_db)):
    c = db.query(Carpeta).filter(Carpeta.id == carpeta_id).first()
    if not c:
        raise HTTPException(404)
    if payload.nombre is not None: c.nombre = payload.nombre
    if payload.carpeta_padre_id is not None: c.carpeta_padre_id = payload.carpeta_padre_id
    if payload.visible is not None: c.visible = payload.visible
    db.commit()
    db.refresh(c)
    return _serialize_carpeta(c, db)

@router.delete("/{carpeta_id}")
def eliminar_carpeta(carpeta_id: int, db: Session = Depends(get_db)):
    c = db.query(Carpeta).filter(Carpeta.id == carpeta_id).first()
    if not c:
        raise HTTPException(404)
    
    # Subcarpetas al padre
    subs = db.query(Carpeta).filter(Carpeta.carpeta_padre_id == c.id).all()
    for s in subs:
        s.carpeta_padre_id = c.carpeta_padre_id
    
    # Elementos sin carpeta
    db.query(CarpetaElemento).filter(CarpetaElemento.carpeta_id == c.id).delete()
    
    db.delete(c)
    db.commit()
    return {"message": "Carpeta eliminada"}

# Nota: El JS enviaba /api/carpetas/elementos/tipo/elemId. 
# Ahora que el tipo ya no es clave primaria compuesta, solo necesitamos elem_id, 
# pero mantendremos la firma URL igual para que el frontend no rompa
@router.put("/elementos/{tipo}/{elem_id}")
def mover_elemento(tipo: str, elem_id: int, payload: ElementoMover, db: Session = Depends(get_db)):
    rel = db.query(CarpetaElemento).filter(CarpetaElemento.elemento_id == elem_id).first()
    if rel:
        rel.carpeta_id = payload.carpeta_destino_id
    else:
        rel = CarpetaElemento(carpeta_id=payload.carpeta_destino_id, elemento_id=elem_id)
        db.add(rel)
    db.commit()
    return {"status": "ok"}

@router.delete("/{carpeta_id}/elementos/{tipo}/{elem_id}")
def quitar_elemento(carpeta_id: int, tipo: str, elem_id: int, db: Session = Depends(get_db)):
    rel = db.query(CarpetaElemento).filter(
        CarpetaElemento.carpeta_id == carpeta_id,
        CarpetaElemento.elemento_id == elem_id
    ).first()
    if rel:
        db.delete(rel)
        db.commit()
    return {"status": "ok"}
