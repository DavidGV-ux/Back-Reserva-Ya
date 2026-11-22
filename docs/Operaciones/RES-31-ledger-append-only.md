# RES-31 · Rol append-only para `ledger` en MongoDB Atlas

**Estado: pendiente de aplicación en Atlas.** El usuario de la aplicación (`reservaya-app`) tiene hoy el rol `atlasAdmin` en `admin`, que permite modificar o borrar asientos. Atlas rechaza `db.createRole()` desde `mongosh` con `CMD_NOT_ALLOWED: createRole` y en este entorno no hay credenciales de Atlas API ni Atlas CLI. El rol debe crearlo un Owner del proyecto desde Atlas UI/API; este runbook deja la definición exacta y la prueba de aceptación.

## Rol a crear

- Base de datos: `reservaya`
- Nombre: `ryAppNoLedgerWrite`
- Roles heredados: ninguno
- Privilegios: `find`, `insert`, `update`, `delete`, `createIndex` en todas las colecciones **excepto** `ledger`; `find`, `insert`, `createIndex` en `ledger`; `listCollections` a nivel de base de datos.

```js
const dbName = 'reservaya';
const role = 'ryAppNoLedgerWrite';
const collections = db.getCollectionNames(); // 16 colecciones al 22/11/2026
const privileges = collections
  .filter((c) => c !== 'ledger')
  .map((c) => ({
    resource: { db: dbName, collection: c },
    actions: ['find', 'insert', 'update', 'delete', 'createIndex'],
  }));
privileges.push({ resource: { db: dbName, collection: 'ledger' }, actions: ['find', 'insert', 'createIndex'] });
privileges.push({ resource: { db: dbName, collection: '' }, actions: ['listCollections'] });
```

Si se agrega una colección, regenerar el rol con este mismo bloque. El código de la aplicación solo hace `insert` y `find` sobre `ledger` (`src/application/usecases/payments/payments.usecases.ts`).

## Verificación antes de tocar al usuario real

1. Crear en Atlas un usuario temporal `ry-role-probe` en `reservaya` con solo `ryAppNoLedgerWrite`. Guardar su contraseña fuera del repositorio.
2. Conectar con `mongosh` usando la URI del probe y ejecutar:

```js
const id = new ObjectId();
db.ledger.insertOne({ _id: id, type: 'probe' });                       // debe OK
db.ledger.updateOne({ _id: id }, { $set: { type: 'changed' } });        // debe Unauthorized
db.ledger.deleteOne({ _id: id });                                      // debe Unauthorized
db.ledger.find().limit(1).toArray();                                   // debe OK
db.appointments.find().limit(1).toArray();                             // debe OK
```

3. Solo si `update` y `delete` fallan con `Unauthorized`, quitar `atlasAdmin` a `reservaya-app` y asignarle `ryAppNoLedgerWrite` sobre `reservaya`.
4. Smoke posterior: CI de Back en verde y un webhook firmado de sandbox (RES-28) confirmando que el asiento se inserta y la cita se confirma.
5. Eliminar `ry-role-probe`.

**Rollback:** volver a asignar `atlasAdmin` a `reservaya-app` desde Atlas. No ejecutar este cambio sin el probe verificado: el usuario actual es el único que usa el deploy.
