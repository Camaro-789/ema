const fs = require('fs');
let code = fs.readFileSync('d:/Desktop/VS/ema/frontend/js/ftth-diagrama.js', 'utf8');

const injection = `
    // Toolbars Logic
    const btnAddSplitter = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar splitter"]');
    if (btnAddSplitter) {
      btnAddSplitter.addEventListener('click', () => {
        mostrarModalAgregarSplitter();
      });
    }

    const btnAddFusion = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar fusión"]');
    if (btnAddFusion) {
      btnAddFusion.addEventListener('click', () => {
        aviso('Función de agregar fusión próximamente...', 'info');
      });
    }

    const btnAddOdf = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar ODF"]');
    if (btnAddOdf) {
      btnAddOdf.addEventListener('click', () => {
        aviso('Función de agregar ODF próximamente...', 'info');
      });
    }

    const btnAddCableIn = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar cable de entrada"]');
    if (btnAddCableIn) {
      btnAddCableIn.addEventListener('click', () => {
        aviso('Agregar cable de entrada próximamente...', 'info');
      });
    }

    const btnAddCableOut = document.querySelector('.bottom-toolbar button[data-tooltip="Agregar cable de salida"]');
    if (btnAddCableOut) {
      btnAddCableOut.addEventListener('click', () => {
        aviso('Agregar cable de salida próximamente...', 'info');
      });
    }

    const btnDelete = document.querySelector('.bottom-toolbar button[data-tooltip="Eliminar elemento"]');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => {
        if (!_sel) {
          aviso('Selecciona un elemento en el diagrama primero', 'warning');
          return;
        }
        aviso('Eliminar elemento seleccionado próximamente...', 'info');
      });
    }
    
    // Wire up Select / Cut etc. to show a message for now
    const btnCut = document.querySelector('.bottom-toolbar button[data-tooltip="Cortar elemento/spliter/fusion"]');
    if (btnCut) btnCut.addEventListener('click', () => aviso('Selecciona una conexión para cortar', 'info'));
`;

// Insert it right before `_uiLista = true;` inside `bindChrome`
code = code.replace('_uiLista = true;', injection + '\n    _uiLista = true;');

fs.writeFileSync('d:/Desktop/VS/ema/frontend/js/ftth-diagrama.js', code, 'utf8');
console.log('Injected logic into bindChrome');
