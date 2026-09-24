"""
diagnostico_capa_logica.py

Diagnóstico de solo lectura de la capa física y lógica FTTH.

NO modifica nada: únicamente lee la base de datos y reporta.
Se usa para la línea base de la Fase 0 y para verificar que la capa
lógica (tubos / hilos) no alteró la capa física.

Uso (desde la carpeta backend/):
    python scripts/diagnostico_capa_logica.py
    python scripts/diagnostico_capa_logica.py --proyecto 1
"""
import argparse
import os
import sqlite3
import sys

# Permite ejecutar el script desde backend/ sin instalar el paquete
# La consola de Windows suele estar en cp1252 y no soporta algunos caracteres
# (por ejemplo la flecha → de los listados): se fuerza UTF-8 en la salida para
# que el diagnóstico NUNCA falle por un carácter.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def ruta_bd() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///./tachira_maps.db")
    if url.startswith("sqlite"):
        return url.replace("sqlite:///", "").replace("sqlite://", "")
    return url


def pausa(con: sqlite3.Connection, sql: str, params=()):
    try:
        return list(con.execute(sql, params))
    except sqlite3.Error as e:
        return [("(error)", str(e))]


def main() -> int:
    ap = argparse.ArgumentParser(description="Diagnóstico de la capa lógica FTTH")
    ap.add_argument("--proyecto", type=int, default=None, help="Filtrar por proyecto_id")
    args = ap.parse_args()

    ruta = ruta_bd()
    print("=" * 72)
    print("DIAGNÓSTICO DE CAPA LÓGICA — solo lectura")
    print("=" * 72)
    print(f"Base de datos : {os.path.abspath(ruta)}")
    print(f"Existe        : {os.path.exists(ruta)}")
    if not os.path.exists(ruta):
        print("No hay base de datos: nada que diagnosticar.")
        return 0

    con = sqlite3.connect(ruta)
    con.row_factory = sqlite3.Row

    tablas = [r[0] for r in pausa(con, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    print(f"\nTablas ({len(tablas)}):")
    for t in tablas:
        print(f"  - {t}")

    fisicas = {"ftth_elementos", "ftth_tipos", "ftth_carpetas", "ftth_carpeta_elementos", "map_projects"}
    logicas = {"ftth_cable_tubos", "ftth_cable_fibras", "ftth_fibra_extremos"}
    print("\n  capa física presente :", ", ".join(sorted(fisicas & set(tablas))) or "(ninguna)")
    print("  capa lógica presente :", ", ".join(sorted(logicas & set(tablas))) or "(ninguna — aún no creada)")

    where = ""
    params = ()
    if args.proyecto is not None:
        where = " WHERE proyecto_id = ?"
        params = (args.proyecto,)

    print("\n-- Conteos --")
    for t in sorted(fisicas):
        if t in tablas:
            n = pausa(con, f"SELECT COUNT(*) FROM {t}{where}", params)[0][0]
            print(f"  {t:26s} {n}")
    for t in sorted(logicas):
        if t in tablas:
            n = pausa(con, f"SELECT COUNT(*) FROM {t}{where}", params)[0][0]
            print(f"  {t:26s} {n}")

    print("\n-- Elementos por categoría --")
    for r in pausa(con, f"SELECT categoria, COUNT(*) n FROM ftth_elementos{where} GROUP BY categoria ORDER BY n DESC", params):
        print(f"  {str(r['categoria']):14s} {r['n']}")

    print("\n-- Elementos y plantillas por proyecto (no debe perderse nada) --")
    for r in pausa(con, """
        SELECT p.id, p.name,
               (SELECT COUNT(*) FROM ftth_elementos e WHERE e.proyecto_id = p.id) AS elementos,
               (SELECT COUNT(*) FROM ftth_tipos t WHERE t.proyecto_id = p.id) AS tipos,
               (SELECT COUNT(*) FROM ftth_carpetas c WHERE c.proyecto_id = p.id) AS carpetas
        FROM map_projects p ORDER BY p.id
    """):
        print(f"  proyecto {r['id']} «{r['name']}»: {r['elementos']} elementos, {r['tipos']} plantillas, {r['carpetas']} carpetas")

    print("\n-- Plantillas por categoría --")
    for r in pausa(con, f"SELECT categoria, COUNT(*) n FROM ftth_tipos{where} GROUP BY categoria ORDER BY n DESC", params):
        print(f"  {str(r['categoria']):14s} {r['n']}")

    print("\n-- Cables y su capacidad declarada en la plantilla --")
    sql_cables = """
        SELECT e.id, e.proyecto_id, e.tipo_id, t.id AS tipo_existe,
               t.nombre_id, t.propiedades,
               (SELECT COUNT(*) FROM ftth_cable_tubos tb WHERE tb.elemento_id = e.id) AS tubos,
               (SELECT COUNT(*) FROM ftth_cable_fibras fb WHERE fb.elemento_id = e.id) AS hilos
        FROM ftth_elementos e
        LEFT JOIN ftth_tipos t ON t.id = e.tipo_id
        WHERE e.categoria = 'cables'
    """
    if args.proyecto is not None:
        sql_cables += " AND e.proyecto_id = ?"
    if "ftth_cable_tubos" not in tablas:
        sql_cables = sql_cables.replace(
            "(SELECT COUNT(*) FROM ftth_cable_tubos tb WHERE tb.elemento_id = e.id)", "0"
        ).replace(
            "(SELECT COUNT(*) FROM ftth_cable_fibras fb WHERE fb.elemento_id = e.id)", "0"
        )
    filas = pausa(con, sql_cables, params)
    if not filas:
        print("  (no hay elementos con categoria='cables')")
    for r in filas:
        print(f"  cable #{r['id']} (proyecto {r['proyecto_id']}) plantilla={r['nombre_id'] or 'SIN PLANTILLA'}")
        print(f"      propiedades : {r['propiedades']}")
        print(f"      tubos/hilos : {r['tubos']} / {r['hilos']}")

    print("\n-- Integridad física existente --")
    huerfanos = pausa(con, """
        SELECT COUNT(*) FROM ftth_elementos e
        WHERE e.tipo_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM ftth_tipos t WHERE t.id = e.tipo_id)
    """)[0][0]
    print(f"  elementos con tipo_id inexistente : {huerfanos}")
    con_post = pausa(con, f"SELECT COUNT(*) FROM ftth_elementos{where} WHERE poste_ref_id IS NOT NULL", params)[0][0]
    total = pausa(con, f"SELECT COUNT(*) FROM ftth_elementos{where}", params)[0][0]
    print(f"  elementos con poste_ref_id        : {con_post} de {total}")

    con.close()
    print("\nDiagnóstico terminado (sin cambios en la base de datos).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
