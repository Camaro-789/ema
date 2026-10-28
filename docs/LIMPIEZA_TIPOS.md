# Limpieza del catálogo de tipos (paso 0)

**Fecha:** 2026-10-28 · **Base:** `backend/tachira_maps.db`
**Respaldo previo:** `D:\Backups\MapOLT\tipos_20261027_235439.db`

## Regla aplicada

Solo se borró un tipo si tenía **0 elementos y 0 dispositivos**. `ftth_elementos.tipo_id`
tiene `ON DELETE CASCADE`, así que borrar un tipo en uso habría borrado sus elementos.

## Borrados (40)

| Grupo | Tipos |
|---|---|
| Basura con nombre de prueba | `dfdf` (ODF #27), `eee` (splitter #39), `fdf` (splitter #47), `sdsdsd` (cajanap #13), `fgfgfg` (poste #20) |
| Duplicados exactos de un tipo que sigue en uso | armario #18 · ODF #17 · splitter #23, #24 · cajanap #29 · manga #5, #30, #31 |
| Tanda de cables de prueba | `PRUEBA 1 buffer x 12` #49–#70, #78, #79 (24 tipos) |
| Duplicados del cable ADSS 144H | #22, #40, #41 (se conserva #21) |

## Conservados a propósito (aunque estuvieran sin usar)

`OLT-HW-GPON` (#11, 16 PON con slots) · `Switch Core 24 puertos` (#75) ·
`Splitter AF balanceado 1x8` (#76) · `Splitter AC cliente 1x8` (#77) ·
`Poste Concreto 9m` (#1) · `Ducto HDPE 110mm` (#15) · `Luminaria LED` (#14) ·
`Cable ADSS 144H` (#21) · `Manga 48H Fusión` (#5 ya borrado como duplicado de #10).

## Creados (2)

- `Splitter AF balanceado 1x16` — `relacion_division 1x16`, `salidas 16`, `clase AF`, `atenuacion 14.0`
- `Splitter AC cliente 1x16` — igual pero `clase AC`, `cliente true`

## Verificación

| Cuenta | Antes | Después |
|---|---|---|
| `ftth_elementos` | 42 | **42** |
| `ftth_dispositivos` | 5 | **5** |
| `ftth_tipos` | 73 | **35** |

Ningún elemento ni dispositivo se perdió.
