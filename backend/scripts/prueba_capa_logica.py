"""
prueba_capa_logica.py

Prueba de la CAPA LÓGICA y verificación de NO RUPTURA de la capa física.

Qué comprueba:
  1. El contrato GeoJSON de `/api/elementos/todos` no cambia (antes vs después).
  2. El listado de cables informa si están materializados y cuántos hilos espera.
  3. La materialización masiva en `dry_run` NO escribe nada.
  4. La materialización de un cable crea tubos, hilos y extremos correctos.
  5. Es IDEMPOTENTE: re-ejecutarla no duplica ni destruye estado.
  6. El estado de un hilo se puede cambiar y sobrevive a re-materializar.
  7. Anclar un extremo a un poste devuelve advertencia (un poste no conmuta hilos).
  8. Materializar un elemento que no es cable devuelve 400 con mensaje claro.
  9. Al final el contrato GeoJSON sigue idéntico y los datos quedan limpios.

Uso (desde backend/):
    python scripts/prueba_capa_logica.py
    python scripts/prueba_capa_logica.py --proyecto 5
"""
import argparse
import json
import os
import sys

# La consola de Windows suele estar en cp1252 y no soporta algunos caracteres
# (por ejemplo la flecha → de los listados): se fuerza UTF-8 en la salida para
# que la prueba NUNCA falle por un carácter.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402
import httpx  # noqa: E402
from app.main import app  # noqa: E402


class ClienteSync:
    """
    Cliente de prueba contra la app ASGI sin abrir puerto.

    Por qué no se usa starlette TestClient:
      - starlette 0.35 + httpx 0.28 -> TypeError: Client.__init__() got an unexpected
        keyword argument 'app'.
      - httpx.AsyncClient + ASGITransport sí es compatible, así que se envuelve en un
        puente síncrono: cada petición abre su propio bucle y su propio cliente.
    """

    def _req(self, metodo: str, url: str, **kw):
        async def _do():
            transporte = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transporte, base_url="http://prueba.local") as cliente:
                return await cliente.request(metodo, url, **kw)
        return asyncio.run(_do())

    def get(self, url: str, **kw):
        return self._req("GET", url, **kw)

    def post(self, url: str, **kw):
        return self._req("POST", url, **kw)

    def put(self, url: str, **kw):
        return self._req("PUT", url, **kw)


CLIENTE = ClienteSync()
RESULTADOS = {"ok": 0, "fallos": []}


def check(condicion: bool, mensaje: str, detalle: str = "") -> bool:
    if condicion:
        RESULTADOS["ok"] += 1
        print(f"  [OK]    {mensaje}")
        return True
    RESULTADOS["fallos"].append(mensaje)
    print(f"  [FALLO] {mensaje}")
    if detalle:
        print(f"          {detalle}")
    return False


def firma_features(payload) -> str:
    """Huella estable del contrato GeoJSON: geometría y claves de properties."""
    firma = []
    for f in sorted(payload.get("features", []), key=lambda x: str(x.get("properties", {}).get("id"))):
        props = f.get("properties", {})
        firma.append({
            "id": props.get("id"),
            "categoria": props.get("categoria"),
            "geom": (f.get("geometry") or {}).get("type"),
            "tipo_nombre": props.get("tipo_nombre"),
            "color": props.get("color"),
            "n_inst": len(props.get("propiedades_instancia") or {}),
            "n_tipo": len(props.get("propiedades_tipo") or {}),
        })
    return json.dumps(firma, sort_keys=True, ensure_ascii=False)


def main() -> int:
    ap = argparse.ArgumentParser(description="Prueba de la capa lógica FTTH")
    ap.add_argument("--proyecto", type=int, default=int(os.getenv("FTTH_PROYECTO_PRUEBA", "5")))
    args = ap.parse_args()
    proyecto = args.proyecto

    print("=" * 74)
    print(f"PRUEBA DE CAPA LÓGICA — proyecto {proyecto}")
    print("=" * 74)

    # ── 1. Línea base del contrato físico ────────────────────────────────────
    print("\n1) Línea base del contrato /api/elementos/todos")
    r = CLIENTE.get(f"/api/elementos/todos?proyecto_id={proyecto}")
    check(r.status_code == 200, "GET /api/elementos/todos responde 200", f"status={r.status_code}")
    base = r.json()
    firma_base = firma_features(base)
    n_base = len(base.get("features", []))
    print(f"        features en el proyecto: {n_base}")
    postes = [
        f["properties"]["id"] for f in base.get("features", [])
        if f["properties"].get("categoria") == "poste"
    ]

    # ── 2. Listado de cables ────────────────────────────────────────────────
    print("\n2) GET /api/proyectos/{id}/cables")
    r = CLIENTE.get(f"/api/proyectos/{proyecto}/cables")
    check(r.status_code == 200, "Listado de cables responde 200", f"status={r.status_code}")
    cables = r.json().get("cables", []) if r.status_code == 200 else []
    if not cables:
        print("        No hay cables en este proyecto: no se puede probar la contención.")
        print("\nRESUMEN: nada que materializar.")
        return 0
    cable = cables[0]
    cable_id = cable["cable_id"]
    print(f"        cable #{cable_id} «{cable['nombre']}»")
    print(f"        plantilla : {cable['plantilla']}")
    print(f"        hilos     : {cable['hilos']} actuales / {cable['hilos_esperados']} esperados")
    check("materializado" in cable and "hilos_esperados" in cable, "El listado informa el estado lógico")

    # ── 3. Dry-run: no debe escribir ────────────────────────────────────────
    print("\n3) dry_run=true (no debe escribir nada)")
    r = CLIENTE.post(f"/api/proyectos/{proyecto}/materializar-todos?dry_run=true")
    check(r.status_code == 200, "El dry-run responde 200", f"status={r.status_code}")
    cuerpo = r.json()
    check(cuerpo.get("dry_run") is True, "La respuesta se identifica como simulación")
    for d in cuerpo.get("detalle", []):
        if d["cable_id"] == cable_id:
            print(f"        previsto: {d['accion']} — {d['detalle']}")
    r = CLIENTE.get(f"/api/cables/{cable_id}/hilos")
    hilos_tras_dry = r.json()["resumen"]["hilos"]
    check(
        hilos_tras_dry == cable["hilos"],
        "El dry-run no creó hilos",
        f"antes={cable['hilos']} después={hilos_tras_dry}",
    )


    # ── 4. Materialización real ─────────────────────────────────────────────
    print("\n4) Materializar el cable (POST /api/cables/{id}/materializar-hilos)")
    r = CLIENTE.post(f"/api/cables/{cable_id}/materializar-hilos")
    check(r.status_code == 200, "La materialización responde 200", f"status={r.status_code} {r.text[:300]}")
    if r.status_code != 200:
        return 1
    res = r.json()
    print(f"        parámetros : {res['parametros']}")
    print(f"        resultado  : {res['resultado']}")
    for a in res.get("advertencias", []):
        print(f"        aviso      : {a}")
    esperado = res["parametros"]["hilos_totales"]
    total_hilos = res["resultado"]["hilos_creados"] + res["resultado"]["hilos_existentes"]
    check(total_hilos == esperado, f"El cable quedó con {esperado} hilos", f"obtenidos={total_hilos}")
    creados_ext = res["resultado"]["extremos_creados"]
    check(
        creados_ext in (0, 2 * esperado),
        f"Extremos coherentes: 0 si ya existían, o {2 * esperado} si se crearon ahora",
        f"obtenidos={creados_ext}",
    )
    check(res["plantilla"]["existe"] is True, "La plantilla del cable existe y se usó")

    # ── 5. Idempotencia ─────────────────────────────────────────────────────
    print("\n5) Re-ejecutar la materialización (idempotencia)")
    r2 = CLIENTE.post(f"/api/cables/{cable_id}/materializar-hilos")
    res2 = r2.json()
    print(f"        resultado: {res2['resultado']}")
    check(res2["resultado"]["hilos_creados"] == 0, "No se duplicaron hilos")
    check(res2["resultado"]["extremos_creados"] == 0, "No se duplicaron extremos")
    check(
        res2["resultado"]["hilos_existentes"] == esperado,
        f"Se reconocen los {esperado} hilos ya existentes",
        f"reconocidos={res2['resultado']['hilos_existentes']}",
    )

    # ── 6. Consulta del árbol de hilos ──────────────────────────────────────
    print("\n6) GET /api/cables/{id}/hilos")
    r = CLIENTE.get(f"/api/cables/{cable_id}/hilos")
    arbol = r.json()
    check(r.status_code == 200, "La consulta de hilos responde 200")
    check(arbol["resumen"]["materializado"] is True, "El cable figura como materializado")
    check(
        arbol["resumen"]["hilos"] == esperado,
        f"El resumen informa {esperado} hilos",
        f"informa={arbol['resumen']['hilos']}",
    )
    primer_tubo = arbol["tubos"][0] if arbol["tubos"] else None
    fibra_id = None
    if primer_tubo:
        print(f"        tubo {primer_tubo['tubo_no']} «{primer_tubo['color']}» {primer_tubo['color_hex']} "
              f"({len(primer_tubo['hilos'])} hilos)")
        print("        ejemplos: " + ", ".join(f"{h['nombre']}={h['color']}" for h in primer_tubo["hilos"][:4]))
        check(
            len(primer_tubo["hilos"]) == esperado,
            f"El tubo contiene los {esperado} hilos",
            f"tiene={len(primer_tubo['hilos'])}",
        )
        primero = primer_tubo["hilos"][0]
        check(
            primero["nombre"] == "T01-H01" and primero["hilo_global_no"] == 1,
            "La nomenclatura del hilo es determinista (T01-H01, global 1)",
            f"{primero['nombre']} global={primero['hilo_global_no']}",
        )
        check(
            len(primero.get("extremos") or {}) == 2,
            "Cada hilo trae sus dos extremos (A y B)",
            str(primero.get("extremos")),
        )
        total_extremos = sum(len(h.get("extremos") or {}) for t in arbol["tubos"] for h in t["hilos"])
        check(
            total_extremos == 2 * esperado,
            f"El cable tiene {2 * esperado} extremos en total (A y B por hilo)",
            f"obtenidos={total_extremos}",
        )
        fibra_id = primero["id"]
    for a in arbol.get("advertencias", []):
        print(f"        aviso  : {a}")


    # ── 7. Estado del hilo y su persistencia ────────────────────────────────
    print("\n7) PUT /api/fibras/{id} (estado del hilo)")
    if fibra_id:
        r = CLIENTE.put(f"/api/fibras/{fibra_id}", json={"estado": "reservado"})
        check(r.status_code == 200 and r.json()["estado"] == "reservado", "El estado cambió a 'reservado'")
        CLIENTE.post(f"/api/cables/{cable_id}/materializar-hilos")
        r = CLIENTE.get(f"/api/cables/{cable_id}/hilos?estado=reservado")
        hay_reservado = any(
            h["estado"] == "reservado" for t in r.json().get("tubos", []) for h in t["hilos"]
        )
        check(hay_reservado, "Re-materializar NO borró el estado capturado")
        r = CLIENTE.put(f"/api/fibras/{fibra_id}", json={"estado": "inventado"})
        check(r.status_code == 400, "Un estado inválido devuelve 400", f"status={r.status_code}")
        print(f"        mensaje: {r.json().get('detail')}")
        CLIENTE.put(f"/api/fibras/{fibra_id}", json={"estado": "libre"})
        print("        estado restaurado a 'libre'")

    # ── 8. Anclaje de extremo ───────────────────────────────────────────────
    print("\n8) PUT /api/fibras/{id}/extremos/B (anclaje a un nodo)")
    if fibra_id and postes:
        # El hilo puede venir YA anclado por el uso real (p. ej. su punta B en una
        # caja): se suelta primero para que la prueba del anclaje sea determinista.
        CLIENTE.put(f"/api/fibras/{fibra_id}/extremos/B", json={"nodo_id": None})
        r = CLIENTE.put(f"/api/fibras/{fibra_id}/extremos/B", json={"nodo_id": postes[0]})
        check(r.status_code == 200, "El extremo B se ancló al poste", f"status={r.status_code}")
        avisos = r.json().get("advertencias", []) if r.status_code == 200 else []
        check(len(avisos) > 0, "Avisa que un poste no conmuta hilos")
        for a in avisos:
            print(f"        aviso  : {a}")
        r = CLIENTE.put(f"/api/fibras/{fibra_id}/extremos/Z", json={"nodo_id": postes[0]})
        check(r.status_code == 400, "Un extremo inválido (Z) devuelve 400", f"status={r.status_code}")
        r = CLIENTE.put(f"/api/fibras/{fibra_id}/extremos/B", json={"nodo_id": 999999})
        check(r.status_code == 404, "Un nodo inexistente devuelve 404", f"status={r.status_code}")
        # Se deja el extremo SIN anclar (nodo_id explícito a None) para no dejar residuos
        r = CLIENTE.put(f"/api/fibras/{fibra_id}/extremos/B", json={"nodo_id": None, "holgura_m": 0})
        check(r.status_code == 200 and r.json().get("nodo_id") is None,
              "El extremo queda sin anclar (nodo_id = None explícito)", str(r.json()))
        print("        extremo devuelto a 'sin anclar' (datos limpios para tu prueba)")

    # ── 9. Guardas de categoría ─────────────────────────────────────────────
    print("\n9) Guardas: materializar algo que no es un cable")
    if postes:
        r = CLIENTE.post(f"/api/cables/{postes[0]}/materializar-hilos")
        check(r.status_code == 400, "Un poste no se puede materializar (400)", f"status={r.status_code}")
        print(f"        mensaje: {r.json().get('detail')}")
        r = CLIENTE.get(f"/api/cables/{postes[0]}/hilos")
        check(r.status_code == 400, "Consultar hilos de un poste devuelve 400", f"status={r.status_code}")
    r = CLIENTE.post("/api/cables/999999/materializar-hilos")
    check(r.status_code == 404, "Materializar un cable inexistente devuelve 404", f"status={r.status_code}")
    r = CLIENTE.put("/api/fibras/999999", json={"estado": "libre"})
    check(r.status_code == 404, "Un hilo inexistente devuelve 404", f"status={r.status_code}")

    # ── 10. No ruptura del contrato físico ──────────────────────────────────
    print("\n10) Verificación de NO ruptura del contrato GeoJSON")
    r = CLIENTE.get(f"/api/elementos/todos?proyecto_id={proyecto}")
    firma_despues = firma_features(r.json())
    n_despues = len(r.json().get("features", []))
    check(n_despues == n_base, f"El proyecto sigue teniendo {n_base} elementos", f"ahora={n_despues}")
    check(firma_despues == firma_base, "El contrato GeoJSON es idéntico al de la línea base")
    if firma_despues != firma_base:
        print("        ¡El contrato cambió! Revisar feature_from_elemento.")

    print("\n" + "=" * 74)
    print(f"RESULTADO: {RESULTADOS['ok']} comprobaciones OK, {len(RESULTADOS['fallos'])} fallos")
    for f in RESULTADOS["fallos"]:
        print(f"  - {f}")
    print("=" * 74)
    return 1 if RESULTADOS["fallos"] else 0


if __name__ == "__main__":
    raise SystemExit(main())


