# TABLA DE PARIDAD — HTML v25 ↔ módulo nativo (Fase 4.4 + pasos 4–6)

**Fecha:** 2026-10-28 · **Módulo:** `frontend/js/pop/` · **Prueba de interfaz:**
`backend/tests/herramientas/prueba_pop_playwright.py` → **42 comprobaciones en verde**,
cable de 96 hilos abierto en **390 ms**.

> **Capturas lado a lado:** hechas por la propia suite en `docs/paridad/`
> (`referencia-html.png` + `nativo-papel|rack|matriz.png`), con el README de P-010.
> La suite **falla** si alguna queda por debajo de 10 KB.

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
| Papel: virtualización (solo lo visible) | **parcial** | se omiten tarjetas **ya colocadas** fuera de la vista; las de posición automática siempre se dibujan (si no, un equipo nuevo podía desaparecer) |
| Papel: mover equipo ENTRE gabinetes (⇄) | **hecho** | diálogo de destino con los gabinetes unidos por cable → `POST …/mover` (paso 4) |
| Matriz: una tarjeta por gabinete | **adaptado** | una tarjeta por **contenedor** (el modelo real: los gabinetes se unen por cables) |
| Matriz: tarjeta colapsable | **hecho** | `▾ ocultar / ▸ mostrar` por equipo, estado en `COLAPSADOS` (sobrevive al repintado) |
| Matriz: iconos ✎ ⇄ ✕ en el banner azul | **hecho** | los tres van **en el banner** de cada equipo (`.pop-eq-banner`), no por fila |
| Matriz: chip por hilo conectado | **hecho** | `GABINETE ➔ equipo:puerto` con el gabinete del otro extremo del cable (`relacionados` del DTO) |
| VER COMUNICACIÓN: un pulso origen→final | **hecho** | `linterna.js`: 300 px/s, 26 px, cada 1.5 s, **un** `requestAnimationFrame` |
| Linterna: botones L/R y ventana flotante | **hecho** | `◀ L / ▶ R` en la ventana de luz; L invierte los puntos del pulso (paso 5) |
| Insignia de dirección («SEÑAL ▶ ORIGEN → FINAL») | **hecho** | en la ventana de luz; cambia a `◀ FINAL → ORIGEN` con L |
| Origen de señal / potencia TX en pantalla | **hecho** | bloque `ORIGEN · TX` del panel derecho: selector de puerto/hilo y TX editable (paso 5) |
| Energía calculada (dBm) en la traza | **hecho** | `energia.js`: conector 0.3 · empalme/ODF 0.1 · splitter por división, constantes de `/api/config/reglas`; chip por ruta con los umbrales del dominio |
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
