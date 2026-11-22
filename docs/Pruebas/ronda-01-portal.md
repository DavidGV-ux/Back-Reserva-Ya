# Ronda 01 del portal de ReservaYa

**Fecha** · 20 de noviembre de 2026, Colombia.
**Entorno** · [Portal indicado para la demo](https://djbfmoum5t7ct.cloudfront.net/).
**Versión desplegada** · Commit por confirmar.
**Método** · Navegación pública, como invitado, desde el directorio de negocios.

## Resultado de la ronda

| Caso | Estado | Resultado observado |
|---|---|---|
| P-PORTAL | Aprobado | La portada cargó. El directorio listó Café Demo. Los enlaces al portal del negocio y a su página de reservas abrieron sin iniciar sesión. |
| P-CA01 | Bloqueado | Café Demo figuró con 0 servicios y 0 profesionales. La página de reservas mostró el paso Service sin opciones y el botón Next deshabilitado. |
| P-CA02 | Bloqueado | El paso Details quedó deshabilitado porque el primer paso exige seleccionar un servicio. El formulario de consentimiento quedó pendiente. |
| P-CA09 | Por ejecutar | La pantalla anuncia 30 minutos para pagar. La expiración efectiva y la liberación del horario quedan pendientes de medir. |

Páginas observadas: [directorio](https://djbfmoum5t7ct.cloudfront.net/), [portal de Café Demo](https://djbfmoum5t7ct.cloudfront.net/demo-cafe) y [pantalla de reserva](https://djbfmoum5t7ct.cloudfront.net/demo-cafe/reservar).

En una comprobación posterior del mismo día, el portal siguió mostrando cero profesionales. El paso **Service** abrió sin opciones, **Next** siguió deshabilitado y **Details** quedó inaccesible. P-CA01 y P-CA02 conservan el estado **Bloqueado**. [Pantalla de reserva comprobada](https://djbfmoum5t7ct.cloudfront.net/demo-cafe/reservar)

## Diferencias para revisar con el equipo

- **Plazo de pago.** La interfaz en inglés dice «The payment must be completed within 30 minutes or the slot is released». El SRS indica 15 minutos en RF-5.4 y RNF-21. El texto de pantalla documenta lo anunciado. Para la decisión D-01, hay que medir el vencimiento y la hora real de liberación.
- **Pasos del recorrido.** La pantalla muestra cuatro etiquetas: Service, Schedule, Details y Payment. RNF-12 establece un máximo de tres pasos o pantallas. Acuerda si se incluye el pago en ese conteo y registra los pasos de una reserva completa.
- **Traducciones.** En la vista en inglés quedaron visibles las claves literales `footer.privacy` y `footer.habeas`. Es una observación puntual para P-CA33 y la revisión del manual bilingüe.

## Preparación requerida para retomar

En Café Demo, el dueño debe publicar un servicio, asignarlo a un profesional activo y habilitar al menos un horario futuro. También sirve otro negocio de prueba con esos tres elementos. Una vez visible el servicio en el portal público, retoma P-CA01 y P-CA02. Usa el sandbox acordado antes de ensayar el pago.
