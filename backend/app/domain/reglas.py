"""Validador ÚNICO de conexiones (dominio puro).

No importa FastAPI ni SQLAlchemy: recibe diccionarios y lanza errores de dominio.
Es el que usa todo comando de escritura (Fase 3.1).

Fuente de verdad: `frontend/pop_gestor_v25.html` → PORT_TABLE (~724),
DOMAIN (~735), validateStep (~760-796), canBeOrigin (~746).
Este módulo es su traducción, leyendo `reglas_conexion.json`.

Extremos: {"tipo": "CABLE|OLT|ODF|SPLITTER|SWITCH", "eq_id": int,
           "puerto": "PON 1" | "OUT 3" | "HILO 12" | "ODF-01", "cara": "A"|"B"|None}
"""
import json
import os
import re
from functools import lru_cache
from typing import Optional

from .errores import ErrorRegla

RUTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reglas_conexion.json")


@lru_cache(maxsize=1)
def reglas() -> dict:
    with open(RUTA, encoding="utf-8") as archivo:
        return json.load(archivo)


@lru_cache(maxsize=1)
def _tabla_puertos():
    return [(fila, re.compile(fila["patron"])) for fila in reglas()["puertos"]]


def info_puerto(tipo_equipo: str, puerto: str) -> dict:
    """kind/dominio/origen de un puerto, igual que PORT_TABLE del HTML."""
    for fila, patron in _tabla_puertos():
        if fila["tipo_equipo"] == tipo_equipo and patron.search(str(puerto or "")):
            return fila
    return {"kind": "?", "dominio": None, "activo": False, "es_origen": False}


def rol(extremo: dict) -> str:
    tipo = extremo["tipo"]
    if tipo == "CABLE":
        return "cable"
    if tipo == "ODF":
        return "odfB" if (extremo.get("cara") or "A").upper() == "B" else "odfA"
    return "dev"


def clave(extremo: dict) -> str:
    return f"{extremo['tipo']}:{extremo['eq_id']}:{extremo.get('puerto')}:{extremo.get('cara') or ''}"


def _kind(extremo: dict) -> str:
    if extremo["tipo"] == "CABLE":
        return "HILO"
    return info_puerto(extremo["tipo"], extremo.get("puerto"))["kind"]


def dominio_de(extremo: dict) -> Optional[str]:
    return info_puerto(extremo["tipo"], extremo.get("puerto")).get("dominio")


def perdida_splitter(division: Optional[str]) -> float:
    """Pérdida teórica del splitter según su división (1x8 → 10.7 dB)."""
    tabla = reglas()["splitters"]["divisiones_balanceadas"]
    return float(tabla.get(str(division or "").strip(),
                           reglas()["perdidas_db"]["splitter_por_defecto"]))


def estado_potencia(senal: Optional[str], dbm: Optional[float], cobre: bool = False) -> str:
    """'ok' | 'low' | 'high' según los umbrales del dominio (powerState del HTML)."""
    if cobre or dbm is None or senal not in reglas()["dominios"]:
        return "ok"
    umbral = reglas()["dominios"][senal]
    minimo, maximo = umbral.get("min_dbm"), umbral.get("max_dbm")
    if minimo is not None and dbm < minimo:
        return "low"
    if maximo is not None and dbm > maximo:
        return "high"
    return "ok"


def _error(regla_id: str, detalle=None) -> ErrorRegla:
    mensaje = next((r["mensaje_es"] for r in reglas()["reglas"] if r["id"] == regla_id),
                   "Regla de conexión no cumplida.")
    return ErrorRegla(mensaje, detalle, codigo=regla_id)


def validar_conexion(a: dict, b: dict, contexto: Optional[dict] = None) -> dict:
    """Único validador (equivalente a `validateStep` del HTML).

    Devuelve {"ok": True, "dominio": ..., "extension": bool} o lanza ErrorRegla.
    """
    contexto = contexto or {}
    if clave(a) == clave(b):
        raise ErrorRegla("Origen y destino son el mismo puerto.", codigo="mismo_puerto")

    ka, kb = _kind(a), _kind(b)
    ra, rb = rol(a), rol(b)
    par = "+".join(sorted([ra, rb]))
    pares_ok = reglas()["reglas"][1]["pares_ok"]
    mismo_equipo = str(a["eq_id"]) == str(b["eq_id"])
    if par not in pares_ok and not (par == "dev+dev" and not mismo_equipo):
        raise _error("combinacion_valida", f"{ra} ↔ {rb}")

    if (ka == "RJ45" or kb == "RJ45") and ka != kb:
        raise _error("rj45_solo_rj45")

    ocupados = set(contexto.get("ocupados") or [])
    for extremo in (a, b):
        if clave(extremo) in ocupados:
            raise _error("puerto_libre", clave(extremo))

    splitters = [e for e in (a, b) if e["tipo"] == "SPLITTER"]
    extension = False
    if splitters:
        permitidos = set(reglas()["splitters"]["conecta_con"])

        def _aceptado(otro: dict) -> bool:
            kind = _kind(otro)
            if kind in permitidos:
                return True
            # Extensión v26: OUT del splitter → hilo de cable (cajas y mangas).
            return kind == "HILO" and otro["tipo"] == "CABLE"

        if not all(_aceptado(e) for e in (a, b)):
            raise _error("splitter_conexiones")
        for splitter in splitters:
            otro = b if splitter is a else a
            es_entrada = str(splitter.get("puerto", "")).upper() == "IN"
            # Igual que el HTML: si al splitter le llega una PON o un cable de
            # calle, tiene que entrar por IN.
            if _kind(otro) in ("PON", "HILO") and not es_entrada:
                raise _error("splitter_entrada_in")
            if _kind(otro) == "PON":
                clase = (contexto.get("clase_splitter") or {}).get(clave(splitter), "AF")
                if str(clase).upper() == "AC":
                    raise _error("splitter_af_para_pon")
            if _kind(otro) == "HILO" and otro["tipo"] == "CABLE" and not es_entrada:
                extension = True
        if len(splitters) == 2:
            primera = str(splitters[0].get("puerto", "")).upper()
            segunda = str(splitters[1].get("puerto", "")).upper()
            if primera == segunda:
                raise _error("splitter_out_a_in")

    if kb == "PON":
        # El HTML permite PON como DESTINO solo en "vista de subida": cuando la
        # traza nace en un hilo de cable marcado como señal de ACCESO.
        en_subida = bool(contexto.get("vista_subida")) or (
            contexto.get("es_origen") and ka == "HILO"
            and contexto.get("senal") == "ACCESO"
        )
        if not en_subida:
            raise _error("pon_solo_subida")
    if ka == "PON" and not contexto.get("es_origen", True):
        raise _error("pon_es_origen")

    # `asOrigin` del HTML: el extremo de origen tiene que poder serlo (canBeOrigin).
    # Va ANTES de los dominios, igual que en `validateStep`.
    if contexto.get("es_origen"):
        info_origen = info_puerto(a["tipo"], a.get("puerto"))
        if not info_origen.get("es_origen"):
            raise ErrorRegla(
                "El origen debe ser una PON/SFP/RJ45 de OLT o switch, o un hilo de "
                "cable. El ODF y el splitter solo transmiten la señal.",
                codigo="origen_no_valido",
            )
        if info_origen.get("requiere_senal") and not contexto.get("senal"):
            raise ErrorRegla(
                "Indica qué tipo de señal entra por este hilo (ACCESO o ENLACE).",
                codigo="senal_requerida",
            )

    cadena = set(contexto.get("cadena") or [])
    if clave(b) in cadena and clave(a) in cadena:
        raise _error("sin_lazos")

    dominios = set(contexto.get("dominios") or [])
    # El HTML hace `pi.domain || signal`: la señal solo aporta dominio cuando el
    # puerto de origen no tiene uno propio (es el caso del hilo de cable).
    if contexto.get("senal") and not dominio_de(a):
        dominios.add(contexto["senal"])
    for extremo in (a, b):
        dominio = dominio_de(extremo)
        if dominio:
            dominios.add(dominio)
    if len(dominios) > 1:
        raise _error("dominios_no_se_mezclan", sorted(dominios))
    if "ENLACE" in dominios and splitters:
        raise _error("splitter_solo_optico")

    if len(set(contexto.get("origenes") or [])) > 1:
        raise _error("un_solo_origen")

    return {"ok": True, "dominio": next(iter(dominios), None), "extension": extension}


def validar_origen(extremo: dict, senal: Optional[str], contexto: Optional[dict] = None) -> str:
    """Marca un origen de señal (equivale a `canBeOrigin`). Devuelve el dominio."""
    contexto = contexto or {}
    info = info_puerto(extremo["tipo"], extremo.get("puerto"))
    if not info.get("es_origen"):
        raise ErrorRegla(
            "El origen debe ser una PON/SFP/RJ45 de OLT o switch, o un hilo de cable. "
            "El ODF y el splitter solo transmiten la señal.",
            codigo="origen_no_valido",
        )
    if info.get("requiere_senal") and senal not in reglas()["dominios"]:
        raise ErrorRegla("Indica qué tipo de señal entra por este hilo (ACCESO o ENLACE).",
                         codigo="senal_requerida")
    dominio = info.get("dominio") or senal
    if senal and info.get("dominio") and senal != info["dominio"]:
        raise ErrorRegla(f"Un puerto {info['kind']} solo transporta señal {info['dominio']}.",
                         codigo="senal_incompatible")
    otros = [d for d in (contexto.get("dominios") or []) if d and d != dominio]
    if dominio and otros:
        raise _error("dominios_no_se_mezclan", otros)
    if contexto.get("origenes"):
        raise _error("un_solo_origen", contexto["origenes"])
    return dominio

