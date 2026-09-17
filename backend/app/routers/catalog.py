"""Router FastAPI para el Catálogo de Tipos."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.catalog import CatalogCategoria, CatalogTipo, CATEGORIAS_FIJAS

router = APIRouter(tags=["catalogo"])


# --- Esquemas ---

class CategoriaResponse(BaseModel):
    id: int
    clave: str
    nombre: str
    icono: str

    class Config:
        from_attributes = True


class TipoCreate(BaseModel):
    categoria_id: int
    nombre: str
    descripcion: Optional[str] = None
    foto_url: Optional[str] = None
    atributos: dict = Field(default_factory=dict)


class TipoUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None
    foto_url: Optional[str] = None
    atributos: Optional[dict] = None


class TipoResponse(BaseModel):
    id: int
    categoria_id: int
    nombre: str
    descripcion: Optional[str]
    foto_url: Optional[str]
    atributos: dict

    class Config:
        from_attributes = True


# --- Endpoints ---

@router.get("/api/v1/catalogo/categoria", response_model=list[CategoriaResponse])
async def list_c(db: Session = Depends(get_db)):
    """Lista las categorías, creando las fijas si no existen."""
    if db.query(CatalogCategoria).count() == 0:
        for cat in CATEGORIAS_FIJAS:
            db.add(CatalogCategoria(**cat))
        db.commit()
    return db.query(CatalogCategoria).order_by(CatalogCategoria.id).all()


@router.post("/api/v1/catalogo/categoria/{categoria_id}/tipo", response_model=TipoResponse)
async def createTipo(categoria_id: int, payload: TipoCreate, db: Session = Depends(get_db)):
    cat = db.query(CatalogCategoria).filter(CatalogCategoria.id == categoria_id).first()
    if not cat:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")
    if not payload.nombre.strip():
        raise HTTPException(status_code=400, detail="El nombre del tipo es obligatorio")

    obj = CatalogTipo(
        categoria_id=categoria_id,
        nombre=payload.nombre.strip(),
        descripcion=payload.description,
        foto_url=payload.foto_url,
        atributos=payload.atributos or {},
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.get("/api/v1/catalogo/categoria/{categoria_id}/tipo", response_model=list[TipoResponse])
async def listTipos(categoria_id: int, db: Session = Depends(get_db)):
    return (
        db.query(CatalogTipo)
        .filter(CatalogTipo.categoria_id == categoria_id)
        .order_by(CatalogTipo.id)
        .all()
    )


@router.put("/api/v1/catalogo/tipo/{tipo_id}", response_model=TipoResponse)
async def updateTipo(tipo_id: int, payload: TipoUpdate, db: Session = Depends(get_db)):
    obj = db.query(CatalogTipo).filter(CatalogTipo.id == tipo_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Tipo no encontrado")
    data = payload.model_dump(exclude_unset=True)
    if "nombre" in data and data["nombre"] is not None:
        if not data["nombre"].strip():
            raise HTTPException(status_code=400, detail="El nombre es obligatorio")
        data["nombre"] = data["nombre"].strip()
    for k, v in data.items():
        setattr(obj, k, v)
    db.commit()
    db.refresh(obj)
    return obj


@router.delete("/api/v1/catalogo/tipo/{tipo_id}")
async def deleteTipo(tipo_id: int, db: Session = Depends(get_db)):
    obj = db.query(CatalogTipo).filter(CatalogTipo.id == tipo_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Tipo no encontrado")
    db.delete(obj)
    db.commit()
    return {"message": "Tipo eliminado"}