"""Router de capas"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.spatial import MapLayer
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

class LayerCreate(BaseModel):
    name: str
    description: Optional[str] = None
    layer_type: str = "vector"
    geometry_type: Optional[str] = None
    data_source: Optional[str] = None
    style: Optional[dict] = None
    visible: Optional[int] = 1
    opacity: Optional[float] = 1.0

class LayerResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    layer_type: str
    geometry_type: Optional[str]
    data_source: Optional[str]
    style: Optional[dict]
    visible: int
    opacity: float
    class Config:
        from_attributes = True

@router.post("/layers", response_model=LayerResponse)
async def create_layer(layer: LayerCreate, db: Session = Depends(get_db)):
    db_layer = MapLayer(**layer.dict())
    db.add(db_layer)
    db.commit()
    db.refresh(db_layer)
    return db_layer

@router.get("/layers", response_model=list[LayerResponse])
async def list_layers(db: Session = Depends(get_db)):
    return db.query(MapLayer).all()

@router.get("/layers/{layer_id}", response_model=LayerResponse)
async def get_layer(layer_id: int, db: Session = Depends(get_db)):
    layer = db.query(MapLayer).filter(MapLayer.id == layer_id).first()
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")
    return layer

@router.delete("/layers/{layer_id}")
async def delete_layer(layer_id: int, db: Session = Depends(get_db)):
    layer = db.query(MapLayer).filter(MapLayer.id == layer_id).first()
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")
    db.delete(layer)
    db.commit()
    return {"message": "Layer deleted"}