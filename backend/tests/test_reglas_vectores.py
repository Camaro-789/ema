"""
test_reglas_vectores.py — Vectores dorados contra el validador de Python (Fase 3.2).

Los vectores salen del PROPIO HTML (`frontend/pop_gestor_v25.html`) ejecutando sus
funciones con Playwright (`tests/herramientas/generar_vectores.py`) y quedan en
`tests/vectores_reglas.json`.

Regla del proyecto: si el HTML y Python difieren, **se corrige Python**, nunca el
HTML (R1).

Uso:
    cd backend
    python -m pytest tests/test_reglas_vectores.py -q
"""
import json
import os

import pytest

from app.domain import reglas
from app.domain.errores import ErrorDominio

RUTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vectores_reglas.json")

# Código del validador de Python → familia de la regla (misma taxonomía que usa
# el generador para clasificar el mensaje del HTML).
FAMILIA = {
    "mismo_puerto": "mismo",
    "combinacion_valida": "combinacion",
    "rj45_solo_rj45": "rj45",
    "puerto_libre": "ocupado",
    "sin_duplicados": "ocupado",
    "splitter_conexiones": "splitter",
    "splitter_entrada_in": "splitter",
    "splitter_af_para_pon": "splitter",
    "splitter_out_a_in": "splitter",
    "splitter_solo_optico": "dominio",
    "pon_solo_subida": "pon",
    "pon_es_origen": "pon",
    "dominios_no_se_mezclan": "dominio",
    "sin_lazos": "lazo",
    "un_solo_origen": "origen",
    "origen_no_valido": "origen",
    "senal_requerida": "origen",
}


def _vectores():
    if not os.path.exists(RUTA):
        pytest.skip("faltan los vectores: ejecuta tests/herramientas/generar_vectores.py")
    with open(RUTA, encoding="utf-8") as archivo:
        return json.load(archivo).get("casos", [])


CASOS = _vectores()


def test_hay_vectores_suficientes():
    assert len(CASOS) >= 100, f"solo hay {len(CASOS)} vectores dorados"


# Casos en los que la diferencia es INTENCIONAL y está documentada:
# el HTML rechaza "OUT del splitter → hilo" y nuestro validador lo acepta como
# extensión v26 (reglas_conexion.json → reglas_extension).
EXTENSION_INTENCIONAL = []


@pytest.mark.parametrize("caso", CASOS, ids=[c.get("id") for c in CASOS])
def test_vector(caso):
    esperado = caso["esperado"]
    contexto = caso.get("contexto") or {}
    try:
        resultado = reglas.validar_conexion(caso["origen"], caso["destino"], contexto)
        obtenido = {"ok": True, "familia": "ok", "extension": resultado.get("extension")}
    except ErrorDominio as error:
        resultado = None
        obtenido = {"ok": False, "familia": FAMILIA.get(error.codigo, error.codigo),
                    "extension": False}

    if not esperado["ok"] and obtenido["ok"] and obtenido.get("extension"):
        # Diferencia intencional (extensión v26). Se registra, no se oculta.
        assert esperado["familia"] in ("splitter", "combinacion"), (
            f"{caso['id']}: extensión aceptada donde el HTML dice "
            f"{esperado['familia']} ({esperado.get('mensaje_html')})")
        EXTENSION_INTENCIONAL.append(caso["id"])
        pytest.skip(f"extensión v26 documentada ({esperado['familia']})")

    # Solo las reglas que necesitan el GRAFO de la cadena quedan declaradas como
    # diferencia abierta (Fase 3.5). Las demás (incluida canBeOrigin) se exigen.
    mensaje_html = (esperado.get("mensaje_html") or "").lower()
    if ("ya existe un origen" in mensaje_html or "uniría dos orígenes" in mensaje_html
            or "cerraría un lazo" in mensaje_html):
        pytest.xfail("requiere contexto de cadena (origen/lazo): gap declarado")

    assert obtenido["ok"] == esperado["ok"], (
        f"{caso['id']}: el HTML dice ok={esperado['ok']} "
        f"({esperado.get('mensaje_html')}) y Python dice ok={obtenido['ok']}")
    if not esperado["ok"]:
        assert obtenido["familia"] == esperado["familia"], (
            f"{caso['id']}: familia de regla distinta — HTML={esperado['familia']} "
            f"({esperado.get('mensaje_html')}) Python={obtenido['familia']}")
