from sqlalchemy import Column, Integer, String, Float, ForeignKey, JSON, Text, Boolean
from sqlalchemy.orm import relationship, backref
from app.database import Base

class FtthTipo(Base):
    """
    Catálogo unificado de Tipos de Elementos FTTH.
    Almacena las plantillas (Poste, Manga, Ducto, etc.) con sus campos dinámicos.
    """
    __tablename__ = "ftth_tipos"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False)
    categoria = Column(String(50), nullable=False, index=True) # poste, manga, ducto, luminaria, odf, olt, cajanap, splitter
    
    # Campos base solicitados
    nombre_id = Column(String(100), nullable=False)
    color_mapa = Column(String(20), nullable=True, default="#3388ff")
    foto = Column(Text, nullable=True) # url o b64
    observaciones = Column(Text, nullable=True)
    
    # Campos dinámicos específicos (material, tipo_poste, puertos, etc.)
    propiedades = Column(JSON, nullable=False, default={})

class FtthElemento(Base):
    """
    Instancias unificadas de Elementos FTTH ubicados en el mapa.
    """
    __tablename__ = "ftth_elementos"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False)
    tipo_id = Column(Integer, ForeignKey("ftth_tipos.id", ondelete="CASCADE"), nullable=False)
    categoria = Column(String(50), nullable=False, index=True)
    
    # Datos espaciales
    lat = Column(Float, nullable=True)
    lon = Column(Float, nullable=True)
    coords_json = Column(JSON, nullable=True) # Para ductos/lineas
    
    # Poste de referencia (para cajas, mangas, etc. que cuelgan de un poste)
    poste_ref_id = Column(Integer, ForeignKey("ftth_elementos.id", ondelete="SET NULL"), nullable=True)

    # El estado particular de esta instancia (ej. puertos ocupados, estado actual)
    propiedades_instancia = Column(JSON, nullable=False, default={})

    # Relaciones
    tipo = relationship("FtthTipo")


class Carpeta(Base):
    __tablename__ = "ftth_carpetas"
    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=True)
    nombre = Column(String, index=True)
    carpeta_padre_id = Column(Integer, ForeignKey("ftth_carpetas.id", ondelete="CASCADE"), nullable=True)
    orden = Column(Integer, default=0)
    visible = Column(Boolean, default=True)

    subcarpetas = relationship("Carpeta", backref=backref("padre", remote_side="Carpeta.id"), cascade="all, delete-orphan")
    elementos = relationship("CarpetaElemento", back_populates="carpeta", cascade="all, delete-orphan")

class CarpetaElemento(Base):
    """
    Relación N:M entre Carpetas y Elementos FTTH unificados.
    """
    __tablename__ = "ftth_carpeta_elementos"
    id = Column(Integer, primary_key=True, index=True)
    carpeta_id = Column(Integer, ForeignKey("ftth_carpetas.id", ondelete="CASCADE"))
    elemento_id = Column(Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"))
    
    carpeta = relationship("Carpeta", back_populates="elementos")
    elemento = relationship("FtthElemento")
