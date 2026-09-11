import 'dotenv/config';
import { MongoClient } from 'mongodb';

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI!);
  await c.connect();
  const db = c.db();
  const t = await db.listCollections({ name: 'tenants' }).toArray();
  console.log(JSON.stringify(t[0]?.options?.validator ?? null, null, 2).slice(0, 3200));
  await c.close();
}
main().catch((e) => console.error(e));