import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { Db, Decimal128, MongoClient } from 'mongodb';
import { createRepos } from '../../src/infrastructure/persist/mongo/repositories/repo-factory';
import { MongoUnitOfWork } from '../../src/infrastructure/persist/mongo/unit-of-work';
import { ensureExtraIndexes } from '../../src/infrastructure/persist/mongo/repositories/base';
import { AppServices } from '../../src/application/container';
import { MockPaymentGateway } from '../../src/infrastructure/integrations/payments/mock-payment';
import { MockNotificationGateway } from '../../src/infrastructure/integrations/notifications/mock-notifications';
import { IdentityGateway, IdentityUser, PaymentGatewayProvider, NotificationGateway } from '../../src/domain/ports/gateways';

export class NoopIdentityGateway implements IdentityGateway {
  readonly provider = 'noop';
  private nextSub = 'kc-test-0000';
  async ensureRealmRole(): Promise<void> {}
  async createUser(input: {
    username: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    temporaryPassword: string;
    persistentPassword?: boolean;
  }): Promise<{ sub: string }> {
    const sub = `${this.nextSub}`;
    this.nextSub = `kc-test-${Number(this.nextSub.split('-').pop()) + 1}`.padStart(9, '0');
    return { sub };
  }
  async findByEmail(): Promise<IdentityUser | null> {
    return null;
  }
  async findBySub(): Promise<IdentityUser | null> {
    return null;
  }
}

export interface TestDb {
  client: MongoClient;
  db: Db;
  repos: ReturnType<typeof createRepos>;
  services: AppServices;
  stop: () => Promise<void>;
}

export interface TestDbOptions {
  paymentGateway?: PaymentGatewayProvider;
  notificationGateway?: NotificationGateway;
}

const cache = new Map<string, TestDb>();

export async function testDb(options?: TestDbOptions): Promise<TestDb> {
  const key = `${options?.paymentGateway?.name ?? 'mock'}-${options?.notificationGateway?.channel ?? 'whatsapp'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const uri = process.env.MONGODB_URI_TEST ?? 'mongodb://localhost:27017/reservaya_test';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  await db.dropDatabase();
  await applySchema(db);
  await ensureExtraIndexes(db);

  const repos = createRepos(db);
  const uow = new MongoUnitOfWork(client, db);
  const services = new AppServices({
    repos,
    uow,
    paymentGateway: options?.paymentGateway ?? new MockPaymentGateway(),
    notificationGateway: options?.notificationGateway ?? new MockNotificationGateway(),
    identity: new NoopIdentityGateway(),
  });

  const ctx: TestDb = {
    client,
    db,
    repos,
    services,
    stop: async () => {
      await client.close();
      cache.delete(key);
    },
  };
  cache.set(key, ctx);
  return ctx;
}

export async function applySchema(db: Db): Promise<void> {
  let script = readFileSync(
    resolve(process.cwd(), 'scripts/schema/setup-reservaya-atlas.js'),
    'utf8',
  );
  script = script.replace(/^use\s*\(\s*["'][^"']+["']\s*\);\s*$/gm, '');

  const pending: Promise<unknown>[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (op: () => Promise<unknown>) => {
    const p = chain.then(op);
    pending.push(p);
    chain = p.catch(() => undefined);
    return p;
  };

  const commands: Record<string, unknown> = {};
  const makeCollectionTarget = (name: string) =>
    new Proxy<{}>(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'createIndex') {
            return (key: Record<string, number>, options?: Record<string, unknown>) =>
              enqueue(() => db.collection(name).createIndex(key, options));
          }
          return undefined;
        },
      },
    );

  const dbProxy = new Proxy<{}>(
    {
      createCollection: (name: string, options?: Record<string, unknown>) =>
        enqueue(() => db.createCollection(name, options)).then(() => makeCollectionTarget(name)),
      runCommand: (cmd: Record<string, unknown>) => enqueue(() => db.command(cmd)),
      collection: (name: string) =>
        (commands[name] ??= makeCollectionTarget(name)),
    },
    {
      get: (target, prop) => {
        if (typeof prop === 'symbol') return undefined;
        const value = (target as Record<string, unknown>)[prop];
        if (value !== undefined) return typeof value === 'function' ? value.bind(target) : value;
        return (commands[prop] ??= makeCollectionTarget(prop));
      },
      has: () => true,
    },
  );

  const context = vm.createContext({
    db: dbProxy,
    Decimal128: (value: string) => new Decimal128(value),
    print: (msg: string) => console.log(msg),
    console,
  });

  vm.runInContext(script, context, { filename: 'setup-reservaya-atlas.js' });
  await Promise.all(pending);
}