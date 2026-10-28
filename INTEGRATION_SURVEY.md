# Informe de reconocimiento para integración del diagrama de fibra

Fecha de reconocimiento: 2026-10-27.  
Alcance: inspección estática del código y lectura de SQLite. No se modificaron
código ni datos.

## 1. Base de datos

### Hallazgo principal: no existe un `pg_dump --schema-only` ejecutable para la
base poblada

La aplicación tiene soporte/configuración para PostgreSQL (`psycopg2-binary` y
`docker-compose.yml` con `postgis/postgis:15-3.3`), pero
[`backend/app/database.py`](backend/app/database.py) usa por defecto
`sqlite:///./tachira_maps.db`. Las bases inspeccionadas (`backend/tachira_maps.db`
y sus respaldos) son SQLite. Por tanto, **no existe una salida real de
`pg_dump --schema-only`** que pegar; no se inventa una. El siguiente DDL es la
salida equivalente de `sqlite_master` de las tablas relevantes, y refleja el
esquema real de SQLite. Ninguna tabla usa PostGIS: no hay columnas `geometry` o
`geography`; las coordenadas son `FLOAT` y los trazados son JSON.

### Tablas de objetos del mapa y lógica de fibra

```sql
CREATE TABLE map_projects (
  id INTEGER PRIMARY KEY,
  name VARCHAR(255), description VARCHAR(1024),
  center_lat FLOAT, center_lon FLOAT, zoom INTEGER,
  layers JSON, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ftth_tipos (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  categoria VARCHAR(50) NOT NULL, nombre_id VARCHAR(100) NOT NULL,
  color_mapa VARCHAR(20), foto TEXT, observaciones TEXT,
  propiedades JSON NOT NULL
);

CREATE TABLE ftth_elementos (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  tipo_id INTEGER NOT NULL REFERENCES ftth_tipos(id) ON DELETE CASCADE,
  categoria VARCHAR(50) NOT NULL, lat FLOAT, lon FLOAT, coords_json JSON,
  poste_ref_id INTEGER REFERENCES ftth_elementos(id) ON DELETE SET NULL,
  propiedades_instancia JSON NOT NULL,
  extremo_A_id INTEGER REFERENCES ftth_elementos(id) ON DELETE SET NULL,
  extremo_B_id INTEGER REFERENCES ftth_elementos(id) ON DELETE SET NULL,
  reserva_A_m FLOAT DEFAULT 0, reserva_B_m FLOAT DEFAULT 0
);

CREATE TABLE ftth_cable_tubos (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  elemento_id INTEGER NOT NULL REFERENCES ftth_elementos(id) ON DELETE CASCADE,
  tubo_no INTEGER NOT NULL, color VARCHAR(20), color_hex VARCHAR(9),
  capacidad_fibras INTEGER, etiqueta VARCHAR(100),
  UNIQUE (elemento_id, tubo_no)
);

CREATE TABLE ftth_cable_fibras (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  elemento_id INTEGER NOT NULL REFERENCES ftth_elementos(id) ON DELETE CASCADE,
  tubo_id INTEGER NOT NULL REFERENCES ftth_cable_tubos(id) ON DELETE CASCADE,
  hilo_no_en_tubo INTEGER NOT NULL, hilo_global_no INTEGER NOT NULL,
  color VARCHAR(20), color_hex VARCHAR(9), estado VARCHAR(20) NOT NULL,
  perfil VARCHAR(30), UNIQUE (tubo_id, hilo_no_en_tubo),
  UNIQUE (elemento_id, hilo_global_no)
);

CREATE TABLE ftth_fibra_extremos (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  fibra_id INTEGER NOT NULL REFERENCES ftth_cable_fibras(id) ON DELETE CASCADE,
  extremo VARCHAR(1) NOT NULL, nodo_id INTEGER REFERENCES ftth_elementos(id)
    ON DELETE SET NULL, holgura_m FLOAT,
  UNIQUE (fibra_id, extremo)
);

CREATE TABLE ftth_bandejas (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  elemento_id INTEGER NOT NULL REFERENCES ftth_elementos(id) ON DELETE CASCADE,
  bandeja_no INTEGER NOT NULL, tipo VARCHAR(20) NOT NULL, slots INTEGER,
  etiqueta VARCHAR(100), UNIQUE (elemento_id, bandeja_no)
);

CREATE TABLE ftth_dispositivos (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  elemento_id INTEGER NOT NULL REFERENCES ftth_elementos(id) ON DELETE CASCADE,
  bandeja_id INTEGER REFERENCES ftth_bandejas(id) ON DELETE SET NULL,
  tipo_id INTEGER REFERENCES ftth_tipos(id) ON DELETE SET NULL,
  tipo VARCHAR(30) NOT NULL, serie VARCHAR(100), division VARCHAR(20),
  puertos_in INTEGER, puertos_out INTEGER, atenuacion_db FLOAT,
  estado VARCHAR(20) NOT NULL
);

CREATE TABLE ftth_puertos (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  dispositivo_id INTEGER NOT NULL REFERENCES ftth_dispositivos(id) ON DELETE CASCADE,
  elemento_id INTEGER NOT NULL REFERENCES ftth_elementos(id) ON DELETE CASCADE,
  direccion VARCHAR(4) NOT NULL, puerto_no INTEGER NOT NULL,
  tipo_conector VARCHAR(20), estado VARCHAR(20) NOT NULL, etiqueta VARCHAR(100),
  UNIQUE (dispositivo_id, direccion, puerto_no)
);

CREATE TABLE ftth_empalmes (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  nodo_id INTEGER NOT NULL REFERENCES ftth_elementos(id) ON DELETE CASCADE,
  bandeja_id INTEGER REFERENCES ftth_bandejas(id) ON DELETE SET NULL,
  slot INTEGER, fibra_a_id INTEGER NOT NULL REFERENCES ftth_cable_fibras(id)
    ON DELETE CASCADE, fibra_b_id INTEGER REFERENCES ftth_cable_fibras(id)
    ON DELETE CASCADE, tipo VARCHAR(20) NOT NULL, etiqueta VARCHAR(100),
  puerto_id INTEGER REFERENCES ftth_puertos(id) ON DELETE SET NULL,
  propiedades JSON, extremo_a VARCHAR(10) NOT NULL DEFAULT 'entrada',
  extremo_b VARCHAR(10) NOT NULL DEFAULT 'salida',
  UNIQUE (nodo_id, fibra_a_id)
);

CREATE TABLE ftth_diagrama_posiciones (
  id INTEGER PRIMARY KEY,
  proyecto_id INTEGER NOT NULL REFERENCES map_projects(id) ON DELETE CASCADE,
  elemento_id INTEGER NOT NULL REFERENCES ftth_elementos(id) ON DELETE CASCADE,
  dispositivo_id INTEGER NOT NULL REFERENCES ftth_dispositivos(id) ON DELETE CASCADE,
  x FLOAT NOT NULL, y FLOAT NOT NULL, UNIQUE (dispositivo_id)
);
```

Qué representa cada tabla:

| Tabla | Representación | Claves foráneas | PostGIS |
|---|---|---|---|
| `map_projects` | Proyecto/mapa y centro de vista | ninguna | No |
| `ftth_tipos` | Plantilla/catálogo por proyecto y categoría | `proyecto_id` | No |
| `ftth_elementos` | Instancia de poste, caja, manga, cable, ODF, OLT, armario, splitter, etc. | proyecto, tipo, `poste_ref_id`, extremos A/B | No |
| `ftth_cable_tubos` | Tubos/buffers materializados de un cable | proyecto, cable | No |
| `ftth_cable_fibras` | Hilos individuales y estado | proyecto, cable, tubo | No |
| `ftth_fibra_extremos` | Anclaje A/B de cada hilo a un nodo y holgura | proyecto, hilo, nodo | No |
| `ftth_bandejas` | Bandejas dentro de un nodo | proyecto, elemento | No |
| `ftth_dispositivos` | Splitter, adaptador, WDM, pigtail, switch, ODF o fusión dentro de un nodo | proyecto, elemento, bandeja, tipo | No |
| `ftth_puertos` | Puertos IN/OUT/BIDI de un dispositivo | proyecto, dispositivo, elemento | No |
| `ftth_empalmes` | Continuidad hilo-hilo o hilo-puerto en un nodo | proyecto, nodo, bandeja, fibras, puerto | No |
| `ftth_diagrama_posiciones` | Posición visual x/y del dispositivo en el lienzo | proyecto, elemento, dispositivo | No |

También permanecen tablas heredadas `postes`, `cajas`, `tipos_poste`,
`tipos_caja`, `ductos`, `clientes`, `catalog_categorias` y `catalog_tipos`.
`mangas`, `cables`, `splitters`, `pops`, `olts`, `odfs`, `switches` y `tipos`
como tablas independientes **no existen**. El código FTTH unificado sustituyó
esas entidades por `ftth_elementos`/`ftth_tipos`.

## 2. Cables

Un cable es un `ftth_elementos` con `categoria = "cables"`.

- **Geometría:** `coords_json`, un arreglo JSON de pares `[lon, lat]` que el
  backend devuelve como `LineString` GeoJSON. No es PostGIS. `lat`/`lon` del
  elemento suelen quedar nulos para cables.
- **Inicio y fin:** en el modelo actual, `extremo_A_id` y `extremo_B_id`
  apuntan a otros `ftth_elementos`; el modelo además conserva el anclaje por hilo
  en `ftth_fibra_extremos.nodo_id` para cada extremo A/B. El trazado no ancla
  automáticamente una caja/manga: el frontend deja esa decisión para el
  diagrama.
- **Longitud:** no existe una columna de longitud ni un cálculo persistido.
  Puede calcularse desde `coords_json`, pero hoy no hay valor canónico guardado.
- **Número de hilos:** el tipo guarda `propiedades.fibras`; la materialización
  crea `ftth_cable_tubos` y `ftth_cable_fibras`. En cables con buffer,
  `looses` y `fibrasLoose` describen la distribución; en drop se acepta 1, 2,
  4, 6 u 8.
- **Tipo de fibra/perfil:** `ftth_tipos.propiedades.perfil` (por defecto
  `eia598a`, también `abnt` y `custom`) y `ftth_cable_fibras.perfil`.

Fila real de un respaldo SQLite (`backend/tachira_maps_respaldo_20260923_232539.db`,
`ftth_elementos.id = 102`):

```json
{
  "id": 102,
  "proyecto_id": 5,
  "tipo_id": 36,
  "categoria": "cables",
  "lat": null,
  "lon": null,
  "coords_json": "[[-72.22796233840617,7.769218960545089],[-72.22765985695469,7.769177334868658],[-72.22743299586577,7.769144034323688],[-72.22725094684364,7.769119058914299],[-72.22705489405114,7.769096858548551],[-72.22697087142522,7.769085758365776],[-72.22692605935846,7.769227285679037],[-72.2269428638869,7.769210635406566]]",
  "poste_ref_id": null,
  "propiedades_instancia": "{\"reserva_m\":0}"
}
```

Ese respaldo contiene 11 cables, 68 tubos, 783 fibras y 1.421 extremos. La
base activa `backend/tachira_maps.db` contiene 4 elementos (ODF, manga y
armario), pero **ningún cable**.

## 3. Relaciones

Lista de claves y flujo:

```text
map_projects
  ├─ ftth_tipos (proyecto_id)
  └─ ftth_elementos (proyecto_id)
       ├─ tipo_id -> ftth_tipos
       ├─ poste_ref_id -> ftth_elementos (caja/manga/reserva -> poste)
       ├─ extremo_A_id / extremo_B_id -> ftth_elementos (cable -> nodo)
       ├─ coords_json (ruta física del cable)
       ├─ ftth_cable_tubos -> ftth_cable_fibras
       │    └─ ftth_fibra_extremos -> nodo_id (caja/manga/ODF/OLT...)
       ├─ ftth_bandejas -> ftth_empalmes
       └─ ftth_dispositivos -> ftth_puertos
                                └─ ftth_empalmes.puerto_id
```

En la implementación heredada también existen `postes.id` y `cajas.poste_ref_id`
con relación directa, pero el mapa actual utiliza preferentemente las
instancias unificadas. En el respaldo consultado las cajas NAP tienen
`poste_ref_id = null`; por tanto la relación poste-caja no está completa en
todos los datos reales. Las mangas se representan como nodos y pueden usar el
mismo `poste_ref_id`, pero no hay una tabla `mangas`.

## 4. Catálogo de tipos

La fuente principal es `ftth_tipos`:

```text
id, proyecto_id, categoria, nombre_id, color_mapa, foto,
observaciones, propiedades (JSON)
```

`propiedades` es dinámica por categoría. Campos observados/definidos:

- `poste`: `nombre`, `codigo`, `material`, `altura_m`, `tipo_poste`, `desc`.
- `cajanap`: `nombre`, `codigo`, `capacidad_puertos`, `puertos_ocupados`,
  `tipo_instalacion`, `splitter_interno`, `desc`.
- `manga`: `nombre`, `codigo`, `tipo_manga`, `capacidad_fusion`,
  `puertos_entrada`, `estado`, `desc`.
- `armario` (equivalente funcional a POP): `nombre`, `prefijo`, `nivel`,
  `desc`, colores de representación.
- `cables`: `codigo`, `marca`, `modelo`, `nivel`, `estructura`, `looses`,
  `fibras`, `fibrasLoose`, `perfil`, `atenuacion`, `plantilla_visual`, colores
  y grosores.
- `odf`: `modelo_marca`, `capacidad_puertos`, `tipo_conector`.
- `olt`: `marca_modelo`, `tecnologia`, `cantidad_puertos_pon`, `potencia`,
  `tamano`, `slots`, `slots_detalle`.
- `splitter`: `relacion_division`/`division`, `entradas`, `salidas`,
  `tipo_conector`, `atenuacion`.
- `fusion`: `cliente`, `atenuacion`.
- `switch`, `ducto`, `luminaria`: campos definidos por el formulario y JSON
  libre; no hay una tabla SQL dedicada.

Ejemplo real de tipo:

```json
{
  "id": 28,
  "proyecto_id": 5,
  "categoria": "cajanap",
  "nombre_id": "NAP 16P",
  "color_mapa": "#eab308",
  "foto": null,
  "observaciones": null,
  "propiedades": {
    "capacidad_puertos": "16 Puertos",
    "tipo_instalacion": "Aérea en Poste"
  }
}
```

Ejemplo real de instancia de caja (respaldo, id 103):

```json
{
  "id": 103,
  "proyecto_id": 5,
  "tipo_id": 28,
  "categoria": "cajanap",
  "lat": 7.7693124918443885,
  "lon": -72.22700159598575,
  "coords_json": null,
  "poste_ref_id": null,
  "propiedades_instancia": {}
}
```

No existe una instancia real de splitter en las bases inspeccionadas:
`ftth_dispositivos` tiene registros en un respaldo, pero no se encontró una
instancia con categoría `splitter` en `ftth_elementos`. La forma esperada de
un tipo splitter es:

```json
{
  "categoria": "splitter",
  "nombre_id": "Splitter 1x8",
  "propiedades": {
    "relacion_division": "1x8 (10.7 dB)",
    "tipo_conector": "SC/APC",
    "atenuacion": 10.7
  }
}
```

## 5. API

URL de OpenAPI: `http://localhost:8000/openapi.json` (FastAPI la expone por
defecto; `backend/scripts/prueba_frontend_diagrama.py` la consulta). La
aplicación no se levantó durante este reconocimiento para evitar efectos de
arranque/migración sobre una base existente.

| Método | Ruta |
|---|---|
| GET | `/api/health` |
| POST/GET/GET/DELETE | `/api/v1/maps/projects`, `/api/v1/maps/projects`, `/api/v1/maps/projects/{project_id}`, `/api/v1/maps/projects/{project_id}` |
| POST/GET/GET/DELETE | `/api/v1/layers`, `/api/v1/layers`, `/api/v1/layers/{layer_id}`, `/api/v1/layers/{layer_id}` |
| POST | `/api/v1/formats/import` |
| POST | `/api/v1/formats/export/{format}` |
| GET | `/api/v1/formats` |
| POST | `/api/v1/ai/analyze` |
| GET/POST/GET/DELETE | `/api/v1/object-types`, `/api/v1/object-types`, `/api/v1/object-types/{type_id}`, `/api/v1/object-types/{type_id}` |
| GET | `/api/tipos/{categoria}` |
| POST | `/api/tipos/` |
| PUT/DELETE | `/api/tipos/{tipo_id}` |
| POST | `/api/elementos/` |
| GET | `/api/elementos/todos` |
| GET/PUT/DELETE | `/api/elementos/{elem_id}` |
| GET/POST/PUT/DELETE | `/api/carpetas`, `/api/carpetas`, `/api/carpetas/{carpeta_id}`, `/api/carpetas/{carpeta_id}` |
| PUT/DELETE | `/api/carpetas/elementos/{tipo}/{elem_id}`, `/api/carpetas/{carpeta_id}/elementos/{tipo}/{elem_id}` |
| POST | `/api/cables/{cable_id}/materializar-hilos` |
| GET | `/api/cables/{cable_id}/hilos` |
| PUT | `/api/fibras/{fibra_id}` |
| PUT | `/api/fibras/{fibra_id}/extremos/{extremo}` |
| GET | `/api/proyectos/{proyecto_id}/cables` |
| POST | `/api/proyectos/{proyecto_id}/materializar-todos` |
| POST | `/api/elementos/{elem_id}/bandejas` |
| POST | `/api/elementos/{elem_id}/dispositivos` |
| GET | `/api/elementos/{elem_id}/puertos` |
| GET | `/api/elementos/{elem_id}/nodo` |
| DELETE | `/api/dispositivos/{dispositivo_id}` |
| DELETE | `/api/bandejas/{bandeja_id}` |
| POST/PUT/DELETE | `/api/elementos/{elem_id}/empalmes`, `/api/elementos/{elem_id}/empalmes/{empalme_id}`, `/api/elementos/{elem_id}/empalmes/{empalme_id}` |
| PUT | `/api/elementos/{elem_id}/empalmes/fusiones` |
| GET | `/api/fibras/{fibra_id}/traza` |

Las rutas exactas de borrado y sincronización se definen en
[`backend/app/routers/ftth_logica.py`](backend/app/routers/ftth_logica.py).

## 6. Frontend

Árbol relevante:

```text
frontend/
├── index.html
├── map-style.json
├── css/
│   ├── style.css
│   ├── diagrama.css
│   ├── lienzo-diagrama.css
│   ├── hilos.css
│   └── plantillas-visuales.css
└── js/
    ├── app.js
    ├── ftth-mapa.js
    ├── ftth-tipos.js
    ├── ftth-diagrama.js
    ├── ftth-hilos.js
    ├── ftth-fusiones.js
    ├── ftth-fibra-inspector.js
    ├── ftth-cable-reglas.js
    ├── ftth-plantillas.js
    ├── ftth-carpetas.js
    ├── ftth-iconos.js
    └── plantillas-visuales/{fibra.js,splitter.js}
```

- Archivo principal del mapa: [`frontend/js/app.js`](frontend/js/app.js);
  inicializa `window.map`.
- Lógica de objetos/capas: [`frontend/js/ftth-mapa.js`](frontend/js/ftth-mapa.js).
- MapLibre GL JS: `4.7.1`, cargado desde unpkg en `frontend/index.html`.
- Carga de módulos: scripts clásicos secuenciales, no ES modules, al final de
  `index.html`; comparten `window` (por ejemplo `window.FTTHMapa`,
  `window.FTTHTipos`, `window.FTTHDiagrama`).
- Estado: variables de módulo/closure, `window.map`, `window.currentProjectId`,
  `_currentFeatures` y eventos DOM (`project-changed`); no hay store Redux,
  Pinia ni equivalente.
- Capas de cables: `/api/elementos/todos` devuelve GeoJSON; `ftth-mapa.js`
  normaliza y hace `source.setData`. La fuente `ftth-elementos` se dibuja con
  `ftth-cables-layer` como `line`, más capas de puntos/postes/etiquetas. La
  ruta completa se conserva en el inventario porque el evento de tesela puede
  venir recortado.

## 7. Menú de clic derecho

La implementación está en
[`frontend/js/ftth-mapa.js`](frontend/js/ftth-mapa.js):

- `initContextMenu()` crea `#ftth-ctx-menu`.
- `showContextMenu({x,y}, lngLat)` construye el HTML común para cualquier
  elemento, incluyendo poste, caja (`cajanap`) y manga.
- El binding del evento está en `init()` mediante `map.on('contextmenu',
  handleMapContextMenu)` y en `_bindLayerInteractions()` para las capas.
- Para postes, `posteOptionsHtml` agrega “Agregar Caja NAP”, “Agregar Manga” y
  “Agregar Reserva”.
- La opción ya existente “Abrir Diagrama” se inserta en `showContextMenu()` en
  la rama `tieneDiagrama(cat)` y se ejecuta en `action === 'diagrama'` llamando
  `abrirDiagramaDelElemento(...)`.

El punto exacto para cambiar la etiqueta o agregar reglas específicas para
poste/caja/manga es `showContextMenu()`, justo alrededor de
`posteOptionsHtml` y del botón `data-action="diagrama"`. La función del
diagrama está en `ftth-diagrama.js`, `abrir(boxId, opciones)`, y se carga desde
`ftth-mapa.js`.

## 8. Multi-ISP

No existe un sistema multi-ISP/tenant implementado. Hay `proyecto_id` en las
tablas FTTH y una tabla heredada `clientes`, pero no hay `tenant_id`,
usuarios, roles, ACL, autenticación ni middleware de autorización. Los
endpoints filtran por `proyecto_id` solo en algunas lecturas (por ejemplo
tipos y elementos), pero no verifican que el usuario tenga permiso sobre ese
proyecto. CORS está abierto (`allow_origins=["*"]`). Los permisos existentes
son, en la práctica, los HTTP de la aplicación sin control de identidad.

## 9. Constantes de red

Definidas en [`backend/app/routers/ftth_logica.py`](backend/app/routers/ftth_logica.py)
y reflejadas parcialmente en [`frontend/js/ftth-tipos.js`](frontend/js/ftth-tipos.js):

- Atenuación por km de cable: **no existe como constante global**. El tipo puede
  guardar `propiedades.atenuacion` (por ejemplo `0.1` o `0.4`), pero no hay
  cálculo general longitud × dB/km.
- Pérdida de fusión: `ATENUACION_FUSION_DB = 0.1 dB`.
- Pérdida de adaptador: `ATENUACION_ADAPTADOR_DB = 0.3 dB`.
- Splitter PLC: `1x2=3.6`, `1x4=7.3`, `1x8=10.7`, `1x16=13.7`,
  `1x32=16.9`, `1x64=20.5 dB`; también `2x2`, `2x4`, `2x8`, `2x16`,
  `2x32`.
- Potencia TX de OLT: **no existe como constante ni cálculo backend**. El
  formulario permite una propiedad `potencia`, pero no hay valor canónico.
- Umbrales de potencia: **no existen**. El frontend muestra `dBm` si un DTO
  trae medición, pero no hay umbrales de alarma definidos.
- Límites de catálogo: máximo splitter `64` salidas y `2` entradas; máximo
  cable `96` buffers, `48` fibras por buffer y `3456` hilos materializados;
  perfil EIA598-A `12`, ABNT/custom `24` fibras por buffer.

## 10. Convenciones

- Python: FastAPI + SQLAlchemy declarativo, routers por dominio, modelos en
  `backend/app/models`; JavaScript clásico en IIFE/closures con APIs
  `window.*`; nombres y UI principalmente en español.
- Pruebas: no hay configuración de pytest visible. Hay scripts ejecutables
  `backend/scripts/prueba_*.py` y `frontend/scripts/prueba_*.js`, más pruebas
  puntuales de capa lógica/diagrama.
- Migraciones: no existe Alembic. `Base.metadata.create_all()` corre al
  arrancar y `asegurar_migraciones()` ejecuta ALTERs ad hoc para SQLite;
  además hay borrado explícito porque SQLite no activa siempre cascadas.
- Docker Compose: servicio `db` PostGIS 15/3.3 y servicio `web` en
  `backend/Dockerfile`; `DATABASE_URL` del compose apunta a PostgreSQL. Esto
  no coincide con la base SQLite local actualmente poblada.
- CI: **no existe** workflow `.github/workflows` ni configuración CI visible.
- Reglas internas: [`.clinerules`](.clinerules) exige no inventar datos,
  reutilizar pruebas y mantener colores/plantillas compartidos.

## 11. Puntos de enganche

1. **Persistencia y migración:** extender `ftth_elementos` y/o crear tablas
   nuevas en `backend/app/models/ftth_logica.py`; añadir una migración real
   (hoy no existe framework de migraciones) para PostgreSQL y SQLite.
2. **Longitud y potencia:** incorporar cálculo/columnas o DTOs en
   `backend/app/routers/ftth_logica.py` (`listar_cables`,
   `obtener_nodo`, `trazar`) y en `ftth_elementos.py`; definir origen de
   potencia y unidades antes de persistir.
3. **Trazabilidad:** reutilizar `ftth_cable_fibras`,
   `ftth_fibra_extremos`, `ftth_empalmes` y
   `GET /api/fibras/{fibra_id}/traza`; agregar relaciones de splitter/puerto
   sin romper `tipo`, `extremo_a` y `extremo_b`.
4. **API del diagrama:** ampliar el DTO de `obtener_nodo()` y registrar rutas
   en `ftth_logica.router`; `ftth-diagrama.js::cargar()` ya es el consumidor
   natural.
5. **Frontend del diagrama:** `ftth-diagrama.js` pinta hilos, bandejas,
   dispositivos y fusiones; `ftth-fibra-inspector.js` es el punto para
   inspección de cable/potencia.
6. **Mapa:** `ftth-mapa.js::cargarTodosElementos()`,
   `_ensureFTTHLayers()` y la fuente `ftth-elementos` son los puntos para
   colorear/destacar cables por estado, potencia o trazabilidad.
7. **Menú:** `ftth-mapa.js::showContextMenu()` y
   `tieneDiagrama(cat)` ya contienen la opción “Abrir Diagrama”; modificar
   allí la disponibilidad específica para poste, caja y manga.
8. **Catálogo:** `ftth-tipos.js` (`CATS`, formularios y
   `NOMINAL_SPLITTER`) y `ftth_tipos.py` (`_normalizar_propiedades`) deben
   compartir cualquier nuevo campo.
9. **Multi-ISP:** agregar identidad, `tenant_id`/políticas y filtros de
   autorización en todos los routers antes de exponer diagramas por cliente.

## 12. Riesgos o deuda técnica

- Divergencia entre documentación/Compose PostgreSQL+PostGIS y ejecución local
  SQLite sin PostGIS.
- No hay `pg_dump` reproducible ni migraciones versionadas.
- El esquema activo y los respaldos no están al mismo nivel: respaldos antiguos
  no tienen `extremo_A_id/B_id` ni `ftth_empalmes`, mientras el modelo actual
  sí los declara.
- No hay columna de longitud ni cálculo de longitud geodésica; la potencia TX,
  dB/km y umbrales tampoco están definidos.
- No existe tenant/ACL; un endpoint puede consultar o modificar IDs de otros
  proyectos si conoce el identificador.
- Cajas reales sin `poste_ref_id` impiden asumir la relación poste-caja.
- Cables reales usan geometría JSON y algunos tienen `coords_json = null`; no se
  puede asumir que todo cable tiene ruta válida.
- El arranque ejecuta `create_all()` y migraciones ad hoc; esto puede alterar el
  esquema al iniciar una instancia contra una base antigua.
- Hay dos catálogos conceptuales (`ftth_tipos` y `catalog_*`/`map_object_types`)
  y tablas heredadas (`postes`, `cajas`), con riesgo de duplicidad semántica.
- CORS abierto a cualquier origen y sin autenticación; es incompatible con un
  despliegue multi-ISP seguro.
- El frontend duplica reglas de cable y splitter respecto al backend; ya hay
  pruebas de sincronización, pero sigue existiendo riesgo de divergencia.
- El diagrama es principalmente lectura/presentación y las posiciones x/y no
  son topología; no deben confundirse con geometría física.

## Exportaciones JSON solicitadas

### Caja real

```json
{
  "id": 103,
  "proyecto_id": 5,
  "tipo_id": 28,
  "categoria": "cajanap",
  "lat": 7.7693124918443885,
  "lon": -72.22700159598575,
  "coords_json": null,
  "poste_ref_id": null,
  "propiedades_instancia": {}
}
```

### Cable real

Se exporta el cable real `id=102` mostrado en la sección 2.

### POP real

**No existe** una instancia con categoría `pop`. La categoría funcional más
próxima es `armario` (el catálogo ofrece el nivel `pop_secundario`), pero no se
inventó una exportación POP porque no hay una fila real con esa categoría.
