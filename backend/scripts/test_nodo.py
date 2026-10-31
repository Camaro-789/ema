import urllib.request
import json

url = 'http://127.0.0.1:8000/api/elementos/84/nodo'
try:
    with urllib.request.urlopen(url) as res:
        data = json.loads(res.read().decode('utf-8'))
        print("Dispositivos:", len(data.get("dispositivos", [])))
        for d in data.get("dispositivos", []):
            print(" -", d)
        print("Puertos:", len(data.get("puertos", [])))
        print("Hilos:", len(data.get("hilos", [])))
        print("Empalmes:", len(data.get("empalmes", [])))
        print("Cables divisibles:", len(data.get("cables_divisibles", [])))
except Exception as e:
    print("Error:", e)
