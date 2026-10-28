import { NotFoundError, ValidationError } from '../../../shared/errors';
import { normalizePhoneE164 } from '../../../shared/phone';
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
    documentId?: string;
  }): Promise<Appointment[]> {
    if (!input.clientId && !input.phone && !input.email && !input.documentId) {
      throw new ValidationError('provide clientId, phone or email to query history');
    }
    if (input.tenantId) {
      await this.repos.tenants.findById(input.tenantId);
    }
    const phone = input.phone ? (normalizePhoneE164(input.phone) ?? input.phone) : undefined;
    const appointments = await this.repos.appointments.findHistoryByClient({
      tenantId: input.tenantId ?? '',
      clientId: input.clientId,
      phone,
      email: input.email,
      documentId: input.documentId,
    });
    return appointments.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  }

  async clientAppointments(input: { tenantId?: string; clientId: string }): Promise<Appointment[]> {
    return this.historyByClient({ tenantId: input.tenantId, clientId: input.clientId });
  }
}