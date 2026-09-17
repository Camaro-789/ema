"""Modelos de base de datos para el Catálogo de Tipos."""
from sqlalchemy import Column, Integer, String, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship

from app.database import Base


# Categorías fijas de infraestructura (seeded al inicializar)
CATEGORIAS_FIJAS = [
    {"clave": "poste", "nombre": "Poste", "icono": "🪵"},
    {"clave": "caja", "nombre": "Caja", "icono": "📦"},
    {"clave": "condominio", "nombre": "Condominio", "icono": "🏠"},
    {"clave": "camara", "nombre": "Cámara de registro", "icono": "📹"},
    {"clave": "ducto", "nombre": "Ducto", "icono": "🛠️"},
    {"clave": "cable", "nombre": "Cable", "icono": "Minus"},
    {"clave": "splitter", "nombre": "Splitter", "icono": "🟠"},
    {"clave": "pop", "nombre": "POP", "icono": "🏢"},
    {"clave": "olt", "nombre": "OLT", "icono": "🔴"},
    {"clave": "odf", "nombre": "ODF", "icono": "🗄️"},
    {"clave": "switch", "nombre": "Switch", "icono": "🔌"},
    {"clave": "conector", "nombre": "Conector", "icono": "🔗"},
    {"clave": "fusion", "nombre": "Fusión", "icono": "🔥"},
]


class CatalogCategoria(Base):
    __tablename__ = "catalog_categorias"

    id = Column(Integer, primary_key=True, index=True)
    clave = Column(String(50), unique=True, nullable=False, index=True)
    nombre = Column(String(100), nullable=False)
    icono = Column(String(10), default="📦")

    tipos = relationship("CatalogTipo", back_populates="categoria", cascade="all, delete-orphan")


class CatalogTipo(Base):
    __tablename__ = "catalog_tipos"

    id = Column(Integer, primary_key=True, index=True)
    categoria_id = Column(Integer, ForeignKey("catalog_categorias.id"), nullable=False, index=True)
    nombre = Column(String(150), nullable=False)
    descripcion = Column(Text, nullable=True)
    foto_url = Column(String(500), nullable=True)

    # Atributos específicos de cada categoría (JSONB en PostgreSQL, JSON en SQLite)
    atributos = Column(JSON, default=dict, nullable=False)

    categoria = relationship("CatalogCategoria", back_populates="tipos")