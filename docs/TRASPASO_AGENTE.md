# TRASPASO — briefing para un agente nuevo

**Proyecto:** Map OLT (FiberMap Táchira) · **Repo:** `d:\Desktop\VS\ema` · **Rama:** `integracion-v25`
**Objetivo de la línea de trabajo:** módulo **nativo** del POP (diagrama de fibra) que replique
`frontend/pop_gestor_v25.html` **sin modificar ese HTML** y sin romper las fases 1–5.

## 1. Entorno (esto ahorra una hora de tropiezos)

| Cosa | Valor real |
|---|---|
| Python que **sí** tiene pytest/playwright | `C:\Users\Emanuelito\AppData\Local\Programs\Python\Python314\python.exe` |
| `.venv` del repo | **vacío** (no instalar ahí; usar el Python del sistema) |
| git | portable, **no está en el PATH**: `C:\Users\Emanuelito\PortableGit\cmd\git.exe` |
| Playwright | lanza **Microsoft Edge** del sistema (`channel="msedge"`); el Chromium descargable nunca terminó de bajar |
| Terminal de VS Code | **rota** (PSReadLine lanza `ArgumentOutOfRangeException` al teclear). Trabaja con `cmd /c archivo.cmd`, `powershell -NoProfile -File archivo.ps1` y **lee el resultado de un log** (`_*.log`), no de la consola |
| Base de datos | SQLite: real `backend/tachira_maps.db` (**no tocar**), sintética `backend/tests/tachira_maps_test.db` (la suite le agrega un splitter por corrida: el conteo de equipos crece entre ejecuciones) |

## 2. Estado: pasos 0–6 hechos y verificados

| Prueba | Resultado |
|---|---|
| `python -m pytest -q` (backend) | **551 passed** |
| `python tests\herramientas\prueba_pop_playwright.py` | **42 comprobaciones OK, 0 fallos** |
| Apertura del armario con cable de 96 hilos | **390 ms** (tope 3000) |
| `node --check` de los 13 módulos ES de `frontend/js/pop/` | sin errores |
| SHA256 de `frontend/pop_gestor_v25.html` | **intacto** (lo fija `scripts/prueba_plantilla_v25.py`) |

### Commits de esta entrega (rama `integracion-v25`)

```
68aed39  fix(pop): las capturas de paridad se guardan en docs/paridad del proyecto
6e258e4  docs(pop): paridad con capturas lado a lado y cierre de los pasos 4-6 (P-010)
148bc60  feat(pop): potencia dBm desde el origen, TX editable y linterna L/R (paso 5)
c2e5243  paso 4: matriz con tarjeta por equipo, banner editar/mover/eliminar, chips de gabinete y dialogo de mover
801ce8e  feat(pop): + EQUIPO desde el catalogo de tipos (tipo_id) y reflejo inmediato en papel, rack y matriz
52832d9  feat(pop): tres paneles (cables | rack-papel-matriz | trazabilidad) con ventana de rutas copiada del HTML
```

## 3. Mapa de archivos que importa

**Frontend (`ema/frontend/js/pop/`)**
- `entrada.js` — punto de entrada (`POPNativo.abrir(id)`), estado de la vista (pestaña, ruta activa, origen/TX, sentido) y todos los cables entre UI ↔ API.
- `api.js` — cliente HTTP; `comando()` añade `operation_id` + `base_revision`.
- `store.js` — carga el diagrama y ejecuta comandos; en 409 recarga.
- `reglas.js` — lee `/api/config/reglas` (autoridad del servidor) y helpers `infoPuerto`, `perdidaSplitter`, `estadoPotencia`.
- `energia.js` — **potencia dBm** desde el origen (conector 0.3 · empalme/ODF 0.1 · splitter por división; TX por kind PON +3/SFP −2/RJ45 0/HILO −2). Origen = puerto **o** hilo.
- `trazabilidad.js` — arma las cadenas (nodos `P:<puerto>` / `H:<hilo>`) para el pulso.
- `linterna.js` — pulso 300 px/s, 26 px, cada 1.5 s, un solo rAF; `sentido` L/R.
- `vista-papel.js` — SVG: tarjetas, puertos, hilos, pan/zoom, culling.
- `vista-rack.js` — rack 19" de solo lectura.
- `vista-matriz.js` — tarjeta por gabinete → tarjeta por equipo con banner azul (✎ ⇄ ✕), colapsable, chips `GAB ➔ EQ:PUERTO`.
- `panel-izquierdo.js` (CABLES + «+ CABLE»), `panel-derecho.js` (rutas + ORIGEN·TX + ventana de luz con L/R), `dialogo-equipo.js` («+ EQUIPO» desde el catálogo).
- `ema/frontend/css/pop-diagrama.css` — todo el estilo del módulo.

**Backend**
- `app/routers/contenedores.py` — `/api/contenedores/{id}`: `diagrama` (incluye `relacionados`: gabinetes del otro extremo de cada cable), `cables` (GET/POST), `conexiones`, `dispositivos`, `mover`, `posiciones`, `energia` si se agrega.
- `app/domain/servicios.py` — reglas de creación/edición; `_division_de_tipo()` deduce la división del splitter del catálogo.
- `app/domain/reglas.py` + `reglas_conexion.json` — validación pura y **constantes físicas** (pérdidas, TX, umbrales por dominio).
- `backend/tests/herramientas/prueba_pop_playwright.py` — suite de interfaz **y** generador de capturas.

## 4. Reglas que NO se pueden romper

1. **El HTML es de solo lectura.** `frontend/pop_gestor_v25.html` nunca se edita: `prueba_plantilla_v25.py` fija su SHA256 y falla si cambia. Para comparar, se abre aparte (`?plantilla=1` o `file://`).
2. **La base real no se toca.** `backend/tachira_maps.db` es datos del usuario; las pruebas usan la sintética.
3. **El puente sigue disponible.** `POP_NATIVO_EN_ARMARIO=0` devuelve el iframe antiguo; no se borra hasta que la paridad esté completa.
4. **Cada acción va al servidor.** La UI redibuja la respuesta del servidor; nunca inventa estado. Si el servidor rechaza, se muestra su `mensaje_es` y no cambia nada.
5. **Commits pequeños y en verde.** Si algo falla: `git revert` del commit culpable y anotarlo en `PENDIENTES.md`. Nada se declara hecho sin la corrida que lo demuestre.

## 5. Lo que queda abierto

| Punto | Estado | Qué falta |
|---|---|---|
| **P-001** `frontend/scripts/prueba_reglas_cable.js` | heredado, 3 fallos | Decidir si el rótulo del DROP lleva buffer y si el orden en la SALIDA se invierte. **Ya fallaba antes** de esta rama (probado en worktree `0f7fdb4`) |
| **P-005** PostgreSQL / Docker | **bloqueado** | No hay Docker en esta máquina; no se pudo probar el salto. Hace falta una máquina con Docker o un PostgreSQL accesible |
| **Retiro del puente** (fase 5.3) | **no ejecutado** | Requiere paridad completa y verde: mover el HTML a `frontend/referencia/`, tag `respaldo-antes-de-retirar-puente`, borrar el iframe |
| **Diferencias visuales aceptadas** | documentadas | matriz por contenedor (no lienzo único), cables del papel en columnas fijas, hilos largos agrupados (ver `docs/paridad/README.md`) |
| **Energía en el backend** | pendiente de diseño | hoy el dBm se calcula en el cliente con las constantes del servidor; si se quiere autoridad total, mover el recorrido a `app/domain/energia.py` + endpoint y comparar con tolerancia 0.01 dB contra `computeEnergy` |

## 6. Cómo verificar (copiar y pegar)

```powershell
# git (no está en el PATH)
& 'C:\Users\Emanuelito\PortableGit\cmd\git.exe' -C d:\Desktop\VS\ema status --short

# backend
cd d:\Desktop\VS\ema\backend
& 'C:\Users\Emanuelito\AppData\Local\Programs\Python\Python314\python.exe' -m pytest -q

# interfaz + capturas (deja docs/paridad/*.png)
& 'C:\Users\Emanuelito\AppData\Local\Programs\Python\Python314\python.exe' tests\herramientas\prueba_pop_playwright.py
```

## 7. Trampas ya pagadas (no repetirlas)

- **Estado de UI en variable local**: `COLAPSADOS` (matriz) se perdía en cada repintado; el estado debe vivir a nivel de módulo.
- **Culling del papel**: `visible(x, y)` borraba equipos recién creados que caían fuera del encuadre. Ahora solo se descarta lo que el usuario ya colocó.
- **Divisiones del catálogo**: los tipos `1x16` no traen `relacion_division`; sin `_division_de_tipo()` «+ EQUIPO» fallaba.
- **Botones recortados**: dentro de la cabecera de 220 px los botones L/R quedaban con caja 0×0; van en el cuerpo de la ventana.
- **Avisos**: `.pop-aviso` incluye los mensajes **de éxito**; para detectar errores usar `.pop-aviso--error`.
- **Rutas de la suite**: `BASE` es `ema/backend`; lo que deba ir a `docs/` se construye con `Path(BASE).parent`.
- **La base sintética acumula**: cada corrida crea un equipo nuevo (`.pop-tarjeta` crece). No asumir conteos fijos.
- **Playwright y visibilidad**: elementos SVG/clipados pueden estar `attached` pero “hidden”; usar `state="attached"` y `dispatch_event("click")`.

## 8. Siguiente paso sugerido

1. Cerrar **P-001** (decidir el rótulo/orden del cable y ajustar prueba o dibujo).
2. Llevar la **energía al backend** (walker en `app/domain` + endpoint + prueba con tolerancia 0.01 dB contra un espejo literal de `computeEnergy`).
3. Repetir la captura de paridad hasta que no queden diferencias de layout; **entonces** retirar el puente con el tag de respaldo.
4. **P-005** cuando haya Docker disponible.

