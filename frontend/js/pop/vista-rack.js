/**
 * vista-rack.js — Rack 19" (Fase 4): visualmente idéntico a pop_gestor_v25.html.
 *
 * Muestra el inventario del contenedor con chasis 3D, rieles metálicos con numeración en U,
 * tornillos de montaje, carátulas frontales, ODF con Cara A / Cara B y puertos organizados.
 * Mantiene la clase `.pop-rack-fila` y `data-dispositivo` para compatibilidad de suite.
 */

const TYPE_COLOR = {
  OLT: '#ef4444',
  ODF: '#8b5cf6',
  SWITCH: '#0284c7',
  SPLITTER: '#10b981',
  CABLE: '#2563eb'
};

const PORT_BG = {
  PON: '#059669',
  SFP: '#0284c7',
  RJ45: '#f59e0b',
  ODF: '#8b5cf6',
  SPLITTER: '#10b981'
};

function normalizarTipo(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (t === 'SWITCHES' || t === 'SWITCH') return 'SWITCH';
  if (t === 'OLT') return 'OLT';
  if (t === 'ODF') return 'ODF';
  return 'SPLITTER';
}

function esc(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SCR = '<span class="scr tl"></span><span class="scr tr"></span><span class="scr bl"></span><span class="scr br"></span>';

function rail(lbl, n) {
  return `<div class="rail"><span class="u">${lbl}</span><div class="hs">${'<i></i>'.repeat(Math.max(1, n) * 2)}</div></div>`;
}

function renderOdfChassis(item, lbl, tag, diagrama) {
  const puertosOdf = (diagrama.puertos || []).filter((p) => p.dispositivo_id === item.id);
  const totalCols = Math.max(12, Math.min(16, puertosOdf.length || 12));
  let colsB = '', fused = 0;

  for (let n = 1; n <= totalCols; n++) {
    const p = puertosOdf[n - 1];
    // Empalmes relacionados con este puerto
    const emp = p ? (diagrama.conexiones || []).find((c) => c.puerto_id === p.id) : null;
    let labelCable = 'LIBRE';
    let labelHilo = '';
    let lc = null;

    if (emp) {
      fused++;
      lc = '#3b82f6';
      if (emp.fibra_a_id) {
        labelCable = 'C-GEN';
        labelHilo = `H${n}`;
      }
    }

    const cb = emp ? `<div class="dot" style="background:${TYPE_COLOR.CABLE}"></div><span>${labelCable}</span><span class="m">${labelHilo}</span>` : `<span>LIBRE</span>`;
    const ca = `<span>P${n}</span><span class="m">—</span>`;

    colsB += `
      <div class="col">
        <div class="cell ${emp ? '' : 'free2'}">${cb}</div>
        <div class="splice"><i class="${emp ? 'on' : ''}" style="${lc ? `--lc:${lc}` : ''}"></i></div>
        <div class="cell">${ca}</div>
      </div>`;
  }

  return `
    <div class="pop-rack-fila eqp" data-dispositivo="${item.id}" style="min-height:44px">
      ${rail(lbl, 1)}
      <div class="fp">
        ${SCR}
        <div class="odf-h">
          ${tag}
          <span class="ename">${esc(item.nombre || 'ODF 1 (Patch 16P)')}</span>
          <span class="cnt">${fused}/${totalCols} ENLAZADOS · ▲ CARA B (cables) · ▼ CARA A (equipos)</span>
        </div>
        <div class="odfx">
          <div class="grid16">${colsB}</div>
        </div>
      </div>
      ${rail('', 1)}
    </div>`;
}

export function renderRack(host, diagrama) {
  const dispositivos = diagrama.dispositivos || [];
  const contenedor = diagrama.contenedor || {};
  const propsInst = contenedor.propiedades_instancia || {};
  const totalU = Number(propsInst.u || 12);
  const nombreRack = propsInst.nombre || `Armario #${contenedor.id || 61}`;
  const tipoRack = propsInst.tipo || 'Rack de piso 19"';

  let used = 0;
  let html = '';

  dispositivos.forEach((dispositivo) => {
    const tipo = normalizarTipo(dispositivo.tipo);
    const tamano = Number(dispositivo.tamano || (tipo === 'OLT' ? 2 : 1));
    const top = totalU - used;
    const lo = top - tamano + 1;
    const over = lo < 1;
    const lbl = over ? 'EXCEDE' : (tamano > 1 ? `${top}–${lo}U` : `${top}U`);
    used += tamano;

    const tagColor = TYPE_COLOR[tipo] || '#666';
    const tag = `<span class="tag" style="background:${tagColor}">${tipo}</span>`;

    if (tipo === 'ODF') {
      html += renderOdfChassis(dispositivo, lbl, tag, diagrama);
      return;
    }

    let portsHtml = '';
    const puertos = (diagrama.puertos || []).filter((p) => p.dispositivo_id === dispositivo.id);

    if (tipo === 'OLT') {
      const puertosOlt = (diagrama.puertos || []).filter((p) => p.dispositivo_id === dispositivo.id);
      if (puertosOlt.length > 0) {
        const pons = puertosOlt.filter((p) => (p.etiqueta || '').startsWith('PON'));
        const sfps = puertosOlt.filter((p) => (p.etiqueta || '').startsWith('SFP'));
        const rj45s = puertosOlt.filter((p) => (p.etiqueta || '').startsWith('RJ45') && !p.etiqueta.includes('MGMT') && !p.etiqueta.includes('CONSOLE'));
        const mgmt = puertosOlt.find((p) => (p.etiqueta || '').includes('MGMT'));
        const consolePt = puertosOlt.find((p) => (p.etiqueta || '').includes('CONSOLE'));

        let ponsHtml = '';
        pons.forEach((p, idx) => {
          const num = idx + 1;
          const linked = p.estado && p.estado !== 'libre';
          ponsHtml += `<span class="pt${linked ? ' linked' : ''}" style="--pb:${PORT_BG.PON}" title="${esc(p.etiqueta || `PON ${num}`)}"></span>`;
        });

        let sfpHtml = '';
        sfps.forEach((p, idx) => {
          const num = idx + 1;
          const linked = p.estado && p.estado !== 'libre';
          sfpHtml += `<span class="portnum">${num}<span class="pt${linked ? ' linked' : ''}" style="--pb:${PORT_BG.SFP}" title="${esc(p.etiqueta || `SFP+ ${num}`)}"></span></span>`;
        });

        let rj45Html = '';
        rj45s.forEach((p, idx) => {
          const num = idx + 1;
          const linked = p.estado && p.estado !== 'libre';
          rj45Html += `<span class="portnum">${num}<span class="pt${linked ? ' linked' : ''}" style="--pb:${PORT_BG.RJ45}" title="${esc(p.etiqueta || `RJ45 ${num}`)}"></span></span>`;
        });

        let ctrlHtml = '';
        if (mgmt) {
          ctrlHtml += `<span class="portnum" style="color:#38bdf8">M<span class="pt" style="--pb:#0284c7" title="MGMT (100M Out-of-band)"></span></span>`;
        }
        if (consolePt) {
          ctrlHtml += `<span class="portnum" style="color:#94a3b8">C<span class="pt" style="--pb:#475569" title="CONSOLE (RS-232 CLI)"></span></span>`;
        }

        let grupos = [];
        if (ponsHtml) grupos.push(`<div class="pgrp"><span>PON (${pons.length})</span>${ponsHtml}</div>`);
        if (sfpHtml) grupos.push(`<div class="pgrp"><span>SFP+ (${sfps.length})</span>${sfpHtml}</div>`);
        if (rj45Html) grupos.push(`<div class="pgrp"><span>GE (${rj45s.length})</span>${rj45Html}</div>`);
        if (ctrlHtml) grupos.push(`<div class="pgrp"><span>CTRL</span>${ctrlHtml}</div>`);

        portsHtml = grupos.join('');
      } else {
        let pons = '';
        for (let i = 1; i <= 8; i++) {
          pons += `<span class="pt" style="--pb:${PORT_BG.PON}" title="PON ${i}"></span>`;
        }
        let uplink = '';
        for (let i = 1; i <= 2; i++) {
          uplink += `<span class="portnum">${i}<span class="pt" style="--pb:${PORT_BG.SFP}" title="SFP+ ${i}"></span></span>`;
        }
        uplink += `<span class="portnum">1<span class="pt" style="--pb:${PORT_BG.RJ45}" title="RJ45 1"></span></span>`;
        portsHtml = `<div class="pgrp"><span>PON</span>${pons}</div><div class="pgrp"><span>UPLINK</span>${uplink}</div>`;
      }
    } else if (tipo === 'SWITCH') {
      let sfps = '';
      for (let i = 1; i <= 4; i++) {
        sfps += `<span class="portnum">${i}<span class="pt" style="--pb:${PORT_BG.SFP}" title="SFP+ ${i}"></span></span>`;
      }
      let rj45s = '';
      for (let i = 1; i <= 8; i++) {
        rj45s += `<span class="portnum">${i}<span class="pt" style="--pb:${PORT_BG.RJ45}" title="RJ45 ${i}"></span></span>`;
      }
      portsHtml = `<div class="pgrp"><span>SFP+</span>${sfps}</div><div class="pgrp"><span>RJ45</span>${rj45s}</div>`;
    } else {
      // SPLITTER
      const nOuts = Math.max(8, Number(String(dispositivo.division || '1x16').split('x')[1]) || 16);
      let outs = '';
      for (let i = 1; i <= nOuts; i++) {
        outs += `<span class="pt" style="--pb:${PORT_BG.SPLITTER}" title="OUT ${i}"></span>`;
      }
      portsHtml = `
        <div class="pgrp"><span>IN</span><span class="pt" style="--pb:${PORT_BG.SPLITTER}" title="IN"></span></div>
        <div class="pgrp"><span>OUT</span>${outs}</div>`;
    }

    html += `
      <div class="pop-rack-fila eqp" data-dispositivo="${dispositivo.id}" style="min-height:${tamano * 44}px">
        ${rail(lbl, tamano)}
        <div class="fp">
          ${SCR}
          <div class="eb">
            <div style="display:flex;align-items:center;min-width:0">
              <span class="handle"></span>
              ${tag}
              <span class="ename">${esc(dispositivo.nombre || `${tipo} #${dispositivo.id}`)}</span>
            </div>
            <div class="well">${portsHtml}</div>
          </div>
        </div>
        ${rail('', tamano)}
      </div>`;
  });

  if (used < totalU) {
    html += `<div class="free">${totalU - used}U LIBRES</div>`;
  }

  host.innerHTML = `
    <div class="pop-rack rackwrap">
      <div class="rack">
        <div class="rack-h">
          <b><span class="led"></span>${esc(nombreRack)} · ${esc(tipoRack)} · ${totalU}U</b>
          <small>${used}/${totalU}U en uso</small>
        </div>
        <div class="rackUnitsList">
          ${html || '<div class="free">RACK VACÍO</div>'}
        </div>
      </div>
    </div>`;
}
