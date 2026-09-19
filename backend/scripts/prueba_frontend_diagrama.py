"""
prueba_frontend_diagrama.py

Verifica que el diagrama del nodo (F3) quedó correctamente cableado en el frontend
y que NO se rompió nada de lo anterior.

Comprueba:
  1. `GET /` responde 200 y carga css/diagrama.css y js/ftth-diagrama.js.
  2. El modal existe una sola vez y arranca oculto.
  3. Los modales y pestañas previos siguen intactos.
  4. `/js/ftth-diagrama.js` se sirve y expone window.FTTHDiagrama.
  5. `/css/diagrama.css` está acotado a #ftth-diagrama-modal.
  6. `ftth-mapa.js` engancha el clic izquierdo CON guardas (modo colocar / mover)
     y añade la acción «Abrir Diagrama Lógico» al menú contextual.
  7. El comportamiento anterior del clic derecho se conserva.
  8. El código nuevo no usa identificadores globales frágiles (siempre window.X).

Uso (desde backend/):
    python scripts/prueba_frontend_diagrama.py
"""
import asyncio
import os
import re
import sys

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


def globales_fragiles(js: str, simbolo: str):
    """Devuelve los usos de `simbolo.` que NO están precedidos por `window.`."""
    fragiles = []
    for m in re.finditer(re.escape(simbolo) + r"\.", js):
        inicio = m.start()
        if js[max(0, inicio - 7):inicio] != "window.":
            fragiles.append(js[max(0, inicio - 30):inicio + 30].replace("\n", " "))
    return fragiles


def main() -> int:
    print("=" * 74)
    print("PRUEBA DEL FRONTEND — diagrama del nodo (F3)")
    print("=" * 74)

    r = pedir("GET", "/")
    check(r.status_code == 200, "GET / responde 200", f"status={r.status_code}")
    html = r.text

    print("\n1) Carga de recursos nuevos")
    check("css/diagrama.css" in html, "El HTML carga css/diagrama.css")
    check("js/ftth-diagrama.js" in html, "El HTML carga js/ftth-diagrama.js")

    print("\n2) Modal del diagrama (una sola vez cada elemento)")
    for marcador in ['id="ftth-diagrama-modal"', 'id="diag-body"', 'id="diag-pie"',
                     'id="diag-title"', 'id="diag-badge"', 'id="diag-mark"',
                     'id="diag-sub"', 'id="diag-btn-close"', 'id="diag-btn-reload"']:
        n = html.count(marcador)
        check(n == 1, f"{marcador} aparece 1 vez", f"aparece {n} veces")
    check('id="ftth-diagrama-modal" class="ftth-modal-overlay hidden"' in html,
          "El diagrama arranca oculto (hidden)")
    check('<div class="diag-card">' in html, "Tiene contenedor diag-card")

    print("\n3) Nada anterior se rompió")
    for previo in ['id="element-properties-modal"', 'id="dashboard-modal"', 'id="module-modal"']:
        check(html.count(previo) == 1, f"{previo} sigue existiendo una sola vez", f"x{html.count(previo)}")
    for tab in ["info", "hilos", "history", "photos", "tasks"]:
        check(f'data-prop-tab="{tab}"' in html, f'La pestaña «{tab}» sigue presente')
    check("js/ftth-hilos.js" in html, "El módulo de hilos sigue cargado")
    check("js/ftth-mapa.js" in html, "El módulo del mapa sigue cargado")

    print("\n4) Módulo JS del diagrama")
    r_js = pedir("GET", "/js/ftth-diagrama.js")
    check(r_js.status_code == 200, "GET /js/ftth-diagrama.js responde 200", f"status={r_js.status_code}")
    js = r_js.text
    check("window.FTTHDiagrama" in js, "Expone window.FTTHDiagrama")
    for fn in ["abrir", "cerrar", "esNodo"]:
        check(fn in js, f"Define {fn}()")
    check("/api/elementos/" in js and "/nodo" in js, "Consulta GET /api/elementos/{id}/nodo")
    check("'cajanap', 'manga', 'odf', 'armario', 'olt', 'splitter'" in js,
          "Declara las categorías que conmutan hilos")
    fragiles_diag = globales_fragiles(js, "FTTHIconos") + globales_fragiles(js, "FTTHTipos")
    check(not fragiles_diag, "No usa identificadores globales frágiles", str(fragiles_diag[:2]))

    print("\n5) Hoja de estilos del diagrama")
    r_css = pedir("GET", "/css/diagrama.css")
    check(r_css.status_code == 200, "GET /css/diagrama.css responde 200", f"status={r_css.status_code}")
    css = r_css.text
    check("#ftth-diagrama-modal .diag-card" in css, "Los estilos están acotados al modal del diagrama")
    check(".diag-slot--ocupado" in css, "Incluye el estado ocupado de las posiciones de empalme")
    check(all(x in css for x in (".diag-puerto--in", ".diag-puerto--out", ".diag-puerto--bidi")),
          "Incluye los tres tipos de puerto")

    print("\n6) Enganche del clic en el mapa")
    r_mapa = pedir("GET", "/js/ftth-mapa.js")
    check(r_mapa.status_code == 200, "GET /js/ftth-mapa.js responde 200")
    mapa = r_mapa.text
    check("map.on('click', layerId" in mapa, "Enlaza el clic izquierdo sobre la capa")
    check("if (_modoActivo || _modoMover) return;" in mapa,
          "Guarda: con modo colocar/mover activo el clic NO abre el diagrama")
    check("tieneDiagrama(" in mapa, "Usa el filtro tieneDiagrama()")
    check("abrirDiagramaDelElemento" in mapa, "Define abrirDiagramaDelElemento()")
    check('data-action="diagrama"' in mapa, "El menú contextual ofrece abrir el diagrama")
    check("showPropertiesModal(props, _ctxFeature.geometry)" in mapa,
          "El clic derecho sigue abriendo Propiedades (sin cambios)")
    check('data-action="move"' in mapa and 'data-action="delete"' in mapa,
          "Las acciones Mover y Eliminar siguen presentes")
    fragiles_mapa = globales_fragiles(mapa, "FTTHDiagrama") + globales_fragiles(mapa, "FTTHHilos")
    check(not fragiles_mapa, "El mapa usa window.FTTHDiagrama / window.FTTHHilos", str(fragiles_mapa[:2]))

    print("\n7) Módulo de hilos sigue coherente")
    r_hilos = pedir("GET", "/js/ftth-hilos.js")
    check(r_hilos.status_code == 200, "GET /js/ftth-hilos.js responde 200")
    fragiles_hilos = globales_fragiles(r_hilos.text, "FTTHTipos") + globales_fragiles(r_hilos.text, "FTTHMapa")
    check(not fragiles_hilos, "La pestaña Hilos tampoco usa globales frágiles", str(fragiles_hilos[:2]))

    print("\n" + "=" * 74)
    print(f"RESULTADO: {OK['n']} comprobaciones OK, {len(OK['fallos'])} fallos")
    for f in OK["fallos"]:
        print(f"  - {f}")
    print("=" * 74)
    return 1 if OK["fallos"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

