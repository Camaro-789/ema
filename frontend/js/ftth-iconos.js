/**
 * ftth-iconos.js
 * Fuente única de íconos SVG para los tipos de infraestructura FTTH.
 * Cualquier parte del programa que muestre un tipo de objeto debe usar
 * este módulo para obtener su ícono (panel derecho, modal de tipos,
 * barra lateral izquierda, etiquetas del mapa, etc.).
 *
 * Los archivos SVG viven en:  frontend/assets/icons/<categoria>.svg
 */
const FTTHIconos = (() => {

  // Base absoluta calculada desde la ubicación de este script, para que
  // funcione tanto en "/" como en cualquier subruta.
  const _script = document.currentScript;
  const APP_BASE = _script
    ? _script.src.replace(/js\/ftth-iconos\.js.*$/, '')
    : '';

  // Mapa oficial: categoría → archivo SVG.
  // Son EXACTAMENTE los íconos del panel general izquierdo: cualquier parte del
  // programa (menús, listas de ruta, popups, diagramas) debe usar esta lista y
  // ninguna otra imagen para representar un tipo de objeto.
  const ICONOS = Object.freeze({
    poste: 'poste.svg',
    cajanap: 'cajanap.svg',
    manga: 'manga.svg',
    ducto: 'ducto.svg',
    luminaria: 'luminaria.svg',
    odf: 'odf.svg',
    olt: 'olt.svg',
    splitter: 'splitter.svg',
    armario: 'armario.svg',
    cables: 'cables.svg',
    switches: 'switches.svg',
    fusion: 'fusion.svg',
    reserva: 'reserva.svg'
  });

  // Alias usados por versiones anteriores del código
  const ALIAS = Object.freeze({
    post: 'poste',
    postes: 'poste',
    caja: 'cajanap',
    cajas: 'cajanap',
    nap: 'cajanap',
    'caja-nap': 'cajanap',
    'caja_nap': 'cajanap',
    cable: 'cables',
    fibra: 'cables',
    fibras: 'cables',
    switch: 'switches'
  });

  /** Normaliza una categoría a una clave válida (con alias) */
  function normalizar(categoria) {
    const key = String(categoria || '').toLowerCase().trim();
    if (ICONOS[key]) return key;
    if (ALIAS[key]) return ALIAS[key];
    return 'poste';
  }

  /** URL absoluta del SVG de una categoría */
  function url(categoria) {
    return APP_BASE + 'assets/icons/' + ICONOS[normalizar(categoria)];
  }

  /** Etiqueta <img> lista para insertar en HTML (panel derecho, listas, menús, etc.) */
  function imgHtml(categoria, size = 16, extraClass = '', extraStyle = '') {
    const cls = ('ftth-icono ' + extraClass).trim();
    const estilo = `width:${size}px;height:${size}px;object-fit:contain;vertical-align:middle;${extraStyle}`;
    return `<img src="${url(categoria)}" alt="${normalizar(categoria)}" class="${cls}" `
      + `width="${size}" height="${size}" style="${estilo}" `
      + `onerror="this.style.visibility='hidden'">`;
  }

  /**
   * Carga todos los SVG como ImageData para poder registrarlos en MapLibre
   * con map.addImage(). Devuelve una Promesa con { categoria: ImageData }.
   */
  function cargarParaMapa(size = 64) {
    const cats = Object.keys(ICONOS);
    const tareas = cats.map(cat => new Promise(resolve => {
      const u = url(cat);
      fetch(u)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then(svgText => {
          const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
          const blobUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = size;
              canvas.height = size;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, size, size);
              const imageData = ctx.getImageData(0, 0, size, size);
              URL.revokeObjectURL(blobUrl);
              resolve({ cat, imageData });
            } catch (e) {
              console.warn('FTTHIconos: no se pudo rasterizar canvas para', cat, e);
              URL.revokeObjectURL(blobUrl);
              resolve({ cat, imageData: null });
            }
          };
          img.onerror = () => {
            console.warn('FTTHIconos: error cargando imagen Blob para', cat);
            URL.revokeObjectURL(blobUrl);
            resolve({ cat, imageData: null });
          };
          img.src = blobUrl;
        })
        .catch(err => {
          console.warn('FTTHIconos: fetch falló para', cat, err);
          resolve({ cat, imageData: null });
        });
    }));

    return Promise.all(tareas).then(resultados => {
      const out = {};
      resultados.forEach(r => { if (r.imageData) out[r.cat] = r.imageData; });
      return out;
    });
  }

  /**
   * Genera el bitmap SDF REAL del cuadro del poste.
   *
   * Campo de distancia con signo: el alfa vale 0.5 justo en el borde, >0.5 dentro
   * y <0.5 fuera. MapLibre evalua esa funcion en el fragment shader, de modo que
   * el borde se dibuja analiticamente y queda recto y nitido en cualquier zoom,
   * sin el desenfoque que produce un relleno normal al escalarlo. Con radio 0 las
   * esquinas quedan a 90 grados exactos.
   *
   * Esta imagen la consume UNICAMENTE la capa 'ftth-postes-layer' (ver ftth-mapa.js).
   * Los demas nodos (caja, manga, ODF, OLT...) siguen usando sus SVG oficiales a
   * color, sin tocar: 'ftth-labels-layer' no usa esta imagen.
   */
  function _generarCuadradoSDF(size = 32, radio = 0) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = img.data;

    const pad = 4;            // margen para que la rampa SDF no toque el borde del bitmap
    const half = size / 2;
    const halfBox = half - pad;
    const spread = 4;          // ancho de la rampa: debe caber dentro de 'pad'
    const r = Math.max(0, Math.min(radio, halfBox));

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const px = x + 0.5 - half;
        const py = y + 0.5 - half;
        // Distancia con signo a un rectangulo (redondeado solo si r > 0).
        const qx = Math.abs(px) - (halfBox - r);
        const qy = Math.abs(py) - (halfBox - r);
        const ax = Math.max(qx, 0);
        const ay = Math.max(qy, 0);
        const dist = Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
        // 0 en el borde exacto, negativo hacia dentro.
        let a = 0.5 - dist / spread;
        if (a < 0) a = 0; else if (a > 1) a = 1;
        const i = (y * size + x) * 4;
        d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
        d[i + 3] = Math.round(a * 255);
      }
    }

    ctx.putImageData(img, 0, 0);
    return ctx.getImageData(0, 0, size, size);
  }

  /**
   * Registra los íconos en un mapa MapLibre. Llama a onReady cuando termina.
   * Es idempotente: no vuelve a añadir íconos que ya existan.
   */
  function registrarEnMapa(map, onReady) {
    if (!map || typeof map.addImage !== 'function') {
      if (onReady) onReady();
      return;
    }

    // Registrar la forma cuadrada SDF para los postes
    try {
      if (!map.hasImage || !map.hasImage('ftth-shape-square')) {
        map.addImage('ftth-shape-square', _generarCuadradoSDF(32), { sdf: true });
      }
    } catch (e) {
      console.warn('FTTHIconos: no se pudo registrar ftth-shape-square:', e);
    }

    cargarParaMapa().then(imagenes => {
      Object.keys(imagenes).forEach(cat => {
        const id = 'ftth-ico-' + cat;
        try {
          if (!map.hasImage || !map.hasImage(id)) {
            map.addImage(id, imagenes[cat]);
          }
        } catch (e) {
          console.warn('FTTHIconos: addImage falló para', cat, e);
        }
      });
      // El callback (crear la capa de etiquetas, etc.) se llama SIEMPRE y protegido:
      // un error aquí no debe convertirse en un rejection suelto que confunda al
      // usuario ni cortar la actualización de datos del mapa.
      try {
        if (onReady) onReady();
      } catch (e) {
        console.warn('FTTHIconos: los íconos quedaron registrados, pero onReady falló:', e);
      }
    });
  }

  return {
    ICONOS,
    normalizar,
    url,
    imgHtml,
    cargarParaMapa,
    registrarEnMapa
  };

})();

window.FTTHIconos = FTTHIconos;
