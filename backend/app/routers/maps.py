"""Router de mapas"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.spatial import MapProject, MapLayer
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

class MapProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
    center_lat: float
    center_lon: float
    zoom: Optional[int] = 10
    layers: Optional[list] = None

class MapProjectResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    center_lat: float
    center_lon: float
    zoom: int
    layers: Optional[list]
    class Config:
        from_attributes = True

@router.post("/projects", response_model=MapProjectResponse)
async def create_project(project: MapProjectCreate, db: Session = Depends(get_db)):
    db_project = MapProject(**project.dict())
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project

@router.get("/projects", response_model=list[MapProjectResponse])
async def list_projects(db: Session = Depends(get_db)):
    return db.query(MapProject).all()

@router.get("/projects/{project_id}", response_model=MapProjectResponse)
async def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(MapProject).filter(MapProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

@router.delete("/projects/{project_id}")
async def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(MapProject).filter(MapProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    # El contenido FTTH (elementos, tubos, hilos, extremos, tipos, carpetas...) se
    # borra explícitamente: los `ondelete=CASCADE` de los modelos NO se aplican en
    # SQLite si no se activa `PRAGMA foreign_keys=ON`. Antes se borraba solo la fila
    # del proyecto y todo su contenido quedaba huérfano en la base.
    try:
        from app.models.ftth_logica import borrar_datos_del_proyecto
        borrar_datos_del_proyecto(db, project_id)
    except Exception as e:  # pragma: no cover - defensivo
        print(f"[limpieza] aviso al vaciar el proyecto #{project_id}: {e}", flush=True)
    db.delete(project)
    db.commit()
    print(f"[limpieza] proyecto #{project_id} borrado con su contenido FTTH", flush=True)
    return {"message": "Project deleted"}