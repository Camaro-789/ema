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


def subir_revision(db: Session, contenedor_id: int) -> int:
    """Sube la revision EN LA BASE (atomico) y devuelve el valor nuevo.

    Se hace con un UPDATE (`revision = revision + 1`) para que dos escrituras
    simultaneas no puedan dejar el mismo numero.
    """
    db.query(fisicos.FtthElemento).filter(
        fisicos.FtthElemento.id == contenedor_id
    ).update({"revision": fisicos.FtthElemento.revision + 1},
             synchronize_session=False)
    return int(
        db.query(fisicos.FtthElemento.revision)
        .filter(fisicos.FtthElemento.id == contenedor_id)
        .scalar() or 0
    )


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


def _generar_puertos(db, elemento, equipo, tipo: str, salidas: int,
                     props_tipo: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Puertos con la etiqueta que espera PORT_TABLE (PON/SFP/RJ45/OUT/ODF)."""
    creados = []
    props = props_tipo or {}

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
        if props and any(k in props for k in ("puertos_pon", "puertos_sfp", "puertos_rj45_datos", "slots_detalle")):
            # Modelo enriquecido desde la plantilla de Tipos de Objetos
            cant_pon = int(props.get("puertos_pon") or salidas or 8)
            cant_sfp = int(props.get("puertos_sfp") if props.get("puertos_sfp") is not None else 2)
            cant_rj45 = int(props.get("puertos_rj45_datos") if props.get("puertos_rj45_datos") is not None else 0)
            tiene_mgmt = bool(props.get("puerto_mgmt", True))
            tiene_console = bool(props.get("puerto_console", True))

            p_no = 1
            for i in range(1, cant_pon + 1):
                anadir("OUT", p_no, f"PON {i}", "SC/UPC")
                p_no += 1
            for i in range(1, cant_sfp + 1):
                anadir("OUT", p_no, f"SFP {i}", "SFP")
                p_no += 1
            for i in range(1, cant_rj45 + 1):
                anadir("OUT", p_no, f"RJ45 {i}", "RJ45")
                p_no += 1
            if tiene_mgmt:
                anadir("OUT", p_no, "RJ45 MGMT", "RJ45")
                p_no += 1
            if tiene_console:
                anadir("OUT", p_no, "RJ45 CONSOLE", "RJ45")
                p_no += 1
        else:
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


def cables_del_proyecto(db: Session, contenedor_id: int) -> Dict[str, Any]:
    """Cables REALES del proyecto y si se pueden anclar a este contenedor.

    Devuelve, por cable, sus dos extremos, cuáles están libres y si ya está
    anclado aquí. El frontend NO inventa cables: solo ofrece esta lista.
    """
    elemento = contenedor(db, contenedor_id)
    cables = (
        db.query(fisicos.FtthElemento)
        .filter(fisicos.FtthElemento.proyecto_id == elemento.proyecto_id,
                fisicos.FtthElemento.categoria == "cables")
        .order_by(fisicos.FtthElemento.id)
        .all()
    )
    tipo_ids = {cable.tipo_id for cable in cables if cable.tipo_id}
    tipos = {}
    if tipo_ids:
        tipos = {
            tipo.id: tipo
            for tipo in db.query(fisicos.FtthTipo)
            .filter(fisicos.FtthTipo.id.in_(tipo_ids)).all()
        }
    hilos = {}
    if cables:
        from sqlalchemy import func
        filas = (
            db.query(logica.FtthCableFibra.elemento_id, func.count(logica.FtthCableFibra.id))
            .filter(logica.FtthCableFibra.elemento_id.in_([cable.id for cable in cables]))
            .group_by(logica.FtthCableFibra.elemento_id)
            .all()
        )
        hilos = {fila[0]: int(fila[1]) for fila in filas}

    lista = []
    for cable in cables:
        tipo = tipos.get(cable.tipo_id)
        props = getattr(tipo, "propiedades", None) or {}
        aqui = ("A" if cable.extremo_A_id == elemento.id
                else "B" if cable.extremo_B_id == elemento.id else None)
        lista.append({
            "id": cable.id,
            "nombre": getattr(tipo, "nombre_id", None) or f"Cable #{cable.id}",
            "estructura": props.get("estructura"),
            "hilos": hilos.get(cable.id, 0),
            "extremo_a_id": cable.extremo_A_id,
            "extremo_b_id": cable.extremo_B_id,
            "libre_a": cable.extremo_A_id is None,
            "libre_b": cable.extremo_B_id is None,
            "anclado_aqui": aqui,
            "anclable": bool(aqui is None and (cable.extremo_A_id is None
                                               or cable.extremo_B_id is None)),
        })
    return {"contenedor_id": elemento.id, "cables": lista,
            "revision": revision(elemento)}


def anclar_cable(db: Session, contenedor_id: int, datos: Dict[str, Any]) -> Dict[str, Any]:
    """Ancla un cable EXISTENTE al contenedor (no crea cables).

    · el cable debe ser del mismo proyecto y de categoría `cables`;
    · no puede estar ya anclado en este contenedor;
    · el extremo (A/B) tiene que estar libre. Si no se indica, se usa el libre.
    """
    elemento = contenedor(db, contenedor_id)
    cable_id = int(datos.get("cable_id") or 0)
    cable = (
        db.query(fisicos.FtthElemento)
        .filter(fisicos.FtthElemento.id == cable_id)
        .first()
    )
    if not cable:
        raise ErrorNoEncontrado(f"El cable #{cable_id} no existe.")
    if (cable.categoria or "").lower() != "cables":
        raise ErrorRegla(
            f"El elemento #{cable_id} es «{cable.categoria}», no un cable.",
            codigo="no_es_cable",
        )
    if cable.proyecto_id != elemento.proyecto_id:
        raise ErrorRegla(
            f"El cable #{cable_id} es de otro proyecto ({cable.proyecto_id}).",
            codigo="cable_de_otro_proyecto",
        )
    if elemento.id in (cable.extremo_A_id, cable.extremo_B_id):
        raise ErrorConflicto(
            f"El cable #{cable_id} ya está anclado a este contenedor.",
            {"cable_id": cable_id},
        )

    extremo = str(datos.get("extremo") or "").upper()
    if extremo not in ("A", "B"):
        if cable.extremo_A_id is None:
            extremo = "A"
        elif cable.extremo_B_id is None:
            extremo = "B"
        else:
            raise ErrorConflicto(
                f"El cable #{cable_id} ya tiene sus dos extremos ocupados "
                f"(A=#{cable.extremo_A_id}, B=#{cable.extremo_B_id}).",
                {"cable_id": cable_id},
            )
    if getattr(cable, f"extremo_{extremo}_id") is not None:
        raise ErrorConflicto(
            f"El extremo {extremo} del cable #{cable_id} ya está ocupado por el "
            f"elemento #{getattr(cable, f'extremo_{extremo}_id')}.",
            {"cable_id": cable_id, "extremo": extremo},
        )

    setattr(cable, f"extremo_{extremo}_id", elemento.id)
    db.flush()
    return {
        "cable": {"id": cable.id, "extremo": extremo,
                  "extremo_a_id": cable.extremo_A_id,
                  "extremo_b_id": cable.extremo_B_id},
        "revision": revision(elemento),
    }


def _validar_tipo_equipo(db: Session, elemento, tipo_id, tipo: str) -> None:
    """El `tipo_id` debe existir, ser del MISMO proyecto y de la categoría correcta."""
    if tipo_id is None:
        return
    plantilla = db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.id == int(tipo_id)).first()
    if not plantilla:
        raise ErrorRegla(f"El tipo #{tipo_id} no existe en el catálogo.",
                         codigo="tipo_no_existe")
    if plantilla.proyecto_id != elemento.proyecto_id:
        raise ErrorRegla(
            f"El tipo #{tipo_id} es de otro proyecto ({plantilla.proyecto_id}).",
            codigo="tipo_de_otro_proyecto",
        )
    esperada = "switches" if tipo == "switch" else tipo
    if (plantilla.categoria or "").lower() != esperada:
        raise ErrorRegla(
            f"El tipo #{tipo_id} es de «{plantilla.categoria}» y el equipo es «{tipo}».",
            codigo="tipo_de_otra_categoria",
        )


def _division_de_tipo(db: Session, tipo_id) -> Optional[str]:
    """División implícita de una plantilla del catálogo («Splitter … 1x16» → «1x16»).

    Permite que «+ EQUIPO» funcione con tipos que no traen `relacion_division` en
    sus propiedades: se busca en las propiedades y, si no está, en el nombre.
    """
    if tipo_id is None:
        return None
    plantilla = db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.id == int(tipo_id)).first()
    if not plantilla:
        return None
    propiedades = plantilla.propiedades or {}
    for clave in ("relacion_division", "division", "ratio"):
        normal = _division(propiedades.get(clave))
        if normal:
            return normal
    import re
    encontrado = re.search(r"(\d+)\s*[xX]\s*(\d+)", str(plantilla.nombre_id or ""))
    if encontrado and encontrado.group(1) == "1":
        return f"1x{int(encontrado.group(2))}"
    return None


def crear_dispositivo(db: Session, contenedor_id: int, datos: Dict[str, Any]) -> Dict[str, Any]:
    """Crea un equipo dentro del contenedor y genera sus puertos según el tipo.

    Si llega `tipo_id`, se usa la plantilla del catálogo (propiedades, división,
    atenuación, clase AF/AC) y se valida que sea del proyecto y de la categoría.
    """
    elemento = contenedor(db, contenedor_id)
    tipo = str(datos.get("tipo") or "").lower()
    if tipo not in TIPOS_EQUIPO:
        raise ErrorRegla(
            f"Tipo de equipo no válido: «{tipo}». Usa {', '.join(TIPOS_EQUIPO)}.",
            codigo="tipo_equipo_invalido",
        )
    # El catálogo manda: si viene `tipo_id`, tiene que existir, ser del proyecto
    # y de la categoría correcta (así «+ EQUIPO» solo ofrece lo que hay en Tipos).
    _validar_tipo_equipo(db, elemento, datos.get("tipo_id"), tipo)
    tipo_id = datos.get("tipo_id")
    tipo_obj = db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.id == tipo_id).first() if tipo_id else None
    props_tipo = (tipo_obj.propiedades or {}) if tipo_obj else {}

    division = _division(datos.get("division")) if tipo == "splitter" else None
    if tipo == "splitter" and not division:
        # El catálogo manda: si el tipo declara la división (propiedades o nombre),
        # no hace falta que el usuario la escriba otra vez.
        division = _division_de_tipo(db, tipo_id)
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
    if tipo == "olt" and props_tipo:
        if props_tipo.get("puertos_pon"):
            salidas = int(props_tipo["puertos_pon"])
        elif props_tipo.get("slots_detalle"):
            suma_pon = sum(int(s.get("puertos", 0)) for s in props_tipo.get("slots_detalle", []))
            if suma_pon > 0:
                salidas = suma_pon

    equipo = logica.FtthDispositivo(
        proyecto_id=elemento.proyecto_id, elemento_id=elemento.id,
        bandeja_id=datos.get("bandeja_id"), tipo_id=tipo_id, tipo=tipo,
        serie=datos.get("nombre") or datos.get("serie"), division=division,
        puertos_in=1 if tipo == "splitter" else 0, puertos_out=salidas,
        atenuacion_db=(datos.get("perdida_db") if datos.get("perdida_db") is not None
                       else (reglas.perdida_splitter(division) if division else None)),
        estado=datos.get("estado") or "operativo",
    )
    db.add(equipo)
    db.flush()
    puertos = _generar_puertos(db, elemento, equipo, tipo, salidas, props_tipo=props_tipo)
    return {"dispositivo": _dto_equipo(equipo), "puertos": puertos,
            "revision": revision(elemento)}


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
            "revision": revision(elemento)}


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
        "revision_destino": subir_revision(db, destino.id),
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
            "revision": revision(elemento)}


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


def guardar_posiciones(db: Session, contenedor_id: int,
                       posiciones: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Guarda el orden del lienzo (x/y de cada equipo). Es presentación, no topología."""
    elemento = contenedor(db, contenedor_id)
    ids = {
        fila.id for fila in db.query(logica.FtthDispositivo.id)
        .filter(logica.FtthDispositivo.elemento_id == elemento.id).all()
    }
    existentes = {
        fila.dispositivo_id: fila
        for fila in db.query(logica.FtthDiagramaPosicion)
        .filter(logica.FtthDiagramaPosicion.elemento_id == elemento.id).all()
    }
    guardadas = []
    for item in posiciones:
        dispositivo_id = int(item["dispositivo_id"])
        if dispositivo_id not in ids:
            raise ErrorNoEncontrado(
                f"El dispositivo #{dispositivo_id} no está en el contenedor #{contenedor_id}.")
        x, y = float(item["x"]), float(item["y"])
        fila = existentes.get(dispositivo_id)
        if fila is None:
            fila = logica.FtthDiagramaPosicion(
                proyecto_id=elemento.proyecto_id, elemento_id=elemento.id,
                dispositivo_id=dispositivo_id, x=x, y=y,
            )
            db.add(fila)
            existentes[dispositivo_id] = fila
        else:
            fila.x, fila.y = x, y
        guardadas.append({"dispositivo_id": dispositivo_id, "x": x, "y": y})
    db.flush()
    return {"guardadas": guardadas, "revision": revision(elemento)}


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
        "revision": revision(elemento),
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
    return {"conexion_id": conexion_id, "revision": revision(elemento)}


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
        "revision": revision(elemento),
    }





