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
    check('<div class="app-card"' in html or '<div class="diag-card">' in html,
          "Tiene contenedor de tarjeta (app-card o diag-card)")

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
    # El cable del diagrama se dibuja con SU tipo (nº de hilos y plantilla visual).
    # Antes iba fijo a 'fibra_cable' y con un objeto sintético: cualquier cable
    # (un DROP de 1 hilo, por ejemplo) se pintaba como si fuera de 12 hilos.
    check("render('fibra_cable'" not in js,
          "NO fija la plantilla de fibra a mano en el diagrama")
    check("resolverTipo(" in js, "Resuelve la plantilla del cable por lo que declara su tipo")
    check("x.cable_tipo" in js, "Usa el tipo real del cable (cable_tipo) que manda el backend")
    check("hilosReales" in js, "Pasa los hilos reales al dibujo (color y estado de la BD)")
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
    guarda = (
        "if (_modoActivo || _modoMover) return;" in mapa
        or ("if (_modoMover) return;" in mapa and "if (_modoActivo) {" in mapa)
    )
    check(guarda,
          "Guarda: con modo colocar/mover activo el clic NO abre el diagrama")
    check("tieneDiagrama(" in mapa, "Usa el filtro tieneDiagrama()")
    check("abrirDiagramaDelElemento" in mapa, "Define abrirDiagramaDelElemento()")
    check('data-action="diagrama"' in mapa, "El menú contextual ofrece abrir el diagrama")
    check("showPropertiesModal(props, _ctxFeature.geometry)" in mapa,
          "El clic derecho sigue abriendo Propiedades (sin cambios)")
    check('data-action="move"' in mapa and 'data-action="delete"' in mapa,
          "Las acciones Mover y Eliminar siguen presentes")

    # Trazado por postes: confirmación visual del clic + ruta física EN ORDEN
    check("pulsado" in mapa, "El objeto reacciona al clic (estado 'pulsado' de MapLibre)")
    check("_pulsarElemento(" in mapa, "Define el pulso de confirmación (scale y vuelve)")
    check("postes_intermedios" in mapa,
          "El trazado guarda los postes por los que pasa (postes_intermedios)")
    check("_recordarPoste(" in mapa, "Los anota en el ORDEN en que se hizo clic")
    check("numero" in mapa and "coalesce" in mapa,
          "La etiqueta del mapa usa el número visible (correlativo) con respaldo al id")
    check("_limite" not in mapa and "MAX(numero)" not in mapa,
          "El correlativo NO se calcula con MAX(numero) en el frontend")

    # La geometría del cable sale de los postes (la línea sigue al poste movido)
    check("_recordarPaso(" in mapa and "trazado_ruta" in mapa,
          "El trazado guarda su ruta paso por paso (postes en vivo + puntos libres)")
    check("cables_recalculados" in mapa,
          "Al mover un objeto se recogen los cables que se recalcularon")

    # REPINTADO (el fallo real que reportó el usuario): la geometría nueva que
    # devuelve el servidor tiene que llegar al source de MapLibre. Si el navegador
    # no la aplica, la línea se queda en la posición vieja aunque la base esté bien.
    check("type: 'LineString', coordinates: coords" in mapa,
          "Al mover un poste, el mapa REPINTA el cable con la geometría que devuelve el servidor")
    check("map.once('style.load', cargarTodosElementos)" not in mapa,
          "El refresco NO queda esperando un 'style.load' ya ocurrido (causa de la línea vieja)")
    check("src.setData(coleccion)" in mapa,
          "Los datos se vuelcan al source ANTES de crear/actualizar las capas")
    check("la capa de íconos/etiquetas no se pudo crear" in mapa,
          "Un addLayer inválido (ícono) no tumba el repintado de los datos")
    check("Clic ignorado: no hay modo activo" not in mapa,
          "El clic sin modo activo ya no parece un error (es un clic suelto)")

    r_iconos = pedir("GET", "/js/ftth-iconos.js")
    check(r_iconos.status_code == 200, "GET /js/ftth-iconos.js responde 200")
    check("onReady falló" in r_iconos.text,
          "Un fallo en el callback de íconos no queda como rechazo suelto")

    # Contrato de la respuesta del PUT: el recálculo devuelve la geometría nueva.
    ruta_logica = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "app", "models", "ftth_logica.py")
    with open(ruta_logica, encoding="utf-8") as fh:
        logica_txt = fh.read()
    check('"coords": _coords_normalizadas(cable.coords_json)' in logica_txt,
          "El recálculo devuelve la geometría nueva (coords) para que el mapa repinte")

    print("\n6b) La fibra no se borra como si fuera un dispositivo")
    r_fibra = pedir("GET", "/js/plantillas-visuales/fibra.js")
    check(r_fibra.status_code == 200, "GET /js/plantillas-visuales/fibra.js responde 200")
    fibra = r_fibra.text
    check('data-borrar="cable:' in fibra,
          "La tarjeta de fibra se marca con el id del CABLE (cable:N)")
    check('"dispositivo:${' not in fibra and "dispositivo:" not in fibra,
          "NUNCA manda el id del cable al endpoint de dispositivos (el error reportado)")
    check("data-cable-id" in fibra, "Sigue exponiendo data-cable-id (Propiedades de fibra)")

    r_diag = pedir("GET", "/js/ftth-diagrama.js")
    check(r_diag.status_code == 200, "GET /js/ftth-diagrama.js responde 200")
    diag = r_diag.text
    check("/cables/${id}" in diag or "/cables/" in diag,
          "El modo eliminar tiene la baja de fibra contra el endpoint de cables")
    check("BAJAS" in diag and "cable:" in diag, "La baja de fibra está declarada en BAJAS")

    print("\n6c) Las notificaciones van por ENCIMA de los modales")
    r_css = pedir("GET", "/css/tipos-pro.css")
    check(r_css.status_code == 200, "GET /css/tipos-pro.css responde 200")
    css = r_css.text
    m_toast = re.search(r"#toast\.toast\s*\{[^}]*z-index:\s*(\d+)", css, re.S)
    z_toast = int(m_toast.group(1)) if m_toast else 0
    r_index = pedir("GET", "/")
    m_modal = re.search(r'id="ftth-diagrama-modal"[^>]*z-index:\s*(\d+)', r_index.text)
    z_modal = int(m_modal.group(1)) if m_modal else 0
    print(f"        z-index toast={z_toast}  modal diagrama={z_modal}")
    check(z_toast > z_modal and z_modal > 0,
          "El toast queda por encima del modal del diagrama",
          f"toast={z_toast} modal={z_modal}")
    check(z_toast >= 120000, "También por encima de los selectores del diagrama (120000)")

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

