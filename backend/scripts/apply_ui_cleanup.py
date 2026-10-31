#!/usr/bin/env python3
"""Apply UI cleanup changes to pop-v25-mapolt-bridge.js:
1. Remove "Armario OLT HUB" from left panel (redundant)
2. Move "+GABINETE" button to top-right toolbar
3. Fix overlapping green save buttons (separate them)
4. Remove "Color de Equipos" from top bar
5. Remove "HUB OLT" and "Todos" from Papel Dinámico
6. Apply buffer visual structure to Rack left panel (same as Papel Dinámico)
7. Remove help text from Rack left panel
"""
import sys, os
sys.stdout.reconfigure(encoding='utf-8')

BRIDGE = os.path.join(os.path.dirname(__file__), '..', '..', 'frontend', 'js', 'pop-v25-mapolt-bridge.js')
BRIDGE = os.path.normpath(BRIDGE)

with open(BRIDGE, 'r', encoding='utf-8') as f:
    content = f.read()

# We'll add a large block of DOM manipulation code right before `post('ready');`
# This block will use MutationObserver and post-render hooks to:
# 1. Hide "Armario" name in left panel cablesHead (redundant)
# 2. Move "+GABINETE" to top bar
# 3. Remove "Color de Equipos" label
# 4. Hide the dynCabs selector in Papel Dinámico (since there's only one cabinet)
# 5. Override renderCables to group by buffers in Rack left panel
# 6. Hide help text in Rack left panel
# 7. Fix save button overlap

NEW_CODE = r'''
  /* ── UI CLEANUP & RACK BUFFER GROUPING ─────────────────────────────────────── */
  function aplicarLimpiezaUI() {
    const topBar = document.querySelector('.top');
    if (!topBar) return;

    // 1. Remove "COLOR EQUIPOS" label from top bar
    const eqcLabel = topBar.querySelector('.eqc');
    if (eqcLabel) eqcLabel.style.display = 'none';

    // 2. Move "+ GABINETE" button from cabBar to top bar (next to tabs)
    //    We'll do this after renderCabBar runs, so we observe #cabBar
    moverBotonGabinete();

    // 3. Hide "Armario OLT HUB" from cabBar (it's redundant - already shown in rack header)
    //    The cabBar shows cabinet tabs like "Gabinete 1" - we hide the entire cabBar
    //    because with MapOLT there's only one gabinete and it's already shown in rackHead
    ocultarCabBarRedundante();

    // 4. Fix overlapping save button - ensure only one exists and is properly positioned
    arreglarBotonGuardar();

    // 5. Hide help text in Rack left panel
    ocultarTextoAyuda();

    // 6. Hide dynCabs (HUB OLT / Todos) in Papel Dinámico
    ocultarDynCabs();
  }

  function moverBotonGabinete() {
    const topBar = document.querySelector('.top');
    if (!topBar) return;
    // Remove any previously moved button
    const prev = document.getElementById('btnGabineteTop');
    if (prev) prev.remove();
    // Find the "+ GABINETE" button in cabBar
    const cabBar = document.getElementById('cabBar');
    if (!cabBar) return;
    const cabActDiv = cabBar.querySelector('.cabact');
    if (!cabActDiv) return;
    const gabBtn = cabActDiv.querySelector('.btn.sm.dark');
    if (!gabBtn || !gabBtn.textContent.includes('GABINETE')) return;
    // Clone it to top bar
    const clone = gabBtn.cloneNode(true);
    clone.id = 'btnGabineteTop';
    clone.className = 'btn sm';
    clone.style.cssText = 'margin:7px 4px;';
    // Insert before the spacer
    const spacer = topBar.querySelector('.spacer');
    if (spacer) {
      topBar.insertBefore(clone, spacer);
    }
    // Hide original cabact buttons (they're redundant with single cabinet)
    cabActDiv.style.display = 'none';
  }

  function ocultarCabBarRedundante() {
    // With MapOLT, there's typically only one gabinete - hide cabtabs (redundant)
    const cabBar = document.getElementById('cabBar');
    if (!cabBar) return;
    // Only hide if there's a single cabinet
    if (cabinets && cabinets.length <= 1) {
      const cabtabs = cabBar.querySelector('.cabtabs');
      if (cabtabs) cabtabs.style.display = 'none';
    }
  }

  function arreglarBotonGuardar() {
    const topBar = document.querySelector('.top');
    if (!topBar) return;
    // Find all green save buttons
    const allBtns = topBar.querySelectorAll('#btnGuardarMapOlt');
    if (allBtns.length > 1) {
      // Keep only the first, remove the rest
      for (let i = 1; i < allBtns.length; i++) allBtns[i].remove();
    }
    // Also ensure the "+ EQUIPO" button doesn't overlap with save button
    const saveBtn = document.getElementById('btnGuardarMapOlt');
    const addEqBtn = topBar.querySelector('.btn.dark:not(#btnGuardarMapOlt):not(#btnGabineteTop)');
    if (saveBtn && addEqBtn) {
      saveBtn.style.marginRight = '4px';
      addEqBtn.style.marginLeft = '4px';
    }
  }

  function ocultarTextoAyuda() {
    const leftPanel = document.getElementById('leftPanel');
    if (!leftPanel) return;
    const helpDiv = leftPanel.querySelector('.help');
    if (helpDiv) helpDiv.style.display = 'none';
  }

  function ocultarDynCabs() {
    // Hide the dynCabs selector (HUB OLT / Todos buttons) in Papel Dinámico
    const dynCabs = document.getElementById('dynCabs');
    if (dynCabs) dynCabs.style.display = 'none';
    // Also hide the long instruction text in dbar
    const dbar = document.querySelector('.dbar');
    if (dbar) {
      const instrSpan = dbar.querySelector('span:first-child');
      if (instrSpan && instrSpan.textContent.includes('Arrastra de un puerto')) {
        instrSpan.style.display = 'none';
      }
    }
  }

  /* ── RACK LEFT PANEL: Buffer grouping (same visual as Papel Dinámico) ────── */
  window.rackOpenBuffers = window.rackOpenBuffers || new Set();

  window.toggleRackBufferUI = function (cableId, bufferNum) {
    const key = cableId + '-' + bufferNum;
    if (window.rackOpenBuffers.has(key)) {
      window.rackOpenBuffers.delete(key);
    } else {
      window.rackOpenBuffers.add(key);
    }
    // Re-render cables in left panel
    if (typeof renderCables === 'function') renderCables();
  };

  // Override renderCables to add buffer grouping to the Rack left panel
  const originalRenderCables = window.renderCables;
  window.renderCables = function () {
    if (typeof originalRenderCables === 'function') originalRenderCables();

    // After original render, transform the hilos section to group by buffers
    const cablesList = document.getElementById('cablesList');
    if (!cablesList) return;

    const cur = (typeof currentCableId !== 'undefined') ? cableById(currentCableId) : null;
    if (!cur || cur.hilos < 12) return;

    // Find the .hilos container inside cablesList
    const hilosDiv = cablesList.querySelector('.hilos');
    if (!hilosDiv) return;

    const bufferSize = 12;
    const numBuffers = Math.ceil(cur.hilos / bufferSize);
    let buffersHtml = '';

    for (let b = 1; b <= numBuffers; b++) {
      const buf = EIA598_BUFFERS[(b - 1) % 12];
      const key = cur.id + '-' + b;
      const isOpen = window.rackOpenBuffers.has(key);
      const start = (b - 1) * bufferSize + 1;
      const end = Math.min(b * bufferSize, cur.hilos);

      let rowsHtml = '';
      if (isOpen) {
        for (let i = start - 1; i < end; i++) {
          const h = window.hiloInfo(cur, i);
          const ep = hiloEp(cur, i);
          const padB = String(b).padStart(2, '0');
          const padH = String((i % 12) + 1).padStart(2, '0');
          const chipHtml = (typeof hiloChip === 'function') ? hiloChip(ep) : '';
          const selClass = (typeof selCls === 'function') ? selCls(ep) : '';
          const lc = (typeof lcStyle === 'function') ? lcStyle(ep) : '';
          rowsHtml += '<div class="hl ' + selClass + '" data-ep="' + ep.key + '" data-ctx="rack" style="' + lc + '">' +
            '<span class="sw" style="background:' + h.hex + '"></span>' +
            '<span class="hlt"><span>H' + (i + 1) + ' (B' + padB + '-H' + padH + ') \u00B7 ' + h.nombre.split(' ')[0] + '</span>' + chipHtml + '</span>' +
            '<span class="pp"></span></div>';
        }
      }

      const borderBot = isOpen ? '1px solid #e2e8f0' : 'none';
      buffersHtml += '<div style="border-left:6px solid ' + buf.hex + '; border-bottom:1px solid #222; background:#fff;">' +
        '<div onclick="window.toggleRackBufferUI(\'' + cur.id + '\', ' + b + ')" style="display:flex; align-items:center; justify-content:space-between; padding:5px 8px; background:#1a1a2e; cursor:pointer; user-select:none; border-bottom:' + borderBot + ';">' +
          '<span style="font-size:10px; font-weight:800; display:flex; align-items:center; gap:5px; color:#fff;">' +
            '<span style="font-size:9px;">' + (isOpen ? '\u25BC' : '\u25B6') + '</span>' +
            ' BUFFER ' + b + ' \u00B7 ' + buf.name.toUpperCase() +
          '</span>' +
          '<span style="font-size:8.5px; background:#000; color:#fff; padding:1px 5px; border-radius:2px; border:1px solid #555;">H' + start + '\u2013H' + end + '</span>' +
        '</div>' +
        (isOpen ? '<div>' + rowsHtml + '</div>' : '') +
      '</div>';
    }

    hilosDiv.innerHTML = buffersHtml;
    hilosDiv.style.border = '1px solid #000';

    // Re-apply session marks and redraw cables after modifying DOM
    if (typeof applySessionMarks === 'function') applySessionMarks();
    if (typeof redraw === 'function') setTimeout(redraw, 30);
  };

  // Hook into updateUI to apply our cleanup after each render
  const originalUpdateUI = window.updateUI;
  window.updateUI = function () {
    if (typeof originalUpdateUI === 'function') originalUpdateUI();
    setTimeout(aplicarLimpiezaUI, 50);
  };

  // Also hook into switchView to apply cleanup when switching views
  const originalSwitchView = window.switchView;
  window.switchView = function (v) {
    if (typeof originalSwitchView === 'function') originalSwitchView(v);
    setTimeout(aplicarLimpiezaUI, 80);
  };

  // Initial cleanup on load
  setTimeout(aplicarLimpiezaUI, 200);
'''

# Find the insertion point: right before `post('ready');`
INSERT_MARKER = "  post('ready');"
if INSERT_MARKER not in content:
    # Try with different spacing
    INSERT_MARKER = "post('ready');"

if INSERT_MARKER in content:
    content = content.replace(INSERT_MARKER, NEW_CODE + '\n' + INSERT_MARKER)
    print(f"✅ Inserted UI cleanup block ({len(NEW_CODE)} chars) before post('ready')")
else:
    print("❌ Could not find insertion point 'post(\"ready\")'")
    sys.exit(1)

with open(BRIDGE, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"✅ File saved: {BRIDGE}")
print(f"   Total size: {len(content)} bytes")
print("✅ Changes applied:")
print("   1. Remove 'COLOR EQUIPOS' from top bar")
print("   2. Move '+ GABINETE' to top toolbar")
print("   3. Hide redundant cabBar (single cabinet)")
print("   4. Fix overlapping save buttons")
print("   5. Hide help text in Rack left panel")
print("   6. Hide dynCabs (HUB OLT / Todos) in Papel Dinámico")
print("   7. Buffer grouping in Rack left panel (same visual as Papel Dinámico)")
print("   8. Override updateUI and switchView to apply cleanup after each render")
