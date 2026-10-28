# TABLA DE PARIDAD — HTML v25 ↔ módulo nativo (Fase 4.4)

**Fecha:** 2026-10-28 · **Módulo:** `frontend/js/pop/` · **Prueba de interfaz:**
`backend/tests/herramientas/prueba_pop_playwright.py` → **11 comprobaciones en verde**,
cable de 96 hilos abierto en **670 ms**.

> **Capturas lado a lado:** pendiente. Playwright puede hacerlas
> (`page.screenshot`), pero no se generaron en esta entrega; queda en P-010.

| Funcionalidad del HTML | Estado | Dónde / nota |
|---|---|---|
| **«+ EQUIPO» desde el catálogo** (OLT · ODF · Switch · Splitter) | **hecho** | `dialogo-equipo.js` lee `GET /api/tipos/{categoría}` y crea con su `tipo_id`; el equipo aparece en papel, rack y matriz (probado) |
| **Panel izquierdo de CABLES** con sus hilos y «+ CABLE» | **hecho** | `panel-izquierdo.js`; el armario vacío muestra el mensaje y el botón |
| **«+ CABLE» ancla un cable existente** | **hecho** | `GET/POST /api/contenedores/{id}/cables` + selector en el panel |
| **Panel derecho de TRAZABILIDAD** | **hecho** | `panel-derecho.js`: lista de rutas con ENCENDER |
| **Ventana de rutas (`#torchWin`)** | **hecho** | copiada del HTML: cabecera negra, PASANDO LUZ · ORIGEN → FINAL, DETENER, `.dirbadge`, resumen de tramos |
| Rack 19" en solo lectura | **hecho** | `vista-rack.js`; nada se conecta ahí |
| Papel: arrastrar el fondo (pan) | **hecho** | puntero + `setPointerCapture` |
| Papel: rueda = zoom 0.25–2.5 | **hecho** | con botones − / + y tope 25 %–250 % |
| Papel: vista persistente por contenedor | **hecho** | `localStorage['popDynView:<id>']` |
| Papel: posiciones de equipos en el servidor | **hecho** | `POST /api/contenedores/{id}/posiciones` |
| Papel: editar equipo (nombre, estado, pérdida) | **hecho** | lápiz ✎ → `PATCH` (diálogo con `prompt`) |
| Papel: conectar puertos | **hecho** | clic en dos puertos/hilos → `POST /conexiones` |
| Papel: hilos de 48/96 agrupados y expandibles | **hecho** | «ver N más» / «ver menos» |
| Papel: virtualización (solo lo visible) | **parcial** | se omiten tarjetas fuera de la vista; no hay culling por fila de hilo |
| Papel: mover equipo ENTRE gabinetes (⇄) | **API hecha, UI pendiente** | `POST …/mover` probado en pytest; falta el diálogo de destino |
| Matriz: una tarjeta por gabinete | **adaptado** | una tarjeta por **contenedor** (el modelo real: los gabinetes se unen por cables) |
| Matriz: tarjeta colapsable | **pendiente** | P-011 |
| Matriz: iconos ✎ ⇄ ✕ en el banner azul | **parcial** | ✎ ⇄ ✕ están en cada fila; en el banner solo «+» |
| Matriz: chip por hilo conectado | **hecho** | `cable:hilo ➔ equipo:puerto` (etiqueta simplificada) |
| VER COMUNICACIÓN: un pulso origen→final | **hecho** | `linterna.js`: 300 px/s, 26 px, cada 1.5 s, **un** `requestAnimationFrame` |
| Linterna: botones L/R y ventana flotante | **pendiente** | P-011 |
| Insignia de dirección («PON ▶ derecha») | **hecho** | texto en la cabecera |
| Origen de señal / potencia TX en pantalla | **API hecha, UI pendiente** | `POST …/origen`; la vista aún no lo pinta |
| Energía calculada (dBm) en la traza | **pendiente** | depende de 3.3 (P-008) |
| `?plantilla=1` abre el HTML aparte | **hecho** | botón PLANTILLA → `pop_gestor_v25.html?plantilla=1` |
| Sin iframe / sin postMessage | **hecho** | módulos ES (`type="module"`) |
| Todo detrás de un interruptor | **hecho** | el módulo se abre con `POPNativo.abrir(id)`; el armario sigue con el puente hasta la Fase 5 (R8) |

## Cómo probarlo a mano

```powershell
cd d:\Desktop\VS\ema
.\Iniciar_FiberMap.bat
# en la consola del navegador (F12):
POPNativo.abrir(21)          # 21 = armario del proyecto real
```

Automático:

```powershell
cd backend
python tests\herramientas\prueba_pop_playwright.py
```
