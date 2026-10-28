# Entorno de desarrollo — Map OLT (FiberMap Táchira)

Estado verificado el **2026-10-27**.

## Lo que hay en este equipo

| Pieza | Versión real | Nota |
|---|---|---|
| Python | **3.14.3** | `C:\Users\<usuario>\AppData\Local\Programs\Python\Python314\python.exe` |
| Node | **24.19.0** | solo para las pruebas JS (`node --check`, scripts de `frontend/scripts/`) |
| Git | **2.53.0.windows.4** | portable, en `C:\Users\<usuario>\PortableGit` (sin admin) |
| Base de datos | SQLite `backend/tachira_maps.db` | PostgreSQL + PostGIS es el objetivo (`docker-compose.yml`) |

> El `.venv` de la carpeta está **vacío**: no lo uses. El backend se ejecuta con el
> Python 3.14.3 del sistema (`py -V:3.14`), que es el que tiene las dependencias.

## Cómo recrear el entorno (sin tocar el que funciona)

```powershell
cd d:\Desktop\VS\ema

# 1) Un venv nuevo (opcional; hoy el proyecto corre con el Python del sistema)
py -V:3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2) Dependencias con las versiones reales
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt

# 3) Comprobar que el backend arranca y anotar las versiones
cd backend
python scripts\versiones_entorno.py     # deja docs/mediciones/VERSIONES_ENTORNO.txt
python -c "import app.main; print('ARRANQUE OK')"
```

## Cómo se ejecuta la aplicación

```powershell
cd d:\Desktop\VS\ema
.\Iniciar_FiberMap.bat
# o bien:
cd backend
py -V:3.14 -m uvicorn app.main:app --reload --port 8000
```

El frontend es estático (`frontend/index.html`) y el backend lo sirve desde `/`.

## Cómo se corre el chequeo completo

```powershell
cd d:\Desktop\VS\ema
powershell -ExecutionPolicy Bypass -File .\verificar_todo.ps1
```

## Interruptor POP_V25_ENABLED (Fase 1.4)

Todo el diagrama POP queda detrás de una bandera. **Por defecto: encendido** (desarrollo).

```powershell
$env:POP_V25_ENABLED = "0"     # apagado: no aparece ningún acceso al diagrama
$env:POP_V25_ENABLED = "1"     # encendido (por defecto)
```

- Backend: `backend/app/config.py` → `POP_V25_ENABLED`; se publica en
  `GET /api/config/flags` junto a `version_contrato_diagrama`.
- Frontend: `frontend/js/ftth-flags.js` lee esa ruta al arrancar y deja el valor en
  `window.FTTH_FLAGS`; lo consultan `ftth-mapa.js` (`tieneDiagrama`, `abrirDiagramaGlobal`)
  y `ftth-pop-papel.js` (`abrir`).
- Apagado: desaparecen el botón «Abrir Diagrama», la opción del menú contextual y el
  doble clic. El resto del mapa (postes, capas, tipos, fusiones, cajas) no cambia.
- El endpoint `GET /api/elementos/{id}/nodo` **sigue respondiendo** con la bandera
  apagada: el puente congelado (R8) lo usa hasta la Fase 5.

## Reglas del proyecto que se verifican solas

| Prueba | Qué protege |
|---|---|
| `backend/scripts/prueba_plantilla_v25.py` | que `frontend/pop_gestor_v25.html` conserve su SHA256 (R1) |
| `backend/scripts/medir_nodo.py` | medición de `GET /nodo` (solo lectura) |
| `backend/scripts/versiones_entorno.py` | versiones reales del entorno |


- **No** se instalan paquetes con administrador. Todo va con `pip --user` o en un venv.
- La base real (`backend/tachira_maps.db`) **no** se versiona (ver `.gitignore`).
- Las pruebas de escritura van **solo** contra una base sintética separada.
