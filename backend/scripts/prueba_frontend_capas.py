"""
prueba_frontend_capas.py

Verifica que el panel derecho «Capas del Proyecto» quedó minimalista SIN romper
nada de lo que usa el árbol de capas (ftth-carpetas.js).

Comprueba:
  1. El CSS minimalista se sirve y está acotado a #folders-panel.
  2. index.html enlaza ese CSS y quitó el emoji de la cabecera.
  3. ftth-carpetas.js CONSERVA todas las clases e ids del árbol (si falta una,
     el árbol deja de funcionar: por eso se comprueban una a una).
  4. El resto de paneles/modales sigue en pie.

Uso (desde backend/):
    python scripts/prueba_frontend_capas.py
"""
import asyncio
import os
import sys

# La consola de Windows puede estar en cp1252: se fuerza UTF-8 en la salida.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from app.main import app  # noqa: E402

R = {"ok": 0, "fallos": []}


def check(cond, msg, detalle=""):
    if cond:
        R["ok"] += 1
        print(f"  [OK]    {msg}")
    else:
        R["fallos"].append(msg)
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
    print("PRUEBA DEL FRONTEND — panel «Capas del Proyecto» minimalista")
    print("=" * 74)

    print("\n1) Hoja de estilos nueva")
    r_css = pedir("GET", "/css/capas-minimal.css")
    check(r_css.status_code == 200, "GET /css/capas-minimal.css responde 200", f"status={r_css.status_code}")
    css = r_css.text
    check("#folders-panel .folders-header" in css, "Los estilos están acotados a #folders-panel")
    check("#folders-panel .folder-node-header" in css, "Refina la fila de cada capa")
    check("#folders-panel .folder-actions" in css, "Refina las acciones de la fila")
    check("text-transform: uppercase" in css, "La cabecera usa etiqueta micro (mayúsculas)")
    check(".folder-children" in css, "Mantiene la jerarquía de subcarpetas")

    print("\n2) index.html")
    r = pedir("GET", "/")
    html = r.text
    check(r.status_code == 200, "GET / responde 200")
    check("css/capas-minimal.css" in html, "El HTML carga el CSS minimalista")
    check("📚 Capas del Proyecto" not in html, "Se quitó el emoji de la cabecera")
    check(">Capas del Proyecto<" in html, "La cabecera dice «Capas del Proyecto»")
    check('id="folders-panel"' in html, "El panel derecho sigue existiendo")
    check('id="folders-tree"' in html, "El contenedor del árbol sigue existiendo")
    check('id="btn-new-folder"' in html, "El botón de nueva carpeta sigue existiendo")
    check('id="folder-form"' in html and 'id="folder-name"' in html, "El formulario de carpeta sigue igual")

    print("\n3) El árbol de capas no se rompió (ftth-carpetas.js)")
    r_js = pedir("GET", "/js/ftth-carpetas.js")
    check(r_js.status_code == 200, "GET /js/ftth-carpetas.js responde 200", f"status={r_js.status_code}")
    js = r_js.text
    for pieza in [
        "folder-node", "folder-node-header", "folder-children", "folder-tree",
        "folder-vis-check", "folder-toggle", "folder-name", "folder-actions",
        "folder-elemento-node", "folder-vis-check", "btn-icon",
        'data-action="add-sub"', 'data-action="rename"', 'data-action="delete"',
        "dataset.carpetaId", "dataset.elemId",
    ]:
        check(pieza in js, f"Conserva «{pieza}»")
    check("📁" not in js, "Se quitó el emoji 📁 del nombre de la capa")
    check("addSubcarpeta" in js and "renameCarpeta" in js and "deleteCarpeta" in js,
          "Las tres acciones siguen conectadas en el JS")

    print("\n4) Nada anterior se rompió")
    for previo in ['id="element-properties-modal"', 'id="ftth-diagrama-modal"',
                   'id="ftth-tipos-modal"', 'id="dashboard-modal"']:
        check(previo in html, f"{previo} sigue presente")
    check("js/ftth-carpetas.js" in html, "El módulo de capas sigue cargado")
    check("js/ftth-diagrama.js" in html, "El módulo del diagrama sigue cargado")

    print("\n" + "=" * 74)
    print(f"RESULTADO: {R['ok']} comprobaciones OK, {len(R['fallos'])} fallos")
    for f in R["fallos"]:
        print(f"  - {f}")
    print("=" * 74)
    return 1 if R["fallos"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
