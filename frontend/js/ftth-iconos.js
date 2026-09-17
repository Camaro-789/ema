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
  // funcione tanto en "/" como en subrutas ("/catalog", etc.).
  const _script = document.currentScript;
  const APP_BASE = _script
    ? _script.src.replace(/js\/ftth-iconos\.js.*$/, '')
    : '';

  // Mapa oficial: categoría → archivo SVG
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
    fusion: 'fusion.svg'
  });

  // Alias usados por versiones anteriores del código
  const ALIAS = Object.freeze({
    post: 'poste',
    caja: 'cajanap',
    nap: 'cajanap',
    'caja-nap': 'cajanap',
    'caja_nap': 'cajanap'
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

  /** Etiqueta <img> lista para insertar en HTML (panel derecho, listas, etc.) */
  function imgHtml(categoria, size = 16, extraClass = '') {
    const cls = ('ftth-icono ' + extraClass).trim();
    return `<img src="${url(categoria)}" alt="${normalizar(categoria)}" class="${cls}" `
      + `width="${size}" height="${size}" style="width:${size}px;height:${size}px;object-fit:contain;vertical-align:middle;" `
      + `onerror="this.style.visibility='hidden'">`;
  }

  /**
   * Carga todos los SVG como ImageData para poder registrarlos en MapLibre
   * con map.addImage(). Devuelve una Promesa con { categoria: ImageData }.
   */
  function cargarParaMapa(size = 64) {
    const cats = Object.keys(ICONOS);
    const tareas = cats.map(cat => new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, size, size);
          resolve({ cat, imageData: ctx.getImageData(0, 0, size, size) });
        } catch (e) {
          console.warn('FTTHIconos: no se pudo rasterizar', cat, e);
          resolve({ cat, imageData: null });
        }
      };
      img.onerror = () => {
        console.warn('FTTHIconos: no se pudo cargar', cat);
        resolve({ cat, imageData: null });
      };
      img.src = url(cat);
    }));

    return Promise.all(tareas).then(resultados => {
      const out = {};
      resultados.forEach(r => { if (r.imageData) out[r.cat] = r.imageData; });
      return out;
    });
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
      if (onReady) onReady();
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
