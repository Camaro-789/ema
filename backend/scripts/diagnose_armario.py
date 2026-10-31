import sqlite3
import json

# Let's inspect everything about element 84 (Armario OLT HUB #6)
con = sqlite3.connect('backend/tachira_maps.db')
cur = con.cursor()

cur.execute("SELECT id, tipo_id, categoria, lat, lon, propiedades_instancia FROM ftth_elementos WHERE id = 84")
print("Elemento 84:", cur.fetchone())

cur.execute("SELECT id, elemento_id, tipo, serie, division, puertos_out, estado FROM ftth_dispositivos WHERE elemento_id = 84")
print("Dispositivos en 84:", cur.fetchall())

cur.execute("SELECT id, elemento_id, dispositivo_id, puerto_no, etiqueta, estado FROM ftth_puertos WHERE elemento_id = 84")
print("Puertos en 84:", cur.fetchall())

cur.execute("SELECT id, nodo_id, fibra_a_id, fibra_b_id, puerto_id, tipo, propiedades FROM ftth_empalmes WHERE nodo_id = 84")
print("Empalmes en 84:", cur.fetchall())

cur.execute("SELECT id, elemento_id, fibra_no, color, estado FROM ftth_cable_fibras WHERE elemento_id = 85")
print("Fibras de Cable 85:", cur.fetchall())
