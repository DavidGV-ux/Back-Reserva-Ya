import {
  AppointmentRepository,
  AuditLogRepository,
  AvailabilityBlockRepository,
  LedgerRepository,
  NotificationRepository,
  PaymentTransactionRepository,
  PlanRepository,
  PlatformUserRepository,
  ProfessionalRepository,
  ServiceRepository,
  TenantRepository,
  TenantUserRepository,
  TimeSlotRepository,
  UserProfileRepository,
} from '../domain/ports/repositories';
import { NotificationGateway, PaymentGatewayProvider, IdentityGateway } from '../domain/ports/gateways';
import { UnitOfWork } from '../domain/ports/unit-of-work';
import { TenantsUseCases } from './usecases/tenants/tenants.usecases';
import { OnboardingUseCases } from './usecases/onboarding/onboarding.usecases';
import { CatalogUseCases } from './usecases/catalog/catalog.usecases';
import { AvailabilityUseCases } from './usecases/booking/availability.usecases';
import { BookingUseCases } from './usecases/booking/booking.usecases';
import { PaymentsUseCases } from './usecases/payments/payments.usecases';
import { PaymentSessionUseCases } from './usecases/payments/payment-session.usecases';
import { HistoryUseCases } from './usecases/dashboard/history.usecases';
import { DashboardUseCases } from './usecases/dashboard/dashboard.usecases';
import { NotificationsUseCases } from './usecases/notifications/notifications.usecases';
import { WhatsappUseCases } from './usecases/whatsapp/whatsapp.usecases';
import { ProfileUseCases } from './usecases/profile/profile.usecases';

export interface AppDependencies {
  repos: {
    plans: PlanRepository;
    tenants: TenantRepository;
    services: ServiceRepository;
    professionals: ProfessionalRepository;
    appointments: AppointmentRepository;
    availabilityBlocks: AvailabilityBlockRepository;
    timeSlots: TimeSlotRepository;
    paymentTransactions: PaymentTransactionRepository;
    ledger: LedgerRepository;
    notifications: NotificationRepository;
    tenantUsers: TenantUserRepository;
    platformUsers: PlatformUserRepository;
    userProfiles: UserProfileRepository;
    audit: AuditLogRepository;
  };
  uow: UnitOfWork;
  paymentGateway: PaymentGatewayProvider;
  notificationGateway: NotificationGateway;
  identity: IdentityGateway;
  settings: {
    frontBaseUrl: string;
    paymentSessionSecret: string;
  };
}

export class AppServices {
  readonly tenants: TenantsUseCases;
  readonly onboarding: OnboardingUseCases;
  readonly catalog: CatalogUseCases;
  readonly availability: AvailabilityUseCases;
  readonly booking: BookingUseCases;
  readonly payments: PaymentsUseCases;
  readonly paymentSessions: PaymentSessionUseCases;
  readonly history: HistoryUseCases;
  readonly dashboard: DashboardUseCases;
  readonly notifications: NotificationsUseCases;
  readonly whatsapp: WhatsappUseCases;
  readonly profile: ProfileUseCases;

  constructor(deps: AppDependencies) {
    this.tenants = new TenantsUseCases({
      tenants: deps.repos.tenants,
      plans: deps.repos.plans,
      tenantUsers: deps.repos.tenantUsers,
      platformUsers: deps.repos.platformUsers,
      audit: deps.repos.audit,
    });
    this.onboarding = new OnboardingUseCases({
      tenants: deps.repos.tenants,
      plans: deps.repos.plans,
      services: deps.repos.services,
      professionals: deps.repos.professionals,
      tenantUsers: deps.repos.tenantUsers,
      identity: deps.identity,
    });
    this.catalog = new CatalogUseCases({
      services: deps.repos.services,
      professionals: deps.repos.professionals,
      audit: deps.repos.audit,
    });
    this.availability = new AvailabilityUseCases({
      professionals: deps.repos.professionals,
      appointments: deps.repos.appointments,
      availabilityBlocks: deps.repos.availabilityBlocks,
    });
    this.booking = new BookingUseCases(
      {
        tenants: deps.repos.tenants,
        plans: deps.repos.plans,
        services: deps.repos.services,
        professionals: deps.repos.professionals,
        appointments: deps.repos.appointments,
        timeSlots: deps.repos.timeSlots,
        availabilityBlocks: deps.repos.availabilityBlocks,
        paymentTransactions: deps.repos.paymentTransactions,
      },
      deps.uow,
      deps.paymentGateway,
    );
    this.payments = new PaymentsUseCases(deps.uow, deps.paymentGateway, {
      appointments: deps.repos.appointments,
      tenants: deps.repos.tenants,
      paymentTransactions: deps.repos.paymentTransactions,
      availabilityBlocks: deps.repos.availabilityBlocks,
      timeSlots: deps.repos.timeSlots,
    });
    this.paymentSessions = new PaymentSessionUseCases(
      {
        tenants: deps.repos.tenants,
        appointments: deps.repos.appointments,
        paymentTransactions: deps.repos.paymentTransactions,
      },
      deps.uow,
      deps.paymentGateway,
      { frontBaseUrl: deps.settings.frontBaseUrl, sessionSecret: deps.settings.paymentSessionSecret },
    );
    this.history = new HistoryUseCases({
      tenants: deps.repos.tenants,
      appointments: deps.repos.appointments,
    });
    this.dashboard = new DashboardUseCases({
      tenants: deps.repos.tenants,
      appointments: deps.repos.appointments,
      ledger: deps.repos.ledger,
      tenantUsers: deps.repos.tenantUsers,
      availabilityBlocks: deps.repos.availabilityBlocks,
    });
    this.notifications = new NotificationsUseCases(deps.repos.notifications, deps.notificationGateway);
    this.whatsapp = new WhatsappUseCases({
      tenants: deps.repos.tenants,
      professionals: deps.repos.professionals,
      appointments: deps.repos.appointments,
      profiles: deps.repos.userProfiles,
    });
    this.profile = new ProfileUseCases({ userProfiles: deps.repos.userProfiles });
  }
}