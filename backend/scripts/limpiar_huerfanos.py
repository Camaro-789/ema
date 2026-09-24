"""
limpiar_huerfanos.py

Borra las filas HUÉRFANAS de la base: hijos (tubos, hilos, extremos, puertos,
bandejas, dispositivos, posiciones, enlaces a carpetas) de elementos que ya no
existen.

¿Por qué existen? En SQLite los `ON DELETE CASCADE` que declaran los modelos NO
se aplican si no se activa `PRAGMA foreign_keys=ON`. Y como los ids se reutilizan
(SQLite asigna `max(id)+1`), un elemento NUEVO podía heredar los tubos/hilos del
borrado: un cable drop aparecía con capacidad 12 y 12 hilos de un cable viejo.

La API ya limpia los hijos al borrar (`DELETE /api/elementos/{id}` y el de
proyectos), así que esto es para residuo viejo o generado fuera de la API.

Uso (desde backend/):
    python scripts/limpiar_huerfanos.py            # muestra qué borraría (no escribe)
    python scripts/limpiar_huerfanos.py --si       # lo aplica (hace copia de seguridad)

La copia de seguridad se guarda junto a la base, como
`tachira_maps_respaldo_AAAAmmdd_HHMMSS.db`.
"""
import argparse
import datetime
import os
import shutil
import sqlite3
import sys

# La consola de Windows suele estar en cp1252: se fuerza UTF-8 en la salida.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# (tabla, columna, tabla_padre, columna_padre)
REGLAS = (
    ("ftth_fibra_extremos", "fibra_id", "ftth_cable_fibras", "id"),
    ("ftth_fibra_extremos", "elemento_id", "ftth_elementos", "id"),
    ("ftth_cable_fibras", "tubo_id", "ftth_cable_tubos", "id"),
    ("ftth_cable_fibras", "elemento_id", "ftth_elementos", "id"),
    ("ftth_puertos", "dispositivo_id", "ftth_dispositivos", "id"),
    ("ftth_puertos", "elemento_id", "ftth_elementos", "id"),
    ("ftth_dispositivos", "elemento_id", "ftth_elementos", "id"),
    ("ftth_bandejas", "elemento_id", "ftth_elementos", "id"),
    ("ftth_diagrama_posiciones", "elemento_id", "ftth_elementos", "id"),
    ("ftth_carpeta_elementos", "elemento_id", "ftth_elementos", "id"),
    ("carpeta_elementos", "elemento_id", "ftth_elementos", "id"),
    ("ftth_fibra_extremos", "nodo_id", "ftth_elementos", "id"),
    ("ftth_cable_tubos", "elemento_id", "ftth_elementos", "id"),
)


def ruta_base(explicita=None):
    if explicita:
        return explicita
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "tachira_maps.db")


def condicion(columna, padre, col_padre):
    return (f"{columna} IS NOT NULL AND {columna} NOT IN "
            f"(SELECT {col_padre} FROM {padre})")


def main():
    ap = argparse.ArgumentParser(description="Borra filas huérfanas (hijos de elementos borrados).")
    ap.add_argument("--si", action="store_true", help="Aplica el borrado (si no, solo informa).")
    ap.add_argument("--db", default=None, help="Ruta de la base (por defecto backend/tachira_maps.db).")
    args = ap.parse_args()

    ruta = ruta_base(args.db)
    if not os.path.exists(ruta):
        print(f"No existe la base: {ruta}")
        return 1
    print(f"Base: {ruta}" + ("" if args.si else "   [SIMULACIÓN: no se escribe nada]"))

    if args.si:
        respaldo = ruta.replace(".db", f"_respaldo_{datetime.datetime.now():%Y%m%d_%H%M%S}.db")
        shutil.copy2(ruta, respaldo)
        print(f"Copia de seguridad: {respaldo}")

    con = sqlite3.connect(ruta)
    cur = con.cursor()

    def contar(tabla, col, padre, col_padre):
        try:
            return cur.execute(
                f"select count(*) from {tabla} where {condicion(col, padre, col_padre)}"
            ).fetchone()[0]
        except sqlite3.Error:
            return 0   # la tabla/columna no existe en esta base: se omite

    total = 0
    for pasada in (1, 2, 3):
        borradas = 0
        for (tabla, col, padre, col_padre) in REGLAS:
            n = contar(tabla, col, padre, col_padre)
            if not n:
                continue
            print(f"  {tabla}.{col}: {n} huérfanas")
            if args.si:
                try:
                    cur.execute(f"delete from {tabla} where {condicion(col, padre, col_padre)}")
                except sqlite3.Error as e:
                    print(f"    no se pudo borrar: {e}")
                    continue
            borradas += n
        if args.si:
            con.commit()
        total += borradas
        if not borradas:
            break

    if not total:
        print("No hay filas huérfanas. Nada que hacer.")
    elif args.si:
        print(f"Borradas {total} filas huérfanas.")
    else:
        print(f"Se borrarían {total} filas huérfanas. Re-ejecuta con --si para aplicarlo.")

    print("\nResumen de la base:")
    for tabla in ("ftth_elementos", "ftth_cable_tubos", "ftth_cable_fibras",
                  "ftth_fibra_extremos", "ftth_puertos", "ftth_dispositivos"):
        try:
            n = cur.execute(f"select count(*) from {tabla}").fetchone()[0]
            print(f"  {tabla}: {n} filas")
        except sqlite3.Error:
            pass

    con.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
