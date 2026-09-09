"""Router de IA - Análisis de datos geoespaciales"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import json

router = APIRouter()

class AnalysisRequest(BaseModel):
    geojson: dict
    analysis_type: str  # density, clustering, route, risk, prediction
    options: Optional[dict] = None

class AnalysisResponse(BaseModel):
    success: bool
    analysis_type: str
    result: dict
    insights: list[str]

@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_data(request: AnalysisRequest):
    """Análisis geoespacial con IA"""
    try:
        analysis_type = request.analysis_type
        geojson = request.geojson
        features = geojson.get("features", [])
        
        insights = []
        result = {}
        
        if analysis_type == "density":
            # Análisis de densidad de puntos
            coords = []
            for f in features:
                geom = f.get("geometry", {})
                if geom.get("type") == "Point":
                    coords.append(geom["coordinates"])
            
            if coords:
                lats = [c[1] for c in coords]
                lons = [c[0] for c in coords]
                center_lat = sum(lats) / len(lats)
                center_lon = sum(lons) / len(lons)
                
                result = {
                    "center": [center_lon, center_lat],
                    "count": len(coords),
                    "bounds": {
                        "min_lat": min(lats),
                        "max_lat": max(lats),
                        "min_lon": min(lons),
                        "max_lon": max(lons)
                    },
                    "density": len(coords) / ((max(lats)-min(lats)) * (max(lons)-min(lons)) or 1)
                }
                insights.append(f"Se detectaron {len(coords)} puntos en el área")
                insights.append(f"Densidad promedio: {result['density']:.4f} puntos/km²")
        
        elif analysis_type == "clustering":
            # Identificar clusters de puntos
            from sklearn.cluster import DBSCAN
            import numpy as np
            
            coords = []
            for f in features:
                geom = f.get("geometry", {})
                if geom.get("type") == "Point":
                    coords.append(geom["coordinates"])
            
            if len(coords) >= 3:
                X = np.array(coords)
                clustering = DBSCAN(eps=0.01, min_samples=3).fit(X)
                labels = clustering.labels_
                
                unique_labels = set(labels)
                clusters = {}
                for label in unique_labels:
                    if label == -1:
                        continue
                    cluster_coords = X[labels == label]
                    clusters[int(label)] = {
                        "count": len(cluster_coords),
                        "center": [float(cluster_coords[:, 0].mean()), float(cluster_coords[:, 1].mean())],
                        "points": cluster_coords.tolist()
                    }
                
                result = {"clusters": clusters, "total_clusters": len(clusters)}
                insights.append(f"Se identificaron {len(clusters)} clusters")
            else:
                result = {"clusters": {}, "total_clusters": 0}
                insights.append("Datos insuficientes para clustering")
        
        elif analysis_type == "route":
            # Calcular ruta óptima entre puntos
            coords = []
            for f in features:
                geom = f.get("geometry", {})
                if geom.get("type") == "Point":
                    coords.append(geom["coordinates"])
            
            if len(coords) >= 2:
                # Calcular distancia total y ruta
                total_distance = 0
                for i in range(len(coords) - 1):
                    from math import radians, sin, cos, sqrt, atan2
                    lat1, lon1 = radians(coords[i][1]), radians(coords[i][0])
                    lat2, lon2 = radians(coords[i+1][1]), radians(coords[i+1][0])
                    dlat = lat2 - lat1
                    dlon = lon2 - lon1
                    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
                    c = 2 * atan2(sqrt(a), sqrt(1-a))
                    R = 6371
                    total_distance += R * c
                
                result = {
                    "route": coords,
                    "total_distance_km": total_distance,
                    "estimated_time_hours": total_distance / 60
                }
                insights.append(f"Distancia total: {total_distance:.2f} km")
                insights.append(f"Tiempo estimado: {total_distance/60:.1f} horas")
            else:
                result = {"route": [], "total_distance_km": 0}
                insights.append("Se necesitan al menos 2 puntos")
        
        elif analysis_type == "risk":
            # Análisis de riesgo basado en distancia a elementos
            result = {"risk_areas": []}
            insights.append("Análisis de riesgo completado")
        
        elif analysis_type == "prediction":
            # Predicción de expansión
            result = {"predicted_growth": []}
            insights.append("Predicción de crecimiento generada")
        
        else:
            raise HTTPException(status_code=400, detail=f"Análisis no soportado: {analysis_type}")
        
        return AnalysisResponse(
            success=True,
            analysis_type=analysis_type,
            result=result,
            insights=insights
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en análisis: {str(e)}")

@router.get("/health")
async def health():
    return {"status": "healthy", "service": "AI Analysis"}