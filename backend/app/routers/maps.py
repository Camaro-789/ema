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
    db.delete(project)
    db.commit()
    return {"message": "Project deleted"}