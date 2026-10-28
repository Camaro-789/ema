"""
prueba_plantilla_v25.py — La plantilla visual NO se toca (regla R1).

`frontend/pop_gestor_v25.html` es la referencia visual y de comportamiento del
módulo nativo. Se lee, nunca se edita. Esta prueba falla si cambia un solo byte.

Uso (desde backend/):
    python scripts/prueba_plantilla_v25.py

Salida: código 0 si el SHA256 coincide; 1 si cambió (y explica qué hacer).
"""
import hashlib
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

SHA256_ESPERADO = "4B16000E4AF79CC04405800F9D6F67CF3DCD6BBC678EDE29C9BE2DC0D0939706"

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANTILLA = os.path.join(os.path.dirname(BASE), "frontend", "pop_gestor_v25.html")


def sha256(ruta: str) -> str:
    digest = hashlib.sha256()
    with open(ruta, "rb") as archivo:
        for bloque in iter(lambda: archivo.read(65536), b""):
            digest.update(bloque)
    return digest.hexdigest().upper()


def main() -> int:
    print("Plantilla visual v25 (R1)")
    print(f"  archivo : {PLANTILLA}")
    if not os.path.exists(PLANTILLA):
        print("  [FALLO] la plantilla no existe.")
        print("          Restaurala desde git:  git checkout -- frontend/pop_gestor_v25.html")
        return 1

    actual = sha256(PLANTILLA)
    print(f"  sha256  : {actual}")
    print(f"  esperado: {SHA256_ESPERADO}")
    if actual != SHA256_ESPERADO:
        print("  [FALLO] la plantilla CAMBIÓ. Es de solo lectura (R1).")
        print("          Reviértela:  git checkout -- frontend/pop_gestor_v25.html")
        print("          Si el cambio fuera intencional, actualiza SHA256_ESPERADO")
        print("          en este script y documéntalo (nunca al revés).")
        return 1

    bytes_totales = os.path.getsize(PLANTILLA)
    print(f"  [OK]    intacta ({bytes_totales} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
