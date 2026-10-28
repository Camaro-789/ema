"""
prueba_cable_extremos_bidireccional.py

Prueba completa del modelo simplificado de cables FTTH:
1. Crear dos nodos reales (Caja A y Caja B).
2. Trazar cable conectando A (extremo_A_id) y B (extremo_B_id).
3. Verificar auto-materialización inmediata de tubos, hilos y extremos en BD.
4. Abrir diagrama del Nodo A -> ver el cable con su diseño visual completo (12 hilos, extremo A, colores).
5. Abrir diagrama del Nodo B -> ver el mismo cable con su diseño visual completo (12 hilos, extremo B, colores).
"""
import sys
import os
import asyncio

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

CLIENTE = ClienteSync()

def main():
    db = SessionLocal()
    try:
        proj = db.query(logica.FtthSecuencia).first()
        proyecto_id = proj.proyecto_id if proj else 1

        print("\n==========================================================================")
        print(f"PRUEBA DE CABLE BIDIRECCIONAL (MODELO SIMPLE) — proyecto {proyecto_id}")
        print("==========================================================================")

        # 1. Buscar o crear tipos de catálogo
        tipo_caja = db.query(fisicos.FtthTipo).filter(
            fisicos.FtthTipo.proyecto_id == proyecto_id, fisicos.FtthTipo.categoria == "cajanap"
        ).first()
        if not tipo_caja:
            tipo_caja = fisicos.FtthTipo(
                proyecto_id=proyecto_id, categoria="cajanap", nombre_id="NAP 16P Test",
                propiedades={"puertos": 16, "capacidad_puertos": 16}
            )
            db.add(tipo_caja); db.commit(); db.refresh(tipo_caja)

        tipo_cable = db.query(fisicos.FtthTipo).filter(
            fisicos.FtthTipo.proyecto_id == proyecto_id, fisicos.FtthTipo.categoria == "cables"
        ).first()
        if not tipo_cable:
            tipo_cable = fisicos.FtthTipo(
                proyecto_id=proyecto_id, categoria="cables", nombre_id="ADSS 12H Test",
                propiedades={"fibras": 12, "looses": 1, "estructura": "con_buffer", "plantilla_visual": "fibra_cable"}
            )
            db.add(tipo_cable); db.commit(); db.refresh(tipo_cable)

        tipo_poste = db.query(fisicos.FtthTipo).filter(
            fisicos.FtthTipo.proyecto_id == proyecto_id, fisicos.FtthTipo.categoria == "poste"
        ).first()
        if not tipo_poste:
            tipo_poste = fisicos.FtthTipo(
                proyecto_id=proyecto_id, categoria="poste", nombre_id="Poste Test",
                propiedades={"altura_m": 9}
            )
            db.add(tipo_poste); db.commit(); db.refresh(tipo_poste)

        # Todo lo que creen las secciones nuevas se borra al final (pase o falle).
        creados_extra = []

        # 2. Crear Nodo A y Nodo B
        caja_A_res = CLIENTE.post("/api/elementos/", json={
            "proyecto_id": proyecto_id, "tipo_id": tipo_caja.id, "categoria": "cajanap",
            "lat": 7.7710, "lon": -72.2310, "propiedades_instancia": {"nombre": "Caja NAP A (Origen)"}
        })
        caja_A_id = caja_A_res.json()["properties"]["id"]
        check(caja_A_id > 0, f"Nodo A creado con ID #{caja_A_id}")

        caja_B_res = CLIENTE.post("/api/elementos/", json={
            "proyecto_id": proyecto_id, "tipo_id": tipo_caja.id, "categoria": "cajanap",
            "lat": 7.7720, "lon": -72.2320, "propiedades_instancia": {"nombre": "Caja NAP B (Destino)"}
        })
        caja_B_id = caja_B_res.json()["properties"]["id"]
        check(caja_B_id > 0, f"Nodo B creado con ID #{caja_B_id}")

        # 3. Trazar cable conectando A (origen) con B (destino)
        cable_res = CLIENTE.post("/api/elementos/", json={
            "proyecto_id": proyecto_id,
            "tipo_id": tipo_cable.id,
            "categoria": "cables",
            "coords_json": [[-72.2310, 7.7710], [-72.2320, 7.7720]],
            "propiedades_instancia": {
                "nombre": "Cable Troncal A-B 12H",
                "extremo_A_id": caja_A_id,
                "extremo_B_id": caja_B_id,
                "reserva_A_m": 15,
                "reserva_B_m": 10,
            }
        })
        cable_data = cable_res.json()
        cable_id = cable_data["properties"]["id"]
        check(cable_id > 0, f"Cable creado con ID #{cable_id}")

        # 4. Verificar auto-materialización en base de datos (sin llamada manual)
        hilos_res = CLIENTE.get(f"/api/cables/{cable_id}/hilos")
        hilos_tree = hilos_res.json()
        tubos = hilos_tree.get("tubos", [])
        todos_hilos = [h for t in tubos for h in t.get("hilos", [])]
        check(len(todos_hilos) == 12, f"Auto-materialización: el cable tiene 12 hilos en BD (obtenido: {len(todos_hilos)})")

        primer_hilo = todos_hilos[0] if todos_hilos else {}
        extA_nodo = (primer_hilo.get("extremos") or {}).get("A", {}).get("nodo_id")
        extB_nodo = (primer_hilo.get("extremos") or {}).get("B", {}).get("nodo_id")
        check(extA_nodo == caja_A_id, f"Extremo A de los hilos apunta automáticamente a Nodo A #{caja_A_id}")
        check(extB_nodo == caja_B_id, f"Extremo B de los hilos apunta automáticamente a Nodo B #{caja_B_id}")

        # 5. Abrir diagrama del Nodo A
        nodo_A_res = CLIENTE.get(f"/api/elementos/{caja_A_id}/nodo")
        dto_A = nodo_A_res.json()
        hilos_A = dto_A.get("hilos_que_terminan", [])
        check(len(hilos_A) == 12, f"Diagrama de Nodo A muestra los 12 hilos de inmediato (obtenido: {len(hilos_A)})")
        check(all(h.get("extremo") == "A" for h in hilos_A), "En Nodo A todos los hilos indican extremo 'A'")
        
        tipo_A = (hilos_A[0].get("cable_tipo") or {}) if hilos_A else {}
        check(tipo_A.get("fibras") == 12, "cable_tipo en Nodo A contiene fibras=12")
        check(tipo_A.get("plantilla_visual") == "fibra_cable", "cable_tipo en Nodo A contiene plantilla_visual='fibra_cable'")
        check(tipo_A.get("extremo_A_id") == caja_A_id, "cable_tipo en Nodo A contiene extremo_A_id correcto")
        check(tipo_A.get("extremo_B_id") == caja_B_id, "cable_tipo en Nodo A contiene extremo_B_id correcto")

        # 6. Abrir diagrama del Nodo B
        nodo_B_res = CLIENTE.get(f"/api/elementos/{caja_B_id}/nodo")
        dto_B = nodo_B_res.json()
        hilos_B = dto_B.get("hilos_que_terminan", [])
        check(len(hilos_B) == 12, f"Diagrama de Nodo B muestra el mismo cable con sus 12 hilos (obtenido: {len(hilos_B)})")
        check(all(h.get("extremo") == "B" for h in hilos_B), "En Nodo B todos los hilos indican extremo 'B'")

        tipo_B = (hilos_B[0].get("cable_tipo") or {}) if hilos_B else {}
        check(tipo_B.get("fibras") == 12, "cable_tipo en Nodo B contiene fibras=12")
        check(tipo_B.get("plantilla_visual") == "fibra_cable", "cable_tipo en Nodo B contiene plantilla_visual='fibra_cable'")
        check(tipo_B.get("extremo_A_id") == caja_A_id, "cable_tipo en Nodo B contiene extremo_A_id correcto")
        check(tipo_B.get("extremo_B_id") == caja_B_id, "cable_tipo en Nodo B contiene extremo_B_id correcto")

        # ══════════════════════════════════════════════════════════════════════
        # 7) DIVIDIR: caja en un poste INTERMEDIO de la ruta
        # ══════════════════════════════════════════════════════════════════════
        print("\n7) DIVIDIR: caja en un poste INTERMEDIO (el cable se parte en dos)")

        def crear_elemento(categoria, tipo_id, lon, lat, nombre, poste_ref_id=None, extra=None):
            props = {"nombre": nombre}
            props.update(extra or {})
            cuerpo = {
                "proyecto_id": proyecto_id, "tipo_id": tipo_id, "categoria": categoria,
                "lon": lon, "lat": lat, "propiedades_instancia": props,
            }
            if poste_ref_id:
                cuerpo["poste_ref_id"] = poste_ref_id
            r = CLIENTE.post("/api/elementos/", json=cuerpo)
            if r.status_code != 200:
                print(f"        (no se pudo crear «{nombre}»: {r.status_code} {r.text[:160]})")
                return None
            fid = r.json()["properties"]["id"]
            creados_extra.append(fid)
            return fid

        def crear_cable(nombre, coords, extra):
            props = {"nombre": nombre}
            props.update(extra)
            r = CLIENTE.post("/api/elementos/", json={
                "proyecto_id": proyecto_id, "tipo_id": tipo_cable.id, "categoria": "cables",
                "coords_json": coords, "propiedades_instancia": props,
            })
            if r.status_code != 200:
                print(f"        (no se pudo crear el cable «{nombre}»: {r.status_code} {r.text[:160]})")
                return None
            fid = r.json()["properties"]["id"]
            creados_extra.append(fid)
            return fid

        # Ruta A(caja) → p1 → p2 → p3 → B(caja), en línea recta
        LAT = 7.7700
        lonA, lonP1, lonP2, lonP3, lonB = -72.2300, -72.2310, -72.2320, -72.2330, -72.2340
        cajaA = crear_elemento("cajanap", tipo_caja.id, lonA, LAT, "Caja A (división)")
        p1 = crear_elemento("poste", tipo_poste.id, lonP1, LAT, "Poste Div 1")
        p2 = crear_elemento("poste", tipo_poste.id, lonP2, LAT, "Poste Div 2")
        p3 = crear_elemento("poste", tipo_poste.id, lonP3, LAT, "Poste Div 3")
        cajaB = crear_elemento("cajanap", tipo_caja.id, lonB, LAT, "Caja B (división)")
        if all([cajaA, p1, p2, p3, cajaB]):
            cable = crear_cable("Cable Troncal (división)",
                                [[lonA, LAT], [lonP1, LAT], [lonP2, LAT], [lonP3, LAT], [lonB, LAT]],
                                {"extremo_A_id": cajaA, "extremo_B_id": cajaB,
                                 "reserva_A_m": 15, "reserva_B_m": 10,
                                 "postes_intermedios": [p1, p2, p3],
                                 "trazado_ruta": [{"poste": cajaA}, {"poste": p1}, {"poste": p2},
                                                  {"poste": p3}, {"poste": cajaB}]})
            # La caja nueva se coloca SOBRE el poste intermedio p2
            cajaC = crear_elemento("cajanap", tipo_caja.id, lonP2, LAT, "Caja Intermedia", poste_ref_id=p2)
            if cable and cajaC:
                f_cable = CLIENTE.get(f"/api/elementos/{cable}").json()
                numero_original = (f_cable["properties"].get("propiedades_instancia") or {}).get("numero")
                dto_antes = CLIENTE.get(f"/api/elementos/{cajaC}/nodo").json()
                divs = dto_antes.get("cables_divisibles", [])
                check(len(divs) == 1, "El diagrama de la caja OFRECE el cable divisible", str(divs))
                if divs:
                    check(divs[0]["accion"] == "dividir", "La acción ofrecida es «dividir»", str(divs[0]))
                    check(divs[0]["posicion"] == 1 and divs[0]["total_postes"] == 3,
                          "El corte se ofrece en el poste interior (2.o de 3)", str(divs[0]))

                r_div = CLIENTE.post(f"/api/elementos/{cajaC}/cables/{cable}/dividir")
                check(r_div.status_code == 200, "POST /dividir responde 200",
                      f"status={r_div.status_code} {r_div.text[:200]}")

                # F4: el CORTE deja EMPALMES de paso (los hilos quedan fusionados)
                cuerpo_corte = r_div.json() if r_div.status_code == 200 else {}
                check(cuerpo_corte.get("modo") in (None, "corte"),
                      "Sin cuerpo, la división es CORTE (compatible con lo de antes)",
                      str(cuerpo_corte.get("modo")))
                emp_corte = cuerpo_corte.get("empalmes", [])
                check(len(emp_corte) == 12
                      and all(e["tipo"] == "paso" and e["fibra_b_id"] for e in emp_corte),
                      "El CORTE crea 12 empalmes de PASO (el que llega ↔ el que sigue)",
                      str(emp_corte)[:160])
                dto_corte = CLIENTE.get(f"/api/elementos/{cajaC}/nodo").json()
                slots_corte = [e for b in dto_corte.get("bandejas", [])
                               for e in b.get("empalmes", [])]
                check(dto_corte.get("resumen", {}).get("empalmes") == 12 and len(slots_corte) == 12,
                      "El DTO del nodo pinta los 12 empalmes en la bandeja",
                      f"resumen={dto_corte.get('resumen', {}).get('empalmes')} slots={len(slots_corte)}")
                nuevos = r_div.json().get("cables", []) if r_div.status_code == 200 else []
                check(len(nuevos) == 2, "Se crearon DOS cables", str(nuevos)[:200])
                if len(nuevos) == 2:
                    c1, c2 = nuevos[0], nuevos[1]
                    creados_extra.extend([c1["id"], c2["id"]])
                    check(CLIENTE.get(f"/api/elementos/{cable}").status_code == 404,
                          "El cable original se borró")
                    check(c1["extremo_A_id"] == cajaA and c1["extremo_B_id"] == cajaC,
                          "Cable 1: del extremo A original a la caja nueva", str(c1)[:180])
                    check(c2["extremo_A_id"] == cajaC and c2["extremo_B_id"] == cajaB,
                          "Cable 2: de la caja nueva al extremo B original", str(c2)[:180])
                    check(c1["postes_intermedios"] == [p1, p2] and c2["postes_intermedios"] == [p2, p3],
                          "Cada cable se queda con su parte de postes (el del corte en AMBOS)",
                          f"{c1['postes_intermedios']} / {c2['postes_intermedios']}")
                    check(c1["hilos"] == 12 and c2["hilos"] == 12,
                          "Cada cable nuevo materializó sus 12 hilos", f"{c1['hilos']} / {c2['hilos']}")
                    check(c1["numero"] == numero_original and c2["numero"] != numero_original,
                          "Cable 1 conserva el número visible y cable 2 toma uno nuevo",
                          f"{c1['numero']} / {c2['numero']} (original {numero_original})")

                    arbol1 = CLIENTE.get(f"/api/cables/{c1['id']}/hilos").json()
                    arbol2 = CLIENTE.get(f"/api/cables/{c2['id']}/hilos").json()
                    check(arbol1.get("extremo_A_id") == cajaA and arbol1.get("extremo_B_id") == cajaC,
                          "Hilos del cable 1 anclados A→A original y B→caja",
                          str([arbol1.get("extremo_A_id"), arbol1.get("extremo_B_id")]))
                    check(arbol2.get("extremo_A_id") == cajaC and arbol2.get("extremo_B_id") == cajaB,
                          "Hilos del cable 2 anclados A→caja y B→B original",
                          str([arbol2.get("extremo_A_id"), arbol2.get("extremo_B_id")]))
                    hilos1 = [h for t in arbol1.get("tubos", []) for h in t.get("hilos", [])]
                    ext_b_hilo = ((hilos1[0].get("extremos") or {}).get("B") or {}).get("nodo_id") if hilos1 else None
                    check(ext_b_hilo == cajaC,
                          "Cada hilo (no solo el cable) quedó anclado a la caja", str(ext_b_hilo))

                    f1 = CLIENTE.get(f"/api/elementos/{c1['id']}").json()
                    f2 = CLIENTE.get(f"/api/elementos/{c2['id']}").json()
                    n1 = len((f1.get("geometry") or {}).get("coordinates") or [])
                    n2 = len((f2.get("geometry") or {}).get("coordinates") or [])
                    check(n1 == 3 and n2 == 3,
                          "Cada cable trae su geometría propia (3 vértices)", f"{n1} / {n2}")

                    dA = CLIENTE.get(f"/api/elementos/{cajaA}/nodo").json()
                    dC = CLIENTE.get(f"/api/elementos/{cajaC}/nodo").json()
                    dB = CLIENTE.get(f"/api/elementos/{cajaB}/nodo").json()
                    hA = dA.get("hilos_que_terminan", [])
                    hC = dC.get("hilos_que_terminan", [])
                    hB = dB.get("hilos_que_terminan", [])
                    check(len(hA) == 12 and all(h["cable_id"] == c1["id"] and h["extremo"] == "A" for h in hA),
                          "Diagrama de A: 12 hilos del cable 1 (extremo A)", f"hilos={len(hA)}")
                    check(len(hB) == 12 and all(h["cable_id"] == c2["id"] and h["extremo"] == "B" for h in hB),
                          "Diagrama de B: 12 hilos del cable 2 (extremo B)", f"hilos={len(hB)}")
                    por_cable = {}
                    for h in hC:
                        por_cable.setdefault(h["cable_id"], set()).add(h["extremo"])
                    check(len(hC) == 24, "Diagrama de la caja intermedia: los DOS cables (24 hilos)",
                          f"hilos={len(hC)}")
                    check(por_cable.get(c1["id"]) == {"B"} and por_cable.get(c2["id"]) == {"A"},
                          "En la caja intermedia: cable 1 termina (B) y cable 2 sale (A)", str(por_cable))
                    # El LADO que pinta el lienzo: el tramo que llega va a ENTRADA
                    # (izquierda) y el que sale a SALIDA (derecha). Lo decide el backend.
                    check(all(h.get("lado") == "entrada" for h in hC if h["cable_id"] == c1["id"])
                          and all(h.get("lado") == "salida" for h in hC if h["cable_id"] == c2["id"]),
                          "En la caja intermedia: el tramo que LLEGA es ENTRADA y el que SALE es SALIDA",
                          str(sorted({(h["cable_id"], h.get("lado")) for h in hC})))
                    check(dC.get("cables_divisibles") == [],
                          "Ya no se ofrece volver a dividir en esa misma caja",
                          str(dC.get("cables_divisibles"))[:120])

        # ══════════════════════════════════════════════════════════════════════
        # 7b) SANGRADO (janela): se pican SOLO las fibras elegidas
        # ══════════════════════════════════════════════════════════════════════
        print("\n7b) SANGRADO (janela): se pican solo las fibras elegidas")
        if p1 and p2 and p3 and cajaC:
            cable_s = crear_cable("Cable para sangrar",
                                  [[lonP1, LAT], [lonP2, LAT], [lonP3, LAT]],
                                  {"postes_intermedios": [p1, p2, p3],
                                   "trazado_ruta": [{"poste": p1}, {"poste": p2}, {"poste": p3}]})
            if cable_s:
                arbol_s = CLIENTE.get(f"/api/cables/{cable_s}/hilos").json()
                fibras_s = [h["id"] for t in arbol_s.get("tubos", []) for h in t.get("hilos", [])]
                r_s = CLIENTE.post(f"/api/elementos/{cajaC}/cables/{cable_s}/dividir",
                                   json={"modo": "sangrado", "fibras": fibras_s[:3],
                                         "lado": "entrada"})
                check(r_s.status_code == 200, "POST /dividir (sangrado) responde 200", r_s.text[:160])
                cuerpo_s = r_s.json() if r_s.status_code == 200 else {}
                emp_s = cuerpo_s.get("empalmes", [])
                picados = [e for e in emp_s if e["tipo"] == "sangrado"]
                pasos = [e for e in emp_s if e["tipo"] == "paso"]
                check(len(picados) == 3 and all(e["fibra_b_id"] is None for e in picados),
                      "El SANGRADO deja 3 fibras PICADAS (abiertas, sin hilo B)",
                      str(picados)[:160])
                check(len(pasos) == 9,
                      "Las otras 9 fibras SIGUEN de paso (empalmadas)", f"pasos={len(pasos)}")
                check(cuerpo_s.get("lado") == "entrada" and len(cuerpo_s.get("cables", [])) == 2,
                      "El sangrado también parte el cable en dos tramos",
                      str(cuerpo_s.get("cables"))[:120])
                creados_extra.extend([cable_s] + [c["id"] for c in cuerpo_s.get("cables", [])])

        # ══════════════════════════════════════════════════════════════════════
        # 8) ASIGNAR: caja en un poste EXTREMO (no se divide)
        # ══════════════════════════════════════════════════════════════════════
        print("\n8) ASIGNAR: caja en un poste EXTREMO (no se divide, se asigna el extremo)")
        lonq1, lonq2, lonq3 = -72.2400, -72.2410, -72.2420
        cajaD = crear_elemento("cajanap", tipo_caja.id, -72.2390, LAT, "Caja D (extremo)")
        q1 = crear_elemento("poste", tipo_poste.id, lonq1, LAT, "Poste Ext 1")
        q2 = crear_elemento("poste", tipo_poste.id, lonq2, LAT, "Poste Ext 2")
        q3 = crear_elemento("poste", tipo_poste.id, lonq3, LAT, "Poste Ext 3")
        if all([cajaD, q1, q2, q3]):
            ruta_ext = [{"poste": cajaD}, {"poste": q1}, {"poste": q2}, {"poste": q3}]
            coords_ext = [[-72.2390, LAT], [lonq1, LAT], [lonq2, LAT], [lonq3, LAT]]
            # (b1) el extremo B quedó SIN nodo (el trazado terminó en el poste)
            cableB1 = crear_cable("Cable a extremo (B sin nodo)", coords_ext,
                                  {"extremo_A_id": cajaD, "postes_intermedios": [q1, q2, q3],
                                   "trazado_ruta": ruta_ext})
            # (b2) el extremo B apunta al PROPIO poste (lo que hace hoy el mapa al terminar en un poste)
            cableB2 = crear_cable("Cable a extremo (B=poste)", coords_ext,
                                  {"extremo_A_id": cajaD, "extremo_B_id": q3,
                                   "postes_intermedios": [q1, q2, q3], "trazado_ruta": ruta_ext})
            cajaE = crear_elemento("cajanap", tipo_caja.id, lonq3, LAT,
                                   "Caja en poste extremo", poste_ref_id=q3)
            if cableB1 and cableB2 and cajaE:
                dtoE = CLIENTE.get(f"/api/elementos/{cajaE}/nodo").json()
                divsE = {d["cable_id"]: d for d in dtoE.get("cables_divisibles", [])}
                check(divsE.get(cableB1, {}).get("accion") == "asignar_extremo"
                      and divsE.get(cableB1, {}).get("extremo") == "B",
                      "Con el extremo B SIN nodo, la caja ofrece ASIGNAR el extremo B",
                      str(divsE.get(cableB1)))
                check(divsE.get(cableB2, {}).get("accion") == "asignar_extremo"
                      and divsE.get(cableB2, {}).get("extremo") == "B",
                      "Con el extremo B apuntando al poste, la caja también ofrece ASIGNAR",
                      str(divsE.get(cableB2)))
                check(all(d["accion"] != "dividir" for d in divsE.values()),
                      "En un poste EXTREMO no se ofrece dividir", str(divsE)[:160])
                check(all(d.get("lado") == "entrada" for d in divsE.values()),
                      "La caja EXTREMO ofrece el cable en el lado ENTRADA (llega por su B)",
                      str([(d["cable_id"], d.get("lado")) for d in divsE.values()]))

                r_no = CLIENTE.post(f"/api/elementos/{cajaE}/cables/{cableB1}/dividir")
                check(r_no.status_code == 400,
                      "Dividir en el poste extremo responde 400 (no se parte)",
                      f"status={r_no.status_code}")
                detalle = (r_no.json().get("detail") or "") if r_no.status_code == 400 else ""
                check("extremo B" in detalle,
                      "El error explica que ese extremo se ASIGNA (no se divide)", detalle[:160])

                for cid in (cableB1, cableB2):
                    r_put = CLIENTE.put(f"/api/elementos/{cid}", json={"extremo_B_id": cajaE})
                    check(r_put.status_code == 200,
                          f"PUT del extremo B a la caja responde 200 (cable #{cid})",
                          f"status={r_put.status_code}")
                check(CLIENTE.get(f"/api/elementos/{cableB1}").status_code == 200,
                      "El cable NO se borró: sigue siendo un solo cable (no hubo división)")
                arbolB = CLIENTE.get(f"/api/cables/{cableB1}/hilos").json()
                check(arbolB.get("extremo_B_id") == cajaE,
                      "El cable ahora apunta a la caja por su extremo B", str(arbolB.get("extremo_B_id")))
                hilosB = [h for t in arbolB.get("tubos", []) for h in t.get("hilos", [])]
                ext_b = ((hilosB[0].get("extremos") or {}).get("B") or {}).get("nodo_id") if hilosB else None
                check(ext_b == cajaE, "Los 12 hilos quedaron anclados al nodo (extremo B)", str(ext_b))
                dE = CLIENTE.get(f"/api/elementos/{cajaE}/nodo").json()
                hE = [h for h in dE.get("hilos_que_terminan", []) if h["cable_id"] == cableB1]
                check(len(hE) == 12 and all(h["extremo"] == "B" for h in hE),
                      "El diagrama de la caja ya muestra los 12 hilos (extremo B)", f"hilos={len(hE)}")

        # ══════════════════════════════════════════════════════════════════════
        # 8b) La caja colocada CERCA del poste se ancla sola (sin poste_ref_id)
        # ══════════════════════════════════════════════════════════════════════
        print("\n8b) La caja colocada cerca del poste se ANCLA sola (sin poste_ref_id)")
        if q3:
            f_q3 = CLIENTE.get(f"/api/elementos/{q3}").json()
            lonq3, latq3 = f_q3["geometry"]["coordinates"]
            r_auto = CLIENTE.post("/api/elementos/", json={
                "proyecto_id": proyecto_id, "tipo_id": tipo_caja.id, "categoria": "cajanap",
                "lon": lonq3, "lat": latq3,
                "propiedades_instancia": {"nombre": "Caja auto-anclada (sin poste_ref_id)"},
            })
            check(r_auto.status_code == 200, "Se crea la caja SIN poste_ref_id (clic junto al poste)",
                  f"status={r_auto.status_code}")
            if r_auto.status_code == 200:
                caja_auto = r_auto.json()["properties"]["id"]
                creados_extra.append(caja_auto)
                poste_ref = r_auto.json()["properties"].get("poste_ref_id")
                check(poste_ref == q3,
                      "El backend le asigna el poste más cercano (poste_ref_id automático)",
                      f"poste_ref_id={poste_ref} (esperado {q3})")
                dto_auto = CLIENTE.get(f"/api/elementos/{caja_auto}/nodo").json()
                divs_auto = [d for d in dto_auto.get("cables_divisibles", [])
                             if d["cable_id"] in (cableB1, cableB2)]
                check(len(divs_auto) >= 1 and divs_auto[0]["accion"] in ("dividir", "asignar_extremo"),
                      "La caja anclada sola ya VE el cable en cables_divisibles y ofrece su acción",
                      str(divs_auto))

        # 9. Limpieza: primero lo que crearon las secciones nuevas, después la base
        for fid in reversed(creados_extra):
            CLIENTE.delete(f"/api/elementos/{fid}")
        CLIENTE.delete(f"/api/elementos/{caja_A_id}")
        CLIENTE.delete(f"/api/elementos/{caja_B_id}")
        CLIENTE.delete(f"/api/elementos/{cable_id}")
        print("  [OK]    Limpieza completada")

        print("\n" + "=" * 74)
        print(f"RESULTADO: {R['ok']} comprobaciones OK, {len(R['fallos'])} fallos")
        print("=" * 74)
        return 1 if R["fallos"] else 0
    finally:
        # Si algo se cayó a mitad, se borra igual todo lo que creó la prueba.
        try:
            for fid in reversed(locals().get("creados_extra") or []):
                CLIENTE.delete(f"/api/elementos/{fid}")
        except Exception:
            pass
        db.close()

if __name__ == "__main__":
    raise SystemExit(main())
