# Arquitectura hexagonal de ReservaYa

El backend aplica las reglas de disponibilidad, reserva, cancelación, anticipo y comisión desde los casos de uso. El portal web, el servicio conversacional y los trabajos programados activan esos casos de uso. Los adaptadores conectan el backend con MongoDB, las pasarelas, los canales de avisos y el proveedor de identidad. [Puertos de servicios externos](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/src/domain/ports/gateways.ts)

| Flujo | Entrada | Responsabilidad del backend | Salida o dependencia |
|---|---|---|---|
| Reserva y disponibilidad | Solicitud del portal o del bot | Validar negocio, servicio, horario y consentimiento. Crear y mantener la cita. | MongoDB. |
| Anticipo y comisión | Inicio de pago y respuesta de la pasarela | Asociar pago y cita, aplicar la transición y registrar el efecto contable una vez. | Adaptador de pagos y libro contable. |
| Expiración | Trabajo programado cada cinco minutos en la configuración versionada | Expirar citas pendientes cuyo plazo terminó y liberar el horario. | Repositorios de citas y disponibilidad. |
| Avisos | Evento de cita o trabajo de recordatorios | Seleccionar el canal según la configuración, registrar el resultado y aplicar el canal de respaldo cuando corresponde. | `NotificationGateway`, WhatsApp o correo. |
| Conversación de WhatsApp | Mensaje recibido por el bot | Resolver el negocio, usar los casos de uso de reserva y preparar el enlace de anticipo. | Meta, `ReservaYa-Whatsapp` y Back. |
| Identidad | Inicio de sesión en navegador | Verificar identidad, rol y membresía. | Keycloak y registros de membresía. |
| Respaldos | Trabajo programado | Serializar y comprimir colecciones de MongoDB, exportar la copia y aplicar retención. | Cloudflare R2. |

## Pagos

`PaymentGatewayProvider` es el puerto de las pasarelas. `PAYMENT_PROVIDER` selecciona el adaptador. Wompi en sandbox forma parte del alcance acordado en el SRS. Wompi y PayU tienen casos de integración aprobados. La pasarela configurada en el entorno de entrega se confirma con una transacción de prueba. [ADR-12](../ADR/ADR-12-pasarelas.md) · [Evidencia de CI](../Pruebas/evidencia-ci.md)

## Avisos y WhatsApp

Back coordina la confirmación, la cancelación y los recordatorios. La configuración versionada define `WHATSAPP_PROVIDER` con `resend` como valor predeterminado y programa el envío de recordatorios cada cinco minutos. CI verifica los eventos de cita y el respaldo por correo ante un fallo simulado de WhatsApp. [Configuración de Back](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/serverless.yml) · [Pruebas de avisos y recordatorios](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/notifications-reminders.test.ts)

El ADR-14 asigna a `ReservaYa-Whatsapp` la recepción del webhook de Meta y establece el retiro de FYN. El diseño valida la firma y usa el identificador de mensaje `wamid` para deduplicar reintentos. El recorrido de CI usa un simulador local del bot para comprobar reserva, enlace de pago, confirmación y recordatorio. La prueba en el entorno de entrega debe identificar la versión del bot y comprobar el canal efectivo de los avisos. [ADR-14](../ADR-14-consolidacion-whatsapp-legacy-fyn.md) · [Prueba de integración de WhatsApp](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/whatsapp-e2e.test.ts)

## Respaldos y monitoreo

El ADR-13 de Infraestructura figura como **Propuesto**. La configuración de referencia define `export-backup-r2` a las 02:00 UTC y 30 días de retención predeterminada. Las pruebas cubren la generación de copias BSON comprimidas, la retención y la recuperación de los documentos desde una copia. El runbook describe las alarmas de errores, duración y throttling de la API en CloudWatch y su notificación por SNS. Para confirmar la operación del entorno de entrega, registrar una ejecución del trabajo, un resultado de restauración controlada y el estado de las alarmas. El archivado de registros históricos de RNF-26 tiene su propia política y requiere evidencia del flujo de archivo y purga. [ADR-13](../ADR-13-backups-monitoreo.md) · [Runbook](../RUNBOOK-INFRA.md) · [Evidencia de CI](../Pruebas/evidencia-ci.md)

[Diagramas](../Diagramas/README.md) · [Decisiones de entrega en AM-01](../Actas/AM-01_consolidacion-cierre.md)
