import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
from app.database import get_db
import app.models.ftth_models as models
import app.models.ftth_logica as logica
from app.models.ftth_logica import MAX_SPLITTER_ENTRADAS, MAX_SPLITTER_SALIDAS
from app.models.ftth_logica import DIVISION_RE

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
        # Pydantic v2: 'orm_mode' fue renombrado a 'from_attributes'
        from_attributes = True


# ── Validación del catálogo ──────────────────────────────────────────────────
# Un splitter sin división no se puede materializar en el diagrama, así que se
# avisa aquí (al crear el tipo) y no más tarde, al intentar instalarlo.
# Parser compartido con la materialización (models/ftth_logica.py): una sola
# definición de "qué es una división válida" para los dos módulos. Antes cada
# uno tenía su propia copia y se desincronizaron con el sufijo "(10.7 dB)".
_DIVISION_RE = DIVISION_RE


def _entero(valor) -> Optional[int]:
    try:
        return int(float(valor))
    except (TypeError, ValueError):
        return None


def _validar_propiedades(categoria: str, propiedades: Dict[str, Any]) -> None:
    """Comprueba que un tipo de splitter trae una división utilizable."""
    if str(categoria or "").strip().lower() != "splitter":
        return
    props = propiedades or {}
    entradas = None
    salidas = None

    declarada = props.get("relacion_division") or props.get("division")
    if declarada:
        hallado = _DIVISION_RE.search(str(declarada))
        if hallado:
            entradas, salidas = int(hallado.group(1)), int(hallado.group(2))

    if entradas is None:
        entradas = _entero(props.get("entradas"))
    if salidas is None:
        salidas = _entero(props.get("salidas"))

    if not salidas:
        raise HTTPException(
            400,
            "Un splitter necesita su división (por ejemplo 1 x 16: una entrada y "
            "16 salidas). Elígela en el formulario antes de guardar; sin eso no "
            "se puede materializar en el diagrama.",
        )
    if salidas > MAX_SPLITTER_SALIDAS:
        raise HTTPException(
            400,
            f"Un splitter no puede tener {salidas} salidas: "
            f"el máximo es 1x{MAX_SPLITTER_SALIDAS}.",
        )
    if entradas is not None and entradas not in (1, 2):
        raise HTTPException(
            400,
            f"Un splitter solo admite 1 o 2 entradas (se pidieron {entradas}).",
        )

def _fusiones_del_tipo(tipo_id: int, db: Session) -> Dict[str, int]:
    """
    Cuenta lo que ya está «cableado» con este tipo de cable:
      · hilos empalmados o conectados,
      · hilos con un extremo anclado a un nodo (los que usa el diagrama de la caja).
    Es la señal de que cambiarle la estructura (con buffer ↔ drop) rompería el
    diagrama de cualquier caja que ya lo esté usando.
    """
    cables = [
        fila.id
        for fila in db.query(models.FtthElemento.id)
        .filter(
            models.FtthElemento.tipo_id == tipo_id,
            models.FtthElemento.categoria == "cables",
        )
        .all()
    ]
    if not cables:
        return {"cables": 0, "empalmados": 0, "anclados": 0}

    empalmados = (
        db.query(logica.FtthCableFibra)
        .filter(
            logica.FtthCableFibra.elemento_id.in_(cables),
            logica.FtthCableFibra.estado.in_(("empalmado", "conectado")),
        )
        .count()
    )
    anclados = (
        db.query(logica.FtthFibraExtremo)
        .join(logica.FtthCableFibra, logica.FtthCableFibra.id == logica.FtthFibraExtremo.fibra_id)
        .filter(
            logica.FtthCableFibra.elemento_id.in_(cables),
            logica.FtthFibraExtremo.nodo_id.isnot(None),
        )
        .count()
    )
    return {"cables": len(cables), "empalmados": empalmados, "anclados": anclados}


def _normalizar_propiedades(categoria: str, propiedades: Dict[str, Any]) -> Dict[str, Any]:
    """
    Valida y normaliza las propiedades de un tipo ANTES de guardarlo.

    - splitter → división utilizable (lo de siempre).
    - cables   → estructura (con buffer / drop): looses, total de fibras, fibras
                 por buffer calculadas y la plantilla visual que le toca.
    Devuelve el diccionario que se guarda en `ftth_tipos.propiedades`.
    """
    props = dict(propiedades or {})
    cat = str(categoria or "").strip().lower()

    if cat == "splitter":
        _validar_propiedades(cat, props)
        return props

    if cat == "cables":
        try:
            return logica.normalizar_cable(props)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))

    return props


@router.get("/{categoria}", response_model=List[TipoResponse])
def listar_tipos(categoria: str, proyecto_id: int, db: Session = Depends(get_db)):
    return db.query(models.FtthTipo).filter(
        models.FtthTipo.categoria == categoria,
        models.FtthTipo.proyecto_id == proyecto_id
    ).all()

@router.post("/", response_model=TipoResponse)
def crear_tipo(payload: TipoCreate, db: Session = Depends(get_db)):
    propiedades = _normalizar_propiedades(payload.categoria, payload.propiedades)
    nuevo = models.FtthTipo(**{**payload.dict(), "propiedades": propiedades})
    db.add(nuevo)
    db.commit()
    db.refresh(nuevo)
    return nuevo

@router.put("/{tipo_id}", response_model=TipoResponse)
def actualizar_tipo(tipo_id: int, payload: TipoCreate, db: Session = Depends(get_db)):
    db_tipo = db.query(models.FtthTipo).filter(models.FtthTipo.id == tipo_id).first()
    if not db_tipo:
        raise HTTPException(status_code=404, detail="Tipo no encontrado")

    propiedades = _normalizar_propiedades(payload.categoria, payload.propiedades)

    # La ESTRUCTURA de un cable (con buffer ↔ drop) no se puede cambiar si el tipo
    # ya tiene fusiones/conexiones registradas: el diagrama de las cajas que lo
    # usan dejaría de cuadrar (los hilos y los buffers ya no serían los mismos).
    if str(payload.categoria or "").strip().lower() == "cables":
        anterior = str((db_tipo.propiedades or {}).get("estructura") or "").strip().lower()
        nueva = str(propiedades.get("estructura") or "").strip().lower()
        if anterior and nueva and anterior != nueva:
            uso = _fusiones_del_tipo(tipo_id, db)
            if uso["empalmados"] or uso["anclados"]:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"No se puede cambiar la estructura de «{db_tipo.nombre_id}» de "
                        f"«{anterior}» a «{nueva}»: ya tiene {uso['empalmados']} hilo(s) "
                        f"empalmado(s)/conectado(s) y {uso['anclados']} hilo(s) anclado(s) a un "
                        "nodo. Romperías el diagrama de las cajas que ya lo usan. Crea un tipo "
                        "nuevo para la otra estructura."
                    ),
                )

    for k, v in payload.dict().items():
        setattr(db_tipo, k, propiedades if k == "propiedades" else v)

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
