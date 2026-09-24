const fs = require('fs');
const file = 'd:/Desktop/VS/ema/frontend/index.html';
let html = fs.readFileSync(file, 'utf8');

const replacement = `<!-- Modal diagrama lógico del nodo (F3, solo lectura) -->
<div id="ftth-diagrama-modal" class="ftth-modal-overlay hidden" style="display:flex; align-items:center; justify-content:center; flex-direction:column; z-index:99999; background:rgba(0,0,0,0.5);">
  <div class="app-card" style="box-shadow: 0 20px 60px rgba(0,0,0,0.4); margin: 20px;">
    <div class="diagram-workspace" id="diagramWorkspace">
      <div class="top-toolbar">
        <div style="position:relative;">
          <button class="toolbar-btn mode-btn" id="modeBtn">
            <i class="fa-solid fa-eye"></i>
            <span id="modeLabel">Dirección</span>
            <i class="fa-solid fa-chevron-down chevron"></i>
          </button>
          <div class="mode-dropdown" id="modeDropdown">
            <div class="mode-option selected" data-mode="Dirección"><span>Dirección</span><i class="fa-solid fa-check"></i></div>
            <div class="mode-option" data-mode="Potencias"><span>Potencias</span><i class="fa-solid fa-check"></i></div>
          </div>
        </div>
        <div class="toolbar-divider"></div>
        <button class="toolbar-btn illuminate" data-tooltip="Iluminar izquierda" id="illuminateLeft">
          <i class="fa-solid fa-flashlight fa-flip-horizontal"></i>
        </button>
        <button class="toolbar-btn illuminate" data-tooltip="Iluminar derecha" id="illuminateRight">
          <i class="fa-solid fa-flashlight"></i>
        </button>
        <div class="toolbar-divider"></div>
        <button class="toolbar-btn" data-tooltip="Exportar PDF">
          <i class="fa-solid fa-file-pdf"></i>
        </button>
      </div>

      <div class="diag-body-container">
          <div id="diag-mark" style="display:none;"></div>
          <h1 id="diag-title" style="display:none;"></h1>
          <div id="diag-badge" style="display:none;"></div>
          <button id="diag-btn-reload" style="display:none;"></button>
          
          <div id="diag-sub" style="width:100%; margin-bottom: 20px;"></div>
          <div id="diag-body" style="width:100%;"></div>
          <div id="diag-pie" style="width:100%; margin-top: 20px;"></div>
      </div>

      <div class="bottom-toolbar">
        <button class="toolbar-btn" data-tooltip="Agregar cable de salida">
          <img src="assets/icons/cables.svg" width="16" height="16">
        </button>
        <button class="toolbar-btn" data-tooltip="Agregar cable de entrada">
          <img src="assets/icons/cables.svg" width="16" height="16">
        </button>
        <div class="toolbar-divider"></div>
        <button class="toolbar-btn" data-tooltip="Agregar splitter">
          <img src="assets/icons/splitter.svg" width="16" height="16">
        </button>
        <button class="toolbar-btn" data-tooltip="Agregar switch">
          <img src="assets/icons/switches.svg" width="16" height="16">
        </button>
        <button class="toolbar-btn" data-tooltip="Agregar ODF">
          <img src="assets/icons/odf.svg" width="16" height="16">
        </button>
        <button class="toolbar-btn" data-tooltip="Cortar elemento/spliter/fusion">
          <i class="fa-solid fa-scissors"></i>
        </button>
        <button class="toolbar-btn" data-tooltip="Agregar fusión">
          <img src="assets/icons/fusion.svg" width="16" height="16" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';"><i class="fa-solid fa-link" style="display:none;"></i>
        </button>
        <div class="toolbar-divider"></div>
        <button class="toolbar-btn" data-tooltip="Seleccionar">
          <i class="fa-solid fa-arrow-pointer"></i>
        </button>
        <button class="toolbar-btn danger" data-tooltip="Eliminar elemento">
          <i class="fa-solid fa-trash"></i>
        </button>
        <div class="toolbar-divider"></div>
        <button class="toolbar-btn" data-tooltip="Deshacer">
          <i class="fa-solid fa-rotate-left"></i>
        </button>
        <button class="toolbar-btn" data-tooltip="Rehacer">
          <i class="fa-solid fa-rotate-right"></i>
        </button>
      </div>
    </div>

    <div class="sidebar-drawer" id="sidebarDrawer">
      <div class="drawer-content" id="panel-diagrama"></div>
      <div class="drawer-content" id="panel-info">
        <div class="drawer-header">Información</div>
        <div class="drawer-body">
          <ul class="info-list">
          </ul>
        </div>
      </div>
      <div class="drawer-content" id="panel-tiempo">
        <div class="drawer-header">Historial</div>
        <div class="drawer-body">
          <ul class="timeline-list">
            <li class="timeline-item"><span class="timeline-time">Hoy</span><br><span class="timeline-text">Diagrama creado</span></li>
          </ul>
        </div>
      </div>
      <div class="drawer-content" id="panel-pendientes">
        <div class="drawer-header">Pendientes</div>
        <div class="drawer-body">
          <ul class="pending-list">
            <li class="pending-item">
              <input type="text" placeholder="Añadir nueva tarea..." style="border:none;background:transparent;width:100%;outline:none;">
            </li>
            <li class="pending-item"><input type="checkbox" id="task1"><label for="task1">Etiquetar puerto 4</label></li>
            <li class="pending-item"><input type="checkbox" id="task2"><label for="task2">Verificar sangría de cable</label></li>
          </ul>
        </div>
      </div>
    </div>

    <div class="sidebar-dock">
      <button class="sidebar-btn" data-panel="panel-diagrama" data-tooltip="Diagrama"><i class="fa-solid fa-diagram-project"></i></button>
      <button class="sidebar-btn" data-panel="panel-info" data-tooltip="Información"><i class="fa-solid fa-circle-info"></i></button>
      <button class="sidebar-btn" data-panel="panel-tiempo" data-tooltip="Historial"><i class="fa-regular fa-clock"></i></button>
      <button class="sidebar-btn" data-panel="panel-pendientes" data-tooltip="Pendientes"><i class="fa-solid fa-list-check"></i></button>
      <div style="flex:1;"></div>
      <button class="sidebar-btn" id="diag-btn-close" data-tooltip="Cerrar"><i class="fa-solid fa-times"></i></button>
    </div>
  </div>
</div>`;

html = html.replace(/<!-- Modal diagrama lógico del nodo \(F3, solo lectura\) -->[\s\S]*?<!-- Scripts JS -->/, replacement + '\n\n<!-- Scripts JS -->');
fs.writeFileSync(file, html, 'utf8');
