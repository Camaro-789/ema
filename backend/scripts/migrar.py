"""
migrar.py — Atajo de Alembic para el día a día.

Uso (desde backend/):
    python scripts/migrar.py estado
    python scripts/migrar.py aplicar                 (upgrade head)
    python scripts/migrar.py revertir --pasos 2      (downgrade -2)

Seguridad: `revertir` SOLO se permite sobre copias (URL con `_test.db`, `copia`,
`demo`, `tmp` o `respaldo`) o con `--forzar`. La base real no se revierte (R2).
"""
import argparse
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

URL_POR_DEFECTO = "sqlite:///./tachira_maps.db"
MARCAS_COPIA = ("_test.db", "copia", "demo", "tmp", "respaldo")


def configuracion(url: str) -> Config:
    os.environ["DATABASE_URL"] = url
    config = Config(os.path.join(BASE, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BASE, "migrations"))
    return config


def main() -> int:
    parser = argparse.ArgumentParser(description="Migraciones de Map OLT (Alembic)")
    parser.add_argument("accion", choices=["estado", "aplicar", "revertir"])
    parser.add_argument("--pasos", type=int, default=1, help="cuántas revisiones revertir")
    parser.add_argument("--url", default=None)
    parser.add_argument("--forzar", action="store_true")
    args = parser.parse_args()

    url = args.url or os.environ.get("DATABASE_URL") or URL_POR_DEFECTO
    print(f"base: {url}")

    if args.accion == "revertir" and not args.forzar:
        if not any(marca in url for marca in MARCAS_COPIA):
            print("ABORTADO: `revertir` solo sobre copias (_test.db, copia, demo, tmp, "
                  "respaldo) o con --forzar.")
            return 2

    config = configuracion(url)
    if args.accion == "estado":
        command.current(config, verbose=True)
        command.heads(config, verbose=True)
        return 0
    if args.accion == "aplicar":
        command.upgrade(config, "head")
        command.current(config, verbose=True)
        return 0
    command.downgrade(config, f"-{max(1, args.pasos)}")
    command.current(config, verbose=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

