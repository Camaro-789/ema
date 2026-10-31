(function () {
  'use strict';

  function post(type, payload, requestId) {
    window.parent.postMessage({
      source: 'mapolt-pop-v25', type, payload, requestId: requestId || null,
    }, window.location.origin);
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

  /* ── Traducción extremo del HTML v25 → IDs reales de Map OLT ───────────────
     El HTML v25 vuelve a crear sus extremos con `mkEp(...)` cada vez que se
     redibuja (y lo hace SIN el `extra` que traía el puente). Por eso los IDs no
     se pueden leer de `ep.extra`: se resuelven aquí, contra los puertos y los
     hilos que devolvió el servidor, usando la etiqueta que pinta el v25
     («PON 1», «SFP+ 1», «OUT 2», «Hilo 7», «ODF 3 cara A»…).
     Sin esto, el POST viajaba con `from/to` vacíos y el backend guardaba 0.  */
  function normalizar(texto) {
    return String(texto == null ? '' : texto)
      .trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  }

  function digitoNumero(texto) {
    const digitos = String(texto == null ? '' : texto).replace(/\D+/g, '');
    return digitos ? Number(digitos) : 0;
  }

  let puertosPorEquipo = new Map();   // equipoId -> [puerto, ...] en orden de creación
  let fibrasPorCable = new Map();     // cableId -> [{ n, fibraId, extremo }, ...]

  function construirIndices(ports, fibers) {
    puertosPorEquipo = new Map();
    ports.forEach((port) => {
      const equipoId = Number(port.dispositivo_id);
      if (!equipoId) return;
      if (!puertosPorEquipo.has(equipoId)) puertosPorEquipo.set(equipoId, []);
      puertosPorEquipo.get(equipoId).push(port);
    });
    puertosPorEquipo.forEach((lista) => lista.sort(
      (a, b) => (Number(a.id) || 0) - (Number(b.id) || 0),
    ));

    fibrasPorCable = new Map();
    fibers.forEach((fiber) => {
      const cableId = Number(fiber.cable_id);
      const fibraId = Number(fiber.fibra_id);
      if (!cableId || !fibraId) return;
      if (!fibrasPorCable.has(cableId)) fibrasPorCable.set(cableId, []);
      const lista = fibrasPorCable.get(cableId);
      lista.push({
        n: Number(fiber.hilo_global_no || fiber.global || lista.length + 1),
        fibraId,
        extremo: fiber.extremo || null,
      });
    });
  }

  /** Puerto real que corresponde a la etiqueta que pinta el HTML v25. */
  function puertoIdDe(ep) {
    const lista = puertosPorEquipo.get(Number(ep.eqId)) || [];
    if (!lista.length) return null;
    const tipo = String(ep.type || '').toUpperCase();
    const texto = normalizar(ep.port);
    const porNumero = (n) => lista.find((p) => Number(p.puerto_no) === Number(n));
    const porIndice = (n) => (n >= 1 && n <= lista.length ? lista[n - 1] : null);
    const idDe = (fila) => (fila ? Number(fila.id) : null);
    let m = null;

    if (tipo === 'SPLITTER') {
      if (texto === 'IN') {
        return idDe(lista.find((p) => normalizar(p.direccion) === 'IN') || porIndice(1));
      }
      m = /^OUT (\d+)$/.exec(texto);
      if (m) {
        const n = Number(m[1]);
        return idDe(lista.find(
          (p) => normalizar(p.direccion) === 'OUT' && Number(p.puerto_no) === n,
        ) || porIndice(n));
      }
    }

    if (tipo === 'ODF') {
      m = /^(?:BIDI|ODF|PUERTO)? ?(\d+)$/.exec(texto);
      if (m) return idDe(porNumero(Number(m[1])) || porIndice(Number(m[1])));
    }

    if (tipo === 'OLT') {
      m = /^PON (\d+)$/.exec(texto);
      if (m) return idDe(porIndice(Number(m[1])) || porNumero(Number(m[1])));
      m = /^SFP\+? (\d+)$/.exec(texto);
      if (m) return idDe(porIndice(8 + Number(m[1])));
      m = /^RJ45 (\d+)$/.exec(texto);
      if (m) return idDe(porIndice(10 + Number(m[1])));
    }

    if (tipo === 'SWITCH') {
      m = /^SFP\+? (\d+)$/.exec(texto);
      if (m) return idDe(porIndice(Number(m[1])));
      m = /^RJ45 (\d+)$/.exec(texto);
      if (m) return idDe(porIndice(4 + Number(m[1])));
    }

    // Etiquetas del DTO (OUT-3, BIDI-7, IN-1…) y último recurso por número.
    const exacto = lista.find((p) => normalizar(p.etiqueta) === texto
      || normalizar(`${p.direccion} ${p.puerto_no}`) === texto);
    if (exacto) return Number(exacto.id);
    m = /^(\w+) (\d+)$/.exec(texto);
    if (m && normalizar(lista[0].direccion) === m[1]) return idDe(porNumero(Number(m[2])));
    const n = digitoNumero(texto);
    return idDe((n && porNumero(n)) || null);
  }

  /** Hilo de cable real que corresponde a «Hilo N» del HTML v25. */
  function fibraDe(ep) {
    const lista = fibrasPorCable.get(Number(ep.eqId)) || [];
    if (!lista.length) return null;
    const n = digitoNumero(ep.port);
    if (!n) return null;
    return lista.find((fila) => fila.n === n) || lista[n - 1] || null;
  }

  /** Completa el `extra` del extremo con los IDs reales de Map OLT. */
  function enriquecer(ep) {
    if (!ep) return {};
    const extra = ep.extra || (ep.extra = {});
    if (String(ep.type || '').toUpperCase() === 'CABLE') {
      if (!extra.mapoltFibraId) {
        const fibra = fibraDe(ep);
        if (fibra) {
          extra.mapoltFibraId = fibra.fibraId;
          extra.mapoltExtremo = fibra.extremo;
        }
      }
    } else if (!extra.mapoltPortId) {
      const puertoId = puertoIdDe(ep);
      if (puertoId) extra.mapoltPortId = puertoId;
    }
    return extra;
  }

  /** Extremo tal como lo espera el backend: IDs reales + identidad legible. */
  function extremoParaGuardar(ep) {
    if (!ep) return {};
    const { mapoltPort, ...resto } = enriquecer(ep);
    return {
      ...resto,
      eqId: Number(ep.eqId),
      type: String(ep.type || '').toUpperCase(),
      port: ep.port,
      face: ep.face == null ? null : ep.face,
    };
  }

  /** Etiqueta con la que el HTML v25 pinta el puerto (la que usa su validador). */
  function etiquetaUiDePuerto(device, port, indice) {
    const tipo = deviceType(device);
    if (tipo === 'ODF') {
      return Number(port.puerto_no) || Number(String(port.etiqueta).replace(/\D/g, '')) || indice;
    }
    if (tipo === 'SPLITTER') {
      return normalizar(port.direccion) === 'IN'
        ? 'IN'
        : `OUT ${Number(port.puerto_no) || indice}`;
    }
    if (tipo === 'OLT') {
      // La plantilla v25 pinta 8 PON + 2 SFP+ + 1 RJ45, en ese orden.
      if (indice <= 8) return `PON ${indice}`;
      if (indice <= 10) return `SFP+ ${indice - 8}`;
      return `RJ45 ${indice - 10}`;
    }
    if (tipo === 'SWITCH') {
      return indice <= 4 ? `SFP+ ${indice}` : `RJ45 ${indice - 4}`;
    }
    return portLabel(port);
  }

  /** Rearma el historial del panel derecho (traces) desde lo guardado. */
  function reconstruirTrazas() {
    try {
      if (typeof traces === 'undefined' || typeof chainOf !== 'function') return;
      // Si hay una trazabilidad en curso no se toca el historial.
      if (typeof session !== 'undefined' && session) return;
      traces.length = 0;
      if (typeof traceSeq !== 'undefined') traceSeq = 0;
    } catch (error) {
      return;
    }
    const usadas = new Set();
    connections.forEach((conexion) => {
      if (!conexion.origin || usadas.has(conexion.id)) return;
      const alcanzables = chainOf(conexion.from);
      const ids = connections
        .filter((c) => alcanzables.has(c.from.key) || alcanzables.has(c.to.key))
        .map((c) => c.id)
        .sort((a, b) => a - b);
      if (!ids.length) return;
      ids.forEach((id) => usadas.add(id));
      const info = typeof portInfo === 'function' ? portInfo(conexion.from) : {};
      traces.push({
        id: traces.length + 1,
        origin: conexion.from,
        domain: info.domain || conexion.signal || null,
        copper: info.media === 'cobre',
        connIds: ids,
        ext: {},
        status: 'closed',
        created: new Date(),
        updated: new Date(),
      });
    });
    if (typeof traceSeq !== 'undefined') traceSeq = traces.length;
  }

  function applyMapOltData(data) {
    if (data.catalogTypes) {
      window.catalogTypes = data.catalogTypes;
      if (typeof window.syncAddModal === 'function') {
        try { window.syncAddModal(); } catch (_) {}
      }
    }
    const devices = Array.isArray(data.dispositivos) ? data.dispositivos : [];
    const ports = Array.isArray(data.puertos) ? data.puertos : [];
    const fibers = Array.isArray(data.hilos) ? data.hilos : [];
    const byDevice = new Map();
    devices.forEach((device) => byDevice.set(Number(device.id), device));

    cabinets = [{ id: 'mapolt', nombre: data.armario_nombre || (data.nodo && data.nodo.nombre) || 'Armario #61', tipo: 'Rack de piso 19"', u: Number((data.nodo && data.nodo.u) || 12) }];
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
        tamano: Number(props.tamano || (type === 'OLT' ? 2 : 1)),
        cabId: 'mapolt',
        faceBExpanded: type === 'ODF',
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
    construirIndices(ports, fibers);
    const endpointForPort = new Map();
    const endpointForPortCara = new Map();
    ports.forEach((port) => {
      const device = byDevice.get(Number(port.dispositivo_id));
      if (!device) return;
      const type = deviceType(device);
      const listaEquipo = puertosPorEquipo.get(Number(device.id)) || [];
      const indice = listaEquipo.indexOf(port) + 1;
      const etiqueta = etiquetaUiDePuerto(device, port, indice || listaEquipo.length + 1);
      const extra = { mapoltPortId: Number(port.id), mapoltPort: port };

      if (type === 'ODF') {
        const epA = mkEp(Number(device.id), 'ODF', etiqueta, 'A', extra);
        const epB = mkEp(Number(device.id), 'ODF', etiqueta, 'B', extra);
        endpointForPortCara.set(Number(port.id), { A: epA, B: epB });
        endpointForPort.set(Number(port.id), epA);
      } else {
        const ep = mkEp(Number(device.id), type, etiqueta, null, extra);
        endpointForPort.set(Number(port.id), ep);
      }
    });

    /** Cara correcta de un puerto: los cables SIEMPRE entran por la cara B del ODF. */
    const puertoDe = (puertoId, cara, forzarB) => {
      const caras = endpointForPortCara.get(Number(puertoId));
      if (!caras) return endpointForPort.get(Number(puertoId));
      return (forzarB || String(cara || '').toUpperCase() === 'B') ? caras.B : caras.A;
    };

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
      const props = empalme.propiedades || {};
      let from;
      let to;
      if (empalme.puerto_origen_id) {
        // Jumper puerto ↔ puerto: cara A para el equipo y la guardada para el ODF.
        from = puertoDe(empalme.puerto_origen_id, props.fromFace || 'A');
        to = puertoDe(empalme.puerto_id, props.toFace || 'A');
      } else if (empalme.puerto_id) {
        // Conector puerto ↔ hilo: si el puerto es de un ODF, el cable va por cara B
        // (convención del v25), aunque se hubiera guardado en la cara A.
        const fibra = endpointForFiber.get(Number(empalme.fibra_a_id));
        const puerto = puertoDe(empalme.puerto_id, null, true);
        const desdeFibra = props.desde_fibra !== false;
        from = desdeFibra ? fibra : puerto;
        to = desdeFibra ? puerto : fibra;
      } else {
        from = endpointForFiber.get(Number(empalme.fibra_a_id));
        to = endpointForFiber.get(Number(empalme.fibra_b_id));
      }
      if (!from || !to) return;
      connections.push({
        id: Number(empalme.id) || ++connSeq,
        from,
        to,
        origin: !!props.isOrigin,
        signal: props.signal || null,
        mapoltId: empalme.id,
      });
      connSeq = Math.max(connSeq, Number(empalme.id) || connSeq);
    });

    reconstruirTrazas();
    updateUI();
    ensureSaveButton();
  }

  function notifyEquipment(payload) {
    post('equipment-add', payload);
  }

  function sendAllConnections(requestId) {
    const list = connections.map((c) => {
      const from = extremoParaGuardar(c.from);
      const to = extremoParaGuardar(c.to);
      // Convención del v25: el cable siempre entra por la cara B del ODF.
      if (from.type === 'ODF' && to.type === 'CABLE') from.face = 'B';
      if (to.type === 'ODF' && from.type === 'CABLE') to.face = 'B';
      return {
        id: c.id,
        from,
        to,
        fromType: c.from && c.from.type,
        toType: c.to && c.to.type,
        fromFace: from.face,
        toFace: to.face,
        fromPort: c.from && c.from.port,
        toPort: c.to && c.to.port,
        fromEqId: c.from && c.from.eqId,
        toEqId: c.to && c.to.eqId,
        origin: !!c.origin,
        signal: c.signal || null,
      };
    });
    post('sync-connections', { conexiones: list }, requestId);
  }

  let saveDebounceTimer = null;
  function triggerAutoSave() {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      sendAllConnections();
    }, 400);
  }

  /* El botón solo pinta el resultado REAL que confirma el padre: antes decía
     «GUARDADO» pasados 500 ms aunque el backend hubiera guardado 0. */
  let guardadoPendiente = null;

  function terminarGuardado(resultado, manual) {
    const pendiente = guardadoPendiente;
    const ok = !!(resultado && resultado.ok);
    if (manual) {
      guardadoPendiente = null;
      if (pendiente && pendiente.timer) clearTimeout(pendiente.timer);
    }
    const btn = document.getElementById('btnGuardarMapOlt');
    if (btn && (manual || !pendiente)) {
      btn.disabled = false;
      btn.innerHTML = ok ? '<span>✓</span> GUARDADO' : '<span>✗</span> NO GUARDADO';
      btn.style.background = ok ? '#059669' : '#dc2626';
      setTimeout(() => {
        btn.innerHTML = '<span>💾</span> GUARDAR';
        btn.style.background = '#16a34a';
      }, 2600);
    }
    if (typeof window.toast === 'function' && (manual || !ok)) {
      if (ok) {
        window.toast(`✓ ${Number(resultado.guardadas) || 0} conexión(es) guardadas en Map OLT.`);
      } else {
        window.toast((resultado && resultado.error) || 'No se pudo guardar en Map OLT.', 'err');
      }
    }
  }

  function pedirGuardado(btn) {
    if (guardadoPendiente && guardadoPendiente.timer) clearTimeout(guardadoPendiente.timer);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>⏳</span> Guardando...';
      btn.style.background = '#ca8a04';
    }
    const requestId = `save-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    guardadoPendiente = {
      requestId,
      btn: btn || document.getElementById('btnGuardarMapOlt'),
      timer: setTimeout(
        () => terminarGuardado({ ok: false, error: 'Map OLT no respondió al guardado.' }, true),
        15000,
      ),
    };
    sendAllConnections(requestId);
  }

  function ensureSaveButton() {
    if (document.getElementById('btnGuardarMapOlt')) return;
    const topBar = document.querySelector('.top');
    if (!topBar) return;

    const btn = document.createElement('button');
    btn.id = 'btnGuardarMapOlt';
    btn.className = 'btn dark';
    btn.style.cssText = 'background:#16a34a;border:1px solid #15803d;color:#fff;font-weight:700;display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:7px 10px;padding:6px 14px;letter-spacing:0.04em;';
    btn.innerHTML = '<span>💾</span> GUARDAR';
    btn.title = 'Guarda todas las conexiones y trazabilidad de este armario en Map OLT';

    btn.onclick = () => pedirGuardado(btn);

    const btnAddEq = topBar.querySelector('.btn.dark');
    if (btnAddEq) {
      topBar.insertBefore(btn, btnAddEq);
    } else {
      topBar.appendChild(btn);
    }
  }

  const originalSaveEquipment = window.handleSaveEquipment;
  window.handleSaveEquipment = function (event) {
    const type = String(document.getElementById('eqTipo').value || '').toUpperCase();
    const selCat = document.getElementById('eqCatalogoTipo');
    const tipoId = selCat && selCat.value ? Number(selCat.value) : null;
    const payload = {
      tipo: type,
      tipo_id: tipoId,
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
      triggerAutoSave();
    }
    return result;
  };

  const originalRemoveConn = window.removeConnection;
  window.removeConnection = function (id) {
    if (typeof originalRemoveConn === 'function') originalRemoveConn(id);
    triggerAutoSave();
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

  /* La TRAZABILIDAD (marcar/quitar origen, deshacer, cancelar) también se
     autoguarda, pero envolviendo SOLO esas acciones: NO se toca updateUI() ni
     el render, para que el estado que ve el validador sea el de siempre. */
  let guardadoTrazabilidad = null;
  function programarGuardadoTrazabilidad(retardo) {
    clearTimeout(guardadoTrazabilidad);
    guardadoTrazabilidad = setTimeout(() => triggerAutoSave(), retardo);
  }

  function vigilarTrazabilidad() {
    const envolver = (nombre, retardo) => {
      const original = window[nombre];
      if (typeof original !== 'function') return;
      window[nombre] = function (...args) {
        const resultado = original.apply(this, args);
        programarGuardadoTrazabilidad(retardo);
        return resultado;
      };
    };
    envolver('setOrigin', 1200);
    envolver('clearOrigin', 250);
    envolver('undoStep', 250);
    envolver('cancelSession', 250);
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const message = event.data || {};
    if (message.source !== 'mapolt-pop-v25-parent') return;
    if (message.type === 'init') {
      applyMapOltData(message.payload || {});
      setTimeout(ensureSaveButton, 100);
      return;
    }
    if (message.type === 'save-result') {
      const resultado = message.payload || {};
      const manual = !!(guardadoPendiente && message.requestId
        && message.requestId === guardadoPendiente.requestId);
      terminarGuardado(resultado, manual);
      return;
    }
    if (message.type === 'trigger-save') {
      pedirGuardado(document.getElementById('btnGuardarMapOlt'));
    }
  });

  vigilarTrazabilidad();

  
  /* ── PERSISTENCIA DE ESTADO UI DEL ARMARIO (localStorage por armario) ───── */
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

    /* ── EIA-598-A BUFFER & FIBER STANDARDS (MODELO A) ───────────────────────── */
  const EIA598_BUFFERS = [
    { num: 1, name: 'Azul', hex: '#2563eb' },
    { num: 2, name: 'Naranja', hex: '#ea580c' },
    { num: 3, name: 'Verde', hex: '#16a34a' },
    { num: 4, name: 'Marrón', hex: '#854d0e' },
    { num: 5, name: 'Gris', hex: '#64748b' },
    { num: 6, name: 'Blanco', hex: '#f8fafc', border: '#cbd5e1' },
    { num: 7, name: 'Rojo', hex: '#dc2626' },
    { num: 8, name: 'Negro', hex: '#09090b' },
    { num: 9, name: 'Amarillo', hex: '#eab308' },
    { num: 10, name: 'Violeta', hex: '#9333ea' },
    { num: 11, name: 'Rosa', hex: '#ec4899' },
    { num: 12, name: 'Aqua', hex: '#06b6d4' }
  ];

  window.matrixOpenBuffers = window.matrixOpenBuffers || new Set();
  window.dynOpenBuffers = window.dynOpenBuffers || new Set();

  // Helper para hiloInfo con terminología BUFFER
  const originalHiloInfo = window.hiloInfo;
  window.hiloInfo = function (cable, i) {
    const fiberColors = (typeof FIBER_COLORS !== 'undefined') ? FIBER_COLORS : EIA598_BUFFERS;
    const c = fiberColors[i % 12];
    const bufferNum = Math.floor(i / 12) + 1;
    const bufColor = EIA598_BUFFERS[(bufferNum - 1) % 12];
    const padB = String(bufferNum).padStart(2, '0');
    const padH = String((i % 12) + 1).padStart(2, '0');
    return {
      nombre: cable.hilos > 12 ? `${c.nombre} (B${padB}-H${padH})` : c.nombre,
      hex: c.hex,
      t: c.t,
      bufferNum,
      bufferName: bufColor.name,
      bufferHex: bufColor.hex,
      hiloEnBuffer: (i % 12) + 1
    };
  };

  // MODELO A PARA LA MATRIZ: Cables agrupados en BUFFERS con alto contraste
  window.toggleMatrixBufferUI = function (header, cableId, bufferNum) {
    const key = `${cableId}-${bufferNum}`;
    if (window.matrixOpenBuffers.has(key)) {
      window.matrixOpenBuffers.delete(key);
    } else {
      window.matrixOpenBuffers.add(key);
    }
    guardarEstadoArmario();
    if (typeof renderTreeView === 'function') renderTreeView();
  };

  window.matrixExpandBuffers = function (cableId, totalBuffers, expand) {
    for (let b = 1; b <= totalBuffers; b++) {
      const key = `${cableId}-${b}`;
      if (expand) window.matrixOpenBuffers.add(key);
      else window.matrixOpenBuffers.delete(key);
    }
    guardarEstadoArmario();
    if (typeof renderTreeView === 'function') renderTreeView();
  };

  window.matrixCableCard = function (k) {
    const pid = 'cable-' + k.id;
    const open = matrixOpenPanels.has(pid);
    const linked = typeof cableUsedCount === 'function' ? cableUsedCount(k) : 0;
    const bufferSize = 12;
    const numBuffers = Math.ceil(k.hilos / bufferSize);

    let buffersHtml = '';
    if (k.hilos >= 12) {
      buffersHtml = `
        <div style="padding:6px 12px; background:#f8fafc; border-bottom:1.5px solid #334155; font-size:10px; font-family:var(--mono); display:flex; justify-content:space-between; color:#64748b;">
          <span>Estructura TIA/EIA-598-A (${numBuffers} Buffers × 12 hilos)</span>
          <div style="display:flex; gap:8px;">
            <a href="javascript:void(0)" onclick="window.matrixExpandBuffers('${k.id}', ${numBuffers}, true)" style="color:#2563eb; text-decoration:none; font-weight:700;">Expandir buffers</a>
            <span>·</span>
            <a href="javascript:void(0)" onclick="window.matrixExpandBuffers('${k.id}', ${numBuffers}, false)" style="color:#2563eb; text-decoration:none; font-weight:700;">Colapsar buffers</a>
          </div>
        </div>
      `;

      for (let b = 1; b <= numBuffers; b++) {
        const buf = EIA598_BUFFERS[(b - 1) % 12];
        const key = `${k.id}-${b}`;
        // Buffer 1 abierto por defecto la primera vez
        // Todos los buffers inician contraídos por defecto
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
        `;
      }
    } else {
      const ports = Array.from({ length: k.hilos }, (_, i) => {
        const h = window.hiloInfo(k, i);
        return matrixPort(hiloEp(k, i), `Hilo ${i + 1} · ${h.nombre}`, h.hex);
      }).join('');
      buffersHtml = `<div class="mx-device-ports">${ports}</div>`;
    }

    return `<section class="mx-accordion" id="mxpanel-${pid}" data-mx-linked="${linked > 0 ? 'true' : 'false'}">
      ${matrixPanelHeader(pid, escapeMatrixText(k.nombre), `Cable de entrada · ${k.hilos} hilos (${numBuffers} Buffers) · ${escapeMatrixText(cabNameOf(k.cabId))}`, 'CABLE', `${linked} enlaces`, open, `<button title="Mover a otro gabinete" onclick="moveCable('${k.id}')">⇄</button><button title="Eliminar cable" onclick="deleteCable('${k.id}')">✕</button>`)}
      <div class="mx-accordion-body ${open ? '' : 'collapsed'}">
        ${buffersHtml}
      </div>
    </section>`;
  };

  // MODELO A PARA PAPEL DINÁMICO: Cable con sub-cabeceras de BUFFER con alto contraste
  window.toggleDynBufferUI = function (header, cableId, bufferNum) {
    const key = `${cableId}-${bufferNum}`;
    if (window.dynOpenBuffers.has(key)) {
      window.dynOpenBuffers.delete(key);
    } else {
      window.dynOpenBuffers.add(key);
    }
    guardarEstadoArmario();
    if (typeof renderDyn === 'function') renderDyn();
  };

  
  // Inyectar estilos para scrollbars finas y transparentes que no tapen puertos
  function inyectarEstilosScrollbar() {
    if (document.getElementById('mapolt-slim-scroll-style')) return;
    const st = document.createElement('style');
    st.id = 'mapolt-slim-scroll-style';
    st.textContent = `
      * {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
      }
      ::-webkit-scrollbar {
        display: none !important;
        width: 0px !important;
        height: 0px !important;
      }
      .dnode {
        overflow: visible !important;
      }
      .dnode .drow {
        overflow: visible !important;
      }
      .dnode .dport.right {
        right: -7px !important;
        z-index: 10 !important;
      }
      .mx-device-ports {
        overflow-y: auto !important;
        overflow-x: hidden !important;
      }
    `;
    document.head.appendChild(st);
  }
  inyectarEstilosScrollbar();

  const originalRenderDyn = window.renderDyn;
  window.renderDyn = function () {
    if (typeof originalRenderDyn === 'function') originalRenderDyn();

    // Reemplazar la apariencia de los dnode de cables en dynWorld para agrupar por buffers
    const world = document.getElementById('dynWorld');
    if (!world) return;

    cables.filter(k => typeof dynCab === 'undefined' || dynCab === 'all' || k.cabId === dynCab).forEach(k => {
      const nodeEl = world.querySelector(`.dnode[data-node="${k.id}"]`);
      if (!nodeEl || k.hilos < 12) return;

      const bufferSize = 12;
      const numBuffers = Math.ceil(k.hilos / bufferSize);
      let buffersHtml = '';

      for (let b = 1; b <= numBuffers; b++) {
        const buf = EIA598_BUFFERS[(b - 1) % 12];
        const key = `${k.id}-${b}`;
        // Todos los buffers inician contraídos por defecto
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
        `;
      }

      // Reemplazar el cuerpo del dnode preservando el dhead
      const dhead = nodeEl.querySelector('.dhead');
      if (dhead) {
        nodeEl.innerHTML = '';
        nodeEl.appendChild(dhead);
        nodeEl.style.width = '246px';
        const bodyWrapper = document.createElement('div');
        // El contenedor se expande completamente hacia abajo para mostrar todo el buffer seleccionado sin cortes
        bodyWrapper.style.maxHeight = 'none';
        bodyWrapper.style.overflow = 'visible';
        bodyWrapper.innerHTML = buffersHtml;
        nodeEl.appendChild(bodyWrapper);
      }
    });

    if (typeof drawDyn === 'function') drawDyn();
  };


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
    guardarEstadoArmario();
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
    guardarEstadoArmario();
    setTimeout(aplicarLimpiezaUI, 80);
  };

  // Initial cleanup on load
  setTimeout(aplicarLimpiezaUI, 200);

  post('ready');
  window.MapOltV25 = { applyMapOltData, sendAllConnections, ensureSaveButton, pedirGuardado };
})();
