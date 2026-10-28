"""Errores de negocio del dominio.

`ErrorDominio` es lo único que los servicios lanzan: el router lo traduce a
HTTP con el formato `{codigo, mensaje_es, detalle}` (Fase 2.7). El dominio no
importa FastAPI: aquí no hay `HTTPException`.
"""


class ErrorDominio(Exception):
    """Error de negocio con su código, mensaje en español y status sugerido."""

    def __init__(self, codigo: str, mensaje_es: str, detalle=None, status: int = 400):
        super().__init__(mensaje_es)
        self.codigo = codigo
        self.mensaje_es = mensaje_es
        self.detalle = detalle
        self.status = status

    def a_dict(self) -> dict:
        return {"codigo": self.codigo, "mensaje_es": self.mensaje_es, "detalle": self.detalle}

    def __str__(self) -> str:
        return f"[{self.codigo}] {self.mensaje_es}"


class ErrorNoEncontrado(ErrorDominio):
    def __init__(self, mensaje_es: str, detalle=None):
        super().__init__("no_encontrado", mensaje_es, detalle, status=404)


class ErrorConflicto(ErrorDominio):
    def __init__(self, mensaje_es: str, detalle=None):
        super().__init__("conflicto", mensaje_es, detalle, status=409)


class ErrorRegla(ErrorDominio):
    def __init__(self, mensaje_es: str, detalle=None, codigo: str = "regla_no_cumplida"):
        super().__init__(codigo, mensaje_es, detalle, status=422)
