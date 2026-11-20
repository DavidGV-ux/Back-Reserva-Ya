# Plan de pruebas de cierre

Usa los [casos](casos.md) y el [registro de resultados](resultados.csv). Antes de la ronda, confirma el ambiente, una cuenta activa para cada rol de dueño, profesional y cliente, y una forma de probar la activación de una cuenta nueva. Usa un negocio y contactos ficticios, pagos en sandbox y una base aislada para restauración. La ronda manual verifica la aplicación desplegada, incluidos el portal, los flujos por rol, el proveedor y los avisos. La matriz de requisitos se publica con [RES-61](https://linear.app/reservaya/issue/RES-61). Los resultados de Back están en la [evidencia de CI](evidencia-ci.md).

## Ronda prioritaria

| Orden | Casos | Qué comprobar | Quién puede ejecutarlo |
|---|---|---|---|
| 1 | P-CA28, P-CA31 | Registro, activación e inicio de sesión. En una sesión aparte, usar cuentas activadas para verificar los roles. | Front e identidad |
| 2 | P-CA01–P-CA05 | Reserva web, consentimiento, franja ocupada, reintento y horario inválido. | Cesar con Back |
| 3 | P-CA06–P-CA09 | Pago, confirmación, actualización contable y expiración. | David o responsable de pagos |
| 4 | P-CA10–P-CA23 | Cancelación, reembolso, agenda y reportes. | Front con Back |
| 5 | P-CA24–P-CA27, P-RF-4.5, P-RF-4.6 | Confirmación, recordatorio, canal alternativo y reserva por WhatsApp. | Responsable de integraciones |
| 6 | P-CA29–P-CA30, P-CA32–P-CA38 | Alta de negocio e invitación, bilingüismo, portal público y soporte de infraestructura. | Daniel e infraestructura |

Los casos adicionales del inventario conservan el criterio del SRS. Si un caso cubre un requisito parcialmente, añade pasos o un caso complementario y registra el alcance exacto. Un resultado favorable de pago, por ejemplo, cubre el flujo feliz. RNF-19 también exige evidencia para transacciones rechazadas y devueltas.

## Matriz de estados para la ronda

Usa el nombre técnico que observe el equipo en el sistema. Las filas de esta tabla describen el comportamiento esperado a partir de las fuentes.

| Estado inicial | Evento o acción | Estado esperado | Qué mirar | Caso |
|---|---|---|---|---|
| Horario libre | Reserva completa y consentimiento | Pendiente de pago | Horario ocupado y valor del anticipo | P-CA01 |
| Pendiente de pago | Anticipo aprobado | Confirmada según regla acordada en D-04 | Estado, referencia, comisión, abono y aviso | P-CA06, P-CA24 |
| Pendiente de pago | Vence el plazo | Expirada | Horas de vencimiento y liberación | P-CA09 |
| Pendiente de pago | Cliente cancela antes de pagar | Cancelada | Sin operación de reembolso | P-CA12 |
| Confirmada | Cliente cancela dentro del plazo | Cancelada | Importe y estado de reembolso según D-02 | P-CA10 |
| Confirmada | Cliente cancela fuera del plazo permitido | Cancelada | Aviso y resultado sin reembolso | P-CA11 |
| Confirmada | Cancela el negocio | Cancelada | Liberación de franja y devolución aplicable | P-CA15, P-CA16 |
| Confirmada y hora transcurrida | Profesional registra asistencia | Estado final de asistencia | Estado visible y persistido con el actor correspondiente | P-AST |
| Finalizada, cancelada o expirada | Se intenta cancelar de nuevo | Conserva el estado | Resultado de la suite y estado final | P-CA13 |

## Cómo registrar cada ejecución

1. Abre `resultados.csv` en una hoja de cálculo. Usa una fila por ejecución y conserva el ID del caso. Añade una fila si repites la prueba.
2. Escribe persona, fecha, ambiente, commit, resultado observado y enlace a captura, ejecución de CI o registro autorizado. Añade la incidencia cuando haya un fallo.
3. Usa los estados **Aprobado**, **Falló**, **Bloqueado** o **Por ejecutar** para la ronda manual. Las filas `E-CI` conservan **Aprobado en CI** como referencias a la corrida de Back. Si faltan datos, acceso o una decisión, indica el motivo del bloqueo.
4. En la matriz, enlaza cada requisito con la ejecución relevante. Para evidencias históricas conserva el alcance y la fecha. Registra resultados actuales y las limitaciones para la entrega.

La auditoría reporta 52 casos en el ambiente del 10 de noviembre de 2026. Calidad reporta 10 escenarios cubiertos, 3 parciales y 5 pendientes en su propia fecha. Esas cifras conservan su alcance original. Completa el reporte de cierre a partir de la ronda registrada en este archivo.

## Primera ronda

El registro contiene 83 entradas, de las cuales 69 están por ejecutar, 2 bloqueadas, 1 aprobada en la revisión pública y 11 aprobadas en CI. Las 11 filas de CI corresponden a una corrida y sus subconjuntos. Para retomar P-CA01 y P-CA02, publica un servicio, asígnalo a un profesional activo y habilita un horario futuro en un negocio de prueba. [Evidencia de la revisión pública](ronda-01-portal.md)
