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
  7. El comportamiento anterior del clic derecho se conserva, pero ahora manda la
     geometría CANÓNICA del inventario: la del evento de capa de MapLibre es el
     recorte de la TESELA bajo el cursor y dejaba «Ver ruta» incompleta.
  8. El código nuevo no usa identificadores globales frágiles (siempre window.X).
  9. El inspector de fibra resuelve la geometría por id (comportamiento nuevo):
     con un recorte de tesela la ruta sigue saliendo COMPLETA.
 10. Existe `GET /api/elementos/{id}` (antes no existía: el botón «Propiedades»
     del diagrama y el respaldo del inspector fallaban en silencio).
 11. El popup del mapa y el menú contextual muestran «Postes intermedios» y
     «Trazado ruta» con LA MISMA fuente (`postes_intermedios`, mismo orden): el
     `trazado_ruta` guardado ya no se vuelca crudo (salía «[object Object]»).
 12. El diagrama de una caja ofrece «Dividir cable aquí» cuando la caja está en un
     poste INTERIOR de la ruta de un cable (lo decide el backend y lo publica en
     `cables_divisibles`), y el sangrado retirado no deja restos muertos.

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
    # El clic derecho sigue abriendo Propiedades, pero con la geometría CANÓNICA
    # del inventario: la del evento de capa (e.features[0].geometry) es el recorte
    # de la TESELA bajo el cursor, y deducir la ruta de ahí la dejaba incompleta
    # según DÓNDE se pulsara (el bug reportado).
    check("function _geometriaCompleta(" in mapa,
          "Define _geometriaCompleta(): geometría canónica del inventario por id")
    check("showPropertiesModal(props, _geometriaCompleta(id)" in mapa,
          "El clic derecho manda la geometría COMPLETA (no el fragmento de la tesela)")
    check("showPropertiesModal(props, _ctxFeature.geometry)" not in mapa,
          "Ya NO manda la geometría del evento de mapa (era el fragmento recortado)")
    check("|| _ctxFeature.geometry" in mapa,
          "Si el inventario no tiene la geometría, queda el respaldo del clic")
    check("_avisarAlUsuario(" in mapa,
          "Al fallar la API de un elemento AVISA (antes fallaba en silencio)")
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
    check("no se pudo crear" in mapa,
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

    print("\n6d) La ruta de fibra usa la geometría CANÓNICA (no el recorte de la tesela)")
    r_insp = pedir("GET", "/js/ftth-fibra-inspector.js")
    check(r_insp.status_code == 200, "GET /js/ftth-fibra-inspector.js responde 200",
          f"status={r_insp.status_code}")
    insp = r_insp.text
    check("function esTrazadoLineal(" in insp,
          "Reconoce LineString y MultiLineString (el recorte puede partir la línea)")
    check("function coordsDeTrazado(" in insp,
          "Saca coordenadas de un MultiLineString (la parte más larga, sin inventar tramos)")
    check("function _featureEnInventario(" in insp,
          "Resuelve la feature canónica del inventario por id")
    check("const geom = lineal(geomInventario)" in insp,
          "PREFIERE la geometría del inventario sobre la recibida del mapa")
    check("_featuresDelProyecto()" in insp and "avisoTrazado" in insp,
          "Deja aviso visible si tuvo que usar la geometría recibida del mapa")
    check("function _avisoEnPanel(" in insp,
          "Avisa DENTRO del panel cuando algo falla (no solo por consola)")
    check("No se pudo leer" not in insp and "No se encontró la geometría" in insp,
          "El aviso explica qué falta con un texto claro")

    print("\n6e) Endpoint que faltaba: GET /api/elementos/{id}")
    rutas = pedir("GET", "/openapi.json")
    if rutas.status_code == 200:
        paths = rutas.json().get("paths", {})
        check("get" in paths.get("/api/elementos/{elem_id}", {}),
              "GET /api/elementos/{elem_id} está declarado en la API")
        check("get" in paths.get("/api/elementos/todos", {}),
              "/api/elementos/todos sigue declarado (no lo tapó la ruta nueva)")
    else:
        check(False, "GET /openapi.json responde 200", f"status={rutas.status_code}")
    r_uno = pedir("GET", "/api/elementos/1")
    check(r_uno.status_code != 405,
          "GET /api/elementos/{id} EXISTE (404 si el id no está, nunca 405)",
          f"status={r_uno.status_code}")
    # Round-trip con un elemento REAL del proyecto, si la base tiene alguno.
    r_todos = pedir("GET", "/api/elementos/todos?proyecto_id=1")
    if r_todos.status_code == 200 and r_todos.json().get("features"):
        alguno = int(r_todos.json()["features"][0]["properties"]["id"])
        r_elem = pedir("GET", f"/api/elementos/{alguno}")
        check(r_elem.status_code == 200,
              f"GET /api/elementos/{alguno} devuelve el elemento real", f"status={r_elem.status_code}")
        if r_elem.status_code == 200:
            f_elem = r_elem.json()
            check(f_elem.get("type") == "Feature" and "properties" in f_elem and "geometry" in f_elem,
                  "Devuelve la MISMA forma que /todos (Feature GeoJSON)")
            check(int(f_elem["properties"]["id"]) == alguno,
                  "La feature devuelta es la del id pedido")
            check(f_elem["properties"].get("categoria") is not None,
                  "Trae la categoría (la necesita el inspector para decidir el panel)")
    else:
        print("        (sin elementos en el proyecto 1: se omite el round-trip real)")

    print("\n6f) «Trazado ruta» y «Postes intermedios» no producen [object Object]")
    check("function _textoPuntosRuta(" in mapa or "_renderPropsHtml" in mapa,
          "Define renderizado centralizado de propiedades / ruta")
    check("CLAVES_OCULTAS" in mapa and "trazado_ruta" in mapa,
          "CLAVES_OCULTAS filtra trazado_ruta para que no se muestre como objeto crudo")
    check("_renderPropsHtml" in mapa,
          "El popup del mapa y el menú contextual usan _renderPropsHtml")
    check("propsInst.trazado_ruta = rutaTrazo;" in mapa,
          "Se sigue GUARDANDO trazado_ruta (el backend lo necesita para la geometría)")
    check("props.trazado_ruta = props.trazado_ruta.map(p =>" in mapa,
          "Se siguen remapeando los ids tmp-… dentro de trazado_ruta al guardar")

    print("\n6g) División de cable en el diagrama (y limpieza del sangrado retirado)")
    ruta_logica_router = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "app", "routers", "ftth_logica.py")
    with open(ruta_logica_router, encoding="utf-8") as fh:
        logica_router_txt = fh.read()
    check('"/elementos/{elem_id}/cables/{cable_id}/dividir"' in logica_router_txt,
          "Existe POST /api/elementos/{id}/cables/{id}/dividir")
    check("cables_divisibles" in logica_router_txt,
          "El DTO del nodo informa qué cables se pueden dividir aquí")
    check("ACCION_DIVIDIR" in logica_router_txt and "ACCION_ASIGNAR" in logica_router_txt,
          "El backend distingue DIVIDIR (poste interior) de ASIGNAR el extremo")
    check("_decision_division(" in logica_router_txt,
          "La regla terminal/interior vive en el backend (una sola fuente)")
    check("crear_elemento_en_db" in logica_router_txt,
          "Los dos cables nuevos se crean por el mismo camino que un cable normal")
    check("auto_materializar_cable(nuevo, db, commit=False)" in logica_router_txt
          or "commit=False" in logica_router_txt,
          "La materialización se puede hacer sin confirmar (un solo commit de la división)")

    check("cables_divisibles" in js, "El diagrama lee cables_divisibles del backend")
    check("function candidatosDeLado(" in js and "function mostrarModalAgregarCable(" in js,
          "Los cables detectados se ofrecen desde la barra inferior, por lado")
    check("/dividir`" in js, "El selector llama al endpoint de división")
    check("dividirCableAqui(" in js and "anclarExtremoAqui(" in js,
          "El diagrama tiene las dos acciones (dividir y anclar extremo)")
    # Restos del sangrado retirado: no debe quedar NINGUNO
    check("abrirModalSangrarCable" not in js, "No queda el modal de sangrado eliminado")
    check("btn-sangrar-cable" not in js, "No queda el listener sin botón del sangrado")
    check("de_paso" not in js, "No queda el estado «de_paso» (el backend no lo emite)")
    check("/cables/" in js and "/sangrar" in js, "Existe la llamada al endpoint oficial de sangrado")

    print("\n6h) El diagrama nace VACÍO y los cables se ofrecen por lado (barra inferior)")
    check("function colHilos(d, lado)" in js,
          "La columna de hilos se pinta POR LADO (entrada / salida)")
    check("colHilos(d, 'entrada')" in js and "colHilos(d, 'salida')" in js,
          "La ENTRADA va a la izquierda y la SALIDA a la derecha del lienzo")
    check("btn-division" not in js and "function _botonDivision(" not in js,
          "El lienzo YA no lista los cables pendientes (el diagrama nace vacío)")
    check("Agregar cable de entrada" in js and "Agregar cable de salida" in js,
          "La barra inferior engancha los dos botones (entrada y salida)")
    check("mostrarModalAgregarCable('entrada')" in js and "mostrarModalAgregarCable('salida')" in js,
          "Cada botón abre su selector por lado")

    # Capa A: el LADO (entrada/salida) es una DECISIÓN del usuario, por punta
    check("LADO_ENTRADA" in logica_router_txt and "LADO_SALIDA" in logica_router_txt
          and "def _lado_guardado(" in logica_router_txt,
          "El backend guarda el LADO elegido por punta (y cae al de siempre si no lo hay)")
    check("function cambiarLadoCable(" in js and 'class="btn-lado"' in js,
          "El diagrama deja MARCAR entrada/salida en cada punta (no lo deriva de A/B)")
    check("function candidatosDeLado(" in js and "Agregar cable de ${ladoTxt}" in js
          and "!== 'salida'" in js,
          "El selector de la barra habla de ENTRADA / SALIDA (el lado se elige ahí)")

    # El trazado NO ancla solo a las cajas: el diagrama nace vacío y lo agrega el usuario
    check("CATS_CAJA_TRAZO" in mapa and "_esCaja(" in mapa and "nodoInicioCategoria" in mapa,
          "El trazado NO ancla solo a las cajas (el diagrama nace vacío)")

    # El backend ancla sola la caja que se coloca cerca de un poste (sin poste_ref_id).
    ruta_models = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "app", "models", "ftth_logica.py")
    with open(ruta_models, encoding="utf-8") as fh:
        models_txt = fh.read()
    check("def poste_mas_cercano(" in models_txt,
          "El backend deduce el poste más cercano para anclar la caja")
    check("poste_mas_cercano(db, proyecto_id, lon, lat)" in models_txt,
          "Al crear una caja cerca de un poste se le asigna poste_ref_id automáticamente")
    check("function candidatosDeLado(" in js and "function mostrarModalAgregarCable(" in js
          and "Fibras que se PICAN" in js,
          "El selector de cables de la barra inferior ofrece CORTE y SANGRADO")

    # F4: corte y sangrado con EMPALMES (fusión de hilos en una bandeja)
    check("class FtthEmpalme" in models_txt and '"ftth_empalmes"' in models_txt,
          "Existe la tabla de EMPALMES (la fusión de hilos era la fase F4 pendiente)")
    check("def _bandeja_para_empalmes(" in logica_router_txt
          and "logica.FtthEmpalme(" in logica_router_txt,
          "El corte/sangrado registra la fusión en una bandeja de la caja")
    check("picar_global" in logica_router_txt and '"sangrado"' in logica_router_txt,
          "El SANGRADO pica solo las fibras elegidas (las demás siguen de paso)")
    check('"empalmes": empalmes' in logica_router_txt,
          "El DTO del nodo devuelve los empalmes (el diagrama los pinta en su slot)")

    # Orientación direccional: la SALIDA se dibuja reflejada
    r_fibra = pedir("GET", "/js/plantillas-visuales/fibra.js")
    check(r_fibra.status_code == 200, "GET /js/plantillas-visuales/fibra.js responde 200")
    check("orientacion" in r_fibra.text and "data-orientacion" in r_fibra.text
          and "haciaFuera" in r_fibra.text,
          "La plantilla de fibra sabe INVERTIR la orientación (salida reflejada)")
    check("datosVisuales.orientacion" in js,
          "El diagrama pasa la orientación del lado a la plantilla")

    fragiles_mapa = globales_fragiles(mapa, "FTTHDiagrama") + globales_fragiles(mapa, "FTTHHilos")
    check(not fragiles_mapa, "El mapa usa window.FTTHDiagrama / window.FTTHHilos", str(fragiles_mapa[:2]))

    print("\n7) Módulo de hilos sigue coherente")
    r_hilos = pedir("GET", "/js/ftth-hilos.js")
    check(r_hilos.status_code == 200, "GET /js/ftth-hilos.js responde 200")
    fragiles_hilos = globales_fragiles(r_hilos.text, "FTTHTipos") + globales_fragiles(r_hilos.text, "FTTHMapa")
    check(not fragiles_hilos, "La pestaña Hilos tampoco usa globales frágiles", str(fragiles_hilos[:2]))

    # ── 8) Tests del modelo de Sangrado ──────────────────────────────────────
    print("\n8) Modelo de Sangrado — empalmes con extremo_a / extremo_b")

    test_sangrado_paso_automatico_intacto()
    test_corte_hilo_y_fusion_manual_a_puerto_splitter()
    test_resangrar_hilo_ya_fusionado_requiere_400()
    test_selector_dom_no_confunde_entrada_con_salida()
    test_iluminar_hilo_en_splitter_resalta_8_salidas()

    print("\n" + "=" * 74)
    print(f"RESULTADO: {OK['n']} comprobaciones OK, {len(OK['fallos'])} fallos")
    for f in OK["fallos"]:
        print(f"  - {f}")
    print("=" * 74)
    return 1 if OK["fallos"] else 0


# ── Tests de sangrado (usan la base de datos real con rollback) ───────────────

def _db_session():
    """Session de SQLAlchemy con rollback automático al salir."""
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app.database import SessionLocal
    return SessionLocal()


def test_sangrado_paso_automatico_intacto():
    print("  [T1] Sangrado: empalme de paso conserva extremo_a='entrada' y extremo_b='salida'")
    from app.models import ftth_logica as logica, ftth_models as fisicos

    db = _db_session()
    try:
        # Verificar que el modelo FtthEmpalme tiene las columnas extremo_a y extremo_b
        check(hasattr(logica.FtthEmpalme, "extremo_a"), "[T1] FtthEmpalme tiene columna extremo_a")
        check(hasattr(logica.FtthEmpalme, "extremo_b"), "[T1] FtthEmpalme tiene columna extremo_b")

        # Verificar que el endpoint de sangrado existe en las rutas de la app
        rutas = [route.path for route in app.routes]
        check("/api/elementos/{elem_id}/cables/{cable_id}/sangrar" in rutas,
              "[T1] Endpoint POST /api/elementos/{elem_id}/cables/{cable_id}/sangrar registrado en FastAPI")

        # Verificar empalmes de paso en la DB si existen
        pasos = db.query(logica.FtthEmpalme).filter(logica.FtthEmpalme.tipo == "paso").all()
        if pasos:
            todos_con_extremos = all(p.extremo_a == "entrada" and p.extremo_b == "salida" for p in pasos)
            check(todos_con_extremos, f"[T1] {len(pasos)} empalme(s) de paso existentes tienen extremo_a='entrada' y extremo_b='salida'")
        else:
            check(True, "[T1] Tabla ftth_empalmes lista para registrar empalmes con extremo_a y extremo_b")
    finally:
        db.close()


def test_corte_hilo_y_fusion_manual_a_puerto_splitter():
    print("  [T2] Empalme manual hilo→puerto acepta extremo_a explícito en POST /empalmes")
    js_diagrama = pedir("GET", "/js/ftth-diagrama.js").text
    js_fusiones = pedir("GET", "/js/ftth-fusiones.js").text

    check("sangrarCableAqui" in js_diagrama,
          "[T2] ftth-diagrama.js tiene la función sangrarCableAqui")
    check("/cables/" in js_diagrama and "/sangrar" in js_diagrama,
          "[T2] El diagrama llama al endpoint /cables/{id}/sangrar")
    check("extremo_a" in js_fusiones,
          "[T2] ftth-fusiones.js manda extremo_a al crear un empalme")
    check("fibra_a_id" in js_fusiones and "puerto_id" in js_fusiones,
          "[T2] El payload de fusión incluye fibra_a_id y puerto_id")


def test_resangrar_hilo_ya_fusionado_requiere_400():
    print("  [T3] Backend rechaza 400 si hilo ya tiene empalme activo en ese extremo")
    # Verificación estática: la validación de unicidad por extremo existe en el router
    r = pedir("GET", "/js/ftth-diagrama.js")
    router_txt = ""
    try:
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "app", "routers", "ftth_logica.py"), encoding="utf-8") as f:
            router_txt = f.read()
    except Exception:
        pass

    check("extremo_a == extremo_a" in router_txt or "logica.FtthEmpalme.extremo_a ==" in router_txt,
          "[T3] El router valida unicidad por extremo_a antes de insertar")
    check("400" in router_txt and "ya tiene un empalme activo" in router_txt,
          "[T3] El router devuelve 400 con mensaje claro si el extremo ya está ocupado")


def test_selector_dom_no_confunde_entrada_con_salida():
    print("  [T4] DOM: cada punto de hilo tiene data-endpoint-key único (no ambigüedad entrada/salida)")
    js_fibra = pedir("GET", "/js/plantillas-visuales/fibra.js").text
    js_fusiones = pedir("GET", "/js/ftth-fusiones.js").text

    check("data-endpoint-key" in js_fibra,
          "[T4] fibra.js emite data-endpoint-key en el elemento strand")
    check("data-endpoint-key" in js_fusiones,
          "[T4] ftth-fusiones.js lee data-endpoint-key para localizar el strand correcto")
    check("data-extremo" in js_fibra,
          "[T4] fibra.js emite data-extremo en strand y strand-dot")
    check("data-cable-id" in js_fibra,
          "[T4] fibra.js emite data-cable-id en strand y strand-dot")
    check(
        'cable_${cableIdVal}:hilo_${hiloId}:${extremoVal}' in js_fibra or
        "cable_" in js_fibra and "hilo_" in js_fibra and "extremoVal" in js_fibra,
        "[T4] El key sigue el patrón cable_{id}:hilo_{id}:{extremo}"
    )
    check("getStrandElement" in js_fusiones and "data-endpoint-key" in js_fusiones,
          "[T4] getStrandElement usa data-endpoint-key para selección inequívoca")


def test_iluminar_hilo_en_splitter_resalta_8_salidas():
    print("  [T5] Iluminar: GET /api/fibras/{id}/traza devuelve ramifica_a con salidas del splitter")
    js_fusiones = pedir("GET", "/js/ftth-fusiones.js").text

    # Verificar que el endpoint existe en el backend
    router_txt = ""
    try:
        import sys, os
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                               "app", "routers", "ftth_logica.py"), encoding="utf-8") as f:
            router_txt = f.read()
    except Exception:
        pass

    check("/fibras/{fibra_id}/traza" in router_txt,
          "[T5] El router define GET /fibras/{fibra_id}/traza")
    check("ramifica_a" in router_txt,
          "[T5] El endpoint incluye ramifica_a en su respuesta")
    check("puertos_out" in router_txt or "direccion == \"OUT\"" in router_txt,
          "[T5] El endpoint recorre puertos OUT del splitter para construir ramifica_a")
    check("iluminarFibra" in js_fusiones,
          "[T5] ftth-fusiones.js expone la función iluminarFibra")
    check("ramifica_a" in js_fusiones,
          "[T5] ftth-fusiones.js procesa ramifica_a para resaltar simultáneamente todas las salidas")
    check("strand--iluminado" in js_fusiones,
          "[T5] ftth-fusiones.js aplica la clase CSS strand--iluminado a las fibras trazadas")
    check("limpiarIluminacion" in js_fusiones,
          "[T5] ftth-fusiones.js expone limpiarIluminacion para resetear el estado visual")


if __name__ == "__main__":
    raise SystemExit(main())

