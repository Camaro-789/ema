"""Servicios de escritura del módulo nativo (dominio + persistencia).

Reglas de diseño (Fase 2.2):
  · El router SOLO valida la entrada y llama aquí: toda la decisión está aquí.
  · Aquí NO se importa FastAPI: los errores son `ErrorDominio` y el router los
    traduce a HTTP con `{codigo, mensaje_es, detalle}`.
  · Cada escritura es UNA transacción y sube `ftth_elementos.revision` (2.4).
  · Las conexiones se validan con `app.domain.reglas`, cuya fuente de verdad es
    el HTML v25 (Fase 3).
  · Si hay conexiones, no se borra: se rechaza con la regla correspondiente.
"""
import re
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import ftth_logica as logica
from app.models import ftth_models as fisicos

from . import reglas
from .errores import ErrorConflicto, ErrorNoEncontrado, ErrorRegla

CATEGORIAS_CONTENEDOR = ("armario", "cajanap", "manga", "odf", "olt", "splitter", "fusion")
TIPOS_EQUIPO = ("olt", "odf", "switch", "splitter")
DIVISION = re.compile(r"(\d+)\s*[xX:]\s*(\d+)")


def contenedor(db: Session, contenedor_id: int) -> fisicos.FtthElemento:
    elemento = (
        db.query(fisicos.FtthElemento)
        .filter(fisicos.FtthElemento.id == contenedor_id)
        .first()
    )
    if not elemento:
        raise ErrorNoEncontrado(f"El contenedor #{contenedor_id} no existe.")
    if (elemento.categoria or "").lower() not in CATEGORIAS_CONTENEDOR:
        raise ErrorRegla(
            f"«{elemento.categoria}» no es un contenedor que conmute hilos.",
            codigo="contenedor_invalido",
        )
    return elemento


def revision(elemento) -> int:
    return int(getattr(elemento, "revision", 0) or 0)


def exigir_revision(elemento, base_revision: Optional[int]) -> None:
    if base_revision is None:
        return
    if int(base_revision) != revision(elemento):
        raise ErrorConflicto(
            f"La revisión cambió: el diagrama está en {revision(elemento)} y enviaste "
            f"{base_revision}. Recarga el diagrama antes de volver a intentar.",
            {"revision_vigente": revision(elemento)},
        )


def subir_revision(elemento) -> int:
    elemento.revision = revision(elemento) + 1
    return elemento.revision


def _division(valor) -> Optional[str]:
    encontrado = DIVISION.search(str(valor or ""))
    return f"{encontrado.group(1)}x{encontrado.group(2)}" if encontrado else None


def _salidas(division: Optional[str], tipo: str, pedidas: Optional[int]) -> int:
    if pedidas:
        return int(pedidas)
    if division:
        encontrado = DIVISION.search(division)
        if encontrado:
            return int(encontrado.group(2))
    return 8 if tipo == "olt" else 24


def _dto_equipo(equipo) -> Dict[str, Any]:
    """Vista mínima del equipo para las respuestas de escritura."""
    return {
        "id": equipo.id,
        "tipo": equipo.tipo,
        "nombre": equipo.serie,
        "division": equipo.division,
        "puertos_in": equipo.puertos_in,
        "puertos_out": equipo.puertos_out,
        "perdida_db": equipo.atenuacion_db,
        "estado": equipo.estado,
        "bandeja_id": equipo.bandeja_id,
        "tipo_id": equipo.tipo_id,
    }


def _generar_puertos(db, elemento, equipo, tipo: str, salidas: int) -> List[Dict[str, Any]]:
    """Puertos con la etiqueta que espera PORT_TABLE (PON/SFP/RJ45/OUT/ODF)."""
    creados = []

    def anadir(direccion: str, numero: int, etiqueta: str, conector: Optional[str] = None):
        puerto = logica.FtthPuerto(
            proyecto_id=elemento.proyecto_id, dispositivo_id=equipo.id,
            elemento_id=elemento.id, direccion=direccion, puerto_no=numero,
            estado="libre", etiqueta=etiqueta, tipo_conector=conector,
        )
        db.add(puerto)
        creados.append(puerto)

    if tipo == "splitter":
        anadir("IN", 1, "IN")
        for numero in range(1, salidas + 1):
            anadir("OUT", numero, f"OUT {numero}")
    elif tipo == "odf":
        for numero in range(1, salidas + 1):
            anadir("BIDI", numero, f"ODF-{numero:02d}", "SC/APC")
    elif tipo == "olt":
        for numero in range(1, salidas + 1):
            anadir("OUT", numero, f"PON {numero}")
        for numero in range(1, 3):
            anadir("OUT", salidas + numero, f"SFP {numero}", "SFP")
    else:  # switch
        for numero in range(1, min(4, salidas) + 1):
            anadir("OUT", numero, f"SFP {numero}", "SFP")
        for numero in range(5, salidas + 1):
            anadir("OUT", numero, f"RJ45 {numero - 4}", "RJ45")

    db.flush()
    return [{"id": p.id, "puerto": p.etiqueta, "direccion": p.direccion} for p in creados]


def crear_dispositivo(db: Session, contenedor_id: int, datos: Dict[str, Any]) -> Dict[str, Any]:
    elemento = contenedor(db, contenedor_id)
    tipo = str(datos.get("tipo") or "").lower()
    if tipo not in TIPOS_EQUIPO:
        raise ErrorRegla(
            f"Tipo de equipo no válido: «{tipo}». Usa {', '.join(TIPOS_EQUIPO)}.",
            codigo="tipo_equipo_invalido",
        )
    division = _division(datos.get("division")) if tipo == "splitter" else None
    if tipo == "splitter" and not division:
        raise ErrorRegla("El splitter necesita su división (1x8, 1x16…).",
                         codigo="division_requerida")
    if division and division not in reglas.reglas()["splitters"]["divisiones_balanceadas"]:
        raise ErrorRegla(
            "Splitter no balanceado: solo se admiten "
            f"{', '.join(reglas.reglas()['splitters']['divisiones_balanceadas'])}.",
            codigo="division_no_soportada",
        )
    salidas = _salidas(division, tipo, datos.get("puertos_out"))
    equipo = logica.FtthDispositivo(
        proyecto_id=elemento.proyecto_id, elemento_id=elemento.id,
        bandeja_id=datos.get("bandeja_id"), tipo_id=datos.get("tipo_id"), tipo=tipo,
        serie=datos.get("nombre") or datos.get("serie"), division=division,
        puertos_in=1 if tipo == "splitter" else 0, puertos_out=salidas,
        atenuacion_db=(datos.get("perdida_db") if datos.get("perdida_db") is not None
                       else (reglas.perdida_splitter(division) if division else None)),
        estado=datos.get("estado") or "operativo",
    )
    db.add(equipo)
    db.flush()
    puertos = _generar_puertos(db, elemento, equipo, tipo, salidas)
    return {"dispositivo": _dto_equipo(equipo), "puertos": puertos,
            "revision": subir_revision(elemento)}


CAMPOS_EDITABLES = ("nombre", "etiqueta", "estado", "perdida_db", "division", "bandeja_id")


def editar_dispositivo(db: Session, contenedor_id: int, dispositivo_id: int,
                       cambios: Dict[str, Any]) -> Dict[str, Any]:
    elemento = contenedor(db, contenedor_id)
    equipo = (
        db.query(logica.FtthDispositivo)
        .filter(logica.FtthDispositivo.id == dispositivo_id,
                logica.FtthDispositivo.elemento_id == elemento.id)
        .first()
    )
    if not equipo:
        raise ErrorNoEncontrado(
            f"El dispositivo #{dispositivo_id} no está en el contenedor #{contenedor_id}.")
    aplicados = {}
    if "nombre" in cambios:
        equipo.serie = cambios.get("nombre") or None
        aplicados["nombre"] = equipo.serie
    if "estado" in cambios:
        estados = reglas.reglas()["estados_equipo"]
        if cambios["estado"] not in estados:
            raise ErrorRegla(f"Estado no válido. Usa: {', '.join(estados)}.",
                             codigo="estado_invalido")
        equipo.estado = cambios["estado"]
        aplicados["estado"] = equipo.estado
    if "perdida_db" in cambios:
        if equipo.tipo != "splitter" and cambios["perdida_db"] is not None:
            raise ErrorRegla("Solo un splitter tiene pérdida propia editable.",
                             codigo="perdida_no_aplica")
        equipo.atenuacion_db = cambios["perdida_db"]
        aplicados["perdida_db"] = equipo.atenuacion_db
    if "division" in cambios and equipo.tipo == "splitter":
        division = _division(cambios["division"])
        if not division:
            raise ErrorRegla("División no válida para el splitter.", codigo="division_invalida")
        equipo.division = division
        aplicados["division"] = division
    if "bandeja_id" in cambios:
        equipo.bandeja_id = cambios["bandeja_id"]
        aplicados["bandeja_id"] = equipo.bandeja_id
    if "etiqueta" in cambios:
        aplicados["etiqueta"] = cambios["etiqueta"]
        equipo.serie = cambios["etiqueta"] or equipo.serie
    db.flush()
    return {"dispositivo": _dto_equipo(equipo), "cambios": aplicados,
            "revision": subir_revision(elemento)}


def mover_dispositivo(db: Session, contenedor_id: int, dispositivo_id: int,
                      destino_id: int, posicion: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Mueve un equipo (con sus puertos y su posición) a otro gabinete."""
    origen = contenedor(db, contenedor_id)
    destino = contenedor(db, destino_id)
    equipo = (
        db.query(logica.FtthDispositivo)
        .filter(logica.FtthDispositivo.id == dispositivo_id,
                logica.FtthDispositivo.elemento_id == origen.id)
        .first()
    )
    if not equipo:
        raise ErrorNoEncontrado(
            f"El dispositivo #{dispositivo_id} no está en el contenedor #{contenedor_id}.")
    if destino.id == origen.id:
        raise ErrorRegla("El equipo ya está en ese contenedor.", codigo="mismo_contenedor")

    equipo.elemento_id = destino.id
    db.query(logica.FtthPuerto).filter(
        logica.FtthPuerto.dispositivo_id == equipo.id
    ).update({"elemento_id": destino.id}, synchronize_session=False)
    db.query(logica.FtthDiagramaPosicion).filter(
        logica.FtthDiagramaPosicion.dispositivo_id == equipo.id
    ).update({"elemento_id": destino.id}, synchronize_session=False)

    if posicion and posicion.get("x") is not None and posicion.get("y") is not None:
        fila = (
            db.query(logica.FtthDiagramaPosicion)
            .filter(logica.FtthDiagramaPosicion.dispositivo_id == equipo.id)
            .first()
        )
        if fila:
            fila.x, fila.y = float(posicion["x"]), float(posicion["y"])
        else:
            db.add(logica.FtthDiagramaPosicion(
                proyecto_id=destino.proyecto_id, elemento_id=destino.id,
                dispositivo_id=equipo.id, x=float(posicion["x"]), y=float(posicion["y"]),
            ))
    db.flush()
    # La capacidad en U de los gabinetes aún no está modelada (Fase 6): el
    # movimiento se permite y se informa `excede=False` en vez de inventar U.
    return {
        "dispositivo": _dto_equipo(equipo),
        "origen_id": origen.id,
        "destino_id": destino.id,
        "excede": False,
        "revision_origen": subir_revision(origen),
        "revision_destino": subir_revision(destino),
    }


def eliminar_dispositivo(db: Session, contenedor_id: int, dispositivo_id: int) -> Dict[str, Any]:
    elemento = contenedor(db, contenedor_id)
    equipo = (
        db.query(logica.FtthDispositivo)
        .filter(logica.FtthDispositivo.id == dispositivo_id,
                logica.FtthDispositivo.elemento_id == elemento.id)
        .first()
    )
    if not equipo:
        raise ErrorNoEncontrado(
            f"El dispositivo #{dispositivo_id} no está en el contenedor #{contenedor_id}.")

    puertos = [
        fila.id for fila in db.query(logica.FtthPuerto.id)
        .filter(logica.FtthPuerto.dispositivo_id == equipo.id).all()
    ]
    conexiones = 0
    if puertos:
        conexiones = db.query(logica.FtthEmpalme).filter(
            logica.FtthEmpalme.puerto_id.in_(puertos)).count()
        conexiones += db.query(logica.FtthConexionMeta).filter(
            logica.FtthConexionMeta.puerto_id.in_(puertos)).count()
    if conexiones:
        mensaje = next(r["mensaje_es"] for r in reglas.reglas()["reglas"]
                       if r["id"] == "no_borrar_con_conexiones")
        raise ErrorConflicto(mensaje, {"conexiones": conexiones})

    if puertos:
        db.query(logica.FtthConexionMeta).filter(
            logica.FtthConexionMeta.puerto_id.in_(puertos)
        ).delete(synchronize_session=False)
    borrados = db.query(logica.FtthPuerto).filter(
        logica.FtthPuerto.dispositivo_id == equipo.id
    ).delete(synchronize_session=False)
    db.query(logica.FtthDiagramaPosicion).filter(
        logica.FtthDiagramaPosicion.dispositivo_id == equipo.id
    ).delete(synchronize_session=False)
    db.delete(equipo)
    db.flush()
    return {"dispositivo_id": dispositivo_id, "puertos_eliminados": int(borrados or 0),
            "revision": subir_revision(elemento)}


def contexto(db: Session, contenedor_id: int) -> Dict[str, Any]:
    """Contexto que necesita el validador (puertos ocupados, orígenes, dominios).

    El HTML lo llevaba en memoria; aquí se deriva de la base. La detección de
    lazos completa llega en la Fase 3 (vectores dorados): hoy `cadena` va vacía.
    """
    empalmes = db.query(logica.FtthEmpalme).filter(
        logica.FtthEmpalme.nodo_id == contenedor_id).all()
    ocupados: List[str] = []
    fibra_ids, puerto_ids = [], []
    for empalme in empalmes:
        for fibra_id in (empalme.fibra_a_id, empalme.fibra_b_id):
            if fibra_id:
                fibra_ids.append(fibra_id)
        if empalme.puerto_id:
            puerto_ids.append(empalme.puerto_id)

    if fibra_ids:
        for fibra in db.query(logica.FtthCableFibra).filter(
                logica.FtthCableFibra.id.in_(fibra_ids)).all():
            ocupados.append(f"CABLE:{fibra.elemento_id}:HILO {fibra.hilo_global_no}:")
    if puerto_ids:
        filas = (
            db.query(logica.FtthPuerto, logica.FtthDispositivo.tipo)
            .join(logica.FtthDispositivo,
                  logica.FtthDispositivo.id == logica.FtthPuerto.dispositivo_id)
            .filter(logica.FtthPuerto.id.in_(puerto_ids))
            .all()
        )
        for puerto, tipo in filas:
            ocupados.append(f"{str(tipo).upper()}:{puerto.dispositivo_id}:{puerto.etiqueta}:")

    metas = db.query(logica.FtthConexionMeta).filter(
        logica.FtthConexionMeta.contenedor_id == contenedor_id).all()
    origenes = [f"meta:{meta.id}" for meta in metas if meta.origen_tipo]
    dominios = sorted({meta.senal for meta in metas if meta.senal})

    equipos = db.query(logica.FtthDispositivo).filter(
        logica.FtthDispositivo.elemento_id == contenedor_id).all()
    tipo_ids = {equipo.tipo_id for equipo in equipos if equipo.tipo_id}
    propiedades = {}
    if tipo_ids:
        propiedades = {
            tipo.id: (tipo.propiedades or {})
            for tipo in db.query(fisicos.FtthTipo)
            .filter(fisicos.FtthTipo.id.in_(tipo_ids)).all()
        }
    clase_splitter = {}
    for equipo in equipos:
        if equipo.tipo == "splitter":
            props = propiedades.get(equipo.tipo_id) or {}
            clase_splitter[f"SPLITTER:{equipo.id}:IN:"] = str(props.get("clase") or "AF")

    return {"ocupados": ocupados, "origenes": origenes, "dominios": dominios,
            "clase_splitter": clase_splitter, "cadena": []}


def _fibra_de(extremo: Dict[str, Any]) -> Optional[int]:
    if extremo.get("tipo") != "CABLE":
        return None
    return extremo.get("fibra_id") or extremo.get("id")


def conectar(db: Session, contenedor_id: int, datos: Dict[str, Any]) -> Dict[str, Any]:
    """Crea una conexión (empalme) validada por el dominio."""
    elemento = contenedor(db, contenedor_id)
    a = dict(datos.get("origen") or {})
    b = dict(datos.get("destino") or {})
    if not a or not b:
        raise ErrorRegla("Faltan los dos extremos de la conexión.", codigo="extremos_incompletos")

    ctx = contexto(db, contenedor_id)
    ctx["es_origen"] = bool(datos.get("es_origen", True))
    ctx["vista_subida"] = bool(datos.get("vista_subida", False))
    resultado = reglas.validar_conexion(a, b, ctx)

    fibra_a = _fibra_de(a)
    fibra_b = _fibra_de(b)
    puerto = None
    if fibra_a is None and fibra_b is None:
        raise ErrorRegla(
            "El esquema actual solo guarda conexiones hilo↔hilo o hilo↔puerto. "
            "Una conexión puerto↔puerto necesita un hilo (se resolverá en la Fase 6).",
            codigo="puerto_a_puerto_pendiente",
        )
    if fibra_a is None:
        a, b = b, a
        fibra_a, fibra_b = fibra_b, None
    if fibra_b is None:
        puerto = b.get("puerto_id")
        if not puerto:
            raise ErrorRegla("El destino debe traer `puerto_id`.", codigo="puerto_requerido")

    existente = db.query(logica.FtthEmpalme).filter(
        logica.FtthEmpalme.nodo_id == elemento.id,
        logica.FtthEmpalme.fibra_a_id == fibra_a,
    ).first()
    if existente:
        mensaje = next(r["mensaje_es"] for r in reglas.reglas()["reglas"]
                       if r["id"] == "sin_duplicados")
        raise ErrorConflicto(mensaje, {"empalme_id": existente.id})

    empalme = logica.FtthEmpalme(
        proyecto_id=elemento.proyecto_id, nodo_id=elemento.id,
        bandeja_id=datos.get("bandeja_id"), slot=datos.get("slot"),
        fibra_a_id=fibra_a, fibra_b_id=fibra_b, puerto_id=puerto,
        tipo=datos.get("tipo") or ("paso" if fibra_b else "conector"),
        extremo_a=datos.get("extremo_a") or "entrada",
        extremo_b=datos.get("extremo_b") or "salida",
        etiqueta=datos.get("etiqueta"),
        propiedades={"origen": "modulo_nativo", "extension": resultado.get("extension", False)},
    )
    db.add(empalme)
    db.flush()
    if puerto:
        db.query(logica.FtthPuerto).filter(logica.FtthPuerto.id == puerto).update(
            {"estado": "ocupado"}, synchronize_session=False)
    return {
        "conexion": {
            "id": empalme.id, "tipo": empalme.tipo, "fibra_a_id": empalme.fibra_a_id,
            "fibra_b_id": empalme.fibra_b_id, "puerto_id": empalme.puerto_id,
            "dominio": resultado.get("dominio"), "extension": resultado.get("extension", False),
        },
        "revision": subir_revision(elemento),
    }


def desconectar(db: Session, contenedor_id: int, conexion_id: int) -> Dict[str, Any]:
    elemento = contenedor(db, contenedor_id)
    empalme = db.query(logica.FtthEmpalme).filter(
        logica.FtthEmpalme.id == conexion_id,
        logica.FtthEmpalme.nodo_id == elemento.id,
    ).first()
    if not empalme:
        raise ErrorNoEncontrado(
            f"La conexión #{conexion_id} no está en el contenedor #{contenedor_id}.")
    db.query(logica.FtthConexionMeta).filter(
        logica.FtthConexionMeta.empalme_id == empalme.id
    ).delete(synchronize_session=False)
    if empalme.puerto_id:
        db.query(logica.FtthPuerto).filter(
            logica.FtthPuerto.id == empalme.puerto_id
        ).update({"estado": "libre"}, synchronize_session=False)
    db.delete(empalme)
    db.flush()
    return {"conexion_id": conexion_id, "revision": subir_revision(elemento)}


def marcar_origen(db: Session, contenedor_id: int, datos: Dict[str, Any]) -> Dict[str, Any]:
    """Marca el origen de señal (y la potencia TX) de una conexión o de un puerto."""
    elemento = contenedor(db, contenedor_id)
    origen_tipo = str(datos.get("origen_tipo") or "").upper()
    # `origen_tipo` es el tipo de PUERTO (PON/SFP/RJ45/HILO); PORT_TABLE clasifica
    # por tipo de EQUIPO. Se resuelve aquí: HILO → CABLE; si viene el dispositivo,
    # se usa su tipo real; si no, OLT (dueño natural de PON/SFP).
    tipo_equipo = str(datos.get("tipo_equipo") or "").upper()
    if not tipo_equipo:
        if origen_tipo == "HILO":
            tipo_equipo = "CABLE"
        elif datos.get("dispositivo_id"):
            equipo = db.query(logica.FtthDispositivo).filter(
                logica.FtthDispositivo.id == datos["dispositivo_id"],
                logica.FtthDispositivo.elemento_id == elemento.id,
            ).first()
            if equipo:
                tipo_equipo = str(equipo.tipo or "").upper()
        tipo_equipo = tipo_equipo or "OLT"

    extremo = {
        "tipo": tipo_equipo,
        "eq_id": datos.get("dispositivo_id"),
        "puerto": datos.get("puerto"),
        "cara": datos.get("cara"),
    }
    if tipo_equipo == "CABLE":
        extremo["eq_id"] = datos.get("cable_id")
    ctx = contexto(db, contenedor_id)
    ctx["origenes"] = []  # esta misma marca es la que se está creando
    senal = reglas.validar_origen(extremo, datos.get("senal"), ctx)

    filtro = [
        logica.FtthConexionMeta.contenedor_id == elemento.id,
        logica.FtthConexionMeta.empalme_id == datos.get("empalme_id"),
        logica.FtthConexionMeta.puerto_id == datos.get("puerto_id"),
        logica.FtthConexionMeta.fibra_extremo_id == datos.get("fibra_extremo_id"),
    ]
    meta = db.query(logica.FtthConexionMeta).filter(*filtro).first()
    if not meta:
        meta = logica.FtthConexionMeta(
            contenedor_id=elemento.id,
            empalme_id=datos.get("empalme_id"),
            puerto_id=datos.get("puerto_id"),
            fibra_extremo_id=datos.get("fibra_extremo_id"),
        )
        db.add(meta)
    meta.origen_tipo = origen_tipo or tipo_equipo
    meta.senal = senal
    meta.tx_dbm = datos.get("tx_dbm")
    meta.nota = datos.get("nota")
    db.flush()
    tx = float(meta.tx_dbm) if meta.tx_dbm is not None else \
        float(reglas.reglas()["tx_por_defecto_dbm"].get(meta.origen_tipo or "", 0.0))
    return {
        "origen": {
            "id": meta.id, "origen_tipo": meta.origen_tipo, "senal": meta.senal,
            "tx_dbm": meta.tx_dbm, "tx_efectivo_dbm": tx,
            "estado_potencia": reglas.estado_potencia(meta.senal, tx,
                                                      meta.origen_tipo == "RJ45"),
        },
        "revision": subir_revision(elemento),
    }





