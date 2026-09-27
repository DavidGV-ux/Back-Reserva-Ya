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

**Variables de entorno actuales (en `.env` local / variables de Lambda):**
- `MONGODB_URI`, `OIDC_*` (Keycloak)
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `BACKUP_RETENTION_DAYS`

## 5. Debugging

> PENDIENTE: agregar guía de troubleshooting común (ver logs en CloudWatch, errores típicos de conexión a Mongo, etc.)

**Problema común en desarrollo local:** `MongoServerError: Transaction numbers are only allowed on a replica set member or mongos`
→ Causa: el contenedor de Mongo perdió su configuración de replica set (suele pasar si Docker se reinicia).
→ Solución: `docker exec -it reserwaya-mongo mongosh --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]})"`