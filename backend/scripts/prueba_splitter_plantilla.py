"""
prueba_splitter_plantilla.py

Verifica el arreglo del error:
    "No se puede materializar el splitter. La plantilla «…» no define la división"

Causa: la plantilla guarda la división como "1x8 (10.7 dB)" y el parser de la
materialización hacía int("8 (10.7 db)") -> fallaba. Ahora hay UN parser
compartido (app/models/ftth_logica.py::parsear_division).

Comprueba:
  1. El parser compartido con varios formatos reales.
  2. End-to-end contra la app: instala el splitter de la plantilla real en un
     nodo y verifica los puertos generados.
  3. Al terminar BORRA lo creado, para no dejar datos de prueba en la BD.

Uso (desde backend/):
    python scripts/prueba_splitter_plantilla.py
    python scripts/prueba_splitter_plantilla.py --proyecto 1 --tipo-id 7
"""
import argparse
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
from app.database import SessionLocal  # noqa: E402
import app.models.ftth_logica as logica  # noqa: E402
import app.models.ftth_models as fisicos  # noqa: E402

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


CLIENTE = ClienteSync()

# ── 1. Parser compartido ─────────────────────────────────────────────────────
CASOS = [
    ("1x8", (1, 8)),
    ("1 x 16", (1, 16)),
    ("1X4", (1, 4)),
    ("2:16", (2, 16)),
    ("1x8 (10.7 dB)", (1, 8)),        # ← el formato que rompía
    ("1x16 (13.7 dB)", (1, 16)),      # ← y el ejemplo del mensaje de error
    ("2x32", (2, 32)),
    ("1x64", (1, 64)),
    ("sin division", None),
    ("", None),
    (None, None),
    ({"a": 1}, None),
]


def probar_parser():
    print("\n1) Parser compartido de división (models/ftth_logica.py::parsear_division)")
    for entrada, esperado in CASOS:
        obtenido = logica.parsear_division(entrada)
        check(
            obtenido == esperado,
            f"parsear_division({entrada!r}) -> {esperado}",
            f"obtenido {obtenido}",
        )
    import app.routers.ftth_logica as router_logica
    check(
        router_logica._parsear_division("1x8 (10.7 dB)") == (1, 8),
        "El router de materialización usa el parser compartido",
        str(router_logica._parsear_division("1x8 (10.7 dB)")),
    )
    import app.routers.ftth_tipos as tipos
    check(tipos._DIVISION_RE is logica.DIVISION_RE, "El catálogo de tipos comparte el mismo regex")


def main() -> int:
    ap = argparse.ArgumentParser(description="Prueba del splitter desde plantilla con sufijo dB")
    ap.add_argument("--proyecto", type=int, default=1)
    ap.add_argument("--tipo-id", type=int, default=7)
    args = ap.parse_args()

    print("=" * 74)
    print("PRUEBA — splitter desde plantilla «1x8 (10.7 dB)»")
    print("=" * 74)

    probar_parser()

    print(f"\n2) End-to-end con la plantilla real (tipo_id={args.tipo_id}, proyecto {args.proyecto})")
    r = CLIENTE.get(f"/api/elementos/todos?proyecto_id={args.proyecto}")
    features = r.json().get("features", [])
    nodos = [
        f["properties"]["id"] for f in features
        if f["properties"].get("categoria") in ("cajanap", "manga", "odf", "armario", "olt")
    ]
    if not nodos:
        print("        No hay nodos en el proyecto: nada que probar.")
        return 0

    nodo_id = nodos[0]
    antes = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo").json()
    dispositivos_antes = antes["resumen"]["dispositivos"]
    puertos_antes = antes["resumen"]["puertos"]
    print(f"        nodo #{nodo_id}: {dispositivos_antes} dispositivo(s) y {puertos_antes} puerto(s) antes")

    # Solo se envía el tipo_id, igual que hace el diagrama: la división sale de la plantilla
    r = CLIENTE.post(
        f"/api/elementos/{nodo_id}/dispositivos",
        json={"tipo": "splitter", "tipo_id": args.tipo_id},
    )
    check(r.status_code == 200, "Instalar el splitter ya NO devuelve error",
          f"status={r.status_code} {r.text[:250]}")
    if r.status_code != 200:
        return 1

    datos = r.json()
    print(f"        dispositivo #{datos['id']}: {datos['tipo']} {datos['division']} · "
          f"{datos['puertos_creados']} · {datos['atenuacion_db']} dB")
    check(datos["division"] == "1x8", "La división se dedujo de la plantilla (1x8)", str(datos["division"]))
    check(datos["puertos_creados"]["IN"] == 1, "Generó 1 puerto IN")
    check(datos["puertos_creados"]["OUT"] == 8, "Generó 8 puertos OUT")
    check(datos["atenuacion_db"] == 10.7, "Atenuación nominal 10.7 dB", str(datos["atenuacion_db"]))

    despues = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo").json()
    check(
        despues["resumen"]["dispositivos"] == dispositivos_antes + 1,
        "El nodo cuenta el dispositivo nuevo",
        str(despues["resumen"]["dispositivos"]),
    )
    check(
        despues["resumen"]["puertos"] == puertos_antes + 9,
        "El nodo cuenta los 9 puertos nuevos",
        str(despues["resumen"]["puertos"]),
    )

    print("\n3) Limpieza (se borra lo creado por la prueba)")
    db = SessionLocal()
    try:
        borrados_puertos = (
            db.query(logica.FtthPuerto)
            .filter(logica.FtthPuerto.dispositivo_id == datos["id"])
            .delete(synchronize_session=False)
        )
        borrados_disp = (
            db.query(logica.FtthDispositivo)
            .filter(logica.FtthDispositivo.id == datos["id"])
            .delete(synchronize_session=False)
        )
        db.commit()
    finally:
        db.close()
    final = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo").json()
    check(
        final["resumen"]["dispositivos"] == dispositivos_antes and final["resumen"]["puertos"] == puertos_antes,
        f"El nodo #{nodo_id} quedó como estaba ({dispositivos_antes} dispositivos, {puertos_antes} puertos)",
        f"ahora {final['resumen']['dispositivos']} y {final['resumen']['puertos']}",
    )
    print(f"        (borrados {borrados_puertos} puerto(s) y {borrados_disp} dispositivo(s) de prueba)")

    print("\n" + "=" * 74)
    print(f"RESULTADO: {R['ok']} comprobaciones OK, {len(R['fallos'])} fallos")
    for f in R["fallos"]:
        print(f"  - {f}")
    print("=" * 74)
    return 1 if R["fallos"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

