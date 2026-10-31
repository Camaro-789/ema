/**
 * ftth-tipos.js
 * Panel de "Tipos de Objetos" (Plantillas de Red).
 *
 * Estructura visual: panel v2 -> ventana glass, tabla con
 * columnas generadas desde el tipo de objeto y formulario plegable.
 * Contenido: el de siempre -> CATS (12 tipos de objeto) con sus íconos,
 * tipos de campo, opciones y placeholders originales.
 *
 * Persistencia real: GET/POST/PUT/DELETE /api/tipos
 * API pública (la que usa el resto de la app):
 *   init, openModal, closeModal, openSubpanel, closeSubpanel, editItemById,
 *   handleSave, resetFormToCreateMode, updateSlotsTable, getCategorias,
 *   getTipos, showToast, deleteTipo, CATS, _setActiveTab
 */
const FTTHTipos = (() => {

  // ── Opciones de los <select> ─────────────────────────────────────────────
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
      { v: 'abnt', t: 'Perfil ABNT' },
      { v: 'custom', t: 'Perfil Personalizado' }
    ],
    // Estructura de un cable de fibra: con buffer (looses) o drop (sin buffer).
    // Mismas claves que backend/app/models/ftth_logica.py::ESTRUCTURAS_CABLE.
    estructuraCable: [
      { v: 'con_buffer', t: 'Con buffer' },
      { v: 'drop', t: 'Drop (sin buffer)' }
    ],
    // Totales reales de mercado de un cable drop: select cerrado, no se puede
    // escribir un 7 ni un 15 (ver FTTHCableReglas.HILOS_DROP).
    hilosDrop: [1, 2, 4, 6, 8],

    propiedad: [
      { v: 'publica', t: 'Pública' },
      { v: 'privada', t: 'Privada' }
    ],
    tipoIO: [
      { v: 'fusion_fusion', t: 'Fusión / Fusión' },
      { v: 'fusion_conector', t: 'Fusión / Conector' },
      { v: 'conector_fusion', t: 'Conector / Fusión' },
      { v: 'conector_conector', t: 'Conector / Conector' }
    ],
    // Divisiones validas de un splitter PLC (entradas x salidas). Son las mismas
    // que tabula el backend (ATENUACION_SPLITTER): el formulario no deja crear un
    // splitter que luego no se pueda materializar.
    divisionSplitter: [
      { v: '1x2', t: '1x2  - 2 salidas  - 3.6 dB' },
      { v: '1x4', t: '1x4  - 4 salidas  - 7.3 dB' },
      { v: '1x8', t: '1x8  - 8 salidas  - 10.7 dB' },
      { v: '1x16', t: '1x16 - 16 salidas - 13.7 dB' },
      { v: '1x32', t: '1x32 - 32 salidas - 16.9 dB' },
      { v: '1x64', t: '1x64 - 64 salidas - 20.5 dB' }
    ],
    tecnologiaOlt: [
      { v: 'GPON', t: 'GPON (ITU-T G.984 - 1:128)' },
      { v: 'EPON', t: 'EPON (IEEE 802.3ah - 1:64)' },
      { v: 'XG-PON', t: 'XG-PON (10G/2.5G)' },
      { v: 'XGS-PON', t: 'XGS-PON (10G/10G simétrico)' }
    ],
    formatoOlt: [
      { v: 'compacto', t: 'Compacto / Pizza-box (1U)' },
      { v: 'modular', t: 'Modular con Slots (2U o más)' }
    ]
  };

  const PRESETS_OLT = [
    {
      id: 'custom',
      nombre: 'Personalizado / Manual',
      marca: '',
      modelo: '',
      codigo: '',
      tecnologia: 'GPON',
      formato: 'compacto',
      puertos_pon: 8,
      puertos_sfp: 4,
      puertos_rj45_datos: 4,
      puerto_mgmt: true,
      puerto_console: true,
      maxClientes: 128,
      potencia: 6,
      tamano: 1,
      numSlots: 1,
      slots_detalle: [{ slot: 1, puertos: 8, indice: 1 }],
      descripcion: ''
    },
    {
      id: 'vsol_1600g0b',
      nombre: 'V-SOL V1600G0-B (4P GPON, 1U)',
      marca: 'V-SOL',
      modelo: 'V1600G0-B',
      codigo: 'VSOL-V1600G0-B',
      tecnologia: 'GPON',
      formato: 'compacto',
      puertos_pon: 4,
      puertos_sfp: 4,
      puertos_rj45_datos: 2,
      puerto_mgmt: true,
      puerto_console: true,
      maxClientes: 128,
      potencia: 6,
      tamano: 1,
      numSlots: 1,
      slots_detalle: [{ slot: 1, puertos: 4, indice: 1 }],
      descripcion: 'OLT Pizza-box 1U GPON 4 puertos PON (hasta 512 ONUs), 4 SFP (2 GE + 2 10GE SFP+), 2 GE RJ45, 1 CONSOLE + 1 MGMT'
    },
    {
      id: 'vsol_1600g1b',
      nombre: 'V-SOL V1600G1-B (8P GPON, 1U)',
      marca: 'V-SOL',
      modelo: 'V1600G1-B',
      codigo: 'VSOL-V1600G1-B',
      tecnologia: 'GPON',
      formato: 'compacto',
      puertos_pon: 8,
      puertos_sfp: 4,
      puertos_rj45_datos: 4,
      puerto_mgmt: true,
      puerto_console: true,
      maxClientes: 128,
      potencia: 6,
      tamano: 1,
      numSlots: 1,
      slots_detalle: [{ slot: 1, puertos: 8, indice: 1 }],
      descripcion: 'OLT Pizza-box 1U GPON 8 puertos PON (hasta 1024 ONUs), 4 SFP/SFP+, 4 GE RJ45, 1 CONSOLE + 1 MGMT'
    },
    {
      id: 'vsol_1600g2b',
      nombre: 'V-SOL V1600G2-B (16P GPON, 1U)',
      marca: 'V-SOL',
      modelo: 'V1600G2-B',
      codigo: 'VSOL-V1600G2-B',
      tecnologia: 'GPON',
      formato: 'compacto',
      puertos_pon: 16,
      puertos_sfp: 4,
      puertos_rj45_datos: 4,
      puerto_mgmt: true,
      puerto_console: true,
      maxClientes: 128,
      potencia: 6,
      tamano: 1,
      numSlots: 1,
      slots_detalle: [{ slot: 1, puertos: 16, indice: 1 }],
      descripcion: 'OLT Pizza-box 1U GPON 16 puertos PON (hasta 2048 ONUs), 4 10GE SFP+, 4 GE RJ45, 1 CONSOLE + 1 MGMT'
    },
    {
      id: 'vsol_1600d4',
      nombre: 'V-SOL V1600D4-DP (4P EPON, 1U)',
      marca: 'V-SOL',
      modelo: 'V1600D4-DP',
      codigo: 'VSOL-V1600D4-DP',
      tecnologia: 'EPON',
      formato: 'compacto',
      puertos_pon: 4,
      puertos_sfp: 4,
      puertos_rj45_datos: 4,
      puerto_mgmt: true,
      puerto_console: true,
      maxClientes: 64,
      potencia: 4,
      tamano: 1,
      numSlots: 1,
      slots_detalle: [{ slot: 1, puertos: 4, indice: 1 }],
      descripcion: 'OLT Pizza-box 1U EPON 4 puertos PON (hasta 256 ONUs), 4 GE SFP, 4 GE RJ45, 1 CONSOLE + 1 MGMT'
    },
    {
      id: 'vsol_1600d8',
      nombre: 'V-SOL V1600D8 (8P EPON, 1U)',
      marca: 'V-SOL',
      modelo: 'V1600D8',
      codigo: 'VSOL-V1600D8',
      tecnologia: 'EPON',
      formato: 'compacto',
      puertos_pon: 8,
      puertos_sfp: 4,
      puertos_rj45_datos: 4,
      puerto_mgmt: true,
      puerto_console: true,
      maxClientes: 64,
      potencia: 4,
      tamano: 1,
      numSlots: 1,
      slots_detalle: [{ slot: 1, puertos: 8, indice: 1 }],
      descripcion: 'OLT Pizza-box 1U EPON 8 puertos PON (hasta 512 ONUs), 4 GE SFP, 4 GE RJ45, 1 CONSOLE + 1 MGMT'
    },
    {
      id: 'zte_c320',
      nombre: 'ZTE C320 (Chasis Modular 2 Slots, 2U)',
      marca: 'ZTE',
      modelo: 'ZTE C320',
      codigo: 'ZTE C320',
      tecnologia: 'GPON',
      formato: 'modular',
      puertos_pon: 32,
      puertos_sfp: 4,
      puertos_rj45_datos: 2,
      puerto_mgmt: true,
      puerto_console: true,
      maxClientes: 128,
      potencia: 6,
      tamano: 2,
      numSlots: 2,
      slots_detalle: [
        { slot: 1, puertos: 16, indice: 1 },
        { slot: 2, puertos: 16, indice: 1 }
      ],
      descripcion: 'Chasis OLT 2U modular ZTE C320 con 2 slots de servicio (hasta 32 PON GPON)'
    },
    {
      id: 'huawei_ma5608t',
      nombre: 'Huawei SmartAX MA5608T (Chasis Modular 2 Slots, 2U)',
      marca: 'Huawei',
      modelo: 'MA5608T',
      codigo: 'HUAWEI-MA5608T',
      tecnologia: 'GPON',
      formato: 'modular',
      puertos_pon: 32,
      puertos_sfp: 4,
      puertos_rj45_datos: 2,
      puerto_mgmt: true,
      puerto_console: true,
      maxClientes: 128,
      potencia: 6,
      tamano: 2,
      numSlots: 2,
      slots_detalle: [
        { slot: 1, puertos: 16, indice: 1 },
        { slot: 2, puertos: 16, indice: 1 }
      ],
      descripcion: 'Chasis OLT Mini 2U Huawei MA5608T con 2 slots de servicio para tarjetas GPBD/GPFD (16/32 PON)'
    }
  ];
  OP.presetsOlt = PRESETS_OLT.map(p => ({ v: p.id, t: p.nombre }));

  // Atenuacion nominal (dB) por division: es la MISMA tabla del backend
  // (ATENUACION_SPLITTER en backend/app/routers/ftth_logica.py). Una prueba
  // compara las dos para que no se separen. El formulario la usa para SUGERIR el
  // valor en el campo de atenuacion; el backend la aplica si va vacio.
  const NOMINAL_SPLITTER = Object.freeze({
    '1x2': 3.6, '1x4': 7.3, '1x8': 10.7, '1x16': 13.7, '1x32': 16.9, '1x64': 20.5,
    '2x2': 3.6, '2x4': 7.3, '2x8': 10.7, '2x16': 13.7, '2x32': 16.9,
  });

  // ── Tipos de objeto (clave en BD) + formulario de cada uno ───────────────
  // w: 'full' | 'half' | 'third'  ·  fieldset: agrupador con leyenda
  // La tabla genera sus columnas desde estos campos.
  // Límites de los splitters. El backend aplica exactamente los mismos
  // (backend/app/models/ftth_logica.py → MAX_SPLITTER_*): 1x64 es el mayor.
  const SPLITTER_MAX_SALIDAS = 64;
  const SPLITTER_MAX_ENTRADAS = 2;

  const CATS = [
    {
      clave: 'poste', titulo: 'Postes', color: '#8b4513', campoClave: 'codigo', campoDesc: 'desc', singular: 'poste',
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
      clave: 'cajanap', titulo: 'Cajas NAP', color: '#eab308', campoClave: 'codigo', campoDesc: 'desc', singular: 'caja NAP',
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
      clave: 'manga', titulo: 'Mangas de Empalme', color: '#a855f7', campoClave: 'codigo', campoDesc: 'desc', singular: 'manga de empalme',
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
      clave: 'armario', titulo: 'Armario', color: '#008000', campoClave: 'nombre', campoDesc: 'desc', singular: 'armario',
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
      clave: 'cables', titulo: 'Cables de Fibra', color: '#0284c7', campoClave: 'codigo', campoDesc: 'desc', singular: 'cable de fibra',
      campos: [
        { id: 'codigo', label: 'Código', type: 'text', ph: 'ADSS 144H 12 Buffers', w: 'full' },
        { id: 'marca', label: 'Marca', type: 'text', ph: 'Marca del tipo de cable', w: 'half' },
        { id: 'modelo', label: 'Modelo', type: 'text', ph: 'Modelo de tipo de cable', w: 'half' },
        { id: 'nivel', label: 'Nivel estándar', type: 'select', options: OP.nivelCable, w: 'full' },
        // ── Estructura del cable: define los buffers y QUIÉN manda en los campos ──
        //   con buffer → looses + total de fibras; «fibras por loose» es CALCULADO
        //   drop       → solo el total de hilos (1, 2, 4, 6 u 8), sin buffers
        { id: 'estructura', label: 'Estructura', type: 'select', options: OP.estructuraCable, def: 'con_buffer', w: 'full' },
        { id: 'looses', label: 'Número de buffers', type: 'number', ph: '12', w: 'half', min: 1, max: 96, soloSi: 'conBuffer' },
        { id: 'fibras', label: 'Número total de fibras', type: 'number', ph: '144', w: 'half', soloSi: 'conBuffer' },
        {
          id: 'fibrasLoose', label: 'Fibras por buffer (calculado)', type: 'calculo', w: 'half', soloSi: 'conBuffer',
          titulo: 'Se calcula solo: total de fibras ÷ número de buffers. No se edita a mano.'
        },
        { id: 'perfil', label: 'Perfil de fibra', type: 'select', options: OP.perfilFibra, w: 'half', soloSi: 'conBuffer' },
        { id: 'total_hilos', label: 'Número total de hilos', type: 'select', options: OP.hilosDrop, w: 'half', soloSi: 'drop' },
        { id: 'atenuacion', label: 'Atenuación por Km (dB)', type: 'number', ph: '0.4', step: '0.1', w: 'half' },
        // ── Cable OZmap: reservas por extremo (valores por defecto del tipo) ──
        { id: 'reserva_A_m', label: 'Reserva extremo A (m)', type: 'number', ph: '0', step: '0.1', min: 0, w: 'half' },
        { id: 'reserva_B_m', label: 'Reserva extremo B (m)', type: 'number', ph: '0', step: '0.1', min: 0, w: 'half' },
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
      clave: 'ducto', titulo: 'Ductos / Canalización', color: '#ff5722', campoClave: 'codigo', campoDesc: 'desc', singular: 'ducto',
      campos: [
        { id: 'nombre', label: 'Nombre', type: 'text', ph: 'Escribe el nombre...', w: 'full' },
        { id: 'codigo', label: 'Código', type: 'text', ph: 'DUCT-01', w: 'full' },
        { id: 'tipo_ducto', label: 'Tipo de ducto', type: 'select', options: OP.tipoDucto, w: 'full' },
        { id: 'desc', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' }
      ]
    },
    {
      clave: 'luminaria', titulo: 'Luminarias', color: '#eab308', campoClave: 'codigo', campoDesc: 'desc', singular: 'luminaria',
      campos: [
        { id: 'nombre', label: 'Nombre', type: 'text', ph: 'Escribe el nombre...', w: 'full' },
        { id: 'codigo', label: 'Código', type: 'text', ph: 'Escribe el código...', w: 'full' },
        { id: 'desc', label: 'Descripción', type: 'text', ph: 'Escribe la descripción...', w: 'full' },
        { id: 'propiedad', label: 'Propiedad', type: 'select', options: OP.propiedad, placeholderOption: 'Seleccione pública o privada', w: 'full' }
      ]
    },
    {
      clave: 'odf', titulo: 'ODF', color: '#8b5cf6', campoClave: 'codigo', campoDesc: 'desc', singular: 'ODF',
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
      clave: 'olt', titulo: 'OLT', color: '#ef4444', campoClave: 'codigo', campoDesc: 'descripcion', singular: 'OLT',
      slots: { def: 2 },
      campos: [
        { id: 'preset_olt', label: 'Plantilla predeterminada (Preset)', type: 'select', options: OP.presetsOlt, def: 'custom', onchange: 'FTTHTipos.cargarPresetOlt(this.value)', w: 'full' },
        { id: 'codigo', label: 'Código', type: 'text', ph: 'Ej: VSOL-V1600G1-B o ZTE C320', w: 'full' },
        { id: 'marca', label: 'Marca', type: 'text', ph: 'Ej: V-SOL', w: 'half' },
        { id: 'modelo', label: 'Modelo', type: 'text', ph: 'Ej: V1600G1-B', w: 'half' },
        { id: 'tecnologia', label: 'Tecnología', type: 'select', options: OP.tecnologiaOlt, def: 'GPON', w: 'half' },
        { id: 'formato', label: 'Formato de chasis', type: 'select', options: OP.formatoOlt, def: 'compacto', onchange: 'FTTHTipos.cambiarFormatoOlt(this.value)', w: 'half' },
        { id: 'puertos_pon', label: 'Puertos PON (Total)', type: 'number', ph: '8', def: '8', min: 1, max: 128, w: 'half' },
        { id: 'maxClientes', label: 'Máx. clientes por puerto PON', type: 'number', ph: '128', def: '128', min: 1, max: 256, w: 'half' },
        { id: 'potencia', label: 'Potencia estándar TX (dBm)', type: 'number', ph: '6', def: '6', step: '0.1', w: 'half' },
        { id: 'tamano', label: 'Tamaño en Rack (U)', type: 'number', ph: '1', def: '1', min: 1, max: 16, step: '1', w: 'half' },
        { id: 'puertos_sfp', label: 'Puertos Uplink Ópticos (SFP / SFP+)', type: 'number', ph: '4', def: '4', min: 0, max: 32, w: 'half' },
        { id: 'puertos_rj45_datos', label: 'Puertos Uplink Cobre (RJ45 GE Datos)', type: 'number', ph: '4', def: '4', min: 0, max: 32, w: 'half' },
        { id: 'puerto_mgmt', label: 'Incluir puerto RJ45 MGMT (Gestión Out-of-band)', type: 'checkbox', def: true, w: 'half' },
        { id: 'puerto_console', label: 'Incluir puerto RJ45 CONSOLE (Terminal CLI)', type: 'checkbox', def: true, w: 'half' },
        { id: 'numSlots', label: 'Número de Slots (para modulares)', type: 'number', ph: '2', def: '2', min: 1, max: 32, step: '1', oninput: 'FTTHTipos.updateSlotsTable(this.value)', w: 'half' },
        { id: 'descripcion', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' }
      ]
    },
    {
      clave: 'switches', titulo: 'Switches', color: '#6366f1', campoClave: 'codigo', campoDesc: 'desc', singular: 'switch',
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
      clave: 'splitter', titulo: 'Splitters', color: '#06b6d4', campoClave: 'codigo', campoDesc: 'desc', singular: 'splitter',
      campos: [
        { id: 'codigo', label: 'Código', type: 'text', ph: 'Código del tipo de splitter', w: 'full' },
        { id: 'marca', label: 'Marca', type: 'text', ph: 'Marca del tipo de splitter', w: 'half' },
        { id: 'modelo', label: 'Modelo', type: 'text', ph: 'Modelo del tipo de splitter', w: 'half' },
        { id: 'prefijo', label: 'Prefijo', type: 'text', ph: 'Prefijo para la nomenclatura', w: 'half' },
        { id: 'tamano', label: 'Tamaño (U de rack)', type: 'number', ph: '1', min: 1, max: 16, step: '1', w: 'half' },
        { id: 'tipoIO', label: 'Tipo de entrada/salida', type: 'select', options: OP.tipoIO, placeholderOption: 'Seleccione opción...', w: 'half' },
        { id: 'balanceado', label: 'Splitter balanceado', type: 'checkbox', w: 'half' },
        { id: 'cliente', label: 'Permite conexión del cliente', type: 'checkbox', w: 'half' },
        { id: 'division', label: 'División (salidas)', type: 'select', options: OP.divisionSplitter, def: '1x8', onchange: 'FTTHTipos.sugerirAtenuacion(this)', w: 'half' },
        { id: 'atenuacion', label: 'Atenuación (dB)', type: 'number', ph: 'Vacío = la nominal', step: '0.01', min: 0, max: 40, w: 'half' },
        { id: 'desc', label: 'Descripción', type: 'textarea', ph: 'Descripción...', w: 'full' }
      ]
    },
    {
      clave: 'fusion', titulo: 'Fusión', color: '#ec4899', campoClave: 'codigo', campoDesc: 'desc', singular: 'fusión',
      campos: [
        { id: 'codigo', label: 'Código:', type: 'text', ph: 'Escribe el código del tipo de fusión...', w: 'full' },
        { id: 'cliente', label: 'Permite conexión del cliente:', type: 'checkbox', w: 'half' },
        { id: 'atenuacion', label: 'Atenuación (dB):', type: 'number', def: '0.1', step: '0.01', ph: '0.1', w: 'half' }
      ]
    }
  ];

  const CATS_MAP = {};
  CATS.forEach(c => { CATS_MAP[c.clave] = c; });

  // ── Estado ───────────────────────────────────────────────────────────────
  let currentCategory = '';
  let currentSortField = '';
  let currentSortAsc = true;
  let _filas = [];           // filas de la categoría actual (ya ordenadas)
  let _porCat = {};          // caché: { clave: [registros del backend] }
  let _editingId = null;
  let _editingData = null;
  let _toastTimer = null;
  let _iniciado = false;
  let _esAdmin = true;       // reservado por si luego se ocultan acciones

  // ── API (mismo contrato que antes) ───────────────────────────────────────
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

  // ── Utilidades ───────────────────────────────────────────────────────────
  function escapeHtml(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  // Campos aplanados conservando el fieldset padre (para etiquetar columnas)
  function camposPlanos(cfg) {
    const lista = [];
    (cfg.campos || []).forEach(f => {
      if (f.fieldset) {
        (f.campos || []).forEach(g => lista.push({ f: g, grupo: f.fieldset }));
        return;
      }
      lista.push({ f, grupo: null });
    });
    return lista;
  }

  function etiquetaCampo(label) {
    return String(label || '').replace(/[:\uFF1A]\s*$/, '').trim();
  }

  function etiquetaColumna(entrada) {
    const base = etiquetaCampo(entrada.f.label);
    return entrada.grupo ? entrada.grupo + ' \u00b7 ' + base : base;
  }

  /**
   * Columnas de la tabla: resumen corto y ordenado para listas largas
   *   Color · <identidad: Código / Nombre> · Modelo (si el tipo lo tiene) · Descripción · Acciones
   * El resto de las propiedades del tipo se ven y editan en el formulario.
   */
  const COLS_RESUMEN = ['modelo'];

  function columnasDe(cfg) {
    const planos = camposPlanos(cfg);
    const porId = {};
    planos.forEach(p => { porId[p.f.id] = p; });

    const cols = [{ key: 'color_mapa', label: 'Color', kind: 'color' }];

    // Identidad del tipo: su código si existe; si no, su campo clave (ej. Armario -> Nombre)
    const ident = porId['codigo'] || porId[cfg.campoClave];
    if (ident) {
      cols.push({
        key: ident.f.id,
        label: etiquetaColumna(ident),
        kind: 'text',
        campo: ident.f,
        resaltar: true
      });
    }

    // Columnas extra del resumen (solo si el tipo las tiene)
    COLS_RESUMEN.forEach(id => {
      const p = porId[id];
      if (!p) return;
      if (p.f.id === cfg.campoDesc || p.f.id === 'numSlots') return;
      if (cols.some(c => c.key === p.f.id)) return;
      cols.push({
        key: p.f.id,
        label: etiquetaColumna(p),
        kind: p.f.type === 'color' ? 'color' : p.f.type === 'checkbox' ? 'bool' : 'text',
        campo: p.f
      });
    });

    if (cfg.campoDesc) cols.push({ key: cfg.campoDesc, label: 'Descripción', kind: 'desc' });
    cols.push({ key: '__acciones', label: '', kind: 'acciones' });
    return cols;
  }

  function textoSelect(f, valor) {
    const op = (f.options || []).find(o => String(typeof o === 'string' ? o : o.v) === String(valor));
    if (!op) return String(valor);
    return typeof op === 'string' ? op : op.t;
  }

  // Valor de la fila para una columna (también se usa para ordenar)
  function valorDeFila(rec, col, cfg) {
    const props = rec.propiedades || {};
    if (col.key === 'color_mapa') return rec.color_mapa || '';
    if (col.key === '__acciones') return '';
    if (col.key === cfg.campoClave) return rec.nombre_id || props[col.key] || '';
    if (col.key === cfg.campoDesc) return rec.observaciones || props[col.key] || '';
    return props[col.key];
  }

  const ICO_DETALLE = '<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></svg>';
  const ICO_INFO = '<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none"/></svg>';
  const ICO_DUPLICAR = '<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  const ICO_ELIMINAR = '<svg fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>';

  function celdaHtml(col, rec, cfg) {
    const valor = valorDeFila(rec, col, cfg);

    if (col.kind === 'color') {
      const color = valor || '#a1a1a6';
      return `<span class="color-swatch" style="background:${escapeHtml(color)};"></span>`;
    }
    if (col.kind === 'bool') {
      const si = !!valor;
      return `<span class="${si ? 'col-venta-si' : 'col-venta-no'}">${si ? 'Sí' : 'No'}</span>`;
    }
    if (col.kind === 'acciones') {
      return '<div class="row-actions">'
        + `<button type="button" title="Detalle" data-accion="detalle" data-id="${rec.id}">${ICO_DETALLE}</button>`
        + `<button type="button" title="Información" data-accion="info" data-id="${rec.id}">${ICO_INFO}</button>`
        + `<button type="button" title="Duplicar" data-accion="duplicar" data-id="${rec.id}">${ICO_DUPLICAR}</button>`
        + `<button type="button" class="danger" title="Eliminar" data-accion="eliminar" data-id="${rec.id}">${ICO_ELIMINAR}</button>`
        + '</div>';
    }
    if (valor === undefined || valor === null || valor === '') {
      return '<span style="color:#a1a1a6;">—</span>';
    }
    if (col.kind === 'desc') {
      return `<span class="col-desc-cell" title="${escapeHtml(valor)}">${escapeHtml(valor)}</span>`;
    }
    if (col.campo && col.campo.type === 'select') {
      const texto = textoSelect(col.campo, valor);
      return col.resaltar ? `<span class="col-name-cell">${escapeHtml(texto)}</span>` : escapeHtml(texto);
    }
    return col.resaltar ? `<span class="col-name-cell">${escapeHtml(valor)}</span>` : escapeHtml(valor);
  }

  // ── Categorías (botones con los íconos minimalistas) ─────────────────────
  function renderCategorias() {
    const cont = document.getElementById('tipos-categorias');
    if (!cont) return;
    cont.innerHTML = CATS.map(c => `
      <button type="button" class="object-btn${c.clave === currentCategory ? ' active' : ''}" data-cat="${c.clave}">
        <span class="object-ico"><img src="assets/icons/${c.clave}.svg" alt="${escapeHtml(c.titulo)}" width="18" height="18"></span>
        ${escapeHtml(c.titulo)}
      </button>`).join('');
  }

  function marcarCategoriaActiva() {
    document.querySelectorAll('#ftth-tipos-modal .object-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === currentCategory);
    });
  }

  // Marca el tipo activo en el submenú desplegable del sidebar izquierdo
  function marcarTipoSidebar(clave) {
    document.querySelectorAll('#submenu-tipos .sub-tipo-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.clave === clave);
    });
  }

  // ── Cabecera de la tabla: columnas generadas desde el tipo ───────────────
  function renderCabecera(cfg) {
    const head = document.getElementById('tipos-table-head');
    if (!head) return;
    const cols = columnasDe(cfg);
    head.innerHTML = cols.map(c => {
      if (c.kind === 'acciones') return '<th style="width:110px;"></th>';
      const ancho = c.kind === 'color' ? ' style="width:56px;"' : '';
      const flecha = `<span class="sort-arrow" id="tipos-arrow-${c.key}">`
        + (currentSortField === c.key && !currentSortAsc ? '↓' : '↑') + '</span>';
      return `<th class="sortable"${ancho} data-sort="${c.key}">${escapeHtml(c.label)} ${flecha}</th>`;
    }).join('');
  }

  function ordenarFilas(cfg, lista) {
    const filas = (lista || []).slice();
    const col = columnasDe(cfg).find(c => c.key === currentSortField);
    if (!col) return filas;
    filas.sort((a, b) => {
      let av = valorDeFila(a, col, cfg);
      let bv = valorDeFila(b, col, cfg);
      const na = Number(av); const nb = Number(bv);
      if (av !== '' && bv !== '' && Number.isFinite(na) && Number.isFinite(nb)) {
        return currentSortAsc ? na - nb : nb - na;
      }
      av = String(av == null ? '' : av).toLowerCase();
      bv = String(bv == null ? '' : bv).toLowerCase();
      if (av < bv) return currentSortAsc ? -1 : 1;
      if (av > bv) return currentSortAsc ? 1 : -1;
      return 0;
    });
    return filas;
  }

  function sortTableBy(key) {
    if (currentSortField === key) currentSortAsc = !currentSortAsc;
    else { currentSortField = key; currentSortAsc = true; }

    const cfg = CATS_MAP[currentCategory];
    if (cfg) {
      columnasDe(cfg).forEach(c => {
        const flecha = document.getElementById('tipos-arrow-' + c.key);
        if (flecha) flecha.innerText = (c.key === currentSortField) ? (currentSortAsc ? '↑' : '↓') : '↑';
      });
      _filas = ordenarFilas(cfg, _porCat[cfg.clave]);
      pintarFilas(cfg);
    }
  }

  function actualizarPie(cantidad, total) {
    const el = document.getElementById('tipos-page-count');
    if (el) el.innerText = total > 0 ? `Mostrando 1 - ${cantidad} de ${total}` : 'Mostrando 0 - 0 de 0';

    const cfg = CATS_MAP[currentCategory];
    const lbl = document.getElementById('tipos-create-label');
    if (lbl && cfg) lbl.innerText = 'Nuevo tipo de ' + cfg.singular;
    const sub = document.getElementById('tipos-subtitle');
    if (sub && cfg) sub.innerText = cfg.titulo;
  }

  function pintarFilas(cfg) {
    const tbody = document.getElementById('tipos-table-body');
    if (!tbody) return;
    const cols = columnasDe(cfg);

    if (!_filas.length) {
      tbody.innerHTML = `<tr><td colspan="${cols.length}" class="table-empty">Sin tipos registrados.<br>`
        + `Usa «Nuevo tipo de ${escapeHtml(cfg.singular)}» para crear el primero.</td></tr>`;
    } else {
      tbody.innerHTML = _filas.map(rec => {
        const celdas = cols.map(c => `<td>${celdaHtml(c, rec, cfg)}</td>`).join('');
        return `<tr data-id="${rec.id}">${celdas}</tr>`;
      }).join('');
    }

    document.querySelectorAll('#tipos-table-body tr.selected').forEach(tr => tr.classList.remove('selected'));
    if (_editingId) {
      const tr = tbody.querySelector(`tr[data-id="${_editingId}"]`);
      if (tr) tr.classList.add('selected');
    }
    actualizarPie(_filas.length, (_porCat[cfg.clave] || []).length);
  }

  // ── Tabla: carga desde la base de datos y pinta ──────────────────────────
  async function renderTabla() {
    const cfg = CATS_MAP[currentCategory];
    const tbody = document.getElementById('tipos-table-body');
    if (!cfg || !tbody) return;

    renderCabecera(cfg);
    const cols = columnasDe(cfg);
    tbody.innerHTML = `<tr><td colspan="${cols.length}" class="table-empty">Consultando base de datos...</td></tr>`;

    try {
      const tipos = await api(`/api/tipos/${cfg.clave}`);
      _porCat[cfg.clave] = Array.isArray(tipos) ? tipos : [];
    } catch (err) {
      _porCat[cfg.clave] = [];
      tbody.innerHTML = `<tr><td colspan="${cols.length}" class="table-empty">Error: ${escapeHtml(err.message)}</td></tr>`;
      actualizarPie(0, 0);
      return;
    }

    _filas = ordenarFilas(cfg, _porCat[cfg.clave]);
    pintarFilas(cfg);
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

  // ── Formulario dinámico ──────────────────────────────────────────────────
  function valorInicial(f, data) {
    if (data && data[f.id] !== undefined && data[f.id] !== null && data[f.id] !== '') return data[f.id];
    return f.def !== undefined ? f.def : '';
  }

  function campoHtml(f, data) {
    const val = valorInicial(f, data);
    const id = 'f_' + f.id;

    if (f.type === 'checkbox') {
      return `<div class="checkbox-group"><input type="checkbox" class="apple-checkbox" id="${id}" ${val ? 'checked' : ''}>`
        + `<label for="${id}">${f.label}</label></div>`;
    }

    if (f.type === 'color') {
      const estiloLabel = f.small ? 'margin-bottom:0; font-size:11px;' : 'margin-bottom:0;';
      return '<div class="form-group" style="margin-bottom:0; display:flex; align-items:center; gap:8px;">'
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
      control = `<select class="form-control" id="${id}"${f.onchange ? ` onchange="${f.onchange}"` : ''}>${ops.join('')}</select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea class="form-control" id="${id}" placeholder="${escapeHtml(f.ph || '')}">${escapeHtml(val)}</textarea>`;
    } else if (f.type === 'calculo') {
      // Campo CALCULADO: se pinta pero no se puede escribir. Lo recalcula
      // actualizarCalculoCable() cada vez que cambia la estructura o los datos.
      control = `<input type="text" class="form-control campo-calculado" id="${id}" value="${escapeHtml(val)}" `
        + `readonly tabindex="-1" title="${escapeHtml(f.titulo || 'Se calcula solo: no se edita a mano.')}">`;
    } else {
      const extra = (f.step !== undefined ? ` step="${f.step}"` : '')
        + (f.min !== undefined ? ` min="${f.min}"` : '')
        + (f.max !== undefined ? ` max="${f.max}"` : '')
        + (f.oninput ? ` oninput="${f.oninput}"` : '');
      control = `<input type="${f.type || 'text'}" class="form-control" id="${id}" value="${escapeHtml(val)}" placeholder="${escapeHtml(f.ph || '')}"${extra}>`;
    }
    const condicional = f.soloSi ? ` data-solo-si="${escapeHtml(f.soloSi)}"` : '';
    return `<div class="form-group"${condicional}><label>${f.label}</label>${control}</div>`;
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

  // ── Estructura del cable: quién manda en cada campo ───────────────────────
  // El usuario solo ve lo que le toca:
  //   con buffer → looses, total de fibras, «fibras por loose» (CALCULADO) y perfil
  //   drop       → solo el total de hilos (select cerrado: 1, 2, 4, 6 u 8)
  // Las reglas viven en FTTHCableReglas (mismas que valida el backend).
  function _reglasCable() {
    return window.FTTHCableReglas || null;
  }

  function _valor(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || '') : '';
  }

  /** Muestra/oculta los campos que le tocan a la estructura elegida. */
  function aplicarEstructuraCable() {
    const reglas = _reglasCable();
    const cont = document.getElementById('dynamic-form');
    if (!reglas || !cont) return;
    const esDrop = _valor('f_estructura') === reglas.ESTRUCTURA_DROP;

    cont.querySelectorAll('[data-solo-si]').forEach(bloque => {
      const toca = bloque.getAttribute('data-solo-si');
      const visible = esDrop ? (toca === 'drop') : (toca === 'conBuffer');
      bloque.style.display = visible ? '' : 'none';
    });

    actualizarCalculoCable();
  }

  /** Recalcula «fibras por loose» (solo lectura) y el resumen del envase. */
  function actualizarCalculoCable() {
    const reglas = _reglasCable();
    if (!reglas) return;
    const campo = document.getElementById('f_fibrasLoose');
    const vista = document.getElementById('cable-preview');
    const esDrop = _valor('f_estructura') === reglas.ESTRUCTURA_DROP;

    const entrada = {
      estructura: esDrop ? reglas.ESTRUCTURA_DROP : reglas.ESTRUCTURA_CON_BUFFER,
      fibras: esDrop ? _valor('f_total_hilos') : _valor('f_fibras'),
      looses: _valor('f_looses'),
      perfil: _valor('f_perfil') || undefined,
    };
    const r = reglas.normalizar(entrada);

    if (campo) {
      campo.value = r.ok ? String(r.props.fibrasLoose) : '';
      campo.title = r.ok
        ? 'Se calcula solo: total de fibras ÷ número de buffers.'
        : r.error;
    }
    if (vista) {
      vista.textContent = r.ok ? r.props ? reglas.describir(r.props) : '' : r.error;
      vista.classList.toggle('cable-preview--error', !r.ok);
    }
  }

  /** Engancha el formulario del cable para que reaccione al vuelo. */
  function engancharEstructuraCable(cont) {
    if (!cont) return;
    ['f_estructura', 'f_looses', 'f_fibras', 'f_perfil', 'f_total_hilos'].forEach(id => {
      const el = cont.querySelector('#' + id);
      if (!el) return;
      const reaccionar = () => {
        if (id === 'f_estructura') aplicarEstructuraCable();
        else actualizarCalculoCable();
      };
      el.addEventListener('input', reaccionar);
      el.addEventListener('change', reaccionar);
    });
    aplicarEstructuraCable();
  }

  function updateSlotsTable(numSlots, detalle) {
    const tbody = document.getElementById('slots-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    let count = parseInt(numSlots, 10);
    if (!Number.isFinite(count) || count < 1) count = 1;
    if (count > 32) count = 32;
    for (let i = 1; i <= count; i++) {
      const d = (detalle && detalle[i - 1]) || {};
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><input type="number" value="${d.slot !== undefined ? d.slot : i}" min="1"></td>
        <td><input type="number" value="${d.puertos !== undefined ? d.puertos : 16}" placeholder="16"></td>
        <td><input type="number" value="${d.indice !== undefined ? d.indice : 1}" placeholder="1"></td>`;
      tbody.appendChild(row);
    }
  }

  function cargarPresetOlt(presetId) {
    const preset = PRESETS_OLT.find(p => p.id === presetId);
    if (!preset) return;
    const cont = document.getElementById('dynamic-form');
    if (!cont) return;

    const setVal = (id, val) => {
      const el = cont.querySelector('#f_' + id);
      if (el) {
        if (el.type === 'checkbox') el.checked = !!val;
        else el.value = (val !== undefined && val !== null) ? val : '';
      }
    };

    setVal('codigo', preset.codigo);
    setVal('marca', preset.marca);
    setVal('modelo', preset.modelo);
    setVal('tecnologia', preset.tecnologia);
    setVal('formato', preset.formato);
    setVal('puertos_pon', preset.puertos_pon);
    setVal('maxClientes', preset.maxClientes);
    setVal('potencia', preset.potencia);
    setVal('tamano', preset.tamano);
    setVal('puertos_sfp', preset.puertos_sfp);
    setVal('puertos_rj45_datos', preset.puertos_rj45_datos);
    setVal('puerto_mgmt', preset.puerto_mgmt);
    setVal('puerto_console', preset.puerto_console);
    setVal('numSlots', preset.numSlots);
    setVal('descripcion', preset.descripcion);

    cambiarFormatoOlt(preset.formato);
    updateSlotsTable(preset.numSlots, preset.slots_detalle);
  }

  function cambiarFormatoOlt(formato) {
    const cont = document.getElementById('dynamic-form');
    if (!cont) return;
    const esModular = (formato === 'modular');
    const wrapSlots = cont.querySelector('#olt-slots-container');
    if (wrapSlots) wrapSlots.style.display = esModular ? '' : 'none';

    const numSlotsEl = cont.querySelector('#f_numSlots');
    const numSlotsGroup = numSlotsEl ? numSlotsEl.closest('.form-group') : null;
    if (numSlotsGroup) numSlotsGroup.style.display = esModular ? '' : 'none';
  }

  // ── Selector del color del objeto (el que se usa en el mapa) ─────────────
  function campoColorObjeto(cfg, data) {
    const val = (data && data.color_mapa) || cfg.color || '#000000';
    return '<div class="form-group" style="display:flex; align-items:center; gap:10px;">'
      + '<label style="margin-bottom:0;">Color del objeto</label>'
      + `<input type="color" class="color-picker-input" id="f_color_mapa" value="${escapeHtml(val)}"`
      + ' oninput="this.nextElementSibling.textContent = this.value">'
      + `<span style="font-size:12px; color:#8e8e93;">${escapeHtml(val)}</span>`
      + '</div>';
  }

  // ── Splitter: division guardada y atenuacion nominal ──────────────────────
  const DIVISION_POR_DEFECTO = '1x8';

  /** Division guardada de un tipo: '1x16' (de relacion_division o entradas/salidas). */
  function divisionDe(props) {
    const p = props || {};
    const declarada = String(p.relacion_division || p.division || '').trim();
    const hallada = declarada.match(/(\d+)\s*[xX]\s*(\d+)/);
    if (hallada) return `${hallada[1]}x${hallada[2]}`;
    const salidas = Number(p.salidas);
    if (Number.isFinite(salidas) && salidas > 0) {
      const entradas = Number(p.entradas);
      return `${Number.isFinite(entradas) && entradas > 0 ? entradas : 1}x${salidas}`;
    }
    return '';
  }

  /** Atenuacion nominal (dB) de una division; null si no esta tabulada. */
  function nominalDe(division) {
    const clave = String(division || '').trim().toLowerCase();
    const valor = NOMINAL_SPLITTER[clave];
    return valor === undefined ? null : valor;
  }

  /** Sugiere en el campo de atenuacion la nominal de la division elegida. */
  function sugerirAtenuacion(select) {
    const division = (select && select.value) ? select.value : DIVISION_POR_DEFECTO;
    const nominal = nominalDe(division);
    const campo = document.getElementById('f_atenuacion');
    if (campo && nominal !== null) campo.value = String(nominal);
    return nominal;
  }

  function renderFormFields(clave, data) {
    const cfg = CATS_MAP[clave];
    const cont = document.getElementById('dynamic-form');
    if (!cfg || !cont) return;

    const esEdicion = !!data;
    // El formulario del splitter trabaja con la DIVISION, pero en la BD se guarda
    // como entradas/salidas: al abrir un tipo se reconstruye aqui (asi conserva lo
    // que se guardo) y al crear uno nuevo se parte del 1x8 por defecto, con su
    // atenuacion nominal ya sugerida en el campo.
    const datos = Object.assign({}, data || {});
    if (clave === 'splitter') {
      const division = divisionDe(datos) || DIVISION_POR_DEFECTO;
      datos.division = division;
      const sinAtenuacion = datos.atenuacion === undefined
        || datos.atenuacion === null || datos.atenuacion === '';
      if (!esEdicion || sinAtenuacion) datos.atenuacion = nominalDe(division);
    }
    if (clave === 'cables' && String(datos.estructura || '') === 'drop') {
      // Un drop guarda el total en `fibras`, pero el formulario lo enseña en el
      // select «Número total de hilos»: al reabrir el tipo hay que reconstruirlo.
      datos.total_hilos = datos.fibras;
    }
    let html = campoColorObjeto(cfg, data) + renderCampos(cfg.campos, datos);

    // Resumen en vivo del envase del cable (se recalcula desde aplicarEstructuraCable)
    if (clave === 'cables') html += '<div class="cable-preview" id="cable-preview"></div>';

    if (cfg.slots) {
      html += `
        <div id="olt-slots-container" class="olt-slots-wrapper">
          <label style="font-weight:600; font-size:12px; margin-top:10px; display:block;">Distribución de Slots (Equipos Modulares):</label>
          <table class="slots-table">
            <thead>
              <tr>
                <th>Número de Slot</th>
                <th>Número de puertos</th>
                <th>Índice inicial de puertos</th>
              </tr>
            </thead>
            <tbody id="slots-table-body"></tbody>
          </table>
        </div>`;
    }

    html += '<button class="btn-submit" type="button" onclick="FTTHTipos.handleSave()">'
      + (esEdicion ? 'Guardar Cambios' : 'Guardar') + '</button>';
    cont.innerHTML = html;

    // El cable decide qué campos manda cada estructura (con buffer / drop)
    if (clave === 'cables') engancharEstructuraCable(cont);

    if (clave === 'olt') {
      const formato = (datos && datos.formato) || 'compacto';
      cambiarFormatoOlt(formato);
    }

    if (cfg.slots) {
      const inp = cont.querySelector('#f_numSlots');
      const total = inp && inp.value ? inp.value : (cfg.slots.def || 2);
      updateSlotsTable(total, data ? data.slots_detalle : null);
    }
  }

  // ── Limites de los campos numericos ───────────────────────────────────────
  // min/max ya se pintan como atributos HTML, pero el navegador NO impide
  // teclear un valor mayor: aqui se ajusta y se avisa al guardar.
  let _limitesAplicados = [];

  function _ajustarAlLimite(f, valor, el) {
    const min = f.min !== undefined ? Number(f.min) : null;
    const max = f.max !== undefined ? Number(f.max) : null;
    let v = valor;
    if (min !== null && Number.isFinite(min) && v < min) v = min;
    if (max !== null && Number.isFinite(max) && v > max) v = max;
    if (v !== valor) {
      _limitesAplicados.push({ label: f.label || f.id, puesto: valor, limitado: v });
      if (el) el.value = String(v);   // que se vea el valor corregido en el formulario
    }
    return v;
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
        let v = (txt === '' || !Number.isFinite(num)) ? null : num;
        if (v !== null) v = _ajustarAlLimite(f, v, el);
        salida[f.id] = v;
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

  function formularioDesdeRegistro(rec) {
    const cfg = CATS_MAP[rec.categoria] || CATS_MAP[currentCategory] || {};
    const data = Object.assign({}, rec.propiedades || {});
    if (cfg.campoClave) data[cfg.campoClave] = rec.nombre_id;
    if (cfg.campoDesc) data[cfg.campoDesc] = rec.observaciones || '';
    data.color_mapa = rec.color_mapa || cfg.color || '#000000';
    return data;
  }

  // ── Navegación: categorías, tabla y formulario ───────────────────────────
  async function seleccionar(clave) {
    const cfg = CATS_MAP[clave];
    if (!cfg) return;
    currentCategory = clave;
    const visibles = columnasDe(cfg).filter(c => c.kind !== 'color' && c.kind !== 'acciones');
    currentSortField = visibles.length ? visibles[0].key : cfg.campoClave;
    currentSortAsc = true;
    marcarCategoriaActiva();
    marcarTipoSidebar(clave);
    hideForm();
    await renderTabla();
  }

  function showCreateForm() {
    const cfg = CATS_MAP[currentCategory];
    if (!cfg) { showToast('Selecciona primero un tipo de objeto'); return; }
    _editingId = null;
    _editingData = null;
    const t = document.getElementById('tipos-form-title');
    if (t) t.innerText = 'Crear Tipo de ' + cfg.titulo;
    document.querySelectorAll('#tipos-table-body tr.selected').forEach(tr => tr.classList.remove('selected'));
    renderFormFields(cfg.clave, null);
    const sec = document.getElementById('tipos-form-section');
    if (sec) sec.classList.add('visible');
  }

  function hideForm() {
    _editingId = null;
    _editingData = null;
    const sec = document.getElementById('tipos-form-section');
    if (sec) sec.classList.remove('visible');
    document.querySelectorAll('#tipos-table-body tr.selected').forEach(tr => tr.classList.remove('selected'));
  }

  // Clic sobre una fila -> carga el formulario en modo edición
  function editItemById(id, rowEl) {
    const cfg = CATS_MAP[currentCategory];
    const rec = (_porCat[currentCategory] || []).find(t => Number(t.id) === Number(id));
    if (!cfg || !rec) return;

    _editingId = rec.id;
    _editingData = rec;

    const t = document.getElementById('tipos-form-title');
    if (t) t.innerText = 'Editar: ' + ((rec.propiedades && rec.propiedades.nombre) || rec.nombre_id || 'Objeto');

    renderFormFields(currentCategory, formularioDesdeRegistro(rec));
    const sec = document.getElementById('tipos-form-section');
    if (sec) sec.classList.add('visible');

    document.querySelectorAll('#tipos-table-body tr').forEach(tr => {
      tr.classList.toggle('selected', Number(tr.dataset.id) === Number(id));
    });
    if (rowEl) rowEl.classList.add('selected');
  }

  // Duplicar: abre el formulario de creación precargado con esos datos
  function duplicarTipo(id) {
    const cfg = CATS_MAP[currentCategory];
    const rec = (_porCat[currentCategory] || []).find(t => Number(t.id) === Number(id));
    if (!cfg || !rec) return;

    _editingId = null;
    _editingData = null;

    const t = document.getElementById('tipos-form-title');
    if (t) t.innerText = 'Duplicar Tipo de ' + cfg.titulo;

    const data = formularioDesdeRegistro(rec);
    if (cfg.campoClave) data[cfg.campoClave] = String(data[cfg.campoClave] || '') + ' (copia)';

    renderFormFields(cfg.clave, data);
    const sec = document.getElementById('tipos-form-section');
    if (sec) sec.classList.add('visible');
    document.querySelectorAll('#tipos-table-body tr.selected').forEach(tr => tr.classList.remove('selected'));
  }

  function refrescar() {
    if (currentCategory) renderTabla();
  }

  // Compatibilidad con el API anterior
  function resetFormToCreateMode() {
    const cfg = CATS_MAP[currentCategory];
    if (!cfg) return;
    _editingId = null;
    _editingData = null;
    const t = document.getElementById('tipos-form-title');
    if (t) t.innerText = 'Crear Tipo de ' + cfg.titulo;
    renderFormFields(cfg.clave, null);
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

    // Si el usuario tecleo un valor fuera de rango, se ajusto al limite y se le dice.
    if (_limitesAplicados.length) {
      const detalle = _limitesAplicados
        .map(l => `${l.label}: ${l.puesto} se ajusto a ${l.limitado}`)
        .join(' - ');
      showToast('Valor fuera de rango: ' + detalle, 'warning');
      _limitesAplicados = [];
    }

    const nombre = String(valores[cfg.campoClave] || valores.nombre || valores.codigo || '').trim();
    if (!nombre) {
      showToast('Escribe el nombre o código del tipo', 'error');
      return;
    }

    // Un splitter se define por su DIVISIÓN. Se guarda como entradas x salidas
    // (lo que lee el backend para materializarlo y para poner la atenuación
    // nominal) y también como relacion_division, igual que los tipos antiguos.
    if (cfg.clave === 'splitter') {
      const division = String(valores.division || '').trim().toLowerCase();
      delete valores.division;
      const partes = division.split('x');
      const entradas = Number(partes[0]);
      const salidas = Number(partes[1]);
      const ok = division && Number.isFinite(entradas) && Number.isFinite(salidas)
        && entradas >= 1 && entradas <= SPLITTER_MAX_ENTRADAS
        && salidas >= 1 && salidas <= SPLITTER_MAX_SALIDAS;
      if (!ok) {
        showToast('Elige la división del splitter (por ejemplo 1 x 16)', 'error');
        return;
      }
      valores.relacion_division = division;
      valores.entradas = entradas;
      valores.salidas = salidas;
    }

    // ── Cable de fibra: el envase lo manda la ESTRUCTURA ─────────────────────
    // con buffer → fibras por loose = total ÷ looses (división exacta y tope del perfil)
    // drop       → sin buffer: looses=1 interno, fibrasLoose = total (1, 2, 4, 6 u 8)
    // Es la MISMA validación que aplica el backend al guardar el tipo.
    if (cfg.clave === 'cables') {
      const reglas = _reglasCable();
      const esDrop = reglas
        ? String(valores.estructura || '') === reglas.ESTRUCTURA_DROP
        : String(valores.estructura || '') === 'drop';
      const revisado = reglas
        ? reglas.normalizar({
            estructura: valores.estructura,
            looses: valores.looses,
            fibras: esDrop ? valores.total_hilos : valores.fibras,
            perfil: valores.perfil,
          })
        : { ok: false, error: 'Falta el módulo de reglas del cable (js/ftth-cable-reglas.js).' };

      if (!revisado.ok) {
        showToast(revisado.error, 'error');
        return;
      }
      delete valores.total_hilos;          // solo existe en el formulario
      delete valores.perfil;               // se vuelve a poner solo si tiene buffer
      Object.assign(valores, revisado.props);
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

    // Color elegido en el formulario (si el usuario lo cambió)
    const inputColor = document.getElementById('f_color_mapa');
    const colorElegido = inputColor && inputColor.value ? inputColor.value : null;

    const payload = {
      proyecto_id: Number(window.currentProjectId),
      categoria: currentCategory,
      nombre_id: nombre,
      color_mapa: colorElegido || (_editingData && _editingData.color_mapa) || cfg.color,
      foto: (_editingData && _editingData.foto) || null,
      observaciones: valores[cfg.campoDesc] || null,
      // Conserva las propiedades previas que no gestiona el formulario
      propiedades: Object.assign({}, (_editingData && _editingData.propiedades) || {}, propiedades)
    };

    const id = _editingId;
    try {
      if (id) {
        await api(`/api/tipos/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('¡Cambios guardados correctamente!');
      } else {
        await api('/api/tipos/', { method: 'POST', body: JSON.stringify(payload) });
        showToast('¡Cambios guardados! Objeto creado en la base de datos');
      }
      hideForm();
      await renderTabla();
    } catch (err) {
      showToast('Error al guardar: ' + err.message, 'error');
    }
  }

  async function deleteTipo(id) {
    if (!confirm('¿Eliminar este tipo de objeto de la base de datos?')) return;
    try {
      await api(`/api/tipos/${id}`, { method: 'DELETE' });
      showToast('Tipo eliminado de la base de datos');
      if (Number(_editingId) === Number(id)) hideForm();
      await renderTabla();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Abrir / cerrar el panel ──────────────────────────────────────────────
  // Ajusta la ventana al layout real: deja visible la barra lateral (con su
  // despliegue de tipos) y la barra superior; el panel sale a la derecha.
  function ajustarVentana(modal) {
    if (!modal || !modal.style || !modal.style.setProperty) return;
    const sidebar = document.getElementById('sidebar-navy');
    const topbar = document.getElementById('topbar');
    let izq = 210;
    let arriba = 52;
    try {
      if (sidebar && sidebar.getBoundingClientRect) izq = Math.round(sidebar.getBoundingClientRect().width) || 210;
      if (topbar && topbar.getBoundingClientRect) arriba = Math.round(topbar.getBoundingClientRect().height) || 52;
    } catch (e) { /* medidas no disponibles: se usan los valores por defecto */ }
    modal.style.setProperty('--tipos-left', izq + 'px');
    modal.style.setProperty('--tipos-top', arriba + 'px');
  }

  function openModal(categoria) {
    if (!window.currentProjectId) {
      alert('⚠️ Selecciona o crea un proyecto en la barra superior antes de gestionar tipos.');
      return;
    }
    const modal = document.getElementById('ftth-tipos-modal');
    if (!modal) return;

    ajustarVentana(modal);
    modal.classList.remove('hidden');
    renderCategorias();

    let clave = CATS[0].clave;
    if (categoria && CATS_MAP[categoria]) clave = categoria;
    else if (currentCategory && CATS_MAP[currentCategory]) clave = currentCategory;

    seleccionar(clave);
  }

  // Abre el panel directamente en un tipo (lo usa el submenú del sidebar)
  function abrirTipo(clave) {
    if (!CATS_MAP[clave]) return;
    openModal(clave);
  }

  function closeModal() {
    const modal = document.getElementById('ftth-tipos-modal');
    if (modal) modal.classList.add('hidden');
    hideForm();
  }

  // Compatibilidad con las llamadas antiguas (openSubpanel / closeSubpanel)
  function openSubpanel(clave, event) {
    if (!CATS_MAP[clave]) return;
    const modal = document.getElementById('ftth-tipos-modal');
    if (modal && modal.classList.contains('hidden')) { openModal(clave); return; }
    seleccionar(clave);
  }

  function closeSubpanel() {
    hideForm();
  }

  // ── Consultas para el resto de la app ────────────────────────────────────
  function getCategorias() {
    const salida = {};
    CATS.forEach(c => { salida[c.clave] = c; });
    return salida;
  }

  async function getTipos(categoria) {
    if (!window.currentProjectId || !CATS_MAP[categoria]) return [];
    return await api(`/api/tipos/${categoria}`);
  }

  // ── Inicialización ───────────────────────────────────────────────────────
  function init() {
    if (_iniciado) return;
    _iniciado = true;

    const modal = document.getElementById('ftth-tipos-modal');
    const cats = document.getElementById('tipos-categorias');
    const head = document.getElementById('tipos-table-head');
    const tbody = document.getElementById('tipos-table-body');

    if (modal) {
      modal.addEventListener('click', ev => { if (ev.target === modal) closeModal(); });
    }

    if (cats) {
      cats.addEventListener('click', ev => {
        const btn = ev.target.closest('.object-btn');
        if (btn && btn.dataset.cat) seleccionar(btn.dataset.cat);
      });
    }

    if (head) {
      head.addEventListener('click', ev => {
        const th = ev.target.closest('th[data-sort]');
        if (th) sortTableBy(th.dataset.sort);
      });
    }

    if (tbody) {
      tbody.addEventListener('click', ev => {
        const accion = ev.target.closest('button[data-accion]');
        if (accion) {
          ev.stopPropagation();
          const id = Number(accion.dataset.id);
          const tipo = accion.dataset.accion;
          if (tipo === 'eliminar') { deleteTipo(id); return; }
          if (tipo === 'duplicar') { duplicarTipo(id); return; }
          editItemById(id, accion.closest('tr'));
          return;
        }
        const tr = ev.target.closest('tr[data-id]');
        if (tr) editItemById(Number(tr.dataset.id), tr);
      });
    }

    document.addEventListener('keydown', ev => {
      if (ev.key !== 'Escape' || !modal || modal.classList.contains('hidden')) return;
      const sec = document.getElementById('tipos-form-section');
      if (sec && sec.classList.contains('visible')) { hideForm(); return; }
      closeModal();
    });

    document.addEventListener('project-changed', () => {
      if (!modal || modal.classList.contains('hidden')) return;
      _porCat = {};
      if (currentCategory) renderTabla();
    });

    renderCategorias();
  }

  // ── API pública (la que usa el resto de la app) ──────────────────────────
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
    cargarPresetOlt,
    cambiarFormatoOlt,
    PRESETS_OLT,
    getCategorias,
    getTipos,
    showToast,
    deleteTipo,
    divisionDe,
    nominalDe,
    sugerirAtenuacion,
    NOMINAL_SPLITTER,
    // extras del nuevo diseño
    seleccionar,
    abrirTipo,
    showCreateForm,
    hideForm,
    duplicarTipo,
    refrescar,
    sortTableBy,
    CATS,
    _setActiveTab: (cat) => openModal(cat)
  };
})();

window.FTTHTipos = FTTHTipos;
