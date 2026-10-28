(function () {
  'use strict';

  function post(type, payload) {
    window.parent.postMessage({ source: 'mapolt-pop-v25', type, payload }, window.location.origin);
  }

  function portLabel(port) {
    return String(port.etiqueta || `${port.direccion || 'PORT'} ${port.puerto_no || port.numero || ''}`).trim();
  }

  function deviceType(device) {
    const type = String(device.tipo || device.clase || '').toLowerCase();
    if (type === 'switches' || type === 'switch') return 'SWITCH';
    if (type === 'olt') return 'OLT';
    if (type === 'odf') return 'ODF';
    return 'SPLITTER';
  }

  function applyMapOltData(data) {
    const devices = Array.isArray(data.dispositivos) ? data.dispositivos : [];
    const ports = Array.isArray(data.puertos) ? data.puertos : [];
    const fibers = Array.isArray(data.hilos) ? data.hilos : [];
    const byDevice = new Map();
    devices.forEach((device) => byDevice.set(Number(device.id), device));

    cabinets = [{ id: 'mapolt', nombre: data.armario_nombre || 'Armario Map OLT', tipo: 'Rack de piso 19"', u: 42 }];
    currentCabId = 'mapolt';
    cables = [];
    const cableMap = new Map();
    fibers.forEach((fiber) => {
      const id = Number(fiber.cable_id);
      if (!id) return;
      if (!cableMap.has(id)) {
        cableMap.set(id, {
          id,
          nombre: fiber.cable || `Cable #${id}`,
          hilos: 0,
          cabId: 'mapolt',
          sub: fiber.cable_tipo && fiber.cable_tipo.nombre || '',
          mapolt: true,
          fibras: []
        });
      }
      const cable = cableMap.get(id);
      cable.hilos += 1;
      cable.fibras.push(fiber);
    });
    cables = Array.from(cableMap.values());

    equipmentData = devices.map((device, index) => {
      const type = deviceType(device);
      const catalog = (data.catalogos && data.catalogos[type.toLowerCase()]) || {};
      const props = catalog.propiedades || {};
      const outputCount = ports.filter((port) => Number(port.dispositivo_id) === Number(device.id) && String(port.direccion).toUpperCase() === 'OUT').length;
      const division = device.division || props.relacion_division || props.division || '';
      const ratio = Number(String(division).split('x')[1]) || outputCount || 8;
      return {
        id: Number(device.id),
        tipo: type,
        nombre: device.serie || `${type} #${device.id}`,
        tamano: type === 'ODF' ? 2 : 1,
        cabId: 'mapolt',
        etiqueta: device.nota || '',
        estado: device.estado || 'Implementado',
        clase: String(props.clase || '').toUpperCase() === 'AC' || props.cliente === true ? 'AC' : 'AF',
        ratio,
        loss: device.atenuacion_db == null ? null : Number(device.atenuacion_db),
        mapolt: true,
        mapoltTipoId: device.tipo_id || null,
        index
      };
    });

    EP.clear();
    const endpointForPort = new Map();
    ports.forEach((port) => {
      const device = byDevice.get(Number(port.dispositivo_id));
      if (!device) return;
      const type = deviceType(device);
      const label = portLabel(port);
      const endpoint = mkEp(Number(device.id), type, label, type === 'ODF' ? (port.cara || port.face || 'A') : null, { mapoltPortId: Number(port.id), mapoltPort: port });
      endpointForPort.set(Number(port.id), endpoint);
    });
    const endpointForFiber = new Map();
    fibers.forEach((fiber) => {
      const cable = cableMap.get(Number(fiber.cable_id));
      if (!cable) return;
      const index = Number(fiber.global || fiber.hilo_global_no || cable.fibras.indexOf(fiber) + 1);
      const endpoint = hiloEp({ id: cable.id, nombre: cable.nombre, hilos: cable.hilos }, index - 1);
      endpoint.extra.mapoltFibraId = Number(fiber.fibra_id);
      endpoint.extra.mapoltExtremo = fiber.extremo || null;
      endpointForFiber.set(Number(fiber.fibra_id), endpoint);
    });

    connections = [];
    connSeq = 0;
    (data.empalmes || []).forEach((empalme) => {
      const from = endpointForFiber.get(Number(empalme.fibra_a_id));
      const to = empalme.puerto_id
        ? endpointForPort.get(Number(empalme.puerto_id))
        : endpointForFiber.get(Number(empalme.fibra_b_id));
      if (!from || !to) return;
      connections.push({ id: Number(empalme.id) || ++connSeq, from, to, origin: false, mapoltId: empalme.id });
      connSeq = Math.max(connSeq, Number(empalme.id) || connSeq);
    });
    updateUI();
  }

  function notifyEquipment(payload) {
    post('equipment-add', payload);
  }

  const originalSaveEquipment = window.handleSaveEquipment;
  window.handleSaveEquipment = function (event) {
    const type = String(document.getElementById('eqTipo').value || '').toUpperCase();
    const payload = {
      tipo: type,
      nombre: document.getElementById('eqNombre').value.trim(),
      etiqueta: document.getElementById('eqEtiqueta').value.trim(),
      estado: document.getElementById('eqEstado').value,
      tamano: Number(document.getElementById('eqTamano').value || 1),
      clase: type === 'SPLITTER' ? document.getElementById('eqClase').value : null,
      ratio: type === 'SPLITTER' ? Number(document.getElementById('eqRatio').value) : null
    };
    notifyEquipment(payload);
    if (typeof originalSaveEquipment === 'function') originalSaveEquipment(event);
  };

  const originalTryConnect = window.tryConnect;
  window.tryConnect = function (from, to, asOrigin, options) {
    const result = originalTryConnect(from, to, asOrigin, options);
    if (result && result.ok) {
      const connection = result.conn || {};
      const actualFrom = connection.from || from;
      const actualTo = connection.to || to;
      post('connection-add', {
        from: actualFrom && actualFrom.extra,
        to: actualTo && actualTo.extra,
        fromType: actualFrom && actualFrom.type,
        toType: actualTo && actualTo.type,
        fromEqId: actualFrom && actualFrom.eqId,
        toEqId: actualTo && actualTo.eqId,
        fromPort: actualFrom && actualFrom.port,
        toPort: actualTo && actualTo.port
      });
    }
    return result;
  };

  window.openCableModal = function () {
    const options = cables.filter((cable) => cable.mapolt).map((cable) => (
      `<option value="${cable.id}">${escapeMatrixText(cable.nombre)} · ${cable.hilos} hilos</option>`
    )).join('');
    openDynModal(`<div class="modal" style="width:450px"><h2><span>Cable real de Map OLT</span><span style="cursor:pointer" onclick="closeDynModal()">✕</span></h2>
      <div class="bd"><div><label>Seleccione un cable ya existente</label>
      <select id="mapoltCableSelect">${options || '<option disabled>(este armario no tiene cables relacionados)</option>'}</select></div>
      <div style="font-size:10px;color:#555">Los cables se cargan desde Map OLT. El HTML v25 no crea cables ficticios.</div></div>
      <div class="ft"><button class="btn" id="kNo">CANCELAR</button><button class="btn dark" id="kOk">USAR CABLE</button></div></div>`);
    $('kNo').onclick = closeDynModal;
    $('kOk').onclick = () => {
      const selected = cableById($('mapoltCableSelect').value);
      if (!selected) return;
      currentCableId = selected.id;
      closeDynModal();
      updateUI();
      toast(`Cable real "${selected.nombre}" seleccionado.`);
    };
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const message = event.data || {};
    if (message.source !== 'mapolt-pop-v25-parent') return;
    if (message.type === 'init') applyMapOltData(message.payload || {});
  });

  post('ready');
  window.MapOltV25 = { applyMapOltData };
})();
