"""
limpiar_datos_prueba.py

Borra del nodo indicado los aparatos y bandejas que dejaron las PRUEBAS
automatizadas (no toca nada más: no borra elementos, ni tipos, ni cables).

Por defecto muestra lo que borraría (simulación). Para aplicarlo: --si

    python scripts/limpiar_datos_prueba.py                 # ver qué haría
    python scripts/limpiar_datos_prueba.py --si             # borrarlo
    python scripts/limpiar_datos_prueba.py --nodo 103 --si

Qué borra:
  - Dispositivos con serie 'SN-PRUEBA%' (los crea prueba_nodo.py) y sus puertos.
  - Bandejas de ese nodo que queden VACÍAS (sin empalmes) y sin dispositivos.
"""
import argparse
import os
import sys

# La consola de Windows suele estar en cp1252: se fuerza UTF-8 para no fallar
# al imprimir acentos o flechas.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database import SessionLocal  # noqa: E402
import app.models.ftth_logica as logica  # noqa: E402
import app.models.ftth_models as fisicos  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Limpia los datos que dejan las pruebas")
    ap.add_argument("--nodo", type=int, default=None, help="elemento_id del nodo (por defecto: el que tenga 'SN-PRUEBA')")
    ap.add_argument("--si", action="store_true", help="aplicar de verdad (sin esto solo simula)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        consulta = db.query(logica.FtthDispositivo).filter(
            logica.FtthDispositivo.serie.like("SN-PRUEBA%")
        )
        if args.nodo:
            consulta = consulta.filter(logica.FtthDispositivo.elemento_id == args.nodo)
        dispositivos = consulta.all()

        if not dispositivos:
            print("No hay dispositivos de prueba (serie SN-PRUEBA...) que borrar.")
            return 0

        nodos = sorted({d.elemento_id for d in dispositivos})
        print("=" * 70)
        print("DATOS DE PRUEBA ENCONTRADOS" + (" (simulación)" if not args.si else " (se borrarán)"))
        print("=" * 70)
        total_puertos = 0
        bandejas_a_borrar = []
        for d in dispositivos:
            n_puertos = (
                db.query(logica.FtthPuerto)
                .filter(logica.FtthPuerto.dispositivo_id == d.id)
                .count()
            )
            total_puertos += n_puertos
            print(f"  nodo #{d.elemento_id}: dispositivo #{d.id} · {d.tipo} {d.division or ''} "
                  f"· serie={d.serie} · {n_puertos} puerto(s)")
            if d.bandeja_id:
                bandejas_a_borrar.append(d.bandeja_id)

        # Bandejas que quedarían vacías (sin dispositivos y sin empalmes)
        ids_disp = [d.id for d in dispositivos]
        for nodo in nodos:
            for b in db.query(logica.FtthBandeja).filter(logica.FtthBandeja.elemento_id == nodo).all():
                otros = (
                    db.query(logica.FtthDispositivo)
                    .filter(
                        logica.FtthDispositivo.bandeja_id == b.id,
                        ~logica.FtthDispositivo.id.in_(ids_disp),
                    )
                    .count()
                )
                if otros == 0:
                    bandejas_a_borrar.append(b.id)
                    print(f"  nodo #{nodo}: bandeja #{b.id} (nº {b.bandeja_no}, {b.tipo}) quedaría vacía")

        print(f"\n  Total: {len(dispositivos)} dispositivo(s), {total_puertos} puerto(s), "
              f"{len(set(bandejas_a_borrar))} bandeja(s)")

        if not args.si:
            print("\nSimulación: no se borró nada. Repite con --si para aplicarlo.")
            return 0

        for d in dispositivos:
            db.query(logica.FtthPuerto).filter(
                logica.FtthPuerto.dispositivo_id == d.id
            ).delete(synchronize_session=False)
            db.delete(d)
        for bid in set(bandejas_a_borrar):
            b = db.query(logica.FtthBandeja).filter(logica.FtthBandeja.id == bid).first()
            if b:
                db.delete(b)
        db.commit()
        print("\nLimpieza aplicada.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
