"""
Modelos de la CAPA LÓGICA FTTH (topología y conectividad).

IMPORTANTE — diseño no destructivo (ver docs/DISENO_CAPA_LOGICA.md §12):
- Este archivo SOLO crea tablas NUEVAS.
- No modifica `ftth_elementos`, `ftth_tipos`, `ftth_carpetas` ni ninguna tabla existente.
- Ninguna columna de este archivo es obligatoria para el mapa: si no se usa la capa
  lógica, la aplicación funciona exactamente igual que antes.

Contención implementada en este incremento:
    cable (ftth_elementos, categoria='cables')
      └── tubo holgado  -> ftth_cable_tubos
            └── hilo    -> ftth_cable_fibras
                  └── extremo A/B -> ftth_fibra_extremos

Y el orden del lienzo del diagrama (solo presentación, no es topología):
    aparato (ftth_dispositivos)
      └── posición en el diagrama -> ftth_diagrama_posiciones
"""
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    ForeignKey,
    UniqueConstraint,
    Index,
    JSON,
    cast,
)
from sqlalchemy import update
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
import math
import re

from app.database import Base

# Código de colores TIA-598-C (12 colores, se cicla para tubos > 12)
TIA598_NOMBRES = [
    "Azul", "Naranja", "Verde", "Marrón", "Pizarra", "Blanco",
    "Rojo", "Negro", "Amarillo", "Violeta", "Rosa", "Aguamarina",
]
TIA598_HEX = [
    "#1E90FF", "#FF8C00", "#22C55E", "#8B4513", "#708090", "#F1F5F9",
    "#EF4444", "#111111", "#EAB308", "#A855F7", "#EC4899", "#06B6D4",
]

# Estados válidos de un hilo
ESTADOS_FIBRA = ("libre", "empalmado", "conectado", "reservado", "averiado")

# Tope del catálogo de splitters: 1x64 es el mayor que se admite. Vive aquí, junto
# al dominio, para que el catálogo de tipos y la materialización usen el MISMO
# número. El frontend lo refleja en frontend/js/ftth-tipos.js (SPLITTER_MAX_*).
MAX_SPLITTER_SALIDAS = 64
MAX_SPLITTER_ENTRADAS = 2

# ── Estructura de la plantilla de un cable (con buffer / drop) ────────────────
# Un cable se define por su ESTRUCTURA:
#   con_buffer → trae buffers (looses). fibras por buffer = total / looses.
#   drop       → cable plano, SIN buffer. Solo total de hilos (1, 2, 4, 6 u 8).
# Estas reglas viven aquí, junto al dominio, para que el catálogo de tipos y la
# materialización usen los MISMOS números. El frontend las refleja en
# frontend/js/ftth-cable-reglas.js (una prueba compara las dos tablas).
ESTRUCTURA_CON_BUFFER = "con_buffer"
ESTRUCTURA_DROP = "drop"
ESTRUCTURAS_CABLE = (ESTRUCTURA_CON_BUFFER, ESTRUCTURA_DROP)

# Plantilla visual que le toca a cada estructura (valor que se guarda en
# ftth_tipos.propiedades.plantilla_visual y que resuelve FTTHPlantillas).
PLANTILLA_VISUAL_CABLE = {
    ESTRUCTURA_CON_BUFFER: "fibra_cable",       # dibuja la franja del buffer
    ESTRUCTURA_DROP: "fibra_cable_drop",        # plano: hilos directos del jacket
}

# Máximo de fibras por buffer que admite cada perfil de fibra.
MAX_FIBRAS_POR_BUFFER_POR_PERFIL = {
    "eia598a": 12,   # EIA/TIA-598-A: buffer de 12 hilos con código de colores
    "abnt": 24,      # ABNT NBR: buffer de hasta 24 hilos
    "custom": 24,    # perfil personalizado: se admite hasta 24
}
# Perfil que se usa cuando la plantilla no declara ninguno.
PERFIL_FIBRA_POR_DEFECTO = "eia598a"

MAX_LOOSES_CABLE = 96            # buffers máximos de un cable
LOOSES_DROP = 1                  # un drop no agrupa: se guarda 1 y no se muestra
HILOS_DROP = (1, 2, 4, 6, 8)     # totales de hilos reales de mercado para un drop


def max_fibras_por_buffer(perfil) -> int:
    """Máximo de fibras por buffer del perfil indicado (por defecto, el más amplio)."""
    clave = str(perfil or "").strip().lower()
    if clave in MAX_FIBRAS_POR_BUFFER_POR_PERFIL:
        return MAX_FIBRAS_POR_BUFFER_POR_PERFIL[clave]
    return MAX_FIBRAS_POR_BUFFER_POR_PERFIL["custom"]


def normalizar_cable(props: dict) -> dict:
    """
    Traduce la plantilla de un cable a sus valores canónicos.

    CON BUFFER  → looses y fibras son la entrada; fibrasLoose = fibras / looses
                  (división EXACTA, sin residuo) y no puede superar el máximo de
                  fibras por buffer del perfil de fibra.
    DROP        → looses = 1 (no se muestra), fibrasLoose = fibras y el total
                  debe ser uno de los valores reales de mercado (1, 2, 4, 6, 8).

    Devuelve una copia de `props` ya normalizada (con `looses`, `fibras`,
    `fibrasLoose` y `plantilla_visual`, y sin `perfil` en un drop).
    Lanza ValueError con el motivo exacto: el catálogo lo convierte en HTTP 400.
    """
    datos = dict(props or {})
    estructura = str(datos.get("estructura") or ESTRUCTURA_CON_BUFFER).strip().lower()
    if estructura not in ESTRUCTURAS_CABLE:
        raise ValueError(
            f"Estructura de cable «{datos.get('estructura')}» no válida. "
            f"Permitidas: {', '.join(ESTRUCTURAS_CABLE)}."
        )

    if estructura == ESTRUCTURA_DROP:
        total = _entero_cable(datos.get("fibras"))
        if total is None:
            raise ValueError(
                "Un cable drop necesita su número total de hilos (1, 2, 4, 6 u 8)."
            )
        if total not in HILOS_DROP:
            raise ValueError(
                f"Un cable drop solo admite {', '.join(str(n) for n in HILOS_DROP)} hilos "
                f"(se pidieron {total}): no existen cables drop de ese tamaño."
            )
        datos["estructura"] = ESTRUCTURA_DROP
        datos["looses"] = LOOSES_DROP          # fijo internamente, no se muestra
        datos["fibras"] = total
        datos["fibrasLoose"] = total           # sin agrupación real
        datos.pop("perfil", None)              # un drop no tiene perfil de buffer
        datos["plantilla_visual"] = PLANTILLA_VISUAL_CABLE[ESTRUCTURA_DROP]
        return datos

    looses = _entero_cable(datos.get("looses"))
    total = _entero_cable(datos.get("fibras"))
    if looses is None or looses < 1:
        raise ValueError(
            "Un cable con buffer necesita su número de looses (buffers), mayor que cero."
        )
    if looses > MAX_LOOSES_CABLE:
        raise ValueError(
            f"Un cable no puede tener {looses} looses: el máximo es {MAX_LOOSES_CABLE}."
        )
    if total is None or total < 1:
        raise ValueError("Un cable con buffer necesita su número total de fibras.")
    if total % looses != 0:
        raise ValueError(
            f"{total} fibras no se reparten en {looses} looses (sobra "
            f"{total % looses}): el total debe ser divisible exactamente entre el "
            "número de looses."
        )

    por_buffer = total // looses
    perfil = datos.get("perfil") or PERFIL_FIBRA_POR_DEFECTO
    tope = max_fibras_por_buffer(perfil)
    if por_buffer > tope:
        raise ValueError(
            f"{por_buffer} fibras por buffer superan el máximo de {tope} del perfil "
            f"«{perfil}». Baja las fibras o sube los looses."
        )

    datos["estructura"] = ESTRUCTURA_CON_BUFFER
    datos["looses"] = looses
    datos["fibras"] = total
    datos["fibrasLoose"] = por_buffer
    datos["perfil"] = perfil
    datos["plantilla_visual"] = PLANTILLA_VISUAL_CABLE[ESTRUCTURA_CON_BUFFER]
    return datos


def _entero_cable(valor):
    """Entero positivo desde un valor de formulario, o None si no es un número."""
    if valor is None or valor == "":
        return None
    try:
        return int(float(valor))
    except (TypeError, ValueError):
        return None


# Alias corto: el correlativo visible usa el mismo criterio de entero que el resto
# del archivo (y así `numerar_objetos_sin_numero` se lee igual que el resto).
_to_int = _entero_cable

# División de un splitter: "1x8", "1 x 16", "1X4", "2:16" e incluso
# "1x8 (10.7 dB)" (el formato que guarda el formulario de Tipos de objetos).
# Vive aquí para que el catálogo de tipos y la materialización usen el MISMO
# parser: antes cada módulo tenía el suyo y el de materialización fallaba con
# el sufijo "(10.7 dB)".
DIVISION_RE = re.compile(r"(\d+)\s*[xX:]\s*(\d+)")


def parsear_division(division) -> "tuple | None":
    """
    Devuelve (entradas, salidas) a partir de un texto de división, o None.

        '1x8'           -> (1, 8)
        '1 x 16'        -> (1, 16)
        '1x8 (10.7 dB)' -> (1, 8)
        'sin division'  -> None
    """
    if division is None:
        return None
    if isinstance(division, (list, tuple)) and len(division) == 2:
        try:
            entradas, salidas = int(division[0]), int(division[1])
        except (TypeError, ValueError):
            return None
        return (entradas, salidas) if entradas >= 1 and salidas >= 1 else None
    hallado = DIVISION_RE.search(str(division))
    if not hallado:
        return None
    entradas, salidas = int(hallado.group(1)), int(hallado.group(2))
    if entradas < 1 or salidas < 1:
        return None
    return (entradas, salidas)


def color_tia598(numero: int) -> tuple:
    """Devuelve (nombre, hex) del color TIA-598 para una posición 1..N (cicla cada 12)."""
    try:
        n = int(numero)
    except (TypeError, ValueError):
        n = 1
    if n < 1:
        n = 1
    idx = (n - 1) % 12
    return TIA598_NOMBRES[idx], TIA598_HEX[idx]


class FtthSecuencia(Base):
    """
    Contador ATÓMICO del correlativo visible de los objetos, por proyecto y clave.

    El número que ve el usuario («#41») NO es el id: es un correlativo POR TIPO de
    objeto que se separa entre sí (40 cajas → la próxima caja es la 41; 60 mangas →
    la próxima manga la 61). El id interno sigue siendo único y global.

    Por qué un contador en tabla y no `MAX(numero) + 1` al guardar: si dos personas
    crean el mismo tipo de objeto a la vez, ambas leerían el mismo MAX antes de que
    la otra guarde y saldrían dos objetos con el mismo número. Aquí el incremento es
    un `UPDATE ... ultimo = ultimo + 1` que bloquea la fila hasta el commit, así que
    el reparto es seguro incluso con creaciones simultáneas (vale igual para SQLite
    y para PostgreSQL; no hay que crear secuencias nativas por tipo).
    """

    __tablename__ = "ftth_secuencias"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Clave del contador: la CATEGORÍA del objeto (poste, cajanap, manga, cables…)
    clave = Column(String(60), nullable=False)
    ultimo = Column(Integer, nullable=False, default=0)

    __table_args__ = (
        UniqueConstraint("proyecto_id", "clave", name="uq_ftth_secuencia"),
    )


def numerar_objetos_sin_numero(db, proyecto_id: int, clave: str) -> int:
    """
    Da número a los objetos YA creados de esa clave que todavía no lo tengan (por
    id ascendente, saltando los números ya usados) y devuelve el último asignado.

    Es lo que hace que un proyecto que ya venía funcionando siga la cuenta: si ya
    hay 40 cajas sin número, quedan 1..40 y la próxima caja será la 41.
    """
    import app.models.ftth_models as fisicos  # local: evita dependencias cruzadas

    filas = (
        db.query(fisicos.FtthElemento)
        .filter(
            fisicos.FtthElemento.proyecto_id == proyecto_id,
            fisicos.FtthElemento.categoria == clave,
        )
        .order_by(fisicos.FtthElemento.id)
        .all()
    )
    numeros = [
        _to_int((el.propiedades_instancia or {}).get("numero")) for el in filas
    ]
    usados = {n for n in numeros if n}
    ultimo = max(usados) if usados else 0

    for el, numero in zip(filas, numeros):
        if numero:
            continue
        ultimo += 1
        while ultimo in usados:      # nunca se reparte un número ya usado
            ultimo += 1
        usados.add(ultimo)
        props = dict(el.propiedades_instancia or {})
        props["numero"] = ultimo
        el.propiedades_instancia = props
    return ultimo


def _fila_secuencia(db, proyecto_id: int, clave: str):
    """Fila del contador de (proyecto, clave), creándola con el valor inicial si falta."""
    import app.models.ftth_models as fisicos  # noqa: F401  (asegura el mapeo)

    filtro = (
        db.query(FtthSecuencia)
        .filter(FtthSecuencia.proyecto_id == proyecto_id, FtthSecuencia.clave == clave)
    )
    fila = filtro.first()
    if fila is not None:
        return fila

    inicial = numerar_objetos_sin_numero(db, proyecto_id, clave)
    try:
        # SAVEPOINT: si otra petición creó la fila en paralelo, solo se pierde esto
        with db.begin_nested():
            fila = FtthSecuencia(proyecto_id=proyecto_id, clave=clave, ultimo=inicial)
            db.add(fila)
            db.flush()
    except IntegrityError:
        fila = filtro.first()
        if fila is None:
            raise
    return fila


def siguiente_numero(db, proyecto_id: int, clave: str) -> int:
    """
    Siguiente correlativo visible de (proyecto, clave), repartido de forma ATÓMICA.

    Es un `UPDATE ... ultimo = ultimo + 1` sobre una fila con UNIQUE(proyecto_id,
    clave): la fila queda bloqueada hasta el commit, así que dos creaciones a la vez
    NUNCA obtienen el mismo número (no hay ventana entre leer y escribir).
    """
    fila = _fila_secuencia(db, proyecto_id, clave)
    db.execute(
        update(FtthSecuencia)
        .where(FtthSecuencia.id == fila.id)
        .values(ultimo=FtthSecuencia.ultimo + 1)
    )
    db.flush()
    db.refresh(fila)
    return int(fila.ultimo or 1)


# ── Geometría del cable derivada de los postes ────────────────────────────────
# La geometría de un cable vive en `ftth_elementos.coords_json` (columna JSON; en
# esta instalación NO hay PostGIS) y el GeoJSON se arma al leer, así que se puede
# RECALCULAR sin migrar nada. Regla: si el cable pasa por postes, los vértices de
# esos postes se leen SIEMPRE de su lat/lon actual — la línea sigue al poste
# cuando se mueve. Un trazado libre (sin postes) no se toca.

def _coord_guardada(par):
    """[lon, lat] desde una coordenada guardada (lista/tupla), o None si no sirve."""
    if not isinstance(par, (list, tuple)) or len(par) < 2:
        return None
    try:
        return [float(par[0]), float(par[1])]
    except (TypeError, ValueError):
        return None


def _coord_de_elemento(elemento):
    """[lon, lat] ACTUAL de un elemento puntual, o None si no tiene coordenadas."""
    if elemento is None or elemento.lon is None or elemento.lat is None:
        return None
    return _coord_guardada([elemento.lon, elemento.lat])


def _postes_por_id(db, ids):
    """{id: elemento} de los postes indicados (los que existan)."""
    import app.models.ftth_models as fisicos

    limpios = [_to_int(i) for i in (ids or [])]
    limpios = [i for i in limpios if i]
    if not limpios:
        return {}
    filas = (
        db.query(fisicos.FtthElemento)
        .filter(fisicos.FtthElemento.id.in_(limpios))
        .all()
    )
    return {f.id: f for f in filas}


def geometria_desde_trazado(db, props, coords_actuales=None):
    """
    Coordenadas del cable leyendo los postes EN VIVO (o [] si no hay con qué).

    `props["trazado_ruta"]` es la ruta tal como la dibujó el usuario:

        [{"poste": 126}, {"punto": [-72.22, 7.76]}, {"poste": 127}, ...]

    Cada paso de poste se resuelve con su lat/lon ACTUAL; los pasos libres usan su
    punto guardado (así un clic fuera de poste no se pierde). Si el poste ya no
    existe, ese vértice se omite en vez de dejar la línea clavada.

    Sin `trazado_ruta` (cables anteriores) se usa `postes_intermedios` entre el
    primer y el último vértice de la geometría guardada.
    """
    p = props or {}
    ruta = p.get("trazado_ruta")

    if isinstance(ruta, list) and ruta:
        ids = [
            paso.get("poste") for paso in ruta
            if isinstance(paso, dict) and paso.get("poste") is not None
        ]
        postes = _postes_por_id(db, ids)
        coords = []
        for paso in ruta:
            if not isinstance(paso, dict):
                continue
            if paso.get("poste") is not None:
                coord = _coord_de_elemento(postes.get(_to_int(paso.get("poste"))))
            else:
                coord = _coord_guardada(paso.get("punto"))
            if coord and coord not in coords[-1:]:
                coords.append(coord)
        return coords

    ids = p.get("postes_intermedios")
    if not isinstance(ids, list) or not ids:
        return []

    postes = _postes_por_id(db, ids)
    guardadas = [_coord_guardada(c) for c in (coords_actuales or [])]
    guardadas = [c for c in guardadas if c]

    coords = []
    if guardadas:
        coords.append(guardadas[0])      # punta de origen del trazado
    for bruto in ids:
        coord = _coord_de_elemento(postes.get(_to_int(bruto)))
        if coord and coord not in coords[-1:]:
            coords.append(coord)
    if len(guardadas) >= 2 and guardadas[-1] not in coords[-1:]:
        coords.append(guardadas[-1])     # punta de destino del trazado
    return coords


# Un vértice a menos de 2 m del poste ES ese poste: los trazados reales dejan el
# racimo de vértices a 0,0-1,2 m del poste y el siguiente punto a más de 13 m, así
# que hay margen de sobra para no confundir un poste con un simple punto de paso.
TOLERANCIA_POSTE_M = 2.0


def _metros_entre(lon1, lat1, lon2, lat2):
    """Distancia en metros entre dos coordenadas (Haversine, suficiente a esta escala)."""
    radio = 6371000.0
    rad = math.pi / 180.0
    dlat = (lat2 - lat1) * rad
    dlon = (lon2 - lon1) * rad
    a = (math.sin(dlat / 2) ** 2
         + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(dlon / 2) ** 2)
    return radio * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def poste_mas_cercano(db, proyecto_id, lon, lat, tol=TOLERANCIA_POSTE_M):
    """
    Id del POSTE más cercano a (lon, lat) dentro de `tol` metros (o None).

    Permite anclar una caja/manga/… al poste sobre el que se colocó aunque el clic
    NO viniera del menú «Agregar … a este poste»: la detección de cables que pasan
    por ahí (`cables_divisibles`) depende de `poste_ref_id`, así que sin esto una
    caja colocada a mano junto a un poste no ofrecía «meter el cable al diagrama».
    """
    import app.models.ftth_models as fisicos

    if lon is None or lat is None:
        return None
    margen = 0.001  # ~110 m: filtro previo por caja (igual que postes_de_la_geometria)
    postes = (
        db.query(fisicos.FtthElemento)
        .filter(
            fisicos.FtthElemento.proyecto_id == proyecto_id,
            fisicos.FtthElemento.categoria.in_(["poste", "postes"]),
            fisicos.FtthElemento.lat.between(lat - margen, lat + margen),
            fisicos.FtthElemento.lon.between(lon - margen, lon + margen),
        )
        .all()
    )
    mejor, mejor_d = None, None
    for p in postes:
        if p.lat is None or p.lon is None:
            continue
        d = _metros_entre(lon, lat, p.lon, p.lat)
        if d <= tol and (mejor_d is None or d < mejor_d):
            mejor, mejor_d = p.id, d
    return mejor


def _coords_normalizadas(coords):
    """Lista de [lon, lat] válidos (ignora basura) para poder recorrer la geometría."""
    salida = []
    for c in (coords or []):
        par = _coord_guardada(c)
        if par:
            salida.append(par)
    return salida


def postes_de_la_geometria(db, proyecto_id, coords, tol=TOLERANCIA_POSTE_M):
    """
    Postes por los que PASA esa geometría, EN ORDEN de recorrido.

    Se mira cada vértice y se queda el poste más cercano dentro de la tolerancia
    (2 m), sin repetir consecutivos. Es lo que permite deducir `postes_intermedios`
    de los cables trazados antes de que existiera la lista — sin inventar nada y
    sin que el usuario tenga que retrazar.
    """
    import app.models.ftth_models as fisicos

    puntos = _coords_normalizadas(coords)
    if len(puntos) < 2:
        return []

    lons = [p[0] for p in puntos]
    lats = [p[1] for p in puntos]
    margen = 0.001   # ~110 m de margen para el filtro por caja
    postes = (
        db.query(fisicos.FtthElemento)
        .filter(
            fisicos.FtthElemento.proyecto_id == proyecto_id,
            fisicos.FtthElemento.categoria.in_(["poste", "postes"]),
            fisicos.FtthElemento.lat.between(min(lats) - margen, max(lats) + margen),
            fisicos.FtthElemento.lon.between(min(lons) - margen, max(lons) + margen),
        )
        .all()
    )
    if not postes:
        return []

    ruta = []
    for p in puntos:
        mejor, mejor_d = None, None
        for poste in postes:
            if poste.lat is None or poste.lon is None:
                continue
            d = _metros_entre(p[0], p[1], poste.lon, poste.lat)
            if d <= tol and (mejor_d is None or d < mejor_d):
                mejor, mejor_d = poste.id, d
        if mejor is not None and (not ruta or ruta[-1] != mejor):
            ruta.append(mejor)
    return ruta


def mover_vertices_del_poste(coords, lon_antes, lat_antes, lon_nuevo, lat_nuevo,
                             tol=TOLERANCIA_POSTE_M):
    """
    Mueve a la posición nueva TODOS los vértices que estaban en la posición vieja.

    Devuelve (coordenadas_nuevas, cuántos vértices movió). No cambia el número de
    vértices ni el resto de la forma: solo despega el racimo del poste de su
    coordenada anterior (que es lo que dejaba la línea "clavada").
    """
    if lon_antes is None or lat_antes is None or lon_nuevo is None or lat_nuevo is None:
        return None, 0
    nuevas, movidos = [], 0
    for c in _coords_normalizadas(coords):
        if _metros_entre(c[0], c[1], lon_antes, lat_antes) <= tol:
            nuevas.append([lon_nuevo, lat_nuevo])
            movidos += 1
        else:
            nuevas.append(c)
    return (nuevas, movidos) if movidos else (None, 0)


def recalcular_cables_del_poste(db, poste, lon_antes=None, lat_antes=None):
    """
    Rehace la geometría de los cables que PASAN por ese poste.

    Cubre los DOS casos que hay en la base:

    a) Cable con ruta guardada (`trazado_ruta`): se rearma la geometría desde la
       ruta, que lee la lat/lon ACTUAL de cada poste.
    b) Cable ya existente (aunque no tenga `postes_intermedios`, que es el caso de
       los que se trazaron antes de la función): se detecta por su PROPIA
       geometría — los vértices que estaban en la posición VIEJA del poste se mueven
       a la nueva — y además se le deduce `postes_intermedios` para que quede
       explícito de aquí en adelante.

    Devuelve la lista de cables tocados: [{cable_id, vertices, vertices_movidos,
    postes_intermedios, modo}].
    """
    import app.models.ftth_models as fisicos
    from sqlalchemy.orm.attributes import flag_modified

    if poste is None or poste.id is None:
        return []

    objetivo = _to_int(poste.id)
    if not objetivo:
        return []

    candidatos = (
        db.query(fisicos.FtthElemento)
        .filter(
            fisicos.FtthElemento.proyecto_id == poste.proyecto_id,
            fisicos.FtthElemento.id != poste.id,
            fisicos.FtthElemento.categoria.in_(["cables", "ductos", "ducto"]),
        )
        .all()
    )

    tocados = []
    for cable in candidatos:
        coords = cable.coords_json
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        props = dict(cable.propiedades_instancia or {})

        # ¿está el poste en la ruta guardada? (ruta paso a paso o lista de postes)
        ids = props.get("postes_intermedios")
        ids = ids if isinstance(ids, list) else []
        ruta = props.get("trazado_ruta")
        ruta = ruta if isinstance(ruta, list) else []
        en_ruta = objetivo in [_to_int(i) for i in ids]
        if not en_ruta:
            en_ruta = any(isinstance(p, dict) and _to_int(p.get("poste")) == objetivo
                          for p in ruta)

        # La prueba definitiva: vértices del cable EN la posición vieja del poste
        nuevas, movidos = mover_vertices_del_poste(
            coords, lon_antes, lat_antes, poste.lon, poste.lat)
        if not en_ruta and not movidos:
            continue   # este cable no pasa por este poste

        if ruta:
            # (a) Ruta explicita: se rearma completa con los postes EN VIVO
            rearmadas = geometria_desde_trazado(db, props, coords)
            if len(rearmadas) >= 2:
                cable.coords_json = rearmadas
                flag_modified(cable, "coords_json")
            modo = "ruta"
        else:
            # (b) Cable existente: se mueven sus vértices (la forma queda intacta)
            if not movidos:
                # Menciona el poste pero no tiene vértices en su posición anterior
                # (geometría editada a mano o movida por una versión vieja): se avisa
                # y NO se toca nada, para no inventar por dónde iba.
                print(f"[geometria]    cable {cable.id}: menciona el poste {objetivo} pero "
                      f"no tiene vértices en su posición anterior -> no se toca", flush=True)
                continue
            cable.coords_json = nuevas
            flag_modified(cable, "coords_json")
            modo = "vertices"

        # La lista queda explícita a partir de ahora (en orden de recorrido)
        deducidos = postes_de_la_geometria(db, cable.proyecto_id, cable.coords_json)
        if deducidos:
            props["postes_intermedios"] = deducidos
        cable.propiedades_instancia = props
        flag_modified(cable, "propiedades_instancia")

        tocados.append({
            "cable_id": cable.id,
            "vertices": len(_coords_normalizadas(cable.coords_json)),
            "vertices_movidos": movidos,
            "postes_intermedios": props.get("postes_intermedios"),
            "modo": modo,
            # Geometría NUEVA lista para pintar: el navegador la usa para repintar la
            # línea al instante con la misma respuesta, sin depender de otra petición.
            "coords": _coords_normalizadas(cable.coords_json),
        })
    return tocados


# ── Alta de un elemento (misma lógica que el POST /api/elementos/) ────────────


def crear_elemento_en_db(
    db,
    *,
    proyecto_id,
    tipo_id,
    categoria,
    lat=None,
    lon=None,
    coords_json=None,
    poste_ref_id=None,
    propiedades_instancia=None,
    commit=True,
):
    """
    Crea un elemento con LA MISMA lógica que el endpoint `POST /api/elementos/`:
    número visible correlativo, geometría armada desde la ruta (postes EN VIVO),
    `postes_intermedios` deducidos de la geometría si faltan y —si es un cable—
    materialización de sus hilos con los extremos A y B ya anclados.

    Existe para que la DIVISIÓN de un cable cree sus dos cables por este mismo
    camino y no por una copia que se desincronice con el endpoint.

    Devuelve el `FtthElemento` creado. Con `commit=False` NO confirma la
    transacción (lo hace quien llama), para poder crear varias filas de golpe.
    """
    import app.models.ftth_models as fisicos

    instancia = dict(propiedades_instancia or {})
    if not _to_int(instancia.get("numero")):
        instancia["numero"] = siguiente_numero(db, proyecto_id, categoria)

    # Si el trazado pasó por postes, la geometría se arma con su posición ACTUAL
    # (así la línea sigue al poste cuando se mueve). Un trazado libre se deja igual.
    coords = coords_json
    calculadas = geometria_desde_trazado(db, instancia, coords)
    if calculadas and len(calculadas) >= 2:
        coords = calculadas

    # Si el trazado no anotó los postes, se DEDUCEN de la geometría (≤2 m).
    if not instancia.get("postes_intermedios"):
        deducidos = postes_de_la_geometria(db, proyecto_id, coords)
        if deducidos:
            instancia["postes_intermedios"] = deducidos

    # Una CAJA (o cualquier punto que cuelga de un poste) colocada CERCA de un poste
    # se ANCLA a él automáticamente, aunque el clic no viniera del menú «Agregar … a
    # este poste». Sin esto, «meter el cable al diagrama» no ofrecía nada: la
    # detección (`cables_divisibles`) depende de `poste_ref_id`.
    poste_ref_id = _to_int(poste_ref_id)
    if not poste_ref_id and lat is not None and lon is not None \
            and (categoria or "").lower() not in ("poste", "postes", "ducto", "ductos", "cables"):
        poste_ref_id = poste_mas_cercano(db, proyecto_id, lon, lat)

    nuevo = fisicos.FtthElemento(
        proyecto_id=proyecto_id,
        tipo_id=tipo_id,
        categoria=categoria,
        lat=lat,
        lon=lon,
        coords_json=coords,
        poste_ref_id=poste_ref_id,
        extremo_A_id=instancia.get("extremo_A_id"),
        extremo_B_id=instancia.get("extremo_B_id"),
        reserva_A_m=instancia.get("reserva_A_m", 0),
        reserva_B_m=instancia.get("reserva_B_m", 0),
        propiedades_instancia=instancia,
    )
    db.add(nuevo)
    db.flush()          # deja el id disponible para materializar sus hilos

    if (categoria or "").lower() == "cables":
        from app.routers import ftth_logica as logica_router
        logica_router.auto_materializar_cable(nuevo, db, commit=False)

    print(f"[linea] {categoria} #{instancia.get('numero')} (id {nuevo.id}) guardado: "
          f"vertices={len(coords or [])} "
          f"postes_intermedios={instancia.get('postes_intermedios')} "
          f"trazado_ruta={'si' if instancia.get('trazado_ruta') else 'no'}", flush=True)

    if commit:
        db.commit()
        db.refresh(nuevo)
    return nuevo


# ── Limpieza de hijos al borrar un elemento o un proyecto ─────────────────────
# SQLite NO aplica los `ON DELETE CASCADE` que declaran los modelos si no se
# activa `PRAGMA foreign_keys=ON` (este proyecto no lo activa). Al borrar un
# elemento sus tubos/hilos/extremos/puertos quedaban HUÉRFANOS y, como los ids se
# reutilizan (SQLite asigna `max(id)+1`), un elemento NUEVO heredaba los del
# borrado: un cable drop aparecía con capacidad 12 y 12 hilos de un cable viejo
# (fue lo que hizo fallar `prueba_cable_estructura.py`). Se limpian explícitamente.

# Filas que cuelgan de un ELEMENTO (se borran antes que él).
_HIJOS_POR_ELEMENTO = (
    # Los empalmes van PRIMERO: referencian hilos (de este u otro cable) y bandejas,
    # así que deben desaparecer antes de borrar esos hilos/bandejas.
    ("ftth_empalmes", "nodo_id = :k"),
    ("ftth_empalmes",
     "fibra_a_id IN (SELECT id FROM ftth_cable_fibras WHERE elemento_id = :k)"),
    ("ftth_empalmes",
     "fibra_b_id IN (SELECT id FROM ftth_cable_fibras WHERE elemento_id = :k)"),
    ("ftth_fibra_extremos",
     "fibra_id IN (SELECT id FROM ftth_cable_fibras WHERE elemento_id = :k)"),
    ("ftth_cable_fibras", "elemento_id = :k"),
    ("ftth_puertos", "elemento_id = :k"),
    ("ftth_dispositivos", "elemento_id = :k"),
    ("ftth_bandejas", "elemento_id = :k"),
    ("ftth_diagrama_posiciones", "elemento_id = :k"),
    ("ftth_carpeta_elementos", "elemento_id = :k"),
    ("carpeta_elementos", "elemento_id = :k"),
    ("ftth_cable_tubos", "elemento_id = :k"),
)

# Tablas con `proyecto_id` que se borran al borrar un proyecto.
_HIJOS_POR_PROYECTO = (
    "ftth_empalmes",
    "ftth_fibra_extremos",
    "ftth_cable_fibras",
    "ftth_cable_tubos",
    "ftth_puertos",
    "ftth_dispositivos",
    "ftth_bandejas",
    "ftth_diagrama_posiciones",
    "ftth_carpetas",
    "ftth_secuencias",
)

# Tablas de enlace sin `proyecto_id`: se borran por el elemento.
_ENLACES_POR_ELEMENTO = ("ftth_carpeta_elementos", "carpeta_elementos")


def _ejecutar(db, sql, **params):
    """DELETE guardado: si la tabla/columna no existe, avisa y sigue (no rompe)."""
    try:
        db.execute(text(sql), params)
        return True
    except Exception as e:  # pragma: no cover - defensivo
        print(f"[limpieza] aviso al ejecutar {sql[:60]}...: {e}", flush=True)
        return False


def borrar_hijos_del_elemento(db, elemento_id):
    """Borra las filas que cuelgan de un elemento (tubos, hilos, extremos, puertos...)."""
    n = 0
    for tabla, condicion in _HIJOS_POR_ELEMENTO:
        try:
            filas = db.execute(
                text(f"DELETE FROM {tabla} WHERE {condicion}"), {"k": int(elemento_id)}
            ).rowcount or 0
            n += filas
        except Exception as e:  # pragma: no cover - defensivo
            print(f"[limpieza] no se pudo limpiar {tabla}: {e}", flush=True)
    # Un poste borrado no debe dejar referencias colgando
    try:
        db.execute(
            text("UPDATE ftth_elementos SET poste_ref_id = NULL WHERE poste_ref_id = :k"),
            {"k": int(elemento_id)},
        )
        db.execute(
            text("UPDATE ftth_fibra_extremos SET nodo_id = NULL WHERE nodo_id = :k"),
            {"k": int(elemento_id)},
        )
        # Un CABLE apunta a sus dos nodos por estas columnas. Si el nodo desaparece y
        # no se limpian, el cable queda apuntando a un id inexistente y DESAPARECE de
        # todos los diagramas (la consulta es `extremo_A_id == nodo`), además de dejar
        # sus hilos sin nodo. Se limpia igual que el poste de referencia.
        db.execute(
            text("UPDATE ftth_elementos SET extremo_A_id = NULL WHERE extremo_A_id = :k"),
            {"k": int(elemento_id)},
        )
        db.execute(
            text("UPDATE ftth_elementos SET extremo_B_id = NULL WHERE extremo_B_id = :k"),
            {"k": int(elemento_id)},
        )
    except Exception as e:  # pragma: no cover - defensivo
        print(f"[limpieza] no se pudieron desanclar referencias: {e}", flush=True)
    return n


def borrar_datos_del_proyecto(db, proyecto_id):
    """Borra todo el contenido FTTH de un proyecto (elementos, tipos y carpetas incluidos).

    Sin esto, `DELETE /api/projects/{id}` borraba solo la fila del proyecto y dejaba
    sus elementos y todo su contenido (los `ondelete=CASCADE` declarados no se aplican
    en SQLite sin `PRAGMA foreign_keys=ON`).
    """
    k = int(proyecto_id)
    for tabla in _HIJOS_POR_PROYECTO:
        _ejecutar(db, f"DELETE FROM {tabla} WHERE proyecto_id = :k", k=k)
    for tabla in _ENLACES_POR_ELEMENTO:
        _ejecutar(db, f"DELETE FROM {tabla} WHERE elemento_id IN "
                      f"(SELECT id FROM ftth_elementos WHERE proyecto_id = :k)", k=k)
    for tabla in ("ftth_elementos", "ftth_tipos"):
        _ejecutar(db, f"DELETE FROM {tabla} WHERE proyecto_id = :k", k=k)


class FtthCableTubo(Base):
    """Tubo holgado (loose tube) dentro de un cable."""

    __tablename__ = "ftth_cable_tubos"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tubo_no = Column(Integer, nullable=False)              # 1..n
    color = Column(String(20), nullable=True)              # nombre TIA-598
    color_hex = Column(String(9), nullable=True)           # hex para la UI
    capacidad_fibras = Column(Integer, nullable=True, default=12)
    etiqueta = Column(String(100), nullable=True)

    __table_args__ = (
        UniqueConstraint("elemento_id", "tubo_no", name="uq_ftth_cable_tubo_no"),
    )


class FtthCableFibra(Base):
    """Hilo (fibra individual) dentro de un tubo de un cable."""

    __tablename__ = "ftth_cable_fibras"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tubo_id = Column(
        Integer, ForeignKey("ftth_cable_tubos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    hilo_no_en_tubo = Column(Integer, nullable=False)      # 1..fibras por loose
    hilo_global_no = Column(Integer, nullable=False)       # 1..total de hilos del cable
    color = Column(String(20), nullable=True)              # nombre TIA-598
    color_hex = Column(String(9), nullable=True)
    estado = Column(String(20), nullable=False, default="libre", index=True)
    perfil = Column(String(30), nullable=True)             # G.652D, G.657A2...

    __table_args__ = (
        UniqueConstraint("tubo_id", "hilo_no_en_tubo", name="uq_ftth_fibra_en_tubo"),
        UniqueConstraint("elemento_id", "hilo_global_no", name="uq_ftth_fibra_global"),
        Index("ix_ftth_fibra_proyecto_estado", "proyecto_id", "estado"),
    )


class FtthFibraExtremo(Base):
    """
    Extremo (A / B) de un hilo: dónde termina físicamente.

    Los extremos son los puntos donde vive la conectividad (empalmes y conexiones
    de fases posteriores). Es el ancla que permite recorrer el camino lógico
    sin depender de la geometría.

    Nota: `tramo_id` y `bandeja_id` se incorporarán (ALTER TABLE ADD COLUMN, aditivo)
    cuando existan las tablas `ftth_cable_tramos` (F2.5) y `ftth_bandejas` (F3).
    """

    __tablename__ = "ftth_fibra_extremos"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fibra_id = Column(
        Integer, ForeignKey("ftth_cable_fibras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    extremo = Column(String(1), nullable=False)            # 'A' o 'B'
    nodo_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="SET NULL"), nullable=True, index=True
    )
    holgura_m = Column(Float, nullable=True)

    __table_args__ = (
        UniqueConstraint("fibra_id", "extremo", name="uq_ftth_fibra_extremo"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# F3 — Interior del nodo: bandejas, dispositivos y puertos
# ─────────────────────────────────────────────────────────────────────────────

class FtthBandeja(Base):
    """Bandeja de empalme dentro de un nodo (caja, manga, ODF, armario)."""

    __tablename__ = "ftth_bandejas"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bandeja_no = Column(Integer, nullable=False)
    tipo = Column(String(20), nullable=False, default="empalme")   # empalme|paso|splitter|mixta
    slots = Column(Integer, nullable=True, default=12)
    etiqueta = Column(String(100), nullable=True)

    __table_args__ = (
        UniqueConstraint("elemento_id", "bandeja_no", name="uq_ftth_bandeja_no"),
    )


class FtthDispositivo(Base):
    """
    Aparato instalado dentro de un nodo: splitter, adaptador, WDM, pigtail, switch.

    `tipo_id` reutiliza el catálogo de plantillas existente (ftth_tipos) para no
    duplicar la definición del splitter (relacion_division, entradas, salidas).
    """

    __tablename__ = "ftth_dispositivos"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bandeja_id = Column(
        Integer, ForeignKey("ftth_bandejas.id", ondelete="SET NULL"), nullable=True
    )
    tipo_id = Column(
        Integer, ForeignKey("ftth_tipos.id", ondelete="SET NULL"), nullable=True
    )
    tipo = Column(String(30), nullable=False, default="splitter")
    serie = Column(String(100), nullable=True)
    division = Column(String(20), nullable=True)        # 1x8, 1x16, 2x16...
    puertos_in = Column(Integer, nullable=True, default=1)
    puertos_out = Column(Integer, nullable=True, default=1)
    atenuacion_db = Column(Float, nullable=True)
    estado = Column(String(20), nullable=False, default="operativo")


class FtthPuerto(Base):
    """Puerto direccionable de un dispositivo (IN / OUT / BIDI)."""

    __tablename__ = "ftth_puertos"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    dispositivo_id = Column(
        Integer, ForeignKey("ftth_dispositivos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Denormalizado: permite listar los puertos de una caja sin joins
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    direccion = Column(String(4), nullable=False)       # IN | OUT | BIDI
    puerto_no = Column(Integer, nullable=False)
    tipo_conector = Column(String(20), nullable=True)   # SC/APC, SC/UPC, LC/APC...
    estado = Column(String(20), nullable=False, default="libre")
    etiqueta = Column(String(100), nullable=True)

    __table_args__ = (
        UniqueConstraint("dispositivo_id", "direccion", "puerto_no", name="uq_ftth_puerto"),
        Index("ix_ftth_puerto_elemento_estado", "elemento_id", "estado"),
    )


class FtthEmpalme(Base):
    """
    Fusión (empalme) entre dos hilos dentro de un nodo — fase F4.

    El diagrama dibuja la continuidad de la fibra: los hilos que se empalman en
    una caja se unen aquí (hilo A ↔ hilo B) y ocupan una posición de una bandeja
    (`slot`). `tipo` distingue el modo de la operación que lo creó:

      · 'paso'     → el cable CONTINÚA: el hilo que llega se fusiona con el que
                     sigue (corte de paso, todas las fibras).
      · 'sangrado' → la fibra se PICÓ para derivarla: queda ABIERTA (sin hilo B)
                     y marcada, disponible para derivar aguas abajo.

    `fibra_a_id` es la mitad que LLEGA (entrada) y `fibra_b_id` la que SALE
    (salida); cuál es cuál lo decide el usuario al marcar el lado.
    """

    __tablename__ = "ftth_empalmes"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nodo_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    bandeja_id = Column(
        Integer, ForeignKey("ftth_bandejas.id", ondelete="SET NULL"), nullable=True, index=True
    )
    slot = Column(Integer, nullable=True)
    fibra_a_id = Column(
        Integer, ForeignKey("ftth_cable_fibras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fibra_b_id = Column(
        Integer, ForeignKey("ftth_cable_fibras.id", ondelete="CASCADE"), nullable=True, index=True
    )
    puerto_id = Column(
        Integer, ForeignKey("ftth_puertos.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tipo = Column(String(20), nullable=False, default="paso")   # paso | sangrado | conector
    extremo_a = Column(String(10), nullable=False, default="entrada")  # entrada | salida
    extremo_b = Column(String(10), nullable=False, default="salida")   # entrada | salida
    etiqueta = Column(String(100), nullable=True)
    propiedades = Column(JSON, nullable=True, default={})

    __table_args__ = (
        UniqueConstraint("nodo_id", "fibra_a_id", name="uq_ftth_empalme_hilo_a"),
    )


class FtthDiagramaPosicion(Base):
    """
    Posición de un aparato DENTRO del lienzo del diagrama de su nodo.

    Es solo orden visual: el usuario arrastra los splitters para acomodarlos y,
    al pulsar el disquete, el diagrama se guarda y vuelve a abrirse igual.

    `x` e `y` son píxeles del lienzo (no latitud/longitud): se guardan en el
    sistema de coordenadas de las columnas del diagrama, tal como lo pinta
    `frontend/js/ftth-diagrama.js`. Por eso esta tabla no es geometría del mapa
    y la capa física sigue intacta (docs/DISENO_CAPA_LOGICA.md §12).

    Una fila por aparato (`unique(dispositivo_id)`): sin fila, el diagrama usa
    su rejilla automática y no se escribe nada.
    """

    __tablename__ = "ftth_diagrama_posiciones"

    id = Column(Integer, primary_key=True, index=True)
    proyecto_id = Column(
        Integer, ForeignKey("map_projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    elemento_id = Column(
        Integer, ForeignKey("ftth_elementos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    dispositivo_id = Column(
        Integer,
        ForeignKey("ftth_dispositivos.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    x = Column(Float, nullable=False, default=0.0)
    y = Column(Float, nullable=False, default=0.0)

