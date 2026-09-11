import { ConflictError } from '../../../../shared/errors';
import { bsonInt } from '../bson';

export interface Doc {
  [key: string]: unknown;
}

export interface MongoFilter {
  [key: string]: unknown;
}

export function occQuery(filter: MongoFilter, version: number): MongoFilter {
  return { ...filter, version };
}

export function auditSet(actor: string, extra: MongoFilter = {}): MongoFilter {
  return { ...extra, updated_by: actor, updated_at: new Date() };
}

export function auditCreate(doc: MongoFilter, actor: string): MongoFilter {
  return {
    ...doc,
    version: bsonInt(1),
    created_by: actor,
    updated_by: actor,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

export async function occUpdate(
  coll: import('mongodb').Collection,
  filter: MongoFilter,
  version: number,
  set: MongoFilter,
  actor: string,
  session?: import('mongodb').ClientSession,
): Promise<Doc | null> {
  const res = await coll.findOneAndUpdate(
    occQuery(filter, version),
    { $set: auditSet(actor, set), $inc: { version: 1 } },
    { returnDocument: 'after', includeResultMetadata: false, session },
  );
  return res as Doc | null;
}

export function assertUpdated(id: string, updated: unknown): void {
  if (!updated) {
    throw new ConflictError(
      'OCC_CONFLICT',
      `document ${id} was modified concurrently (stale version)`,
      { id },
    );
  }
}

export function coll(db: import('mongodb').Db, name: string): import('mongodb').Collection {
  return db.collection(name);
}

const COLLECTIONS = [
  'plans',
  'tenants',
  'services',
  'professionals',
  'appointments',
  'availability_blocks',
  'time_slots',
  'payment_transactions',
  'ledger',
  'whatsapp_conversations',
  'notifications',
  'audit_logs',
  'platform_users',
  'tenant_users',
  'payout_accounts',
  'payouts',
] as const;

export async function ensureExtraIndexes(db: import('mongodb').Db): Promise<void> {
  const tenants = db.collection('tenants');
  await tenants.createIndex(
    { slug: 1 },
    { unique: true, partialFilterExpression: { deleted_at: null }, name: 'uq_tenants_slug_active' },
  );
  const plans = db.collection('plans');
  await plans.createIndex({ code: 1 }, { unique: true, name: 'uq_plans_code' });
}

export { COLLECTIONS };