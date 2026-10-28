"""
prueba_nodo_snapshot.py — Compara GET /nodo con el snapshot guardado.

Demuestra que la optimización de `obtener_nodo` no cambió el DTO: cada elemento
del snapshot debe devolver EXACTAMENTE el mismo JSON (claves ordenadas), y no
debe aparecer ni desaparecer ninguno.

Uso (desde backend/):
    $env:DATABASE_URL = "sqlite:///./tests/tachira_maps_test.db"
    python scripts/prueba_nodo_snapshot.py
    python scripts/prueba_nodo_snapshot.py --snapshot tests/snapshots/nodo_antes.json
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

R = {"ok": 0, "fallos": []}


def check(condicion, mensaje, detalle=""):
    if condicion:
        R["ok"] += 1
        print(f"  [OK]    {mensaje}")
    else:
        R["fallos"].append(mensaje)
        print(f"  [FALLO] {mensaje}")
        if detalle:
            print(f"          {detalle[:400]}")


def canonico(dto):
    return json.dumps(dto, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def primeras_diferencias(antes, despues, limite=6):
    """Rutas donde difieren los dos DTO (para que el fallo sea accionable)."""
    diferencias = []

    def recorrer(a, b, ruta):
        if len(diferencias) >= limite:
            return
        if type(a) is not type(b):
            diferencias.append(f"{ruta}: tipo {type(a).__name__} -> {type(b).__name__}")
            return
        if isinstance(a, dict):
            for clave in sorted(set(a) | set(b)):
                if len(diferencias) >= limite:
                    return
                if clave not in a:
                    diferencias.append(f"{ruta}.{clave}: aparece")
                elif clave not in b:
                    diferencias.append(f"{ruta}.{clave}: desaparece")
                else:
                    recorrer(a[clave], b[clave], f"{ruta}.{clave}")
        elif isinstance(a, list):
            if len(a) != len(b):
                diferencias.append(f"{ruta}: longitud {len(a)} -> {len(b)}")
                return
            for indice, (item_a, item_b) in enumerate(zip(a, b)):
                recorrer(item_a, item_b, f"{ruta}[{indice}]")
        elif a != b:
            diferencias.append(f"{ruta}: {a!r} -> {b!r}")

    recorrer(antes, despues, "$")
    return diferencias


async def comparar(ruta_snapshot):
    url = os.environ.get("DATABASE_URL", "")
    if "_test.db" not in url:
        print(f"ABORTADO: DATABASE_URL={url!r} no es una base de prueba (R7).")
        return 2
    if not os.path.exists(ruta_snapshot):
        print(f"ABORTADO: no existe el snapshot {ruta_snapshot}")
        return 2

    with open(ruta_snapshot, encoding="utf-8") as archivo:
        snapshot = json.load(archivo)

    import httpx
    from app.main import app

    print(f"Snapshot: {ruta_snapshot} ({len(snapshot)} elementos)")
    print(f"Base     : {url}")
    transport = httpx.ASGITransport(app=app)
    vistos = set()
    async with httpx.AsyncClient(transport=transport, base_url="http://prueba") as cliente:
        for elemento_id, guardado in snapshot.items():
            respuesta = await cliente.get(f"/api/elementos/{elemento_id}/nodo")
            check(respuesta.status_code == 200, f"elemento #{elemento_id} responde 200",
                  f"status={respuesta.status_code}")
            if respuesta.status_code != 200:
                continue
            actual = respuesta.json()
            vistos.add(elemento_id)
            iguales = canonico(actual) == canonico(guardado["dto"])
            detalle = ""
            if not iguales:
                detalle = " | ".join(primeras_diferencias(guardado["dto"], actual))
            check(iguales, f"elemento #{elemento_id} ({guardado['categoria']}) DTO idéntico", detalle)
            check(actual.get("resumen") == guardado["dto"].get("resumen"),
                  f"elemento #{elemento_id} resumen idéntico")

        check(len(vistos) == len(snapshot), "no desapareció ningún elemento del snapshot",
              f"vistos={len(vistos)} de {len(snapshot)}")

    print(f"\nRESULTADO: {R['ok']} comprobaciones OK, {len(R['fallos'])} fallos")
    for fallo in R["fallos"][:10]:
        print(f"   - {fallo}")
    return 0 if not R["fallos"] else 1


def main():
    parser = argparse.ArgumentParser(description="Compara GET /nodo con un snapshot")
    parser.add_argument("--snapshot", default=os.path.join("tests", "snapshots", "nodo_antes.json"))
    args = parser.parse_args()
    ruta = args.snapshot if os.path.isabs(args.snapshot) else os.path.join(BASE, args.snapshot)
    return asyncio.run(comparar(ruta))


if __name__ == "__main__":
    raise SystemExit(main())
