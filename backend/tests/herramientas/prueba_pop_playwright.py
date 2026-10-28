"""
prueba_pop_playwright.py — Prueba de interfaz del módulo nativo (Fase 4.3).

Levanta la app con la base SINTÉTICA, abre Map OLT con el Edge del sistema y
comprueba: carga del módulo ES, apertura del POP, rack/papel/matriz, cable de 96
hilos sin congelar (mide el tiempo), conexión inválida rechazada en español y
persistencia al recargar.

Uso (desde backend/):
    python tests/herramientas/prueba_pop_playwright.py
"""
import asyncio
import os
import socket
import subprocess
import sys
import time
import uuid

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SINTETICA = os.path.join(BASE, "tests", "tachira_maps_test.db")
R = {"ok": 0, "fallos": [], "datos": {}}


def check(condicion, mensaje, detalle=""):
    if condicion:
        R["ok"] += 1
        print(f"  [OK]    {mensaje}")
    else:
        R["fallos"].append(mensaje)
        print(f"  [FALLO] {mensaje}")
        if detalle:
            print(f"          {str(detalle)[:300]}")


def puerto_libre() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def arrancar(puerto: int):
    entorno = dict(os.environ)
    entorno["DATABASE_URL"] = f"sqlite:///{SINTETICA}"
    entorno["PYTHONIOENCODING"] = "utf-8"
    proceso = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
         "--port", str(puerto), "--log-level", "warning"],
        cwd=BASE, env=entorno, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    import httpx
    for _ in range(60):
        try:
            if httpx.get(f"http://127.0.0.1:{puerto}/api/health", timeout=1).status_code == 200:
                return proceso
        except Exception:
            time.sleep(0.5)
    proceso.kill()
    raise RuntimeError("la app no arrancó")


async def main() -> int:
    if not os.path.exists(SINTETICA):
        print("ABORTADO: falta la base sintética (scripts/crear_base_prueba.py).")
        return 2
    puerto = puerto_libre()
    proceso = arrancar(puerto)
    url = f"http://127.0.0.1:{puerto}/"
    print(f"app en {url} (base sintética)")
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as playwright:
            navegador = await playwright.chromium.launch(channel="msedge")
            pagina = await navegador.new_page()
            errores = []
            pagina.on("console", lambda m: errores.append(m.text) if m.type == "error" else None)
            await pagina.goto(url, wait_until="load", timeout=60000)
            await pagina.wait_for_function("() => !!window.POPNativo", timeout=30000)

            check(await pagina.evaluate("() => typeof window.POPNativo.abrir === 'function'"),
                  "el módulo ES carga y expone POPNativo.abrir")

            armario = await pagina.evaluate(
                "async () => (await (await fetch('/api/elementos/todos?proyecto_id=1')).json())"
                ".features.find(f => f.properties.categoria === 'armario').properties.id")
            check(bool(armario), "hay un armario en la base sintética", armario)

            inicio = time.perf_counter()
            await pagina.evaluate(f"() => window.POPNativo.abrir({armario})")
            await pagina.wait_for_selector(".pop-tarjeta", timeout=15000)
            ms = (time.perf_counter() - inicio) * 1000
            R["datos"]["render_ms"] = round(ms, 1)
            check(ms < 3000, f"abre con el cable de 96 hilos en {ms:.0f} ms (< 3000)")
            check(await pagina.locator(".pop-tab").count() == 3,
                  "hay 3 pestañas (RACK · PAPEL · MATRIZ)")
            tarjetas = await pagina.locator(".pop-tarjeta").count()
            check(tarjetas >= 3, f"dibuja las tarjetas de equipo ({tarjetas})")
            hilos = await pagina.locator(".pop-hilo-punto").count()
            check(hilos >= 6, f"dibuja puntos de hilo del cable ({hilos})")

            await pagina.click('[data-pestana="rack"]')
            check(await pagina.locator(".pop-rack-fila").count() >= 3, "el rack lista los equipos")
            await pagina.click('[data-pestana="matriz"]')
            check(await pagina.locator(".pop-eq-card").count() >= 3,
                  "la matriz lista los equipos")
            await pagina.click('[data-pestana="papel"]')

            # Paso 2: tres zonas (CABLES | RACK·PAPEL·MATRIZ | TRAZABILIDAD)
            check(await pagina.locator(".pop-panel--izq").count() == 1,
                  "panel izquierdo de CABLES")
            check(await pagina.locator(".pop-panel--der").count() == 1,
                  "panel derecho de TRAZABILIDAD")
            check(await pagina.locator('[data-accion="nuevo-cable"]').count() == 1,
                  "botón «+ CABLE» en el panel izquierdo")
            check(await pagina.locator(".pop-panel-cable").count() >= 1,
                  "el panel izquierdo lista el cable anclado")
            rutas = await pagina.locator(".pop-ruta").count()
            if rutas:
                await pagina.locator('.pop-ruta [data-ruta]').first.click()
                await pagina.wait_for_selector(".pop-linterna-pulso", state="attached",
                                               timeout=5000)
                check(await pagina.locator(".pop-linterna-pulso").count() > 0,
                      "ENCENDER pinta el pulso de luz")
                check(await pagina.locator(".pop-torch:not(.is-oculto)").count() == 1,
                      "aparece la ventana de rutas copiada del HTML")
            else:
                check(False, "había al menos una ruta para encender")

            # Paso 3: «+ EQUIPO» leyendo el catálogo real y reflejándose en las 3 vistas
            antes = await pagina.locator(".pop-tarjeta").count()
            await pagina.click('[data-accion="nuevo-equipo"]')
            await pagina.wait_for_selector(".pop-dialogo [data-tipo]", timeout=8000)
            tipos = await pagina.evaluate("""() => Array.from(
                document.querySelectorAll('.pop-dialogo [data-tipo] option'))
                .map(o => ({ valor: o.value, categoria: o.dataset.categoria,
                             division: o.dataset.division }))""")
            check(len(tipos) >= 3, f"el diálogo trae los tipos del catálogo ({len(tipos)})")
            splitter = next((t for t in tipos if t["categoria"] == "splitter"), None)
            check(bool(splitter), "hay al menos un splitter en el catálogo")
            if splitter:
                nombre_nuevo = f"PYTEST-EQUIPO-{uuid.uuid4().hex[:6].upper()}"
                await pagina.select_option('.pop-dialogo [data-tipo]', value=str(splitter["valor"]))
                await pagina.fill('.pop-dialogo [data-nombre]', nombre_nuevo)
                await pagina.click('.pop-dialogo [data-crear]')
                await pagina.wait_for_timeout(2500)
                avisos = await pagina.locator(".pop-aviso--error").all_inner_texts()
                check(not avisos, f"el alta del equipo no genera errores {avisos}", avisos)
                await pagina.click('[data-pestana="papel"]')
                texto_papel = await pagina.locator(".pop-vista").inner_text()
                tarjetas_ahora = await pagina.locator(".pop-tarjeta").count()
                # HALLAZGO (paso 6): el PAPEL no dibuja un equipo recién creado si
                # aún no tiene `posicion`; el rack y la matriz sí lo muestran.
                check(nombre_nuevo in texto_papel or tarjetas_ahora > antes,
                      f"el equipo creado entra en el papel ({antes} → {tarjetas_ahora})")
                await pagina.click('[data-pestana="rack"]')
                check(await pagina.locator(".pop-rack-fila").count() > 3,
                      "y también en el rack")
                await pagina.click('[data-pestana="matriz"]')
                check("PYTEST-EQUIPO" in (await pagina.locator(".pop-matriz").inner_text()),
                      "y en la matriz")

            # Paso 4: matriz con banner por equipo, chips con contenedor, colapsable y mover
            await pagina.click('[data-pestana="matriz"]')
            check(await pagina.locator(".pop-eq-card").count() >= 3,
                  "matriz: una tarjeta por equipo")
            for icono, nombre in (("data-editar", "✎"), ("data-mover", "⇄"),
                                  ("data-eliminar", "✕")):
                check(await pagina.locator(f".pop-eq-banner [{icono}]").count() >= 3,
                      f"matriz: {nombre} en el banner del equipo")
            chips = await pagina.locator(".pop-chip").count()
            check(chips >= 1, f"matriz: chips de hilo conectado ({chips})")
            if chips:
                texto_chip = await pagina.locator(".pop-chip").first.inner_text()
                check("➔" in texto_chip, "el chip usa «origen ➔ destino»", texto_chip)
            await pagina.locator("[data-colapsar]").first.click()
            check(await pagina.locator(".pop-eq-cuerpo[hidden]").count() >= 1,
                  "matriz: la tarjeta se colapsa")
            await pagina.locator("[data-mover]").first.click()
            await pagina.wait_for_selector(".pop-dialogo [data-destino]", timeout=5000)
            check(await pagina.locator(".pop-dialogo [data-destino] option").count() >= 1,
                  "matriz: el diálogo de mover lista el gabinete destino")
            await pagina.locator('.pop-dialogo [data-cancelar]').click()
            await pagina.click('[data-pestana="papel"]')

            # Paso 5: origen/TX, dBm por ruta y sentido L/R de la linterna
            check(await pagina.locator(".pop-origen select[data-origen]").count() == 1,
                  "panel de ORIGEN con selector de puerto/hilo")
            check(await pagina.locator(".pop-origen input[data-tx]").count() == 1,
                  "TX editable en dBm")
            dbm_total = await pagina.locator(".pop-ruta-dbm").count()
            chip = ""
            check(dbm_total >= 1, f"dBm teóricos en cada ruta ({dbm_total})")
            if dbm_total:
                chip = (await pagina.locator(".pop-ruta-dbm").first.inner_text()).strip()
                check(chip.endswith("dBm"), "el chip de potencia muestra la unidad", chip)
            tx_antes = await pagina.locator(".pop-origen input[data-tx]").input_value()
            await pagina.locator(".pop-origen input[data-tx]").fill("7.5")
            await pagina.locator(".pop-origen input[data-tx]").dispatch_event("change")
            chip_tx = (await pagina.locator(".pop-ruta-dbm").first.inner_text()).strip()
            check(chip_tx != chip, "subir el TX sube los dBm de la ruta", f"{chip} -> {chip_tx}")
            await pagina.locator(".pop-origen input[data-tx]").fill(tx_antes)
            await pagina.locator(".pop-origen input[data-tx]").dispatch_event("change")

            if await pagina.locator("#popTorchWin:not(.is-oculto)").count() == 0:
                await pagina.locator("[data-ruta]").first.click()
            await pagina.wait_for_selector("#popTorchWin .tw-dir [data-sentido='R']",
                                           state="attached", timeout=5000)
            check(await pagina.locator("#popTorchWin .tw-dir button.is-on").count() == 1,
                  "la ventana de luz trae los botones L y R")
            await pagina.locator("#popTorchWin .tw-dir [data-sentido='L']").dispatch_event("click")
            await pagina.wait_for_timeout(200)
            invertida = await pagina.locator("#popTorchWin .dirbadge").inner_text()
            check("◀" in invertida or "FINAL → ORIGEN" in invertida,
                  "L invierte el sentido del pulso", invertida)
            await pagina.locator("#popTorchWin [data-accion='detener']").click()


            # Conexión inválida: el servidor la rechaza y la UI muestra SU mensaje.
            await pagina.evaluate("""() => {
              window.__fetchOriginal = window.fetch;
              window.fetch = async (url, opciones) => {
                if (String(url).includes('/conexiones')) {
                  return new Response(JSON.stringify({ codigo: 'rj45_solo_rj45',
                    mensaje_es: 'Un puerto RJ45 (cobre) solo se conecta con otro RJ45.' }),
                    { status: 422, headers: { 'Content-Type': 'application/json' } });
                }
                return window.__fetchOriginal(url, opciones);
              };
            }""")
            await pagina.evaluate(f"""async () => {{
              const dto = await (await fetch('/api/contenedores/{armario}/diagrama')).json();
              const olt = dto.dispositivos.find(d => d.tipo === 'olt');
              const puerto = dto.puertos.find(p => p.dispositivo_id === olt.id);
              document.querySelector(
                `.pop-puerto[data-eq="${{olt.id}}"][data-puerto="${{puerto.etiqueta}}"]`)
                .dispatchEvent(new MouseEvent('click', {{ bubbles: true }}));
              document.querySelector('.pop-hilo-punto')
                .dispatchEvent(new MouseEvent('click', {{ bubbles: true }}));
            }}""")
            await pagina.wait_for_selector(".pop-aviso--error", timeout=8000)
            texto = await pagina.locator(".pop-aviso--error").first.inner_text()
            check("RJ45" in texto, "la conexión inválida muestra el mensaje del servidor", texto)

            await pagina.reload(wait_until="load")
            await pagina.wait_for_function("() => !!window.POPNativo", timeout=30000)
            await pagina.evaluate(f"() => window.POPNativo.abrir({armario})")
            await pagina.wait_for_selector(".pop-tarjeta", timeout=15000)
            check(await pagina.locator(".pop-tarjeta").count() >= 3,
                  "tras recargar, el diagrama sigue viniendo del servidor")
            check(not [e for e in errores if "pop/" in e], "sin errores de módulos en consola",
                  errores[:3])

            # Fase 5.1: el armario abre el módulo NATIVO (no el iframe del puente)
            await pagina.evaluate("() => window.POPNativo.cerrar()")
            await pagina.evaluate(
                f"() => window.FTTHPopPapel.abrir({armario}, {{ categoria: 'armario' }})")
            await pagina.wait_for_selector(".pop-modal:not(.is-oculto) .pop-tarjeta", timeout=15000)
            check(await pagina.locator("iframe.pop-paper-v25-frame").count() == 0,
                  "el armario abre el módulo nativo (sin iframe del puente)")
            check(await pagina.locator(".pop-modal .pop-tab").count() == 3,
                  "el armario muestra RACK · PAPEL · MATRIZ")
            # Paso 6 · P-010: capturas lado a lado para docs/paridad/
            carpeta = os.path.join(BASE, "docs", "paridad")
            os.makedirs(carpeta, exist_ok=True)
            tamanos = {}
            for nombre_pestana, archivo in (("papel", "nativo-papel.png"),
                                            ("rack", "nativo-rack.png"),
                                            ("matriz", "nativo-matriz.png")):
                await pagina.click(f'[data-pestana="{nombre_pestana}"]')
                await pagina.wait_for_timeout(300)
                ruta = os.path.join(carpeta, archivo)
                await pagina.locator(".pop-modal .pop-caja").screenshot(path=ruta)
                tamanos[archivo] = os.path.getsize(ruta)
            check(all(t > 10000 for t in tamanos.values()),
                  f"capturas del módulo nativo en docs/paridad ({tamanos})")

            # Referencia: el HTML v25 abierto tal cual (solo lectura, no se modifica).
            from pathlib import Path
            referencia = await navegador.new_page(viewport={"width": 1500, "height": 900})
            await referencia.goto(Path(BASE).parent.joinpath(
                "frontend", "pop_gestor_v25.html").as_uri())
            await referencia.wait_for_timeout(1500)
            ruta_ref = os.path.join(carpeta, "referencia-html.png")
            await referencia.screenshot(path=ruta_ref)
            check(os.path.getsize(ruta_ref) > 10000,
                  f"captura de la plantilla de referencia ({os.path.getsize(ruta_ref)} bytes)")
            await referencia.close()

            await navegador.close()
    finally:
        try:
            for mensaje in errores[-6:]:
                print(f"  [consola] {str(mensaje)[:400]}")
        except Exception:
            pass
        proceso.terminate()
        try:
            proceso.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proceso.kill()

    print(f"\nrender: {R['datos'].get('render_ms')} ms")
    print(f"RESULTADO: {R['ok']} comprobaciones OK, {len(R['fallos'])} fallos")
    for fallo in R["fallos"]:
        print(f"   - {fallo}")
    return 0 if not R["fallos"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
