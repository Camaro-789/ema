# INFORME DE VECTORES DORADOS — Fase 3.2

**Fecha:** 2026-10-27 · **Rama:** `integracion-v25`

## Cómo se generaron

`backend/tests/herramientas/generar_vectores.py` abre **el propio HTML**
(`frontend/pop_gestor_v25.html`, SHA256 `4B16000E…39706`, intacto) con Playwright y
llama a **sus** funciones (`validateStep`, `mkEp`, `portInfo`) para cada combinación.
El resultado queda en `backend/tests/vectores_reglas.json`.

> **Navegador:** el Chromium de Playwright no estaba descargado al generar, así que
> se usó **Microsoft Edge** del sistema (`channel="msedge"`). Es el mismo motor
> (Chromium) y ejecuta el mismo JavaScript del HTML.

## Cobertura

Extremos: PON / SFP / RJ45 de OLT, SFP / RJ45 de switch, ODF cara A y B,
SPLITTER IN y OUT, hilo de cable → **10 extremos**.

| Combinación | Casos |
|---|---|
| Todos los pares ordenados (90) × 2 escenarios (limpio/ocupado) × 3 opciones (`como_destino`, `como_origen_acceso`, `como_origen_enlace`) | **540** |

Distribución por familia de regla (la que dice el HTML):

| Familia | Casos |
|---|---|
| combinacion | 168 |
| rj45 | 132 |
| ocupado | 120 |
| ok | 48 |
| splitter | 36 |
| origen | 16 |
| pon | 15 |
| dominio | 5 |
| **total** | **540** |

Clasificados automáticamente por la frase de la regla: **0 sin clasificar**,
**0 excepciones** de JavaScript.

## Resultado contra el validador de Python

```
cd backend
python -m pytest tests -q
545 passed
```

- **540 vectores** + `test_hay_vectores_suficientes` + **4 pruebas de integridad** = **545**.
- **0 fallos, 0 xfail** (ningún caso quedó silenciado).
- Los vectores cubren también `canBeOrigin` (no se puede marcar origen en ODF ni
  splitter, la señal ACCESO/ENLACE del hilo) y la **vista de subida**
  (hilo de ACCESO → PON sí se permite).

## Diferencias que se corrigieron en Python (el HTML manda)

Durante la puesta a punto salieron diferencias reales; **todas se corrigieron en
Python**, nunca en el HTML (R1):

| # | Diferencia | Corrección en Python |
|---|---|---|
| 1 | Se permitía conectar una PON a un splitter por OUT | `splitter_entrada_in` también para PON (no solo cable) |
| 2 | La señal del origen no aportaba dominio | `pi.domain \|\| signal`, como el HTML |
| 3 | PON como destino se rechazaba siempre | se admite en **vista de subida** (hilo con señal ACCESO) |
| 4 | No se validaba que el extremo pudiera ser origen | bloque `es_origen` **antes** de los dominios, igual que `validateStep` |
| 5 | Orden de reglas distinto al del HTML | reordenado (canBeOrigin antes de dominios) |

## Diferencias declaradas (no ocultas)

1. **Extensión v26** (`splitter OUT → hilo`): el HTML lo rechaza; el validador lo
   acepta y lo marca con `extension: true` (`reglas_conexion.json` →
   `reglas_extension`). Los casos afectados se reconocen en la prueba y se cuentan
   aparte; **no hay ninguno en verde por esta vía** en la corrida actual (el HTML
   rechaza esos pares por la regla de combinación antes de llegar al splitter).
2. **Reglas de cadena** (lazos y "ya existe un origen"): el vector solo describe dos
   extremos; cuando el HTML rechaza por el grafo de la cadena, la prueba lo marca
   como `xfail` con motivo explícito en vez de darlo por bueno. **En la corrida
   actual: 0 casos**.

## Fase 3.3 (energía) — pendiente

La comparación HTML↔Python de potencias (`computeEnergy`, tolerancia 0.01 dB)
**no está implementada todavía**: hace falta el recorrido de energía en
`app/domain/reglas.py` (OLT PON → splitter IN → OUT → ODF A/B → switch SFP, con
`LOSS.conn = 0.3`, `LOSS.splice = 0.1`, splitter según división y 0.35 dB/km).
Queda anotado en `PENDIENTES.md` (P-008) con el plan exacto.
