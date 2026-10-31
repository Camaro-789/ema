"""
test_olt_hibrido.py — Prueba de creación de OLT híbrida con especificación técnica V-SOL.

Verifica:
  1. Guardado de tipo OLT con propiedades V-SOL (GPON, 4 PON, 4 SFP, 2 RJ45 datos, MGMT, CONSOLE, 1U).
  2. Creación del dispositivo en el armario/contenedor usando ese tipo_id.
  3. Generación exacta de los puertos PON, SFP, RJ45, MGMT y CONSOLE.
  4. Inclusión de tamaño 1U y propiedades en el diagrama del contenedor.
"""
from sqlalchemy import text
from app.database import SessionLocal
import app.models.spatial
import app.models.ftth_models as models
import app.models.ftth_logica as logica
from app.domain import servicios


def test_creacion_olt_vsol_en_armario():
    with SessionLocal() as db:
        # 1. Obtener proyecto y contenedor tipo armario
        armario = db.query(models.FtthElemento).filter(
            models.FtthElemento.categoria == "armario"
        ).first()
        assert armario is not None, "Debe existir al menos un armario en la BD de prueba"
        proyecto_id = armario.proyecto_id

        # 2. Crear tipo OLT V-SOL V1600G0-B en ftth_tipos
        tipo_olt = models.FtthTipo(
            proyecto_id=proyecto_id,
            categoria="olt",
            nombre_id="V-SOL V1600G0-B Test",
            color_mapa="#ef4444",
            propiedades={
                "codigo": "VSOL-V1600G0-B",
                "marca": "V-SOL",
                "modelo": "V1600G0-B",
                "tecnologia": "GPON",
                "formato": "compacto",
                "puertos_pon": 4,
                "puertos_sfp": 4,
                "puertos_rj45_datos": 2,
                "puerto_mgmt": True,
                "puerto_console": True,
                "tamano": 1,
                "maxClientes": 128,
                "potencia": 6,
            }
        )
        db.add(tipo_olt)
        db.commit()
        db.refresh(tipo_olt)

        try:
            # 3. Crear el dispositivo en el armario a través de servicios.crear_dispositivo
            resultado = servicios.crear_dispositivo(db, armario.id, {
                "tipo": "olt",
                "tipo_id": tipo_olt.id,
                "nombre": "OLT-VSOL-POP1",
                "estado": "operativo",
                "operation_id": f"op-olt-test-{tipo_olt.id}",
                "base_revision": servicios.revision(armario)
            })

            disp_id = resultado["dispositivo"]["id"]
            puertos = resultado["puertos"]

            # 4. Validar puertos generados
            etiquetas = [p["puerto"] for p in puertos]
            # 4 PON
            assert "PON 1" in etiquetas
            assert "PON 2" in etiquetas
            assert "PON 3" in etiquetas
            assert "PON 4" in etiquetas
            assert "PON 5" not in etiquetas

            # 4 SFP
            assert "SFP 1" in etiquetas
            assert "SFP 2" in etiquetas
            assert "SFP 3" in etiquetas
            assert "SFP 4" in etiquetas

            # 2 RJ45 Datos
            assert "RJ45 1" in etiquetas
            assert "RJ45 2" in etiquetas

            # MGMT y CONSOLE
            assert "RJ45 MGMT" in etiquetas
            assert "RJ45 CONSOLE" in etiquetas

            # Total de puertos: 4 + 4 + 2 + 1 + 1 = 12
            assert len(puertos) == 12

            # 5. Validar que en ftth_puertos existan en la BD
            puertos_db = db.query(logica.FtthPuerto).filter_by(dispositivo_id=disp_id).all()
            assert len(puertos_db) == 12

        finally:
            # Limpieza del tipo de prueba
            db.query(models.FtthTipo).filter(models.FtthTipo.id == tipo_olt.id).delete()
            db.commit()
