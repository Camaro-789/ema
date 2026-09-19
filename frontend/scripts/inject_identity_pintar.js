const fs = require('fs');
let code = fs.readFileSync('d:/Desktop/VS/ema/frontend/js/ftth-diagrama.js', 'utf8');

// Inject identity bar population right after the marca() line in pintar()
const TARGET = `    if (marca() && window.FTTHIconos) marca().innerHTML = window.FTTHIconos.imgHtml(nodo.categoria, 18);\r\n\r\n    if (sub()) { sub().innerHTML = ''; }`;

const REPLACEMENT = `    if (marca() && window.FTTHIconos) marca().innerHTML = window.FTTHIconos.imgHtml(nodo.categoria, 18);\r\n\r\n    // ── Populate identity bar with node name and code ──\n    const identName = document.getElementById('diag-identity-name');\n    const identCode = document.getElementById('diag-identity-code');\n    if (identName) identName.textContent = nodo.nombre || nodo.tipo_nombre || ('Nodo #' + nodo.box_id);\n    if (identCode) identCode.textContent = nodo.codigo || nodo.box_id || '—';\n\r\n    if (sub()) { sub().innerHTML = ''; }`;

if (code.includes(TARGET)) {
  code = code.replace(TARGET, REPLACEMENT);
  fs.writeFileSync('d:/Desktop/VS/ema/frontend/js/ftth-diagrama.js', code, 'utf8');
  console.log('✓ Injected identity bar population into pintar()');
} else {
  console.log('✗ Target not found. Trying without CRLF...');
  const TARGET2 = `    if (marca() && window.FTTHIconos) marca().innerHTML = window.FTTHIconos.imgHtml(nodo.categoria, 18);\n\n    if (sub()) { sub().innerHTML = ''; }`;
  if (code.includes(TARGET2)) {
    code = code.replace(TARGET2, TARGET2.replace(
      'if (sub()) { sub().innerHTML = \'\'; }',
      `// ── Populate identity bar ──\n    const identName = document.getElementById('diag-identity-name');\n    const identCode = document.getElementById('diag-identity-code');\n    if (identName) identName.textContent = nodo.nombre || nodo.tipo_nombre || ('Nodo #' + nodo.box_id);\n    if (identCode) identCode.textContent = nodo.codigo || nodo.box_id || '—';\n\n    if (sub()) { sub().innerHTML = ''; }`
    ));
    fs.writeFileSync('d:/Desktop/VS/ema/frontend/js/ftth-diagrama.js', code, 'utf8');
    console.log('✓ Injected via fallback TARGET2');
  } else {
    console.log('✗ Both patterns failed.');
  }
}
