# ReservaYa · Entrega y cierre de la Fase 1

ReservaYa es una plataforma de reservas de servicios. La Fase 1 comprende la consulta de disponibilidad, la gestión de citas por rol, el pago de anticipos, las notificaciones y el canal de WhatsApp. El alcance de la versión entregada se establece en el documento de requisitos y en las actas de modificación.

## Documentación de entrega

| Documento | Contenido |
|---|---|
| [Especificación de requisitos](SRS/) | SRS v2 en Markdown y PDF. Define el alcance, los requisitos funcionales y no funcionales, las reglas de negocio y los criterios de aceptación. |
| [Actas de modificación](Actas/) | Cambios aprobados durante el proyecto, requisitos afectados y decisiones que fijan el alcance final. |
| [Matriz de trazabilidad](Trazabilidad/) | Relación entre cada requisito o regla de negocio, el componente que lo implementa, el caso de prueba y la evidencia disponible. |
| [Plan y resultados de pruebas](Pruebas/) | Casos de prueba y resultados por caso, con el ambiente, la versión evaluada y la evidencia de ejecución. |
| [Arquitectura del sistema](Arquitectura/) | Estructura del software, responsabilidades de sus componentes e integraciones con servicios externos. |
| [Decisiones de arquitectura](ADR/) | Decisiones técnicas, sus motivos y sus efectos sobre el sistema. Incluye la referencia al [ADR de respaldos y monitoreo](ADR-13-backups-monitoreo.md). |
| [Diagramas del sistema](Diagramas/) | Despliegue en AWS, modelo de datos de MongoDB, casos de uso y secuencias de pago, expiración y notificación. |
| [Manual de usuario](Manual/) | Guías en español e inglés para realizar los recorridos disponibles según el rol. |
| [Guía de operaciones](RUNBOOK-INFRA.md) | Procedimientos de despliegue, reversión, respaldos y monitoreo. |
| [Acta y demostración de cierre](Cierre/) | Acta de entrega, presentación y grabación de los recorridos web y de WhatsApp. |

## Verificación y aceptación

Para comprobar un requisito, localiza su identificador en el SRS, busca su fila en la matriz de trazabilidad y consulta el resultado y la evidencia del caso asociado. El registro de pruebas indica en qué versión y ambiente se obtuvo el resultado.

El acta de cierre reúne la versión entregada, la fecha y el ambiente de validación, los resultados de la revisión, los pendientes acordados y la decisión de aceptación.