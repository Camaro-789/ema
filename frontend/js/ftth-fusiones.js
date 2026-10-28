/**
 * ftth-fusiones.js
 * Motor de Fusión Óptica interactivo entre Hilos de Fibra y Puertos de Dispositivos (Splitters).
 *
 * Cumple estrictamente las reglas de negocio y diseño:
 *   1. La fusión transporta la potencia (dBm) del hilo al puerto del splitter y recalcula salidas.
 *   2. Representación visual bicolor mitad y mitad (linearGradient SVG) con LÍNEAS RECTAS (M + L, NUNCA curvas).
 *   3. Creación interactiva por arrastre libre 1:1 desde el punto del hilo hacia el puerto (radio 30px).
 *   4. Edición de forma con waypoints rectos, inserción al clic, snap suave a 8 direcciones (0°, 45°, 90°, etc.) y guía verde.
 *   5. Tooltips flotantes contextuales: «● Nombre_del_color (X.X dBm)».
 *   6. Historial y Deshacer con Ctrl+Z / Cmd+Z.
 *   7. Estados visuales: anillo verde punteado en hilos fusionados y potencia reflejada en el splitter.
 *   8. Serialización en JSON: [{ strandId, portId, waypoints: [{x,y}, ...] }, ...].
 */
const FTTHFusiones = (() => {

  const NS = 'http://www.w3.org/2000/svg';
  const SNAP_THRESHOLD = 12; // grados de umbral para snap
  const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];
  const PORT_TOLERANCE_PX = 30; // radio de tolerancia para soltar en puerto

  // Estado del diagrama actual
  let _fusions = []; // [ { strandId, portId, waypoints: [ {x,y}, ... ] } ]
  let _history = [];
  let _draggedWaypoint = null; // { fi: fusionIndex, wi: waypointIndex }
  let _pendingDrag = null; // { strandId, startPoint: {x,y} }
  let _dragChanged = false;
  let _enabled = true;
  let _tooltipEl = null;

  // ── Inicialización y DOM ──────────────────────────────────────────────────
  function ensureTooltip() {
    if (_tooltipEl && document.body.contains(_tooltipEl)) return _tooltipEl;
    _tooltipEl = document.createElement('div');
    _tooltipEl.id = 'ftth-fusion-tooltip';
    _tooltipEl.className = 'ftth-fusion-tooltip';
    _tooltipEl.style.cssText = `
      position: fixed; z-index: 130000; pointer-events: none;
      display: flex; align-items: center; gap: 7px;
      background: #1d1d1f; color: #ffffff; font-size: 11px; font-weight: 600;
      padding: 6px 11px; border-radius: 8px;
      opacity: 0; transform: translateY(4px);
      transition: opacity 0.15s ease, transform 0.15s ease;
      box-shadow: 0 6px 18px rgba(0,0,0,0.25); white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
    `;
    document.body.appendChild(_tooltipEl);
    return _tooltipEl;
  }

  function showTooltip(e, colorName, colorHex, dbm) {
    const tip = ensureTooltip();
    const dotStyle = (String(colorHex || '').toLowerCase() === '#ffffff')
      ? 'background:#fff; box-shadow:inset 0 0 0 1px #c7c7cc;'
      : `background:${colorHex || '#888'};`;
    let dbmStr = String(dbm != null ? dbm : '').trim();
    if (dbmStr.endsWith('dBm')) dbmStr = dbmStr.replace(/dBm/g, '').trim();
    const dbmText = dbmStr
      ? ` <span style="color:rgba(255,255,255,0.65); font-weight:500;">(${dbmStr} dBm)</span>`
      : ' <span style="color:rgba(255,255,255,0.65); font-weight:500;">(— dBm)</span>';

    tip.innerHTML = `<span style="width:9px; height:9px; border-radius:50%; flex-shrink:0; ${dotStyle}"></span>`
      + `<span>${escapeHtml(colorName || 'Puerto')}</span>`
      + dbmText;
    tip.style.opacity = '1';
    tip.style.transform = 'translateY(0)';
    moveTooltip(e);
  }

  function moveTooltip(e) {
    if (!_tooltipEl || _tooltipEl.style.opacity !== '1') return;
    const off = 16;
    let x = e.clientX + off, y = e.clientY + off;
    const r = _tooltipEl.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - off;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - off;
    _tooltipEl.style.left = x + 'px';
    _tooltipEl.style.top = y + 'px';
  }

  function hideTooltip() {
    if (_tooltipEl) {
      _tooltipEl.style.opacity = '0';
      _tooltipEl.style.transform = 'translateY(4px)';
    }
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pushHistory() {
    _history.push(JSON.parse(JSON.stringify(_fusions)));
    if (_history.length > 50) _history.shift();
  }

  function undo() {
    if (_history.length > 1) {
      _history.pop();
      _fusions = JSON.parse(JSON.stringify(_history[_history.length - 1]));
      renderFusions();
      propagarPotencias();
    }
  }

  // ── Coordenadas Relativas a #diag-body (Zoom/Pan Seguro) ───────────────────
  function bodyEl() { return document.getElementById('diag-body'); }

  function getZoom() {
    if (window.FTTHDiagrama && typeof window.FTTHDiagrama.vista === 'function') {
      return window.FTTHDiagrama.vista().k || 1;
    }
    return 1;
  }

  function coordsRelativeToBody(clientX, clientY) {
    const b = bodyEl();
    if (!b) return { x: clientX, y: clientY };
    const r = b.getBoundingClientRect();
    const k = getZoom();
    return {
      x: (clientX - r.left) / k,
      y: (clientY - r.top) / k,
    };
  }

  function elementCenterCoords(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return coordsRelativeToBody(r.left + r.width / 2, r.top + r.height / 2);
  }

  // ── Snap Suave a 8 Direcciones (Solo al Mover Waypoints) ───────────────────
  function softSnap(anchor, target) {
    const dx = target.x - anchor.x;
    const dy = target.y - anchor.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 5) return { x: target.x, y: target.y, snapped: false };

    let angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angleDeg < 0) angleDeg += 360;

    let bestAngle = null, bestDiff = SNAP_THRESHOLD;
    for (const a of DIRECTIONS) {
      let diff = Math.abs(angleDeg - a);
      if (diff > 180) diff = 360 - diff;
      if (diff < bestDiff) { bestDiff = diff; bestAngle = a; }
    }

    if (bestAngle !== null) {
      const rad = bestAngle * Math.PI / 180;
      return {
        x: anchor.x + Math.cos(rad) * dist,
        y: anchor.y + Math.sin(rad) * dist,
        snapped: true,
      };
    }
    return { x: target.x, y: target.y, snapped: false };
  }

  // ── Capa SVG Principal ────────────────────────────────────────────────────
  function ensureSvgLayer() {
    const b = bodyEl();
    if (!b) return null;
    let svg = document.getElementById('diag-fusions-svg');
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.id = 'diag-fusions-svg';
      svg.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; overflow:visible; z-index:15;';
      
      const defs = document.createElementNS(NS, 'defs');
      defs.id = 'diag-fusions-defs';
      svg.appendChild(defs);

      const gFusions = document.createElementNS(NS, 'g');
      gFusions.id = 'diag-fusions-paths';
      svg.appendChild(gFusions);

      const gIndicators = document.createElementNS(NS, 'g');
      gIndicators.id = 'diag-fusions-indicators';
      svg.appendChild(gIndicators);

      const guide = document.createElementNS(NS, 'line');
      guide.id = 'diag-fusions-guide';
      guide.setAttribute('stroke', '#4CAF50');
      guide.setAttribute('stroke-width', '1');
      guide.setAttribute('stroke-dasharray', '4 6');
      guide.setAttribute('opacity', '0');
      guide.setAttribute('pointer-events', 'none');
      svg.appendChild(guide);

      const pending = document.createElementNS(NS, 'path');
      pending.id = 'diag-fusions-pending';
      pending.setAttribute('fill', 'none');
      pending.setAttribute('stroke', '#0071e3');
      pending.setAttribute('stroke-width', '2.5');
      pending.setAttribute('stroke-dasharray', '6 4');
      pending.setAttribute('opacity', '0');
      pending.setAttribute('pointer-events', 'none');
      pending.setAttribute('stroke-linecap', 'round');
      svg.appendChild(pending);

      b.appendChild(svg);
    }
    return svg;
  }

  function getStrandElement(strandId, extremo, cableId) {
    const b = bodyEl();
    if (!b) return null;
    if (cableId && extremo) {
      const el = b.querySelector(`.strand[data-endpoint-key="cable_${cableId}:hilo_${strandId}:${extremo}"]`);
      if (el) return el;
    }
    if (extremo) {
      const el = b.querySelector(`.strand[data-hilo-id="${strandId}"][data-extremo="${extremo}"]`);
      if (el) return el;
    }
    return b.querySelector(`.strand[data-hilo-id="${strandId}"], .strand[data-hilo-global="${strandId}"]`);
  }

  function getPortElement(portId) {
    const b = bodyEl();
    if (!b) return null;
    return b.querySelector(`[data-puerto="${portId}"], [data-puerto-id="${portId}"]`);
  }

  function getStrandDotCoords(strandEl) {
    if (!strandEl) return null;
    const dot = strandEl.querySelector('.strand-dot') || strandEl;
    return elementCenterCoords(dot);
  }

  function getPortNodeCoords(portEl) {
    if (!portEl) return null;
    const nodo = portEl.querySelector('.pv-splitter__nodo, .pv-splitter__color, .diag-puerto') || portEl;
    return elementCenterCoords(nodo);
  }

  function getStrandColorInfo(strandEl, strandId) {
    if (strandEl) {
      const hex = strandEl.dataset.hex || strandEl.getAttribute('data-hex') || '#0071e3';
      const name = strandEl.dataset.color || strandEl.getAttribute('data-color') || 'Hilo ' + strandId;
      const dbmRaw = strandEl.dataset.dbm || strandEl.getAttribute('data-dbm') || '-3.5';
      const dbm = parseFloat(dbmRaw.replace(/[^\d.-]/g, '')) || -3.5;
      return { hex, name, dbm };
    }
    return { hex: '#0071e3', name: 'Hilo ' + strandId, dbm: -3.5 };
  }

  function getPortColorInfo(portEl, portId) {
    if (portEl) {
      const hex = portEl.dataset.hex || portEl.getAttribute('data-hex') || '#1d1d1f';
      const name = portEl.dataset.color || portEl.getAttribute('data-color') || 'Puerto ' + portId;
      return { hex, name };
    }
    return { hex: '#1d1d1f', name: 'Puerto ' + portId };
  }

  // ── Render de las Fusiones en el SVG ──────────────────────────────────────
  function renderFusions() {
    const svg = ensureSvgLayer();
    if (!svg) return;

    const defs = document.getElementById('diag-fusions-defs');
    const gPaths = document.getElementById('diag-fusions-paths');
    const gIndicators = document.getElementById('diag-fusions-indicators');
    if (!defs || !gPaths || !gIndicators) return;

    defs.innerHTML = '';
    gPaths.innerHTML = '';
    gIndicators.innerHTML = '';

    // Actualizar anillos verdes en hilos fusionados
    const allStrands = bodyEl()?.querySelectorAll('.strand') || [];
    allStrands.forEach(st => {
      const sid = st.dataset.hiloId || st.dataset.hiloGlobal;
      const isFused = _fusions.some(f => String(f.strandId) === String(sid));
      st.classList.toggle('strand--fused', isFused);
      
      // Anillo verde punteado alrededor del dot
      let ring = st.querySelector('.strand-fused-ring');
      if (isFused && !ring) {
        const dot = st.querySelector('.strand-dot');
        if (dot) {
          ring = document.createElementNS(NS, 'circle');
          ring.setAttribute('class', 'strand-fused-ring');
          ring.setAttribute('cx', dot.getAttribute('cx') || '0');
          ring.setAttribute('cy', dot.getAttribute('cy') || '0');
          ring.setAttribute('r', '11');
          ring.setAttribute('fill', 'none');
          ring.setAttribute('stroke', '#4CAF50');
          ring.setAttribute('stroke-width', '1.5');
          ring.setAttribute('stroke-dasharray', '3 3');
          ring.setAttribute('pointer-events', 'none');
          st.appendChild(ring);
        }
      } else if (!isFused && ring) {
        ring.remove();
      }
    });

    _fusions.forEach((fusion, fi) => {
      const strandEl = getStrandElement(fusion.strandId, fusion.extremo, fusion.cableId);
      if (!strandEl) return;
      const pStart = getStrandDotCoords(strandEl);
      if (!pStart) return;

      let pEnd = null;
      let colorPort = '#1d1d1f';

      if (fusion.portId) {
        const portEl = getPortElement(fusion.portId);
        if (!portEl) return;
        pEnd = getPortNodeCoords(portEl);
        colorPort = getPortColorInfo(portEl, fusion.portId).hex;
      } else if (fusion.strandBId) {
        const strandBEl = getStrandElement(fusion.strandBId, fusion.extremoB, fusion.cableBId);
        if (!strandBEl) return;
        pEnd = getStrandDotCoords(strandBEl);
        colorPort = getStrandColorInfo(strandBEl, fusion.strandBId).hex;
      }
      if (!pEnd) return;

      const colorStrand = getStrandColorInfo(strandEl, fusion.strandId).hex;

      // 1. Linear Gradient 50/50 Bicolor
      const targetId = fusion.portId ? `port-${fusion.portId}` : `strandB-${fusion.strandBId}`;
      const gradId = `fusionGrad-${fi}-${fusion.strandId}-${targetId}`;
      const grad = document.createElementNS(NS, 'linearGradient');
      grad.setAttribute('id', gradId);
      grad.setAttribute('gradientUnits', 'userSpaceOnUse');
      grad.setAttribute('x1', pStart.x);
      grad.setAttribute('y1', pStart.y);
      grad.setAttribute('x2', pEnd.x);
      grad.setAttribute('y2', pEnd.y);

      const stop1a = document.createElementNS(NS, 'stop');
      stop1a.setAttribute('offset', '0%');
      stop1a.setAttribute('stop-color', colorStrand);
      const stop1b = document.createElementNS(NS, 'stop');
      stop1b.setAttribute('offset', '50%');
      stop1b.setAttribute('stop-color', colorStrand);

      const stop2a = document.createElementNS(NS, 'stop');
      stop2a.setAttribute('offset', '50%');
      stop2a.setAttribute('stop-color', colorPort);
      const stop2b = document.createElementNS(NS, 'stop');
      stop2b.setAttribute('offset', '100%');
      stop2b.setAttribute('stop-color', colorPort);

      grad.appendChild(stop1a);
      grad.appendChild(stop1b);
      grad.appendChild(stop2a);
      grad.appendChild(stop2b);
      defs.appendChild(grad);

      // 2. Línea de Fusión: SIEMPRE RECTA (M + L, NUNCA curvas Q, C, A)
      let pathD = `M ${pStart.x},${pStart.y}`;
      (fusion.waypoints || []).forEach(wp => {
        pathD += ` L ${wp.x},${wp.y}`;
      });
      pathD += ` L ${pEnd.x},${pEnd.y}`;

      const line = document.createElementNS(NS, 'path');
      line.setAttribute('d', pathD);
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', `url(#${gradId})`);
      line.setAttribute('stroke-width', '3.5');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      line.setAttribute('pointer-events', 'none');
      gPaths.appendChild(line);

      // 3. Segmentos Clicables para Insertar Waypoint
      const allPoints = [pStart, ...(fusion.waypoints || []), pEnd];
      for (let i = 0; i < allPoints.length - 1; i++) {
        const pt1 = allPoints[i];
        const pt2 = allPoints[i + 1];

        const hit = document.createElementNS(NS, 'line');
        hit.setAttribute('x1', pt1.x);
        hit.setAttribute('y1', pt1.y);
        hit.setAttribute('x2', pt2.x);
        hit.setAttribute('y2', pt2.y);
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', '18');
        hit.setAttribute('cursor', 'crosshair');
        hit.setAttribute('pointer-events', 'stroke');

        const segIdx = i;
        const insertHandler = (e) => {
          // Si estamos en modo cortar/eliminar, o si se hace clic con botón derecho: cortar fusión
          if (window.FTTHFusiones && window.FTTHFusiones.isModoCortar && window.FTTHFusiones.isModoCortar()) {
            cortarFusionBackend(fusion);
            e.stopPropagation();
            e.preventDefault();
            return;
          }

          const clientX = e.touches ? e.touches[0].clientX : e.clientX;
          const clientY = e.touches ? e.touches[0].clientY : e.clientY;
          const pt = coordsRelativeToBody(clientX, clientY);

          const dx = pt2.x - pt1.x, dy = pt2.y - pt1.y;
          const len2 = dx * dx + dy * dy;
          let t = len2 === 0 ? 0 : ((pt.x - pt1.x) * dx + (pt.y - pt1.y) * dy) / len2;
          t = Math.max(0.05, Math.min(0.95, t));

          if (!fusion.waypoints) fusion.waypoints = [];
          fusion.waypoints.splice(segIdx, 0, { x: pt1.x + t * dx, y: pt1.y + t * dy });

          _draggedWaypoint = { fi, wi: segIdx };
          _dragChanged = true;
          renderFusions();
          e.stopPropagation();
          e.preventDefault();
        };

        hit.addEventListener('mousedown', insertHandler);
        hit.addEventListener('touchstart', insertHandler, { passive: false });
        hit.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (confirm('¿Cortar / eliminar esta fusión?')) {
            cortarFusionBackend(fusion);
          }
        });
        gPaths.appendChild(hit);
      }

      // 4. Indicadores de Waypoints Editables (Círculo blanco con borde verde)
      (fusion.waypoints || []).forEach((wp, wi) => {
        const ind = document.createElementNS(NS, 'circle');
        ind.setAttribute('cx', wp.x);
        ind.setAttribute('cy', wp.y);
        ind.setAttribute('r', '6');
        ind.setAttribute('fill', '#ffffff');
        ind.setAttribute('stroke', '#4CAF50');
        ind.setAttribute('stroke-width', '2');
        ind.setAttribute('class', `wp-indicator wp-${fi}-${wi}`);
        ind.setAttribute('pointer-events', 'none');
        ind.style.opacity = '0';
        ind.style.transition = 'opacity 0.15s';
        gIndicators.appendChild(ind);

        const hitWp = document.createElementNS(NS, 'circle');
        hitWp.setAttribute('cx', wp.x);
        hitWp.setAttribute('cy', wp.y);
        hitWp.setAttribute('r', '14');
        hitWp.setAttribute('fill', 'transparent');
        hitWp.setAttribute('cursor', 'grab');
        hitWp.setAttribute('pointer-events', 'all');

        const getIndEl = () => document.querySelector(`.wp-indicator.wp-${fi}-${wi}`);

        hitWp.addEventListener('mouseenter', () => {
          if (!_draggedWaypoint) {
            const el = getIndEl(); if (el) el.style.opacity = '1';
          }
        });
        hitWp.addEventListener('mouseleave', () => {
          if (!_draggedWaypoint || _draggedWaypoint.fi !== fi || _draggedWaypoint.wi !== wi) {
            const el = getIndEl(); if (el) el.style.opacity = '0';
          }
        });
        hitWp.addEventListener('mousedown', (e) => {
          _draggedWaypoint = { fi, wi };
          _dragChanged = false;
          const el = getIndEl(); if (el) el.style.opacity = '1';
          e.stopPropagation();
          e.preventDefault();
        });
        hitWp.addEventListener('touchstart', (e) => {
          _draggedWaypoint = { fi, wi };
          _dragChanged = false;
          const el = getIndEl(); if (el) el.style.opacity = '1';
          e.stopPropagation();
          e.preventDefault();
        }, { passive: false });

        gIndicators.appendChild(hitWp);
      });
    });
  }

  // ── Propagación de Potencia dBm ───────────────────────────────────────────
  function propagarPotencias() {
    const b = bodyEl();
    if (!b) return;

    // Resetear todos los splitters / puertos
    b.querySelectorAll('.pv-splitter').forEach(sp => {
      const inVal = sp.querySelector('.pv-splitter__in-val');
      if (inVal) inVal.textContent = '— dBm';
      const inPort = sp.querySelector('.pv-splitter__entrada');
      if (inPort) inPort.classList.remove('connected');

      sp.querySelectorAll('.pv-splitter__fila .pv-splitter__val').forEach(v => {
        v.textContent = '— dBm';
      });
    });

    _fusions.forEach(fusion => {
      const strandEl = getStrandElement(fusion.strandId);
      const portEl = getPortElement(fusion.portId);
      if (!strandEl || !portEl) return;

      const info = getStrandColorInfo(strandEl, fusion.strandId);
      const dbmEntrada = info.dbm;

      // Si es puerto de entrada del splitter
      const splitterEl = portEl.closest('.pv-splitter');
      if (splitterEl) {
        const inVal = splitterEl.querySelector('.pv-splitter__in-val');
        if (inVal) inVal.textContent = `${dbmEntrada.toFixed(2)} dBm`;

        const inPort = splitterEl.querySelector('.pv-splitter__entrada');
        if (inPort) inPort.classList.add('connected');

        // Calcular atenuación nominal (ej. -10.7 dB para 1x8)
        const atenuacion = 10.7;
        const dbmSalida = dbmEntrada - atenuacion;

        splitterEl.querySelectorAll('.pv-splitter__fila').forEach(fila => {
          const vals = fila.querySelectorAll('.pv-splitter__val');
          if (vals.length > 0) vals[0].textContent = `${dbmSalida.toFixed(2)} dBm`;
        });
      }
    });
  }

  function apiUrl(path) {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const origin = window.location.origin;
    if (origin && origin !== 'null' && !origin.includes('file://')) {
      return origin + (path.startsWith('/') ? path : '/' + path);
    }
    return 'http://127.0.0.1:8000' + (path.startsWith('/') ? path : '/' + path);
  }

  function mostrarAviso(msg, tipo) {
    if (window.FTTHTipos && typeof window.FTTHTipos.showToast === 'function') {
      window.FTTHTipos.showToast(msg, tipo || 'info');
    } else if (window.FTTHDiagrama && typeof window.FTTHDiagrama.aviso === 'function') {
      window.FTTHDiagrama.aviso(msg, tipo);
    } else {
      console.log(`[fusión ${tipo || 'info'}]`, msg);
    }
  }

  // ── Arrastre Inicial de Creación de Fusión ─────────────────────────────────
  function startPendingDrag(e, strandElOrId) {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    let strandEl = null;
    let strandId = null;
    let extremo = 'entrada';
    let cableId = '';
    let endpointKey = '';

    if (strandElOrId && strandElOrId.nodeType) {
      strandEl = strandElOrId.closest('.strand') || strandElOrId;
      strandId = strandEl.dataset.hiloId || strandEl.dataset.hiloGlobal;
      extremo = strandEl.dataset.extremo || 'entrada';
      cableId = strandEl.dataset.cableId || '';
      endpointKey = strandEl.dataset.endpointKey || `cable_${cableId}:hilo_${strandId}:${extremo}`;
    } else {
      strandId = strandElOrId;
      strandEl = getStrandElement(strandId);
      if (strandEl) {
        extremo = strandEl.dataset.extremo || 'entrada';
        cableId = strandEl.dataset.cableId || '';
        endpointKey = strandEl.dataset.endpointKey || `cable_${cableId}:hilo_${strandId}:${extremo}`;
      }
    }
    if (!strandEl) return;

    const colorInfo = getStrandColorInfo(strandEl, strandId);
    const pStart = getStrandDotCoords(strandEl);
    if (!pStart) return;

    _pendingDrag = {
      strandEl,
      strandId,
      extremo,
      cableId,
      endpointKey,
      startPoint: pStart,
      color: colorInfo.hex || '#0071e3',
      colorName: colorInfo.name || '',
    };
    _dragChanged = false;

    updatePendingLine(clientX, clientY);
    e.stopPropagation();
    e.preventDefault();
  }

  function updatePendingLine(clientX, clientY) {
    if (!_pendingDrag) return;
    const pt = coordsRelativeToBody(clientX, clientY);
    const pendingLine = document.getElementById('diag-fusions-pending');
    const guideLine = document.getElementById('diag-fusions-guide');
    const defs = document.getElementById('diag-fusions-defs');

    // Detectar si el cursor está sobre o cerca de un puerto o hilo destino
    const ports = bodyEl()?.querySelectorAll('[data-puerto], [data-puerto-id]') || [];
    let hoveredColor = null;
    let minHoverDist = PORT_TOLERANCE_PX;

    ports.forEach(p => {
      const pCoords = getPortNodeCoords(p);
      if (pCoords) {
        const d = Math.hypot(pCoords.x - pt.x, pCoords.y - pt.y);
        if (d < minHoverDist) {
          minHoverDist = d;
          const pid = p.dataset.puerto || p.dataset.puertoId;
          hoveredColor = getPortColorInfo(p, pid).hex;
        }
      }
    });

    if (!hoveredColor) {
      const strands = bodyEl()?.querySelectorAll('.strand') || [];
      strands.forEach(st => {
        const dotCoords = getStrandDotCoords(st);
        if (dotCoords) {
          const d = Math.hypot(dotCoords.x - pt.x, dotCoords.y - pt.y);
          if (d < minHoverDist) {
            const sKey = st.dataset.endpointKey;
            if (sKey !== _pendingDrag.endpointKey) {
              minHoverDist = d;
              const sid = st.dataset.hiloId || st.dataset.hiloGlobal;
              hoveredColor = getStrandColorInfo(st, sid).hex;
            }
          }
        }
      });
    }

    const colorOrigen = _pendingDrag.color || '#0071e3';

    if (pendingLine) {
      pendingLine.setAttribute('d', `M ${_pendingDrag.startPoint.x},${_pendingDrag.startPoint.y} L ${pt.x},${pt.y}`);
      pendingLine.style.opacity = '1';
      pendingLine.setAttribute('stroke-dasharray', '6 4');
      pendingLine.setAttribute('stroke-width', '3.5');

      if (hoveredColor && defs) {
        let pendingGrad = document.getElementById('diag-fusions-pending-grad');
        if (!pendingGrad) {
          pendingGrad = document.createElementNS(NS, 'linearGradient');
          pendingGrad.id = 'diag-fusions-pending-grad';
          pendingGrad.setAttribute('gradientUnits', 'userSpaceOnUse');
          defs.appendChild(pendingGrad);
        }
        pendingGrad.setAttribute('x1', _pendingDrag.startPoint.x);
        pendingGrad.setAttribute('y1', _pendingDrag.startPoint.y);
        pendingGrad.setAttribute('x2', pt.x);
        pendingGrad.setAttribute('y2', pt.y);
        pendingGrad.innerHTML = `
          <stop offset="0%" stop-color="${colorOrigen}" />
          <stop offset="50%" stop-color="${colorOrigen}" />
          <stop offset="50%" stop-color="${hoveredColor}" />
          <stop offset="100%" stop-color="${hoveredColor}" />
        `;
        pendingLine.setAttribute('stroke', 'url(#diag-fusions-pending-grad)');
      } else {
        pendingLine.setAttribute('stroke', colorOrigen);
      }
    }
    if (guideLine) guideLine.style.opacity = '0';
  }

  async function finishPendingDrag(clientX, clientY) {
    if (!_pendingDrag) return;
    const pt = coordsRelativeToBody(clientX, clientY);
    const pendingLine = document.getElementById('diag-fusions-pending');
    const guideLine = document.getElementById('diag-fusions-guide');

    if (pendingLine) pendingLine.style.opacity = '0';
    if (guideLine) guideLine.style.opacity = '0';

    const currentPending = _pendingDrag;
    _pendingDrag = null;

    // 1. Buscar puerto cercano (tolerancia)
    const ports = bodyEl()?.querySelectorAll('[data-puerto], [data-puerto-id]') || [];
    let closestPort = null;
    let minPortDist = PORT_TOLERANCE_PX;

    ports.forEach(p => {
      const pCoords = getPortNodeCoords(p);
      if (pCoords) {
        const d = Math.hypot(pCoords.x - pt.x, pCoords.y - pt.y);
        if (d < minPortDist) {
          minPortDist = d;
          closestPort = p;
        }
      }
    });

    // 2. Buscar otro hilo cercano (destino polimórfico hilo<->hilo)
    const strands = bodyEl()?.querySelectorAll('.strand') || [];
    let closestStrand = null;
    let minDistStrand = PORT_TOLERANCE_PX;

    strands.forEach(st => {
      const dotCoords = getStrandDotCoords(st);
      if (dotCoords) {
        const d = Math.hypot(dotCoords.x - pt.x, dotCoords.y - pt.y);
        if (d < minDistStrand) {
          const sKey = st.dataset.endpointKey;
          if (sKey !== currentPending.endpointKey) {
            minDistStrand = d;
            closestStrand = st;
          }
        }
      }
    });

    const nodoId = (window.FTTHDiagrama && typeof window.FTTHDiagrama.boxId === 'function')
      ? window.FTTHDiagrama.boxId()
      : null;

    if (!nodoId) {
      return;
    }

    let payload = null;
    let fusionObj = null;

    if (closestPort) {
      const portId = closestPort.dataset.puerto || closestPort.dataset.puertoId;
      payload = {
        fibra_a_id: Number(currentPending.strandId),
        extremo_a: currentPending.extremo || 'entrada',
        puerto_id: Number(portId),
        tipo: 'conector',
      };
      fusionObj = {
        strandId: Number(currentPending.strandId),
        extremo: currentPending.extremo || 'entrada',
        cableId: currentPending.cableId,
        portId: Number(portId),
        waypoints: [],
      };
    } else if (closestStrand) {
      const strandBId = closestStrand.dataset.hiloId || closestStrand.dataset.hiloGlobal;
      const extremoB = closestStrand.dataset.extremo || 'salida';
      const cableBId = closestStrand.dataset.cableId || '';
      payload = {
        fibra_a_id: Number(currentPending.strandId),
        extremo_a: currentPending.extremo || 'entrada',
        fibra_b_id: Number(strandBId),
        extremo_b: extremoB,
        tipo: 'paso',
      };
      fusionObj = {
        strandId: Number(currentPending.strandId),
        extremo: currentPending.extremo || 'entrada',
        cableId: currentPending.cableId,
        strandBId: Number(strandBId),
        extremoB: extremoB,
        cableBId: cableBId,
        waypoints: [],
      };
    }

    if (!payload) {
      return;
    }

    // Liberar empalme previo si este hilo o destino ya tenía uno activo en este nodo (reconexión limpia)
    const prevFusions = _fusions.filter(f =>
      (Number(f.strandId) === Number(currentPending.strandId) && String(f.extremo) === String(currentPending.extremo)) ||
      (Number(f.strandBId) === Number(currentPending.strandId) && String(f.extremoB) === String(currentPending.extremo))
    );
    for (const pf of prevFusions) {
      if (pf.id) {
        try {
          await fetch(apiUrl(`/api/elementos/${nodoId}/empalmes/${pf.id}`), { method: 'DELETE' });
        } catch (_) {}
      }
    }
    _fusions = _fusions.filter(f => !prevFusions.includes(f));

    try {
      const res = await fetch(apiUrl(`/api/elementos/${nodoId}/empalmes`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        mostrarAviso(data.detail || 'No se pudo crear la fusión', 'error');
        renderFusions();
        return;
      }

      fusionObj.id = data.id;
      _fusions.push(fusionObj);
      pushHistory();
      renderFusions();
      propagarPotencias();
      mostrarAviso('Fusión guardada', 'success');

      if (window.FTTHDiagrama && typeof window.FTTHDiagrama.marcarCambio === 'function') {
        window.FTTHDiagrama.marcarCambio('Fusión creada');
      }
    } catch (err) {
      console.error('Error persistiendo fusión:', err);
      mostrarAviso('Error de red al guardar la fusión', 'error');
    }
  }

  // ── Movimiento de Waypoints (con Snap Suave) ──────────────────────────────
  function onMove(clientX, clientY) {
    if (_pendingDrag) {
      updatePendingLine(clientX, clientY);
      return;
    }

    if (!_draggedWaypoint) return;

    const { fi, wi } = _draggedWaypoint;
    const fusion = _fusions[fi];
    if (!fusion || !fusion.waypoints || !fusion.waypoints[wi]) return;

    const strandEl = getStrandElement(fusion.strandId, fusion.extremo, fusion.cableId);
    let pEnd = null;
    if (fusion.portId) {
      const portEl = getPortElement(fusion.portId);
      if (portEl) pEnd = getPortNodeCoords(portEl);
    } else if (fusion.strandBId) {
      const strandBEl = getStrandElement(fusion.strandBId, fusion.extremoB, fusion.cableBId);
      if (strandBEl) pEnd = getStrandDotCoords(strandBEl);
    }
    if (!strandEl || !pEnd) return;

    const pStart = getStrandDotCoords(strandEl);
    const anchor = wi === 0 ? pStart : fusion.waypoints[wi - 1];

    const pt = coordsRelativeToBody(clientX, clientY);
    const result = softSnap(anchor, pt);

    const prev = fusion.waypoints[wi];
    if (Math.abs(prev.x - result.x) > 0.5 || Math.abs(prev.y - result.y) > 0.5) {
      _dragChanged = true;
    }

    fusion.waypoints[wi] = { x: result.x, y: result.y };
    renderFusions();

    const guideLine = document.getElementById('diag-fusions-guide');
    if (guideLine) {
      if (result.snapped) {
        guideLine.setAttribute('x1', anchor.x);
        guideLine.setAttribute('y1', anchor.y);
        guideLine.setAttribute('x2', result.x);
        guideLine.setAttribute('y2', result.y);
        guideLine.style.opacity = '1';
      } else {
        guideLine.style.opacity = '0';
      }
    }
  }

  function onUp(clientX, clientY) {
    if (_pendingDrag) {
      finishPendingDrag(clientX, clientY);
      return;
    }

    if (_draggedWaypoint) {
      if (_dragChanged) {
        pushHistory();
        const { fi } = _draggedWaypoint;
        const fusion = _fusions[fi];
        const nodoId = (window.FTTHDiagrama && typeof window.FTTHDiagrama.boxId === 'function')
          ? window.FTTHDiagrama.boxId()
          : null;
        if (fusion && fusion.id && nodoId) {
          fetch(apiUrl(`/api/elementos/${nodoId}/empalmes/${fusion.id}`), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ waypoints: fusion.waypoints || [] }),
          }).catch(err => console.warn('Error guardando waypoints:', err));
        }
      }
      const guideLine = document.getElementById('diag-fusions-guide');
      if (guideLine) guideLine.style.opacity = '0';
      _draggedWaypoint = null;
      _dragChanged = false;
    }
  }

  // ── Enlazar Eventos en el DOM ─────────────────────────────────────────────
  let _eventsBound = false;

  function bindEvents() {
    if (_eventsBound) return;

    window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', e => onUp(e.clientX, e.clientY));

    window.addEventListener('touchmove', e => {
      if (_pendingDrag || _draggedWaypoint) {
        onMove(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault();
      }
    }, { passive: false });

    window.addEventListener('touchend', e => {
      if (_pendingDrag || _draggedWaypoint) {
        const t = e.changedTouches[0];
        onUp(t.clientX, t.clientY);
        e.preventDefault();
      }
    }, { passive: false });

    // Deshacer con Ctrl+Z / Cmd+Z
    window.addEventListener('keydown', e => {
      const isUndo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z';
      if (!isUndo) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      e.preventDefault();
      undo();
    });

    _eventsBound = true;
  }

  // ── Enganchar Hilos y Puertos al Repintar el Diagrama ──────────────────────
  function attachDiagramElements() {
    const b = bodyEl();
    if (!b) return;

    // Inyectar estilos para iluminar si no existen
    if (!document.getElementById('diag-iluminar-styles')) {
      const st = document.createElement('style');
      st.id = 'diag-iluminar-styles';
      st.textContent = `
        .strand--iluminado path.strand-line, .strand--iluminado circle.strand-dot {
          stroke: #00ff66 !important;
          filter: drop-shadow(0 0 6px #00ff66) !important;
          stroke-width: 3.5px !important;
        }
        .puerto--iluminado {
          outline: 2px solid #00ff66 !important;
          box-shadow: 0 0 10px #00ff66 !important;
          background-color: rgba(0, 255, 102, 0.15) !important;
        }
      `;
      document.head.appendChild(st);
    }

    // 1. Enganchar hilos de fibra
    b.querySelectorAll('.strand').forEach(st => {
      const sid = st.dataset.hiloId || st.dataset.hiloGlobal;
      const info = getStrandColorInfo(st, sid);

      st.addEventListener('mouseenter', e => showTooltip(e, info.name, info.hex, info.dbm));
      st.addEventListener('mousemove', moveTooltip);
      st.addEventListener('mouseleave', hideTooltip);

      const dot = st.querySelector('.strand-dot') || st;
      dot.style.cursor = 'grab';

      dot.addEventListener('mousedown', e => startPendingDrag(e, st));
      dot.addEventListener('touchstart', e => {
        startPendingDrag(e, st);
        e.preventDefault();
      }, { passive: false });

      dot.addEventListener('dblclick', e => {
        e.stopPropagation();
        iluminarFibra(sid);
      });
    });

    // 2. Enganchar puertos de splitters
    b.querySelectorAll('[data-puerto], [data-puerto-id]').forEach(p => {
      const pid = p.dataset.puerto || p.dataset.puertoId;
      const info = getPortColorInfo(p, pid);

      p.addEventListener('mouseenter', e => {
        const fused = _fusions.find(f => String(f.portId) === String(pid));
        let dbm = null;
        if (fused) {
          const strandEl = getStrandElement(fused.strandId, fused.extremo, fused.cableId);
          dbm = getStrandColorInfo(strandEl, fused.strandId).dbm;
        }
        showTooltip(e, info.name, info.hex, dbm);
      });
      p.addEventListener('mousemove', moveTooltip);
      p.addEventListener('mouseleave', hideTooltip);
    });

    bindEvents();
    renderFusions();
    propagarPotencias();
  }

  // ── Trazabilidad Óptica (Iluminar) ────────────────────────────────────────
  async function iluminarFibra(fibraId) {
    if (!fibraId) return;
    limpiarIluminacion();
    try {
      const res = await fetch(apiUrl(`/api/fibras/${fibraId}/traza`));
      if (!res.ok) {
        mostrarAviso('No se pudo consultar la traza de la fibra', 'error');
        return;
      }
      const data = await res.json();
      const b = bodyEl();
      if (!b) return;

      // Resaltar hilo origen
      const origenEls = b.querySelectorAll(`.strand[data-hilo-id="${fibraId}"], .strand-dot[data-hilo-id="${fibraId}"]`);
      origenEls.forEach(el => el.classList.add('strand--iluminado'));

      if (Array.isArray(data.ramifica_a) && data.ramifica_a.length > 0) {
        // Ramificación del splitter: resaltar simultáneamente todas las salidas (las 8)
        data.ramifica_a.forEach(item => {
          if (item.puerto_id) {
            const pEl = b.querySelector(`[data-puerto="${item.puerto_id}"], [data-puerto-id="${item.puerto_id}"]`);
            if (pEl) pEl.classList.add('puerto--iluminado');
          }
          if (item.fibra_id) {
            const fEls = b.querySelectorAll(`.strand[data-hilo-id="${item.fibra_id}"], .strand-dot[data-hilo-id="${item.fibra_id}"]`);
            fEls.forEach(el => el.classList.add('strand--iluminado'));
          }
        });
        mostrarAviso(`✓ Traza activa: señal ramificada a ${data.ramifica_a.length} salidas`, 'success');
      } else if (Array.isArray(data.pasos) && data.pasos.length > 0) {
        data.pasos.forEach(p => {
          if (p.puerto && p.puerto.id) {
            const pEl = b.querySelector(`[data-puerto="${p.puerto.id}"], [data-puerto-id="${p.puerto.id}"]`);
            if (pEl) pEl.classList.add('puerto--iluminado');
          }
          if (p.conectado_a_fibra_id) {
            const fEls = b.querySelectorAll(`.strand[data-hilo-id="${p.conectado_a_fibra_id}"], .strand-dot[data-hilo-id="${p.conectado_a_fibra_id}"]`);
            fEls.forEach(el => el.classList.add('strand--iluminado'));
          }
        });
        mostrarAviso('✓ Traza de fibra activa', 'info');
      }
    } catch (err) {
      console.error('Error iluminando fibra:', err);
      mostrarAviso('Error de red al consultar traza', 'error');
    }
  }

  function limpiarIluminacion() {
    const b = bodyEl();
    if (!b) return;
    b.querySelectorAll('.strand--iluminado').forEach(el => el.classList.remove('strand--iluminado'));
    b.querySelectorAll('.puerto--iluminado').forEach(el => el.classList.remove('puerto--iluminado'));
  }

  let _modoCortar = false;

  async function cortarFusionBackend(fusion) {
    if (!fusion) return;
    const nodoId = (window.FTTHDiagrama && typeof window.FTTHDiagrama.boxId === 'function')
      ? window.FTTHDiagrama.boxId()
      : null;

    if (fusion.id && nodoId) {
      try {
        const res = await fetch(apiUrl(`/api/elementos/${nodoId}/empalmes/${fusion.id}`), { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          mostrarAviso(err.detail || 'No se pudo cortar la fusión', 'error');
          return;
        }
      } catch (err) {
        console.error('Error cortando fusión:', err);
        mostrarAviso('Error de red al cortar fusión', 'error');
        return;
      }
    }

    _fusions = _fusions.filter(f => f !== fusion && f.id !== fusion.id);
    pushHistory();
    renderFusions();
    propagarPotencias();
    mostrarAviso('Fusión cortada', 'info');

    if (window.FTTHDiagrama && typeof window.FTTHDiagrama.marcarCambio === 'function') {
      window.FTTHDiagrama.marcarCambio('Fusión cortada');
    }
  }

  function isModoCortar() {
    return _modoCortar;
  }

  function cargarFusiones(fusiones) {
    _fusions = Array.isArray(fusiones) ? JSON.parse(JSON.stringify(fusiones)) : [];
    renderFusions();
    return _fusions;
  }

  function obtenerFusiones() {
    return JSON.parse(JSON.stringify(_fusions));
  }

  function limpiarTodo() {
    _fusions = [];
    renderFusions();
  }

  async function eliminarFusion(fusion) {
    if (!fusion) return;
    await cortarFusionBackend(fusion);
  }

  function toggleModoCortar(val) {
    _modoCortar = (val !== undefined) ? !!val : !_modoCortar;
    return _modoCortar;
  }

  return {
    attachDiagramElements,
    renderFusions,
    propagarPotencias,
    cargarFusiones,
    obtenerFusiones,
    eliminarFusion,
    limpiarTodo,
    undo,
    iluminarFibra,
    limpiarIluminacion,
    cortarFusionBackend,
    isModoCortar,
    toggleModoCortar,
  };

})();

window.FTTHFusiones = FTTHFusiones;
