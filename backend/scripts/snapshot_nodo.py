"""
snapshot_nodo.py — Guarda la respuesta de GET /nodo de TODOS los elementos.

Sirve para demostrar que la optimización NO cambia el DTO: se toma el snapshot
antes del cambio y `prueba_nodo_snapshot.py` compara después, byte a byte.

Por seguridad (R7) solo trabaja contra una base *_test.db, salvo --forzar.

Uso (desde backend/):
    $env:DATABASE_URL = "sqlite:///./tests/tachira_maps_test.db"
    python scripts/snapshot_nodo.py --salida tests/snapshots/nodo_antes.json
"""
import argparse
import asyncio
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("DATABASE_URL", "sqlite:///./tests/tachira_maps_test.db")


def canonico(dto):
    """JSON estable (claves ordenadas) para poder comparar sin falsos positivos."""
    return json.dumps(dto, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


async def capturar(salida, forzar):
    url = os.environ.get("DATABASE_URL", "")
    if "_test.db" not in url and not forzar:
        print(f"ABORTADO: DATABASE_URL={url!r} no es una base de prueba (R7).")
        print("         Usa --forzar solo si sabes que es una copia de lectura.")
        return 2

    import httpx
    from app.main import app
    from app.database import SessionLocal
    from app.models import ftth_models as fisicos

    db = SessionLocal()
    try:
        elementos = db.query(fisicos.FtthElemento.id, fisicos.FtthElemento.categoria).order_by(
            fisicos.FtthElemento.id).all()
    finally:
        db.close()

    snapshot = {}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://prueba") as cliente:
        for elemento in elementos:
            respuesta = await cliente.get(f"/api/elementos/{elemento.id}/nodo")
            if respuesta.status_code != 200:
                print(f"  [AVISO] elemento #{elemento.id} ({elemento.categoria}) -> "
                      f"{respuesta.status_code}, se omite")
                continue
            snapshot[str(elemento.id)] = {
                "categoria": elemento.categoria,
                "dto": respuesta.json(),
            }
            print(f"  [{elemento.id:>4}] {elemento.categoria:<10} "
                  f"dispositivos={len(snapshot[str(elemento.id)]['dto'].get('dispositivos', []))} "
                  f"hilos={len(snapshot[str(elemento.id)]['dto'].get('hilos', []))}")

    os.makedirs(os.path.dirname(salida), exist_ok=True)
    with open(salida, "w", encoding="utf-8") as archivo:
        json.dump(snapshot, archivo, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"\nSnapshot: {len(snapshot)} elementos -> {salida} ({os.path.getsize(salida)} bytes)")
    print(f"DATABASE_URL usado: {url}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Snapshot de GET /nodo (antes/después)")
    parser.add_argument("--salida", default=os.path.join("tests", "snapshots", "nodo_antes.json"))
    parser.add_argument("--forzar", action="store_true",
                        help="permite una base que no sea *_test.db (solo lectura)")
    args = parser.parse_args()
    salida = args.salida if os.path.isabs(args.salida) else os.path.join(BASE, args.salida)
    return asyncio.run(capturar(salida, args.forzar))


if __name__ == "__main__":
    raise SystemExit(main())
