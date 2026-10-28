"""Configuración de pytest — reglas R6/R7.

- Copia la base **sintética** a `tests/tachira_pytest.db` al empezar: las pruebas
  escriben ahí, nunca en `tachira_maps.db` ni en los respaldos.
- Define `DATABASE_URL` ANTES de que ningún test importe `app.*` (conftest se
  importa primero).
- Deja `backend/` en el `sys.path` para que `import app` funcione.
"""
import os
import shutil
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(TESTS)
sys.path.insert(0, BACKEND)

SINTETICA = os.path.join(TESTS, "tachira_maps_test.db")
COPIA = os.path.join(TESTS, "tachira_pytest.db")

if not os.path.exists(SINTETICA):
    pytest.exit(
        "Falta la base sintética. Ejecuta antes:\n"
        "    cd backend && python scripts/crear_base_prueba.py",
        returncode=2,
    )

shutil.copyfile(SINTETICA, COPIA)
os.environ["DATABASE_URL"] = f"sqlite:///{COPIA}"
