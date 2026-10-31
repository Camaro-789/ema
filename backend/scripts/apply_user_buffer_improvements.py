import sys
import re
sys.stdout.reconfigure(encoding='utf-8')

# 1. Update frontend/js/pop-v25-mapolt-bridge.js
bridge_path = 'frontend/js/pop-v25-mapolt-bridge.js'
with open(bridge_path, 'r', encoding='utf-8') as f:
    bridge = f.read()

# Make scrollbars completely hidden/transparent
bridge = bridge.replace(
    '''      * {
        scrollbar-width: thin !important;
        scrollbar-color: rgba(0, 0, 0, 0.25) transparent !important;
      }
      ::-webkit-scrollbar {
        width: 4px !important;
        height: 0px !important;
      }
      ::-webkit-scrollbar-track {
        background: transparent !important;
      }
      ::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.25) !important;
        border-radius: 4px !important;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 0, 0, 0.5) !important;
      }''',
    '''      * {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }
      ::-webkit-scrollbar {
        display: none !important;
        width: 0px !important;
        height: 0px !important;
      }'''
)

# In Matriz: all buffers start collapsed by default, and continuous border-left on outer buffer block
old_matriz_buf = '''        const isBufferOpen = window.matrixOpenBuffers.size === 0 ? b === 1 : window.matrixOpenBuffers.has(key);
        if (window.matrixOpenBuffers.size === 0 && b === 1) window.matrixOpenBuffers.add(key);

        const start = (b - 1) * bufferSize + 1;
        const end = Math.min(b * bufferSize, k.hilos);

        let portsInBuf = '';
        let enlacesEnBuf = 0;
        if (isBufferOpen) {
          for (let i = start - 1; i < end; i++) {
            const h = window.hiloInfo(k, i);
            const ep = hiloEp(k, i);
            if (typeof connOf === 'function' && connOf(ep)) enlacesEnBuf++;
            portsInBuf += matrixPort(ep, `Hilo ${i + 1} (B${String(b).padStart(2,'0')}-H${String((i%12)+1).padStart(2,'0')}) · ${h.nombre.split(' ')[0]}`, h.hex);
          }
        }

        buffersHtml += `
          <div style="border-top: 1.5px solid #334155; border-bottom: 1.5px solid #334155; margin-bottom: -1.5px;">
            <div class="mx-buffer-header" onclick="window.toggleMatrixBufferUI(this, '${k.id}', ${b})" style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#f8fafc; border-left: 6px solid ${buf.hex}; cursor:pointer; user-select:none; transition:background 0.15s;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="width:10px; height:10px; border-radius:2px; background:${buf.hex}; border:1px solid rgba(0,0,0,0.2);"></span>
                <span style="font-family:var(--mono); font-weight:800; font-size:11px;">BUFFER ${b} · ${buf.name.toUpperCase()}</span>
                <span style="font-size:9.5px; font-family:var(--mono); background:#e2e8f0; padding:2px 6px; border-radius:10px; color:#475569; font-weight:700;">Hilos ${start} a ${end}</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="mx-status ${enlacesEnBuf > 0 ? '' : 'free'}">${enlacesEnBuf > 0 ? enlacesEnBuf + ' ENLACE(S)' : '12 LIBRES'}</span>
                <span style="font-size:10px; color:#64748b; font-family:var(--mono); font-weight:800;">${isBufferOpen ? '▲' : '▼'}</span>
              </div>
            </div>
            ${isBufferOpen ? `<div class="mx-device-ports">${portsInBuf}</div>` : ''}
          </div>
        `;'''

new_matriz_buf = '''        // Todos los buffers inician contraídos por defecto
        const isBufferOpen = window.matrixOpenBuffers.has(key);

        const start = (b - 1) * bufferSize + 1;
        const end = Math.min(b * bufferSize, k.hilos);

        let portsInBuf = '';
        let enlacesEnBuf = 0;
        if (isBufferOpen) {
          for (let i = start - 1; i < end; i++) {
            const h = window.hiloInfo(k, i);
            const ep = hiloEp(k, i);
            if (typeof connOf === 'function' && connOf(ep)) enlacesEnBuf++;
            portsInBuf += matrixPort(ep, `Hilo ${i + 1} (B${String(b).padStart(2,'0')}-H${String((i%12)+1).padStart(2,'0')}) · ${h.nombre.split(' ')[0]}`, h.hex);
          }
        }

        // Franja continua de 6px del color del buffer que cubre cabecera y cuerpo
        buffersHtml += `
          <div style="border-left: 6px solid ${buf.hex}; border-top: 1.5px solid #334155; border-bottom: 1.5px solid #334155; margin-bottom: -1.5px; background: #fff;">
            <div class="mx-buffer-header" onclick="window.toggleMatrixBufferUI(this, '${k.id}', ${b})" style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#f8fafc; cursor:pointer; user-select:none; transition:background 0.15s; border-bottom: ${isBufferOpen ? '1px solid #e2e8f0' : 'none'};">
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="width:10px; height:10px; border-radius:2px; background:${buf.hex}; border:1px solid rgba(0,0,0,0.2);"></span>
                <span style="font-family:var(--mono); font-weight:800; font-size:11px;">BUFFER ${b} · ${buf.name.toUpperCase()}</span>
                <span style="font-size:9.5px; font-family:var(--mono); background:#e2e8f0; padding:2px 6px; border-radius:10px; color:#475569; font-weight:700;">Hilos ${start} a ${end}</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="mx-status ${enlacesEnBuf > 0 ? '' : 'free'}">${enlacesEnBuf > 0 ? enlacesEnBuf + ' ENLACE(S)' : '12 LIBRES'}</span>
                <span style="font-size:10px; color:#64748b; font-family:var(--mono); font-weight:800;">${isBufferOpen ? '▲' : '▼'}</span>
              </div>
            </div>
            ${isBufferOpen ? `<div class="mx-device-ports" style="border-left: none;">${portsInBuf}</div>` : ''}
          </div>
        `;'''

bridge = bridge.replace(old_matriz_buf, new_matriz_buf)

# In Papel Dinamico (v25 iframe): all buffers collapsed by default + continuous left border + no cutoff
old_dyn_buf = '''        const isBufferOpen = window.dynOpenBuffers.size === 0 ? b === 1 : window.dynOpenBuffers.has(key);
        if (window.dynOpenBuffers.size === 0 && b === 1) window.dynOpenBuffers.add(key);

        const start = (b - 1) * bufferSize + 1;
        const end = Math.min(b * bufferSize, k.hilos);

        let rowsInBuf = '';
        if (isBufferOpen) {
          for (let i = start - 1; i < end; i++) {
            const h = window.hiloInfo(k, i);
            const ep = hiloEp(k, i);
            const padB = String(b).padStart(2, '0');
            const padH = String((i % 12) + 1).padStart(2, '0');
            rowsInBuf += `<div class="drow"><span class="sw" style="background:${h.hex}"></span><span class="lbl">H${i + 1} (B${padB}-H${padH}) · ${h.nombre.split(' ')[0]}</span>${dport(ep, 'right')}</div>`;
          }
        }

        buffersHtml += `
          <div style="border-top:1.5px solid #000; border-bottom:1.5px solid #000; margin-bottom:-1.5px;">
            <div class="dtubo-head" onclick="window.toggleDynBufferUI(this, '${k.id}', ${b})" style="display:flex; align-items:center; justify-content:space-between; padding:5px 9px; background:#f1f5f9; border-left:6px solid ${buf.hex}; cursor:pointer; user-select:none;">
              <span style="font-family:var(--mono); font-size:10px; font-weight:800; display:flex; align-items:center; gap:5px;">
                <span style="font-size:9px;">${isBufferOpen ? '▼' : '▶'}</span>
                BUFFER ${b} · ${buf.name.toUpperCase()}
              </span>
              <span style="font-size:8.5px; font-family:var(--mono); background:#000; color:#fff; padding:1px 5px; border-radius:2px;">H${start}–H${end}</span>
            </div>
            ${isBufferOpen ? rowsInBuf : ''}
          </div>
        `;'''

new_dyn_buf = '''        // Todos los buffers inician contraídos por defecto
        const isBufferOpen = window.dynOpenBuffers.has(key);

        const start = (b - 1) * bufferSize + 1;
        const end = Math.min(b * bufferSize, k.hilos);

        let rowsInBuf = '';
        if (isBufferOpen) {
          for (let i = start - 1; i < end; i++) {
            const h = window.hiloInfo(k, i);
            const ep = hiloEp(k, i);
            const padB = String(b).padStart(2, '0');
            const padH = String((i % 12) + 1).padStart(2, '0');
            rowsInBuf += `<div class="drow" style="background:#fff;"><span class="sw" style="background:${h.hex}"></span><span class="lbl">H${i + 1} (B${padB}-H${padH}) · ${h.nombre.split(' ')[0]}</span>${dport(ep, 'right')}</div>`;
          }
        }

        // Franja continua de 6px con el color del buffer en todo el costado izquierdo (cabecera + hilos)
        buffersHtml += `
          <div class="pop-paper-buffer-block" style="border-left:6px solid ${buf.hex}; border-top:1.5px solid #000; border-bottom:1.5px solid #000; margin-bottom:-1.5px; background:#fff;">
            <div class="dtubo-head" onclick="window.toggleDynBufferUI(this, '${k.id}', ${b})" style="display:flex; align-items:center; justify-content:space-between; padding:5px 9px; background:#f1f5f9; cursor:pointer; user-select:none; border-bottom:${isBufferOpen ? '1px solid #e2e8f0' : 'none'};">
              <span style="font-family:var(--mono); font-size:10px; font-weight:800; display:flex; align-items:center; gap:5px;">
                <span style="font-size:9px;">${isBufferOpen ? '▼' : '▶'}</span>
                BUFFER ${b} · ${buf.name.toUpperCase()}
              </span>
              <span style="font-size:8.5px; font-family:var(--mono); background:#000; color:#fff; padding:1px 5px; border-radius:2px;">H${start}–H${end}</span>
            </div>
            ${isBufferOpen ? `<div class="buffer-rows-wrap" style="background:#fff;">${rowsInBuf}</div>` : ''}
          </div>
        `;'''

bridge = bridge.replace(old_dyn_buf, new_dyn_buf)

# Adapt bodyWrapper so it never cuts off buffers and adapts completely
old_dyn_wrapper = '''        nodeEl.appendChild(dhead);
        nodeEl.style.width = '242px'; // Espacio suficiente para textos y puertos
        const bodyWrapper = document.createElement('div');
        if (numBuffers <= 1) {
          // Si es un solo buffer, sin barras de scroll: tamaño natural
          bodyWrapper.style.maxHeight = 'none';
          bodyWrapper.style.overflow = 'visible';
        } else {
          // Si tiene más buffers, scroll vertical suave y delgado, sin horizontal
          bodyWrapper.style.maxHeight = '420px';
          bodyWrapper.style.overflowY = 'auto';
          bodyWrapper.style.overflowX = 'hidden';
        }
        bodyWrapper.innerHTML = buffersHtml;
        nodeEl.appendChild(bodyWrapper);'''

new_dyn_wrapper = '''        nodeEl.appendChild(dhead);
        nodeEl.style.width = '246px';
        const bodyWrapper = document.createElement('div');
        // El contenedor se expande completamente hacia abajo para mostrar todo el buffer seleccionado sin cortes
        bodyWrapper.style.maxHeight = 'none';
        bodyWrapper.style.overflow = 'visible';
        bodyWrapper.innerHTML = buffersHtml;
        nodeEl.appendChild(bodyWrapper);'''

bridge = bridge.replace(old_dyn_wrapper, new_dyn_wrapper)

with open(bridge_path, 'w', encoding='utf-8') as f:
    f.write(bridge)
print("Updated pop-v25-mapolt-bridge.js successfully!")

# 2. Update frontend/js/ftth-pop-papel.js (Cajas NAP y Mangas)
pop_path = 'frontend/js/ftth-pop-papel.js'
with open(pop_path, 'r', encoding='utf-8') as f:
    pop_code = f.read()

# Replace buffer rendering in renderCable to have continuous left border on block and all collapsed by default
old_pop_render = '''          const isCollapsed = b > 0; // Buffer 1 abierto por defecto

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
          `;'''

new_pop_render = '''          // Todos los buffers inician contraídos por defecto
          const isCollapsed = true;

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
          `;'''

pop_code = pop_code.replace(old_pop_render, new_pop_render)

# Remove any max-height so it expands down naturally
pop_code = re.sub(
    r'<div class="pop-paper-cable-body"[^>]*>',
    '<div class="pop-paper-cable-body" style="max-height:none; overflow:visible;">',
    pop_code
)

with open(pop_path, 'w', encoding='utf-8') as f:
    f.write(pop_code)
print("Updated ftth-pop-papel.js successfully!")

# 3. Update frontend/css/pop-papel-dinamico.css
css_path = 'frontend/css/pop-papel-dinamico.css'
with open(css_path, 'r', encoding='utf-8') as f:
    css_content = f.read()

# Make scrollbars completely hidden in pop-papel-dinamico.css
css_content = css_content.replace(
    '''/* Scrollbars delgadas y transparentes */
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
}''',
    '''/* Scrollbars completamente invisibles */
.pop-paper-cable-body {
    max-height: none !important;
    overflow: visible !important;
    scrollbar-width: none !important;
}
.pop-paper-cable-body::-webkit-scrollbar {
    display: none !important;
    width: 0px !important;
    height: 0px !important;
}'''
)

with open(css_path, 'w', encoding='utf-8') as f:
    f.write(css_content)
print("Updated pop-papel-dinamico.css successfully!")
