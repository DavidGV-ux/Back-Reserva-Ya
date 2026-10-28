# Runbook de Operaciones — ReservaYa Back

> Mantenido por: Ginna Plazas (I4 — Infraestructura/DevOps)
> Última actualización: 2026-09-24

## 1. Despliegue

**Herramienta:** Serverless Framework (`serverless.yml` en la raíz del repo).

**Funciones actuales:**
- `api` — la API principal (Express + Lambda)
- `export-backup-r2` — job de backup diario (agregado 2026-09-24)

**Proceso de despliegue:**
> PENDIENTE: confirmar con David el proceso exacto (quién despliega, cuándo, con qué comando).

## 2. Rollback

Serverless Framework guarda un historial de despliegues vía CloudFormation.

1. Ver despliegues anteriores: `serverless deploy list`
2. Volver a una versión anterior: `serverless rollback --timestamp <timestamp>`
3. Verificar que la API responde correctamente después del rollback

⚠️ El rollback revierte código y configuración, pero **no revierte datos**. Para recuperar datos perdidos, usar los backups (sección 3).

## 3. Backups y Restauración

**Qué se respalda:** todas las colecciones de MongoDB Atlas, cada día a las 2:00 AM (hora UTC), vía EventBridge → Lambda `export-backup-r2`.

**Cómo funciona:**
1. La Lambda se conecta a Mongo (`src/infrastructure/persist/mongo/connection.ts`)
2. Lee cada colección y la serializa a BSON (`src/infrastructure/backup/create-backup.ts`)
3. Comprime todo en un solo archivo binario
4. Sube el archivo a Cloudflare R2, bucket `reservaya-backups`, con nombre `backup-YYYY-MM-DD.bin`
5. Aplica retención: borra automáticamente backups de más de 30 días (`src/infrastructure/backup/apply-retention.ts`)

**Cómo restaurar manualmente (procedimiento probado el 2026-09-24):**
1. Descargar el backup deseado desde el bucket `reservaya-backups` en Cloudflare
2. Usar `parseBackupBuffer()` (`src/infrastructure/backup/restore-backup.ts`) para desempacar
3. Insertar los documentos restaurados en la base de destino

**Tests automáticos:** `test/integration/create-backup.test.ts`, `test/unit/restore-backup.test.ts`, `test/unit/apply-retention.test.ts`

## 4. Credenciales y Secretos

> PENDIENTE (Etapa 3 del plan): mover credenciales de `.env` a AWS Secrets Manager.

**Estado actual (actualizado 2026-09-27):**
- Secreto creado: `reserwaya-back-prod/r2-credentials` (contiene R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME)
- Pendiente: secretos de producción (MONGODB_URI, credenciales de Keycloak admin) — coordinando con David quién los crea
- El rol de ejecución de la Lambda (`reserwaya-back-prod-us-east-1-lambdaRole`) tiene una única política en línea (`reserwaya-back-prod-lambda`) que **solo otorga permisos de CloudWatch Logs** (`CreateLogGroup`, `CreateLogStream`, `PutLogEvents`)
- **El rol NO tiene permiso para leer Secrets Manager todavía.** Al conectar los secretos a la Lambda, hay que agregar explícitamente `secretsmanager:GetSecretValue` a este rol, con el `Resource` limitado a los ARNs de los secretos de ReservaYa (nunca `"*"`, por seguridad y porque la cuenta es compartida con otros proyectos)

**Variables de entorno actuales (en `.env` local / variables de Lambda):**
- `MONGODB_URI`, `OIDC_*` (Keycloak)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `BACKUP_RETENTION_DAYS`

**Pasos pendientes para esta etapa:**
1. ~~Crear los secretos en Secrets Manager~~ → R2 hecho; falta Mongo/Keycloak (coordinando con David)
2. Agregar permiso `secretsmanager:GetSecretValue` al rol de la Lambda, limitado a esos ARNs específicos
3. Actualizar `serverless.yml` para referenciar los secretos por ARN en vez de variables de entorno planas
4. Quitar los valores reales de `.env` (dejar solo referencias)

## 5. Debugging

> PENDIENTE: agregar guía de troubleshooting común (ver logs en CloudWatch, errores típicos de conexión a Mongo, etc.)

**Problema común en desarrollo local:** `MongoServerError: Transaction numbers are only allowed on a replica set member or mongos`
→ Causa: el contenedor de Mongo perdió su configuración de replica set (suele pasar si Docker se reinicia).
→ Solución: `docker exec -it reserwaya-mongo mongosh --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]})"`

## 6. Monitoreo

**Estado: parcialmente completo (2026-09-27)**

**Canal de alertas (SNS):**
- Topic: `arn:aws:sns:us-east-1:888503972797:reserwaya-back-prod-alerts`
- Suscriptores actuales: ginaplazasgutierrez@gmail.com
- Para agregar a alguien más: `aws sns subscribe --topic-arn <arn> --protocol email --notification-endpoint <correo> --region us-east-1` (usar correo personal, no institucional — los filtros de seguridad de algunos correos institucionales cancelan la suscripción automáticamente al escanear el link de confirmación)

**Alarmas activas (Lambda `reserwaya-back-prod-api`):**
| Alarma | Métrica | Condición | Qué significa |
|---|---|---|---|
| `reserwaya-back-prod-api-errors` | Errors | ≥1 en 5 min | La API está lanzando errores |
| `reserwaya-back-prod-api-duration` | Duration (avg) | >25000ms en 5 min | Se acerca al timeout de 30s configurado |
| `reserwaya-back-prod-api-throttles` | Throttles | ≥1 en 5 min | La Lambda está siendo limitada/saturada |

**Dashboard visual:**
- Nombre: `reserwaya-back-prod`
- Definición: `docs/cloudwatch-dashboard.json` (en este repo)
- Ver en consola: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards/dashboard/reserwaya-back-prod
- Para actualizarlo: editar el JSON y volver a correr `aws cloudwatch put-dashboard --dashboard-name "reserwaya-back-prod" --dashboard-body file://docs/cloudwatch-dashboard.json --region us-east-1`

**Qué hacer cuando llega una alerta:**
1. Revisar el correo de SNS — indica cuál alarma se disparó y el valor exacto de la métrica
2. Entrar al dashboard `reserwaya-back-prod` en CloudWatch para ver el contexto (¿fue un pico aislado o algo sostenido?)
3. Revisar los logs de la Lambda en CloudWatch Logs: grupo `/aws/lambda/reserwaya-back-prod-api`
4. Si es la alarma de **Errors**: buscar el stack trace en los logs alrededor de la hora del error
5. Si es la alarma de **Duration**: revisar si coincide con una consulta pesada a Mongo, o con Mongo Atlas lento/caído
6. Si es la alarma de **Throttles**: revisar si hubo un pico de tráfico inusual (posible necesidad de aumentar el límite de concurrencia)
7. Si el problema requiere revertir un despliegue reciente: ver sección 2 (Rollback)
8. Avisar en el chat del equipo, sin importar si ya se resolvió — para que quede registro

**Pendiente:**
- Alarma de mensajes SQS visibles (aplica cuando se conecte la integración con WhatsApp IA — no existe cola SQS activa todavía)
- Logs estructurados (formato JSON consistente) en el código del Back
- Replicar este mismo monitoreo para la Lambda `export-backup-r2` una vez desplegada