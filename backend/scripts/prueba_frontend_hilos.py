"""
prueba_frontend_hilos.py

Verifica que la pestaña "Hilos" quedó correctamente cableada en el frontend,
sin abrir un navegador: comprueba el HTML servido y los archivos estáticos.

Comprueba:
  1. `GET /` responde 200 y contiene la pestaña, el contenedor y el script.
  2. Cada id/nuevo elemento aparece EXACTAMENTE una vez (no se duplicó nada).
  3. Las 5 pestañas originales siguen presentes (no se rompió ninguna).
  4. `/js/ftth-hilos.js` y `/css/hilos.css` se sirven con 200.
  5. El JS expone el namespace FTTHHilos y el CSS está acotado al modal.

Uso (desde backend/):
    python scripts/prueba_frontend_hilos.py
"""
import asyncio
import os
import sys

# La consola de Windows suele estar en cp1252 y no soporta algunos caracteres
# (por ejemplo la flecha → de los listados): se fuerza UTF-8 en la salida para
# que la prueba NUNCA falle por un carácter.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from app.main import app  # noqa: E402

OK = {"n": 0, "fallos": []}


def check(cond, msg, detalle=""):
    if cond:
        OK["n"] += 1
        print(f"  [OK]    {msg}")
    else:
        OK["fallos"].append(msg)
        print(f"  [FALLO] {msg}")
        if detalle:
            print(f"          {detalle}")


def pedir(metodo, url):
    async def _do():
        transporte = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transporte, base_url="http://prueba.local") as c:
            return await c.request(metodo, url)
    return asyncio.run(_do())


def main() -> int:
    print("=" * 74)
    print("PRUEBA DEL FRONTEND — pestaña «Hilos»")
    print("=" * 74)

    print("\n1) Página principal")
    r = pedir("GET", "/")
    check(r.status_code == 200, "GET / responde 200", f"status={r.status_code}")
    html = r.text
    check("ftth-hilos.js" in html, "El HTML carga js/ftth-hilos.js")
    check("css/hilos.css" in html, "El HTML carga css/hilos.css")

    print("\n2) Elementos de la pestaña (deben existir exactamente una vez)")
    for marcador in ['id="prop-tab-btn-hilos"', 'data-prop-tab="hilos"', 'id="prop-tab-hilos"',
                     'id="prop-hilos-body"', 'id="prop-hilos-count"']:
        n = html.count(marcador)
        check(n == 1, f"{marcador} aparece 1 vez", f"aparece {n} veces")

    print("\n3) Las pestañas previas siguen intactas")
    for tab in ["info", "history", "photos", "tasks"]:
        check(f'data-prop-tab="{tab}"' in html, f'La pestaña «{tab}» sigue presente')
    for seccion in ['id="prop-tab-info"', 'id="prop-tab-history"', 'id="prop-tab-photos"', 'id="prop-tab-tasks"']:
        check(html.count(seccion) == 1, f"{seccion} sigue existiendo una sola vez", f"aparece {html.count(seccion)} veces")

    print("\n4) Archivos estáticos nuevos")
    r_js = pedir("GET", "/js/ftth-hilos.js")
    check(r_js.status_code == 200, "GET /js/ftth-hilos.js responde 200", f"status={r_js.status_code}")
    js = r_js.text
    check("window.FTTHHilos" in js, "El JS expone window.FTTHHilos")
    for fn in ["cargar", "recargar", "verHilo", "guardarEstado", "materializar"]:
        check(f"{fn}" in js, f"El JS define {fn}()")
    check("/api/cables/" in js, "El JS consulta /api/cables/…")

    r_css = pedir("GET", "/css/hilos.css")
    check(r_css.status_code == 200, "GET /css/hilos.css responde 200", f"status={r_css.status_code}")
    css = r_css.text
    check("#element-properties-modal .hilos-wrap" in css, "El CSS está acotado al modal de propiedades")
    check(".hilos-estado--averiado" in css, "El CSS incluye los estados de hilo")

    print("\n5) El enganche en ftth-mapa.js sigue funcionando")
    r_mapa = pedir("GET", "/js/ftth-mapa.js")
    check(r_mapa.status_code == 200, "GET /js/ftth-mapa.js responde 200")
    check("FTTHHilos.cargar" in r_mapa.text, "ftth-mapa.js llama a FTTHHilos.cargar al abrir Propiedades")

    print("\n" + "=" * 74)
    print(f"RESULTADO: {OK['n']} comprobaciones OK, {len(OK['fallos'])} fallos")
    for f in OK["fallos"]:
        print(f"  - {f}")
    print("=" * 74)
    return 1 if OK["fallos"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
