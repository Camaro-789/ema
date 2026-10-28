# PARIDAD VISUAL — capturas lado a lado (P-010)

**Generado por:** `backend/tests/herramientas/prueba_pop_playwright.py` (último bloque,
«Paso 6 · P-010»). No son capturas hechas a mano: la suite las produce en cada corrida,
así que siempre corresponden al código del momento.

```powershell
cd d:\Desktop\VS\ema\backend
python tests\herramientas\prueba_pop_playwright.py
# → docs/paridad/*.png
```

## Qué hay aquí

| Archivo | Qué enseña | Pantalla |
|---|---|---|
| `referencia-html.png` | La plantilla `frontend/pop_gestor_v25.html` abierta **tal cual** (solo lectura: su SHA256 está fijado por `prueba_plantilla_v25.py`). Es el patrón a igualar. | 1500 × 900 |
| `nativo-papel.png` | Módulo nativo, pestaña **PAPEL**: tarjetas de equipo, hilos del cable, pulso de luz y ventana de rutas. | la del modal |
| `nativo-rack.png` | Pestaña **RACK** (solo lectura, 19"). | la del modal |
| `nativo-matriz.png` | Pestaña **MATRIZ**: tarjeta de gabinete → tarjeta por equipo con banner azul (✎ ⇄ ✕) y chips `GAB2 ➔ ODF-02:P4`. | la del modal |

## Cómo se comparan

1. Abre las dos imágenes de un mismo par en dos ventanas al lado (o pestañas del visor).
2. Recorre esta lista, que es la que grading la paridad:
   - **cabecera**: título, insignia de revisión, RACK · PAPEL · MATRIZ, VER COMUNICACIÓN;
   - **tres zonas**: CABLES (izq) · vista (centro) · TRAZABILIDAD (der);
   - **paleta**: negro + azul `#dbeafe` en banners, ámbar `#f59e0b` en el pulso;
   - **ventana de luz**: cabecera negra, «PASANDO LUZ · ORIGEN → FINAL», DETENER, L/R, `.dirbadge`;
   - **matriz**: banner azul por equipo y chips con el gabinete de origen.
3. Diferencias que **ya se conocen y están aceptadas** (no son regresiones):
   - la matriz del módulo es **por contenedor** (el modelo real une gabinetes por cables),
     no un lienzo único con todos los gabinetes;
   - el papel dibuja los cables en columnas fijas (el HTML los distribuye a mano);
   - el racimo de hilos largos se agrupa («ver N más»), no se pagina igual que el HTML.

## Estado de las dependencias de la Fase 6

| Punto | Estado | Evidencia |
|---|---|---|
| **P-010** capturas lado a lado | **hecho** | este directorio; la suite falla si algún PNG queda por debajo de 10 KB |
| **P-005** PostgreSQL / Docker | **bloqueado** | en esta máquina no hay Docker (`docker --version` no existe en el PATH). El proyecto corre con SQLite; el salto a PostgreSQL no se puede probar aquí, así que no se declara hecho |
| **Retiro del puente** (mover `pop_gestor_v25.html` a `frontend/referencia/` y borrar el iframe) | **NO ejecutado** | la condición de la Fase 5.3 es «paridad completa y todo verde»; la matriz sigue siendo una adaptación y el puente es la vuelta atrás. Se conserva el interruptor `POP_NATIVO_EN_ARMARIO=0` |
