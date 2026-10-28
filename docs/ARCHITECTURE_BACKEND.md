# ARCHITECTURE_BACKEND — módulo nativo de contenedores

**Estado:** Fase 2 completa (2026-10-27). Rama `integracion-v25`.

## Capas (una sola dirección de dependencias)

```
routers/            (FastAPI: valida entrada, traduce errores, responde JSON)
   ↓
domain/servicios.py (casos de uso: decide, escribe, sube revisión)
   ↓
domain/reglas.py    (Python PURO: sin FastAPI, sin SQLAlchemy → testeable aislado)
   ↓
domain/reglas_conexion.json   (las reglas como DATOS versionados)
   ↓
models/             (SQLAlchemy: ftth_elementos, ftth_dispositivos, ftth_puertos,
                     ftth_empalmes, ftth_conexion_meta, ftth_operaciones…)
```

- **El frontend no guarda estado propio**: manda la acción y dibuja la respuesta.
- **El servidor es la autoridad**: el frontend solo lee `reglas_conexion.json`
  (vía `version_contrato_diagrama` + validaciones) para dar pistas visuales.
- El router **no decide nada**: si hay que rechazar algo, lo rechaza el servicio
  con `ErrorDominio` y `main.py` lo convierte en `{codigo, mensaje_es, detalle}`.

## Contrato de lectura

`GET /api/contenedores/{id}/diagrama?hilos_por_cable=48`

```json
{
  "version_contrato": 1,
  "revision": 7,
  "contenedor": {"id": 3, "categoria": "armario", ...},
  "bandejas": [...],
  "dispositivos": [...],
  "puertos": [...],
  "cables": [{"id": 7, "hilos_total": 96,
              "hilos": {"desde": 1, "hasta": 48, "total": 96, "items": [...]}}],
  "conexiones": [...],
  "origenes": [...],
  "posiciones": {"1": {"x": 40, "y": 40}}
}
```

**Número de consultas: 9 fijas** (1 contenedor + 5 lecturas + 3 de precarga de
cables), independiente de cuántos cables o hilos haya. Medido con el cable de 96
hilos: mismo conteo en el gabinete A y en el B (prueba `prueba_contenedores.py`).

## Comandos de escritura (Fase 2.7)

| Verbo | Ruta | Qué hace |
|---|---|---|
| POST | `/api/contenedores/{id}/dispositivos` | crea equipo + puertos (PON/SFP/RJ45/OUT/ODF) |
| PATCH | `/api/contenedores/{id}/dispositivos/{dispositivo_id}` | nombre, etiqueta, estado, pérdida, división, bandeja |
| POST | `/api/contenedores/{id}/dispositivos/{dispositivo_id}/mover` | cambia de contenedor (equipo + puertos + posición) |
| DELETE | `/api/contenedores/{id}/dispositivos/{dispositivo_id}` | **rechaza si tiene conexiones** |
| POST | `/api/contenedores/{id}/conexiones` | crea empalme validado por reglas |
| DELETE | `/api/contenedores/{id}/conexiones/{conexion_id}` | desconecta y libera el puerto |
| POST | `/api/contenedores/{id}/origen` | origen de señal + potencia TX |

Todos: **`operation_id`** (idempotencia) y **`base_revision`** (409 si cambió).

### Idempotencia (`ftth_operaciones`)

El orden es deliberado: **primero** se busca el `operation_id`; si existe, se
devuelve el `resultado` guardado (`idempotente: true`) **aunque la
`base_revision` ya esté vieja**. Solo después se comprueba la revisión. Esto se
descubrió con la prueba (el reintento devolvía 409 en vez del resultado).

### Revisión (`ftth_elementos.revision`)

Sube en cada escritura. El cliente manda `base_revision`; si no coincide →
**409** con `detalle.revision_vigente`, y el frontend debe recargar el diagrama.

## Errores de dominio

```json
{"codigo": "puerto_libre", "mensaje_es": "El puerto ya está conectado…", "detalle": "CABLE:7:HILO 4:"}
```

Códigos principales: `puerto_libre`, `combinacion_valida`, `rj45_solo_rj45`,
`pon_solo_subida`, `un_solo_origen`, `sin_lazos`, `dominios_no_se_mezclan`,
`splitter_conexiones`, `splitter_entrada_in`, `splitter_af_para_pon`,
`splitter_out_a_in`, `no_borrar_con_conexiones`, `conflicto`, `no_encontrado`.

## Migraciones

- Motor: **Alembic** (`backend/alembic.ini`, `backend/migrations/`).
- El DDL vive **solo** en `app/esquema.py`; las revisiones lo invocan.
- Cadena: `0001_columnas_cable` → `0002_revision` → `0003_operaciones` →
  `0004_conexion_meta`. Todas **aditivas** (R2).
- `0001` no revierte (columnas en uso desde el 23/09); `0002…0004` sí.
- Al arrancar, `app/main.py` ejecuta `alembic upgrade head` (sustituye a
  `asegurar_migraciones()`, ya eliminada).

```powershell
cd backend
python -m alembic upgrade head
python -m alembic current
python scripts\migrar.py revertir --pasos 2 --url sqlite:///./tests/copia_x.db   # solo copias
```

### Cómo añadir una migración

1. Escribe la función en `app/esquema.py` (`paso_N` y su reversa).
2. Crea `migrations/versions/000N_nombre.py` que la llame.
3. Aplícala en una **copia** y comprueba `upgrade → downgrade → upgrade`.
4. Nunca edites una revisión ya aplicada.

## Límites conocidos (declarados, no maquillados)

1. **Puerto ↔ puerto no representable**: `ftth_empalmes.fibra_a_id` es NOT NULL,
   así que hoy se rechaza con `puerto_a_puerto_pendiente`. El HTML sí permite
   OLT SFP → ODF cara A; se resolverá en la Fase 6 (cable/pigtail virtual).
2. **Sin detección completa de lazos**: `contexto()["cadena"]` va vacío; el ciclo
   se detecta en la Fase 3 con los vectores dorados.
3. **Capacidad en U** de los gabinetes no está modelada: mover siempre devuelve
   `excede: false` (no se inventa un valor).
4. **Endpoints antiguos intactos** (`/api/elementos/{id}/nodo`, `/dispositivos`,
   `/empalmes`…): los sigue usando el puente congelado y el diagrama viejo. Se
   migran en la Fase 5, cuando el puente se retire (R8).
5. `numpy`/`pandas` están instalados pero el backend no los importa.

## Pruebas

```powershell
cd backend
python scripts\crear_base_prueba.py                       # base sintética (R7)
$env:DATABASE_URL = "sqlite:///./tests/tachira_maps_test.db"
python scripts\prueba_contenedores.py                     # 21 comprobaciones
python scripts\prueba_nodo_snapshot.py                    # DTO de /nodo estable
python ..\verificar_todo.ps1                              # suite completa
```
