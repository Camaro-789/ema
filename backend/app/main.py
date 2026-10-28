"""MapOlt C.A. - Main Application"""
import os
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

# Agregar directorio actual al path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

app = FastAPI(
    title="MapOlt C.A.",
    description="Sistema de mapeamiento y gestión de redes ópticas",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Import routers
from app.database import Base, engine
import app.models.ftth_models as _ftth_models  # noqa: F401 — registra tablas FTTH en Base.metadata
import app.models.ftth_logica as _ftth_logica  # noqa: F401 — registra la capa lógica (tubos/hilos/extremos)
from app.routers import maps, layers, formats, ai, types
from app.routers import ftth_tipos, ftth_elementos, ftth_carpetas
from app.routers import ftth_logica
from app.config import POP_V25_ENABLED, VERSION_CONTRATO_DIAGRAMA

Base.metadata.create_all(bind=engine)


def _migrar_al_arranque() -> None:
    """Aplica las migraciones pendientes (Fase 2.1, sustituto de asegurar_migraciones)."""
    from alembic import command
    from alembic.config import Config

    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.environ.setdefault("DATABASE_URL", engine.url.render_as_string(hide_password=False))
    configuracion = Config(os.path.join(raiz, "alembic.ini"))
    configuracion.set_main_option("script_location", os.path.join(raiz, "migrations"))
    command.upgrade(configuracion, "head")


_migrar_al_arranque()


app.include_router(maps.router, prefix="/api/v1/maps", tags=["maps"])
app.include_router(layers.router, prefix="/api/v1/layers", tags=["layers"])
app.include_router(formats.router, prefix="/api/v1/formats", tags=["formats"])
app.include_router(ai.router, prefix="/api/v1/ai", tags=["ai"])
app.include_router(types.router, prefix="/api/v1", tags=["types"])
# FTTH — tipos, elementos y carpetas
app.include_router(ftth_tipos.router)
app.include_router(ftth_elementos.router)
app.include_router(ftth_carpetas.router)
# Capa lógica FTTH — contención de hilos (tablas nuevas, no afecta al mapa)
app.include_router(ftth_logica.router)


@app.get("/api/config/flags", tags=["config"],
         summary="Interruptores de la integración del diagrama POP")
async def config_flags():
    """Banderas que el frontend lee al arrancar (Fase 1.4).

    Con `pop_v25_enabled = false` la interfaz oculta todo acceso al diagrama;
    el resto de Map OLT sigue igual.
    """
    return {
        "pop_v25_enabled": POP_V25_ENABLED,
        "version_contrato_diagrama": VERSION_CONTRATO_DIAGRAMA,
    }


# Buscar frontend
def find_frontend_path():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    possible_paths = [
        os.path.join(current_dir, "..", "..", "frontend"),
        os.path.join(current_dir, "..", "frontend"),
        os.path.join(os.getcwd(), "frontend"),
    ]
    for path in possible_paths:
        full_path = os.path.abspath(path)
        if os.path.exists(full_path) and os.path.exists(os.path.join(full_path, "index.html")):
            return full_path
    return None

frontend_path = find_frontend_path()

if frontend_path:
    print(f"Frontend found at: {frontend_path}")
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")

    @app.get("/api/health")
    async def health():
        return {
            "status": "healthy",
            "system": "MapOlt C.A.",
            "version": "1.0.0",
            "frontend": "found" if frontend_path else "not found"
        }

    @app.get("/", response_class=HTMLResponse)
    async def serve_frontend():
        return FileResponse(os.path.join(frontend_path, "index.html"))

    @app.get("/{full_path:path}", response_class=HTMLResponse)
    async def serve_spa(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("docs") or full_path.startswith("openapi.json") or full_path.startswith("redoc"):
            return JSONResponse({"error": "Not found"})
        file_path = os.path.join(frontend_path, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_path, "index.html"))
else:
    print("WARNING: Frontend not found. API only mode.")

    @app.get("/api/health")
    async def health():
        return {
            "status": "healthy",
            "system": "MapOlt C.A.",
            "version": "1.0.0",
            "frontend": "not found"
        }

    @app.get("/")
    async def api_only():
        return {"message": "MapOlt C.A. - API Only", "status": "running"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True, reload_dirs=["app"])