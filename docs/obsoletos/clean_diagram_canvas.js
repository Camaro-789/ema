const fs = require('fs');
let code = fs.readFileSync('d:/Desktop/VS/ema/frontend/js/ftth-diagrama.js', 'utf8');

// 1. Remove sub header chips (no text at the top)
code = code.replace(
  /if \(sub\(\)\) \{[\s\S]*?sub\(\)\.innerHTML = s;\s*\}/,
  `if (sub()) { sub().innerHTML = ''; }`
);

// 2. colHilos: return empty string if no hilos
code = code.replace(
  /function colHilos\(d\) \{[\s\S]*?const hilos = d\.hilos_que_terminan \|\| \[\];[\s\S]*?if \(!hilos\.length\) \{[\s\S]*?return h \+ '<div class="diag-vacio">[\s\S]*?<\/div>';\s*\}/,
  `function colHilos(d) {
    const hilos = d.hilos_que_terminan || [];
    if (!hilos.length) return '';
    let h = \`<div class="diag-col-title">Hilos <span>(\${hilos.length})</span></div>\`;`
);

// 3. colBandejas: return empty string if no bandejas
code = code.replace(
  /function colBandejas\(d\) \{[\s\S]*?const bandejas = d\.bandejas \|\| \[\];[\s\S]*?if \(!bandejas\.length\) \{[\s\S]*?return h \+ '<div class="diag-vacio">[\s\S]*?<\/div>';\s*\}/,
  `function colBandejas(d) {
    const bandejas = d.bandejas || [];
    if (!bandejas.length) return '';
    let h = \`<div class="diag-col-title">Bandejas <span>(\${bandejas.length})</span></div>\`;`
);

// 4. colDispositivos: return empty string if no dispositivos
code = code.replace(
  /function colDispositivos\(d\) \{[\s\S]*?const disp = d\.dispositivos \|\| \[\];[\s\S]*?if \(!disp\.length\) \{[\s\S]*?return h \+ '<div class="diag-vacio">[\s\S]*?<\/div>';\s*\}/,
  `function colDispositivos(d) {
    const disp = d.dispositivos || [];
    if (!disp.length) return '';
    let h = \`<div class="diag-col-title">Dispositivos <span>(\${disp.length})</span></div>\`;`
);

// 5. pintarPie: don't show "Sin avisos: el nodo está coherente"
code = code.replace(
  /if \(!h\) h = '<div class="diag-detalle">Sin avisos: el nodo está coherente\.<\/div>';/,
  `if (!h) h = '';`
);

fs.writeFileSync('d:/Desktop/VS/ema/frontend/js/ftth-diagrama.js', code, 'utf8');
console.log('Cleaned diagram placeholders successfully.');
