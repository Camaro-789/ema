/**
 * bump_version.js
 * Re-sella el ?v= de los recursos locales de index.html para forzar la recarga
 * en el navegador (cache-bust).
 *
 * Antes solo cubría css/diagrama.css, js/ftth-diagrama.js y js/ftth-mapa.js: si
 * se editaba cualquier otro archivo (plantillas visuales, ftth-colores...), el
 * navegador seguía sirviendo la copia vieja y parecía que el cambio "no se
 * aplicó". Ahora se re-sellan TODAS las referencias que ya llevan ?v=.
 *
 * No añade ?v= a los archivos que hoy no lo tienen (app.js, ftth-proyectos.js,
 * ftth-carpetas.js, ftth-iconos.js): se respeta la decisión existente.
 *
 * Uso (desde cualquier carpeta):
 *     node frontend/scripts/bump_version.js
 */
const fs = require('fs');

const RUTA_HTML = 'd:/Desktop/VS/ema/frontend/index.html';

let html = fs.readFileSync(RUTA_HTML, 'utf8');

// Un solo sello para toda la página: css/*.css?v=... y js/**/*.js?v=...
const sello = 'v' + Date.now();
let tocados = 0;

html = html.replace(/((?:css|js)\/[\w./-]+\.(?:css|js))\?v=[^"']+/g, (coincidencia, ruta) => {
  tocados += 1;
  return `${ruta}?v=${sello}`;
});

fs.writeFileSync(RUTA_HTML, html, 'utf8');
console.log(`index.html actualizado: ${tocados} recursos re-sellados con ${sello}`);

