import { NotFoundError, ValidationError } from '../../../shared/errors';
import { Appointment, AvailabilityBlock, LedgerEntry, Tenant, TenantRole } from '../../../domain/entities';
import {
  AppointmentRepository,
  AvailabilityBlockRepository,
  LedgerRepository,
  TenantRepository,
  TenantUserRepository,
} from '../../../domain/ports/repositories';
import { addDaysUtc, todayUtcParts, utcLocalStartMs } from '../../../shared/timezone';

export interface OwnerOverview {
  tenant: Tenant;
  revenue: number;
  totalAppointments: number;
  confirmedToday: number;
  occupancy: number;
  commission: number;
  commissionRate: number;
  upcoming: Appointment[];
  movements: LedgerEntry[];
  owner: { keycloakUserId: string; role: TenantRole };
}

export interface ProfessionalAgenda {
  professionalId: string;
  appointments: Appointment[];
  blocks: AvailabilityBlock[];
}

export class DashboardUseCases {
  constructor(
    private readonly repos: {
      tenants: TenantRepository;
      appointments: AppointmentRepository;
      ledger: LedgerRepository;
      tenantUsers: TenantUserRepository;
      availabilityBlocks: AvailabilityBlockRepository;
    },
  ) {}

  async ownerOverview(tenantId: string, requestorKeycloakId: string): Promise<OwnerOverview> {
    const tenant = await this.repos.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant', tenantId);

    const now = new Date();
    const today = todayUtcParts(tenant.timezone);
    const todayMs = utcLocalStartMs(tenant.timezone, today.year, today.month, today.day);
    const todayEndMs = todayMs + 86_400_000;
    const windowEnd = addDaysUtc(tenant.timezone, today, 30).ms;

    const [upcoming, todayAppointments, allCount, movements] = await Promise.all([
      this.repos.appointments.findUpcomingByTenant(tenantId, now.toISOString(), new Date(windowEnd).toISOString()),
      this.repos.appointments.findUpcomingByTenant(
        tenantId,
        new Date(todayMs).toISOString(),
        new Date(todayEndMs).toISOString(),
      ),
      this.repos.appointments.countByTenant(tenantId, new Date(now.getTime() - 90 * 86_400_000).toISOString()),
      this.repos.ledger.findByTenant(tenantId, 50),
    ]);

    const ownerUser = (await this.repos.tenantUsers.findByKeycloakAndTenant(tenantId, requestorKeycloakId)).find(
      (u) => u.role === 'owner',
    );
    const owner = ownerUser ?? { keycloakUserId: requestorKeycloakId, role: 'owner' as TenantRole };

    const revenue = movements.filter((m) => m.account === 'tenant_balance' && m.direction === 'credit')
      .reduce((s, m) => s + m.amount, 0);
    const commission = movements.filter((m) => m.account === 'platform_revenue' && m.direction === 'credit')
      .reduce((s, m) => s + m.amount, 0);

    const confirmedToday = todayAppointments.filter((a) => a.status === 'confirmed').length;
    const busyMinutes = todayAppointments.reduce((s, a) => s + a.serviceSnapshot.durationMinutes, 0);
    const occupancy = Math.min(100, Math.round((busyMinutes / (3 * 8 * 60)) * 100));

    return {
      tenant,
      revenue: Math.round(revenue * 100) / 100,
      totalAppointments: allCount,
      confirmedToday,
      occupancy,
      commission: Math.round(commission * 100) / 100,
      commissionRate: tenant.planId === 'plan_basico' ? 0.05 : 0.03,
      upcoming: upcoming
        .filter((a) => a.status === 'confirmed')
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .slice(0, 20),
      movements,
      owner,
    };
  }

  async professionalAgenda(input: {
    tenantId: string;
    professionalId: string;
    from: string;
    to: string;
  }): Promise<ProfessionalAgenda> {
    const { tenantId, professionalId, from, to } = input;
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) {
      throw new ValidationError('from/to must be ISO dates');
    }
    const [appointments, blocks] = await Promise.all([
      this.repos.appointments.findByProfessional(tenantId, professionalId, from, to),
      this.repos.availabilityBlocks.findActiveByProfessional(tenantId, professionalId, from, to),
    ]);
    return {
      professionalId,
      appointments: appointments.sort((a, b) => a.startTime.localeCompare(b.startTime)),
      blocks: blocks.sort((a, b) => a.startTime.localeCompare(b.startTime)),
    };
  }
}