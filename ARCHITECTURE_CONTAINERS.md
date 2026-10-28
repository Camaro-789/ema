# ARCHITECTURE_CONTAINERS — generalizar el módulo a cajas, mangas y postes

**Estado:** diseño (Fase 6). No implementado todavía. Todo lo que sigue es
**aditivo** (R2): tablas o columnas nuevas, nunca DROP ni renombrados.

## 1. La idea: todo es un contenedor

El módulo nativo ya está escrito para "contenedor" (`app/domain/servicios.py` usa
`CATEGORIAS_CONTENEDOR` y no conoce la palabra "armario"). Para habilitar caja,
manga y poste solo cambia **qué categorías se aceptan** y **qué plantilla visual**
se usa; los comandos (`POST dispositivo`, `mover`, `conectar`, `origen`,
`posiciones`) son los mismos.

| Contenedor | Categoría | Qué aloja | Reglas propias |
|---|---|---|---|
| Armario / POP | `armario` | OLT, ODF, splitters, switches | ya habilitado |
| Caja NAP | `cajanap` | splitters, adaptadores, pigtails | splitter **OUT → hilo de cliente** |
| Manga | `manga` | solo fusiones (bandejas) | no aloja equipos activos |
| Poste | `poste` | **nada**: sostiene | no conmuta hilos (ya da 400) |

Cambio mínimo: `POP_NATIVO_CATEGORIAS = ("armario",)` → añadir `"cajanap"` y
`"manga"`. El interruptor por categoría evita sorpresas (R5).

## 2. Identificador global de extremo

Hoy cada conexión vive dentro de un contenedor. Para trazar entre contenedores
hace falta un identificador único y estable:

```
owner:cara:puerto
```

- **owner** — dueño del extremo:
  - `eq:<dispositivo_id>` → puerto de un equipo (OLT/ODF/splitter/switch);
  - `hilo:<fibra_id>` → extremo de hilo de cable;
  - `ont:<cliente_id>` → terminal de cliente (futuro).
- **cara** — `A` | `B` para ODF y para los dos extremos de un cable; vacío si no aplica.
- **puerto** — `PON 1`, `OUT 3`, `ODF-07`, `HILO 12`.

| Extremo | Identificador |
|---|---|
| PON 1 de la OLT #4 | `eq:4::PON 1` |
| Cara B del ODF #2, puerto 7 | `eq:2:B:ODF-07` |
| Hilo 12 del cable #7, punta A | `hilo:312:A` |
| ONT del cliente #88 | `ont:88::` |

En Python ya existe el equivalente parcial (`reglas.clave()`); la generalización
es añadir la cara al identificador de hilo y el prefijo `ont:`.

## 3. Cable con extremos en contenedores distintos

Ya funciona: `ftth_elementos.extremo_A_id` / `extremo_B_id` apuntan a **cualquier**
elemento (hoy armario, poste o caja), y `ftth_fibra_extremos.nodo_id` dice dónde
termina **cada hilo**. Para cajas y mangas no hay cambio de esquema.

Falta en la **lectura**: el contrato del diagrama debería poder devolver "este hilo
continúa en el contenedor X". Propuesta (calculada, sin columnas nuevas) — añadir a
cada hilo del DTO:

```json
"continuacion": {"contenedor_id": 26, "extremo": "B", "fibra_id": 318}
```

## 4. Fusión hilo ↔ hilo (`ftth_empalmes`)

Sin cambios de esquema: `tipo='paso'` con `fibra_a_id` y `fibra_b_id` **es** la
fusión de una manga. Reglas a añadir en `reglas_conexion.json`:

- `manga` **solo** admite `paso` y `sangrado` (nunca `conector`);
- una fusión no puede unir dos hilos del **mismo** cable ni del mismo tubo;
- la holgura (`ftth_fibra_extremos.holgura_m`) debe ser ≥ 0,6 m para fusionar.

## 5. Splitter OUT → hilo (la brecha del HTML)

El HTML solo permite llegar al `IN`; en una caja el `OUT` va al hilo del cliente.
Ya está previsto como **extensión** (`reglas_extension` → `extension_v26`) y el
validador la marca con `extension: true`. Para activarla por categoría:

```json
"splitter_out_a_hilo": {"aplica_a": ["cajanap", "manga", "armario"]}
```

y en `servicios.conectar()` pasar `permitir_extension=True` cuando el contenedor sea
caja. **Nada de esquema nuevo**: el empalme es `tipo='conector'` con
`fibra_a_id` = hilo del cable y `puerto_id` = OUT del splitter.

## 6. Terminal de cliente / ONT

Hoy no existe. Propuesta **aditiva**:

| Tabla nueva | Columnas | Por qué |
|---|---|---|
| `ftth_clientes` | `id`, `proyecto_id`, `codigo`, `nombre`, `direccion`, `lat`, `lon`, `estado` | el cliente es un dato de negocio, no un elemento del mapa |
| `ftth_onts` | `id`, `cliente_id`, `serie`, `puerto_id` (FK a `ftth_puertos`), `potencia_rx_dbm`, `estado` | el terminal se conecta a un puerto del splitter |

La ONT **no** es un contenedor: es un extremo (`ont:<cliente_id>::`) que se une al
`OUT` del splitter con un empalme `conector`; su potencia medida cabe en
`ftth_conexion_meta` (`tx_dbm` ya existe).

## 7. Rutas de señal que atraviesan varios contenedores

Hoy `servicios.contexto()` solo mira las conexiones del contenedor abierto. Para
trazar de punta a punta (OLT → ODF → splitter → caja → ONT) hace falta un
**recorrido global**:

1. Empezar en el origen (`ftth_conexion_meta` con `origen_tipo` PON/SFP).
2. Seguir el empalme del puerto → hilo del cable.
3. Saltar al **otro extremo** del hilo (`ftth_fibra_extremos` con el extremo
   contrario) y a su contenedor (`nodo_id`).
4. Repetir dentro de ese contenedor hasta un `OUT` de splitter o una ONT.
5. Devolver los tramos con su atenuación acumulada.

Ese recorrido alimenta la **linterna** y la tabla de potencias. Se puede implementar
**sin esquema nuevo**, con 3 consultas por salto (fibra, extremos, empalmes) y caché
por contenedor.

## 8. Cambios de esquema propuestos (todos aditivos)

| Cambio | Tipo | Para qué |
|---|---|---|
| `ftth_elementos.capacidad_u` (INTEGER NULL) | columna | mover entre gabinetes y marcar «EXCEDE» de verdad (hoy `excede` siempre `false`) |
| `ftth_dispositivos.tamano_u` (INTEGER DEFAULT 1) | columna | ocupación en U del rack |
| `ftth_clientes`, `ftth_onts` | tablas | terminal de cliente |
| `ftth_conexion_meta.cliente_id` (FK NULL) | columna | origen en una ONT |
| índice `(elemento_id, direccion, estado)` en `ftth_puertos` | índice | buscar puertos libres en cajas grandes |

Nada de esto borra ni renombra lo existente; serían migraciones `0005…0009` con su
reversa.

## 9. Orden recomendado

1. `POP_NATIVO_CATEGORIAS` + plantilla visual por categoría (caja/manga/poste).
2. Recorrido global de señal (sección 7) → linterna y potencias reales.
3. `capacidad_u` / `tamano_u` + regla «EXCEDE» (sección 8).
4. Extensión `OUT → hilo` activada en cajas (sección 5).
5. `ftth_clientes` / `ftth_onts` (sección 6) y cierre de la traza en la ONT.

