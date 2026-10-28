"""
test_integridad.py — Integridad de las escrituras (Fase 3.4).

Comprueba sobre la base sintética (nunca la real, R7):
  1. Idempotencia: el mismo `operation_id` no duplica.
  2. Conflicto de revisión: `base_revision` vieja → 409.
  3. No se elimina un equipo con conexiones.
  4. Dos escrituras simultáneas con la misma revisión: gana UNA (la otra 409).

Nota: se usa `httpx.ASGITransport` en vez de `fastapi.testclient.TestClient`
porque starlette 0.35 no es compatible con httpx 0.28 (`Client(app=...)`).

Uso:
    cd backend
    python -m pytest tests/test_integridad.py -q
"""
import asyncio
import concurrent.futures as futuros

import httpx
from sqlalchemy import text

from app.database import SessionLocal
from app.main import app


def peticion(metodo: str, ruta: str, **kwargs):
    """Petición a la app en proceso (síncrona, un bucle por llamada)."""
    async def _hacer():
        transporte = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transporte, base_url="http://prueba") as cliente:
            return await cliente.request(metodo, ruta, **kwargs)
    return asyncio.run(_hacer())


def _primer_armario() -> int:
    with SessionLocal() as db:
        fila = db.execute(text(
            "SELECT id FROM ftth_elementos WHERE categoria = 'armario' ORDER BY id LIMIT 1"
        )).fetchone()
    assert fila, "la base sintética no tiene armarios"
    return int(fila[0])


def _revision(contenedor: int) -> int:
    with SessionLocal() as db:
        return int(db.execute(text(
            "SELECT revision FROM ftth_elementos WHERE id = :i"), {"i": contenedor}
        ).scalar() or 0)


def _odf_con_conexion(contenedor: int) -> int:
    with SessionLocal() as db:
        fila = db.execute(text(
            "SELECT d.id FROM ftth_dispositivos d "
            "JOIN ftth_puertos p ON p.dispositivo_id = d.id "
            "JOIN ftth_empalmes e ON e.puerto_id = p.id "
            "WHERE d.elemento_id = :i AND d.tipo = 'odf' LIMIT 1"), {"i": contenedor}
        ).fetchone()
    assert fila, "la base sintética debería tener un ODF con empalme"
    return int(fila[0])


def test_idempotencia():
    contenedor = _primer_armario()
    cuerpo = {"tipo": "splitter", "division": "1x8", "nombre": "PYTEST-IDEMP",
              "operation_id": "pytest-idempotencia",
              "base_revision": _revision(contenedor)}
    primera = peticion("POST", f"/api/contenedores/{contenedor}/dispositivos", json=cuerpo)
    assert primera.status_code == 200, primera.text
    ident = primera.json()["dispositivo"]["id"]

    segunda = peticion("POST", f"/api/contenedores/{contenedor}/dispositivos", json=cuerpo)
    assert segunda.status_code == 200, segunda.text
    assert segunda.json()["idempotente"] is True
    assert segunda.json()["dispositivo"]["id"] == ident


def test_conflicto_de_revision():
    contenedor = _primer_armario()
    vieja = _revision(contenedor) - 1
    respuesta = peticion(
        "POST", f"/api/contenedores/{contenedor}/dispositivos",
        json={"tipo": "odf", "operation_id": "pytest-conflicto", "base_revision": vieja})
    assert respuesta.status_code == 409, respuesta.text
    assert respuesta.json()["codigo"] == "conflicto"


def test_no_borrar_equipo_con_conexiones():
    contenedor = _primer_armario()
    dispositivo = _odf_con_conexion(contenedor)
    respuesta = peticion(
        "DELETE", f"/api/contenedores/{contenedor}/dispositivos/{dispositivo}",
        params={"operation_id": "pytest-borrar-con-conexiones"})
    assert respuesta.status_code == 409, respuesta.text
    assert "conexiones" in respuesta.text


def test_dos_escrituras_simultaneas():
    """Con la misma `base_revision` solo una puede ganar (409 la otra)."""
    contenedor = _primer_armario()
    revision = _revision(contenedor)

    def escribir(numero: int):
        return peticion(
            "POST", f"/api/contenedores/{contenedor}/dispositivos",
            json={"tipo": "splitter", "division": "1x4",
                  "nombre": f"PYTEST-CARRERA-{numero}",
                  "operation_id": f"pytest-carrera-{revision}-{numero}",
                  "base_revision": revision})

    with futuros.ThreadPoolExecutor(max_workers=2) as ejecutor:
        respuestas = list(ejecutor.map(escribir, (1, 2)))

    codigos = sorted(respuesta.status_code for respuesta in respuestas)
    assert codigos == [200, 409], [(r.status_code, r.text[:120]) for r in respuestas]
    assert _revision(contenedor) == revision + 1


def test_lo_guardado_por_el_puente_se_ve_igual():
    """Fase 5.2: un empalme creado por el puente (propiedades.origen='pop_gestor_v25')
    se lee en el módulo nativo SIN reescribirlo ni borrarlo."""
    contenedor = _primer_armario()
    with SessionLocal() as db:
        fibra = db.execute(text(
            "SELECT f.id FROM ftth_cable_fibras f "
            "JOIN ftth_elementos c ON c.id = f.elemento_id "
            "WHERE c.categoria = 'cables' ORDER BY f.hilo_global_no LIMIT 1")).scalar()
        assert fibra, "falta el cable de la base sintética"
        ya = db.execute(text(
            "SELECT id FROM ftth_empalmes WHERE nodo_id = :n AND fibra_a_id = :f"),
            {"n": contenedor, "f": fibra}).scalar()
        if ya:
            empalme_id = int(ya)
        else:
            db.execute(text(
                "INSERT INTO ftth_empalmes (proyecto_id, nodo_id, fibra_a_id, tipo, "
                "extremo_a, extremo_b, propiedades) "
                "VALUES (1, :n, :f, 'sangrado', 'entrada', 'salida', "
                "'{\"origen\": \"pop_gestor_v25\"}')"), {"n": contenedor, "f": fibra})
            db.commit()
            empalme_id = int(db.execute(text(
                "SELECT id FROM ftth_empalmes WHERE nodo_id = :n AND fibra_a_id = :f"),
                {"n": contenedor, "f": fibra}).scalar())

    diagrama = peticion("GET", f"/api/contenedores/{contenedor}/diagrama").json()
    conexion = next((c for c in diagrama["conexiones"] if c["id"] == empalme_id), None)
    assert conexion, "el módulo nativo NO ve la conexión guardada por el puente"
    assert conexion["propiedades"].get("origen") == "pop_gestor_v25", conexion["propiedades"]

    # Una escritura nativa no debe tocarla
    peticion("POST", f"/api/contenedores/{contenedor}/posiciones",
             json={"posiciones": [], "operation_id": "pytest-sin-posiciones",
                   "base_revision": _revision(contenedor)})
    despues = peticion("GET", f"/api/contenedores/{contenedor}/diagrama").json()
    otra = next((c for c in despues["conexiones"] if c["id"] == empalme_id), None)
    assert otra and otra["propiedades"].get("origen") == "pop_gestor_v25"


