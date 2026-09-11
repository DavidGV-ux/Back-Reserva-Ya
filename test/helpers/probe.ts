import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { createRepos } from '../../src/infrastructure/persist/mongo/repositories/repo-factory';
import { OnboardingUseCases } from '../../src/application/usecases/onboarding/onboarding.usecases';
import { NoopIdentityGateway } from '../helpers/mongo';

async function main() {
  const uri = process.env.MONGODB_URI!;
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const repos = createRepos(db);
  const onboarding = new OnboardingUseCases({
    tenants: repos.tenants,
    plans: repos.plans,
    services: repos.services,
    professionals: repos.professionals,
    tenantUsers: repos.tenantUsers,
    identity: new NoopIdentityGateway(),
  });
  try {
    const result = await onboarding.onboardTenant({
      actor: { keycloakUserId: 'probe-user' },
      slug: 'cafe-lambda-repro-002',
      name: 'Café Beta',
      tagline: 'Café de especialidad',
      currency: 'COP',
      country: 'CO',
      phone: '+57 300 111 2233',
      address: 'Cra 11 #85-40',
      settings: { advancePaymentPercentage: 15, cancellationToleranceHours: 12 },
    });
    console.log('ONBOARD_OK', result.tenant.tenantId, result.ownerRoleGranted);
  } catch (err: any) {
    console.log('FAIL', err?.constructor?.name, err?.code, err?.message);
    const seen = new Set<unknown>();
    function walk(n: unknown, d = 1) {
      if (d > 6 || n == null || typeof n !== 'object' || typeof n !== 'object') return;
      if (seen.has(n)) return;
      seen.add(n);
      if (d > 1 && typeof (n as any).operatorName === 'string') {
        console.log(' '.repeat(d) + (n as any).operatorName + ' :: ' + JSON.stringify((n as any).propertyName ?? (n as any).reason ?? ''));
      }
      for (const k of ['details', 'schemaRulesNotSatisfied', 'properties', 'missing']) {
        const v = (n as any)[k];
        if (Array.isArray(v)) v.forEach((x: unknown) => walk(x, d + 1));
      }
    }
    walk(err?.errInfo?.details, 1);
  }
  await client.close();
}

main().catch((e) => console.error(e));