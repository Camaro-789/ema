"""
prueba_cable_estructura.py

Prueba de la ESTRUCTURA de la plantilla de cable («con buffer» / «drop») de
punta a punta:

  1. Reglas del dominio (`models/ftth_logica.py::normalizar_cable`): división
     exacta del total entre los looses y tope de fibras por buffer por perfil.
  2. El catálogo REALMENTE rechaza (HTTP 400) lo que no cuadra: 100/3, 288 en
     12 looses con perfil EIA598-A, un drop de 7 hilos...
  3. El cable de 1 buffer × 12 hilos se puede crear (el caso que fallaba).
  4. Un cable de 4 looses × 3 fibras se materializa como manda la norma: 4
     buffers (Azul/Naranja/Verde/Marrón) de 3 hilos (Azul/Naranja/Verde) y el
     orden global 1..12.
  5. Un DROP se materializa SIN buffer: un contenedor «SIN BUFFER».
  6. No se puede cambiar la estructura de un tipo con hilos anclados.
  7. Al terminar BORRA todo lo que creó.

Uso (desde backend/):
    python scripts/prueba_cable_estructura.py
    python scripts/prueba_cable_estructura.py --proyecto 1
"""
import argparse
import asyncio
import os
import sys

# La consola de Windows suele estar en cp1252 y no soporta algunos caracteres
# (por ejemplo la flecha -> de los listados): se fuerza UTF-8 en la salida para
# que la prueba NUNCA falle por un carácter.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
import app.models.ftth_logica as logica  # noqa: E402
import app.models.ftth_models as fisicos  # noqa: E402

R = {"ok": 0, "fallos": []}
CREADOS = {"tipos": [], "elementos": []}


def check(cond, msg, detalle=""):
    if cond:
        R["ok"] += 1
        print(f"  [OK]    {msg}")
    else:
        R["fallos"].append(msg)
        print(f"  [FALLO] {msg}")
        if detalle:
            print(f"          {detalle}")


class ClienteSync:
    def _req(self, metodo, url, **kw):
        async def _do():
            transporte = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transporte, base_url="http://prueba.local") as c:
                return await c.request(metodo, url, **kw)
        return asyncio.run(_do())

    def get(self, url, **kw):
        return self._req("GET", url, **kw)

    def post(self, url, **kw):
        return self._req("POST", url, **kw)

    def put(self, url, **kw):
        return self._req("PUT", url, **kw)


CLIENTE = ClienteSync()


def crear_tipo(proyecto, nombre, propiedades):
    """POST /api/tipos/ y, si se creó, lo apunta para borrarlo al final."""
    r = CLIENTE.post("/api/tipos/", json={
        "proyecto_id": proyecto,
        "categoria": "cables",
        "nombre_id": nombre,
        "color_mapa": "#0284c7",
        "propiedades": propiedades,
    })
    if r.status_code == 200:
        datos = r.json()
        CREADOS["tipos"].append(datos["id"])
        return datos
    return None


def crear_cable(proyecto, tipo_id, nombre):
    r = CLIENTE.post("/api/elementos/", json={
        "proyecto_id": proyecto,
        "tipo_id": tipo_id,
        "categoria": "cables",
        "coords_json": [[-72.2268, 7.7649], [-72.2266, 7.7649], [-72.2264, 7.7649]],
        "propiedades_instancia": {"nombre": nombre},
    })
    if r.status_code == 200:
        datos = r.json()
        CREADOS["elementos"].append(datos["properties"]["id"])
        return datos["properties"]["id"]
    return None


def limpiar():
    """Borra lo creado por la prueba (tubos, hilos y extremos incluidos)."""
    db = SessionLocal()
    try:
        for cable_id in CREADOS["elementos"]:
            hilos = [
                f.id for f in db.query(logica.FtthCableFibra.id)
                .filter(logica.FtthCableFibra.elemento_id == cable_id).all()
            ]
            if hilos:
                (db.query(logica.FtthFibraExtremo)
                 .filter(logica.FtthFibraExtremo.fibra_id.in_(hilos))
                 .delete(synchronize_session=False))
            (db.query(logica.FtthCableFibra)
             .filter(logica.FtthCableFibra.elemento_id == cable_id)
             .delete(synchronize_session=False))
            (db.query(logica.FtthCableTubo)
             .filter(logica.FtthCableTubo.elemento_id == cable_id)
             .delete(synchronize_session=False))
            (db.query(fisicos.FtthElemento)
             .filter(fisicos.FtthElemento.id == cable_id)
             .delete(synchronize_session=False))
        for tipo_id in CREADOS["tipos"]:
            (db.query(fisicos.FtthTipo)
             .filter(fisicos.FtthTipo.id == tipo_id)
             .delete(synchronize_session=False))
        db.commit()
    finally:
        db.close()


# ── Prueba ──────────────────────────────────────────────────────────────────

def probar_reglas():
    print("\n1) Reglas del dominio (models/ftth_logica.py::normalizar_cable)")

    uno = logica.normalizar_cable({"estructura": "con_buffer", "looses": 1, "fibras": 12, "perfil": "eia598a"})
    check(uno["fibrasLoose"] == 12, "1 buffer x 12 hilos = 12 fibras por buffer", str(uno))

    cuatro = logica.normalizar_cable({"estructura": "con_buffer", "looses": 4, "fibras": 12, "perfil": "eia598a"})
    check(cuatro["fibrasLoose"] == 3, "4 looses x 3 fibras = 12 hilos", str(cuatro))
    check(cuatro["plantilla_visual"] == "fibra_cable", "Un cable con buffer usa la plantilla con franja")

    drop = logica.normalizar_cable({"estructura": "drop", "fibras": 4, "perfil": "eia598a", "looses": 9})
    check(drop["looses"] == 1, "El drop queda con looses = 1 (interno)", str(drop))
    check(drop["fibrasLoose"] == 4, "En un drop, fibras por loose = total de hilos")
    check("perfil" not in drop, "El drop no guarda perfil de buffer")
    check(drop["plantilla_visual"] == "fibra_cable_drop", "El drop usa la plantilla visual PLANA")

    casos = [
        ({"estructura": "con_buffer", "looses": 3, "fibras": 100}, "100 fibras en 3 looses"),
        ({"estructura": "con_buffer", "looses": 12, "fibras": 288, "perfil": "eia598a"},
         "24 por buffer con perfil EIA598-A"),
        ({"estructura": "drop", "fibras": 7}, "un drop de 7 hilos"),
        ({"estructura": "drop", "fibras": 15}, "un drop de 15 hilos"),
        ({"estructura": "con_buffer", "looses": 0, "fibras": 12}, "un cable con buffer sin looses"),
        ({"estructura": "con_buffer", "looses": 97, "fibras": 97}, "más de 96 looses"),
        ({"estructura": "drop"}, "un drop sin total"),
        ({"estructura": "otra", "fibras": 12}, "una estructura inventada"),
    ]
    for props, motivo in casos:
        try:
            logica.normalizar_cable(props)
            check(False, f"Debe rechazar {motivo}", str(props))
        except ValueError as error:
            check(True, f"Rechaza {motivo}: {str(error)[:60]}")

    abnt = logica.normalizar_cable({"estructura": "con_buffer", "looses": 12, "fibras": 288, "perfil": "abnt"})
    check(abnt["fibrasLoose"] == 24, "Con perfil ABNT sí caben 24 fibras por buffer")
    check(logica.max_fibras_por_buffer("eia598a") == 12
          and logica.max_fibras_por_buffer("abnt") == 24
          and logica.max_fibras_por_buffer("lo-que-sea") == 24,
          "Los topes por perfil son 12 / 24 / 24")
    check(logica.HILOS_DROP == (1, 2, 4, 6, 8), "Los totales de un drop son 1, 2, 4, 6 y 8")
    check(logica.LOOSES_DROP == 1 and logica.MAX_LOOSES_CABLE == 96, "Los looses van de 1 (drop) a 96")


def main() -> int:
    ap = argparse.ArgumentParser(description="Prueba de la estructura de la plantilla de cable")
    ap.add_argument("--proyecto", type=int, default=1)
    args = ap.parse_args()
    proyecto = args.proyecto

    print("=" * 74)
    print(f"PRUEBA - estructura del cable (con buffer / drop), proyecto {proyecto}")
    print("=" * 74)

    probar_reglas()

    print("\n2) El catálogo rechaza lo que no cuadra (validación en el backend)")
    r = crear_tipo(proyecto, "PRUEBA 100/3 (no debe guardarse)",
                   {"estructura": "con_buffer", "looses": 3, "fibras": 100, "perfil": "eia598a"})
    check(r is None, "100 fibras en 3 looses -> 400")

    r = crear_tipo(proyecto, "PRUEBA 288/12 EIA598 (no debe guardarse)",
                   {"estructura": "con_buffer", "looses": 12, "fibras": 288, "perfil": "eia598a"})
    check(r is None, "24 fibras por buffer con perfil EIA598-A -> 400")

    r = crear_tipo(proyecto, "PRUEBA drop 7 (no debe guardarse)",
                   {"estructura": "drop", "fibras": 7})
    check(r is None, "Un drop de 7 hilos -> 400")

    print("\n3) El cable que antes fallaba: 1 buffer x 12 hilos")
    tipo_buffer = crear_tipo(proyecto, "PRUEBA 1 buffer x 12",
                             {"estructura": "con_buffer", "looses": 1, "fibras": 12,
                              "perfil": "eia598a", "codigo": "PRUEBA-12H"})
    check(tipo_buffer is not None, "El tipo se crea sin tocar «fibras por loose»")
    if tipo_buffer:
        props = tipo_buffer["propiedades"]
        check(props.get("fibrasLoose") == 12,
              "El backend calculó fibrasLoose = 12", str(props.get("fibrasLoose")))
        check(props.get("plantilla_visual") == "fibra_cable", "Y resolvió su plantilla visual")

    print("\n4) 4 looses x 3 fibras: se materializa como manda la norma")
    tipo_cuatro = crear_tipo(proyecto, "PRUEBA 4 looses x 3",
                             {"estructura": "con_buffer", "looses": 4, "fibras": 12,
                              "perfil": "eia598a", "codigo": "PRUEBA-4X3"})
    check(tipo_cuatro is not None, "El tipo 4x3 se crea")
    cable_cuatro = None
    if tipo_cuatro:
        check(tipo_cuatro["propiedades"].get("fibrasLoose") == 3,
              "fibras por loose = 12 / 4 = 3", str(tipo_cuatro["propiedades"].get("fibrasLoose")))
        cable_cuatro = crear_cable(proyecto, tipo_cuatro["id"], "PRUEBA cable 4x3")
        check(cable_cuatro is not None, "El cable se coloca en el proyecto")
    if cable_cuatro:
        m = CLIENTE.post(f"/api/cables/{cable_cuatro}/materializar-hilos")
        check(m.status_code == 200, "La materialización responde 200", m.text[:200])
        arbol = CLIENTE.get(f"/api/cables/{cable_cuatro}/hilos").json()
        tubos = arbol.get("tubos", [])
        check(len(tubos) == 4, "Creó 4 buffers", str(len(tubos)))
        check(all(len(t.get("hilos", [])) == 3 for t in tubos), "Cada buffer con sus 3 hilos",
              str([len(t.get("hilos", [])) for t in tubos]))
        check([t.get("color") for t in tubos] == ["Azul", "Naranja", "Verde", "Marrón"],
              "Los buffers siguen el código TIA-598", str([t.get("color") for t in tubos]))
        primeros = [t["hilos"][0].get("color") for t in tubos]
        check(primeros == ["Azul"] * 4, "El hilo 1 de cada buffer vuelve a ser Azul", str(primeros))
        globales = sorted(h["hilo_global_no"] for t in tubos for h in t["hilos"])
        check(globales == list(range(1, 13)), "El orden global va de 1 a 12", str(globales))

    print("\n5) DROP: se materializa SIN buffer")
    tipo_drop = crear_tipo(proyecto, "PRUEBA drop 4 hilos",
                           {"estructura": "drop", "fibras": 4, "codigo": "PRUEBA-DROP4"})
    check(tipo_drop is not None, "El tipo drop se crea")
    if tipo_drop:
        pd = tipo_drop["propiedades"]
        check(pd.get("looses") == 1, "Queda con looses = 1 (no se muestra en la interfaz)", str(pd))
        check(pd.get("fibrasLoose") == 4, "fibras por loose = total de hilos")
        check("perfil" not in pd, "No guarda perfil de buffer")
        check(pd.get("plantilla_visual") == "fibra_cable_drop", "Guarda la plantilla visual plana")

    cable_drop = None
    if tipo_drop:
        cable_drop = crear_cable(proyecto, tipo_drop["id"], "PRUEBA cable drop 4")
        check(cable_drop is not None, "El cable drop se coloca en el proyecto")
    if cable_drop:
        m = CLIENTE.post(f"/api/cables/{cable_drop}/materializar-hilos")
        check(m.status_code == 200, "La materialización del drop responde 200", m.text[:200])
        arbol = CLIENTE.get(f"/api/cables/{cable_drop}/hilos").json()
        tubos = arbol.get("tubos", [])
        check(len(tubos) == 1, "Hay un único contenedor", str(len(tubos)))
        if tubos:
            t = tubos[0]
            check(t.get("etiqueta") == "SIN BUFFER",
                  "El contenedor va marcado SIN BUFFER", str(t.get("etiqueta")))
            check(t.get("capacidad_fibras") == 4, "Su capacidad es el total de hilos",
                  f"capacidad={t.get('capacidad_fibras')} etiqueta={t.get('etiqueta')} "
                  f"hilos={len(t.get('hilos', []))}")
            check(len(t.get("hilos", [])) == 4, "Con sus 4 hilos sueltos")
            check([h.get("color") for h in t["hilos"]] == ["Azul", "Naranja", "Verde", "Marrón"],
                  "Con los colores TIA-598 en orden", str([h.get("color") for h in t["hilos"]]))
            check(t["hilos"][0].get("nombre") == "T01-H01",
                  "El nombre canónico del hilo sigue siendo utilizable", str(t["hilos"][0].get("nombre")))
        check(arbol.get("plantilla", {}).get("propiedades", {}).get("estructura") == "drop",
              "El DTO del cable informa su estructura (la usa la pestaña Hilos)")

    print("\n6) No se cambia la estructura de un tipo con hilos anclados")
    if cable_cuatro and tipo_cuatro:
        arbol4 = CLIENTE.get(f"/api/cables/{cable_cuatro}/hilos").json()
        hilos = [h["id"] for t in arbol4.get("tubos", []) for h in t.get("hilos", [])]
        nodo = None
        features = CLIENTE.get(f"/api/elementos/todos?proyecto_id={proyecto}").json().get("features", [])
        for f in features:
            if f["properties"].get("categoria") not in ("cables", "ducto"):
                nodo = f["properties"]["id"]
                break
        if hilos and nodo:
            r = CLIENTE.put(f"/api/fibras/{hilos[0]}/extremos/A", json={"nodo_id": nodo})
            check(r.status_code == 200, "Se ancló un hilo a un nodo (lo que hace el diagrama)",
                  r.text[:150])

            # El DTO del nodo tiene que decir QUÉ TIPO es el cable: sin eso, el
            # diagrama no sabe cuántos hilos tiene ni qué plantilla dibujar.
            nodo_dto = CLIENTE.get(f"/api/elementos/{nodo}/nodo").json()
            terminan = nodo_dto.get("hilos_que_terminan", [])
            # El nodo puede tener anclados hilos de cables REALES: se busca el NUESTRO
            # (el que se acaba de anclar), no el primero de la lista.
            primero = next((h for h in terminan if h.get("fibra_id") == hilos[0]), {})
            tipo_cable = primero.get("cable_tipo") or {}
            check(bool(tipo_cable), "El DTO del nodo trae el tipo del cable (cable_tipo)",
                  str(list(primero.keys())))
            check(tipo_cable.get("estructura") == "con_buffer",
                  "El tipo del cable informa su estructura", str(tipo_cable.get("estructura")))
            check(tipo_cable.get("fibras") == 12,
                  "Y su número de hilos (12 en el tipo de prueba)", str(tipo_cable.get("fibras")))
            check(tipo_cable.get("plantilla_visual") == "fibra_cable",
                  "Y su plantilla visual", str(tipo_cable.get("plantilla_visual")))

            cambio = CLIENTE.put(f"/api/tipos/{tipo_cuatro['id']}", json={
                "proyecto_id": proyecto, "categoria": "cables",
                "nombre_id": tipo_cuatro["nombre_id"], "color_mapa": "#0284c7",
                "propiedades": {"estructura": "drop", "fibras": 4, "codigo": "PRUEBA-4X3"},
            })
            check(cambio.status_code == 400, "Cambiar de «con buffer» a «drop» se BLOQUEA",
                  f"status={cambio.status_code}")
            check("anclado" in cambio.text or "empalmado" in cambio.text,
                  "El mensaje explica por qué", cambio.text[:200])
        else:
            print("        (no había nodos o hilos: se omite el bloqueo)")

    if tipo_buffer:
        libre = CLIENTE.put(f"/api/tipos/{tipo_buffer['id']}", json={
            "proyecto_id": proyecto, "categoria": "cables",
            "nombre_id": tipo_buffer["nombre_id"], "color_mapa": "#0284c7",
            "propiedades": {"estructura": "drop", "fibras": 4, "codigo": "PRUEBA-12H"},
        })
        check(libre.status_code == 200,
              "Un tipo sin nada cableado SÍ puede cambiar de estructura",
              f"status={libre.status_code} {libre.text[:150]}")

    print("\n7) Limpieza (se borra todo lo creado por la prueba)")
    limpiar()
    check(True, "Tipos, cables, tubos, hilos y extremos de la prueba eliminados")

    print("\n" + "=" * 74)
    print(f"RESULTADO: {R['ok']} comprobaciones OK, {len(R['fallos'])} fallos")
    for f in R["fallos"]:
        print(f"  - {f}")
    print("=" * 74)
    return 1 if R["fallos"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
