"""
medir_nodo.py — Mide `GET /api/elementos/{id}/nodo` antes de optimizarlo.

Qué mide (Fase 1: "medir y optimizar /nodo"):
  - cuántas sentencias SQL ejecuta cada llamada (detecta N+1),
  - cuántas de esas sentencias son la MISMA repetida,
  - cuánto tarda la respuesta (frío y caliente),
  - cuántas filas devuelve el DTO.

Es SOLO LECTURA: hace GET /nodo de los elementos que conmutan hilos y no crea,
modifica ni borra nada. No necesita `ejecutar_prueba.py` porque no escribe.

Uso (desde backend/):
    python scripts/medir_nodo.py
    python scripts/medir_nodo.py --anclajes          (incluye los nodos donde
                                                      estan anclados los cables)
    python scripts/medir_nodo.py --proyecto 1 --repeticiones 3

Deja el informe en ../../MEDICION_NODO.txt (raíz de VS, junto a los otros .txt).
"""
import argparse
import asyncio
import os
import re
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

import httpx  # noqa: E402
from sqlalchemy import event, func, or_  # noqa: E402

from app.main import app  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
import app.models.ftth_models as fisicos  # noqa: E402
import app.models.ftth_logica as logica  # noqa: E402

CATEGORIAS = ("cajanap", "manga", "odf", "armario", "olt", "splitter", "fusion")

_sql = {"n": 0, "sentencias": []}


def _antes_de_ejecutar(conn, cursor, statement, parameters, context, executemany):
    _sql["n"] += 1
    _sql["sentencias"].append(re.sub(r"\s+", " ", statement).strip())


event.listen(engine, "before_cursor_execute", _antes_de_ejecutar)


def _normalizar(sentencia):
    """Reduce la sentencia a su 'forma' para agrupar repetidas (N+1)."""
    forma = re.sub(r"\b\d+\b", "?", sentencia)
    forma = re.sub(r"'[^']*'", "?", forma)
    return forma[:150]


def inventario(proyecto, incluir_anclajes=False):
    """Elementos que conmutan hilos + tamaño real de la capa lógica (lectura).

    Con `incluir_anclajes` también se miden los elementos donde están anclados
    los extremos de los cables (hoy son postes): son los únicos que hoy
    devuelven hilos en /nodo y, por tanto, los que ejercitan el bucle N+1.
    """
    db = SessionLocal()
    try:
        totales = {
            "cables": db.query(func.count(fisicos.FtthElemento.id))
            .filter(func.lower(fisicos.FtthElemento.categoria) == "cables").scalar(),
            "fibras": db.query(func.count(logica.FtthCableFibra.id)).scalar(),
            "tubos": db.query(func.count(logica.FtthCableTubo.id)).scalar(),
            "extremos": db.query(func.count(logica.FtthFibraExtremo.id)).scalar(),
            "puertos": db.query(func.count(logica.FtthPuerto.id)).scalar(),
            "dispositivos": db.query(func.count(logica.FtthDispositivo.id)).scalar(),
            "empalmes": db.query(func.count(logica.FtthEmpalme.id)).scalar(),
        }
        cables = (
            db.query(fisicos.FtthElemento.id, fisicos.FtthElemento.extremo_A_id,
                     fisicos.FtthElemento.extremo_B_id)
            .filter(func.lower(fisicos.FtthElemento.categoria) == "cables")
            .order_by(fisicos.FtthElemento.id)
            .all()
        )
        ids_extremos = set()
        for cable in cables:
            ids_extremos.update(x for x in (cable.extremo_A_id, cable.extremo_B_id) if x)
        categorias_extremo = {}
        if ids_extremos:
            for fila in (
                db.query(fisicos.FtthElemento.id, fisicos.FtthElemento.categoria)
                .filter(fisicos.FtthElemento.id.in_(ids_extremos))
                .all()
            ):
                categorias_extremo[fila.id] = fila.categoria
        anclajes = [
            {
                "id": cable.id,
                "a": cable.extremo_A_id,
                "b": cable.extremo_B_id,
                "cat_a": categorias_extremo.get(cable.extremo_A_id, "NO EXISTE"),
                "cat_b": categorias_extremo.get(cable.extremo_B_id, "NO EXISTE"),
            }
            for cable in cables
        ]

        filtro = func.lower(fisicos.FtthElemento.categoria).in_(CATEGORIAS)
        if incluir_anclajes and ids_extremos:
            filtro = or_(filtro, fisicos.FtthElemento.id.in_(ids_extremos))
        consulta = db.query(
            fisicos.FtthElemento.id, fisicos.FtthElemento.categoria,
            fisicos.FtthElemento.tipo_id
        ).filter(filtro)
        if proyecto is not None:
            consulta = consulta.filter(fisicos.FtthElemento.proyecto_id == proyecto)
        elementos = consulta.order_by(fisicos.FtthElemento.id).all()
        return elementos, totales, anclajes
    finally:
        db.close()


async def medir(proyecto, repeticiones, salida, incluir_anclajes=False):
    lineas = []

    def escribir(texto=""):
        print(texto)
        lineas.append(texto)

    elementos, totales, cables = inventario(proyecto, incluir_anclajes)
    escribir("MEDICION DE GET /api/elementos/{id}/nodo")
    escribir("=" * 78)
    escribir("Datos reales en la base (solo lectura):")
    for clave, valor in totales.items():
        escribir(f"  {clave:<12} {valor}")
    escribir("Cables y el nodo donde estan anclados sus extremos:")
    for cable in cables:
        escribir(f"  cable #{cable['id']}: A={cable['a']} ({cable['cat_a']})  "
                 f"B={cable['b']} ({cable['cat_b']})")
    escribir("=" * 78)
    escribir(f"{'#':>4} {'categoria':<10} {'band':>5} {'disp':>5} {'puert':>6} "
             f"{'hilos':>6} {'emp':>5} {'SQL':>6} {'tiempo ms':>10}")
    escribir("-" * 78)

    transport = httpx.ASGITransport(app=app)
    resumen = []
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as cliente:
        for elemento in elementos:
            sql_por_pasada = []
            tiempos = []
            dto = None
            for _ in range(max(1, repeticiones)):
                _sql["n"] = 0
                _sql["sentencias"] = []
                inicio = time.perf_counter()
                respuesta = await cliente.get(f"/api/elementos/{elemento.id}/nodo")
                tiempos.append((time.perf_counter() - inicio) * 1000)
                sql_por_pasada.append(list(_sql["sentencias"]))
                if respuesta.status_code == 200:
                    dto = respuesta.json()
                else:
                    dto = {"error": respuesta.status_code}
                    break

            sentencias = sql_por_pasada[-1]
            formas = {}
            for sentencia in sentencias:
                forma = _normalizar(sentencia)
                formas[forma] = formas.get(forma, 0) + 1
            repetidas = {forma: veces for forma, veces in formas.items() if veces > 1}

            dto = dto or {}
            resumen_nodo = dto.get("resumen") or {}
            fila = {
                "id": elemento.id,
                "categoria": elemento.categoria,
                "bandejas": resumen_nodo.get("bandejas", 0),
                "dispositivos": resumen_nodo.get("dispositivos", 0),
                "puertos": resumen_nodo.get("puertos", 0),
                "hilos": resumen_nodo.get("hilos_anclados", 0),
                "empalmes": resumen_nodo.get("empalmes", 0),
                "sql": len(sentencias),
                "formas": len(formas),
                "repetidas": sum(repetidas.values()) - len(repetidas),
                "ms": tiempos[-1],
                "ms_frio": tiempos[0],
                "top": sorted(repetidas.items(), key=lambda par: -par[1])[:3],
                "error": dto.get("error"),
            }
            resumen.append(fila)
            escribir(
                f"{fila['id']:>4} {str(fila['categoria'])[:10]:<10} {fila['bandejas']:>5} "
                f"{fila['dispositivos']:>5} {fila['puertos']:>6} {fila['hilos']:>6} "
                f"{fila['empalmes']:>5} {fila['sql']:>6} {fila['ms']:>10.1f}"
            )
            for forma, veces in fila["top"]:
                if veces > 1:
                    escribir(f"     x{veces:<4} {forma[:100]}")

    escribir("-" * 78)
    if resumen:
        peor = max(resumen, key=lambda fila: fila["sql"])
        escribir(f"Elementos medidos: {len(resumen)} - repeticiones: {repeticiones}")
        escribir(f"Peor caso: elemento #{peor['id']} ({peor['categoria']}) con "
                 f"{peor['sql']} sentencias SQL y {peor['ms']:.1f} ms")
        escribir(f"Sentencias repetidas en ese caso: {peor['repetidas']} "
                 f"de {peor['sql']} ({peor['formas']} formas distintas)")
        error = [fila for fila in resumen if fila.get("error")]
        escribir(f"Errores: {len(error)}" + (f" -> {[f['id'] for f in error]}" if error else ""))

    destino = salida or os.path.join(os.path.dirname(os.path.dirname(BASE)), "MEDICION_NODO.txt")
    with open(destino, "w", encoding="utf-8") as archivo:
        archivo.write("\n".join(lineas) + "\n")
    print(f"\nInforme guardado en: {destino}")


def main():
    parser = argparse.ArgumentParser(description="Mide GET /api/elementos/{id}/nodo")
    parser.add_argument("--proyecto", type=int, default=None)
    parser.add_argument("--repeticiones", type=int, default=2)
    parser.add_argument("--salida", type=str, default=None)
    parser.add_argument("--anclajes", action="store_true",
                        help="medir tambien los nodos donde estan anclados los cables")
    args = parser.parse_args()
    asyncio.run(medir(args.proyecto, args.repeticiones, args.salida, args.anclajes))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
