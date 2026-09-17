# Modulo de propiedades de postes

Este paquete contiene los archivos que forman el panel emergente de propiedades:

- `frontend/index.html`: estructura HTML del modal, pestañas y botones.
- `frontend/css/prop-modal.css`: estetica, campos, estados y animaciones.
- `frontend/js/ftth-mapa.js`: apertura desde el menu contextual, carga de datos,
  cambio de pestañas, historial, fotos y guardado.
- `frontend/js/app.js`: integracion del boton Guardar/Cerrar con el modal legado.
- `backend/app/routers/ftth_elementos.py`: endpoint `PUT /api/elementos/{id}`
  que persiste coordenadas y `propiedades_instancia` en la base de datos.

## Flujo del modulo

1. `ftth-mapa.js` recibe el elemento desde el menu contextual del mapa.
2. `showPropertiesModal()` rellena `#element-properties-fields`.
3. `switchPropTab()` activa las pestañas y sus animaciones CSS.
4. `guardarPropiedadesElemento()` envia los cambios al endpoint PUT.
5. El router de FastAPI actualiza `ftth_elementos` y confirma la operacion.

## Dependencias internas

- `window.map` de MapLibre para actualizar la geometria.
- `FTTHCarpetas.loadCarpetas()` para refrescar el panel de carpetas.
- `FTTHTipos.showToast()` para mostrar mensajes de guardado/error.
- Endpoints:
  - `GET /api/elementos/{id}/historial`
  - `GET /api/elementos/{id}/fotos`
  - `PUT /api/elementos/{id}`

El cambio de estetica debe hacerse principalmente en
`frontend/css/prop-modal.css`. La logica de datos esta en
`frontend/js/ftth-mapa.js`; no es recomendable modificarla para cambiar solo
colores, tamanos, espaciado o animaciones.
