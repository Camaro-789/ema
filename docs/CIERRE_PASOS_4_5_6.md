# CIERRE DE LOS PASOS 4 · 5 · 6

**Rama:** `integracion-v25` · **Fecha:** 2026-10-28 · **Módulo:** `frontend/js/pop/`

Resumen de lo hecho en esta sesión, con la evidencia de cada punto. Lo que **no** se
hizo se dice aquí y queda en `PENDIENTES.md`; no se declara nada verde sin la corrida
que lo demuestre.

## Evidencia global

| Prueba | Resultado |
|---|---|
| `pytest -q` (backend, 551 pruebas) | **551 passed** |
| `tests/herramientas/prueba_pop_playwright.py` | **42 comprobaciones OK, 0 fallos** |
| Apertura del armario con cable de 96 hilos | **241 ms** (< 3000) |
| `node --check` de los 13 módulos ES | sin errores |
| SHA256 de `pop_gestor_v25.html` | intacto (guardado por `prueba_plantilla_v25.py`) |

## Paso 4 — Matriz completa

- **Backend** (`app/routers/contenedores.py`): el DTO del diagrama incluye
  `relacionados` (contenedores del otro extremo de cada cable: `id`, `categoria`,
  `nombre`, `numero`). Dos consultas fijas extra, sin N+1.
- **`vista-matriz.js`** reescrito: tarjeta de gabinete → **tarjeta por equipo** con
  **banner azul** y los iconos **✎ ⇄ ✕ en el banner**; **colapsable** por equipo con el
  estado en un `Set` de módulo (`COLAPSADOS`) que sobrevive al repintado; **chip por
  hilo** con el gabinete de origen (`GAB2 ➔ ODF-02:P4`) y bloque ámbar **FUSIONES**
  para los empalmes hilo-hilo.
- **Mover de gabinete** en la UI: diálogo con los gabinetes unidos por cable →
  `api.moverDispositivo` (con `operation_id` + `base_revision`).
- 9 comprobaciones nuevas en la suite.

## Paso 5 — Origen/TX, dBm y linterna L/R

- **`energia.js`** (nuevo): recorrido de potencia desde el origen, réplica de
  `computeEnergy` del HTML (~697) **con las constantes del servidor**:
  conector 0.3 dB por tramo, empalme/ODF 0.1 dB en el paso A↔B, pérdida del splitter
  según su división (`1x8 → 10.7`…), TX por defecto según el kind
  (PON +3 · SFP −2 · RJ45 0 · HILO −2). El origen puede ser un **puerto o un hilo**
  (como `origin:true` del HTML).
- **Panel derecho**: bloque `ORIGEN · TX` (selector + TX editable en dBm) y **chip de
  potencia por ruta** con los umbrales del dominio (ACCESO −28 · ENLACE −14.4…+0.5).
- **Ventana de luz**: `TX de partida`, `dBm` al final y botones **◀ L / ▶ R** con el
  sentido activo marcado; `SEÑAL ▶ ORIGEN → FINAL` / `◀ FINAL → ORIGEN`.
- 7 comprobaciones nuevas.

## Paso 6 — Paridad, capturas y límites

- **P-010 hecho**: la suite guarda `docs/paridad/{referencia-html,nativo-papel,
  nativo-rack,nativo-matriz}.png` y **falla** si algún PNG baja de 10 KB.
  `docs/paridad/README.md` explica qué comparar y qué diferencias se aceptan.
- **P-005 bloqueado**: en esta máquina no hay Docker; el salto a PostgreSQL no se pudo
  probar y por eso **no** se declara hecho.
- **Retiro del puente: NO ejecutado.** La condición (paridad completa y todo verde) no
  se cumple: la matriz es una adaptación por contenedor y el puente es la vuelta atrás.
  Sigue el interruptor `POP_NATIVO_EN_ARMARIO=0` y el HTML no se movió de sitio.

## Bugs reales encontrados y corregidos en esta sesión

1. **Splitter del catálogo sin `division`** (`app/domain/servicios.py`): los tipos
   `1x16` creados en el Paso 0 no traen `relacion_division` en sus propiedades, así que
   «+ EQUIPO» fallaba con «El splitter necesita su división». Ahora se deduce de las
   propiedades y, si no está, del nombre del tipo (`… 1x16` → `1x16`), validándola
   contra la tabla de divisiones del servidor.
2. **El PAPEL ocultaba equipos nuevos** (`vista-papel.js`): el culling `visible(x, y)`
   descartaba las tarjetas de posición automática que caían fuera del encuadre, así que
   un equipo recién creado podía no dibujarse nunca. Ahora solo se descartan los
   equipos **ya colocados** por el usuario.
3. **Botones L/R recortados**: dentro de la cabecera de 220 px quedaban con caja 0×0;
   se movieron al cuerpo de la ventana (`Sentido ◀ ▶`).
4. **Estado de colapso perdido** (paso 4): el `Set` era local a `renderMatriz` y se
   reiniciaba en cada repintado; ahora es de módulo.

## Cómo se comprueba

```powershell
cd d:\Desktop\VS\ema\backend
python -m pytest -q
python tests\herramientas\prueba_pop_playwright.py   # deja las capturas en docs/paridad/
```
