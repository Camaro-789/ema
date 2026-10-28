# INTEGRATION_AUDIT_2 — Hechos del código y del esquema

**Fecha:** 2026-10-27 · **Rama:** `integracion-v25` · **Base analizada:** `backend/tachira_maps.db`
(29 tablas), respaldo `tachira_maps_audit_backup_20261027_200643.db` (17 tablas) y
respaldo `backend/tachira_maps_respaldo_20260923_232613.db` (28 tablas).

Método: lectura del código + `PRAGMA table_info` y `sqlite_master` abiertos con
`mode=ro` (solo lectura). **No se modificó ninguna base.**

---

## (a) ¿Un armario es un elemento independiente o hay varios armarios dentro de un POP?

**Un armario ES un elemento independiente.** No existe ninguna tabla de "gabinetes
dentro de un POP".

- `ftth_elementos` con `categoria = 'armario'`; su plantilla es una fila de
  `ftth_tipos` (`categoria='armario'`) cuyo JSON `propiedades` trae `nivel`
  (`olt_hub`, `pop_secundario`), `prefijo`, colores.
- Lo que hay **dentro** del armario se cuelga de `ftth_elementos.id`:

  | Tabla | Qué guarda |
  |---|---|
  | `ftth_bandejas` | bandejas de empalme (`bandeja_no`, `tipo`, `slots`) |
  | `ftth_dispositivos` | OLT, ODF, splitters, switches (`tipo`, `tipo_id`, `division`, `puertos_*`, `atenuacion_db`) |
  | `ftth_puertos` | puertos IN/OUT/BIDI de cada dispositivo (con `elemento_id` denormalizado) |
  | `ftth_diagrama_posiciones` | x/y de cada dispositivo en el lienzo |
  | `ftth_empalmes` | fusiones/conexiones dentro del armario |
  | `propiedades_instancia` (JSON) | `codigo`, `lado_A`/`lado_B`, `cables_sangrados`… |

- **Cómo se relacionan dos armarios:** con un cable. Un cable es **un** elemento
  `categoria='cables'` cuyos `extremo_A_id` y `extremo_B_id` apuntan a cada armario.
  Verificado en la base sintética: `cable #7: A=#3 (armario) B=#4 (armario)`.
- En la base activa hay **3 armarios** (`#20`, `#21`, `#50`) y 2 cables anclados a
  postes (`#27: A=#23/B=#26`, `#47: A=#29/B=#46`).

**Consecuencia para el diseño:** "dos gabinetes" del HTML = **dos filas de
`ftth_elementos`**, unidas por un cable. El "rack 19″" con varios gabinetes en una
sola vista es una **vista** que compone varios contenedores; no requiere tabla nueva.
Si más adelante se quiere rack físico dentro del gabinete (U, altura), haría falta una
tabla aditiva (ver `ARCHITECTURE_CONTAINERS.md`, Fase 6).

---

## (b) `ftth_empalmes.tipo`: valores y cuándo se usa cada columna

`tipo` (VARCHAR 20, NOT NULL, default `paso`):

| Valor | Significado | Columnas que se llenan |
|---|---|---|
| `paso` | el cable **continúa**: el hilo que llega se fusiona con el que sigue (corte de paso) | `fibra_a_id` + `fibra_b_id` |
| `sangrado` | la fibra se **picó** para derivarla: queda abierta, disponible aguas abajo | `fibra_a_id` (y `fibra_b_id` = NULL) |
| `conector` | el hilo termina en un **puerto** de un dispositivo (ODF/splitter/OLT) | `fibra_a_id` + `puerto_id` |

- `fibra_a_id` es la mitad que **llega**; `fibra_b_id` la que **sale**. Cuál es cuál lo
  decide el usuario al marcar el lado (`extremo_a` / `extremo_b` = `entrada`|`salida`,
  que **no** son las letras A/B del cable).
- Restricción `UNIQUE(nodo_id, fibra_a_id)`: una fibra solo se empalma una vez por nodo.
- `propiedades` (JSON) guarda los `waypoints` del dibujo.
- Comprobado en la base sintética: los 3 tipos conviven (1 paso, 1 conector, 1 sangrado).

---

## (c) ¿Dónde se guarda hoy un "origen" de señal o una potencia TX?

**En ningún sitio.** No hay tabla ni columna de origen, dominio (ACCESO/ENLACE) ni
`tx_dbm`.

Lo más cercano que existe:

- `ftth_dispositivos.atenuacion_db` → pérdida del splitter en dB (dato del aparato).
- `ftth_elementos.propiedades_instancia` (JSON libre) → ahí viven `codigo`,
  `lado_A`/`lado_B` y `cables_sangrados`, no la señal.
- El HTML v25 calcula la potencia en memoria (`originTx`, `computeEnergy`) y solo
  persiste la **vista** en `localStorage.popDynView`; el origen se pierde al recargar.

⚠️ **No confundir** con lo que escribe el puente: `ftth_empalmes.propiedades =
{"origen": "pop_gestor_v25"}` significa "este registro lo creó el HTML v25"
(**procedencia**), no "aquí empieza la señal".

**Decisión (Fase 2.5):** se crea `ftth_conexion_meta` (aditiva) para
`origen_tipo`, `senal`, `tx_dbm`, `nota`. No hay nada que reutilizar, así que no se
toca ninguna tabla existente.

---

## (d) Columnas que altera `asegurar_migraciones()` y qué agregó realmente v25

`backend/app/database.py` → `asegurar_migraciones()` ejecuta `ALTER TABLE ADD COLUMN`
(con commit inmediato) solo si la columna falta:

| Tabla | Columnas que garantiza |
|---|---|
| `ftth_elementos` | `extremo_A_id`, `extremo_B_id`, `reserva_A_m`, `reserva_B_m` |
| `ftth_empalmes` | `puerto_id`, `propiedades`, `extremo_a`, `extremo_b` |

Cronología medida con `PRAGMA` (solo lectura):

| Comparación | Resultado |
|---|---|
| actual vs **respaldo 2026-09-23** | `ftth_elementos`: **+**`extremo_A_id`, `extremo_B_id`, `reserva_A_m`, `reserva_B_m`. `ftth_empalmes`: **la tabla no existía** |
| actual vs **respaldo 2026-10-27 20:06** | `ftth_elementos` **igual** · `ftth_empalmes` **igual** (13 columnas cada una) |

**Conclusión:** las 4 columnas del cable y la tabla `ftth_empalmes` son del trabajo de
la capa lógica (F2/F4, 23 sep – 5 oct). **La integración v25 no agregó ni una columna
ni una tabla**: solo escribe en columnas que ya existían (`ftth_dispositivos`,
`ftth_puertos`, `ftth_empalmes.propiedades`).

Consecuencia práctica: el **baseline de Alembic** (Fase 2.1) puede fotografiar el
esquema actual y `asegurar_migraciones()` puede retirarse sin perder nada.

> Nota: el respaldo del 27/10 tiene 17 tablas y la base activa 29; la diferencia son
> tablas heredadas de la primera versión (`cajas`, `postes`, `ductos`, `clientes`,
> `tipos_*`, `catalog_*`, `carpetas`, `carpeta_elementos`). No se tocan (R2).

---

## (e) Endpoints existentes para editar, mover y eliminar dispositivos / empalmes

| Verbo | Ruta | Qué hace | Reglas que aplica hoy |
|---|---|---|---|
| POST | `/api/elementos/{id}/dispositivos` | crea el dispositivo y **genera sus puertos** | exige contenedor que conmute (`CATEGORIAS_NODO`), división obligatoria en splitter |
| PATCH | `/api/elementos/{id}/dispositivos/{dispositivo_id}` | **solo** `serie` (etiqueta/anotación) | pertenencia al nodo |
| DELETE | `/api/elementos/{id}/dispositivos/{dispositivo_id}` | quita dispositivo, **sus puertos** y su posición | **no** comprueba conexiones (deja `puerto_id` huérfano en SQLite) |
| PUT | `/api/elementos/{id}/diagrama/posiciones` | guarda x/y del lienzo | valida pertenencia y tope de coordenada |
| DELETE | `/api/elementos/{id}/diagrama/posiciones` | restablece el orden | — |
| POST | `/api/elementos/{id}/bandejas` | crea bandeja (autonumerada) | 400 en postes, 409 duplicada |
| GET | `/api/elementos/{id}/puertos` | lista puertos | — |
| GET | `/api/elementos/{id}/nodo` | DTO del diagrama | — |
| POST | `/api/elementos/{id}/empalmes` | crea empalme manual | valida hilo↔hilo o hilo↔puerto |
| PUT | `/api/elementos/{id}/empalmes/{empalme_id}` | mueve slot / modifica | — |
| **DELETE** | `/api/elementos/{id}/empalmes/{empalme_id}` | **elimina el empalme y libera hilos/puerto** | existe y se usa |
| PUT | `/api/elementos/{id}/empalmes/fusiones` | sincroniza fusiones en bloque | — |
| PUT | `/api/elementos/{id}/cables/{cable_id}/dividir` | corta o sangra un cable en el nodo | — |
| GET | `/api/cables/{id}/hilos` | árbol tubo → hilo | — |
| POST | `/api/cables/{id}/materializar-hilos` | genera tubos/hilos (idempotente) | — |

**Lo que NO existe** (y por eso lo crea la Fase 2.7):
editar nombre/estado/ratio/pérdida de un dispositivo, **mover un dispositivo entre
contenedores**, y un `POST/DELETE /conexiones` con contrato propio (`operation_id`,
`base_revision`). Tampoco existe validar "no eliminar con conexiones".

---

## (f) Cómo se identifican hoy los extremos A y B y a qué contenedor pertenecen

Dos niveles complementarios:

1. **Por cable** — `ftth_elementos.extremo_A_id` / `extremo_B_id` (FK a
   `ftth_elementos`): a qué **contenedor** se ancla cada punta del cable. Es lo que usa
   `/nodo` para saber si el nodo es la punta A o la B
   (`letra_extremo = "A" if cable.extremo_A_id == elem_id else "B"`).
2. **Por hilo** — `ftth_fibra_extremos(fibra_id, extremo, nodo_id, holgura_m)` con
   `UNIQUE(fibra_id, extremo)`: dónde termina físicamente **cada hilo** en cada punta,
   con su holgura. El contenedor de ese extremo es `nodo_id`.

Complementos:

- `ftth_elementos.propiedades_instancia.lado_A` / `lado_B` = `entrada`|`salida`
  (**decisión visual** del usuario por punta), leída por `_lado_guardado()`.
- `ftth_empalmes.extremo_a` / `extremo_b` repiten ese lado en la conexión.
- El puente v25 usa `fiber.extremo` para escribir `extremo_a`/`extremo_b` al crear
  empalmes → coherente con lo anterior.

---

## Decisiones que se derivan de esta auditoría

1. **Contenedor = `ftth_elementos`**, sin tabla nueva de gabinetes; el módulo nativo
   se escribe para "contenedor" y solo se **habilita** armario/POP en esta entrega.
2. **Baseline de Alembic** = esquema actual (incluye las columnas que agregó
   `asegurar_migraciones()`; se retira la función y se documentan en la migración).
3. **Origen/potencia** requiere tabla aditiva nueva (`ftth_conexion_meta`), porque hoy
   no se guarda nada.
4. **Bajas**: la regla "no eliminar equipo ni cable con conexiones" hay que
   implementarla (hoy `DELETE /dispositivos` no la aplica).
5. **Mover entre gabinetes** no existe: la Fase 2.7 lo crea como cambio de
   `ftth_dispositivos.elemento_id` (+ `ftth_puertos.elemento_id`, denormalizado).

