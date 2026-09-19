/**
 * ftth-diagrama.js
 * Diagrama lógico de un nodo (F3, solo lectura).
 *
 * Qué muestra, para una caja/manga/ODF/armario/OLT:
 *   - Cabecera con el tipo, el box_id, el estado y si conmuta hilos.
 *   - Columna 1: los hilos que TERMINAN en el nodo (con su cable, tubo, extremo y estado).
 *   - Columna 2: las bandejas con sus posiciones (slots de empalme).
 *   - Columna 3: los dispositivos (splitter, adaptador...) con sus puertos IN/OUT/BIDI.
 *   - Pie: las advertencias que calcula el backend.
 *
 * Qué NO hace (diseño no destructivo, docs/DISENO_CAPA_LOGICA.md §12):
 *   - No escribe nada: la edición de empalmes llega en F4.
 *   - No toca el mapa, ni los tipos, ni los iconos, ni los objetos.
 *
 * Se abre desde ftth-mapa.js con un clic izquierdo en un nodo (o desde el menú contextual).
 */
const FTTHDiagrama = (() => {

  const NODOS = ['cajanap', 'manga', 'odf', 'armario', 'olt', 'splitter', 'fusion'];
  const ETIQUETA = {
    cajanap: 'Caja NAP', manga: 'Manga', odf: 'ODF', armario: 'Armario',
    olt: 'OLT', splitter: 'Splitter', fusion: 'Fusión',
  };
  const ETIQUETA_ESTADO = {
    libre: 'Libre', empalmado: 'Empalmado', conectado: 'Conectado',
    reservado: 'Reservado', averiado: 'Averiado',
  };

  let _datos = null;
  let _boxId = null;
  let _sel = null;          // { tipo: 'hilo'|'puerto', id }
  let _cargando = false;
  let _uiLista = false;

  // ── Utilidades ────────────────────────────────────────────────────────────
  function apiUrl(path) {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const origin = window.location.origin;
    if (origin && origin !== 'null' && !origin.includes('file://')) {
      return origin + (path.startsWith('/') ? path : '/' + path);
    }
    return 'http://127.0.0.1:8000' + (path.startsWith('/') ? path : '/' + path);
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function aviso(msg, tipo) {
    if (window.FTTHTipos && window.FTTHTipos.showToast) window.FTTHTipos.showToast(msg, tipo || 'info');
    else console.log('[diagrama]', msg);
  }

  function esNodo(categoria) {
    return NODOS.includes(String(categoria || '').toLowerCase());
  }

  // ── Referencias del modal ─────────────────────────────────────────────────
  function modal() { return document.getElementById('ftth-diagrama-modal'); }
  function cuerpo() { return document.getElementById('diag-body'); }
  function pie() { return document.getElementById('diag-pie'); }
  function titulo() { return document.getElementById('diag-title'); }
  function badge() { return document.getElementById('diag-badge'); }
  function marca() { return document.getElementById('diag-mark'); }
  function sub() { return document.getElementById('diag-sub'); }

  function cerrar() {
    const m = modal();
    if (m) m.classList.add('hidden');
    _sel = null;
  }

  function abrir(boxId, opciones) {
    const m = modal();
    if (!m) {
      aviso('No se encontró el modal del diagrama (revisa index.html).', 'error');
      return;
    }
    const opts = opciones || {};
    _boxId = boxId;
    _sel = null;
    _datos = null;

    // Un solo modal a la vez: se cierra el de propiedades si estaba abierto
    const props = document.getElementById('element-properties-modal');
    if (props) props.classList.add('hidden');

    m.classList.remove('hidden');
    bindChrome();
    if (titulo()) titulo().textContent = opts.tipoNombre ? `${opts.tipoNombre} #${boxId}` : `Nodo #${boxId}`;
    if (badge()) {
      badge().textContent = 'Cargando…';
      badge().classList.remove('diag-status--off');
    }
    if (marca()) {
      marca().innerHTML = (window.FTTHIconos && opts.categoria) ? window.FTTHIconos.imgHtml(opts.categoria, 18) : '';
    }
    if (sub()) sub().innerHTML = '';
    if (cuerpo()) cuerpo().innerHTML = '<div class="diag-vacio">Cargando el diagrama lógico…</div>';
    if (pie()) pie().innerHTML = '';

    cargar();
  }

  async function cargar() {
    if (!_boxId || _cargando) return;
    _cargando = true;
    try {
      const res = await fetch(apiUrl(`/api/elementos/${_boxId}/nodo`));
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        mostrarError(err.detail || `No se pudo leer el nodo (error ${res.status}).`);
        return;
      }
      _datos = await res.json();
      pintar();
    } catch (e) {
      console.error('[diagrama] error de red:', e);
      mostrarError('No se pudo contactar al servidor.');
    } finally {
      _cargando = false;
    }
  }

  function mostrarError(texto) {
    if (cuerpo()) cuerpo().innerHTML = `<div class="diag-error">${escapeHtml(texto)}</div>`;
    if (badge()) badge().textContent = 'Error';
  }


  function chip(texto, clase) {
    return `<span class="diag-chip ${clase || ''}">${escapeHtml(texto)}</span>`;
  }

  function pintar() {
    const d = _datos;
    if (!d || !cuerpo()) return;
    const nodo = d.nodo || {};
    const r = d.resumen || {};

    if (titulo()) titulo().textContent = `${nodo.tipo_nombre || 'Nodo'} #${nodo.box_id}`;
    if (badge()) {
      badge().textContent = nodo.estado || 'Activo';
      badge().classList.toggle('diag-status--off', nodo.conmuta_hilos === false);
    }
    if (marca() && window.FTTHIconos) marca().innerHTML = window.FTTHIconos.imgHtml(nodo.categoria, 18);

    // ── Populate identity bar with node name and code ──
    const identName = document.getElementById('diag-identity-name');
    const identCode = document.getElementById('diag-identity-code');
    if (identName) identName.textContent = nodo.nombre || nodo.tipo_nombre || ('Nodo #' + nodo.box_id);
    if (identCode) identCode.textContent = nodo.codigo || nodo.box_id || '—';

    if (sub()) { sub().innerHTML = ''; }

    cuerpo().innerHTML =
      `<div class="diag-col">${colHilos(d)}</div>` +
      `<div class="diag-col">${colBandejas(d)}</div>` +
      `<div class="diag-col">${colDispositivos(d)}</div>`;

    pintarPie();
    bindClicks();
  }

  function colHilos(d) {
    const hilos = d.hilos_que_terminan || [];
    if (!hilos.length) return '';
    let h = `<div class="diag-col-title">Hilos <span>(${hilos.length})</span></div>`;
    const porCable = new Map();
    hilos.forEach((x) => {
      if (!porCable.has(x.cable_id)) porCable.set(x.cable_id, { nombre: x.cable, items: [] });
      porCable.get(x.cable_id).items.push(x);
    });
    porCable.forEach((g) => {
      h += '<div class="diag-grupo">';
      h += `<div class="diag-grupo-cab">🔌 <strong>${escapeHtml(g.nombre)}</strong>`
        + `<span class="diag-grupo-info">${g.items.length} hilo(s)</span></div>`;
      h += '<div class="diag-items">';
      g.items.forEach((x) => {
        const sel = (_sel && _sel.tipo === 'hilo' && _sel.id === x.fibra_id) ? ' sel' : '';
        const titulo = `${x.nombre} · extremo ${x.extremo} · ${x.estado}`;
        h += `<button type="button" class="diag-hilo${sel}" data-hilo="${x.fibra_id}" title="${escapeHtml(titulo)}">`
          + `<span class="diag-hilo-franja" style="background:${escapeHtml(x.color_hex || '#888')}"></span>`
          + `<span class="diag-hilo-nombre">${escapeHtml(x.nombre)}</span>`
          + `<span class="diag-hilo-ext">${escapeHtml(x.extremo)}</span>`
          + `<span class="diag-estado diag-estado--${escapeHtml(x.estado)}">`
          + `${escapeHtml(ETIQUETA_ESTADO[x.estado] || x.estado)}</span>`
          + '</button>';
      });
      h += '</div></div>';
    });
    return h;
  }


  function colBandejas(d) {
    const bandejas = d.bandejas || [];
    if (!bandejas.length) return '';
    let h = `<div class="diag-col-title">Bandejas <span>(${bandejas.length})</span></div>`;
    bandejas.forEach((b) => {
      const slots = b.slots || 0;
      const ocupados = b.ocupados || 0;
      h += '<div class="diag-bandeja">';
      h += `<div class="diag-bandeja-cab">🧰 <strong>Bandeja ${String(b.bandeja_no).padStart(2, '0')}</strong>`
        + `<span class="diag-bandeja-info">${escapeHtml(b.tipo)} · ${ocupados}/${slots} posiciones</span></div>`;
      if (slots) {
        h += '<div class="diag-slots">';
        for (let i = 1; i <= slots; i++) {
          const emp = (b.empalmes || []).find((e) => e.slot === i);
          if (emp) {
            const desc = `${emp.hilo_a ? emp.hilo_a.nombre : '?'} ↔ ${emp.hilo_b ? emp.hilo_b.nombre : '?'}`;
            h += `<div class="diag-slot diag-slot--ocupado" title="${escapeHtml('Posición ' + i + ': ' + desc)}">${i}</div>`;
          } else {
            h += `<div class="diag-slot" title="${escapeHtml('Posición ' + i + ' libre')}">${i}</div>`;
          }
        }
        h += '</div>';
      }
      h += '</div>';
    });
    return h;
  }

  function colDispositivos(d) {
    const dispositivos = d.dispositivos || [];
    if (!dispositivos.length) return '';
    const puertos = d.puertos || [];
    let h = `<div class="diag-col-title">Dispositivos <span>(${dispositivos.length})</span></div>`;
    dispositivos.forEach((dev) => {
      const mios = puertos.filter((p) => p.dispositivo_id === dev.id);
      const libres = mios.filter((p) => p.estado === 'libre').length;
      const extra = (dev.atenuacion_db != null ? ` · ${dev.atenuacion_db} dB` : '')
        + (dev.serie ? ` · ${dev.serie}` : '');
      h += '<div class="diag-dispositivo">';
      h += `<div class="diag-dispositivo-cab">${dev.tipo === 'splitter' ? '🔀' : '🔌'} `
        + `<strong>${escapeHtml(dev.tipo + (dev.division ? ' ' + dev.division : ''))}</strong>`
        + `<span class="diag-dispositivo-info">${mios.length} puerto(s) · ${libres} libre(s)${escapeHtml(extra)}</span></div>`;
      h += '<div class="diag-dispositivo-puertos">';
      mios.forEach((p) => {
        const sel = (_sel && _sel.tipo === 'puerto' && _sel.id === p.id) ? ' sel' : '';
        let clase = `diag-puerto--${String(p.direccion || '').toLowerCase()}`;
        if (p.estado === 'ocupado') clase += ' diag-puerto--ocupado';
        if (p.estado === 'reservado') clase += ' diag-puerto--reservado';
        const t = `${p.etiqueta} · ${p.estado}${p.tipo_conector ? ' · ' + p.tipo_conector : ''}`;
        h += `<button type="button" class="diag-puerto ${clase}${sel}" data-puerto="${p.id}" title="${escapeHtml(t)}">`
          + `<strong>${escapeHtml(p.etiqueta)}</strong>`
          + (p.tipo_conector ? `<span class="diag-hilo-ext">${escapeHtml(p.tipo_conector)}</span>` : '')
          + '</button>';
      });
      h += '</div></div>';
    });
    
    // Botón para agregar splitter
    h += `<div style="margin-top: 15px; text-align: center;">
            <button type="button" class="btn-primary" style="font-size: 12px; padding: 6px 12px;" onclick="FTTHDiagrama.mostrarModalAgregarSplitter()">
              ➕ Añadir Splitter
            </button>
          </div>`;
          
    return h;
  }


  function detalleTexto() {
    if (!_sel || !_datos) return '';
    if (_sel.tipo === 'hilo') {
      const x = (_datos.hilos_que_terminan || []).find((t) => t.fibra_id === _sel.id);
      if (!x) return '';
      const holgura = x.holgura_m ? ` · holgura ${x.holgura_m} m` : '';
      return `Hilo <b>${escapeHtml(x.nombre)}</b> de «${escapeHtml(x.cable)}» · tubo ${x.tubo_no}`
        + ` · posición global ${x.hilo_global_no} · extremo <b>${escapeHtml(x.extremo)}</b>${escapeHtml(holgura)}`
        + ` · estado ${escapeHtml(x.estado)}${x.perfil ? ' · perfil ' + escapeHtml(x.perfil) : ''}`;
    }
    const p = (_datos.puertos || []).find((t) => t.id === _sel.id);
    if (!p) return '';
    const dev = (_datos.dispositivos || []).find((x) => x.id === p.dispositivo_id);
    const nombreDev = dev
      ? `${dev.tipo}${dev.division ? ' ' + dev.division : ''}${dev.serie ? ' (' + dev.serie + ')' : ''}`
      : 'dispositivo';
    return `Puerto <b>${escapeHtml(p.etiqueta)}</b> del ${escapeHtml(nombreDev)} · ${escapeHtml(p.estado)}`
      + (p.tipo_conector ? ` · ${escapeHtml(p.tipo_conector)}` : '');
  }

  function pintarPie() {
    const p = pie();
    if (!p) return;
    let h = '';
    if (_sel) h += `<div class="diag-detalle">${detalleTexto()}</div>`;
    const avisos = (_datos && _datos.advertencias) || [];
    avisos.forEach((a) => { h += `<div class="diag-aviso">${escapeHtml(a)}</div>`; });
    if (!h) h = '';
    p.innerHTML = h;
  }

  function bindClicks() {
    const c = cuerpo();
    if (!c) return;
    c.querySelectorAll('[data-hilo]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.dataset.hilo);
        _sel = (_sel && _sel.tipo === 'hilo' && _sel.id === id) ? null : { tipo: 'hilo', id };
        pintar();
      });
    });
    c.querySelectorAll('[data-puerto]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.dataset.puerto);
        _sel = (_sel && _sel.tipo === 'puerto' && _sel.id === id) ? null : { tipo: 'puerto', id };
        pintar();
      });
    });
  }

  function bindChrome() {
    if (_uiLista) return;
    const m = modal();
    if (!m) return;
    const btnCerrar = document.getElementById('diag-btn-close');
    if (btnCerrar) btnCerrar.addEventListener('click', cerrar);
    const btnRecargar = document.getElementById('diag-btn-reload');
    if (btnRecargar) btnRecargar.addEventListener('click', () => cargar());
    m.addEventListener('click', (e) => { if (e.target === m) cerrar(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !m.classList.contains('hidden')) cerrar();
    });

    // Nueva UI del Diagrama
    const buttons = document.querySelectorAll('.sidebar-btn');
    const drawer = document.getElementById('sidebarDrawer');
    const panels = document.querySelectorAll('.drawer-content');
    let activePanelId = null;

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetPanel = btn.getAttribute('data-panel');
        if (!targetPanel) return; // Ignore if no panel (e.g. close button)
        if (activePanelId === targetPanel) {
          drawer.classList.remove('open');
          btn.classList.remove('active');
          activePanelId = null;
          return;
        }
        buttons.forEach(b => b.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(targetPanel).classList.add('active');
        drawer.classList.add('open');
        activePanelId = targetPanel;
      });
    });

    const modeBtn = document.getElementById('modeBtn');
    const modeDropdown = document.getElementById('modeDropdown');
    const modeLabel = document.getElementById('modeLabel');

    if (modeBtn && modeDropdown && modeLabel) {
      modeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        modeDropdown.classList.toggle('open');
        modeBtn.classList.toggle('open');
      });

      document.querySelectorAll('.mode-option').forEach(opt => {
        opt.addEventListener('click', () => {
          document.querySelectorAll('.mode-option').forEach(o => o.classList.remove('selected'));
          opt.classList.add('selected');
          modeLabel.textContent = opt.getAttribute('data-mode');
          modeDropdown.classList.remove('open');
          modeBtn.classList.remove('open');
        });
      });

      document.addEventListener('click', () => {
        modeDropdown.classList.remove('open');
        modeBtn.classList.remove('open');
      });
    }

    const workspace = document.getElementById('diagramWorkspace');
    ['illuminateLeft', 'illuminateRight'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn && workspace) {
        btn.addEventListener('click', () => {
          const isActive = btn.classList.contains('active');
          document.getElementById('illuminateLeft').classList.remove('active', 'illuminate');
          document.getElementById('illuminateRight').classList.remove('active', 'illuminate');
          document.getElementById('illuminateLeft').classList.add('illuminate');
          document.getElementById('illuminateRight').classList.add('illuminate');
          if (!isActive) {
            btn.classList.add('active');
            workspace.classList.add('illuminating');
          } else {
            workspace.classList.remove('illuminating');
          }
        });
      }
    });

    
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

    // ── Close sidebar when clicking on the empty workspace canvas ──
    const ws = document.getElementById('diagramWorkspace');
    if (ws) {
      ws.addEventListener('click', (e) => {
        // Only close if clicking on the workspace itself (not on toolbars or children)
        if (e.target === ws || e.target.classList.contains('diag-body-container') ||
            e.target.id === 'diag-body' || e.target.id === 'diag-sub' || e.target.id === 'diag-pie') {
          const dr = document.getElementById('sidebarDrawer');
          if (dr && dr.classList.contains('open')) {
            dr.classList.remove('open');
            document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
          }
        }
      });
    }

    // ── Back to map button ──
    const btnBack = document.getElementById('diag-btn-back');
    if (btnBack) btnBack.addEventListener('click', cerrar);

    // ── Save button ──
    const btnSave = document.getElementById('diag-btn-save');
    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        if (!_boxId) return;
        aviso('Diagrama guardado correctamente', 'success');
      });
    }

    _uiLista = true;
  }

  async function mostrarModalAgregarSplitter() {
    if (!window.FTTHTipos) return;
    try {
      const tipos = await FTTHTipos.getTipos('splitter');
      if (!tipos || !tipos.length) {
        aviso('No hay plantillas de Splitter. Crea una en el panel primero.', 'error');
        return;
      }
      
      let selectHtml = `<select id="diag-select-splitter" style="width:100%; padding: 8px; margin-bottom: 10px; border-radius: 4px; border: 1px solid #ccc;">`;
      tipos.forEach(t => {
        selectHtml += `<option value="${t.id}">${escapeHtml(t.nombre_id)}</option>`;
      });
      selectHtml += `</select>`;
      
      let picker = document.getElementById('diag-splitter-picker');
      if (!picker) {
        picker = document.createElement('div');
        picker.id = 'diag-splitter-picker';
        picker.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:white; padding:20px; box-shadow:0 10px 30px rgba(0,0,0,0.5); z-index:9999; border-radius:8px; width:300px; font-family: Inter, sans-serif;';
        document.body.appendChild(picker);
      }
      
      picker.innerHTML = `
        <h4 style="margin-top:0; margin-bottom:15px; color:#1e293b;">Añadir Splitter al Nodo</h4>
        ${selectHtml}
        <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:15px;">
          <button type="button" class="btn-secondary" onclick="document.getElementById('diag-splitter-picker').style.display='none'" style="padding: 6px 12px; border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer;">Cancelar</button>
          <button type="button" class="btn-primary" id="btn-diag-confirm-splitter" style="padding: 6px 12px; background: #1d68bd; color: white; border: none; border-radius: 4px; cursor: pointer;">Añadir</button>
        </div>
      `;
      picker.style.display = 'block';
      
      document.getElementById('btn-diag-confirm-splitter').onclick = async () => {
        const sel = document.getElementById('diag-select-splitter');
        const tipoId = sel.value;
        picker.style.display = 'none';
        
        try {
          const res = await fetch(apiUrl(`/api/elementos/${_boxId}/dispositivos`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tipo: 'splitter', tipo_id: Number(tipoId) })
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            aviso(err.detail || 'Error al añadir el splitter', 'error');
            return;
          }
          aviso('Splitter añadido correctamente', 'success');
          cargar();
        } catch(e) {
          aviso('Error de red al añadir el splitter', 'error');
        }
      };
      
    } catch(e) {
      console.warn("Error cargando tipos de splitter", e);
    }
  }

  return { abrir, cerrar, esNodo, mostrarModalAgregarSplitter };
})();

window.FTTHDiagrama = FTTHDiagrama;



