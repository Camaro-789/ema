"""Táchira Map System - Main Application"""
import os
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

# Agregar directorio actual al path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

app = FastAPI(
    title="Táchira Map System",
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
from app.routers import maps, layers, formats, ai

app.include_router(maps.router, prefix="/api/v1/maps", tags=["maps"])
app.include_router(layers.router, prefix="/api/v1/layers", tags=["layers"])
app.include_router(formats.router, prefix="/api/v1/formats", tags=["formats"])
app.include_router(ai.router, prefix="/api/v1/ai", tags=["ai"])

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
    
    @app.get("/")
    async def api_only():
        return {"message": "Táchira Map System - API Only", "status": "running"}

@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "system": "Táchira Map System",
        "version": "1.0.0",
        "frontend": "found" if frontend_path else "not found"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True, reload_dirs=["app"])