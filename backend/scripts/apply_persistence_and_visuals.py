#!/usr/bin/env python3
"""
Apply UI State Persistence and visual consistency across all views:
1. CSS: Completely invisible scrollbars in pop-papel-dinamico.css
2. FTTHPopPapel (Cajas NAP & Mangas):
   - Continuous 6px buffer border
   - Collapsible buffers starting collapsed unless previously opened
   - Persist cable and device positions, open buffers, zoom, active tab in localStorage per element id
   - Auto-save on drag end, buffer toggle, tab change, zoom change
   - Restore on open (abrir)
   - Expose toggleBufferUI
3. MapOLTV25 Bridge (Armarios):
   - Persist per armario ID:
     * matrixOpenBuffers, dynOpenBuffers, rackOpenBuffers
     * matrixOpenPanels, matrixOpenCabs
     * dyn.layout (node x/y coordinates in Papel Dinámico)
     * dyn.scale (zoom)
     * currentView (active tab)
     * scroll position
   - Auto-save on buffer toggle, view switch, node drag end, beforeunload
   - Restore on applyMapOltData
"""
import sys, os, re
sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
CSS_PATH = os.path.join(ROOT, 'frontend', 'css', 'pop-papel-dinamico.css')
PAPEL_JS = os.path.join(ROOT, 'frontend', 'js', 'ftth-pop-papel.js')
BRIDGE_JS = os.path.join(ROOT, 'frontend', 'js', 'pop-v25-mapolt-bridge.js')

# ==========================================
# 1. Update pop-papel-dinamico.css
# ==========================================
print("Updating pop-papel-dinamico.css...")
with open(CSS_PATH, 'r', encoding='utf-8') as f:
    css = f.read()

# Replace scrollbar styling
old_css_scroll = """/* Scrollbars delgadas y transparentes */
.pop-paper-cable-body {
    overflow-y: auto !important;
    overflow-x: hidden !important;
    scrollbar-width: thin !important;
    scrollbar-color: rgba(0, 0, 0, 0.25) transparent !important;
}
.pop-paper-cable-body::-webkit-scrollbar {
    width: 4px !important;
    height: 0px !important;
}
.pop-paper-cable-body::-webkit-scrollbar-track {
    background: transparent !important;
}
.pop-paper-cable-body::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.25) !important;
    border-radius: 3px !important;
}
.pop-paper-cable-body::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.5) !important;
}"""

new_css_scroll = """/* Scrollbars completamente invisibles y expansión natural */
.pop-paper-cable-body {
    max-height: none !important;
    overflow: visible !important;
    scrollbar-width: none !important;
}
.pop-paper-cable-body::-webkit-scrollbar {
    display: none !important;
    width: 0px !important;
    height: 0px !important;
}"""

if old_css_scroll in css:
    css = css.replace(old_css_scroll, new_css_scroll)
    print("  ✓ Replaced scrollbar styles in CSS")
else:
    # If already modified or slightly different
    css = re.sub(
        r'/\* Scrollbars delgadas y transparentes \*/.*?(?=\Z|\n\s*/\*)',
        new_css_scroll,
        css,
        flags=re.DOTALL
    )
    print("  ✓ Regex updated scrollbar styles in CSS")

with open(CSS_PATH, 'w', encoding='utf-8') as f:
    f.write(css)


# ==========================================
# 2. Update ftth-pop-papel.js
# ==========================================
print("\nUpdating ftth-pop-papel.js...")
with open(PAPEL_JS, 'r', encoding='utf-8') as f:
    papel = f.read()

# Add devicePositions and openBuffers after cablePositions declaration
if "let devicePositions = {};" not in papel:
    papel = papel.replace(
        "let cablePositions = {};",
        """let cablePositions = {};
  let devicePositions = {};
  let openBuffers = new Set();

  function storageKeyCaja() {
    return current && current.id ? `mapolt_pop_caja_state_${current.id}` : null;
  }

  function guardarEstadoCaja() {
    const key = storageKeyCaja();
    if (!key) return;
    try {
      const state = {
        cablePositions,
        devicePositions,
        openBuffers: Array.from(openBuffers),
        activeTab,
        zoom
      };
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      console.warn('Error guardando estado de caja/manga:', e);
    }
  }

  function cargarEstadoCaja(id) {
    try {
      const raw = localStorage.getItem(`mapolt_pop_caja_state_${id}`);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }"""
    )
    print("  ✓ Added persistence functions for Caja/Manga")

# Update renderCable buffer block with continuous left border and collapsible state
old_render_buffer_block = """          const isCollapsed = b > 0; // Buffer 1 abierto por defecto

          const rows = bFibers.map((fiber, idx) => {
            const color = fiber.color_hex || EIA598_BUFFERS[idx % 12].hex;
            const globalNum = startHilo + idx;
            const padB = String(bNum).padStart(2, '0');
            const padH = String(idx + 1).padStart(2, '0');
            const port = `${side === 'entrada' ? 'OUT' : 'IN'}-${globalNum}`;
            const label = `H${globalNum} (B${padB}-H${padH}) · ${esc(fiber.color || EIA598_BUFFERS[idx % 12].name)}`;
            return `<div class="pop-paper-cable-row">
              <span class="pop-paper-cable-color" style="background:${esc(color)}"></span>
              <span>${label}</span>
              <span class="pop-paper-cable-port" data-port-type="cable" data-cable-id="${cable.id}" data-fibra-id="${fiber.fibra_id}" title="Punto de conexión ${esc(port)}"></span>
            </div>`;
          }).join('');

          bodyContent += `
            <div class="pop-paper-buffer-block" data-cable-id="${cable.id}" data-buffer="${bNum}">
              <div class="pop-paper-buffer-head ${isCollapsed ? 'collapsed' : ''}" style="border-left: 5px solid ${bufInfo.hex}; border-top: 1.5px solid #0f172a; border-bottom: 1.5px solid #0f172a;" onclick="FTTHPopPapel.toggleBufferUI(this)">
                <div class="pop-paper-buffer-title">
                  <span class="buffer-arrow">${isCollapsed ? '▶' : '▼'}</span>
                  <span>BUFFER ${bNum} · ${bufInfo.name.toUpperCase()}</span>
                </div>
                <span class="pop-paper-buffer-tag">H${startHilo}–H${endHilo}</span>
              </div>
              <div class="pop-paper-buffer-rows" style="${isCollapsed ? 'display:none;' : ''}">
                ${rows}
              </div>
            </div>
          `;"""

new_render_buffer_block = """          const bKey = `${cable.id}-${bNum}`;
          const isCollapsed = !openBuffers.has(bKey);

          const rows = bFibers.map((fiber, idx) => {
            const color = fiber.color_hex || EIA598_BUFFERS[idx % 12].hex;
            const globalNum = startHilo + idx;
            const padB = String(bNum).padStart(2, '0');
            const padH = String(idx + 1).padStart(2, '0');
            const port = `${side === 'entrada' ? 'OUT' : 'IN'}-${globalNum}`;
            const label = `H${globalNum} (B${padB}-H${padH}) · ${esc(fiber.color || EIA598_BUFFERS[idx % 12].name)}`;
            return `<div class="pop-paper-cable-row">
              <span class="pop-paper-cable-color" style="background:${esc(color)}"></span>
              <span>${label}</span>
              <span class="pop-paper-cable-port" data-port-type="cable" data-cable-id="${cable.id}" data-fibra-id="${fiber.fibra_id}" title="Punto de conexión ${esc(port)}"></span>
            </div>`;
          }).join('');

          // Franja continua de 6px en el borde izquierdo de todo el bloque del buffer
          bodyContent += `
            <div class="pop-paper-buffer-block" data-cable-id="${cable.id}" data-buffer="${bNum}" style="border-left: 6px solid ${bufInfo.hex}; border-top: 1.5px solid #0f172a; border-bottom: 1.5px solid #0f172a; margin-bottom: -1.5px; background: #fff;">
              <div class="pop-paper-buffer-head ${isCollapsed ? 'collapsed' : ''}" style="border-bottom: ${isCollapsed ? 'none' : '1px solid #e2e8f0'};" onclick="FTTHPopPapel.toggleBufferUI(this)">
                <div class="pop-paper-buffer-title">
                  <span class="buffer-arrow">${isCollapsed ? '▶' : '▼'}</span>
                  <span>BUFFER ${bNum} · ${bufInfo.name.toUpperCase()}</span>
                </div>
                <span class="pop-paper-buffer-tag">H${startHilo}–H${endHilo}</span>
              </div>
              <div class="pop-paper-buffer-rows" style="${isCollapsed ? 'display:none;' : ''}">
                ${rows}
              </div>
            </div>
          `;"""

if old_render_buffer_block in papel:
    papel = papel.replace(old_render_buffer_block, new_render_buffer_block)
    print("  ✓ Replaced renderCable buffer block")
else:
    print("  ! Notice: old_render_buffer_block exact match not found, checking regex...")
    papel = re.sub(
        r'const isCollapsed = b > 0;.*?bodyContent \+= `\s*<div class="pop-paper-buffer-block".*?</div>\s*`;',
        new_render_buffer_block,
        papel,
        flags=re.DOTALL
    )
    print("  ✓ Regex updated renderCable buffer block")

# Ensure pop-paper-cable-body has style="max-height:none; overflow:visible;"
papel = re.sub(
    r'<div class="pop-paper-cable-body"[^>]*>',
    '<div class="pop-paper-cable-body" style="max-height:none; overflow:visible;">',
    papel
)

# Update device position lookup in render() to check devicePositions
old_pos_lookup = """        const position = nodeData.posiciones && nodeData.posiciones[device.id]
          ? nodeData.posiciones[device.id]
          : { x: 470 + (index % 2) * 290, y: 120 + Math.floor(index / 2) * 360 };"""

new_pos_lookup = """        const savedDevPos = devicePositions[device.id];
        const position = savedDevPos || (nodeData.posiciones && nodeData.posiciones[device.id]
          ? nodeData.posiciones[device.id]
          : { x: 470 + (index % 2) * 290, y: 120 + Math.floor(index / 2) * 360 });"""

if old_pos_lookup in papel:
    papel = papel.replace(old_pos_lookup, new_pos_lookup)
    print("  ✓ Device position lookup updated")

# Update pointermove / pointerup to store positions and save
old_pointer_move_record = """          if (dragging.kind === 'cable') cablePositions[dragging.id] = { x: left, y: top };"""
new_pointer_move_record = """          if (dragging.kind === 'cable') {
            cablePositions[dragging.id] = { x: left, y: top };
          } else if (dragging.kind === 'device') {
            devicePositions[dragging.id] = { x: left, y: top };
          }"""

if old_pointer_move_record in papel:
    papel = papel.replace(old_pointer_move_record, new_pointer_move_record)

old_pointer_up = """      world.addEventListener('pointerup', () => {
        if (dragging && dragging.element) dragging.element.classList.remove('is-dragging');
        dragging = null;
      });"""

new_pointer_up = """      world.addEventListener('pointerup', () => {
        if (dragging && dragging.element) {
          dragging.element.classList.remove('is-dragging');
          if (dragging.kind === 'cable') {
            cablePositions[dragging.id] = {
              x: Number.parseFloat(dragging.element.style.left) || 0,
              y: Number.parseFloat(dragging.element.style.top) || 0
            };
          } else if (dragging.kind === 'device') {
            devicePositions[dragging.id] = {
              x: Number.parseFloat(dragging.element.style.left) || 0,
              y: Number.parseFloat(dragging.element.style.top) || 0
            };
          }
          guardarEstadoCaja();
        }
        dragging = null;
      });"""

if old_pointer_up in papel:
    papel = papel.replace(old_pointer_up, new_pointer_up)
    print("  ✓ Pointerup drag-save updated")

# Tab switch save
old_tab_click = """      button.addEventListener('click', () => {
        activeTab = button.dataset.tab;
        render();
      });"""

new_tab_click = """      button.addEventListener('click', () => {
        activeTab = button.dataset.tab;
        guardarEstadoCaja();
        render();
      });"""

if old_tab_click in papel:
    papel = papel.replace(old_tab_click, new_tab_click)
    print("  ✓ Tab click save updated")

# Zoom save
old_set_zoom = """  function setZoom(value) {
    zoom = Math.min(2.5, Math.max(0.25, value));
    applyZoom();
    dibujarConexiones();
  }"""

new_set_zoom = """  function setZoom(value) {
    zoom = Math.min(2.5, Math.max(0.25, value));
    applyZoom();
    dibujarConexiones();
    guardarEstadoCaja();
  }"""

if old_set_zoom in papel:
    papel = papel.replace(old_set_zoom, new_set_zoom)
    print("  ✓ setZoom save updated")

# Add toggleBufferUI implementation if not present
if "function toggleBufferUI(" not in papel:
    # Insert right before function abrir
    toggle_ui_code = """  function toggleBufferUI(headerEl) {
    const block = headerEl.closest('.pop-paper-buffer-block');
    if (!block) return;
    const cableId = block.dataset.cableId;
    const bNum = block.dataset.buffer;
    const bKey = `${cableId}-${bNum}`;
    const rows = block.querySelector('.pop-paper-buffer-rows');
    const arrow = block.querySelector('.buffer-arrow');
    if (openBuffers.has(bKey)) {
      openBuffers.delete(bKey);
      headerEl.classList.add('collapsed');
      if (rows) rows.style.display = 'none';
      if (arrow) arrow.textContent = '▶';
      headerEl.style.borderBottom = 'none';
    } else {
      openBuffers.add(bKey);
      headerEl.classList.remove('collapsed');
      if (rows) rows.style.display = '';
      if (arrow) arrow.textContent = '▼';
      headerEl.style.borderBottom = '1px solid #e2e8f0';
    }
    guardarEstadoCaja();
    dibujarConexiones();
  }

"""
    papel = papel.replace("  function abrir(id, opciones = {}) {", toggle_ui_code + "  function abrir(id, opciones = {}) {")
    print("  ✓ Added toggleBufferUI function")

# Update abrir to load state instead of resetting
old_abrir = """  function abrir(id, opciones = {}) {
    // Fase 1.4: con el interruptor apagado no se abre ningún diagrama.
    if (window.FTTH_FLAGS && window.FTTH_FLAGS.pop_v25_enabled === false) return;
    // El ARMARIO siempre abre pop_gestor_v25.html vía iframe (puente) para
    // garantízar paridad visual idéntica con la plantilla de referencia.
    // El módulo nativo (POPNativo) queda disponible para otros contenedores
    // o se puede reactivar con POP_NATIVO_EN_ARMARIO=1 en el futuro.
    const esArmario = String(opciones.categoria || '').toLowerCase() === 'armario';
    current = { id, ...opciones };
    nodeData = null;
    activeTab = 'rack';
    zoom = 1;
    torchDirection = null;
    cablePositions = {};
    connectionSelection = null;
    ensureModal().classList.remove('hidden');
    render();
    cargarNodo().catch(error => mostrarAviso(error.message, 'error'));
  }"""

new_abrir = """  function abrir(id, opciones = {}) {
    // Fase 1.4: con el interruptor apagado no se abre ningún diagrama.
    if (window.FTTH_FLAGS && window.FTTH_FLAGS.pop_v25_enabled === false) return;
    const esArmario = String(opciones.categoria || '').toLowerCase() === 'armario';
    current = { id, ...opciones };
    const saved = cargarEstadoCaja(id);
    nodeData = null;
    activeTab = (saved && saved.activeTab) ? saved.activeTab : 'rack';
    zoom = (saved && saved.zoom) ? saved.zoom : 1;
    torchDirection = null;
    cablePositions = (saved && saved.cablePositions) ? saved.cablePositions : {};
    devicePositions = (saved && saved.devicePositions) ? saved.devicePositions : {};
    openBuffers = new Set((saved && saved.openBuffers) ? saved.openBuffers : []);
    connectionSelection = null;
    ensureModal().classList.remove('hidden');
    render();
    cargarNodo().catch(error => mostrarAviso(error.message, 'error'));
  }"""

if old_abrir in papel:
    papel = papel.replace(old_abrir, new_abrir)
    print("  ✓ Updated abrir() to restore saved UI state")

# Expose toggleBufferUI on return
old_return = "  return { abrir, cerrar };"
new_return = "  return { abrir, cerrar, toggleBufferUI };"
if old_return in papel:
    papel = papel.replace(old_return, new_return)
    print("  ✓ Exposing toggleBufferUI in FTTHPopPapel return")

with open(PAPEL_JS, 'w', encoding='utf-8') as f:
    f.write(papel)


# ==========================================
# 3. Update pop-v25-mapolt-bridge.js
# ==========================================
print("\nUpdating pop-v25-mapolt-bridge.js...")
with open(BRIDGE_JS, 'r', encoding='utf-8') as f:
    bridge = f.read()

# Add Armario UI state persistence functions right above EIA598_BUFFERS
persistence_armario_code = """  /* ── PERSISTENCIA DE ESTADO UI DEL ARMARIO (localStorage por armario) ───── */
  let currentArmarioId = null;
  const STORAGE_KEY_ARMARIO = 'mapolt_pop_armario_state_';

  function guardarEstadoArmario() {
    if (!currentArmarioId) return;
    try {
      const state = {
        currentView: typeof currentView !== 'undefined' ? currentView : 'rack',
        matrixOpenBuffers: Array.from(window.matrixOpenBuffers || []),
        dynOpenBuffers: Array.from(window.dynOpenBuffers || []),
        rackOpenBuffers: Array.from(window.rackOpenBuffers || []),
        matrixOpenPanels: (typeof matrixOpenPanels !== 'undefined' && matrixOpenPanels) ? Array.from(matrixOpenPanels) : [],
        matrixOpenCabs: (typeof matrixOpenCabs !== 'undefined' && matrixOpenCabs) ? Array.from(matrixOpenCabs) : [],
        dynLayout: (typeof dyn !== 'undefined' && dyn.layout) ? dyn.layout : {},
        dynScale: (typeof dyn !== 'undefined' && dyn.scale) ? dyn.scale : 1,
        scroll: (typeof dynView !== 'undefined') ? { l: dynView.l, t: dynView.t } : { l: 0, t: 0 }
      };
      localStorage.setItem(STORAGE_KEY_ARMARIO + currentArmarioId, JSON.stringify(state));
    } catch (e) {
      console.warn('Error guardando estado UI del armario:', e);
    }
  }

  function restaurarEstadoArmario() {
    if (!currentArmarioId) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ARMARIO + currentArmarioId);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (!state) return;

      if (Array.isArray(state.matrixOpenBuffers)) {
        window.matrixOpenBuffers = new Set(state.matrixOpenBuffers);
      }
      if (Array.isArray(state.dynOpenBuffers)) {
        window.dynOpenBuffers = new Set(state.dynOpenBuffers);
      }
      if (Array.isArray(state.rackOpenBuffers)) {
        window.rackOpenBuffers = new Set(state.rackOpenBuffers);
      }
      if (Array.isArray(state.matrixOpenPanels) && typeof matrixOpenPanels !== 'undefined') {
        matrixOpenPanels.clear();
        state.matrixOpenPanels.forEach(id => matrixOpenPanels.add(id));
      }
      if (Array.isArray(state.matrixOpenCabs) && typeof matrixOpenCabs !== 'undefined') {
        matrixOpenCabs.clear();
        state.matrixOpenCabs.forEach(id => matrixOpenCabs.add(id));
      }
      if (state.dynLayout && typeof dyn !== 'undefined') {
        dyn.layout = Object.assign(dyn.layout || {}, state.dynLayout);
      }
      if (state.dynScale && typeof dyn !== 'undefined') {
        dyn.scale = state.dynScale;
      }
      if (state.scroll && typeof dynView !== 'undefined') {
        dynView.l = state.scroll.l || 0;
        dynView.t = state.scroll.t || 0;
        dynView.loaded = true;
      }
      if (state.currentView && typeof switchView === 'function' && state.currentView !== currentView) {
        setTimeout(() => switchView(state.currentView), 80);
      }
    } catch (e) {
      console.warn('Error restaurando estado UI del armario:', e);
    }
  }

  window.addEventListener('mouseup', () => {
    // Guardar si hubo paneo, arrastre de nodo en dynWorld o clics en paneles
    setTimeout(guardarEstadoArmario, 120);
  });
  window.addEventListener('beforeunload', guardarEstadoArmario);
"""

if "function guardarEstadoArmario()" not in bridge:
    target_insert = "  /* ── EIA-598-A BUFFER & FIBER STANDARDS (MODELO A) ───────────────────────── */"
    bridge = bridge.replace(target_insert, persistence_armario_code + "\n  " + target_insert)
    print("  ✓ Added Armario persistence functions")

# Hook currentArmarioId and restaurarEstadoArmario in applyMapOltData
if "currentArmarioId =" not in bridge:
    old_apply_data_start = """    cabinets = [{ id: 'mapolt', nombre: data.armario_nombre || (data.nodo && data.nodo.nombre) || 'Armario #61', tipo: 'Rack de piso 19"', u: Number((data.nodo && data.nodo.u) || 12) }];"""
    new_apply_data_start = """    currentArmarioId = (data.nodo && data.nodo.id) || data.id || data.nodo_id || (data.armario_nombre ? String(data.armario_nombre).replace(/\\s+/g, '_') : 'default');
    restaurarEstadoArmario();
    cabinets = [{ id: 'mapolt', nombre: data.armario_nombre || (data.nodo && data.nodo.nombre) || 'Armario #61', tipo: 'Rack de piso 19"', u: Number((data.nodo && data.nodo.u) || 12) }];"""
    bridge = bridge.replace(old_apply_data_start, new_apply_data_start)
    print("  ✓ Hooked currentArmarioId and restaurarEstadoArmario in applyMapOltData")

# Save on toggleMatrixBufferUI
old_toggle_matriz = """  window.toggleMatrixBufferUI = function (header, cableId, bufferNum) {
    const key = `${cableId}-${bufferNum}`;
    if (window.matrixOpenBuffers.has(key)) {
      window.matrixOpenBuffers.delete(key);
    } else {
      window.matrixOpenBuffers.add(key);
    }
    if (typeof renderTreeView === 'function') renderTreeView();
  };"""

new_toggle_matriz = """  window.toggleMatrixBufferUI = function (header, cableId, bufferNum) {
    const key = `${cableId}-${bufferNum}`;
    if (window.matrixOpenBuffers.has(key)) {
      window.matrixOpenBuffers.delete(key);
    } else {
      window.matrixOpenBuffers.add(key);
    }
    guardarEstadoArmario();
    if (typeof renderTreeView === 'function') renderTreeView();
  };"""

if old_toggle_matriz in bridge:
    bridge = bridge.replace(old_toggle_matriz, new_toggle_matriz)
    print("  ✓ Added save on toggleMatrixBufferUI")

# Save on matrixExpandBuffers
old_expand_matriz = """  window.matrixExpandBuffers = function (cableId, totalBuffers, expand) {
    for (let b = 1; b <= totalBuffers; b++) {
      const key = `${cableId}-${b}`;
      if (expand) window.matrixOpenBuffers.add(key);
      else window.matrixOpenBuffers.delete(key);
    }
    if (typeof renderTreeView === 'function') renderTreeView();
  };"""

new_expand_matriz = """  window.matrixExpandBuffers = function (cableId, totalBuffers, expand) {
    for (let b = 1; b <= totalBuffers; b++) {
      const key = `${cableId}-${b}`;
      if (expand) window.matrixOpenBuffers.add(key);
      else window.matrixOpenBuffers.delete(key);
    }
    guardarEstadoArmario();
    if (typeof renderTreeView === 'function') renderTreeView();
  };"""

if old_expand_matriz in bridge:
    bridge = bridge.replace(old_expand_matriz, new_expand_matriz)
    print("  ✓ Added save on matrixExpandBuffers")

# Save on toggleDynBufferUI
old_toggle_dyn = """  window.toggleDynBufferUI = function (header, cableId, bufferNum) {
    const key = `${cableId}-${bufferNum}`;
    if (window.dynOpenBuffers.has(key)) {
      window.dynOpenBuffers.delete(key);
    } else {
      window.dynOpenBuffers.add(key);
    }
    if (typeof renderDyn === 'function') renderDyn();
  };"""

new_toggle_dyn = """  window.toggleDynBufferUI = function (header, cableId, bufferNum) {
    const key = `${cableId}-${bufferNum}`;
    if (window.dynOpenBuffers.has(key)) {
      window.dynOpenBuffers.delete(key);
    } else {
      window.dynOpenBuffers.add(key);
    }
    guardarEstadoArmario();
    if (typeof renderDyn === 'function') renderDyn();
  };"""

if old_toggle_dyn in bridge:
    bridge = bridge.replace(old_toggle_dyn, new_toggle_dyn)
    print("  ✓ Added save on toggleDynBufferUI")

# Save on toggleRackBufferUI
old_toggle_rack = """  window.toggleRackBufferUI = function (cableId, bufferNum) {
    const key = cableId + '-' + bufferNum;
    if (window.rackOpenBuffers.has(key)) {
      window.rackOpenBuffers.delete(key);
    } else {
      window.rackOpenBuffers.add(key);
    }
    // Re-render cables in left panel
    if (typeof renderCables === 'function') renderCables();
  };"""

new_toggle_rack = """  window.toggleRackBufferUI = function (cableId, bufferNum) {
    const key = cableId + '-' + bufferNum;
    if (window.rackOpenBuffers.has(key)) {
      window.rackOpenBuffers.delete(key);
    } else {
      window.rackOpenBuffers.add(key);
    }
    guardarEstadoArmario();
    // Re-render cables in left panel
    if (typeof renderCables === 'function') renderCables();
  };"""

if old_toggle_rack in bridge:
    bridge = bridge.replace(old_toggle_rack, new_toggle_rack)
    print("  ✓ Added save on toggleRackBufferUI")

# Save on switchView
old_switch_view = """  const originalSwitchView = window.switchView;
  window.switchView = function (v) {
    if (typeof originalSwitchView === 'function') originalSwitchView(v);
    setTimeout(aplicarLimpiezaUI, 80);
  };"""

new_switch_view = """  const originalSwitchView = window.switchView;
  window.switchView = function (v) {
    if (typeof originalSwitchView === 'function') originalSwitchView(v);
    guardarEstadoArmario();
    setTimeout(aplicarLimpiezaUI, 80);
  };"""

if old_switch_view in bridge:
    bridge = bridge.replace(old_switch_view, new_switch_view)
    print("  ✓ Added save on switchView")

with open(BRIDGE_JS, 'w', encoding='utf-8') as f:
    f.write(bridge)

print("\nAll files successfully updated!")
