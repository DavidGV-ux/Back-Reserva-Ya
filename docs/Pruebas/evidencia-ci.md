# Evidencia de integración continua y de ambiente

El [workflow de Back](https://github.com/DavidGV-ux/Back-Reserva-Ya/actions/runs/44246667139) ejecutado el **18 de noviembre de 2026 UTC**, sobre el commit [`870ad2438c3f`](https://github.com/DavidGV-ux/Back-Reserva-Ya/commit/870ad2438c3f3452879da0d36ba19ad0495d97ca), terminó satisfactoriamente. La salida de Vitest registra **32 archivos y 218 pruebas aprobadas**. Las filas siguientes son referencias a subconjuntos de esa corrida.

| ID | Cobertura | Resultado observado | Fuente de caso |
|---|---|---|---|
| E-CI-01 | Corte completo del backend | 32 archivos de pruebas y 218 casos aprobados. Verificación de tipos aprobada. | Flujo CI general |
| E-CI-02 | Integraciones de pasarela Wompi y PayU | 8 pruebas de integración aprobadas. Comprueban, entre otros, registro de pago y efecto contable. | [payments-providers.test.ts](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/payments-providers.test.ts) |
| E-CI-03 | Expiración | 4 pruebas aprobadas. Cubren vencimiento, liberación y casos de transición. | [expiration.test.ts](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/expiration.test.ts) |
| E-CI-04 | Reserva | 7 pruebas de integración aprobadas. Cubren alta, disponibilidad, repetición, conflicto y cancelación. | [booking.test.ts](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/booking.test.ts) |
| E-CI-05 | Concurrencia | 1 prueba aprobada en integración. | [concurrency.test.ts](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/concurrency.test.ts) |
| E-CI-06 | Confirmación, cancelación y recordatorio | 3 pruebas aprobadas. Incluyen respaldo por correo y programación del recordatorio. | [notifications-reminders.test.ts](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/notifications-reminders.test.ts) |
| E-CI-07 | Reportes del dueño | 4 pruebas de integración aprobadas. | [owner-reports.test.ts](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/owner-reports.test.ts) |
| E-CI-08 | Cancelación de profesional | 6 pruebas de integración aprobadas. | [professional-cancel.test.ts](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/professional-cancel.test.ts) |
| E-CI-09 | Recorrido de WhatsApp en Back | 1 prueba de integración aprobada. | [whatsapp-e2e.test.ts](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/whatsapp-e2e.test.ts) |
| E-CI-10 | Creación, retención y restauración de copias | 6 pruebas de integración aprobadas en tres archivos. | [create-backup.test.ts](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/create-backup.test.ts) |
| E-CI-11 | Alta de negocio | 4 pruebas de integración aprobadas. | [onboarding.test.ts](https://github.com/DavidGV-ux/Back-Reserva-Ya/blob/870ad2438c3f3452879da0d36ba19ad0495d97ca/test/integration/onboarding.test.ts) |

Los casos se ejecutan en CI bajo condiciones controladas. La prueba de WhatsApp del backend verifica la integración interna en ese entorno. La entrega real por Meta y las transacciones en el ambiente de demostración se comprueban aparte.

| Componente | Referencia comprobada | Alcance |
|---|---|---|
| Front | [CI del Front](https://github.com/DavidGV-ux/Front-ReservaYa/actions/runs/44246673927) · [`5d0a3a11d3a8`](https://github.com/DavidGV-ux/Front-ReservaYa/commit/5d0a3a11d3a843628cc5a782c63b93a7a24a0910) | Compilación de producción exitosa. |
| Monorepo | [CI del monorepo](https://github.com/DavidGV-ux/Modelo-de-datos-Reserva-Ya/actions/runs/44244803413) | Ejecución exitosa de su workflow de validación del backend. |
| WhatsApp | [`bf36f06c6c40`](https://github.com/DavidGV-ux/ReservaYa-Whatsapp/commit/bf36f06c6c4047e6c8aa7aea88916cbcfcda5113) | Referencia del repositorio del bot. Su versión desplegada se verifica con el responsable. |
| Ambiente E-UI-01 | [Portal de revisión](https://djbfmoum5t7ct.cloudfront.net/) · [Ronda 01](ronda-01-portal.md) | 20/11/2026. Acceso público comprobado. Reserva y consentimiento bloqueados por falta de servicios y profesionales. Commit desplegado por confirmar. |

La auditoría externa del 10/11/2026 documentó 52 casos en el ambiente evaluado ese día. Sus referencias por ID se registran en la matriz de trazabilidad de [RES-61](https://linear.app/reservaya/issue/RES-61).
