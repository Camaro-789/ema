"""Router de conversión de formatos - Soporta KML, KMZ, GPX, CSV, GeoJSON, WKT"""
import os
import tempfile
import shutil
import csv
import zipfile
import xml.etree.ElementTree as ET
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from shapely.geometry import Point, LineString, Polygon, mapping, shape
from shapely.wkt import loads as wkt_loads
import json
import io

router = APIRouter()

SUPPORTED_FORMATS = ["kml", "kmz", "gpx", "csv", "geojson", "json", "wkt"]

def detect_format(filename: str) -> str:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "kmz": return "kmz"
    if ext == "kml": return "kml"
    if ext == "gpx": return "gpx"
    if ext == "csv": return "csv"
    if ext in ["geojson", "json"]: return "geojson"
    if ext == "wkt": return "wkt"
    return ext

def parse_kml(content: str) -> dict:
    """Parsear KML a GeoJSON"""
    root = ET.fromstring(content)
    ns = {'kml': 'http://www.opengis.net/kml/2.2'}
    features = []
    placemarks = root.findall('.//kml:Placemark', ns)
    for pm in placemarks:
        name_elem = pm.find('kml:name', ns)
        name = name_elem.text if name_elem is not None else "Sin nombre"
        desc_elem = pm.find('kml:description', ns)
        description = desc_elem.text if desc_elem is not None else ""
        
        point_elem = pm.find('.//kml:Point/kml:coordinates', ns)
        if point_elem is not None and point_elem.text:
            coords = point_elem.text.strip().split(',')
            if len(coords) >= 2:
                lon, lat = float(coords[0]), float(coords[1])
                features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": {"name": name, "description": description}})
                continue
        
        line_elem = pm.find('.//kml:LineString/kml:coordinates', ns)
        if line_elem is not None and line_elem.text:
            coord_pairs = line_elem.text.strip().split()
            coords = []
            for pair in coord_pairs:
                parts = pair.split(',')
                if len(parts) >= 2:
                    coords.append([float(parts[0]), float(parts[1])])
            if coords:
                features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": {"name": name, "description": description}})
                continue
        
        poly_elem = pm.find('.//kml:Polygon/kml:outerBoundaryIs/kml:LinearRing/kml:coordinates', ns)
        if poly_elem is not None and poly_elem.text:
            coord_pairs = poly_elem.text.strip().split()
            coords = []
            for pair in coord_pairs:
                parts = pair.split(',')
                if len(parts) >= 2:
                    coords.append([float(parts[0]), float(parts[1])])
            if coords:
                features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [coords]}, "properties": {"name": name, "description": description}})
    
    return {"type": "FeatureCollection", "features": features}

def parse_gpx(content: str) -> dict:
    """Parsear GPX a GeoJSON"""
    root = ET.fromstring(content)
    ns = {'gpx': 'http://www.topografix.com/GPX/1/1'}
    features = []
    
    for wpt in root.findall('gpx:wpt', ns):
        lat = float(wpt.get('lat', 0))
        lon = float(wpt.get('lon', 0))
        name_elem = wpt.find('gpx:name', ns)
        name = name_elem.text if name_elem is not None else "Waypoint"
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": {"name": name, "type": "waypoint"}})
    
    for trk in root.findall('gpx:trk', ns):
        name_elem = trk.find('gpx:name', ns)
        name = name_elem.text if name_elem is not None else "Track"
        for trkseg in trk.findall('gpx:trkseg', ns):
            coords = []
            for trkpt in trkseg.findall('gpx:trkpt', ns):
                lat = float(trkpt.get('lat', 0))
                lon = float(trkpt.get('lon', 0))
                coords.append([lon, lat])
            if coords:
                features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": {"name": name, "type": "track"}})
    
    for rte in root.findall('gpx:rte', ns):
        name_elem = rte.find('gpx:name', ns)
        name = name_elem.text if name_elem is not None else "Route"
        coords = []
        for rtept in rte.findall('gpx:rtept', ns):
            lat = float(rtept.get('lat', 0))
            lon = float(rtept.get('lon', 0))
            coords.append([lon, lat])
        if coords:
            features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": {"name": name, "type": "route"}})
    
    return {"type": "FeatureCollection", "features": features}

def parse_csv(content: str) -> dict:
    """Parsear CSV a GeoJSON"""
    reader = csv.DictReader(content.splitlines())
    features = []
    for row in reader:
        lat = None
        lon = None
        for key in row.keys():
            key_lower = key.lower().strip()
            if key_lower in ['lat', 'latitude', 'y']:
                try: lat = float(row[key])
                except ValueError: pass
            elif key_lower in ['lon', 'lng', 'longitude', 'x']:
                try: lon = float(row[key])
                except ValueError: pass
        if lat is not None and lon is not None:
            features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": row})
    return {"type": "FeatureCollection", "features": features}

def parse_wkt(content: str) -> dict:
    """Parsear WKT a GeoJSON"""
    features = []
    lines = content.strip().split('\n')
    for i, line in enumerate(lines):
        line = line.strip()
        if not line: continue
        try:
            geom = wkt_loads(line)
            features.append({"type": "Feature", "geometry": mapping(geom), "properties": {"id": i, "wkt": line[:100]}})
        except Exception: pass
    return {"type": "FeatureCollection", "features": features}

@router.post("/import")
async def import_format(file: UploadFile = File(...)):
    """Importar archivo y convertir a GeoJSON"""
    filename = file.filename or "data"
    fmt = detect_format(filename)
    if fmt not in SUPPORTED_FORMATS:
        raise HTTPException(status_code=400, detail=f"Formato no soportado: {fmt}")
    
    temp_dir = tempfile.mkdtemp()
    temp_path = os.path.join(temp_dir, filename)
    try:
        content = await file.read()
        if fmt == "kmz":
            with open(temp_path, "wb") as f:
                f.write(content)
            with zipfile.ZipFile(temp_path, 'r') as zf:
                kml_files = [n for n in zf.namelist() if n.lower().endswith('.kml')]
                if kml_files:
                    kml_content = zf.read(kml_files[0]).decode('utf-8')
                    geojson = parse_kml(kml_content)
                else:
                    raise HTTPException(status_code=400, detail="No se encontró KML en el KMZ")
        else:
            text_content = content.decode('utf-8')
            if fmt == "kml": geojson = parse_kml(text_content)
            elif fmt == "gpx": geojson = parse_gpx(text_content)
            elif fmt == "csv": geojson = parse_csv(text_content)
            elif fmt == "geojson": geojson = json.loads(text_content)
            elif fmt == "wkt": geojson = parse_wkt(text_content)
            else: raise HTTPException(status_code=400, detail="Formato no soportado")
        
        return JSONResponse({
            "success": True,
            "format": fmt,
            "features": len(geojson.get("features", [])),
            "geometry_types": list(set(f.get("geometry", {}).get("type") for f in geojson.get("features", []) if f.get("geometry"))),
            "geojson": geojson
        })
    except HTTPException: raise
    except Exception as e: raise HTTPException(status_code=500, detail=f"Error procesando: {str(e)}")
    finally: shutil.rmtree(temp_dir, ignore_errors=True)

@router.post("/export/{format}")
async def export_format(data: dict, format: str):
    """Exportar datos a formato específico"""
    if format not in SUPPORTED_FORMATS:
        raise HTTPException(status_code=400, detail=f"Formato no soportado: {format}")
    try:
        features = data.get("features", [])
        if format == "geojson":
            return JSONResponse({"type": "FeatureCollection", "features": features})
        elif format == "kml":
            kml_parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2">', '<Document>']
            for feat in features:
                props = feat.get("properties", {})
                name = props.get("name", "Feature")
                geom = feat.get("geometry", {})
                geom_type = geom.get("type", "")
                coords = geom.get("coordinates", [])
                kml_parts.append('<Placemark>')
                kml_parts.append(f'<name>{name}</name>')
                if geom_type == "Point" and len(coords) >= 2:
                    kml_parts.append(f'<Point><coordinates>{coords[0]},{coords[1]}</coordinates></Point>')
                elif geom_type == "LineString":
                    coord_str = " ".join([f"{c[0]},{c[1]}" for c in coords])
                    kml_parts.append(f'<LineString><coordinates>{coord_str}</coordinates></LineString>')
                elif geom_type == "Polygon":
                    rings = coords[0] if coords else []
                    coord_str = " ".join([f"{c[0]},{c[1]}" for c in rings])
                    kml_parts.append(f'<Polygon><outerBoundaryIs><LinearRing><coordinates>{coord_str}</coordinates></LinearRing></outerBoundaryIs></Polygon>')
                kml_parts.append('</Placemark>')
            kml_parts.append('</Document>')
            kml_parts.append('</kml>')
            return JSONResponse({"format": "kml", "content": "\n".join(kml_parts)})
        elif format == "csv":
            rows = []
            for feat in features:
                props = feat.get("properties", {})
                geom = feat.get("geometry", {})
                coords = geom.get("coordinates", [])
                row = props.copy()
                if geom.get("type") == "Point" and len(coords) >= 2:
                    row["lon"] = coords[0]
                    row["lat"] = coords[1]
                rows.append(row)
            if rows:
                output = io.StringIO()
                writer = csv.DictWriter(output, fieldnames=rows[0].keys())
                writer.writeheader()
                writer.writerows(rows)
                content = output.getvalue()
            else:
                content = ""
            return JSONResponse({"format": "csv", "content": content})
        elif format == "wkt":
            wkt_lines = []
            for feat in features:
                geom = feat.get("geometry", {})
                if geom:
                    try:
                        s = shape(geom)
                        wkt_lines.append(s.wkt)
                    except Exception: pass
            return JSONResponse({"format": "wkt", "content": "\n".join(wkt_lines)})
        else:
            raise HTTPException(status_code=400, detail="Formato no implementado")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error exportando: {str(e)}")

@router.get("/formats")
async def list_formats():
    return {"supported": SUPPORTED_FORMATS}

