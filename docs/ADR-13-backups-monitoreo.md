# ADR-13: Estrategia de Backups y Monitoreo de Infraestructura

**Estado:** Propuesto (pendiente despliegue a producción)
**Fecha:** 2026-09-27
**Autora:** Ginna Plazas (I4 — Infraestructura/DevOps)

## Contexto

ReservaYa no contaba con ningún mecanismo de respaldo de la base de datos de producción (MongoDB Atlas), ni con monitoreo activo de la Lambda `reserwaya-back-prod-api`. Esto representaba dos riesgos:

1. Pérdida irrecuperable de datos ante un error humano, bug, o incidente de seguridad
2. Ningún aviso automático si la API empezaba a fallar en producción

## Decisión 1: Backup en Node.js puro, sin Lambda Layer ni contenedor

Se descartó usar la herramienta externa `mongodump` (que requeriría empaquetarla como Lambda Layer o como imagen de contenedor Docker), a favor de una función escrita en TypeScript puro que:
- Se conecta a MongoDB con el driver oficial (`mongodb`), reutilizando la conexión ya existente en el proyecto (`connectMongo`)
- Serializa cada colección a formato BSON con el paquete `bson` (ya presente en las dependencias del proyecto)
- Comprime el resultado con `zlib` (módulo nativo de Node, sin dependencias externas)

### Alternativas consideradas
| Opción | Por qué se descartó |
|---|---|
| Lambda Layer con binario de `mongodump` | Complejidad de empaquetado, límites de tamaño de Layers, mantenimiento de compatibilidad de versión con Mongo |
| Lambda por contenedor Docker | Más complejo de depurar y desplegar que código TypeScript plano; innecesario dado que la lógica cabe en Node puro |

### Consecuencias
- (+) Sin dependencias binarias externas; todo el código es TypeScript testeable con Vitest
- (+) Reutiliza la infraestructura de conexión a Mongo ya existente en el proyecto
- (-) El formato de backup es propio (no es un dump estándar de `mongodump`); la restauración requiere el código de este proyecto (`restore-backup.ts`), no herramientas genéricas de MongoDB

## Decisión 2: Cloudflare R2 en vez de Amazon S3

Los backups se almacenan en Cloudflare R2 en vez de un bucket de S3 en la misma cuenta de AWS.

### Alternativas consideradas
| Opción | Por qué se descartó |
|---|---|
| Amazon S3 (misma cuenta) | Si la cuenta de AWS tuviera un incidente (la cuenta es compartida con otros proyectos ajenos a ReservaYa), los backups se perderían junto con todo lo demás |

### Consecuencias
- (+) Backup en un proveedor independiente de AWS — resiliente ante incidentes específicos de la cuenta de AWS
- (+) R2 no cobra por egreso de datos (a diferencia de S3), relevante si se necesita descargar backups seguido para pruebas de restauración
- (+) Dentro del plan gratuito para el volumen actual (10 GB, uso real ~150 MB con retención de 30 días)
- (-) Requiere gestionar credenciales de un proveedor adicional (mitigado moviéndolas a Secrets Manager, en progreso)

## Decisión 3: Retención automática de 30 días

Los backups con más de 30 días se eliminan automáticamente en cada ejecución del job, identificando la fecha directamente desde el nombre del archivo (`backup-YYYY-MM-DD.bin`).

### Consecuencias
- (+) Evita crecimiento indefinido de almacenamiento
- (-) Un archivo que no siga el patrón de nombre esperado se conserva indefinidamente (comportamiento seguro por diseño, para nunca borrar algo no reconocido)

## Decisión 4: Monitoreo con alarmas de CloudWatch + SNS + Dashboard

Se implementaron 3 alarmas (Errors, Duration, Throttles) sobre la Lambda `api`, notificando por correo vía un tema de SNS, más un dashboard visual consolidado.

### Consecuencias
- (+) Detección proactiva de problemas en producción, sin depender de que un usuario reporte una falla
- (-) Pendiente: alarmas equivalentes para la Lambda `export-backup-r2` una vez desplegada; alarma de colas SQS cuando se conecte la integración con WhatsApp IA

## Relacionado
- `docs/RUNBOOK-INFRA.md` — procedimientos operativos derivados de estas decisiones
- `src/infrastructure/backup/` — implementación
- `test/unit/apply-retention.test.ts`, `test/integration/create-backup.test.ts`, `test/unit/restore-backup.test.ts` — cobertura de tests