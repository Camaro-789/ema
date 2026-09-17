from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from app.database import get_db
import app.models.ftth_models as models

router = APIRouter(prefix="/api/tipos", tags=["ftth-tipos"])

class TipoBase(BaseModel):
    proyecto_id: int
    categoria: str
    nombre_id: str
    color_mapa: Optional[str] = "#3388ff"
    foto: Optional[str] = None
    observaciones: Optional[str] = None
    propiedades: Dict[str, Any] = {}

class TipoCreate(TipoBase):
    pass

class TipoResponse(TipoBase):
    id: int
    class Config:
        orm_mode = True

@router.get("/{categoria}", response_model=List[TipoResponse])
def listar_tipos(categoria: str, proyecto_id: int, db: Session = Depends(get_db)):
    return db.query(models.FtthTipo).filter(
        models.FtthTipo.categoria == categoria,
        models.FtthTipo.proyecto_id == proyecto_id
    ).all()

@router.post("/", response_model=TipoResponse)
def crear_tipo(payload: TipoCreate, db: Session = Depends(get_db)):
    nuevo = models.FtthTipo(**payload.dict())
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return nuevo

@router.put("/{tipo_id}", response_model=TipoResponse)
def actualizar_tipo(tipo_id: int, payload: TipoCreate, db: Session = Depends(get_db)):
    db_tipo = db.query(models.FtthTipo).filter(models.FtthTipo.id == tipo_id).first()
    if not db_tipo:
        raise HTTPException(status_code=404, detail="Tipo no encontrado")
    
    for k, v in payload.dict().items():
        setattr(db_tipo, k, v)
    
    db.commit()
    db.refresh(db_tipo)
    return db_tipo

@router.delete("/{tipo_id}")
def eliminar_tipo(tipo_id: int, db: Session = Depends(get_db)):
    db_tipo = db.query(models.FtthTipo).filter(models.FtthTipo.id == tipo_id).first()
    if not db_tipo:
        raise HTTPException(status_code=404, detail="Tipo no encontrado")
    db.delete(db_tipo)
    db.commit()
    return {"message": "Eliminado correctamente"}
