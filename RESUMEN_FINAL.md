# RESUMEN_FINAL — integración del módulo nativo POP (v25)

**Rama:** `integracion-v25` · **Fecha:** 2026-10-28 · **Estado:** Fases 1, 2, 3 (3.1/3.2/3.4)
y 4 (núcleo) completas; 3.3, paridad fina y Fases 5–6 pendientes (ver `PENDIENTES.md`).

## Commits

| Hash | Mensaje |
|---|---|
| `c8bda7a` | chore(repo): sacar la base de datos real del control de versiones (sigue en disco) |
| `0f7fdb4` | estado antes de reordenar puente v25 |
| `eec41cd` | chore(entorno): requirements con las versiones reales de Python 3.14.3 + doc de entorno |
| `1c1d7e3` | feat(flags): interruptor POP_V25_ENABLED y prueba que fija el SHA256 de la plantilla v25 |
| `1a20cb8` | perf(nodo): GET /nodo sin N+1 (209 → 19 consultas) con snapshot que prueba el mismo DTO |
| `e0554a5` | docs: auditoría de integración v25 (a–f) y pendientes |
| `11fb988` | fix(verificar): el resumen cuenta bien cuando hay un solo fallo |
| `dbbc16e` | feat(backend): Alembic baseline 0001–0004 (revision, operaciones, conexion_meta) y validador de dominio puro |
| _(siguiente)_ | feat(backend): servicios de dominio y API /api/contenedores |

## Cifras de `GET /api/elementos/{id}/nodo` (Fase 1.5)

Base sintética con **un cable de 96 hilos** anclado al gabinete:

| Gabinete | Antes | Después |
|---|---|---|
| A (96 hilos, 2 empalmes) | **209 SQL · 145,8 ms** | **19 SQL · 25,4 ms** |
| B (96 hilos, 1 empalme) | 205 SQL · 136,6 ms | 15 SQL · 22,0 ms |

El DTO quedó **idéntico** (22/22 comprobaciones contra `backend/tests/snapshots/nodo_antes.json`).

## Contrato nuevo (Fase 2.6)

`GET /api/contenedores/{id}/diagrama` → **9 consultas fijas** con paginación de
hilos por cable (`hilos_por_cable`, 1–96). Mismo conteo en un gabinete con 96
hilos que en otro con 17 equipos.

## Entorno (hechos)

| Pieza | Versión / estado |
|---|---|
| Python | 3.14.3 (el del sistema; el `.venv` del proyecto sigue vacío) |
| Node | 24.19.0 |
| Git | 2.53.0.windows.4 portable en `C:\Users\<usuario>\PortableGit` (sin admin) |
| Alembic | **1.20.1** (instalado en la sesión) |
| pytest | **9.2.0** (instalado; aún sin usar en la suite) |
| Playwright | **no instalado** |

## Lo que NO se pudo probar (declarado, R6)

1. **PostgreSQL / PostGIS**: no hay Docker disponible en la sesión. El DDL es
   dialect-aware y `docker-compose.yml` ya trae `postgis/postgis:15-3.3`.
2. **Playwright / navegador real**: no instalado. Las pruebas de interfaz de la
   Fase 4 y los vectores dorados de la 3.2 quedan pendientes de ese paso.
3. **Clics manuales de la lista de verificación del mapa** (agregar poste, capas
   on/off, crear tipo, abrir caja/manga, abrir armario #21): la parte automática
   pasa en verde, pero los clics necesitan el navegador del usuario.

## Riesgos abiertos

| Riesgo | Detalle |
|---|---|
| R-01 | El histórico remoto de git conserva versiones antiguas del `.db` (limpiarlo exige reescribir historia). |
| R-02 | `prueba_reglas_cable.js` falla con 3 comprobaciones **desde antes** del proyecto (P-001). |
| R-03 | Puerto↔puerto (OLT SFP → ODF cara A) no es representable; hoy se rechaza (Fase 6). |
| R-04 | Detección de lazos incompleta (`contexto["cadena"]` vacío) hasta la Fase 3. |
| R-05 | Capacidad en U de gabinetes sin modelar (`excede` siempre `false`). |

## Estado del puente v25

**Congelado y ENCENDIDO.** No se le agregó nada (R8). El armario #21 sigue
funcionando con el iframe. Se retirará en la Fase 5 solo si la tabla de paridad
está completa y todas las pruebas (pytest + Playwright) están en verde.
