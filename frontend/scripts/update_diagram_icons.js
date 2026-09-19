const fs = require('fs');

// 1. Update index.html
let html = fs.readFileSync('d:/Desktop/VS/ema/frontend/index.html', 'utf8');

// Update bottom toolbar buttons for entrada/salida de fibra to use doors with arrows:
html = html.replace(
  /<button class="toolbar-btn" data-tooltip="Agregar cable de salida">[\s\S]*?<\/button>/,
  `<button class="toolbar-btn" data-tooltip="Agregar cable de salida">
          <i class="fa-solid fa-right-to-bracket"></i>
        </button>`
);

html = html.replace(
  /<button class="toolbar-btn" data-tooltip="Agregar cable de entrada">[\s\S]*?<\/button>/,
  `<button class="toolbar-btn" data-tooltip="Agregar cable de entrada">
          <i class="fa-solid fa-right-from-bracket"></i>
        </button>`
);

// Ensure illuminate buttons use flashlight icons
html = html.replace(
  /<button class="toolbar-btn illuminate" data-tooltip="Iluminar izquierda" id="illuminateLeft">[\s\S]*?<\/button>/,
  `<button class="toolbar-btn illuminate" data-tooltip="Iluminar izquierda" id="illuminateLeft">
          <i class="fa-solid fa-flashlight fa-flip-horizontal"></i>
        </button>`
);

html = html.replace(
  /<button class="toolbar-btn illuminate" data-tooltip="Iluminar derecha" id="illuminateRight">[\s\S]*?<\/button>/,
  `<button class="toolbar-btn illuminate" data-tooltip="Iluminar derecha" id="illuminateRight">
          <i class="fa-solid fa-flashlight"></i>
        </button>`
);

fs.writeFileSync('d:/Desktop/VS/ema/frontend/index.html', html, 'utf8');
console.log('Updated index.html toolbars successfully.');
