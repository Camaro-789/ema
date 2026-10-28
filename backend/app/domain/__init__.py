"""Capa de dominio del módulo nativo de contenedores (Fase 2.2).

- `reglas`    → validador ÚNICO de conexiones. Python puro: no importa FastAPI
                ni SQLAlchemy, así que se puede probar (y usar) en cualquier sitio.
- `servicios` → casos de uso de escritura. Usa SQLAlchemy, nunca FastAPI.
- `errores`   → errores de negocio con mensaje en español y status sugerido.
- `reglas_conexion.json` → las reglas como DATOS versionados (`version`).

La fuente de verdad de las reglas es `frontend/pop_gestor_v25.html`; cualquier
diferencia se corrige aquí, nunca allí (R1).
"""

__all__ = ["reglas", "servicios", "errores"]
