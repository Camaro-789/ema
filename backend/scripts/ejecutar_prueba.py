"""
ejecutar_prueba.py

Ejecuta una prueba EXISTENTE dentro de una transacción que **nunca se commitea**,
de modo que los objetos que la prueba crea (tipos, cables, tubos, hilos, bandejas,
dispositivos, puertos, posiciones…) desaparecen al terminar. No hay que "limpiar"
nada y no queda residuo ni aunque la prueba se caiga a la mitad.

Uso (desde backend/):
    python scripts/ejecutar_prueba.py scripts/prueba_nodo.py
    python scripts/ejecutar_prueba.py scripts/prueba_capa_logica.py --proyecto 1

Cómo funciona (por qué hace falta):
  Las pruebas llaman a la API en proceso (httpx + ASGITransport). Cada petición
  abre su propia sesión con `app.database.SessionLocal` y hace `commit()`, así que
  un rollback normal no las alcanzaría. Aquí se hace UNA sola conexión y:
    1) `import app.main` PRIMERO, para que el arranque (create_all) quede FUERA de
       la transacción.
    2) se abre una transacción externa en esa conexión y se sustituye
       `app.database.SessionLocal` por una fábrica de sesiones que se *unen* a esa
       transacción con `join_transaction_mode="create_savepoint"`: cada `commit()`
       de la API libera su savepoint y el dato queda dentro de la transacción
       externa, sin tocar el fichero de la base.
    3) al terminar (o al fallar, o con Ctrl+C) se hace `rollback()` y no se guarda
       nada. Si el proceso muere de golpe, SQLite descarta la transacción sola,
       porque nunca hubo COMMIT.
  Las lecturas de las pruebas también pasan por esa sesión, así que ven los datos
  que acaban de crear (antes usaban otra conexión y no los veían).
"""
import os
import runpy
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

# La consola de Windows puede estar en cp1252: se fuerza UTF-8 en la salida.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

if len(sys.argv) < 2:
    print("Uso: python scripts/ejecutar_prueba.py <ruta_de_la_prueba.py> [args...]")
    raise SystemExit(2)

RUTA_PRUEBA = sys.argv[1]
ARGS = sys.argv[2:]

if not os.path.isabs(RUTA_PRUEBA):
    RUTA_PRUEBA = os.path.join(os.getcwd(), RUTA_PRUEBA)
if not os.path.exists(RUTA_PRUEBA):
    print(f"No existe la prueba: {RUTA_PRUEBA}")
    raise SystemExit(2)

import app.database as database  # noqa: E402
import app.main as app_main  # noqa: E402  (importa la app para que el arranque quede fuera)
from sqlalchemy.orm import Session  # noqa: E402

TABLAS = (
    "ftth_elementos", "ftth_tipos", "ftth_cable_tubos", "ftth_cable_fibras",
    "ftth_fibra_extremos", "ftth_puertos", "ftth_dispositivos", "ftth_bandejas",
    "ftth_diagrama_posiciones", "ftth_carpeta_elementos",
)


def _contar(conexion):
    from sqlalchemy import text
    cuenta = {}
    for tabla in TABLAS:
        try:
            cuenta[tabla] = conexion.execute(text(f"SELECT COUNT(*) FROM {tabla}")).scalar()
        except Exception:
            pass
    return cuenta


def _resumen(cuenta):
    return " · ".join(f"{t.replace('ftth_', '')}={n}" for t, n in cuenta.items())


def main():
    conexion = database.engine.connect()
    transaccion = conexion.begin()

    # Toda sesión (de la API o de la propia prueba) entra en ESTA transacción.
    def fabrica_de_sesiones(*_args, **_kwargs):
        return Session(bind=conexion, join_transaction_mode="create_savepoint")

    fabrica_de_sesiones.__name__ = "SessionLocal"
    database.SessionLocal = fabrica_de_sesiones

    antes = _contar(conexion)
    print(f"[transaccion] {os.path.basename(RUTA_PRUEBA)} dentro de una transacción "
          f"(rollback al terminar: no se guarda nada)")
    print(f"[transaccion] base antes: {_resumen(antes)}")

    codigo = 0
    try:
        # La prueba espera SUS argumentos en sys.argv (usa argparse).
        sys.argv = [RUTA_PRUEBA] + ARGS
        runpy.run_path(RUTA_PRUEBA, run_name="__main__")
    except SystemExit as e:            # las pruebas terminan con raise SystemExit(main())
        codigo = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    except BaseException:              # cualquier fallo: se avisa, se hace rollback y se propaga
        import traceback
        traceback.print_exc()
        codigo = 1
    finally:
        try:
            transaccion.rollback()     # ← aquí se descarta TODO lo que hizo la prueba
            print("[transaccion] rollback hecho")
        except Exception as e:
            print(f"[transaccion] aviso: no se pudo hacer rollback: {e}")
        conexion.close()

    # Comprobación de que la base real quedó igual (se lee con una conexión nueva).
    with database.engine.connect() as comprobacion:
        despues = _contar(comprobacion)
    if despues == antes:
        print(f"[transaccion] base después: {_resumen(despues)}  ->  SIN CAMBIOS")
    else:
        print(f"[transaccion] ATENCIÓN: la base cambió -> antes {_resumen(antes)} / "
              f"después {_resumen(despues)}")
        codigo = codigo or 1

    return codigo


if __name__ == "__main__":
    raise SystemExit(main())
