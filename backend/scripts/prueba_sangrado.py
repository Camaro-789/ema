"""
prueba_sangrado.py - Test suite for sangrado intermedio de hilos de fibra
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
from app.database import SessionLocal
from app.main import app
import app.models.ftth_models as fisicos
import app.models.ftth_logica as logica

R = {"ok": 0, "fallos": []}

def check(cond, msg, detalle=""):
    if cond:
        R["ok"] += 1
        print(f"  [OK]    {msg}")
    else:
        R["fallos"].append(msg)
        print(f"  [FALLO] {msg}")
        if detalle:
            print(f"          {detalle}")

class ClienteSync:
    def _req(self, metodo, url, **kw):
        async def _do():
            transporte = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transporte, base_url="http://test") as cliente:
                res = await cliente.request(metodo, url, **kw)
                return res
        return asyncio.run(_do())

    def get(self, url, **kw): return self._req("GET", url, **kw)
    def post(self, url, **kw): return self._req("POST", url, **kw)
    def put(self, url, **kw): return self._req("PUT", url, **kw)
    def delete(self, url, **kw): return self._req("DELETE", url, **kw)

import asyncio
CLIENTE = ClienteSync()

def main():
    db = SessionLocal()
    try:
        proj = db.query(logica.FtthSecuencia).first()
        proyecto_id = proj.proyecto_id if proj else 1

        print("\n==========================================================================")
        print(f"PRUEBA DE SANGRADO INTERMEDIO — proyecto {proyecto_id}")
        print("==========================================================================")

        # Buscar o crear tipos para la prueba
        tipo_caja = db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.proyecto_id == proyecto_id, fisicos.FtthTipo.categoria == "cajanap").first()
        if not tipo_caja:
            tipo_caja = fisicos.FtthTipo(proyecto_id=proyecto_id, categoria="cajanap", nombre_id="NAP Test", propiedades={"puertos": 16})
            db.add(tipo_caja); db.commit(); db.refresh(tipo_caja)

        tipo_cable = db.query(fisicos.FtthTipo).filter(fisicos.FtthTipo.proyecto_id == proyecto_id, fisicos.FtthTipo.categoria == "cables").first()
        if not tipo_cable:
            tipo_cable = fisicos.FtthTipo(proyecto_id=proyecto_id, categoria="cables", nombre_id="Cable Test", propiedades={"fibras": 12, "looses": 1, "estructura": "con_buffer"})
            db.add(tipo_cable); db.commit(); db.refresh(tipo_cable)

        # Crear 2 cajas en el proyecto
        caja1_res = CLIENTE.post("/api/elementos/", json={
            "proyecto_id": proyecto_id,
            "tipo_id": tipo_caja.id,
            "categoria": "cajanap",
            "lat": 7.771, "lon": -72.231,
            "propiedades_instancia": {"nombre": "Caja Sangrado 1"}
        })
        caja1_id = caja1_res.json()["properties"]["id"]

        caja2_res = CLIENTE.post("/api/elementos/", json={
            "proyecto_id": proyecto_id,
            "tipo_id": tipo_caja.id,
            "categoria": "cajanap",
            "lat": 7.772, "lon": -72.232,
            "propiedades_instancia": {"nombre": "Caja Sangrado 2"}
        })
        caja2_id = caja2_res.json()["properties"]["id"]

        # Crear cable con 12 hilos pasando por ambas cajas
        cable_res = CLIENTE.post("/api/elementos/", json={
            "proyecto_id": proyecto_id,
            "tipo_id": tipo_cable.id,
            "categoria": "cables",
            "coords_json": [[-72.231, 7.771], [-72.232, 7.772]],
            "propiedades_instancia": {"nombre": "Cable 12H Sangrado", "postes_intermedios": [caja1_id, caja2_id]}
        })
        cable_id = cable_res.json()["properties"]["id"]

        # Materializar hilos del cable
        CLIENTE.post(f"/api/cables/{cable_id}/materializar-hilos")

        # Obtener hilos
        hilos_res = CLIENTE.get(f"/api/cables/{cable_id}/hilos")
        hilos_tree = hilos_res.json()
        todos_hilos = [h for t in hilos_tree.get("tubos", []) for h in t.get("hilos", [])]
        total_hilos = len(todos_hilos)
        check(total_hilos > 0, f"El cable creó {total_hilos} hilos", f"hilos={total_hilos}")

        # 1. Verificar que en Caja 1 todos los hilos se ven "De paso" (nodoB_id == None)
        nodo1_res = CLIENTE.get(f"/api/elementos/{caja1_id}/nodo")
        dto1 = nodo1_res.json()
        hilos_caja1 = dto1.get("hilos_que_terminan", [])
        de_paso_c1 = [h for h in hilos_caja1 if h.get("de_paso")]
        check(len(de_paso_c1) == total_hilos, f"En Caja 1 los {total_hilos} hilos se ven 'De paso'", f"paso={len(de_paso_c1)}")

        # 2. Sangrar 4 hilos en Caja 1 mediante endpoint bulk
        hilos_a_sangrar = [h["id"] for h in todos_hilos[:4]]
        sangrar_res = CLIENTE.post(f"/api/elementos/{caja1_id}/cables/{cable_id}/sangrar", json={"hilos": hilos_a_sangrar})
        check(sangrar_res.status_code == 200, "Endpoint /sangrar en Caja 1 respondió 200", sangrar_res.text)

        # 3. Comprobar en Caja 1 que 4 son sangrados_aquí y el resto son de_paso
        nodo1_res2 = CLIENTE.get(f"/api/elementos/{caja1_id}/nodo")
        dto1_2 = nodo1_res2.json()
        hilos_c1_post = dto1_2.get("hilos_que_terminan", [])
        sangrados_c1 = [h for h in hilos_c1_post if h.get("sangrado_aqui")]
        de_paso_c1_post = [h for h in hilos_c1_post if h.get("de_paso")]
        check(len(sangrados_c1) == 4, "En Caja 1 hay 4 hilos sangrados aquí", f"sangrados={len(sangrados_c1)}")
        check(len(de_paso_c1_post) == total_hilos - 4, f"En Caja 1 quedan {total_hilos - 4} hilos de paso", f"paso={len(de_paso_c1_post)}")

        # 4. Comprobar la Regla de Visibilidad en Caja 2: Los 4 hilos sangrados en Caja 1 NO se muestran en Caja 2
        nodo2_res = CLIENTE.get(f"/api/elementos/{caja2_id}/nodo")
        dto2 = nodo2_res.json()
        hilos_caja2 = dto2.get("hilos_que_terminan", [])
        ids_en_caja2 = [h["fibra_id"] for h in hilos_caja2]
        check(len(hilos_caja2) == total_hilos - 4, f"En Caja 2 se muestran solo los {total_hilos - 4} hilos restantes de paso (4 omitidos)", f"hilos={len(hilos_caja2)}")
        check(not any(fid in ids_en_caja2 for fid in hilos_a_sangrar), "Ninguno de los 4 hilos sangrados en Caja 1 aparece en Caja 2")

        # 5. Comprobar la Regla Global de Validación: Intentar sangrar en Caja 2 uno de los 4 hilos sangrados en Caja 1 debe dar HTTP 400
        reintento_res = CLIENTE.put(f"/api/fibras/{hilos_a_sangrar[0]}/extremos/B", json={"nodo_id": caja2_id})
        check(reintento_res.status_code == 400, "Reintentar sangrar en Caja 2 un hilo ya sangrado en Caja 1 devuelve HTTP 400", f"status={reintento_res.status_code} msg={reintento_res.text}")
        check("ya se encuentra sangrado" in reintento_res.text, "El error explica claramente que ya se encuentra sangrado")

        # 6. Limpieza
        CLIENTE.delete(f"/api/elementos/{caja1_id}")
        CLIENTE.delete(f"/api/elementos/{caja2_id}")
        CLIENTE.delete(f"/api/elementos/{cable_id}")
        print("  [OK]    Limpieza completada")

        print("\n" + "=" * 74)
        print(f"RESULTADO: {R['ok']} comprobaciones OK, {len(R['fallos'])} fallos")
        print("=" * 74)
    finally:
        db.close()

if __name__ == "__main__":
    main()
