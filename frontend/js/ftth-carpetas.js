/**
 * ftth-carpetas.js
 * Panel derecho: árbol de carpetas con drag & drop, visibilidad de capas.
 *
 * Depende de:
 *   - MapLibre GL JS (window.map)
 *   - FTTHTipos.showToast
 */

const FTTHCarpetas = (() => {

  // ── Estado ────────────────────────────────────────────────────────────────

  let _carpetasData = [];    // árbol completo recibido de la API
  let _dragSrc = null;       // { tipo: 'carpeta'|'elemento', id, elementoTipo?, elementoId? }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function apiUrl(path) {
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const origin = window.location.origin;
    if (origin && origin !== 'null' && !origin.includes('file://')) {
      return origin + (path.startsWith('/') ? path : '/' + path);
    }
    return 'http://127.0.0.1:8000' + (path.startsWith('/') ? path : '/' + path);
  }

  function api(path, opts = {}) {
    const pid = window.currentProjectId;
    if (pid) {
      if (!opts.method || opts.method === 'GET') {
        path += (path.includes('?') ? '&' : '?') + 'proyecto_id=' + pid;
      } else if (opts.body && typeof opts.body === 'string' && (opts.method === 'POST' || opts.method === 'PUT')) {
        const payload = JSON.parse(opts.body);
        payload.proyecto_id = Number(pid);
        opts.body = JSON.stringify(payload);
      }
    }
    return fetch(apiUrl(path), opts).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || `Error ${r.status}`);
      return data;
    });
  }

  function getMap() { return window.map; }

  // Íconos: fuente única en FTTHIconos (assets/icons/<categoria>.svg)
  function iconoDe(tipo, size = 18) {
    if (window.FTTHIconos) return FTTHIconos.imgHtml(tipo, size);
    return '';
  }

  const OBJECT_LABELS = Object.freeze({
    poste: 'Poste',
    post: 'Poste',
    cajanap: 'Caja NAP',
    caja: 'Caja',
    manga: 'Manga',
    ducto: 'Ducto',
    luminaria: 'Luminaria',
    odf: 'ODF',
    olt: 'OLT',
    splitter: 'Splitter'
  });

  // ── Carga y render ────────────────────────────────────────────────────────

  async function loadCarpetas() {
    if (!window.currentProjectId) return;
    try {
      const [carpetas, elementosGeojson] = await Promise.all([
        api('/api/carpetas'),
        fetch(apiUrl(`/api/elementos/todos?proyecto_id=${window.currentProjectId}&_t=${Date.now()}`), { cache: 'no-store' })
          .then(r => r.json())
      ]);
      _carpetasData = carpetas;
      
      // Recolectar todos los IDs de elementos ya asignados a alguna carpeta
      const asignados = new Set();
      function traverse(list) {
        for (const c of list) {
          c.elementos.forEach(e => asignados.add(Number(e.elemento_id)));
          if (c.subcarpetas) traverse(c.subcarpetas);
        }
      }
      traverse(_carpetasData);

      // Los elementos sin asignar son los que no están en ninguna carpeta
      const features = (elementosGeojson && elementosGeojson.features) || [];
      const sinAsignar = features.filter(f => !asignados.has(Number(f.properties.id)));

      renderArbol(sinAsignar);
      updateMapFilter();
    } catch (err) {
      console.error('Error cargando capas:', err);
    }
  }

  function renderArbol(elementosSinAsignar = []) {
    const tree = document.getElementById('folders-tree');
    if (!tree) return;
    tree.innerHTML = '';
    
    // Contenedor principal de la raíz para dropear
    const rootUl = document.createElement('ul');
    rootUl.className = 'folder-tree';
    
    // Permitir soltar en la raíz (para sacarlos de las carpetas)
    rootUl.addEventListener('dragover', e => e.preventDefault());
    rootUl.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      if (_dragSrc && _dragSrc.tipo === 'elemento') {
         // Sacar el elemento de su carpeta actual, es decir, moverlo a null (o borrar su relación)
         if (_dragSrc.carpetaId) {
            unlinkElemento(_dragSrc.carpetaId, _dragSrc.elementoTipo, _dragSrc.elementoId);
         }
      }
    });

    if (!_carpetasData.length && !elementosSinAsignar.length) {
      tree.innerHTML = `<p class="empty-state">No hay carpetas ni elementos aún. Crea uno para empezar.</p>`;
      return;
    }

    _carpetasData.forEach(c => rootUl.appendChild(renderNodo(c)));

    if (elementosSinAsignar.length > 0) {
      const sinCarpetaDiv = document.createElement('div');
      sinCarpetaDiv.style.marginTop = '15px';
      sinCarpetaDiv.style.fontWeight = 'bold';
      sinCarpetaDiv.style.color = '#666';
      sinCarpetaDiv.style.fontSize = '0.9em';
      sinCarpetaDiv.textContent = `Elementos sin carpeta (${elementosSinAsignar.length})`;
      rootUl.appendChild(sinCarpetaDiv);

      const unassignedUl = document.createElement('ul');
      unassignedUl.className = 'folder-children';
      elementosSinAsignar.forEach(f => {
        unassignedUl.appendChild(renderElementoNodo({
          elemento_tipo: f.properties.categoria,
          elemento_id: f.properties.id
        }, null)); // null = sin carpeta
      });
      rootUl.appendChild(unassignedUl);
    }

    tree.appendChild(rootUl);
  }

  function renderNodo(carpeta) {
    const li = document.createElement('li');
    li.className = 'folder-node';
    li.dataset.carpetaId = carpeta.id;
    li.draggable = true;

    // Encabezado
    const header = document.createElement('div');
    header.className = 'folder-node-header';
    header.innerHTML = `
      <input type="checkbox" class="folder-vis-check" ${carpeta.visible ? 'checked' : ''}
             title="Mostrar/ocultar en mapa">
      <span class="folder-toggle">${carpeta.subcarpetas.length || carpeta.elementos.length ? '▾' : '·'}</span>
      <span class="folder-name">${escapeHTML(carpeta.nombre)}</span>
      <div class="folder-actions">
        <button class="btn-icon" data-action="add-sub" title="Nueva subcarpeta">+</button>
        <button class="btn-icon" data-action="rename"  title="Renombrar">✎</button>
        <button class="btn-icon btn-danger" data-action="delete" title="Eliminar">✕</button>
      </div>`;
    li.appendChild(header);

    // Contenedor de hijos (subarpetas + elementos)
    const children = document.createElement('ul');
    children.className = 'folder-children';
    if (carpeta.subcarpetas.length || carpeta.elementos.length) {
      carpeta.subcarpetas.forEach(sub => children.appendChild(renderNodo(sub)));
      carpeta.elementos.forEach(el => children.appendChild(renderElementoNodo(el, carpeta.id)));
    }
    li.appendChild(children);

    // ── Eventos ──

    // Visibilidad
    header.querySelector('.folder-vis-check').addEventListener('change', e => {
      toggleVisibilidadCarpeta(carpeta, e.target.checked);
    });

    // Toggle expand
    header.querySelector('.folder-toggle').addEventListener('click', () => {
      children.classList.toggle('collapsed');
    });

    // Acciones
    header.querySelector('[data-action="add-sub"]').addEventListener('click', () => addSubcarpeta(carpeta.id));
    header.querySelector('[data-action="rename"]').addEventListener('click', () => renameCarpeta(carpeta));
    header.querySelector('[data-action="delete"]').addEventListener('click', () => deleteCarpeta(carpeta.id, carpeta.nombre));

    // Drag & drop (carpeta)
    li.addEventListener('dragstart', e => {
      _dragSrc = { tipo: 'carpeta', id: carpeta.id };
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', e => {
      e.preventDefault();
      li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      li.classList.remove('drag-over');
      handleDrop(carpeta.id);
    });

    return li;
  }

  function renderElementoNodo(el, carpetaId) {
    const tipo = String(el.elemento_tipo || '').toLowerCase();
    const icono = iconoDe(tipo, 18);
    const etiqueta = OBJECT_LABELS[tipo] || el.elemento_tipo || 'Elemento';
    const li = document.createElement('li');
    li.className = 'folder-node folder-elemento-node';
    li.dataset.tipo    = el.elemento_tipo;
    li.dataset.elemId  = el.elemento_id;
    li.draggable = true;
    
    const unlinkBtn = carpetaId ? `<button class="btn-icon" data-action="unlink" title="Quitar de carpeta" style="cursor:pointer; font-size:11px; padding:2px 4px;">✕</button>` : '';
    const deleteBtn = `<button class="btn-icon btn-danger" data-action="delete-elem" title="Eliminar elemento definitivamente" style="cursor:pointer; font-size:12px; color:#141414; background:#f0f0f0; border:1px solid #e3e3e3; border-radius:4px; padding:2px 5px; margin-left:auto;">🗑️</button>`;

    li.innerHTML = `
      <span class="elem-icon" aria-hidden="true">${icono}</span>
      <span class="elem-label" style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${etiqueta} #${el.numero || el.elemento_id}</span>
      <div style="display:flex; gap:4px; margin-left:auto; align-items:center;">
        ${unlinkBtn}
        ${deleteBtn}
      </div>`;

    if (carpetaId) {
      li.querySelector('[data-action="unlink"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        unlinkElemento(carpetaId, el.elemento_tipo, el.elemento_id);
      });
    }

    li.querySelector('[data-action="delete-elem"]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (window.FTTHMapa && FTTHMapa.eliminarElementoDirecto) {
          await FTTHMapa.eliminarElementoDirecto(el.elemento_id);
        } else {
          const res = await fetch(apiUrl(`/api/elementos/${el.elemento_id}`), { method: 'DELETE' });
          if (!res.ok) throw new Error(`Error ${res.status}`);
        }
        await loadCarpetas();
        if (window.FTTHTipos) FTTHTipos.showToast('Elemento eliminado ✓', 'success');
      } catch (err) {
        if (window.FTTHTipos) FTTHTipos.showToast('Error al eliminar: ' + err.message, 'error');
      }
    });

    // Doble clic: volar y enfocar el elemento en el mapa
    li.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (window.FTTHMapa && FTTHMapa.irAElemento) {
        FTTHMapa.irAElemento(el.elemento_id);
      }
    });

    // Drag
    li.addEventListener('dragstart', e => {
      _dragSrc = {
        tipo: 'elemento',
        elementoTipo: el.elemento_tipo,
        elementoId: el.elemento_id,
        carpetaId: carpetaId
      };
      e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    return li;
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────

  async function handleDrop(targetCarpetaId) {
    if (!_dragSrc) return;
    if (_dragSrc.tipo === 'carpeta') {
      if (_dragSrc.id === targetCarpetaId) return;
      try {
        await api(`/api/carpetas/${_dragSrc.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ carpeta_padre_id: targetCarpetaId }),
        });
        await loadCarpetas();
      } catch (err) {
        FTTHTipos.showToast(err.message, 'error');
      }
    } else if (_dragSrc.tipo === 'elemento') {
      try {
        await api(`/api/carpetas/elementos/${_dragSrc.elementoTipo}/${_dragSrc.elementoId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ carpeta_destino_id: targetCarpetaId }),
        });
        await loadCarpetas();
        FTTHTipos.showToast('Elemento movido ✓', 'success');
      } catch (err) {
        FTTHTipos.showToast(err.message, 'error');
      }
    }
    _dragSrc = null;
  }

  // ── Visibilidad ───────────────────────────────────────────────────────────

  function toggleVisibilidadCarpeta(carpeta, visible) {
    const map = getMap();
    if (!map) return;
    
    api(`/api/carpetas/${carpeta.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible }),
    }).catch(err => console.error('Error actualizando visibilidad:', err));

    carpeta.visible = visible;
    carpeta.subcarpetas.forEach(sub => toggleVisibilidadCarpeta(sub, visible));
    
    updateMapFilter();
  }

  function updateMapFilter() {
    const map = getMap();
    if (!map) return;
    
    const allHidden = new Set();
    function collectHidden(nodos) {
      nodos.forEach(c => {
        if (!c.visible) {
          c.elementos.forEach(el => allHidden.add(Number(el.elemento_id)));
        }
        if (c.subcarpetas) collectHidden(c.subcarpetas);
      });
    }
    collectHidden(_carpetasData);

    const filterBaseDuctos = ['==', ['get', 'categoria'], 'ducto'];
    const filterBaseCables = ['==', ['get', 'categoria'], 'cables'];
    const filterBasePuntos = ['all', ['!=', ['get', 'categoria'], 'ducto'], ['!=', ['get', 'categoria'], 'cables']];

    if (!allHidden.size) {
      if (map.getLayer('ftth-ductos-layer')) map.setFilter('ftth-ductos-layer', filterBaseDuctos);
      if (map.getLayer('ftth-cables-layer')) map.setFilter('ftth-cables-layer', filterBaseCables);
      if (map.getLayer('ftth-puntos-layer')) map.setFilter('ftth-puntos-layer', filterBasePuntos);
      if (map.getLayer('ftth-labels-layer')) map.setFilter('ftth-labels-layer', filterBasePuntos);
      return;
    }

    const hiddenIds = Array.from(allHidden).map(id => Number(id));
    const hideCondition = ['!', ['in', ['get', 'id'], ['literal', hiddenIds]]];

    if (map.getLayer('ftth-ductos-layer')) map.setFilter('ftth-ductos-layer', ['all', filterBaseDuctos, hideCondition]);
    if (map.getLayer('ftth-cables-layer')) map.setFilter('ftth-cables-layer', ['all', filterBaseCables, hideCondition]);
    if (map.getLayer('ftth-puntos-layer')) map.setFilter('ftth-puntos-layer', ['all', filterBasePuntos, hideCondition]);
    if (map.getLayer('ftth-labels-layer')) map.setFilter('ftth-labels-layer', ['all', filterBasePuntos, hideCondition]);
  }

  // ── CRUD de carpetas ──────────────────────────────────────────────────────

  async function addSubcarpeta(padreId) {
    const nombre = prompt('Nombre de la nueva subcarpeta:');
    if (!nombre || !nombre.trim()) return;
    try {
      await api('/api/carpetas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.trim(), carpeta_padre_id: padreId }),
      });
      FTTHTipos.showToast('Subcarpeta creada ✓', 'success');
      await loadCarpetas();
    } catch (err) {
      FTTHTipos.showToast(err.message, 'error');
    }
  }

  async function renameCarpeta(carpeta) {
    const nombre = prompt('Nuevo nombre:', carpeta.nombre);
    if (!nombre || !nombre.trim() || nombre.trim() === carpeta.nombre) return;
    try {
      await api(`/api/carpetas/${carpeta.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.trim() }),
      });
      FTTHTipos.showToast('Carpeta renombrada ✓', 'success');
      await loadCarpetas();
    } catch (err) {
      FTTHTipos.showToast(err.message, 'error');
    }
  }

  async function deleteCarpeta(id, nombre) {
    if (!confirm(`¿Eliminar la carpeta "${nombre}"?\nSus subcarpetas se moverán al nivel padre.`)) return;
    try {
      await api(`/api/carpetas/${id}`, { method: 'DELETE' });
      FTTHTipos.showToast('Carpeta eliminada', 'success');
      await loadCarpetas();
    } catch (err) {
      FTTHTipos.showToast(err.message, 'error');
    }
  }

  async function unlinkElemento(carpetaId, tipo, elemId) {
    try {
      await api(`/api/carpetas/${carpetaId}/elementos/${tipo}/${elemId}`, { method: 'DELETE' });
      FTTHTipos.showToast('Elemento quitado de la carpeta', 'success');
      await loadCarpetas();
    } catch (err) {
      FTTHTipos.showToast(err.message, 'error');
    }
  }

  // ── Crear carpeta raíz desde botón ────────────────────────────────────────

  async function crearCarpetaRaiz() {
    const nombre = document.getElementById('folder-name')?.value?.trim();
    if (!nombre) return;
    try {
      await api('/api/carpetas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre }),
      });
      const input = document.getElementById('folder-name');
      if (input) input.value = '';
      document.getElementById('folder-form')?.classList.add('hidden');
      FTTHTipos.showToast('Carpeta creada ✓', 'success');
      await loadCarpetas();
    } catch (err) {
      FTTHTipos.showToast(err.message, 'error');
    }
  }

  // ── Utilidades ────────────────────────────────────────────────────────────

  function escapeHTML(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Init público ──────────────────────────────────────────────────────────

  function init() {
    // Habilitar el panel derecho (estaba con display:none)
    const panel = document.getElementById('folders-panel');
    if (panel) panel.style.display = '';

    // Crear carpeta raíz
    const btnCreate = document.getElementById('btn-create-folder');
    if (btnCreate) {
      btnCreate.removeEventListener('click', crearCarpetaRaiz);  // evitar duplicados
      btnCreate.addEventListener('click', crearCarpetaRaiz);
    }

    // Toggle del form
    const btnNew = document.getElementById('btn-new-folder');
    if (btnNew) {
      btnNew.addEventListener('click', () => {
        document.getElementById('folder-form')?.classList.toggle('hidden');
      });
    }

    loadCarpetas();
  }

  return { init, loadCarpetas, updateMapFilter };

})();

window.FTTHCarpetas = FTTHCarpetas;
