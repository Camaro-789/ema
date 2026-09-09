"""Modelos de base de datos - Sin dependencias PostGIS"""
from sqlalchemy import Column, Integer, String, Float, JSON, DateTime
from sqlalchemy.sql import func
from app.database import Base

class MapLayer(Base):
    __tablename__ = "map_layers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), index=True)
    description = Column(String(1024))
    layer_type = Column(String(50))
    geometry_type = Column(String(50))
    data_source = Column(String(500))
    style = Column(JSON)
    visible = Column(Integer, default=1)
    opacity = Column(Float, default=1.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class VectorTile(Base):
    __tablename__ = "vector_tiles"
    id = Column(Integer, primary_key=True, index=True)
    layer_id = Column(Integer, index=True)
    tile_url = Column(String(500))
    format = Column(String(20))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class MapProject(Base):
    __tablename__ = "map_projects"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), index=True)
    description = Column(String(1024))
    center_lat = Column(Float)
    center_lon = Column(Float)
    zoom = Column(Integer, default=10)
    layers = Column(JSON)
    created_at = Column(DateTime(timezone=True), server_default=func.now())