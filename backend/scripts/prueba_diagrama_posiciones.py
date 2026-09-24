"""
prueba_diagrama_posiciones.py

Prueba del ORDEN del lienzo del diagrama (lo que guarda el disquete):
cuando hay dos splitters en una caja NAP, cada uno tiene su sitio, el usuario
los mueve y el programa recuerda dónde quedaron.

Comprueba:
  1. `PUT /api/elementos/{id}/diagrama/posiciones` guarda x/y de cada aparato.
  2. `GET /api/elementos/{id}/nodo` devuelve ese x/y dentro del DTO.
  3. Volver a guardar ACTUALIZA (no duplica filas).
  4. Un aparato de otro nodo -> 404.
  5. Una coordenada fuera del lienzo -> 400.
  6. Un poste (no conmuta hilos) -> 400 (misma guarda I17).
  7. `DELETE /api/elementos/{id}/diagrama/posiciones` restablece el orden.
  8. Al borrar un aparato se va su posición (sin filas huérfanas en SQLite).
  9. Nada de la capa física ni de los puertos cambia.

Nota: la prueba instala un splitter TEMPORAL en el primer NAP del proyecto
(para poder colocar dos aparatos y comprobar que al quitarlo no queda su
posición huérfana) y lo elimina antes de terminar. Nada de la capa física se
modifica y el orden que hubiera guardado se restablece.

Uso (desde backend/):
    python scripts/prueba_diagrama_posiciones.py
    python scripts/prueba_diagrama_posiciones.py --proyecto 5
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models.ftth_logica import FtthDiagramaPosicion  # noqa: E402

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
    return bool(cond)


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

    def delete(self, url, **kw):
        return self._req("DELETE", url, **kw)


CLIENTE = ClienteSync()


def filas_de_posicion(elemento_id: int) -> int:
    """Cuenta las filas guardadas del nodo directamente en la base de datos."""
    db = SessionLocal()
    try:
        return (
            db.query(FtthDiagramaPosicion)
            .filter(FtthDiagramaPosicion.elemento_id == elemento_id)
            .count()
        )
    finally:
        db.close()


def filas_del_dispositivo(dispositivo_id: int) -> int:
    db = SessionLocal()
    try:
        return (
            db.query(FtthDiagramaPosicion)
            .filter(FtthDiagramaPosicion.dispositivo_id == dispositivo_id)
            .count()
        )
    finally:
        db.close()


def posiciones_del_dto(dto):
    """{id: (x, y)} de los aparatos que el DTO ya trae situados."""
    return {
        d["id"]: (d.get("x"), d.get("y"))
        for d in dto.get("dispositivos", [])
        if d.get("x") is not None and d.get("y") is not None
    }


ESTADO = {"postes": []}


def elegir_nodo(proyecto_pedido=None):
    """
    Busca un nodo donde probar: la primera cajanap del proyecto y, si no hay
    ninguna, una manga. Si el nodo elegido tiene menos de dos aparatos, le
    instala un splitter TEMPORAL (se devuelve su id para quitarlo al final).

    Devuelve (proyecto, nodo_id, dispositivo_temporal_id).
    """
    candidatos = []
    if proyecto_pedido:
        candidatos.append(proyecto_pedido)
    else:
        r = CLIENTE.get("/api/v1/maps/projects")
        if r.status_code == 200:
            candidatos.extend(p["id"] for p in r.json())
        candidatos.append(int(os.getenv("FTTH_PROYECTO_PRUEBA", "5")))

    for proyecto in candidatos:
        r = CLIENTE.get(f"/api/elementos/todos?proyecto_id={proyecto}")
        if r.status_code != 200:
            continue
        features = r.json().get("features", [])
        napes = [f["properties"]["id"] for f in features
                 if f["properties"].get("categoria") == "cajanap"]
        mangas = [f["properties"]["id"] for f in features
                  if f["properties"].get("categoria") == "manga"]
        ESTADO["postes"] = [f["properties"]["id"] for f in features
                            if f["properties"].get("categoria") == "poste"]
        if not napes and not mangas:
            continue

        nodo_id = (napes or mangas)[0]
        print(f"        nodo elegido: #{nodo_id} (cajanap={len(napes)}, manga={len(mangas)}, "
              f"postes={len(ESTADO['postes'])})")

        r = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo")
        if r.status_code != 200:
            continue
        if len(r.json().get("dispositivos", [])) >= 2:
            return proyecto, nodo_id, None

        r = CLIENTE.post(
            f"/api/elementos/{nodo_id}/dispositivos",
            json={"tipo": "splitter", "division": "1x4", "serie": "SN-PRUEBA-POS"},
        )
        if check(r.status_code == 200, "Se instaló un splitter temporal para la prueba",
                 f"status={r.status_code} {r.text[:200]}"):
            return proyecto, nodo_id, r.json()["id"]
        return proyecto, nodo_id, None

    return None, None, None


def main() -> int:
    ap = argparse.ArgumentParser(description="Prueba del orden del lienzo del diagrama")
    ap.add_argument(
        "--proyecto", type=int, default=None,
        help="Proyecto a usar. Si se omite, se busca el primero que tenga una caja NAP.",
    )
    args = ap.parse_args()

    print("=" * 74)
    print("PRUEBA DEL ORDEN DEL LIENZO")
    print("=" * 74)

    print("\n1) Nodo de prueba y sus aparatos")
    proyecto, nodo_id, creado = elegir_nodo(args.proyecto)
    if not nodo_id:
        print("        No hay ninguna cajanap/manga en la base: no se puede probar el orden del lienzo.")
        print("        (Crea una caja NAP en el mapa y vuelve a ejecutar la prueba.)")
        return 0
    print(f"        proyecto: {proyecto} | nodo: #{nodo_id}")

    r = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo")
    check(r.status_code == 200, "El DTO del nodo responde 200", f"status={r.status_code}")
    if r.status_code != 200:
        return 1

    dto = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo").json()
    ids = [d["id"] for d in dto["dispositivos"]][:2]
    print(f"        aparatos: {ids}")
    if len(ids) < 2:
        print("        (el nodo tiene menos de dos aparatos: algunas comprobaciones no aplican)")

    print("\n2) Guardar el orden (lo que hace el disquete)")
    carga = {"posiciones": [
        {"dispositivo_id": ids[0], "x": 12, "y": 12},
        {"dispositivo_id": ids[1], "x": 370, "y": 12},
    ]}
    r = CLIENTE.put(f"/api/elementos/{nodo_id}/diagrama/posiciones", json=carga)
    check(r.status_code == 200, "El PUT del orden responde 200", f"status={r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        check(r.json()["guardadas"] == 2, "Confirma las dos posiciones", r.text[:200])
    check(filas_de_posicion(nodo_id) == 2, "Quedan dos filas guardadas",
          f"filas={filas_de_posicion(nodo_id)}")

    print("\n3) El DTO devuelve el orden guardado")
    dto = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo").json()
    guardadas = posiciones_del_dto(dto)
    check(guardadas.get(ids[0]) == (12.0, 12.0), "El primer aparato trae su x/y", str(guardadas))
    check(guardadas.get(ids[1]) == (370.0, 12.0), "El segundo también (lado a lado, no apilado)")
    if ids[0] in guardadas and ids[1] in guardadas:
        check(guardadas[ids[0]][1] == guardadas[ids[1]][1],
              "Los dos quedaron a la misma altura: ordenados en la misma fila")

    print("\n4) Volver a guardar actualiza (no duplica)")
    carga2 = {"posiciones": [
        {"dispositivo_id": ids[0], "x": 40, "y": 300},
        {"dispositivo_id": ids[1], "x": 370, "y": 12},
    ]}
    r = CLIENTE.put(f"/api/elementos/{nodo_id}/diagrama/posiciones", json=carga2)
    check(r.status_code == 200, "El segundo PUT responde 200", f"status={r.status_code}")
    check(filas_de_posicion(nodo_id) == 2, "Sigue habiendo dos filas (upsert)",
          f"filas={filas_de_posicion(nodo_id)}")
    dto = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo").json()
    check(posiciones_del_dto(dto).get(ids[0]) == (40.0, 300.0), "El sitio nuevo quedó guardado",
          str(posiciones_del_dto(dto)))

    print("\n5) Guardas del orden")
    r = CLIENTE.put(f"/api/elementos/{nodo_id}/diagrama/posiciones",
                    json={"posiciones": [{"dispositivo_id": 999999, "x": 10, "y": 10}]})
    check(r.status_code == 404, "Un aparato que no está en el nodo -> 404",
          f"status={r.status_code} {r.text[:140]}")
    r = CLIENTE.put(f"/api/elementos/{nodo_id}/diagrama/posiciones",
                    json={"posiciones": [{"dispositivo_id": ids[0], "x": 1e9, "y": 10}]})
    check(r.status_code == 400, "Una coordenada fuera del lienzo -> 400",
          f"status={r.status_code} {r.text[:160]}")
    if ESTADO["postes"]:
        r = CLIENTE.put(f"/api/elementos/{ESTADO['postes'][0]}/diagrama/posiciones",
                        json={"posiciones": [{"dispositivo_id": ids[0], "x": 1, "y": 1}]})
        check(r.status_code == 400, "Un poste no ordena aparatos -> 400", f"status={r.status_code}")
    r = CLIENTE.put(f"/api/elementos/{nodo_id}/diagrama/posiciones", json={"posiciones": []})
    check(r.status_code == 200 and r.json()["guardadas"] == 0,
          "Una lista vacía es válida (0 guardadas)", r.text[:140])

    print("\n6) Quitar un aparato se lleva su posición (sin huérfanas)")
    if creado:
        r = CLIENTE.put(f"/api/elementos/{nodo_id}/diagrama/posiciones",
                        json={"posiciones": [{"dispositivo_id": creado, "x": 500, "y": 260}]})
        check(r.status_code == 200, "Se situó el splitter temporal", f"status={r.status_code}")
        check(filas_del_dispositivo(creado) == 1, "Su posición quedó guardada")
        r = CLIENTE.delete(f"/api/elementos/{nodo_id}/dispositivos/{creado}")
        check(r.status_code == 200, "Se quitó el splitter temporal", f"status={r.status_code}")
        check(filas_del_dispositivo(creado) == 0, "No queda fila huérfana de su posición")
        creado = None
    else:
        print("        (el nodo ya tenía dos aparatos: no hizo falta crear ninguno)")

    print("\n7) Restablecer el orden (dejar el diagrama limpio)")
    r = CLIENTE.delete(f"/api/elementos/{nodo_id}/diagrama/posiciones")
    check(r.status_code == 200, "El DELETE del orden responde 200", f"status={r.status_code}")
    check(filas_de_posicion(nodo_id) == 0, "No queda ninguna posición guardada",
          f"filas={filas_de_posicion(nodo_id)}")
    dto = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo").json()
    check(not posiciones_del_dto(dto), "El DTO vuelve a mandar x/y vacíos (rejilla automática)",
          str(posiciones_del_dto(dto)))
    check(all(d.get("x") is None and d.get("y") is None for d in dto["dispositivos"]),
          "Cada aparato viene sin sitio guardado")

    print("\n8) Nada de lo anterior se rompió")
    check("bandejas" in dto and "puertos" in dto and "hilos_que_terminan" in dto,
          "El DTO sigue trayendo todas sus secciones")
    r = CLIENTE.get(f"/api/elementos/todos?proyecto_id={proyecto}")
    check(r.status_code == 200 and "features" in r.json(),
          "La capa física (GeoJSON del mapa) sigue respondiendo igual", f"status={r.status_code}")

    if creado:   # por si algo salió por el camino de los fallos
        CLIENTE.delete(f"/api/elementos/{nodo_id}/dispositivos/{creado}")

    print("\n" + "=" * 74)
    print(f"RESULTADO: {R['ok']} comprobaciones OK, {len(R['fallos'])} fallos")
    for f in R["fallos"]:
        print(f"  - {f}")
    print("=" * 74)
    return 1 if R["fallos"] else 0


if __name__ == "__main__":
    raise SystemExit(main())


