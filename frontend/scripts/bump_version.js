const fs = require('fs');
let html = fs.readFileSync('d:/Desktop/VS/ema/frontend/index.html', 'utf8');

// Update version strings to force cache-bust
const now = Date.now();
html = html.replace(/css\/diagrama\.css\?v=[^"]+/g, 'css/diagrama.css?v=diag-v3-' + now);
html = html.replace(/js\/ftth-diagrama\.js\?v=[^"]+/g, 'js/ftth-diagrama.js?v=diag-v3-' + now);
html = html.replace(/js\/ftth-mapa\.js\?v=[^"]+/g, 'js/ftth-mapa.js?v=mapa-v3-' + now);

fs.writeFileSync('d:/Desktop/VS/ema/frontend/index.html', html, 'utf8');
console.log('Updated cache-busting version strings:', now);
