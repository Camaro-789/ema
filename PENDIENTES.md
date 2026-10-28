# PENDIENTES

Registro vivo de lo que quedó abierto, de lo que se intentó y falló, y de lo que
falta para cerrar cada fase. **Nada se declara cerrado aquí sin evidencia.**

---

## Heredado del estado inicial (no lo introdujo este proyecto)

### P-001 · `frontend/scripts/prueba_reglas_cable.js` falla (3 comprobaciones)

- **Qué prueba**: el dibujo de hilos del cable (plantilla `plantillas-visuales/fibra.js`).
- **Fallo**: `DROP 1 hilo: se rotula sin buffer`, `DROP 4 hilos: se rotula sin buffer`,
  `En la SALIDA el hilo 1 se dibuja ABAJO (orden invertido para cuadrar la fusión)`.
- **Cuándo aparece**: ya estaba antes de la rama `integracion-v25`.
- **Evidencia**: se creó un `git worktree` en el commit base `0f7fdb4` y se ejecutó
  la misma prueba allí → **exit=1 con los mismos 3 fallos**
  (`RESULTADO: 105 comprobaciones OK, 3 fallos`).
- **Por qué no se revierte**: no lo rompió ningún commit de este proyecto, así que
  R9 (revertir el commit culpable) no aplica. Revertir `0f7fdb4` borraría trabajo
  del usuario sin relación con el fallo.
- **Cómo reproducirlo**:

  ```powershell
  cd d:\Desktop\VS\ema\frontend
  node scripts\prueba_reglas_cable.js
  ```

- **Qué falta**: decidir si el rótulo del hilo en el DROP debe llevar buffer y si el
  orden en la SALIDA se invierte (hoy la prueba espera lo contrario de lo que dibuja).

---

## Fase 1 · Seguridad y medición

| # | Estado | Detalle |
|---|---|---|
| 1.1 Git | hecho | Git 2.53.0.windows.4 portable (sin admin) en `C:\Users\<usuario>\PortableGit`; repo preexistente con remote `github.com/Camaro-789/ema`; baseline `0f7fdb4`; rama `integracion-v25` |
| 1.2 Respaldo | hecho | `D:\Backups\MapOLT\proyecto_20261027_2056` (500 archivos) + `db\tachira_maps_20261027_2056.db` |
| 1.3 Entorno | hecho | `backend/requirements.txt` con versiones reales + `docs/ENTORNO.md` |
| 1.4 Interruptor | hecho | `POP_V25_ENABLED` (backend `app/config.py`, frontend `js/ftth-flags.js`) |
| 1.5 `/nodo` | hecho | N+1 eliminado; DTO idéntico (snapshot) |
| 1.6 Auditoría | hecho | `INTEGRATION_AUDIT_2.md` |

### P-002 · El repositorio ya tenía la base real versionada

- **Qué pasaba**: `backend/tachira_maps.db` estaba trackeado (datos reales en git).
- **Arreglo**: commit `c8bda7a` → `git rm --cached` (el archivo **sigue en disco**),
  más `*.db` en `.gitignore`. No se borró ningún dato.
- **Falta**: el histórico remoto conserva las versiones antiguas del `.db`. Limpiarlo
  exigiría reescribir historia (no se hizo: R2 prohíbe tocar datos y R4 pide commits
  pequeños y reversibles).

### P-003 · El `.venv` del proyecto está vacío

- Se trabaja con el Python 3.14.3 del sistema. Documentado en `docs/ENTORNO.md`.
- **Falta**: decidir si se crea un venv propio para aislar el proyecto (Fase 2.1 lo
  agradecerá, porque Alembic y pytest aún no están instalados).

### P-004 · `alembic`, `pytest` y `playwright` no están instalados

- Necesarios en Fase 2.1 (Alembic), 2.2-3.4 (pytest) y 3.2/4.3 (Playwright).
- Se instalarán sin administrador (`pip --user` o venv) cuando empiece la fase.

---

## Fase 2 · Fundación del backend — **completa**

| # | Estado | Evidencia |
|---|---|---|
| 2.1 Alembic | hecho | `0001`–`0004`; sobre una **copia** del `.db`: `upgrade head` → `downgrade -2` → `upgrade head`, con las mismas filas (33/24/0/5/66). PostgreSQL: **no probado** (Docker no disponible, ver P-005) |
| 2.2 Dominio | hecho | `app/domain/{reglas,servicios,errores}.py`; reglas puras (sin FastAPI/SQLAlchemy) |
| 2.3 Idempotencia | hecho | `ftth_operaciones` + orden correcto (idempotencia **antes** de revisión) probado |
| 2.4 Revisión | hecho | `ftth_elementos.revision`; 409 con `revision_vigente` probado |
| 2.5 Origen/TX | hecho | `ftth_conexion_meta`; PON → ACCESO, TX 3.0 dBm probado |
| 2.6 Contrato | hecho | `GET /api/contenedores/{id}/diagrama` con **9 consultas fijas** y paginación de hilos |
| 2.7 Comandos | hecho | 7 endpoints con `operation_id` + `base_revision`; 21 comprobaciones en verde |

### P-005 · PostgreSQL / Docker no probado

- `docker-compose.yml` ya trae `postgis/postgis:15-3.3` y `DATABASE_URL` por
  variable de entorno; el DDL es dialect-aware (`SERIAL` en PostgreSQL,
  `AUTOINCREMENT` en SQLite) y las migraciones no usan nada específico de SQLite.
- **No se ejecutó**: en este equipo no hay Docker disponible en la sesión. Queda
  pendiente de probar en un entorno con Docker.

### P-006 · Bugs encontrados y corregidos durante la Fase 2

1. La idempotencia se comprobaba **después** de la revisión → un reintento con
   el mismo `operation_id` devolvía 409 en vez del resultado guardado.
2. `mover_dispositivo` hacía `float(None)` cuando no se enviaba posición.
3. `marcar_origen` pasaba el **tipo de puerto** (PON) al validador, que clasifica
   por **tipo de equipo** (OLT) → rechazaba orígenes válidos.
4. `meta.origen_tipo` guardaba el tipo de equipo en vez del tipo de puerto, así
   que la TX por defecto salía 0 en lugar de 3.0 dBm.

Los cuatro los detectó `prueba_contenedores.py`; los tres últimos se corrigieron
antes de dar la fase por cerrada.

### P-007 · Lo que falta para cerrar del todo el backend

- **Puerto ↔ puerto** (OLT SFP → ODF cara A) no es representable hoy: se
  rechaza con `puerto_a_puerto_pendiente` hasta la Fase 6.
- **Detección de lazos completa** (`contexto["cadena"]`) → Fase 3.
- **Capacidad en U** de los gabinetes sin modelar → `excede` siempre `false`.
- Los endpoints antiguos siguen vivos (los usa el puente congelado): se migran
  en la Fase 5 (R8).


## Fase 3 · Reglas de conexión

_(pendiente de empezar)_

## Fase 4 · Módulo nativo de frontend

_(pendiente de empezar)_

## Fase 5 · Retiro del puente

_(pendiente: el puente sigue CONGELADO y encendido; ver R8)_
