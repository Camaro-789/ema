/**
 * linterna.js — Pulso de luz del ORIGEN al FINAL de la traza (Fase 4).
 *
 * · Un único pulso (nunca de ida y vuelta).
 * · Velocidad 300 px/s, largo 26 px, se repite cada 1.5 s.
 * · Un solo `requestAnimationFrame` mientras esté activa.
 */
const VELOCIDAD = 300;      // px/s
const LARGO = 26;           // px
const INTERVALO = 1500;     // ms entre pulsos

let estado = null;

function largoTotal(puntos) {
  let total = 0;
  for (let i = 1; i < puntos.length; i += 1) {
    total += Math.hypot(puntos[i].x - puntos[i - 1].x, puntos[i].y - puntos[i - 1].y);
  }
  return total;
}

function puntoEn(puntos, distancia) {
  let recorrido = 0;
  for (let i = 1; i < puntos.length; i += 1) {
    const desde = puntos[i - 1];
    const hasta = puntos[i];
    const tramo = Math.hypot(hasta.x - desde.x, hasta.y - desde.y);
    if (recorrido + tramo >= distancia) {
      const t = tramo === 0 ? 0 : (distancia - recorrido) / tramo;
      return { x: desde.x + (hasta.x - desde.x) * t, y: desde.y + (hasta.y - desde.y) * t };
    }
    recorrido += tramo;
  }
  return puntos[puntos.length - 1];
}

/** Dibuja (y borra) el pulso sobre el SVG del papel. */
function pintar(svg, puntos, avance) {
  const capa = svg.querySelector('.pop-linterna');
  if (!capa) return;
  const total = largoTotal(puntos);
  if (total <= 0) return;
  const cabeza = Math.min(total, avance);
  const cola = Math.max(0, cabeza - LARGO);
  const inicio = puntoEn(puntos, cola);
  const fin = puntoEn(puntos, cabeza);
  capa.innerHTML = `<line x1="${inicio.x}" y1="${inicio.y}" x2="${fin.x}" y2="${fin.y}"
    class="pop-linterna-pulso"></line>
    <circle cx="${fin.x}" cy="${fin.y}" r="4" class="pop-linterna-cabeza"></circle>`;
}

/** Arranca el pulso sobre la cadena indicada. */
export function iniciarLinterna(svg, cadena) {
  detenerLinterna();
  if (!svg || !cadena || cadena.puntos.length < 2) return false;
  let capa = svg.querySelector('.pop-linterna');
  if (!capa) {
    capa = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    capa.setAttribute('class', 'pop-linterna');
    svg.appendChild(capa);
  }
  const total = largoTotal(cadena.puntos);
  estado = { svg, cadena, total, inicio: performance.now(), frame: null, ultimoPulso: -1 };

  const animar = (ahora) => {
    if (!estado) return;
    const transcurrido = (ahora - estado.inicio) % INTERVALO;
    const avance = (transcurrido / 1000) * VELOCIDAD;
    pintar(estado.svg, estado.cadena.puntos, avance);
    estado.frame = requestAnimationFrame(animar);
  };
  estado.frame = requestAnimationFrame(animar);
  return true;
}

export function detenerLinterna() {
  if (!estado) return;
  cancelAnimationFrame(estado.frame);
  const capa = estado.svg && estado.svg.querySelector('.pop-linterna');
  if (capa) capa.innerHTML = '';
  estado = null;
}

export function linternaActiva() {
  return !!estado;
}

export function direccionEtiqueta(cadena, senal) {
  const hacia = cadena && cadena.puntos.length > 1 ? 'derecha' : 'izquierda';
  return `${senal || 'SEÑAL'} ▶ ${hacia}`;
}
