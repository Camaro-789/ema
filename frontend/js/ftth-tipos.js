/**
 * ftth-tipos.js
 * Panel de "Tipos de Objetos" (Plantillas de Red) en ventana emergente de 3 paneles:
 *   1) Categorías (menú principal)
 *   2) Formulario de creación / edición          <- segunda ventana
 *   3) Objetos registrados en la base de datos   <- tercera ventana
 * Al hacer clic en un objeto registrado se carga en el formulario en modo edición
 * y "Guardar Cambios" persiste con PUT /api/tipos/{id} (crear usa POST /api/tipos/).
 *
 * El diseño proviene de frontend/Pro..htm; la lógica y la base de datos son las
 * que ya usaba el proyecto (proyecto activo + tabla ftth_tipos), ampliada con las
 * categorías nuevas: Armario, Cables de Fibra, Switches y Fusión.
 */
const FTTHTipos = (() => {

  // ── Estado ────────────────────────────────────────────────────────────────
  let currentCategory = '';
  let editingId = null;
  let editingData = null;
  let _toastTimer = null;
  const _tiposPorCat = {};

  // ── Utilidades ────────────────────────────────────────────────────────────
  function escapeHtml(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function apiUrl(path) {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const origin = window.location.origin;
    if (origin && origin !== 'null' && !origin.includes('file://')) {
      return origin + (path.startsWith('/') ? path : '/' + path);
    }
    return 'http://127.0.0.1:8000' + (path.startsWith('/') ? path : '/' + path);
  }

  async function api(path, options = {}) {
    const metodo = (options.method || 'GET').toUpperCase();
    let url = apiUrl(path);
    if (metodo === 'GET' && window.currentProjectId && !/[?&]proyecto_id=/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + 'proyecto_id=' + encodeURIComponent(window.currentProjectId);
    }
    const res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options));
    if (!res.ok) {
      let detalle = '';
      try {
        const cuerpo = await res.json();
        if (cuerpo && cuerpo.detail) {
          detalle = typeof cuerpo.detail === 'string' ? cuerpo.detail : JSON.stringify(cuerpo.detail);
        }
      } catch (e) { /* respuesta sin JSON */ }
      throw new Error(detalle || ('Error ' + res.status));
    }
    if (res.status === 204) return null;
    const texto = await res.text();
    return texto ? JSON.parse(texto) : null;
  }

  // ── Opciones de los <select> ──────────────────────────────────────────────
  const OP = {
    material: ['Concreto', 'Madera', 'Hierro / Metal', 'Fibra de vidrio'],
    tipoPoste: ['Sencillo', 'Tipo H', 'Doble', 'Con tirantes/vientos'],
    capacidadNap: ['8 Puertos', '16 Puertos', '32 Puertos'],
    instalacion: ['Aérea en Poste', 'Aérea en Guaya', 'Fachada', 'Cámara Subterránea'],
    splitterInterno: ['1x8 PLC', '1x16 PLC', '2x16 PLC', 'Sin Splitter'],
    tipoManga: ['Aérea', 'Subterránea', 'Pared / Foso'],
    capacidadFusion: ['24 hilos', '48 hilos', '96 hilos', '144 hilos'],
    estado: ['Operativa', 'Mantenimiento', 'Saturada'],
    tipoDucto: ['HDPE', 'PVC', 'Tubería Metálica', 'Trinchera Directa'],
    nivelArmario: [
      { v: 'olt_hub', t: 'OLT HUB' },
      { v: 'pop_secundario', t: 'POP SECUNDARIO' },
      { v: 'distribucion', t: 'DISTRIBUCIÓN' }
    ],
    nivelCable: [
      { v: 'derivaciones', t: 'DERIVACIONES (2LVL)' },
      { v: 'troncal', t: 'TRONCAL (1LVL)' },
      { v: 'acceso', t: 'ACCESO / DROPS' }
    ],
    perfilFibra: [
      { v: 'eia598a', t: 'Perfil EIA598-A' },
      { v: 'custom', t: 'Perfil Personalizado' }
    ],
    propiedad: [
      { v: 'publica', t: 'Pública' },
      { v: 'privada', t: 'Privada' }
    ],
    tipoIO: [
      { v: 'fusion_fusion', t: 'Fusión / Fusión' },
      { v: 'fusion_conector', t: 'Fusión / Conector' },
      { v: 'conector_fusion', t: 'Conector / Fusión' },
      { v: 'conector_conector', t: 'Conector / Conector' }
    ]
  };

  // ── Categorías (clave en BD) + formulario de cada una ─────────────────────
  // w: 'full' | 'half' | 'third'  ·  fieldset: agrupador con leyenda
  const CATS = [
    {
      clave: 'poste', titulo: 'Postes', color: '#8b4513', campoClave: 'codigo', campoDesc: 'desc',
      campos: [
        { id: 'nombre', label: 'Nombre', type: 'text', ph: 'Escribe el nombre...', w: 'full' },
        { id: 'codigo', label: 'Código', type: 'text', ph: 'POST-01', w: 'full' },
        { id: 'material', label: 'Material', type: 'select', options: OP.material, w: 'half' },
        { id: 'altura_m', label: 'Altura (m)', type: 'number', step: '0.1', def: '9', w: 'half' },
        { id: 'tipo_poste', label: 'Tipo de poste', type: 'select', options: OP.tipoPoste, w: 'full' },
        { id: 'desc', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' }
      ]
    },
    {
      clave: 'cajanap', titulo: 'Cajas NAP', color: '#eab308', campoClave: 'codigo', campoDesc: 'desc',
      campos: [
        { id: 'nombre', label: 'Nombre', type: 'text', ph: 'Escribe el nombre...', w: 'full' },
        { id: 'codigo', label: 'Código', type: 'text', ph: 'NAP-01', w: 'full' },
        { id: 'capacidad_puertos', label: 'Capacidad', type: 'select', options: OP.capacidadNap, w: 'half' },
        { id: 'puertos_ocupados', label: 'Puertos ocupados (inicial)', type: 'number', def: '0', w: 'half' },
        { id: 'tipo_instalacion', label: 'Instalación', type: 'select', options: OP.instalacion, w: 'full' },
        { id: 'splitter_interno', label: 'Splitter interno', type: 'select', options: OP.splitterInterno, w: 'full' },
        { id: 'desc', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' }
      ]
    },
    {
      clave: 'manga', titulo: 'Mangas de Empalme', color: '#a855f7', campoClave: 'codigo', campoDesc: 'desc',
      campos: [
        { id: 'nombre', label: 'Nombre', type: 'text', ph: 'Escribe el nombre...', w: 'full' },
        { id: 'codigo', label: 'Código', type: 'text', ph: 'MAN-01', w: 'full' },
        { id: 'tipo_manga', label: 'Tipo', type: 'select', options: OP.tipoManga, w: 'half' },
        { id: 'capacidad_fusion', label: 'Capacidad de fusión', type: 'select', options: OP.capacidadFusion, w: 'half' },
        { id: 'puertos_entrada', label: 'Puertos de entrada', type: 'number', def: '4', w: 'half' },
        { id: 'estado', label: 'Estado', type: 'select', options: OP.estado, w: 'half' },
        { id: 'desc', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' }
      ]
    },
    {
      clave: 'armario', titulo: 'Armario', color: '#008000', campoClave: 'nombre', campoDesc: 'desc',
      campos: [
        { id: 'nombre', label: 'Nombre:', type: 'text', ph: 'Comum', w: 'full' },
        { id: 'prefijo', label: 'Prefijo:', type: 'text', ph: 'CO_', w: 'full' },
        { id: 'nivel', label: 'Nivel estándar:', type: 'select', options: OP.nivelArmario, w: 'full' },
        { id: 'desc', label: 'Descripción:', type: 'textarea', ph: 'Tipo padrão de POP', w: 'full' },
        {
          fieldset: 'Representación de estado',
          campos: [
            { id: 'colorImp', label: 'Implantada:', type: 'color', def: '#008000', w: 'third', small: true },
            { id: 'colorNoImp', label: 'No implantada:', type: 'color', def: '#78909c', w: 'third', small: true },
            { id: 'colorProj', label: 'En proyecto:', type: 'color', def: '#ff00ff', w: 'third', small: true }
          ]
        }
      ]
    },
    {
      clave: 'cables', titulo: 'Cables de Fibra', color: '#0284c7', campoClave: 'codigo', campoDesc: 'desc',
      campos: [
        { id: 'codigo', label: 'Código', type: 'text', ph: 'ADSS 144H 12 Buffers', w: 'full' },
        { id: 'marca', label: 'Marca', type: 'text', ph: 'Marca del tipo de cable', w: 'half' },
        { id: 'modelo', label: 'Modelo', type: 'text', ph: 'Modelo de tipo de cable', w: 'half' },
        { id: 'nivel', label: 'Nivel estándar', type: 'select', options: OP.nivelCable, w: 'full' },
        { id: 'looses', label: 'Número de looses', type: 'number', ph: '12', w: 'half' },
        { id: 'fibras', label: 'Número total de fibras', type: 'number', ph: '144', w: 'half' },
        { id: 'atenuacion', label: 'Atenuación por Km (dB)', type: 'number', ph: '0.4', step: '0.1', w: 'half' },
        { id: 'fibrasLoose', label: 'Fibras por loose', type: 'number', ph: '12', w: 'half' },
        { id: 'perfil', label: 'Perfil de fibra', type: 'select', options: OP.perfilFibra, w: 'full' },
        { id: 'desc', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' },
        {
          fieldset: 'Representación del cable implantado',
          campos: [
            { id: 'colorImp', label: 'Color:', type: 'color', def: '#000000', w: 'half' },
            { id: 'grosorImp', label: 'Grosor:', type: 'number', ph: '5.61', step: '0.01', w: 'half' }
          ]
        },
        {
          fieldset: 'Representación del cable no implantado',
          campos: [
            { id: 'colorNoImp', label: 'Color:', type: 'color', def: '#4b5563', w: 'half' },
            { id: 'grosorNoImp', label: 'Grosor:', type: 'number', ph: '5.61', step: '0.01', w: 'half' }
          ]
        }
      ]
    },
    {
      clave: 'ducto', titulo: 'Ductos / Canalización', color: '#ff5722', campoClave: 'codigo', campoDesc: 'desc',
      campos: [
        { id: 'nombre', label: 'Nombre', type: 'text', ph: 'Escribe el nombre...', w: 'full' },
        { id: 'codigo', label: 'Código', type: 'text', ph: 'DUCT-01', w: 'full' },
        { id: 'tipo_ducto', label: 'Tipo de ducto', type: 'select', options: OP.tipoDucto, w: 'full' },
        { id: 'desc', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' }
      ]
    },
    {
      clave: 'luminaria', titulo: 'Luminarias', color: '#eab308', campoClave: 'codigo', campoDesc: 'desc',
      campos: [
        { id: 'nombre', label: 'Nombre', type: 'text', ph: 'Escribe el nombre...', w: 'full' },
        { id: 'codigo', label: 'Código', type: 'text', ph: 'Escribe el código...', w: 'full' },
        { id: 'desc', label: 'Descripción', type: 'text', ph: 'Escribe la descripción...', w: 'full' },
        { id: 'propiedad', label: 'Propiedad', type: 'select', options: OP.propiedad, placeholderOption: 'Seleccione pública o privada', w: 'full' }
      ]
    },
    {
      clave: 'odf', titulo: 'ODF', color: '#8b5cf6', campoClave: 'codigo', campoDesc: 'desc',
      campos: [
        { id: 'codigo', label: 'Código', type: 'text', ph: 'Escribe el código del tipo de ODF', w: 'full' },
        { id: 'marca', label: 'Marca', type: 'text', ph: 'Escribe la marca del tipo de ODF', w: 'half' },
        { id: 'modelo', label: 'Modelo', type: 'text', ph: 'Escribe el modelo del tipo de ODF', w: 'half' },
        { id: 'puertos', label: 'Total de puertos', type: 'number', ph: '0', w: 'half' },
        { id: 'bandejas', label: 'Número de bandejas', type: 'number', ph: '0', w: 'half' },
        { id: 'tagA', label: 'Etiqueta del lado A', type: 'text', ph: 'Lado A', w: 'half' },
        { id: 'tagB', label: 'Etiqueta del lado B', type: 'text', ph: 'Lado B', w: 'half' },
        { id: 'atenuacion', label: 'Atenuación', type: 'number', ph: '0', step: '0.1', w: 'half' },
        { id: 'tamano', label: 'Tamaño (U)', type: 'number', ph: '1', w: 'half' },
        { id: 'desc', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' }
      ]
    },
    {
      clave: 'olt', titulo: 'OLT', color: '#ef4444', campoClave: 'codigo', campoDesc: 'descripcion', slots: { def: 2 },
      campos: [
        { id: 'codigo', label: 'Código', type: 'text', ph: 'Ej: ZTE C320', w: 'full' },
        { id: 'marca', label: 'Marca', type: 'text', ph: 'Ej: ZTE', w: 'half' },
        { id: 'modelo', label: 'Modelo', type: 'text', ph: 'Ej: ZTE C320', w: 'half' },
        { id: 'maxClientes', label: 'Máximo de clientes estándar por puerto', type: 'number', ph: 'Ej: 128', w: 'half' },
        { id: 'potencia', label: 'Potencia estándar por puerto', type: 'number', ph: 'Ej: 6', w: 'half' },
        { id: 'descripcion', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' },
        { id: 'numSlots', label: 'Número de Slots', type: 'number', ph: 'Ej: 2', def: '2', min: 1, max: 32, step: '1', oninput: 'FTTHTipos.updateSlotsTable(this.value)', w: 'half' },
        { id: 'tamano', label: 'Tamaño (U)', type: 'number', ph: 'Ej: 2', def: '2', min: 1, max: 16, step: '1', w: 'half' }
      ]
    },
    {
      clave: 'switches', titulo: 'Switches', color: '#6366f1', campoClave: 'codigo', campoDesc: 'desc',
      campos: [
        { id: 'codigo', label: 'Código', type: 'text', ph: 'Switch 24', w: 'full' },
        { id: 'marca', label: 'Marca', type: 'text', ph: 'Marca del tipo de switch', w: 'half' },
        { id: 'modelo', label: 'Modelo', type: 'text', ph: 'Modelo del tipo de switch', w: 'half' },
        { id: 'cliente', label: 'Permite conexión del cliente', type: 'checkbox', w: 'half' },
        { id: 'puertos', label: 'Número de puertos', type: 'number', ph: '24', w: 'half' },
        { id: 'administrable', label: 'Administrable', type: 'checkbox', w: 'half' },
        { id: 'tamano', label: 'Tamaño (U)', type: 'number', ph: '1', w: 'half' },
        { id: 'desc', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' }
      ]
    },
    {
      clave: 'splitter', titulo: 'Splitters', color: '#06b6d4', campoClave: 'codigo', campoDesc: 'desc',
      campos: [
        { id: 'codigo', label: 'Código', type: 'text', ph: 'Código del tipo de splitter', w: 'full' },
        { id: 'marca', label: 'Marca', type: 'text', ph: 'Marca del tipo de splitter', w: 'half' },
        { id: 'modelo', label: 'Modelo', type: 'text', ph: 'Modelo del tipo de splitter', w: 'half' },
        { id: 'prefijo', label: 'Prefijo', type: 'text', ph: 'Prefijo para la nomenclatura', w: 'half' },
        { id: 'tamano', label: 'Tamaño (U)', type: 'number', ph: '1', w: 'half' },
        { id: 'tipoIO', label: 'Tipo de entrada/salida', type: 'select', options: OP.tipoIO, placeholderOption: 'Seleccione opción...', w: 'half' },
        { id: 'balanceado', label: 'Splitter balanceado', type: 'checkbox', w: 'half' },
        { id: 'cliente', label: 'Permite conexión del cliente', type: 'checkbox', w: 'half' },
        { id: 'entradas', label: 'Número de entradas', type: 'number', ph: '1', w: 'half' },
        { id: 'atenuacion', label: 'Atenuación (dB)', type: 'number', ph: 'Ej: 3.5', step: '0.1', w: 'half' },
        { id: 'salidas', label: 'Número de salidas', type: 'number', ph: '2', w: 'half' },
        { id: 'desc', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' }
      ]
    },
    {
      clave: 'fusion', titulo: 'Fusión', color: '#ec4899', campoClave: 'codigo', campoDesc: 'desc',
      campos: [
        { id: 'codigo', label: 'Código:', type: 'text', ph: 'Escribe el código del tipo de fusión...', w: 'full' },
        { id: 'cliente', label: 'Permite conexión del cliente:', type: 'checkbox', w: 'half' },
        { id: 'atenuacion', label: 'Atenuación (dB):', type: 'number', def: '0.1', step: '0.01', ph: '0.1', w: 'half' }
      ]
    }
  ];

  const CATS_MAP = {};
  CATS.forEach(c => { CATS_MAP[c.clave] = c; });

  const ICONO_PAPELERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>';

  // ── Render del formulario dinámico (Panel 2) ──────────────────────────────
  function valorInicial(f, data) {
    if (data && data[f.id] !== undefined && data[f.id] !== null && data[f.id] !== '') return data[f.id];
    return f.def !== undefined ? f.def : '';
  }

  function campoHtml(f, data) {
    const val = valorInicial(f, data);
    const id = 'f_' + f.id;

    if (f.type === 'checkbox') {
      return `<div class="checkbox-group"><input type="checkbox" id="${id}" ${val ? 'checked' : ''}>`
        + `<label for="${id}">${f.label}</label></div>`;
    }

    if (f.type === 'color') {
      const estiloLabel = f.small ? 'margin-bottom:0; font-size:11px;' : 'margin-bottom:0;';
      return `<div class="form-group" style="margin-bottom:0; display:flex; align-items:center; gap:8px;">`
        + `<label style="${estiloLabel}">${f.label}</label>`
        + `<input type="color" class="color-picker-input" id="${id}" value="${escapeHtml(val || '#000000')}"></div>`;
    }

    let control;
    if (f.type === 'select') {
      const ops = [];
      if (f.placeholderOption) {
        const vacio = (val === '' || val === null || val === undefined);
        ops.push(`<option value="" disabled ${vacio ? 'selected' : ''}>${f.placeholderOption}</option>`);
      }
      (f.options || []).forEach(op => {
        const v = typeof op === 'string' ? op : op.v;
        const t = typeof op === 'string' ? op : op.t;
        ops.push(`<option value="${escapeHtml(v)}" ${String(val) === String(v) ? 'selected' : ''}>${t}</option>`);
      });
      control = `<select class="form-control" id="${id}">${ops.join('')}</select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea class="form-control" id="${id}" placeholder="${escapeHtml(f.ph || '')}">${escapeHtml(val)}</textarea>`;
    } else {
      const extra = (f.step !== undefined ? ` step="${f.step}"` : '')
        + (f.min !== undefined ? ` min="${f.min}"` : '')
        + (f.max !== undefined ? ` max="${f.max}"` : '')
        + (f.oninput ? ` oninput="${f.oninput}"` : '');
      control = `<input type="${f.type || 'text'}" class="form-control" id="${id}" value="${escapeHtml(val)}" placeholder="${escapeHtml(f.ph || '')}"${extra}>`;
    }
    return `<div class="form-group"><label>${f.label}</label>${control}</div>`;
  }

  // Agrupa campos consecutivos con el mismo ancho en .row-2col / .row-3col
  function renderCampos(campos, data) {
    let html = '';
    let i = 0;
    while (i < campos.length) {
      const f = campos[i];
      if (f.fieldset) {
        html += `<fieldset class="fieldset-box"><legend>${f.fieldset}</legend>${renderCampos(f.campos, data)}</fieldset>`;
        i++;
        continue;
      }
      const ancho = f.w || 'full';
      if (ancho === 'full') { html += campoHtml(f, data); i++; continue; }

      const max = ancho === 'third' ? 3 : 2;
      const grupo = [];
      while (i < campos.length && !campos[i].fieldset && (campos[i].w || 'full') === ancho && grupo.length < max) {
        grupo.push(campos[i]);
        i++;
      }
      const hayCheckbox = grupo.some(g => g.type === 'checkbox');
      const hayColor = grupo.some(g => g.type === 'color');
      const estiloFila = hayColor ? ' style="align-items: center;"'
        : (hayCheckbox && grupo.length > 1 ? ' style="align-items: flex-end;"' : '');
      const claseFila = ancho === 'third' ? 'row-3col' : 'row-2col';
      html += `<div class="${claseFila}"${estiloFila}>${grupo.map(g => campoHtml(g, data)).join('')}</div>`;
    }
    return html;
  }

  function renderFormFields(clave, data) {
    const cfg = CATS_MAP[clave];
    const cont = document.getElementById('dynamic-form');
    if (!cfg || !cont) return;

    const btnText = data ? 'Guardar Cambios' : 'Guardar';
    let html = renderCampos(cfg.campos, data);

    if (cfg.slots) {
      html += `
        <table class="slots-table">
          <thead>
            <tr>
              <th>Número de Slot</th>
              <th>Número de puertos</th>
              <th>Índice inicial de puertos</th>
            </tr>
          </thead>
          <tbody id="slots-table-body"></tbody>
        </table>`;
    }

    html += `<button class="btn-submit" onclick="FTTHTipos.handleSave()">${btnText}</button>`;
    cont.innerHTML = html;

    if (cfg.slots) {
      const total = (data && data.slots) ? data.slots : (cfg.slots.def || 2);
      updateSlotsTable(total, data ? data.slots_detalle : null);
    }
  }

  function updateSlotsTable(numSlots, detalle) {
    const tbody = document.getElementById('slots-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    let count = parseInt(numSlots, 10);
    if (!Number.isFinite(count) || count < 1) count = 1;
    if (count > 32) count = 32;

    for (let i = 1; i <= count; i++) {
      const fila = document.createElement('tr');
      const d = (detalle && detalle[i - 1]) || {};
      fila.innerHTML = `
        <td><input type="number" value="${d.slot !== undefined ? d.slot : i}" min="1"></td>
        <td><input type="number" value="${d.puertos !== undefined ? d.puertos : 16}" placeholder="16"></td>
        <td><input type="number" value="${d.indice !== undefined ? d.indice : 1}" placeholder="1"></td>`;
      tbody.appendChild(fila);
    }
  }

  function leerCampos(campos, salida) {
    campos.forEach(f => {
      if (f.fieldset) { leerCampos(f.campos, salida); return; }
      const el = document.getElementById('f_' + f.id);
      if (!el) return;
      if (f.type === 'checkbox') {
        salida[f.id] = !!el.checked;
      } else if (f.type === 'number') {
        const txt = String(el.value || '').trim();
        const num = Number(txt);
        salida[f.id] = (txt === '' || !Number.isFinite(num)) ? null : num;
      } else {
        salida[f.id] = el.value;
      }
    });
    return salida;
  }

  function leerSlotsDetalle() {
    const tbody = document.getElementById('slots-table-body');
    if (!tbody) return [];
    return Array.from(tbody.querySelectorAll('tr')).map(tr => {
      const ins = tr.querySelectorAll('input');
      const leer = idx => {
        const v = ins[idx] ? Number(ins[idx].value) : 0;
        return Number.isFinite(v) ? v : 0;
      };
      return { slot: leer(0), puertos: leer(1), indice: leer(2) };
    });
  }

  // ── Panel 3: objetos registrados en la base de datos ──────────────────────
  function camposPlanos(cfg) {
    const lista = [];
    (cfg.campos || []).forEach(f => {
      if (f.fieldset) { (f.campos || []).forEach(g => lista.push(g)); return; }
      lista.push(f);
    });
    return lista;
  }

  function etiquetaCampo(label) {
    return String(label || '').replace(/[:：]\s*$/, '');
  }

  function resumenTipo(cfg, rec) {
    const props = rec.propiedades || {};
    const partes = [];
    for (const f of camposPlanos(cfg)) {
      if (partes.length >= 3) break;
      if (f.type === 'color' || f.type === 'textarea') continue;
      if (f.id === cfg.campoClave || f.id === 'numSlots') continue;
      const valor = props[f.id];
      if (valor === undefined || valor === null || valor === '') continue;
      let texto = valor;
      if (typeof valor === 'boolean') {
        texto = valor ? 'Sí' : 'No';
      } else if (f.type === 'select') {
        const op = (f.options || []).find(o => String(typeof o === 'string' ? o : o.v) === String(valor));
        if (op && typeof op !== 'string') texto = op.t;
      }
      partes.push(`${etiquetaCampo(f.label)}: ${texto}`);
    }
    return partes.join(' | ') || 'Sin parámetros adicionales';
  }

  function formularioDesdeRegistro(rec) {
    const cfg = CATS_MAP[rec.categoria] || {};
    const data = Object.assign({}, rec.propiedades || {});
    if (cfg.campoClave) data[cfg.campoClave] = rec.nombre_id;
    if (cfg.campoDesc) data[cfg.campoDesc] = rec.observaciones || '';
    return data;
  }

  async function cargarTiposRegistrados(clave) {
    const cfg = CATS_MAP[clave];
    const cont = document.getElementById('type-list');
    if (!cfg || !cont) return;

    cont.innerHTML = '<div class="type-empty">Consultando base de datos...</div>';
    try {
      const tipos = await api(`/api/tipos/${clave}`);
      _tiposPorCat[clave] = Array.isArray(tipos) ? tipos : [];

      if (!_tiposPorCat[clave].length) {
        cont.innerHTML = `<div class="type-empty">Sin plantillas guardadas.<br>Completa el formulario y pulsa <b>Guardar</b> para registrar la primera de <b>${cfg.titulo}</b>.</div>`;
        return;
      }

      cont.innerHTML = '';
      _tiposPorCat[clave].forEach(rec => {
        const card = document.createElement('div');
        card.className = 'type-card';
        card.setAttribute('data-id', rec.id);
        card.innerHTML = `
          <div class="type-card-title">
            <span class="color-badge" style="background: ${rec.color_mapa || cfg.color};"></span>
            ${escapeHtml(rec.nombre_id || 'Sin nombre')}
          </div>
          <div class="type-card-desc">${escapeHtml(resumenTipo(cfg, rec))}</div>
          <button type="button" class="card-del-btn" title="Eliminar de la base de datos">${ICONO_PAPELERA}</button>`;
        card.addEventListener('click', () => editItemById(rec.id, card));
        const btnDel = card.querySelector('.card-del-btn');
        if (btnDel) btnDel.addEventListener('click', ev => { ev.stopPropagation(); deleteTipo(rec.id); });
        cont.appendChild(card);
      });
    } catch (err) {
      cont.innerHTML = `<div class="type-empty">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  // ── Navegación entre paneles ─────────────────────────────────────────────
  function resetFormToCreateMode() {
    const cfg = CATS_MAP[currentCategory];
    editingId = null;
    editingData = null;
    const titulo = document.getElementById('selected-title');
    const tituloReg = document.getElementById('registered-title');
    if (titulo) titulo.innerText = 'Crear Tipo de ' + (cfg ? cfg.titulo : '');
    if (tituloReg) tituloReg.innerText = (cfg ? cfg.titulo : 'Objetos') + ' Registrados';
    document.querySelectorAll('#ftth-tipos-modal .type-card').forEach(c => c.classList.remove('selected'));
    renderFormFields(currentCategory, null);
  }

  // Clic sobre un objeto registrado (tercera ventana): carga el formulario en modo edición
  function editItemById(tipoId, cardEl) {
    const rec = (_tiposPorCat[currentCategory] || []).find(t => Number(t.id) === Number(tipoId));
    if (!rec) return;
    document.querySelectorAll('#ftth-tipos-modal .type-card').forEach(c => c.classList.remove('selected'));
    if (cardEl) cardEl.classList.add('selected');
    editingId = rec.id;
    editingData = rec;
    const titulo = document.getElementById('selected-title');
    if (titulo) titulo.innerText = 'Editar ' + (rec.nombre_id || 'Objeto');
    renderFormFields(currentCategory, formularioDesdeRegistro(rec));
  }

  async function openSubpanel(clave, event) {
    if (!CATS_MAP[clave]) return;
    currentCategory = clave;
    editingId = null;
    editingData = null;

    const sub = document.getElementById('subpanel');
    const reg = document.getElementById('registeredPanel');
    if (sub) sub.classList.add('open');
    if (reg) reg.classList.add('open');

    document.querySelectorAll('#ftth-tipos-modal .object-btn').forEach(b => b.classList.remove('active'));
    const btn = (event && event.currentTarget) || document.querySelector(`#ftth-tipos-modal .object-btn[data-cat="${clave}"]`);
    if (btn) btn.classList.add('active');

    resetFormToCreateMode();
    await cargarTiposRegistrados(clave);
  }

  function closeSubpanel() {
    const sub = document.getElementById('subpanel');
    const reg = document.getElementById('registeredPanel');
    if (sub) sub.classList.remove('open');
    if (reg) reg.classList.remove('open');
    document.querySelectorAll('#ftth-tipos-modal .object-btn').forEach(b => b.classList.remove('active'));
    editingId = null;
    editingData = null;
  }

  function openModal(categoria) {
    if (!window.currentProjectId) {
      alert('⚠️ Selecciona o crea un proyecto en la barra superior antes de gestionar tipos.');
      return;
    }
    const modal = document.getElementById('ftth-tipos-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    if (categoria && CATS_MAP[categoria]) {
      openSubpanel(categoria, null);
    } else {
      closeSubpanel();
    }
  }

  function closeModal() {
    const modal = document.getElementById('ftth-tipos-modal');
    if (modal) modal.classList.add('hidden');
    closeSubpanel();
  }

  // ── Guardar (crear o editar) en la base de datos ─────────────────────────
  async function handleSave() {
    const cfg = CATS_MAP[currentCategory];
    if (!cfg) return;

    if (!window.currentProjectId) {
      showToast('Selecciona o crea un proyecto antes de guardar', 'error');
      return;
    }

    const valores = leerCampos(cfg.campos, {});
    const detallesSlots = cfg.slots ? leerSlotsDetalle() : null;
    const totalSlots = cfg.slots ? (Number(valores.numSlots) || 1) : null;
    delete valores.numSlots;

    const nombre = String(valores[cfg.campoClave] || valores.nombre || valores.codigo || '').trim();
    if (!nombre) {
      showToast('Escribe el nombre o código del tipo', 'error');
      return;
    }

    const propiedades = {};
    Object.keys(valores).forEach(k => {
      if (k === cfg.campoClave || k === cfg.campoDesc) return;
      propiedades[k] = valores[k];
    });
    if (cfg.slots) {
      propiedades.slots = totalSlots;
      propiedades.slots_detalle = detallesSlots;
    }

    const payload = {
      proyecto_id: Number(window.currentProjectId),
      categoria: currentCategory,
      nombre_id: nombre,
      color_mapa: (editingData && editingData.color_mapa) || cfg.color,
      foto: (editingData && editingData.foto) || null,
      observaciones: valores[cfg.campoDesc] || null,
      // Conserva las propiedades previas que no gestiona el formulario
      propiedades: Object.assign({}, (editingData && editingData.propiedades) || {}, propiedades)
    };

    try {
      if (editingId) {
        await api(`/api/tipos/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('¡Cambios guardados en la base de datos!');
      } else {
        await api('/api/tipos/', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Tipo registrado en la base de datos');
      }
      await cargarTiposRegistrados(currentCategory);
      resetFormToCreateMode();
    } catch (err) {
      showToast('Error al guardar: ' + err.message, 'error');
    }
  }

  async function deleteTipo(id) {
    if (!confirm('¿Eliminar este tipo de objeto de la base de datos?')) return;
    try {
      await api(`/api/tipos/${id}`, { method: 'DELETE' });
      showToast('Tipo eliminado de la base de datos');
      if (currentCategory) await cargarTiposRegistrados(currentCategory);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Toast flotante (lo comparten Tipos, Carpetas y Mapa) ─────────────────
  function showToast(msg, type) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.toggle('toast-error', type === 'error');
    toast.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  }

  // ── API pública ──────────────────────────────────────────────────────────
  function getCategorias() {
    const salida = {};
    CATS.forEach(c => { salida[c.clave] = c; });
    return salida;
  }

  async function getTipos(categoria) {
    if (!window.currentProjectId || !CATS_MAP[categoria]) return [];
    return await api(`/api/tipos/${categoria}`);
  }

  function init() {
    const modal = document.getElementById('ftth-tipos-modal');
    if (modal) {
      modal.addEventListener('click', ev => { if (ev.target === modal) closeModal(); });
    }
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && modal && !modal.classList.contains('hidden')) closeModal();
    });
    document.addEventListener('project-changed', () => {
      if (currentCategory && modal && !modal.classList.contains('hidden')) {
        cargarTiposRegistrados(currentCategory);
      }
    });
  }

  return {
    init,
    openModal,
    closeModal,
    openSubpanel,
    closeSubpanel,
    editItemById,
    handleSave,
    resetFormToCreateMode,
    updateSlotsTable,
    getCategorias,
    getTipos,
    showToast,
    deleteTipo,
    CATS,
    _setActiveTab: (cat) => openModal(cat)
  };
})();

window.FTTHTipos = FTTHTipos;
