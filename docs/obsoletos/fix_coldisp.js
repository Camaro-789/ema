const fs = require('fs');

// 1. Fix colDispositivos in ftth-diagrama.js so it returns empty string when no dispositivos exist
let js = fs.readFileSync('d:/Desktop/VS/ema/frontend/js/ftth-diagrama.js', 'utf8');

const oldColDisp = `function colDispositivos(d) {
    const dispositivos = d.dispositivos || [];
    const puertos = d.puertos || [];
    let h = \`<div class="diag-col-title">Dispositivos y puertos <span>(\${dispositivos.length} · \${puertos.length} puertos)</span></div>\`;
    if (!dispositivos.length) {
      return h + '<div class="diag-vacio">Sin splitters ni adaptadores instalados. '
        + 'Un splitter 1xN genera sus puertos automáticamente al instalarlo.</div>';
    }`;

const newColDisp = `function colDispositivos(d) {
    const dispositivos = d.dispositivos || [];
    if (!dispositivos.length) return '';
    const puertos = d.puertos || [];
    let h = \`<div class="diag-col-title">Dispositivos <span>(\${dispositivos.length})</span></div>\`;`;

if (js.includes(oldColDisp)) {
  js = js.replace(oldColDisp, newColDisp);
  fs.writeFileSync('d:/Desktop/VS/ema/frontend/js/ftth-diagrama.js', js, 'utf8');
  console.log('Fixed colDispositivos successfully!');
} else {
  console.log('oldColDisp pattern not found, trying regex...');
  js = js.replace(
    /function colDispositivos\(d\) \{[\s\S]*?if \(!dispositivos\.length\) \{[\s\S]*?<\/div>';\s*\}/,
    `function colDispositivos(d) {
    const dispositivos = d.dispositivos || [];
    if (!dispositivos.length) return '';
    const puertos = d.puertos || [];
    let h = \`<div class="diag-col-title">Dispositivos <span>(\${dispositivos.length})</span></div>\`;`
  );
  fs.writeFileSync('d:/Desktop/VS/ema/frontend/js/ftth-diagrama.js', js, 'utf8');
  console.log('Fixed colDispositivos with regex!');
}
