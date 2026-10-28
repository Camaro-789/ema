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


## Fase 3 · Reglas de conexión — **3.1, 3.2 y 3.4 completas; 3.3 pendiente**

| # | Estado | Evidencia |
|---|---|---|
| 3.1 Validador único | hecho | `app/domain/reglas.py`; lo usan `conectar` y `marcar_origen` |
| 3.2 Vectores dorados | hecho | **540 vectores** desde el HTML con Playwright (Edge) → `tests/vectores_reglas.json`; **545 passed** |
| 3.3 Energía | **pendiente** | ver P-008 |
| 3.4 Integridad | hecho | idempotencia, 409 de revisión, no borrar con conexiones y **dos escrituras simultáneas** (una gana) |

### P-008 · Fase 3.3: comparación de energía (dB) HTML ↔ Python

- **Qué falta**: recorrer la cadena en Python (OLT PON → splitter IN → OUT → ODF
  A/B → switch SFP) y comparar con `computeEnergy()` del HTML, tolerancia 0.01 dB.
- **Dónde**: `app/domain/reglas.py` (nuevo `recorrer_energia`) +
  `tests/herramientas/calcular_energia_html.py` + `tests/test_energia.py`.
- **Constantes ya disponibles** en `reglas_conexion.json`: conector 0.3 dB,
  empalme 0.1 dB, ODF 0.1 dB, splitter 3.7/7.3/10.7/14.0/17.5/21.0 dB y
  0.35 dB/km de fibra.
- **Por qué no se hizo**: se priorizó dejar en verde la validación de reglas
  (3.1/3.2) y la integridad (3.4), que son la base de las fases 4-5.

### P-009 · Reglas que dependen del grafo de la cadena

- Los vectores describen **dos extremos**; las reglas que necesitan la cadena
  completa (lazos y "ya existe un origen") no se pueden expresar así. La prueba las
  marca `xfail` con motivo (hoy: **0 casos**), y la detección real de lazos
  (`contexto["cadena"]`) sigue pendiente de implementar en `servicios.contexto()`.


## Fase 4 · Módulo nativo de frontend — **núcleo hecho; paridad parcial**

| # | Estado | Evidencia |
|---|---|---|
| Módulos ES (`frontend/js/pop/`) | hecho | `api · store · reglas · vista-rack · vista-papel · vista-matriz · trazabilidad · linterna · entrada`; **9/9 con `node --check` OK** |
| CSS propio | hecho | `frontend/css/pop-diagrama.css` (identidad del HTML: blanco/negro, bordes duros, ámbar) |
| 4.1 Acciones → API → dibujar respuesta | hecho | `store.ejecutar()` recarga siempre; 409 recarga y avisa; error muestra `mensaje_es` |
| 4.2 `?plantilla=1` | hecho | botón PLANTILLA abre el HTML en pestaña aparte |
| 4.3 Pruebas Playwright | **parcial** | `tests/herramientas/prueba_pop_playwright.py` → **11 comprobaciones OK** (módulo carga, abre con 96 hilos en 670 ms, rack/papel/matriz, conexión inválida con mensaje del servidor, persistencia al recargar). **Falta**: crear equipo, editar, mover y pulso (los cubre pytest en backend) |
| 4.4 Tabla de paridad | hecha | `docs/PARIDAD.md` (sin capturas, ver P-010) |

### P-010 · Capturas lado a lado de la paridad

- `docs/PARIDAD.md` describe el estado función por función, pero **no hay capturas**
  comparando HTML ↔ módulo nativo. Se pueden generar con `page.screenshot()` en
  `prueba_pop_playwright.py` (carpeta `docs/paridad/`).

### P-011 · Pendientes de interfaz (no bloquean la Fase 5)

1. **Mover equipo entre gabinetes** desde la UI (la API `POST …/mover` ya está
   probada en pytest).
2. **Tarjetas colapsables** y los iconos ✎ ⇄ ✕ **en el banner** de la matriz
   (hoy están por fila).
3. **Origen de señal / TX** en pantalla (la API `POST …/origen` existe).
4. **Botones L/R y ventana flotante** de la linterna.
5. **Culling por fila de hilo** (hoy se virtualizan las tarjetas, no las filas).


## Fase 5 · Retiro del puente — **5.1 y 5.2 hechas; 5.3 NO se cumple (puente conservado)**

| # | Estado | Evidencia |
|---|---|---|
| 5.1 Armario → módulo nativo, por interruptor | hecho | `POP_NATIVO_EN_ARMARIO` (por defecto **encendido**); `ftth-pop-papel.js` deriva al módulo antes del iframe. Verificado: *«el armario abre el módulo nativo (sin iframe del puente)»* |
| 5.2 Lo guardado por el puente se ve igual | hecho | `test_lo_guardado_por_el_puente_se_ve_igual`: un empalme con `propiedades.origen='pop_gestor_v25'` se lee en `/api/contenedores/{id}/diagrama` con sus propiedades intactas, y una escritura nativa no lo toca |
| 5.3 Borrar el puente | **NO** | no se cumple la condición: faltan filas esenciales de paridad (P-011) |

**Consecuencia (lo que pide el prompt):** el puente queda **APAGADO por interruptor y
SIN borrar**. Sigue en el repositorio y se puede reactivar con
`POP_NATIVO_EN_ARMARIO=0` (vuelve el iframe) sin tocar código.

**Qué falta para poder borrarlo (5.3):**
1. Mover equipo entre gabinetes **desde la UI** (la API está probada).
2. Matriz con tarjetas colapsables e iconos ✎ ⇄ ✕ **en el banner**.
3. Origen de señal / TX en pantalla.
4. Botones L/R y ventana flotante de la linterna.
5. Capturas de paridad (P-010) y la Fase 3.3 (energía) —requisito de pruebas—.

Cuando todo eso esté en «hecho» y pytest + Playwright sigan en verde, se crea el
tag `respaldo-antes-de-retirar-puente` y se borran `pop-v25-mapolt-bridge.js`, el
iframe y sus listeners en commits separados (reversibles con `git revert`).

## Fase 6 · Preparación para cajas, mangas y postes — **diseño hecho**

- `ARCHITECTURE_CONTAINERS.md` escrito: identificador global de extremo
  (`owner:cara:puerto`), cable con extremos en contenedores distintos, fusión
  hilo↔hilo, extensión `splitter OUT → hilo`, terminal de cliente/ONT, recorrido de
  señal entre contenedores y los cambios de esquema **aditivos** que harían falta
  (`capacidad_u`, `tamano_u`, `ftth_clientes`, `ftth_onts`, `cliente_id`, un índice).
- **No se implementó** (la fase es solo diseño, tal como pide el prompt).

