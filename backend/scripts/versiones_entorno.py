"""
versiones_entorno.py — Versiones REALES del entorno que ejecuta el backend.

Para que sirve:
  El requirements.txt historico tenia versiones "de catalogo" (p. ej. pydantic
  2.5.3) que no coinciden con lo que hay instalado en este equipo. Este script
  lee las versiones de las distribuciones que el codigo importa de verdad, sin
  instalar ni cambiar nada.

Uso (desde backend/):
    python scripts/versiones_entorno.py

Escribe el informe en ../../VERSIONES_ENTORNO.txt (raiz de VS).
"""
import importlib
import importlib.metadata as md
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# Distribucion (PyPI) -> modulo que importa el codigo
PAQUETES = [
    ("fastapi", "fastapi"),
    ("uvicorn", "uvicorn"),
    ("sqlalchemy", "sqlalchemy"),
    ("pydantic", "pydantic"),
    ("starlette", "starlette"),
    ("httpx", "httpx"),
    ("python-multipart", "multipart"),
    ("python-dotenv", "dotenv"),
    ("xmltodict", "xmltodict"),
    ("shapely", "shapely"),
    ("psycopg2-binary", "psycopg2"),
    ("alembic", "alembic"),
    ("pytest", "pytest"),
    ("playwright", "playwright"),
    ("redis", "redis"),
    ("python-jose", "jose"),
    ("passlib", "passlib"),
    ("numpy", "numpy"),
    ("pandas", "pandas"),
]

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
salida = []


def w(texto=""):
    print(texto)
    salida.append(texto)


w("VERSIONES REALES DEL ENTORNO")
w("=" * 70)
w(f"python      {sys.version.split()[0]}")
w(f"ejecutable  {sys.executable}")
w(f"plataforma  {sys.platform}")
w("-" * 70)
w(f"{'distribucion':<22} {'version':<14} {'instalada':<10} importa")
w("-" * 70)

for distribucion, modulo in PAQUETES:
    try:
        version = md.version(distribucion)
    except md.PackageNotFoundError:
        version = "-"
    try:
        importlib.import_module(modulo)
        importa = "OK"
    except Exception as error:
        importa = f"FALLA ({type(error).__name__})"
    w(f"{distribucion:<22} {version:<14} {'si' if version != '-' else 'no':<10} {importa}")

w("-" * 70)

# Comprobacion final: el backend arranca con estas versiones
os.chdir(BASE)
sys.path.insert(0, BASE)
try:
    import app.main  # noqa: F401
    w("app.main: importa correctamente con este entorno")
except Exception as error:
    w(f"app.main: FALLA -> {type(error).__name__}: {error}")

destino = os.path.join(os.path.dirname(BASE), "docs", "mediciones", "VERSIONES_ENTORNO.txt")
os.makedirs(os.path.dirname(destino), exist_ok=True)
with open(destino, "w", encoding="utf-8") as archivo:
    archivo.write("\n".join(salida) + "\n")
print(f"\nInforme guardado en: {destino}")
