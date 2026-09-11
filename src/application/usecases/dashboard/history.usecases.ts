import { NotFoundError, ValidationError } from '../../../shared/errors';
import { Appointment } from '../../../domain/entities';
import { AppointmentRepository } from '../../../domain/ports/repositories';
import { TenantRepository } from '../../../domain/ports/repositories';

export class HistoryUseCases {
  constructor(
    private readonly repos: {
      tenants: TenantRepository;
      appointments: AppointmentRepository;
    },
  ) {}

  async historyByClient(input: {
    tenantId?: string;
    clientId?: string;
    phone?: string;
    email?: string;
  }): Promise<Appointment[]> {
    if (!input.clientId && !input.phone && !input.email) {
      throw new ValidationError('provide clientId, phone or email to query history');
    }
    if (input.tenantId) {
      await this.repos.tenants.findById(input.tenantId);
    }
    const appointments = await this.repos.appointments.findHistoryByClient({
      tenantId: input.tenantId ?? '',
      clientId: input.clientId,
      phone: input.phone,
      email: input.email,
    });
    return appointments.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }

  async clientAppointments(input: { tenantId?: string; clientId: string }): Promise<Appointment[]> {
    return this.historyByClient({ tenantId: input.tenantId, clientId: input.clientId });
  }
}