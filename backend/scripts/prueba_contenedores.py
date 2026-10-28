"""
prueba_contenedores.py — Prueba integral del módulo nativo (2.3, 2.4, 2.6, 2.7, 3.4).

Contra la base SINTÉTICA (R7):
    $env:DATABASE_URL = "sqlite:///./tests/tachira_maps_test.db"
    python scripts/prueba_contenedores.py
"""
import asyncio
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
os.environ.setdefault("DATABASE_URL", "sqlite:///./tests/tachira_maps_test.db")

R = {"ok": 0, "fallos": []}


def check(condicion, mensaje, detalle=""):
    if condicion:
        R["ok"] += 1
        print(f"  [OK]    {mensaje}")
    else:
        R["fallos"].append(mensaje)
        print(f"  [FALLO] {mensaje}")
        if detalle:
            print(f"          {str(detalle)[:280]}")


async def main():
    if "_test.db" not in os.environ["DATABASE_URL"]:
        print("ABORTADO: usa la base sintética *_test.db (R7).")
        return 2
    import httpx
    from sqlalchemy import event
    from app.main import app
    from app.database import SessionLocal, engine
    from app.models import ftth_models as fisicos

    consultas = {"n": 0}
    event.listen(engine, "before_cursor_execute",
                 lambda *a, **k: consultas.__setitem__("n", consultas["n"] + 1))
    db = SessionLocal()
    try:
        armarios = db.query(fisicos.FtthElemento).filter(
            fisicos.FtthElemento.categoria == "armario").order_by(
            fisicos.FtthElemento.id).all()
    finally:
        db.close()
    if len(armarios) < 2:
        print("ABORTADO: faltan los dos gabinetes sintéticos.")
        return 2
    gab_a, gab_b = armarios[0].id, armarios[1].id

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://prueba") as cliente:
        print("1) contrato de lectura y consultas constantes")
        consultas["n"] = 0
        r = await cliente.get(f"/api/contenedores/{gab_a}/diagrama?hilos_por_cable=24")
        dto = r.json()
        qa = consultas["n"]
        check(r.status_code == 200, "GET /diagrama 200", r.text[:200])
        claves = {"version_contrato", "revision", "contenedor", "dispositivos", "puertos",
                  "cables", "conexiones", "posiciones"}
        check(claves <= set(dto), "claves del contrato", sorted(claves - set(dto)))
        cable = (dto.get("cables") or [None])[0]
        check(cable and cable["hilos_total"] == 96, "cable de 96 hilos",
              cable["hilos_total"] if cable else None)
        check(cable and len(cable["hilos"]["items"]) == 24, "paginación 24/96",
              len(cable["hilos"]["items"]) if cable else None)
        consultas["n"] = 0
        await cliente.get(f"/api/contenedores/{gab_b}/diagrama?hilos_por_cable=24")
        qb = consultas["n"]
        check(qa == qb, "consultas constantes A vs B", f"A={qa} B={qb}")
        check(qa <= 12, "pocas consultas", qa)

        print("2) crear + idempotencia")
        cuerpo = {"tipo": "splitter", "division": "1x16", "nombre": "SPL-NUEVO",
                  "operation_id": "op-crear-1", "base_revision": dto["revision"]}
        r = await cliente.post(f"/api/contenedores/{gab_a}/dispositivos", json=cuerpo)
        creado = r.json()
        equipo_id = (creado.get("dispositivo") or {}).get("id")
        check(r.status_code == 200 and equipo_id, "POST dispositivo", r.text[:200])
        check(len(creado.get("puertos") or []) == 17, "1 IN + 16 OUT",
              len(creado.get("puertos") or []))
        check(creado.get("revision") == dto["revision"] + 1, "revisión +1",
              creado.get("revision"))
        r = await cliente.post(f"/api/contenedores/{gab_a}/dispositivos", json=cuerpo)
        check(r.json().get("idempotente") is True
              and (r.json().get("dispositivo") or {}).get("id") == equipo_id,
              "mismo operation_id → idempotente", r.text[:200])

        print("3) conflicto de revisión")
        r = await cliente.post(f"/api/contenedores/{gab_a}/dispositivos",
                               json={"tipo": "odf", "operation_id": "op-rev",
                                     "base_revision": dto["revision"]})
        check(r.status_code == 409 and (r.json() or {}).get("codigo") == "conflicto",
              "revisión vieja → 409 conflicto", r.text[:200])

        print("4) editar y mover")
        r = await cliente.patch(f"/api/contenedores/{gab_a}/dispositivos/{equipo_id}",
                                json={"nombre": "SPL-RENOMBRADO", "estado": "En proyecto",
                                      "perdida_db": 14.2, "operation_id": "op-editar-1"})
        check(r.status_code == 200
              and r.json()["dispositivo"]["nombre"] == "SPL-RENOMBRADO",
              "PATCH nombre/estado/pérdida", r.text[:200])
        r = await cliente.post(f"/api/contenedores/{gab_a}/dispositivos/{equipo_id}/mover",
                               json={"destino_id": gab_b, "operation_id": "op-mover-1"})
        check(r.status_code == 200 and r.json()["destino_id"] == gab_b, "mover",
              r.text[:200])

        print("5) conectar, duplicado, no borrar con conexiones, desconectar")
        dto = (await cliente.get(f"/api/contenedores/{gab_a}/diagrama")).json()
        cable = dto["cables"][0]
        fibra_id = cable["hilos"]["items"][3]["fibra_id"]
        odf = next(d for d in dto["dispositivos"] if d["tipo"] == "odf")
        puerto = next(p for p in dto["puertos"]
                      if p["dispositivo_id"] == odf["id"] and p["etiqueta"] == "ODF-02")
        conexion = {
            "origen": {"tipo": "CABLE", "eq_id": cable["id"], "fibra_id": fibra_id,
                       "puerto": "HILO 4"},
            "destino": {"tipo": "ODF", "eq_id": odf["id"], "puerto": "ODF-02",
                        "cara": "B", "puerto_id": puerto["id"]},
            "operation_id": "op-conectar-1",
        }
        r = await cliente.post(f"/api/contenedores/{gab_a}/conexiones", json=conexion)
        check(r.status_code == 200, "conectar hilo ↔ ODF", r.text[:250])
        conexion_id = (r.json().get("conexion") or {}).get("id")

        r = await cliente.delete(f"/api/contenedores/{gab_a}/dispositivos/{odf['id']}",
                                 params={"operation_id": "op-borrar-odf"})
        check(r.status_code == 409, "no borrar equipo con conexiones", r.status_code)

        r = await cliente.post(f"/api/contenedores/{gab_a}/conexiones",
                               json={**conexion, "operation_id": "op-conectar-dup"})
        codigo = (r.json() or {}).get("codigo")
        check(r.status_code in (409, 422) and codigo in ("sin_duplicados", "puerto_libre"),
              "la misma fibra dos veces se rechaza", f"{r.status_code} {codigo}")

        r = await cliente.post(f"/api/contenedores/{gab_a}/conexiones", json={
            "origen": {"tipo": "OLT", "eq_id": odf["id"], "puerto": "SFP 1"},
            "destino": {"tipo": "SWITCH", "eq_id": 999, "puerto": "RJ45 1",
                        "puerto_id": 999999},
            "operation_id": "op-rj45"})
        check(r.status_code == 422 and "RJ45" in r.text, "SFP ↔ RJ45 rechazado",
              r.text[:200])

        r = await cliente.delete(f"/api/contenedores/{gab_a}/conexiones/{conexion_id}",
                                 params={"operation_id": "op-desconectar-1"})
        check(r.status_code == 200, "desconectar", r.text[:200])

        print("6) origen de señal y potencia")
        olt = next(d for d in dto["dispositivos"] if d["tipo"] == "olt")
        pon = next(p for p in dto["puertos"]
                   if p["dispositivo_id"] == olt["id"] and p["etiqueta"] == "PON 1")
        r = await cliente.post(f"/api/contenedores/{gab_a}/origen",
                               json={"origen_tipo": "PON", "senal": "ACCESO",
                                     "dispositivo_id": olt["id"], "puerto": "PON 1",
                                     "puerto_id": pon["id"],
                                     "operation_id": "op-origen-1"})
        origen = (r.json() or {}).get("origen") or {}
        check(r.status_code == 200 and origen.get("senal") == "ACCESO",
              "origen PON en ACCESO", r.text[:250])
        check(abs((origen.get("tx_efectivo_dbm") or 0) - 3.0) < 0.01,
              "TX por defecto PON = 3.0 dBm", origen.get("tx_efectivo_dbm"))
        r = await cliente.post(f"/api/contenedores/{gab_a}/origen",
                               json={"origen_tipo": "SFP", "senal": "ACCESO",
                                     "dispositivo_id": olt["id"], "puerto": "SFP 1",
                                     "operation_id": "op-origen-2"})
        check(r.status_code == 422, "SFP con señal ACCESO se rechaza", r.status_code)

    print(f"\nRESULTADO: {R['ok']} comprobaciones OK, {len(R['fallos'])} fallos")
    for fallo in R["fallos"][:12]:
        print(f"   - {fallo}")
    return 0 if not R["fallos"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

