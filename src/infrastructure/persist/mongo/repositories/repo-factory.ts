import { ClientSession, Db } from 'mongodb';
import { AppDependencies } from '../../../../application/container';
import { TransactionRepositories } from '../../../../domain/ports/unit-of-work';
import { PlanMongoRepository, TenantMongoRepository } from './plans-tenants.repo';
import { ProfessionalMongoRepository, ServiceMongoRepository } from './catalog.repo';
import { AppointmentMongoRepository } from './appointments.repo';
import { AvailabilityBlockMongoRepository, TimeSlotMongoRepository } from './availability.repo';
import { LedgerMongoRepository, NotificationMongoRepository, PaymentTransactionMongoRepository } from './payments.repo';
import { AuditLogMongoRepository, PlatformUserMongoRepository, TenantUserMongoRepository } from './users.repo';

export function createRepos(db: Db, session?: ClientSession): AppDependencies['repos'] {
  return {
    plans: new PlanMongoRepository(db, session),
    tenants: new TenantMongoRepository(db, session),
    services: new ServiceMongoRepository(db, session),
    professionals: new ProfessionalMongoRepository(db, session),
    appointments: new AppointmentMongoRepository(db, session),
    availabilityBlocks: new AvailabilityBlockMongoRepository(db, session),
    timeSlots: new TimeSlotMongoRepository(db, session),
    paymentTransactions: new PaymentTransactionMongoRepository(db, session),
    ledger: new LedgerMongoRepository(db, session),
    notifications: new NotificationMongoRepository(db, session),
    tenantUsers: new TenantUserMongoRepository(db, session),
    platformUsers: new PlatformUserMongoRepository(db, session),
    audit: new AuditLogMongoRepository(db, session),
  };
}

export function createTransactionRepos(db: Db, session: ClientSession): TransactionRepositories {
  return {
    appointments: new AppointmentMongoRepository(db, session),
    timeSlots: new TimeSlotMongoRepository(db, session),
    availabilityBlocks: new AvailabilityBlockMongoRepository(db, session),
    paymentTransactions: new PaymentTransactionMongoRepository(db, session),
    ledger: new LedgerMongoRepository(db, session),
    notifications: new NotificationMongoRepository(db, session),
  };
}