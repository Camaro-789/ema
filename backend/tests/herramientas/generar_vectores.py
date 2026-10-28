"""
generar_vectores.py — Vectores dorados desde el PROPIO HTML (Fase 3.2).

Abre `frontend/pop_gestor_v25.html` con Playwright y llama a SUS funciones
(`validateStep`, `mkEp`, `portInfo`) para cada combinación de extremos, contexto y
opciones. El resultado se guarda en `tests/vectores_reglas.json` y es la verdad
contra la que se prueba el validador de Python.

El HTML **no se modifica** (R1): solo se ejecuta y se lee.

Uso (desde backend/):
    python tests/herramientas/generar_vectores.py
"""
import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLANTILLA = os.path.join(os.path.dirname(BASE), "frontend", "pop_gestor_v25.html")

# Extremos base: (tipo, eq_id, puerto, cara)
EXTREMOS = [
    ("OLT", 1, "PON 1", None),
    ("OLT", 1, "SFP 1", None),
    ("OLT", 1, "RJ45 1", None),
    ("SWITCH", 2, "SFP 1", None),
    ("SWITCH", 2, "RJ45 1", None),
    ("ODF", 3, "ODF-01", "A"),
    ("ODF", 3, "ODF-01", "B"),
    ("SPLITTER", 4, "IN", None),
    ("SPLITTER", 4, "OUT 1", None),
    ("CABLE", 7, "HILO 1", None),
]

OPCIONES = [
    ("como_destino", {"asOrigin": False}),
    ("como_origen_acceso", {"asOrigin": True, "signal": "ACCESO"}),
    ("como_origen_enlace", {"asOrigin": True, "signal": "ENLACE"}),
]

ESCENARIOS = ["limpio", "ocupado"]


def familia(mensaje: str) -> str:
    """Clasifica el mensaje del HTML en la misma taxonomía que usa pytest.

    Se decide por el PREFIJO del mensaje (la regla), no por las palabras que
    aparezcan en las etiquetas de los extremos: "Un puerto RJ45 ... ni un
    splitter" es la regla RJ45, no la del splitter.
    """
    texto = (mensaje or "").strip().lower()
    if not texto:
        return "ok"
    # Muchos mensajes empiezan por la etiqueta del puerto ("OLT 1 (Huawei) · PON 1
    # ya está conectado con…"), así que se busca la frase de la REGLA en cualquier
    # posición, de la más específica a la más genérica.
    frases = [
        ("combinación no válida", "combinacion"),
        ("combinacion no valida", "combinacion"),
        ("origen y destino son el mismo", "mismo"),
        ("un puerto rj45", "rj45"),
        ("ya está conectado", "ocupado"),
        ("ya esta conectado", "ocupado"),
        ("cerraría un lazo", "lazo"),
        ("ya existe un origen", "origen"),
        ("uniría dos orígenes", "origen"),
        ("no se pueden mezclar", "dominio"),
        ("solo transportan señal pon", "dominio"),
        ("el origen debe ser", "origen"),
        ("indica qué tipo de señal", "origen"),
        ("un splitter solo se conecta", "splitter"),
        ("entran por la entrada in", "splitter"),
        ("solo puede conectarse a un splitter", "splitter"),
        ("entre splitters conecta", "splitter"),
        ("pon siempre es origen", "pon"),
        ("una pon es origen", "pon"),
    ]
    for frase, clase in frases:
        if frase in texto:
            return clase
    if "splitter" in texto:
        return "splitter"
    if "rj45" in texto:
        return "rj45"
    if "pon" in texto:
        return "pon"
    return "otro"


GUION = """
([ea, eb, escenario, opciones]) => {
  const a = mkEp(ea[1], ea[0], ea[2], ea[3] || null);
  const b = mkEp(eb[1], eb[0], eb[2], eb[3] || null);
  if (escenario === 'ocupado') {
    connections = [{ id: 900, from: a, to: b, origin: false, signal: null }];
  } else {
    connections = [];
  }
  try {
    const r = validateStep(a, b, opciones);
    return { ok: !!r.ok, mensaje: r.ok ? '' : (r.msg || ''),
             tipoA: portInfo(a).kind, tipoB: portInfo(b).kind };
  } catch (e) {
    return { ok: false, mensaje: 'EXCEPCION: ' + e.message, tipoA: null, tipoB: null };
  }
}
"""


def sha256(ruta: str) -> str:
    digest = hashlib.sha256()
    with open(ruta, "rb") as archivo:
        for bloque in iter(lambda: archivo.read(65536), b""):
            digest.update(bloque)
    return digest.hexdigest().upper()


def _lanzar(playwright):
    """Abre un navegador: primero el de Playwright y, si falta, el Edge del sistema."""
    intentos = [(None, "chromium de Playwright"), ("msedge", "Microsoft Edge"),
                ("chrome", "Google Chrome")]
    for canal, nombre in intentos:
        try:
            navegador = (playwright.chromium.launch(channel=canal) if canal
                         else playwright.chromium.launch())
            print(f"navegador: {nombre}")
            return navegador
        except Exception as error:  # noqa: BLE001
            print(f"  {nombre} no disponible: {type(error).__name__}")
    raise RuntimeError(
        "No hay navegador disponible. Ejecuta: python -m playwright install chromium")


def generar(salida: str) -> int:
    from playwright.sync_api import sync_playwright

    if not os.path.exists(PLANTILLA):
        print(f"ABORTADO: no existe {PLANTILLA}")
        return 2

    casos = []
    excepciones = 0
    sin_clasificar = 0
    with sync_playwright() as playwright:
        navegador = _lanzar(playwright)
        pagina = navegador.new_page()
        pagina.goto(PLANTILLA, wait_until="domcontentloaded", timeout=60000)
        disponible = pagina.evaluate(
            "() => [typeof validateStep, typeof mkEp, typeof portInfo]")
        print(f"funciones en la plantilla: {disponible}")
        if disponible[0] != "function":
            print("ABORTADO: la plantilla no expone validateStep.")
            navegador.close()
            return 2

        numero = 0
        for indice_a, a in enumerate(EXTREMOS):
            for indice_b, b in enumerate(EXTREMOS):
                if indice_a == indice_b:
                    continue
                for escenario in ESCENARIOS:
                    for nombre_opcion, opcion in OPCIONES:
                        numero += 1
                        resultado_html = pagina.evaluate(
                            GUION, [list(a), list(b), escenario, opcion])
                        mensaje = str(resultado_html.get("mensaje") or "")
                        if mensaje.startswith("EXCEPCION"):
                            excepciones += 1
                        clase = familia(mensaje)
                        if clase == "otro":
                            sin_clasificar += 1
                        contexto = {"escenario": escenario}
                        # El validador de Python recibe el contexto en SU formato:
                        # así la prueba no depende de cómo el HTML guarda el estado.
                        contexto["es_origen"] = bool(opcion.get("asOrigin"))
                        if opcion.get("signal"):
                            contexto["senal"] = opcion["signal"]
                        if escenario == "ocupado":
                            contexto["ocupados"] = [
                                f"{a[0]}:{a[1]}:{a[2]}:{a[3] or ''}",
                                f"{b[0]}:{b[1]}:{b[2]}:{b[3] or ''}",
                            ]
                        casos.append({
                            "id": f"v{numero:04d}",
                            "origen": {"tipo": a[0], "eq_id": a[1], "puerto": a[2],
                                       "cara": a[3]},
                            "destino": {"tipo": b[0], "eq_id": b[1], "puerto": b[2],
                                        "cara": b[3]},
                            "contexto": contexto,
                            "opciones_html": nombre_opcion,
                            "esperado": {
                                "ok": bool(resultado_html.get("ok")),
                                "familia": clase,
                                "mensaje_html": mensaje,
                            },
                            "motivo": f"{escenario} / {nombre_opcion}",
                        })
        navegador.close()

    documento = {
        "fuente": "frontend/pop_gestor_v25.html",
        "sha256_plantilla": sha256(PLANTILLA),
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "herramienta": "Playwright 1.64.1 (page.evaluate sobre validateStep)",
        "aviso": ("`opciones_html` es informativo: el validador de Python recibe "
                  "solo el contexto. Los casos que dependen de asOrigin/signal se "
                  "contrastan por familia de regla."),
        "total": len(casos),
        "por_familia": {},
        "casos": casos,
    }
    for caso in casos:
        clave = caso["esperado"]["familia"]
        documento["por_familia"][clave] = documento["por_familia"].get(clave, 0) + 1

    os.makedirs(os.path.dirname(salida), exist_ok=True)
    with open(salida, "w", encoding="utf-8") as archivo:
        json.dump(documento, archivo, ensure_ascii=False, indent=1)

    print(f"vectores: {len(casos)} -> {salida}")
    print(f"familias: {documento['por_familia']}")
    print(f"excepciones: {excepciones} · sin clasificar: {sin_clasificar}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera los vectores dorados desde el HTML")
    parser.add_argument("--salida", default=os.path.join(BASE, "tests", "vectores_reglas.json"))
    args = parser.parse_args()
    return generar(os.path.abspath(args.salida))


if __name__ == "__main__":
    raise SystemExit(main())

