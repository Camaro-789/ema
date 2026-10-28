/**
 * dialogo-equipo.js — «+ EQUIPO» leyendo el CATÁLOGO de tipos (paso 3).
 *
 * No hay lista fija: se piden los tipos reales por categoría
 * (`GET /api/tipos/{categoria}?proyecto_id=`) y se agrupan en OLT · ODF ·
 * Switch · Splitter. Al elegir uno se crea el equipo con su `tipo_id`, así
 * hereda las propiedades de la plantilla (puertos, división, atenuación, clase).
 */
import { api } from './api.js';

const CATEGORIAS = [
  ['olt', 'OLT', 'olt'],
  ['odf', 'ODF', 'odf'],
  ['switches', 'Switch', 'switch'],
  ['splitter', 'Splitter', 'splitter'],
];

function opciones(tipos, etiqueta, categoria) {
  if (!tipos.length) return '';
  return `<optgroup label="${etiqueta}">${tipos.map((tipo) => `
    <option value="${tipo.id}" data-categoria="${categoria}"
            data-division="${(tipo.propiedades || {}).relacion_division || ''}">
      ${tipo.nombre_id || `Tipo #${tipo.id}`}
    </option>`).join('')}</optgroup>`;
}

export async function abrirDialogoEquipo(host, opcionesDialogo) {
  const { proyectoId, alCrear } = opcionesDialogo;
  const listas = await Promise.all(CATEGORIAS.map(([categoria]) => api.tipos(categoria, proyectoId)
    .catch(() => [])));
  const grupos = CATEGORIAS.map(([categoria, etiqueta], indice) =>
    opciones(Array.isArray(listas[indice]) ? listas[indice] : [], etiqueta, categoria)).join('');

  const capa = document.createElement('div');
  capa.className = 'pop-dialogo';
  capa.innerHTML = `
    <div class="pop-dialogo-caja">
      <header>
        <b>AGREGAR EQUIPO AL POP</b>
        <button type="button" data-cerrar>✕</button>
      </header>
      <div class="pop-dialogo-cuerpo">
        <label>Tipo del catálogo (Objetos plantilla de red)</label>
        <select data-tipo>${grupos || '<option disabled>(no hay tipos en el catálogo)</option>'}</select>
        <label>Nombre / serie (opcional)</label>
        <input type="text" data-nombre placeholder="p. ej. SPL-1x8-A" maxlength="100">
        <label>Estado</label>
        <select data-estado>
          <option>Implementado</option>
          <option>En proyecto</option>
          <option>Certificado</option>
        </select>
        <p class="pop-dialogo-nota">Los puertos se generan solos según la plantilla.
          Al crear, el equipo aparece en el papel dinámico, en el rack y en la matriz.</p>
      </div>
      <footer>
        <button type="button" class="pop-btn" data-cancelar>CANCELAR</button>
        <button type="button" class="pop-btn pop-btn--oscuro" data-crear>CREAR EQUIPO</button>
      </footer>
    </div>`;
  host.appendChild(capa);

  const cerrar = () => capa.remove();
  capa.querySelector('[data-cerrar]').addEventListener('click', cerrar);
  capa.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  capa.addEventListener('click', (evento) => { if (evento.target === capa) cerrar(); });

  capa.querySelector('[data-crear]').addEventListener('click', async () => {
    const combo = capa.querySelector('[data-tipo]');
    const elegido = combo.options[combo.selectedIndex];
    if (!elegido || elegido.disabled) return;
    const categoria = elegido.dataset.categoria;
    const datos = {
      tipo: categoria,
      tipo_id: Number(elegido.value),
      nombre: capa.querySelector('[data-nombre]').value.trim() || null,
      estado: capa.querySelector('[data-estado]').value,
    };
    const division = elegido.dataset.division;
    if (categoria === 'splitter' && division) datos.division = division;
    cerrar();
    try {
      await alCrear(datos);
    } catch (error) {
      host.dispatchEvent(new CustomEvent('pop-error', { bubbles: true, detail: error }));
    }
  });

  return capa;
}
