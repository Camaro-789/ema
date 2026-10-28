"""
test_cables.py — Anclar cables y validar `tipo_id` (paso 1 de la Fase 6).

Todo contra la base SINTÉTICA (R7). Comprueba:
  1. `GET /contenedores/{id}/cables` lista los cables reales con sus extremos.
  2. No se puede anclar dos veces el mismo cable (409).
  3. Un cable de otro proyecto se rechaza (422).
  4. Anclar en un contenedor con el extremo libre funciona (200).
  5. `tipo_id` de otro proyecto o de otra categoría → 422; válido → se guarda.
"""
import asyncio

import httpx
from sqlalchemy import text

from app.database import SessionLocal
from app.main import app


def peticion(metodo: str, ruta: str, **kwargs):
    async def _hacer():
        transporte = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transporte, base_url="http://prueba") as cliente:
            return await cliente.request(metodo, ruta, **kwargs)
    return asyncio.run(_hacer())


def _datos():
    with SessionLocal() as db:
        armarios = [int(f[0]) for f in db.execute(text(
            "SELECT id FROM ftth_elementos WHERE categoria='armario' ORDER BY id")).fetchall()]
        proyecto = int(db.execute(text("SELECT proyecto_id FROM ftth_elementos LIMIT 1")).scalar())
        cable = db.execute(text(
            "SELECT e.id FROM ftth_elementos e WHERE e.categoria='cables' "
            "ORDER BY (SELECT COUNT(*) FROM ftth_cable_fibras f WHERE f.elemento_id=e.id) DESC "
            "LIMIT 1")).scalar()
        return armarios, proyecto, int(cable)


def _tipo(proyecto: int, categoria: str):
    with SessionLocal() as db:
        return db.execute(text(
            "SELECT id FROM ftth_tipos WHERE proyecto_id=:p AND categoria=:c LIMIT 1"),
            {"p": proyecto, "c": categoria}).scalar()


def _nuevo_contenedor(proyecto: int, tipo_id: int, nombre: str) -> int:
    with SessionLocal() as db:
        db.execute(text(
            "INSERT INTO ftth_elementos (proyecto_id, tipo_id, categoria, propiedades_instancia) "
            "VALUES (:p, :t, 'armario', '{}')"), {"p": proyecto, "t": tipo_id})
        db.commit()
        return int(db.execute(text("SELECT MAX(id) FROM ftth_elementos")).scalar())


def _nuevo_cable(proyecto: int, tipo_id: int, extremo_a=None, extremo_b=None) -> int:
    with SessionLocal() as db:
        db.execute(text(
            "INSERT INTO ftth_elementos (proyecto_id, tipo_id, categoria, extremo_A_id, "
            "extremo_B_id, propiedades_instancia) VALUES (:p, :t, 'cables', :a, :b, '{}')"),
            {"p": proyecto, "t": tipo_id, "a": extremo_a, "b": extremo_b})
        db.commit()
        return int(db.execute(text("SELECT MAX(id) FROM ftth_elementos")).scalar())


def test_listar_cables_del_proyecto():
    armarios, proyecto, cable = _datos()
    respuesta = peticion("GET", f"/api/contenedores/{armarios[0]}/cables")
    assert respuesta.status_code == 200, respuesta.text
    datos = respuesta.json()
    uno = next((c for c in datos["cables"] if c["id"] == cable), None)
    assert uno, "el cable de 96 hilos no aparece en la lista"
    assert uno["hilos"] == 96, uno["hilos"]
    assert uno["anclado_aqui"] in ("A", "B"), uno["anclado_aqui"]


def test_no_anclar_dos_veces_el_mismo_cable():
    armarios, _, cable = _datos()
    respuesta = peticion("POST", f"/api/contenedores/{armarios[0]}/cables",
                         json={"cable_id": cable, "operation_id": "pytest-cable-dup"})
    assert respuesta.status_code == 409, respuesta.text


def test_anclar_cable_en_contenedor_nuevo():
    _, proyecto, _ = _datos()
    tipo_armario = _tipo(proyecto, "armario")
    tipo_cable = _tipo(proyecto, "cables")
    contenedor = _nuevo_contenedor(proyecto, tipo_armario, "Nuevo")
    cable = _nuevo_cable(proyecto, tipo_cable)

    respuesta = peticion("POST", f"/api/contenedores/{contenedor}/cables",
                         json={"cable_id": cable, "operation_id": "pytest-anclar-1"})
    assert respuesta.status_code == 200, respuesta.text
    assert respuesta.json()["cable"]["extremo"] in ("A", "B")

    otra = peticion("POST", f"/api/contenedores/{contenedor}/cables",
                    json={"cable_id": cable, "operation_id": "pytest-anclar-2"})
    assert otra.status_code == 409, otra.text


def test_cable_de_otro_proyecto_se_rechaza():
    armarios, proyecto, _ = _datos()
    with SessionLocal() as db:
        db.execute(text(
            "INSERT INTO map_projects (id, name, zoom) VALUES (9999, 'OTRO', 10)"))
        db.commit()
        tipo_otro = db.execute(text(
            "INSERT INTO ftth_tipos (proyecto_id, categoria, nombre_id, color_mapa, propiedades) "
            "VALUES (9999, 'cables', 'Cable ajeno', '#000', '{}') RETURNING id")).scalar()
        db.commit()
        cable_ajeno = _nuevo_cable(9999, int(tipo_otro))
    respuesta = peticion("POST", f"/api/contenedores/{armarios[0]}/cables",
                         json={"cable_id": cable_ajeno, "operation_id": "pytest-ajeno"})
    assert respuesta.status_code == 422, respuesta.text
    assert "otro proyecto" in respuesta.text


def test_tipo_id_de_otra_categoria_y_valido():
    armarios, proyecto, _ = _datos()
    tipo_poste = _tipo(proyecto, "poste")
    tipo_splitter = _tipo(proyecto, "splitter")
    contenedor = armarios[0]

    malo = peticion("POST", f"/api/contenedores/{contenedor}/dispositivos",
                    json={"tipo": "splitter", "division": "1x8", "tipo_id": tipo_poste,
                          "operation_id": "pytest-tipo-malo"})
    assert malo.status_code == 422, malo.text
    assert "categoría" in malo.text or "categoria" in malo.text

    bueno = peticion("POST", f"/api/contenedores/{contenedor}/dispositivos",
                     json={"tipo": "splitter", "division": "1x8", "tipo_id": tipo_splitter,
                           "operation_id": "pytest-tipo-bueno"})
    assert bueno.status_code == 200, bueno.text
    assert bueno.json()["dispositivo"]["tipo_id"] == tipo_splitter
