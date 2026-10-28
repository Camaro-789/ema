/**
 * Papel dinámico POP/nodo, basado visualmente en pop_gestor_v25.html.
 *
 * El lienzo usa el modelo visual de pop_gestor_v25.html, pero sus elementos
 * proceden del DTO real de Map OLT. Las conexiones se incorporan por fases.
 */
const FTTHPopPapel = (() => {
  let modal = null;
  let activeTab = 'rack';
  let zoom = 1;
  let lampOn = false;
  let torchDirection = null;
  let dragging = null;
  let current = null;
  let nodeData = null;
  let splitterTypes = [];
  let catalogTypes = {};
  let cablePositions = {};
  let connectionSelection = null;
  let v25Frame = null;
  let v25MessageBound = false;

  const esc = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'pop-papel-modal';
    modal.className = 'hidden';
    document.body.appendChild(modal);
    modal.addEventListener('click', event => {
      if (event.target === modal) cerrar();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modal && !modal.classList.contains('hidden')) cerrar();
    });
    return modal;
  }

  function tituloCategoria(categoria) {
    const cat = String(categoria || '').toLowerCase();
    return cat === 'armario' ? 'POP / ARMARIO' : (cat === 'cajanap' ? 'CAJA NAP' : 'MANGA');
  }

  function render() {
    const root = ensureModal();
    const title = current ? (current.tipoNombre || tituloCategoria(current.categoria)) : 'PAPEL DINÁMICO';
    const category = current ? tituloCategoria(current.categoria) : 'NODO';
    const soloPanelDinamico = ['cajanap', 'manga'].includes(String(current && current.categoria || '').toLowerCase());
    const esArmario = String(current && current.categoria || '').toLowerCase() === 'armario';
    if (soloPanelDinamico) activeTab = 'dyn';
    if (esArmario) {
      root.innerHTML = `
        <div class="pop-paper-v25-host" role="dialog" aria-modal="true" aria-label="POP HTML v25">
          <button type="button" class="pop-paper-v25-close" data-action="close">CERRAR</button>
          <iframe class="pop-paper-v25-frame" src="pop_gestor_v25.html?armario=${encodeURIComponent(current.id)}" title="POP gestor v25"></iframe>
        </div>`;
      root.querySelector('[data-action="close"]').addEventListener('click', cerrar);
      conectarV25(root.querySelector('.pop-paper-v25-frame'));
      return;
    }

    function conectarV25(frame) {
      v25Frame = frame;
      if (!v25MessageBound) {
        window.addEventListener('message', recibirMensajeV25);
        v25MessageBound = true;
      }
      frame.addEventListener('load', () => {
        const script = frame.contentDocument.createElement('script');
        script.src = `js/pop-v25-mapolt-bridge.js?v=202610271946`;
        frame.contentDocument.body.appendChild(script);
      }, { once: true });
    }

    async function prepararDatosV25() {
      const response = await fetch(apiUrl(`/api/elementos/${current.id}/nodo`), { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo cargar el armario para el HTML v25.');
      const nodo = await response.json();
      const catalogos = {};
      for (const categoria of ['olt', 'odf', 'switches', 'splitter']) {
        const tipos = window.FTTHTipos && window.FTTHTipos.getTipos
          ? await window.FTTHTipos.getTipos(categoria)
          : [];
        catalogTypes[categoria] = tipos;
        catalogos[categoria === 'switches' ? 'switch' : categoria] = tipos[0] || {};
      }
      return { ...nodo, armario_nombre: current.tipoNombre || `Armario #${current.id}`, catalogos };
    }

    async function enviarDatosV25() {
      if (!v25Frame || !v25Frame.contentWindow) return;
      const datos = await prepararDatosV25();
      v25Frame.contentWindow.postMessage({ source: 'mapolt-pop-v25-parent', type: 'init', payload: datos }, window.location.origin);
    }

    async function recibirMensajeV25(event) {
      if (!v25Frame || event.source !== v25Frame.contentWindow || event.origin !== window.location.origin) return;
      const message = event.data || {};
      if (message.source !== 'mapolt-pop-v25') return;
      try {
        if (message.type === 'ready') {
          await enviarDatosV25();
          return;
        }
        if (message.type === 'equipment-add') {
          await guardarEquipoV25(message.payload || {});
          await enviarDatosV25();
          return;
        }
        if (message.type === 'connection-add') {
          await guardarConexionV25(message.payload || {});
          await enviarDatosV25();
        }
      } catch (error) {
        mostrarAviso(error.message, 'error');
      }
    }

    async function guardarEquipoV25(payload) {
      const tipo = String(payload.tipo || '').toUpperCase();
      const categoria = tipo === 'SWITCH' ? 'switches' : tipo.toLowerCase();
      const tipos = catalogTypes[categoria] || [];
      const ratio = Number(payload.ratio) || 8;
      const plantilla = tipos.find(item => {
        const props = item.propiedades || {};
        const clase = String(props.clase || '').toUpperCase();
        const salidas = Number(props.salidas) || Number(String(props.relacion_division || '').split('x')[1]);
        return tipo !== 'SPLITTER' || (clase === String(payload.clase || '').toUpperCase() && salidas === ratio);
      }) || tipos[0];
      const body = {
        tipo: tipo === 'SWITCH' ? 'switch' : tipo.toLowerCase(),
        tipo_id: plantilla ? Number(plantilla.id) : null,
        division: tipo === 'SPLITTER' ? `1x${ratio}` : null,
        puertos_out: tipo === 'SPLITTER'
          ? ratio
          : Number((plantilla && plantilla.propiedades || {}).cantidad_puertos)
            || Number((plantilla && plantilla.propiedades || {}).puertos)
            || (tipo === 'OLT' ? 8 : 24),
        serie: payload.nombre || undefined,
        estado: payload.estado || 'Implementado',
      };
      const response = await fetch(apiUrl(`/api/elementos/${current.id}/dispositivos`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'No se pudo guardar el equipo del HTML v25.');
      mostrarAviso('Equipo guardado en Map OLT.', 'success');
      return data;
    }

    async function guardarConexionV25(payload) {
      const from = payload.from || {};
      const to = payload.to || {};
      const cable = from.mapoltFibraId ? from : to.mapoltFibraId ? to : null;
      const other = cable === from ? to : from;
      if (!cable || (!other.mapoltPortId && !other.mapoltFibraId)) {
        throw new Error('La conexión v25 no corresponde a un hilo y un puerto/hilo real de Map OLT.');
      }
      const body = {
        fibra_a_id: Number(cable.mapoltFibraId),
        extremo_a: cable.mapoltExtremo || 'A',
        puerto_id: other.mapoltPortId ? Number(other.mapoltPortId) : null,
        fibra_b_id: other.mapoltFibraId ? Number(other.mapoltFibraId) : null,
        extremo_b: other.mapoltExtremo || 'B',
        tipo: other.mapoltPortId ? 'conector' : 'paso',
        propiedades: { origen: 'pop_gestor_v25' },
      };
      const response = await fetch(apiUrl(`/api/elementos/${current.id}/empalmes`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'No se pudo guardar la conexión del HTML v25.');
      mostrarAviso('Conexión guardada en Map OLT.', 'success');
      return data;
    }
    root.innerHTML = `
      <div class="pop-paper-shell" role="dialog" aria-modal="true" aria-label="Papel dinámico">
        <header class="pop-paper-top">
          <div class="pop-paper-brand">
            <b>${esc(title)}</b>
            <small>${esc(category)} · DIAGRAMA VISUAL</small>
          </div>
          ${soloPanelDinamico ? '' : `
            <button type="button" class="pop-paper-tab ${activeTab === 'rack' ? 'is-active' : ''}" data-tab="rack">RACK 19"</button>
            <button type="button" class="pop-paper-tab ${activeTab === 'dyn' ? 'is-active' : ''}" data-tab="dyn">PANEL DINÁMICO</button>
            <button type="button" class="pop-paper-tab ${activeTab === 'matrix' ? 'is-active' : ''}" data-tab="matrix">MATRIZ</button>
          `}
          <div class="pop-paper-spacer"></div>
          <div class="pop-paper-top-actions">
            <button type="button" class="pop-paper-btn" data-action="lamp">VER COMUNICACIÓN</button>
            ${esArmario ? '<button type="button" class="pop-paper-btn is-dark" data-action="add-equipment">+ EQUIPO</button>' : ''}
            <button type="button" class="pop-paper-btn is-dark" data-action="close">CERRAR</button>
          </div>
        </header>
        <div class="pop-paper-body ${soloPanelDinamico ? 'is-dynamic-only' : ''}">
          ${soloPanelDinamico ? '' : `
            <aside class="pop-paper-side">
              <div class="pop-paper-side-head">${esArmario ? 'Cables · matriz' : 'Cables y elementos'}</div>
              <div class="pop-paper-side-list">${esArmario ? renderArmarioInventory() : '<div class="pop-paper-empty">Papel dinámico vacío.<br>Los cables, hilos, equipos y conexiones reales se cargarán en la siguiente fase.</div>'}</div>
              <div class="pop-paper-help">
                <b>Navegación:</b> cambia de vista, usa zoom y desplaza el panel dinámico.<br>
                <b>Linterna:</b> preparada para recorrer una trazabilidad real.
              </div>
            </aside>
          `}
          <main class="pop-paper-stage">
            ${renderTab(category)}
            ${esArmario ? '' : `<div class="pop-paper-bottom">
              <button type="button" class="pop-paper-btn pop-paper-lamp ${lampOn ? 'is-on' : ''}" data-action="lamp" title="Linterna">☼</button>
              <button type="button" class="pop-paper-btn pop-paper-tool ${torchDirection === 'left' ? 'is-active' : ''}" data-tool="torch-left" data-tooltip="Pasar luz hacia la izquierda" aria-label="Pasar luz hacia la izquierda">⇐</button>
              <button type="button" class="pop-paper-btn pop-paper-tool ${torchDirection === 'right' ? 'is-active' : ''}" data-tool="torch-right" data-tooltip="Pasar luz hacia la derecha" aria-label="Pasar luz hacia la derecha">⇒</button>
              <button type="button" class="pop-paper-btn" data-action="zoom-out" title="Alejar">−</button>
              <span class="pop-paper-btn" data-zoom-label>${Math.round(zoom * 100)}%</span>
              <button type="button" class="pop-paper-btn" data-action="zoom-in" title="Acercar">+</button>
              <span class="pop-paper-bottom-spacer"></span>
              <button type="button" class="pop-paper-btn pop-paper-tool" data-tool="cable-salida" data-tooltip="Agregar cable de salida" aria-label="Agregar cable de salida">⇤</button>
              <button type="button" class="pop-paper-btn pop-paper-tool" data-tool="cable-entrada" data-tooltip="Agregar cable de entrada" aria-label="Agregar cable de entrada">⇥</button>
              <span class="pop-paper-tool-divider"></span>
              <button type="button" class="pop-paper-btn pop-paper-tool" data-tool="splitter" data-tooltip="Agregar splitter" aria-label="Agregar splitter">◈</button>
              <button type="button" class="pop-paper-btn pop-paper-tool" data-tool="cortar" data-tooltip="Cortar elemento/splitter/fusión" aria-label="Cortar elemento, splitter o fusión">✂</button>
              <button type="button" class="pop-paper-btn pop-paper-tool" data-tool="fusion" data-tooltip="Agregar fusión" aria-label="Agregar fusión">⛓</button>
              <span class="pop-paper-tool-divider"></span>
              <button type="button" class="pop-paper-btn pop-paper-tool" data-tool="select" data-tooltip="Seleccionar" aria-label="Seleccionar">↖</button>
              <button type="button" class="pop-paper-btn pop-paper-tool is-danger" data-tool="delete" data-tooltip="Eliminar elemento" aria-label="Eliminar elemento">⌫</button>
              <span class="pop-paper-tool-divider"></span>
              <button type="button" class="pop-paper-btn pop-paper-tool" data-tool="undo" data-tooltip="Deshacer" aria-label="Deshacer">↶</button>
              <button type="button" class="pop-paper-btn pop-paper-tool" data-tool="redo" data-tooltip="Rehacer" aria-label="Rehacer">↷</button>
            </div>`}
          </main>
        </div>
      </div>`;
    bind();
    applyZoom();
    dibujarConexiones();
  }

  function renderTab(category) {
    if (activeTab === 'matrix') {
      return renderMatrix();
    }
    if (activeTab === 'dyn') {
      return `<section class="pop-paper-dyn" id="pop-paper-dyn">
        <div class="pop-paper-dyn-toolbar"><span>Arrastra para trazar · rueda = zoom · arrastra el fondo = mover la vista</span>
          <button type="button" class="pop-paper-btn" data-action="auto-layout">AUTO-ORDENAR</button></div>
        <div class="pop-paper-world" id="pop-paper-world">
          ${renderWorld(category)}
        </div>
      </section>`;
    }

    function renderWorld(category) {
      const devices = nodeData && Array.isArray(nodeData.dispositivos) ? nodeData.dispositivos : [];
      const cables = agruparCables();
      if (!devices.length && !cables.length) {
        return `<div class="pop-paper-world-note">${esc(category)}<br>Panel dinámico vacío preparado para conexiones reales.</div>`;
      }
      const deviceHtml = devices.map((device, index) => {
        const catalogType = splitterTypes.find(type => Number(type.id) === Number(device.tipo_id));
        const props = catalogType && catalogType.propiedades || {};
        const deviceType = String(device.tipo || '').toLowerCase();
        const visualType = deviceType === 'switch' ? 'SWITCH' : deviceType === 'olt' ? 'OLT' : deviceType === 'odf' ? 'ODF' : deviceType === 'splitter' ? 'SPLITTER' : String(device.tipo || 'EQUIPO').toUpperCase();
        const clase = String(props.clase || '').toUpperCase() === 'AC' || props.cliente === true ? 'AC' : 'AF';
        const division = device.division || props.relacion_division || 'sin división';
        const ports = (nodeData.puertos || []).filter(port => Number(port.dispositivo_id) === Number(device.id));
        const inputs = ports.filter(port => port.direccion === 'IN');
        const outputs = ports.filter(port => port.direccion === 'OUT');
        const rows = outputs.length || Number(device.puertos_out) || (visualType === 'OLT' ? 8 : visualType === 'SWITCH' ? 12 : visualType === 'ODF' ? 24 : 1);
        const input = inputs[0] || { direccion: 'IN', puerto_no: 1, estado: 'libre' };
        const position = nodeData.posiciones && nodeData.posiciones[device.id]
          ? nodeData.posiciones[device.id]
          : { x: 470 + (index % 2) * 290, y: 120 + Math.floor(index / 2) * 360 };
        const portRows = visualType === 'SPLITTER'
          ? Array.from({ length: rows }, (_, row) => `<div class="pop-paper-port-row">
              ${row === 0 ? `<span class="pop-paper-input-cell"><span>IN</span>${renderPort(input, 'left')}</span>` : '<span class="pop-paper-port-spacer"></span>'}
              <span class="pop-paper-port-label">OUT ${row + 1}</span>${renderPort(outputs[row] || { direccion: 'OUT', puerto_no: row + 1, estado: 'libre' }, 'right')}
            </div>`).join('')
          : Array.from({ length: rows }, (_, row) => `<div class="pop-paper-port-row">
              <span class="pop-paper-input-cell"><span>${visualType === 'OLT' ? (row < 8 ? 'PON' : 'UP') : visualType}</span></span>
              <span class="pop-paper-port-label">${visualType === 'OLT' ? (row < 8 ? `PON ${row + 1}` : `UP ${row - 7}`) : `P ${row + 1}`}</span>
              ${renderPort(outputs[row] || { direccion: 'OUT', puerto_no: row + 1, estado: 'libre' }, 'right')}
            </div>`).join('');
        return `<article class="pop-paper-device pop-paper-device--${visualType.toLowerCase()}" data-drag-item="device" data-item-id="${device.id}" style="left:${Number(position.x) || 0}px;top:${Number(position.y) || 0}px">
            <div class="pop-paper-device-head">
              <b>${esc(device.serie || `${visualType}${visualType === 'SPLITTER' ? ` 1x${rows}` : ''}`)}</b>
              <div class="pop-paper-device-actions">
                <button type="button" class="pop-paper-device-edit" data-edit-device="${device.id}" title="Editar etiqueta o anotación">✎</button>
                <button type="button" class="pop-paper-device-action" data-tool="cortar" title="Cortar">✂</button>
                <button type="button" class="pop-paper-device-action is-danger" data-tool="delete" title="Eliminar">×</button>
              </div>
              <small>${visualType}${visualType === 'SPLITTER' ? ` ${clase} 1:${rows}` : ''}<br>${device.atenuacion_db == null ? 'Sin pérdida' : `${device.atenuacion_db} dB`} · ${esc(division)}<br>Nodo #${esc(current.id)}<br>${device.estado === 'operativo' ? 'Implementado' : esc(device.estado || 'Implementado')}</small>
            </div>
            <div class="pop-paper-device-body">${portRows}</div>
          </article>`;
      }).join('');
      const cableHtml = cables.map((cable, index) => renderCable(cable, index)).join('');
      return `<svg class="pop-paper-connections" aria-hidden="true"></svg>${cableHtml}${deviceHtml}`;
    }

    function agruparCables() {
      const grupos = new Map();
      (nodeData && nodeData.hilos || []).forEach(hilo => {
        const id = Number(hilo.cable_id);
        if (!id) return;
        if (!grupos.has(id)) grupos.set(id, {
          id,
          nombre: hilo.cable || `Cable #${id}`,
          lado: hilo.lado === 'salida' ? 'salida' : 'entrada',
          fibras: [],
        });
        const grupo = grupos.get(id);
        grupo.fibras.push(hilo);
        if (hilo.lado === 'salida') grupo.lado = 'salida';
      });
      return Array.from(grupos.values());
    }

    function renderCable(cable, index) {
      const side = cable.lado === 'salida' ? 'salida' : 'entrada';
      const saved = cablePositions[cable.id];
      const x = saved ? saved.x : (side === 'entrada' ? 45 : 920);
      const y = saved ? saved.y : 110 + index * 190;
      const fibers = cable.fibras || [];
      const rows = fibers.slice(0, 24).map((fiber, row) => {
        const color = fiber.color_hex || '#94a3b8';
        const port = `${side === 'entrada' ? 'OUT' : 'IN'}-${fiber.global || row + 1}`;
        return `<div class="pop-paper-cable-row">
          <span class="pop-paper-cable-color" style="background:${esc(color)}"></span>
          <span>${esc(fiber.nombre || `Hilo ${fiber.global || row + 1}`)}</span>
          <span class="pop-paper-cable-port" data-port-type="cable" data-cable-id="${cable.id}" data-fibra-id="${fiber.fibra_id}" title="Punto de conexión ${esc(port)}"></span>
        </div>`;
      }).join('');
      const extra = fibers.length > 24 ? `<div class="pop-paper-cable-more">+${fibers.length - 24} hilos</div>` : '';
      return `<article class="pop-paper-cable pop-paper-cable--${side}" data-drag-item="cable" data-item-id="${cable.id}" style="left:${x}px;top:${y}px">
        <div class="pop-paper-cable-head">
          <b>▰ ${esc(cable.nombre)}</b>
          <small>CABLE REAL · ${fibers.length} HILOS · ${side.toUpperCase()}</small>
        </div>
        <div class="pop-paper-cable-body">${rows || '<span class="pop-paper-cable-empty">Sin hilos declarados</span>'}${extra}</div>
      </article>`;
    }

    function renderPort(port, side) {
      const state = String(port.estado || 'libre').toLowerCase();
      return `<span class="pop-paper-port ${side || ''} ${state !== 'libre' ? 'is-used' : ''}"
        data-port-type="device" data-port-id="${port.id || ''}" data-device-id="${port.dispositivo_id || ''}"
        title="${esc(port.etiqueta || `${port.direccion}-${port.puerto_no}`)}"><i></i></span>`;
    }
    return renderRack(category);
  }

  function renderRack(category) {
    const devices = nodeData && nodeData.dispositivos || [];
    const rows = devices.map((device, index) => {
      const type = String(device.tipo || device.tipo_nombre || 'EQUIPO').toUpperCase();
      return `<div class="pop-paper-rack-unit" data-drag-item="device" data-item-id="${device.id}">
        <span class="pop-paper-rack-u">${index + 1}U</span>
        <b>${esc(device.serie || type)}</b><small>${esc(device.division || 'Puertos y conexiones')}</small>
        <button type="button" data-edit-device="${device.id}">✎</button>
      </div>`;
    }).join('');
    return `<section class="pop-paper-view pop-paper-v25-rack"><div class="pop-paper-rackwrap">
      <div class="pop-paper-rack">
        <div class="pop-paper-rack-head"><b>▣ ${esc(category)}</b><small>${devices.length} equipos · ${(nodeData && nodeData.empalmes || []).length} conexiones</small></div>
        <div class="pop-paper-rack-slots">${rows || '<div class="pop-paper-rack-empty">RACK 19" VACÍO<br>Agrega OLT, ODF o Switch Core desde la MATRIZ.</div>'}</div>
      </div>
    </div></section>`;
  }

  function renderMatrix() {
    const devices = nodeData && nodeData.dispositivos || [];
    const cables = agruparCables();
    const rows = devices.map(device => `<div class="pop-paper-matrix-row"><b>${esc(device.serie || device.tipo || 'Equipo')}</b><span>${esc(device.division || 'Puertos')}</span><span>${device.estado || 'Implementado'}</span></div>`).join('');
    const cableRows = cables.map(cable => `<div class="pop-paper-matrix-row is-cable"><b>▰ ${esc(cable.nombre)}</b><span>${cable.fibras.length} hilos</span><span>${cable.lado.toUpperCase()}</span></div>`).join('');
    return `<section class="pop-paper-matrix"><div class="pop-paper-matrix-card">
      <div class="pop-paper-matrix-title"><div><h2>MATRIZ · EQUIPOS Y CABLES</h2><p>Los elementos agregados aquí se representan en el papel dinámico del POP.</p></div>
      <button type="button" class="pop-paper-btn is-dark" data-action="add-equipment">+ AGREGAR ELEMENTO</button></div>
      <div class="pop-paper-matrix-actions"><button type="button" class="pop-paper-btn" data-matrix-cable="entrada">+ CABLE DE ENTRADA</button><button type="button" class="pop-paper-btn" data-matrix-cable="salida">+ CABLE DE SALIDA</button></div>
      <div class="pop-paper-matrix-head"><span>Elemento</span><span>Puertos / hilos</span><span>Estado / lado</span></div>
      ${rows || '<div class="pop-paper-empty">No hay equipos instalados.</div>'}${cableRows || ''}
    </div></section>`;
  }

  function renderArmarioInventory() {
    const cablesById = new Map();
    (nodeData && nodeData.hilos || []).forEach(hilo => {
      const id = Number(hilo.cable_id);
      if (!id) return;
      if (!cablesById.has(id)) cablesById.set(id, { id, nombre: hilo.cable || `Cable #${id}`, lado: hilo.lado === 'salida' ? 'salida' : 'entrada', fibras: [] });
      const cable = cablesById.get(id);
      cable.fibras.push(hilo);
      if (hilo.lado === 'salida') cable.lado = 'salida';
    });
    const cables = Array.from(cablesById.values());
    const devices = nodeData && nodeData.dispositivos || [];
    const cableRows = cables.map(cable => `<div class="pop-paper-inventory-item">
      <span class="pop-paper-inventory-icon">▰</span><div><b>${esc(cable.nombre)}</b><small>${cable.fibras.length} hilos · ${cable.lado}</small></div>
      <button type="button" data-matrix-cable="${cable.lado}">↗</button></div>`).join('');
    const deviceRows = devices.map(device => `<div class="pop-paper-inventory-item">
      <span class="pop-paper-inventory-icon">▣</span><div><b>${esc(device.serie || device.tipo || 'Equipo')}</b><small>${esc(device.division || 'Puertos')}</small></div>
      <button type="button" data-tab="dyn">↗</button></div>`).join('');
    return `<div class="pop-paper-inventory-actions"><button type="button" class="pop-paper-btn" data-matrix-cable="entrada">+ CABLE</button><button type="button" class="pop-paper-btn" data-action="add-equipment">+ EQUIPO</button></div>
      ${cableRows || '<div class="pop-paper-empty">No hay cables en el POP.</div>'}
      ${deviceRows}`;
  }

  function agruparCables() {
    const grupos = new Map();
    (nodeData && nodeData.hilos || []).forEach(hilo => {
      const id = Number(hilo.cable_id);
      if (!id) return;
      if (!grupos.has(id)) grupos.set(id, {
        id,
        nombre: hilo.cable || `Cable #${id}`,
        lado: hilo.lado === 'salida' ? 'salida' : 'entrada',
        fibras: [],
      });
      const grupo = grupos.get(id);
      grupo.fibras.push(hilo);
      if (hilo.lado === 'salida') grupo.lado = 'salida';
    });
    return Array.from(grupos.values());
  }

  function bind() {
    modal.querySelectorAll('[data-tab]').forEach(button => {
      button.addEventListener('click', () => {
        activeTab = button.dataset.tab;
        render();
      });
    });
    modal.querySelectorAll('[data-action="close"]').forEach(button => button.addEventListener('click', cerrar));
    modal.querySelectorAll('[data-action="add-equipment"]').forEach(button => button.addEventListener('click', mostrarSelectorEquipo));
    modal.querySelectorAll('[data-matrix-cable]').forEach(button => button.addEventListener('click', () => mostrarSelectorCable(button.dataset.matrixCable)));
    modal.querySelectorAll('[data-edit-device]').forEach(button => button.addEventListener('click', () => editarDispositivo(button.dataset.editDevice)));
    modal.querySelectorAll('[data-port-type]').forEach(point => point.addEventListener('click', event => {
    event.stopPropagation();
    manejarPuntoConexion(point);
    }));
    modal.querySelectorAll('[data-action="lamp"]').forEach(button => button.addEventListener('click', () => {
      lampOn = !lampOn;
      button.classList.toggle('is-on', lampOn);
      dibujarConexiones();
      if (window.FTTHTipos && window.FTTHTipos.showToast) {
        window.FTTHTipos.showToast(lampOn ? 'Linterna visual activada; sin trazabilidad cargada.' : 'Linterna visual desactivada.', 'info');
      }
    }));
    modal.querySelectorAll('[data-action="zoom-in"]').forEach(button => button.addEventListener('click', () => setZoom(zoom + 0.1)));
    modal.querySelectorAll('[data-action="zoom-out"]').forEach(button => button.addEventListener('click', () => setZoom(zoom - 0.1)));
    modal.querySelectorAll('[data-action="empty-action"]').forEach(button => button.addEventListener('click', () => {
      if (window.FTTHTipos && window.FTTHTipos.showToast) {
        window.FTTHTipos.showToast('La acción visual queda preparada para la fase de conexiones reales.', 'info');
      }
    }));
    modal.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => {
      const tool = button.dataset.tool;
      const labels = {
        'cable-salida': 'Agregar cable de salida',
        'cable-entrada': 'Agregar cable de entrada',
        splitter: 'Agregar splitter',
        cortar: 'Cortar elemento, splitter o fusión',
        fusion: 'Agregar fusión',
        select: 'Seleccionar',
        delete: 'Eliminar elemento',
        undo: 'Deshacer',
        redo: 'Rehacer',
        'torch-left': 'Pasar luz hacia la izquierda',
        'torch-right': 'Pasar luz hacia la derecha',
      };
      if (tool === 'splitter') {
        mostrarSelectorSplitter();
        return;
      }
      if (tool === 'cable-entrada' || tool === 'cable-salida') {
        mostrarSelectorCable(tool === 'cable-salida' ? 'salida' : 'entrada');
        return;
      }
      if (tool === 'torch-left' || tool === 'torch-right') {
        torchDirection = torchDirection === tool.replace('torch-', '') ? null : tool.replace('torch-', '');
        modal.querySelectorAll('[data-tool="torch-left"], [data-tool="torch-right"]')
          .forEach(item => item.classList.toggle('is-active', item.dataset.tool === `torch-${torchDirection}`));
      }

      modal.querySelectorAll('[data-tool].is-active').forEach(item => item.classList.remove('is-active'));
      if (tool === 'cortar' || tool === 'delete') button.classList.add('is-active');
      if (tool === 'torch-left' || tool === 'torch-right') {
        modal.querySelectorAll(`[data-tool="torch-${torchDirection}"]`).forEach(item => item.classList.add('is-active'));
      }
      if (window.FTTHTipos && window.FTTHTipos.showToast) {
        window.FTTHTipos.showToast(`${labels[tool] || 'Herramienta'}: preparada para conexiones reales.`, 'info');
      }
    }));
    const world = modal.querySelector('#pop-paper-world');
    if (world) {
      world.addEventListener('wheel', event => {
        event.preventDefault();
        setZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1));
      }, { passive: false });
      world.addEventListener('pointerdown', event => {
        if (event.target.closest('[data-port-type]')) {
          event.stopPropagation();
          return;
        }
        const item = event.target.closest('[data-drag-item]');
        if (item && !event.target.closest('button, input, select, textarea, [data-port-type]')) {
          dragging = {
            kind: item.dataset.dragItem,
            id: Number(item.dataset.itemId),
            element: item,
            x: event.clientX,
            y: event.clientY,
            left: Number.parseFloat(item.style.left) || 0,
            top: Number.parseFloat(item.style.top) || 0,
          };
          item.classList.add('is-dragging');
          event.preventDefault();
          event.stopPropagation();
          world.setPointerCapture(event.pointerId);
          return;
        }
        dragging = { x: event.clientX, y: event.clientY, left: world.parentElement.scrollLeft, top: world.parentElement.scrollTop };
        world.setPointerCapture(event.pointerId);
      });
      world.addEventListener('pointermove', event => {
        if (!dragging) return;
        if (dragging.element) {
          const dx = (event.clientX - dragging.x) / zoom;
          const dy = (event.clientY - dragging.y) / zoom;
          const left = dragging.left + dx;
          const top = dragging.top + dy;
          dragging.element.style.left = `${left}px`;
          dragging.element.style.top = `${top}px`;
          if (dragging.kind === 'cable') cablePositions[dragging.id] = { x: left, y: top };
          event.preventDefault();
          return;
        }
        world.parentElement.scrollLeft = dragging.left - (event.clientX - dragging.x);
        world.parentElement.scrollTop = dragging.top - (event.clientY - dragging.y);
      });
      world.addEventListener('pointerup', () => {
        if (dragging && dragging.element) dragging.element.classList.remove('is-dragging');
        dragging = null;
      });
      world.addEventListener('pointercancel', () => {
        if (dragging && dragging.element) dragging.element.classList.remove('is-dragging');
        dragging = null;
      });
    }
  }

  function apiUrl(path) {
    return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
  }

  function editarDispositivo(deviceId) {
    const device = (nodeData && nodeData.dispositivos || []).find(item => String(item.id) === String(deviceId));
    if (!device) return;
    const editor = document.createElement('div');
    editor.className = 'pop-paper-note-picker';
    editor.innerHTML = `<b>Etiqueta / anotación</b><textarea maxlength="180">${esc(device.serie || '')}</textarea>
      <div><button type="button" data-note-cancel>Cancelar</button><button type="button" class="is-dark" data-note-save>Guardar</button></div>`;
    modal.querySelector('.pop-paper-shell').appendChild(editor);
    editor.querySelector('[data-note-cancel]').onclick = () => editor.remove();
    editor.querySelector('[data-note-save]').onclick = () => {
      const nota = editor.querySelector('textarea').value.trim();
      fetch(apiUrl(`/api/elementos/${current.id}/dispositivos/${deviceId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serie: nota }),
      }).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || 'No se pudo guardar la anotación.');
        device.serie = data.serie;
        editor.remove();
        render();
        mostrarAviso('Etiqueta/anotación guardada.', 'success');
      }).catch(error => mostrarAviso(error.message, 'error'));
    };
  }

  function mostrarSelectorSplitter() {
    if (!window.FTTHTipos || !window.FTTHTipos.getTipos) {
      mostrarAviso('No está disponible el catálogo de tipos de splitter.', 'error');
      return;
    }

    window.FTTHTipos.getTipos('splitter').then(tipos => {
      const disponibles = Array.isArray(tipos) ? tipos : [];
      const af = disponibles.filter(tipo => !esTipoAC(tipo));
      const ac = disponibles.filter(esTipoAC);
      if (!af.length && !ac.length) {
        mostrarAviso('No hay tipos de splitter. Créelos en Tipos de Objetos.', 'error');
        return;
      }
      const picker = document.createElement('div');
      picker.className = 'pop-paper-splitter-picker';
      modal.querySelector('.pop-paper-shell').appendChild(picker);
      const opciones = (grupo, titulo) => `
        <optgroup label="${titulo}">
          ${grupo.length ? grupo.map(tipo => `<option value="${tipo.id}">${esc(tipo.nombre_id)}${divisionTipo(tipo) ? ` · ${esc(divisionTipo(tipo))}` : ''}</option>`).join('') : '<option disabled>(sin tipos configurados)</option>'}
        </optgroup>`;
      picker.innerHTML = `<b>Agregar splitter al diagrama</b>
        <label>Modelo AC o AF</label>
        <select data-splitter-type>${opciones(af, 'SPLITTER AF · PRIMARIO')}${opciones(ac, 'SPLITTER AC · CLIENTES')}</select>
        <div class="pop-paper-picker-actions"><button type="button" data-splitter-cancel>Cancelar</button><button type="button" class="is-dark" data-splitter-add>Añadir</button></div>`;
      picker.querySelector('[data-splitter-cancel]').onclick = () => picker.remove();
      picker.querySelector('[data-splitter-add]').onclick = async () => {
        const tipoId = Number(picker.querySelector('[data-splitter-type]').value);
        if (!tipoId) return;
        try {
          const response = await fetch(apiUrl(`/api/elementos/${current.id}/dispositivos`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: 'splitter', tipo_id: tipoId }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.detail || 'No se pudo agregar el splitter.');
          picker.remove();
          await cargarNodo();
          mostrarAviso('Splitter agregado y guardado en la base de datos.', 'success');
        } catch (error) {
          mostrarAviso(error.message, 'error');
        }
      };
    }).catch(error => mostrarAviso(error.message || 'No se pudo cargar el catálogo de splitters.', 'error'));
  }

  function esTipoAC(tipo) {
    const props = tipo && tipo.propiedades || {};
    return String(props.clase || '').toUpperCase() === 'AC' || props.cliente === true;
  }

  async function actualizarCable(cableId, payload) {
    const response = await fetch(apiUrl(`/api/elementos/${cableId}`), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'No se pudo anclar el cable real.');
    return data;
  }

  async function dividirCable(cableId, item, lado) {
    const modo = window.confirm('El cable pasa por este nodo. ¿Desea sangrarlo en lugar de cortarlo?') ? 'sangrado' : 'corte';
    const response = await fetch(apiUrl(`/api/elementos/${current.id}/cables/${cableId}/dividir`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo, fibras: modo === 'sangrado' ? (item.fibras || []).map(fiber => fiber.id) : [], lado }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || 'No se pudo incorporar el cable real.');
    return data;
  }

  function mostrarSelectorCable(lado) {
    const candidatos = (nodeData && nodeData.cables_divisibles || []).filter(item => item && item.accion);
    const selector = document.createElement('div');
    selector.className = 'pop-paper-splitter-picker pop-paper-cable-picker';
    selector.innerHTML = `<b>Agregar cable de ${lado.toUpperCase()}</b><label>Seleccione un cable real existente</label>
      <select data-cable-id>${candidatos.map(item => `<option value="${item.cable_id}">${esc(item.nombre || `Cable #${item.cable_id}`)}</option>`).join('') || '<option disabled>(sin cables disponibles)</option>'}</select>
      <div class="pop-paper-picker-actions"><button type="button" data-cable-cancel>Cancelar</button><button type="button" class="is-dark" data-cable-add>Añadir</button></div>`;
    modal.querySelector('.pop-paper-shell').appendChild(selector);
    selector.querySelector('[data-cable-cancel]').onclick = () => selector.remove();
    selector.querySelector('[data-cable-add]').onclick = async () => {
      const id = Number(selector.querySelector('[data-cable-id]').value);
      const item = candidatos.find(candidate => Number(candidate.cable_id) === id);
      if (!item) return;
      selector.remove();
      try {
        if (item.accion === 'asignar_extremo') {
          const extremo = String(item.extremo || '').toUpperCase();
          const props = {};
          props[`lado_${extremo}`] = lado;
          await actualizarCable(id, extremo === 'A'
            ? { extremo_A_id: current.id, propiedades_instancia: props }
            : { extremo_B_id: current.id, propiedades_instancia: props });
        } else await dividirCable(id, item, lado);
        await cargarNodo();
        mostrarAviso(`Cable real agregado como ${lado}.`, 'success');
      } catch (error) { mostrarAviso(error.message, 'error'); }
    };
  }

  function mostrarSelectorEquipo() {
    const catalogos = ['olt', 'odf', 'switches', 'splitter'];
    const selector = document.createElement('div');
    selector.className = 'pop-paper-splitter-picker pop-paper-equipment-picker';
    const opciones = catalogos.flatMap(categoria => (catalogTypes[categoria] || []).map(tipo =>
      `<option value="${tipo.id}" data-categoria="${categoria}">${esc(tipo.nombre_id || tipo.nombre || categoria.toUpperCase())}</option>`)).join('');
    selector.innerHTML = `<b>Agregar equipo al POP</b><label>Tipo de objeto</label>
      <select data-equipment-type>${opciones || '<option disabled>(cree primero tipos OLT, ODF o Switches)</option>'}</select>
      <div class="pop-paper-picker-actions"><button type="button" data-equipment-cancel>Cancelar</button><button type="button" class="is-dark" data-equipment-add>Añadir</button></div>`;
    modal.querySelector('.pop-paper-shell').appendChild(selector);
    selector.querySelector('[data-equipment-cancel]').onclick = () => selector.remove();
    selector.querySelector('[data-equipment-add]').onclick = async () => {
      const option = selector.querySelector('[data-equipment-type] option:checked');
      if (!option || option.disabled) return;
      try {
        const response = await fetch(apiUrl(`/api/elementos/${current.id}/dispositivos`), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipo: option.dataset.categoria === 'switches' ? 'switch' : option.dataset.categoria,
            tipo_id: Number(option.value),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || 'No se pudo agregar el equipo.');
        selector.remove(); await cargarNodo(); mostrarAviso('Equipo agregado a la matriz y al rack.', 'success');
      } catch (error) { mostrarAviso(error.message, 'error'); }
    };
  }

  function divisionTipo(tipo) {
    const props = tipo && tipo.propiedades || {};
    return props.relacion_division || props.division || (props.entradas && props.salidas ? `${props.entradas}x${props.salidas}` : '');
  }

  function mostrarAviso(message, type) {
    if (window.FTTHTipos && window.FTTHTipos.showToast) window.FTTHTipos.showToast(message, type || 'info');
  }

  async function cargarNodo() {
    const [response, tipos, olt, odf, switches] = await Promise.all([
      fetch(apiUrl(`/api/elementos/${current.id}/nodo`), { cache: 'no-store' }),
      window.FTTHTipos && window.FTTHTipos.getTipos
        ? window.FTTHTipos.getTipos('splitter')
        : Promise.resolve([]),
      window.FTTHTipos && window.FTTHTipos.getTipos ? window.FTTHTipos.getTipos('olt') : Promise.resolve([]),
      window.FTTHTipos && window.FTTHTipos.getTipos ? window.FTTHTipos.getTipos('odf') : Promise.resolve([]),
      window.FTTHTipos && window.FTTHTipos.getTipos ? window.FTTHTipos.getTipos('switches') : Promise.resolve([]),
    ]);
    if (!response.ok) throw new Error('No se pudo cargar el diagrama del nodo.');
    nodeData = await response.json();
    splitterTypes = Array.isArray(tipos) ? tipos : [];
    catalogTypes = {
      olt: Array.isArray(olt) ? olt : [],
      odf: Array.isArray(odf) ? odf : [],
      switches: Array.isArray(switches) ? switches : [],
      splitter: Array.isArray(tipos) ? tipos : [],
    };
    render();
  }

  function setZoom(value) {
    zoom = Math.min(2.5, Math.max(0.25, value));
    applyZoom();
    dibujarConexiones();
  }

  function dibujarConexiones() {
    const world = modal && modal.querySelector('#pop-paper-world');
    const svg = world && world.querySelector('.pop-paper-connections');
    if (!world || !svg) return;
    svg.innerHTML = '';
    const worldRect = world.getBoundingClientRect();
    const scale = zoom || 1;
    const punto = element => {
      const rect = element.getBoundingClientRect();
      return {
        x: (rect.left - worldRect.left + rect.width / 2) / scale,
        y: (rect.top - worldRect.top + rect.height / 2) / scale,
      };
    };
    const crearLinea = (a, b, activa) => {
      if (!a || !b) return;
      const p1 = punto(a);
      const p2 = punto(b);
      const linea = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      linea.setAttribute('x1', p1.x);
      linea.setAttribute('y1', p1.y);
      linea.setAttribute('x2', p2.x);
      linea.setAttribute('y2', p2.y);
      linea.setAttribute('class', activa ? 'is-lit' : '');
      svg.appendChild(linea);
    };
    (nodeData && nodeData.empalmes || []).forEach(empalme => {
      const fibra = world.querySelector(`[data-port-type="cable"][data-fibra-id="${empalme.fibra_a_id}"]`);
      const puerto = empalme.puerto_id
        ? world.querySelector(`[data-port-type="device"][data-port-id="${empalme.puerto_id}"]`)
        : world.querySelector(`[data-port-type="cable"][data-fibra-id="${empalme.fibra_b_id}"]`);
      crearLinea(fibra, puerto, lampOn);
    });
    const label = modal && modal.querySelector('[data-zoom-label]');
    if (label) label.textContent = `${Math.round(zoom * 100)}%`;
  }

  function applyZoom() {
    const world = modal && modal.querySelector('#pop-paper-world');
    if (world) world.style.transform = `scale(${zoom})`;
  }

  function abrir(id, opciones = {}) {
    // Fase 1.4: con el interruptor apagado no se abre ningún diagrama.
    if (window.FTTH_FLAGS && window.FTTH_FLAGS.pop_v25_enabled === false) return;
    // Fase 5.1: el ARMARIO abre el módulo nativo (sin iframe ni puente).
    // Con POP_NATIVO_EN_ARMARIO=0 vuelve al puente de abajo, que sigue intacto.
    const esArmario = String(opciones.categoria || '').toLowerCase() === 'armario';
    if (esArmario
        && window.FTTH_FLAGS && window.FTTH_FLAGS.pop_nativo_en_armario !== false
        && window.POPNativo && typeof window.POPNativo.abrir === 'function') {
      window.POPNativo.abrir(id, {
        categoria: opciones.categoria,
        tipoNombre: opciones.tipoNombre,
      });
      return;
    }
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
  }

  function cerrar() {
    if (modal) modal.classList.add('hidden');
    dragging = null;
  }

  return { abrir, cerrar };
})();

window.FTTHPopPapel = FTTHPopPapel;
