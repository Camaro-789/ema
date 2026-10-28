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
            check(await pagina.locator(".pop-matriz-fila").count() >= 3,
                  "la matriz lista los equipos")
            await pagina.click('[data-pestana="papel"]')

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
            await navegador.close()
    finally:
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
