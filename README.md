# Táchira Map System

Sistema de mapeamiento y gestión de redes ópticas para Táchira, Venezuela.
Arquitectura escalable con IA integrada, usando librerías gratuitas de código abierto.

## Tecnologías

- **MapLibre GL JS**: Mapas vectoriales y raster acelerados por WebGL (sin clave API)
- **OpenStreetMap/Nominatim**: búsqueda geográfica y consultas de lugares
- **Mapbox**: capa opcional de mosaicos, habilitada con un token configurado localmente
- **FastAPI**: Backend async de alto rendimiento
- **PostgreSQL + PostGIS**: Base de datos espacial
- **GDAL/Shapely/Geopandas**: Conversión de formatos (KML, KMZ, GPX, CSV, GeoJSON, Shapefile)
- **Scikit-learn**: Análisis IA (clustering, densidad, predicción)

## Características

- ✅ Soporta todos los formatos: KML, KMZ, GPX, CSV, GeoJSON, Shapefile
- ✅ Mapas vectoriales rápidos (sin bloqueo)
- ✅ Análisis IA: densidad, clustering, rutas, riesgo, predicción
- ✅ Arquitectura modular y escalable
- ✅ Listo para vender a ISPs

## Ejecutar

### Opción 1: Docker (recomendado)
```bash
docker-compose up -d
```

### Opción 2: Local
```bash
# Instalar dependencias
cd backend
pip install -r requirements.txt

# Inicializar base de datos
python -c "from app.database import engine, Base; Base.metadata.create_all(engine)"

# Ejecutar
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Acceder a: http://localhost:8000

### Mapbox opcional

La aplicación funciona sin token usando OpenStreetMap y ESRI. Para habilitar la
capa satelital de Mapbox, define `window.MAPBOX_ACCESS_TOKEN` en
`frontend/index.html` antes de cargar `app.js`. El token no se incluye en el
repositorio.

## Estructura

```
emanuel/
├── backend/          # API FastAPI
│   ├── app/
│   │   ├── routers/  # maps, layers, formats, ai
│   │   ├── models/   # Modelos espaciales
│   │   └── main.py   # Aplicación principal
├── frontend/         # Interfaz web
│   ├── js/           # MapLibre GL JS
│   └── css/          # Estilos
├── database/         # Scripts SQL
└── docker-compose.yml
```

## Rutas API

- `GET /api/health` - Salud del sistema
- `POST /api/v1/formats/import` - Importar archivos (KML, KMZ, GPX, CSV, GeoJSON, Shapefile)
- `POST /api/v1/formats/export/{format}` - Exportar a formato específico
- `GET /api/v1/layers` - Listar capas
- `POST /api/v1/layers` - Crear capa
- `DELETE /api/v1/layers/{id}` - Eliminar capa
- `POST /api/v1/ai/analyze` - Ejecutar análisis IA
- `POST /api/v1/maps/projects` - Crear proyecto de mapa
- `GET /api/v1/maps/projects` - Listar proyectos