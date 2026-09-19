"""
prueba_nodo.py

Prueba del interior del nodo (F3): bandejas, dispositivos, puertos y DTO del diagrama.

Comprueba:
  1. El contrato GeoJSON de la capa física no cambia.
  2. `GET /api/elementos/{id}/nodo` responde para una caja NAP real.
  3. Un poste NO puede alojar bandejas ni dispositivos (invariante I17) -> 400.
  4. Las bandejas se auto-numeran y no se duplican (409).
  5. Un splitter 1x8 genera 1 puerto IN + 8 puertos OUT (invariante I13).
  6. La atenuación nominal se deduce de la división (1x8 -> 10.7 dB).
  7. Un panel de adaptadores genera puertos BIDI.
  8. Faltando la división, el splitter devuelve 400 con mensaje claro.
  9. Al anclar hilos al nodo, aparecen en `hilos_que_terminan`.
 10. El resumen y las advertencias del DTO son coherentes.

Nota: crea bandejas, un splitter y un panel de adaptadores en el primer NAP del
proyecto, y ancla 3 hilos a ese nodo. Nada de la capa física se modifica.

Uso (desde backend/):
    python scripts/prueba_nodo.py
    python scripts/prueba_nodo.py --proyecto 5
"""
import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from app.main import app  # noqa: E402

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
    return bool(cond)


class ClienteSync:
    def _req(self, metodo, url, **kw):
        async def _do():
            transporte = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transporte, base_url="http://prueba.local") as c:
                return await c.request(metodo, url, **kw)
        return asyncio.run(_do())

    def get(self, url, **kw):
        return self._req("GET", url, **kw)

    def post(self, url, **kw):
        return self._req("POST", url, **kw)

    def put(self, url, **kw):
        return self._req("PUT", url, **kw)


CLIENTE = ClienteSync()


def firma_features(payload) -> str:
    firma = []
    for f in sorted(payload.get("features", []), key=lambda x: str(x.get("properties", {}).get("id"))):
        p = f.get("properties", {})
        firma.append({
            "id": p.get("id"), "categoria": p.get("categoria"),
            "geom": (f.get("geometry") or {}).get("type"), "color": p.get("color"),
        })
    return json.dumps(firma, sort_keys=True, ensure_ascii=False)


def main() -> int:
    ap = argparse.ArgumentParser(description="Prueba del interior del nodo (F3)")
    ap.add_argument("--proyecto", type=int, default=int(os.getenv("FTTH_PROYECTO_PRUEBA", "5")))
    args = ap.parse_args()
    proyecto = args.proyecto

    print("=" * 74)
    print(f"PRUEBA DEL NODO (F3) — proyecto {proyecto}")
    print("=" * 74)

    print("\n1) Línea base del contrato físico")
    r = CLIENTE.get(f"/api/elementos/todos?proyecto_id={proyecto}")
    base = r.json()
    firma_base = firma_features(base)
    n_base = len(base.get("features", []))
    features = base.get("features", [])
    print(f"        features: {n_base}")

    napes = [f["properties"]["id"] for f in features if f["properties"].get("categoria") == "cajanap"]
    postes = [f["properties"]["id"] for f in features if f["properties"].get("categoria") == "poste"]
    mangas = [f["properties"]["id"] for f in features if f["properties"].get("categoria") == "manga"]
    if not napes and not mangas:
        print("        No hay cajanap ni manga en el proyecto: no se puede probar el nodo.")
        return 0
    nodo_id = napes[0] if napes else mangas[0]
    print(f"        nodo: #{nodo_id} (cajanap={len(napes)}, manga={len(mangas)}, poste={len(postes)})")

    print("\n2) GET /api/elementos/{id}/nodo")
    r = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo")
    check(r.status_code == 200, "El DTO del nodo responde 200", f"status={r.status_code}")
    if r.status_code != 200:
        return 1
    dto = r.json()
    check(dto["nodo"]["box_id"] == nodo_id, "El DTO identifica el box_id correcto")
    check(dto["nodo"]["conmuta_hilos"] is True, "Una caja NAP conmuta hilos")
    check(
        "bandejas" in dto and "puertos" in dto and "hilos_que_terminan" in dto,
        "El DTO trae todas las secciones",
    )
    print(f"        plantilla: {dto['nodo']['tipo_nombre']} | capacidad: {dto['nodo']['capacidad_puertos']}")
    bandejas_previas = dto["resumen"]["bandejas"]
    print(f"        bandejas: {bandejas_previas} | puertos: {dto['resumen']['puertos']} | hilos: {dto['resumen']['hilos_anclados']}")
    for a in dto["advertencias"]:
        print(f"        aviso: {a}")

    print("\n3) Un poste no conmuta hilos (I17)")
    if postes:
        r = CLIENTE.post(f"/api/elementos/{postes[0]}/bandejas", json={"tipo": "empalme", "slots": 12})
        check(r.status_code == 400, "Bandeja en un poste -> 400", f"status={r.status_code}")
        print(f"        mensaje: {r.json().get('detail')}")
        r = CLIENTE.post(f"/api/elementos/{postes[0]}/dispositivos", json={"tipo": "splitter", "division": "1x8"})
        check(r.status_code == 400, "Splitter en un poste -> 400", f"status={r.status_code}")

    print("\n4) Bandejas: auto-numeración y duplicados")
    r = CLIENTE.post(f"/api/elementos/{nodo_id}/bandejas", json={"tipo": "empalme", "slots": 12})
    check(r.status_code == 200, "Se creó una bandeja de empalme", f"status={r.status_code} {r.text[:200]}")
    if r.status_code != 200:
        return 1
    b1 = r.json()
    print(f"        bandeja #{b1['id']} → número {b1['bandeja_no']} ({b1['slots']} slots)")
    r = CLIENTE.post(f"/api/elementos/{nodo_id}/bandejas", json={"tipo": "splitter", "slots": 24})
    check(
        r.status_code == 200 and r.json()["bandeja_no"] == b1["bandeja_no"] + 1,
        "La segunda bandeja se numeró automáticamente",
        str(r.json()),
    )
    r = CLIENTE.post(f"/api/elementos/{nodo_id}/bandejas", json={"bandeja_no": b1["bandeja_no"]})
    check(r.status_code == 409, "Bandeja duplicada -> 409", f"status={r.status_code}")
    r = CLIENTE.post(f"/api/elementos/{nodo_id}/bandejas", json={"tipo": "inventado"})
    check(r.status_code == 400, "Tipo de bandeja inválido -> 400", f"status={r.status_code}")
    r = CLIENTE.post(f"/api/elementos/{nodo_id}/bandejas", json={"slots": 999})
    check(r.status_code == 400, "Bandeja con demasiados slots -> 400", f"status={r.status_code}")


    print("\n5) Splitter 1x8: 1 IN + 8 OUT (I13) y atenuación nominal")
    r = CLIENTE.post(
        f"/api/elementos/{nodo_id}/dispositivos",
        json={"tipo": "splitter", "division": "1x8", "bandeja_id": b1["id"],
              "tipo_conector": "SC/APC", "serie": "SN-PRUEBA-001"},
    )
    check(r.status_code == 200, "Se instaló el splitter 1x8", f"status={r.status_code} {r.text[:250]}")
    if r.status_code == 200:
        sp = r.json()
        print(f"        dispositivo #{sp['id']} {sp['tipo']} {sp['division']} → {sp['puertos_creados']}")
        check(sp["puertos_creados"]["IN"] == 1, "Generó 1 puerto IN")
        check(sp["puertos_creados"]["OUT"] == 8, "Generó 8 puertos OUT")
        check(sp["atenuacion_db"] == 10.7, "Dedujo la atenuación nominal 10.7 dB", str(sp["atenuacion_db"]))
        check(sp["bandeja_id"] == b1["id"], "Quedó montado en la bandeja indicada")

    print("\n6) Panel de adaptadores: puertos BIDI")
    r = CLIENTE.post(
        f"/api/elementos/{nodo_id}/dispositivos",
        json={"tipo": "adaptador", "puertos_out": 12, "tipo_conector": "SC/APC"},
    )
    check(r.status_code == 200, "Se instaló el panel de adaptadores", f"status={r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        ad = r.json()
        print(f"        dispositivo #{ad['id']} → {ad['puertos_creados']}")
        check(ad["puertos_creados"]["BIDI"] == 12, "Generó 12 puertos BIDI")

    print("\n7) Validaciones de dispositivo")
    r = CLIENTE.post(f"/api/elementos/{nodo_id}/dispositivos", json={"tipo": "splitter"})
    check(r.status_code == 400, "Splitter sin división -> 400", f"status={r.status_code}")
    print(f"        mensaje: {r.json().get('detail')}")
    r = CLIENTE.post(f"/api/elementos/{nodo_id}/dispositivos", json={"tipo": "inventado"})
    check(r.status_code == 400, "Tipo de dispositivo inválido -> 400", f"status={r.status_code}")
    r = CLIENTE.post(f"/api/elementos/{nodo_id}/dispositivos",
                     json={"tipo": "splitter", "division": "1x8", "bandeja_id": 999999})
    check(r.status_code == 404, "Bandeja inexistente -> 404", f"status={r.status_code}")
    r = CLIENTE.post(f"/api/elementos/{nodo_id}/dispositivos", json={"tipo": "splitter", "division": "1x400"})
    check(r.status_code == 400, "División desmesurada -> 400", f"status={r.status_code}")


    print("\n8) GET /api/elementos/{id}/puertos")
    r = CLIENTE.get(f"/api/elementos/{nodo_id}/puertos")
    check(r.status_code == 200, "El listado de puertos responde 200")
    puertos = r.json()
    print(f"        total: {puertos['total']} | libres: {puertos['libres']} | ocupados: {puertos['ocupados']}")
    check(puertos["total"] >= 21, "Se ven al menos 21 puertos (1+8 del splitter y 12 BIDI)", str(puertos["total"]))
    r = CLIENTE.get(f"/api/elementos/{nodo_id}/puertos?direccion=OUT")
    check(r.json()["total"] == 8, "Filtro por dirección OUT devuelve 8", str(r.json()["total"]))

    print("\n9) Hilos anclados al nodo")
    r = CLIENTE.get(f"/api/proyectos/{proyecto}/cables")
    cables = r.json().get("cables", [])
    hilos_anclados = 0
    if cables:
        cable_id = cables[0]["cable_id"]
        r = CLIENTE.get(f"/api/cables/{cable_id}/hilos")
        arbol = r.json()
        fibras = [h for t in arbol.get("tubos", []) for h in t["hilos"]][:3]
        for h in fibras:
            rr = CLIENTE.put(f"/api/fibras/{h['id']}/extremos/B", json={"nodo_id": nodo_id, "holgura_m": 5})
            if rr.status_code == 200:
                hilos_anclados += 1
        print(f"        se anclaron {hilos_anclados} hilo(s) del cable #{cable_id} al nodo #{nodo_id}")
    check(hilos_anclados > 0, "Se pudieron anclar hilos al nodo", str(hilos_anclados))
    r = CLIENTE.get(f"/api/elementos/{nodo_id}/nodo")
    dto2 = r.json()
    check(
        dto2["resumen"]["hilos_anclados"] == hilos_anclados,
        f"El DTO muestra los {hilos_anclados} hilo(s) anclados",
        str(dto2["resumen"]["hilos_anclados"]),
    )
    if dto2["hilos_que_terminan"]:
        ejemplo = dto2["hilos_que_terminan"][0]
        print(f"        ejemplo: {ejemplo['nombre']} de «{ejemplo['cable']}» extremo {ejemplo['extremo']}")
        check(ejemplo["extremo"] == "B", "Cada hilo indica su extremo (A o B)")
    check(
        dto2["resumen"]["bandejas"] >= bandejas_previas + 2,
        "El resumen cuenta las bandejas nuevas",
        str(dto2["resumen"]["bandejas"]),
    )
    check(
        dto2["resumen"]["dispositivos"] == 2,
        "El resumen cuenta los 2 dispositivos instalados",
        str(dto2["resumen"]["dispositivos"]),
    )
    for a in dto2["advertencias"]:
        print(f"        aviso: {a}")

    print("\n10) El contrato físico sigue intacto")
    r = CLIENTE.get(f"/api/elementos/todos?proyecto_id={proyecto}")
    check(len(r.json().get("features", [])) == n_base, f"El proyecto sigue con {n_base} elementos")
    check(firma_features(r.json()) == firma_base, "El contrato GeoJSON es idéntico a la línea base")

    print("\n" + "=" * 74)
    print(f"RESULTADO: {R['ok']} comprobaciones OK, {len(R['fallos'])} fallos")
    for f in R["fallos"]:
        print(f"  - {f}")
    print("=" * 74)
    print(f"NOTA: el nodo #{nodo_id} quedó con bandejas, 1 splitter 1x8, 1 panel de adaptadores"
          + (f" y {hilos_anclados} hilo(s) anclados, para que puedas verlo en el diagrama." if hilos_anclados else "."))
    return 1 if R["fallos"] else 0


if __name__ == "__main__":
    raise SystemExit(main())



