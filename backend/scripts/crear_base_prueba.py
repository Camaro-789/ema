"""
crear_base_prueba.py — Crea la base SINTÉTICA de pruebas (regla R7).

Genera `backend/tests/tachira_maps_test.db` con datos inventados:

  · 2 postes, 2 gabinetes (armario OLT HUB y gabinete secundario)
  · dentro del gabinete A: OLT (8 PON), ODF 24, splitter 1x8 y 1x16
  · dentro del gabinete B: splitter 1x16
  · 1 caja NAP y 1 manga (para el futuro módulo de contenedores)
  · 1 cable de 96 hilos (8 tubos × 12) anclado A=gabinete A, B=gabinete B,
    con sus 192 extremos
  · 3 empalmes: uno 'paso', uno 'conector' (hilo↔puerto) y uno 'sangrado'
  · posiciones de diagrama para 3 equipos

NUNCA toca `tachira_maps.db` ni los respaldos: escribe un archivo aparte y lo
recrea entero cada vez.

Uso (desde backend/):
    python scripts/crear_base_prueba.py
    python scripts/crear_base_prueba.py --equipos-extra 500   (pruebas de escala)
"""
import argparse
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.database import Base  # noqa: E402
import app.models.spatial as spatial  # noqa: E402,F401
import app.models.ftth_models as fisicos  # noqa: E402
import app.models.ftth_logica as logica  # noqa: E402

CARPETA = os.path.join(BASE, "tests")
ARCHIVO = os.path.join(CARPETA, "tachira_maps_test.db")

# TIA-598: 12 colores por tubo
COLORES = [
    ("verde", "#00a651"), ("naranja", "#f7941d"), ("azul", "#0072bc"),
    ("marron", "#8b5a2b"), ("gris", "#9aa0a6"), ("blanco", "#ffffff"),
    ("rojo", "#e31b23"), ("negro", "#111111"), ("amarillo", "#ffd400"),
    ("violeta", "#7b3fa0"), ("rosa", "#f49ac1"), ("aqua", "#00b7c3"),
]


def crear_tipos(db, proyecto):
    """Catálogo mínimo con las plantillas que usan las pruebas."""
    plantillas = [
        ("poste", "Poste 8 m", {"altura_m": 8}),
        ("armario", "Armario OLT HUB", {"nivel": "olt_hub", "prefijo": "CO_"}),
        ("armario", "Gabinete secundario", {"nivel": "pop_secundario", "prefijo": "GB_"}),
        ("olt", "OLT 8 PON", {"cantidad_puertos": 8, "puertos": 8}),
        ("odf", "ODF 24", {"capacidad_puertos": 24, "puertos": 24}),
        ("splitter", "Splitter 1x8 AF",
         {"relacion_division": "1x8", "division": "1x8", "entradas": 1, "salidas": 8, "clase": "AF"}),
        ("splitter", "Splitter 1x16 AF",
         {"relacion_division": "1x16", "division": "1x16", "entradas": 1, "salidas": 16, "clase": "AF"}),
        ("switches", "Switch Core 24", {"cantidad_puertos": 24, "puertos": 24}),
        ("cajanap", "Caja NAP 16", {"capacidad_puertos": 16, "puertos": 16}),
        ("manga", "Manga 24", {"capacidad_fusion": 24}),
        ("cables", "Cable 96 hilos",
         {"fibras": 96, "estructura": "8x12", "plantilla_visual": "fibra", "looses": 8}),
    ]
    tipos = {}
    for categoria, nombre, props in plantillas:
        fila = fisicos.FtthTipo(
            proyecto_id=proyecto, categoria=categoria, nombre_id=nombre,
            color_mapa="#3388ff", propiedades=props,
        )
        db.add(fila)
        db.flush()
        tipos[f"{categoria}:{nombre}"] = fila.id
    return tipos


def crear_elemento(db, proyecto, tipo_id, categoria, lat, lon, **extra):
    elemento = fisicos.FtthElemento(
        proyecto_id=proyecto, tipo_id=tipo_id, categoria=categoria,
        lat=lat, lon=lon, propiedades_instancia=extra.pop("propiedades_instancia", {}),
        **extra,
    )
    db.add(elemento)
    db.flush()
    return elemento


def crear_puertos(db, proyecto, dispositivo, direcciones):
    """Crea los puertos indicados: [(direccion, numero), ...]."""
    for direccion, numero, etiqueta in direcciones:
        db.add(logica.FtthPuerto(
            proyecto_id=proyecto, dispositivo_id=dispositivo.id,
            elemento_id=dispositivo.elemento_id, direccion=direccion,
            puerto_no=numero, estado="libre", etiqueta=etiqueta,
        ))
    db.flush()


def crear_dispositivo(db, proyecto, elemento, tipo_id, tipo, serie, division,
                      puertos_in, puertos_out, atenuacion):
    dispositivo = logica.FtthDispositivo(
        proyecto_id=proyecto, elemento_id=elemento.id, tipo_id=tipo_id, tipo=tipo,
        serie=serie, division=division, puertos_in=puertos_in,
        puertos_out=puertos_out, atenuacion_db=atenuacion, estado="operativo",
    )
    db.add(dispositivo)
    db.flush()
    return dispositivo


def crear_cable_96(db, proyecto, tipo_id, nodo_a, nodo_b, tubos=8, hilos_por_tubo=12):
    """Cable holgado con 96 hilos y sus 192 extremos (A en nodo_a, B en nodo_b)."""
    cable = crear_elemento(
        db, proyecto, tipo_id, "cables", 7.77, -72.22,
        extremo_A_id=nodo_a.id, extremo_B_id=nodo_b.id,
        propiedades_instancia={"codigo": "C-96-PRUEBA", "estructura": "8x12"},
    )
    fibras = []
    total = tubos * hilos_por_tubo
    for tubo_no in range(1, tubos + 1):
        nombre_color, hex_color = COLORES[(tubo_no - 1) % len(COLORES)]
        tubo = logica.FtthCableTubo(
            proyecto_id=proyecto, elemento_id=cable.id, tubo_no=tubo_no,
            color=nombre_color, color_hex=hex_color,
            capacidad_fibras=hilos_por_tubo, etiqueta=f"T{tubo_no:02d}",
        )
        db.add(tubo)
        db.flush()
        for hilo in range(1, hilos_por_tubo + 1):
            color, hexa = COLORES[(hilo - 1) % len(COLORES)]
            fibra = logica.FtthCableFibra(
                proyecto_id=proyecto, elemento_id=cable.id, tubo_id=tubo.id,
                hilo_no_en_tubo=hilo,
                hilo_global_no=(tubo_no - 1) * hilos_por_tubo + hilo,
                color=color, color_hex=hexa, estado="libre", perfil="G.652D",
            )
            db.add(fibra)
            fibras.append(fibra)
    db.flush()
    for fibra in fibras:
        db.add(logica.FtthFibraExtremo(proyecto_id=proyecto, fibra_id=fibra.id,
                                       extremo="A", nodo_id=nodo_a.id, holgura_m=10.0))
        db.add(logica.FtthFibraExtremo(proyecto_id=proyecto, fibra_id=fibra.id,
                                       extremo="B", nodo_id=nodo_b.id, holgura_m=10.0))
    db.flush()
    print(f"  cable #{cable.id}: {total} hilos, {total * 2} extremos")
    return cable, fibras


def construir(db, equipos_extra=0):
    """Crea el escenario sintético completo."""
    proyecto_row = spatial.MapProject(
        name="PROYECTO PRUEBA (sintetico)", center_lat=7.77, center_lon=-72.22, zoom=12
    )
    db.add(proyecto_row)
    db.flush()
    proyecto = proyecto_row.id

    tipos = crear_tipos(db, proyecto)
    t = lambda clave: tipos[clave]  # noqa: E731

    print(f"proyecto #{proyecto} · {len(tipos)} tipos")

    poste1 = crear_elemento(db, proyecto, t("poste:Poste 8 m"), "poste", 7.7701, -72.2201)
    poste2 = crear_elemento(db, proyecto, t("poste:Poste 8 m"), "poste", 7.7711, -72.2211)
    gab_a = crear_elemento(db, proyecto, t("armario:Armario OLT HUB"), "armario",
                           7.7700, -72.2200, propiedades_instancia={"codigo": "CO-PRUEBA"})
    gab_b = crear_elemento(db, proyecto, t("armario:Gabinete secundario"), "armario",
                           7.7750, -72.2250, propiedades_instancia={"codigo": "GB-PRUEBA"})
    nap = crear_elemento(db, proyecto, t("cajanap:Caja NAP 16"), "cajanap",
                         7.7702, -72.2202, poste_ref_id=poste1.id)
    manga = crear_elemento(db, proyecto, t("manga:Manga 24"), "manga",
                           7.7705, -72.2205, poste_ref_id=poste2.id)
    print(f"  contenedores: gabinete A #{gab_a.id}, gabinete B #{gab_b.id}, "
          f"NAP #{nap.id}, manga #{manga.id}")

    bandejas = [
        logica.FtthBandeja(proyecto_id=proyecto, elemento_id=gab_a.id, bandeja_no=1,
                           tipo="mixta", slots=24, etiqueta="B1 fusiones"),
        logica.FtthBandeja(proyecto_id=proyecto, elemento_id=gab_a.id, bandeja_no=2,
                           tipo="splitter", slots=16, etiqueta="B2 splitters"),
        logica.FtthBandeja(proyecto_id=proyecto, elemento_id=gab_b.id, bandeja_no=1,
                           tipo="empalme", slots=12, etiqueta="B1 cliente"),
    ]
    db.add_all(bandejas)
    db.flush()

    olt = crear_dispositivo(db, proyecto, gab_a, t("olt:OLT 8 PON"), "olt",
                            "OLT-TEST-01", None, 0, 8, None)
    crear_puertos(db, proyecto, olt, [("OUT", n, f"PON {n}") for n in range(1, 9)])

    odf = crear_dispositivo(db, proyecto, gab_a, t("odf:ODF 24"), "odf",
                            "ODF-TEST-01", None, 0, 24, 0.1)
    crear_puertos(db, proyecto, odf, [("BIDI", n, f"ODF-{n:02d}") for n in range(1, 25)])

    sp8 = crear_dispositivo(db, proyecto, gab_a, t("splitter:Splitter 1x8 AF"), "splitter",
                            "SPL-1x8-01", "1x8", 1, 8, 10.7)
    crear_puertos(db, proyecto, sp8,
                  [("IN", 1, "IN")] + [("OUT", n, f"OUT {n}") for n in range(1, 9)])

    sp16 = crear_dispositivo(db, proyecto, gab_b, t("splitter:Splitter 1x16 AF"), "splitter",
                             "SPL-1x16-01", "1x16", 1, 16, 14.0)
    crear_puertos(db, proyecto, sp16,
                  [("IN", 1, "IN")] + [("OUT", n, f"OUT {n}") for n in range(1, 17)])
    print(f"  equipos: OLT #{olt.id}, ODF #{odf.id}, splitters #{sp8.id} y #{sp16.id}")

    cable, fibras = crear_cable_96(db, proyecto, t("cables:Cable 96 hilos"), gab_a, gab_b)

    puerto_odf = (
        db.query(logica.FtthPuerto)
        .filter(logica.FtthPuerto.elemento_id == gab_a.id,
                logica.FtthPuerto.direccion == "BIDI",
                logica.FtthPuerto.puerto_no == 1)
        .first()
    )
    empalmes = [
        logica.FtthEmpalme(proyecto_id=proyecto, nodo_id=gab_a.id, bandeja_id=bandejas[0].id,
                           slot=1, fibra_a_id=fibras[0].id, fibra_b_id=fibras[12].id,
                           tipo="paso", extremo_a="entrada", extremo_b="salida",
                           etiqueta="paso T01-H01 a T02-H01", propiedades={"waypoints": []}),
        logica.FtthEmpalme(proyecto_id=proyecto, nodo_id=gab_a.id, bandeja_id=bandejas[0].id,
                           slot=2, fibra_a_id=fibras[1].id, fibra_b_id=None,
                           puerto_id=puerto_odf.id if puerto_odf else None,
                           tipo="conector", extremo_a="entrada", extremo_b="salida",
                           etiqueta="conector a ODF-01", propiedades={"waypoints": []}),
        logica.FtthEmpalme(proyecto_id=proyecto, nodo_id=gab_b.id, bandeja_id=bandejas[2].id,
                           slot=1, fibra_a_id=fibras[2].id, fibra_b_id=None,
                           tipo="sangrado", extremo_a="entrada", extremo_b="salida",
                           etiqueta="sangrado cliente", propiedades={"waypoints": []}),
    ]
    db.add_all(empalmes)
    db.flush()
    print(f"  empalmes: {len(empalmes)} (paso, conector, sangrado)")

    db.add_all([
        logica.FtthDiagramaPosicion(proyecto_id=proyecto, elemento_id=gab_a.id,
                                    dispositivo_id=olt.id, x=40, y=40),
        logica.FtthDiagramaPosicion(proyecto_id=proyecto, elemento_id=gab_a.id,
                                    dispositivo_id=odf.id, x=300, y=40),
        logica.FtthDiagramaPosicion(proyecto_id=proyecto, elemento_id=gab_a.id,
                                    dispositivo_id=sp8.id, x=560, y=200),
    ])

    for indice in range(equipos_extra):
        extra = crear_dispositivo(db, proyecto, gab_b, t("splitter:Splitter 1x8 AF"),
                                  "splitter", f"SPL-X-{indice:04d}", "1x8", 1, 8, 10.7)
        crear_puertos(db, proyecto, extra,
                      [("IN", 1, "IN")] + [("OUT", n, f"OUT {n}") for n in range(1, 9)])
    if equipos_extra:
        print(f"  equipos extra (escala): {equipos_extra}")

    return cable, fibras


def main():
    parser = argparse.ArgumentParser(description="Crea la base sintetica de pruebas (R7)")
    parser.add_argument("--equipos-extra", type=int, default=0,
                        help="splitters adicionales para pruebas de escala")
    parser.add_argument("--archivo", default=ARCHIVO)
    args = parser.parse_args()

    destino = os.path.abspath(args.archivo)
    nombre = os.path.basename(destino).lower()
    if not nombre.endswith("_test.db"):
        print("ABORTADO: el archivo debe terminar en _test.db (regla R7).")
        return 2
    if nombre == "tachira_maps.db" or "respaldo" in nombre or "backup" in nombre:
        print("ABORTADO: ese nombre parece una base real o un respaldo (regla R7).")
        return 2

    os.makedirs(os.path.dirname(destino), exist_ok=True)
    if os.path.exists(destino):
        os.remove(destino)

    engine = create_engine(f"sqlite:///{destino}")
    Base.metadata.create_all(engine)
    Sesion = sessionmaker(bind=engine)

    print(f"BASE SINTETICA: {destino}")
    with Sesion() as db:
        construir(db, args.equipos_extra)
        db.commit()

    with Sesion() as db:
        resumen = [
            ("tipos", fisicos.FtthTipo), ("elementos", fisicos.FtthElemento),
            ("dispositivos", logica.FtthDispositivo), ("puertos", logica.FtthPuerto),
            ("bandejas", logica.FtthBandeja), ("tubos", logica.FtthCableTubo),
            ("fibras", logica.FtthCableFibra), ("extremos", logica.FtthFibraExtremo),
            ("empalmes", logica.FtthEmpalme), ("posiciones", logica.FtthDiagramaPosicion),
        ]
        print("-" * 50)
        for etiqueta, modelo in resumen:
            print(f"  {etiqueta:<14} {db.query(modelo).count()}")
        print("-" * 50)

    print(f"listo: {os.path.getsize(destino)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


