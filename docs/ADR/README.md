# Decisiones de arquitectura

| Documento | Decisión | Evidencia y estado |
|---|---|---|
| [ADR-12](ADR-12-pasarelas.md) | Puerto de pagos y selección de adaptador. Wompi sandbox en la demo Fase 1; PayU conservado como alternativa conectable. | Decisión de cierre registrada el 22/11/2026. Adaptador y firma de PayU cubiertos en CI. |
| [ADR-13](../ADR-13-backups-monitoreo.md) | Copias de MongoDB en Cloudflare R2, retención de 30 días y monitoreo de la API con CloudWatch y SNS. | El documento de Infraestructura está versionado con estado **Propuesto**. La CI cubre creación, retención y lectura de copias. Operación en producción por confirmar con Infraestructura. |
| [ADR-14](../ADR-14-consolidacion-whatsapp-legacy-fyn.md) | `ReservaYa-Whatsapp` como receptor oficial del webhook de Meta y retiro del servicio FYN. | Decisión **Aceptada** en el ADR. La prueba de integración de Back usa un bot simulado. La versión que atiende el número de prueba está por confirmar. |

[Arquitectura hexagonal](../Arquitectura/ARQUITECTURA_HEXAGONAL.md) · [Evidencia de CI](../Pruebas/evidencia-ci.md)
