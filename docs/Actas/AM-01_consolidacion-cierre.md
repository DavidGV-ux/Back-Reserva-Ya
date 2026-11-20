# AM-01 · Acta de consolidación de requisitos de ReservaYa

**Fecha de registro** · 20 de noviembre de 2026  
**Alcance** · Entrega de la Fase 1  
**Documentos de referencia** · SRS 1.1 del 7 de septiembre de 2026 y [SRS v2](../SRS/SRS-v2.md)

## Consolidación incorporada

El SRS v2 conserva los identificadores y el contenido de los 38 requisitos funcionales, 27 requisitos no funcionales, 30 reglas de negocio y 39 historias de usuario de la línea base. La nueva edición reúne el contexto de entrega, los criterios medibles y la evidencia disponible para verificar el cumplimiento.

Los requisitos vigentes se conservan mientras se validan las diferencias registradas en esta acta.

## Registro de diferencias y validaciones

| Referencia | Hallazgo documentado | Evidencia requerida |
|---|---|---|
| **D-01 · Plazo de pago y liberación** · RF-5.4, RNF-21, EC04, CA09 | El SRS fija 15 minutos para pagar y el portal de demostración mostraba 30. EC04 mide un intervalo distinto: hasta cinco minutos desde el vencimiento hasta la liberación de la franja. | Medir el plazo real de pago y el tiempo que tarda en liberarse la franja. Registrar ambos valores y la configuración del ambiente. |
| **D-02 · Reembolso por cancelación a tiempo** · RF-5.5, RN-5.5, CA10 | RN-5.5 prevé descontar el costo de procesamiento. CA10 espera la devolución del 100 % del anticipo. | Formalizar la regla aplicable y comprobar el importe devuelto en una cancelación de cliente en sandbox. |
| **D-03 · Pasarela de pago** · RF-5.1–RF-5.3 | El SRS establece Wompi en sandbox para la Fase 1. La integración continua cubre escenarios controlados con Wompi y PayU. | Identificar proveedor y modo en el ambiente de entrega. Registrar una transacción de prueba, el estado de la cita y su efecto en el libro contable. |
| **D-04 · Confirmación y avisos** · RF-4.1, RF-4.2, RN-4.1 | La integración continua comprueba la emisión de avisos y el respaldo por correo. RN-4.1 exige que el cliente reciba la confirmación. | Registrar por separado el estado de la cita, el envío y la recepción efectiva. Anotar canal, hora y resultado del respaldo cuando aplique. |
| **D-05 · Reserva por WhatsApp** · RF-4.3–RF-4.7 | El ADR-14 identifica el servicio conversacional oficial. El backend cuenta con una prueba de integración del recorrido. | Identificar la versión desplegada y comprobar, desde el canal de prueba, la creación de la reserva, el enlace de anticipo y la redirección al portal cuando aplique. |
| **D-06 · Respaldos y archivo de registros** · RNF-26 | La integración continua aporta evidencia sobre copias de base de datos, retención y restauración. RNF-26 exige archivar en R2 y purgar registros operativos con más de 90 días. | Registrar la evidencia del archivado y la purga en el ambiente evaluado. |
| **D-07 · Correspondencia de criterios de calidad** · RNF-27, EC09 | RNF-27 mide el tiempo de respuesta y el procesamiento asíncrono del webhook. EC09 evalúa la protección de credenciales. | Corregir la correspondencia en la trazabilidad y vincular RNF-27 con una prueba que mida ambos criterios. |
| **Recorrido web e idioma** · RNF-12, RNF-14 | El portal mostró cuatro etapas frente al máximo de tres pasos o pantallas del SRS. En inglés se observaron claves de traducción visibles. | Ejecutar una reserva de invitado, registrar las pantallas utilizadas y comprobar los textos en español e inglés. |

## Formalización de cambios

Cuando se apruebe una modificación, el registro correspondiente debe indicar la fecha, el requisito afectado, el texto aprobado, la versión en que aplica y la evidencia que respalda la decisión. El resultado de una prueba se registra con el ambiente y la versión evaluada.

## Evidencia de referencia

- [SRS v2 · Evidencia y aceptación de la versión](../SRS/SRS-v2.md)
- [Resultados de integración continua del backend](../Pruebas/evidencia-ci.md)
- [Ronda de revisión del portal de demostración](../Pruebas/ronda-01-portal.md)
