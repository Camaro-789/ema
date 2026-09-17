"""Router para tipos de objetos del mapa."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.spatial import MapObjectType

router = APIRouter()


class ObjectTypeCreate(BaseModel):
    kind: str
    name: str
    icon: str = "📍"
    color: str = "#3498db"
    material: Optional[str] = None
    height: Optional[float] = None
    image: Optional[str] = None
    metadata: Optional[dict] = None


class ObjectTypeResponse(BaseModel):
    id: int
    kind: str
    name: str
    icon: str
    color: str
    material: Optional[str]
    height: Optional[float]
    image: Optional[str]
    metadata: Optional[dict]

    class Config:
        from_attributes = True


@router.get("/object-types", response_model=list[ObjectTypeResponse])
async def list_object_types(db: Session = Depends(get_db)):
    items = db.query(MapObjectType).order_by(MapObjectType.kind, MapObjectType.name).all()
    return [
        {
            "id": item.id,
            "kind": item.kind,
            "name": item.name,
            "icon": item.icon,
            "color": item.color,
            "material": item.material,
            "height": item.height,
            "image": item.image,
            "metadata": item.meta_data,
        }
        for item in items
    ]


@router.post("/object-types", response_model=ObjectTypeResponse)
async def create_object_type(payload: ObjectTypeCreate, db: Session = Depends(get_db)):
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="El nombre del tipo es obligatorio")
    if not payload.kind.strip():
        raise HTTPException(status_code=400, detail="El tipo de objeto es obligatorio")

    obj = MapObjectType(
        kind=payload.kind.strip().lower(),
        name=payload.name.strip(),
        icon=payload.icon or "📍",
        color=payload.color or "#3498db",
        material=payload.material.strip() if payload.material else None,
        height=float(payload.height) if payload.height is not None else None,
        image=payload.image,
        meta_data=payload.metadata or {},
    )
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return {
        "id": obj.id,
        "kind": obj.kind,
        "name": obj.name,
        "icon": obj.icon,
        "color": obj.color,
        "material": obj.material,
        "height": obj.height,
        "image": obj.image,
        "metadata": obj.meta_data,
    }


@router.get("/object-types/{type_id}", response_model=ObjectTypeResponse)
async def get_object_type(type_id: int, db: Session = Depends(get_db)):
    obj = db.query(MapObjectType).filter(MapObjectType.id == type_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Tipo de objeto no encontrado")
    return {
        "id": obj.id,
        "kind": obj.kind,
        "name": obj.name,
        "icon": obj.icon,
        "color": obj.color,
        "material": obj.material,
        "height": obj.height,
        "image": obj.image,
        "metadata": obj.meta_data,
    }


@router.delete("/object-types/{type_id}")
async def delete_object_type(type_id: int, db: Session = Depends(get_db)):
    obj = db.query(MapObjectType).filter(MapObjectType.id == type_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Tipo de objeto no encontrado")
    db.delete(obj)
    db.commit()
    return {"message": "Tipo eliminado"}
