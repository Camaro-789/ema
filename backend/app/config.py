"""Interruptores del proyecto de integracion del diagrama POP (Fase 1.4).

`POP_V25_ENABLED`
  Encendido (por defecto) → Map OLT muestra el acceso al diagrama tal como hoy.
  Apagado (`POP_V25_ENABLED=0`) → se oculta TODO acceso al diagrama (menú
  contextual, botón "Abrir Diagrama" y doble clic). El resto del mapa (postes,
  capas, catálogo de tipos, fusiones, cajas) no cambia.

Nota (R8): los endpoints de lectura (`/api/elementos/{id}/nodo`) siguen
respondiendo con la bandera apagada, porque el puente congelado los usa hasta
la Fase 5. La bandera controla el acceso desde la interfaz, no el dato.
"""
import os

_VERDADEROS = {"1", "true", "yes", "si", "sí", "on", "enabled"}
_FALSOS = {"0", "false", "no", "off", "disabled"}


def bandera(nombre: str, por_defecto: bool = True) -> bool:
    """Lee una variable de entorno booleana (sin dependencias externas)."""
    valor = (os.getenv(nombre) or "").strip().lower()
    if not valor:
        return por_defecto
    if valor in _VERDADEROS:
        return True
    if valor in _FALSOS:
        return False
    return por_defecto


POP_V25_ENABLED = bandera("POP_V25_ENABLED", True)

# Fase 5.1: el armario abre el MÓDULO NATIVO. Apagado vuelve al puente congelado
# (que sigue en el código, sin borrar, hasta que la paridad esté completa).
POP_NATIVO_EN_ARMARIO = bandera("POP_NATIVO_EN_ARMARIO", True)

# Version del contrato de lectura del diagrama (GET /api/contenedores/{id}/diagrama).
VERSION_CONTRATO_DIAGRAMA = 1
