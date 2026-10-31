import urllib.request
import json

# Let's test calling POST /api/elementos/84/conexiones-sincronizar
payload = {
    "conexiones": [
        {
            "from": {"mapoltPortId": 143},
            "to": {"mapoltPortId": 151},
            "fromType": "OLT",
            "toType": "ODF",
            "fromFace": None,
            "toFace": "A",
            "origin": True
        },
        {
            "from": {"mapoltPortId": 151},
            "to": {"mapoltFibraId": 101, "mapoltExtremo": "A"},
            "fromType": "ODF",
            "toType": "CABLE",
            "fromFace": "B",
            "toFace": None,
            "origin": False
        }
    ]
}

req = urllib.request.Request(
    "http://127.0.0.1:8000/api/elementos/84/conexiones-sincronizar",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req) as res:
        print("Response status:", res.status)
        print("Response body:", res.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    print("HTTPError:", e.code, e.read().decode("utf-8"))
except Exception as e:
    print("Exception:", e)
