import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { Professional, Service, WeeklySchedule } from '../../../domain/entities/catalog';
import { AuditLogRepository, ProfessionalRepository, ServiceRepository } from '../../../domain/ports/repositories';
import { hexId, uuid } from '../../../shared/id';

export class CatalogUseCases {
  constructor(
    private readonly repos: {
      services: ServiceRepository;
      professionals: ProfessionalRepository;
      audit: AuditLogRepository;
    },
  ) {}

  async listServices(tenantId: string, includeInactive = false): Promise<Service[]> {
    return this.repos.services.findByTenant(tenantId, includeInactive);
  }

  async createService(input: {
    tenantId: string;
    actor: string;
    service: {
      name: string;
      description?: string;
      price: number;
      durationMinutes: number;
      currency: string;
    };
  }): Promise<Service> {
    const { price, durationMinutes } = input.service;
    if (!input.service.name.trim()) throw new ValidationError('service name is required');
    if (!Number.isFinite(price) || price < 0) throw new ValidationError('price must be >= 0');
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
      throw new ValidationError('durationMinutes must be a positive integer');
    }
    const service: Service = {
      id: hexId(),
      tenantId: input.tenantId,
      name: input.service.name,
      description: input.service.description,
      price,
      currency: input.service.currency as Service['currency'],
      durationMinutes,
      active: true,
      version: 1,
    };
    const created = await this.repos.services.create(service, input.actor);
    await this.repos.audit.record({
      eventId: uuid(),
      tenantId: input.tenantId,
      collection: 'services',
      documentId: service.id,
      operation: 'insert',
      actor: input.actor,
      after: service,
    });
    return created;
  }

  async updateService(input: {
    tenantId: string;
    id: string;
    actor: string;
    expectedVersion: number;
    patch: Partial<Pick<Service, 'name' | 'description' | 'price' | 'durationMinutes' | 'active'>>;
  }): Promise<Service> {
    const current = await this.repos.services.findById(input.tenantId, input.id);
    if (!current) throw new NotFoundError('Service', input.id);
    const updated: Service = { ...current, ...input.patch };
    const saved = await this.repos.services.update(updated, input.expectedVersion, input.actor);
    await this.repos.audit.record({
      eventId: uuid(),
      tenantId: input.tenantId,
      collection: 'services',
      documentId: input.id,
      operation: 'update',
      actor: input.actor,
      before: current,
      after: saved,
    });
    return saved;
  }

  async toggleService(input: {
    tenantId: string;
    id: string;
    actor: string;
    expectedVersion: number;
    active: boolean;
  }): Promise<Service> {
    return this.updateService({
      tenantId: input.tenantId,
      id: input.id,
      actor: input.actor,
      expectedVersion: input.expectedVersion,
      patch: { active: input.active },
    });
  }

  async deleteService(input: {
    tenantId: string;
    id: string;
    actor: string;
    expectedVersion: number;
  }): Promise<void> {
    await this.repos.services.softDelete(input.tenantId, input.id, input.expectedVersion, input.actor);
  }

  async listProfessionals(tenantId: string, serviceId?: string): Promise<Professional[]> {
    const all = await this.repos.professionals.findByTenant(tenantId, false);
    if (!serviceId) return all;
    return all.filter((p) => p.serviceIds.includes(serviceId));
  }

  async findProfessionalByKeycloakUserId(
    tenantId: string,
    keycloakUserId: string,
  ): Promise<Professional | null> {
    return this.repos.professionals.findByKeycloakUserId(tenantId, keycloakUserId);
  }

  async createProfessional(input: {
    tenantId: string;
    actor: string;
    professional: {
      name: string;
      title?: string;
      avatarUrl?: string;
      serviceIds: string[];
      schedule?: WeeklySchedule;
      keycloakUserId?: string;
    };
  }): Promise<Professional> {
    const serviceIds = input.professional.serviceIds;
    if (!input.professional.name.trim()) throw new ValidationError('professional name is required');
    if (!serviceIds?.length) throw new ValidationError('serviceIds must not be empty');
    for (const sid of new Set(serviceIds)) {
      const svc = await this.repos.services.findById(input.tenantId, sid);
      if (!svc) throw new NotFoundError('Service', sid);
    }
    if (input.professional.keycloakUserId) {
      const existing = await this.repos.professionals.findByKeycloakUserId(
        input.tenantId,
        input.professional.keycloakUserId,
      );
      if (existing) {
        throw new ConflictError('KEYCLOAK_USER_LINKED', 'keycloak_user_id already linked to a professional in this tenant');
      }
    }
    const professional: Professional = {
      id: hexId(),
      tenantId: input.tenantId,
      name: input.professional.name,
      title: input.professional.title,
      avatarUrl: input.professional.avatarUrl,
      serviceIds,
      schedule: input.professional.schedule ?? emptyWeeklySchedule(),
      active: true,
      keycloakUserId: input.professional.keycloakUserId,
      version: 1,
    };
    const created = await this.repos.professionals.create(professional, input.actor);
    await this.repos.audit.record({
      eventId: uuid(),
      tenantId: input.tenantId,
      collection: 'professionals',
      documentId: professional.id,
      operation: 'insert',
      actor: input.actor,
      after: professional,
    });
    return created;
  }

  async updateProfessional(input: {
    tenantId: string;
    id: string;
    actor: string;
    expectedVersion: number;
    patch: Partial<Pick<Professional, 'name' | 'title' | 'avatarUrl' | 'serviceIds' | 'schedule' | 'active' | 'keycloakUserId'>>;
  }): Promise<Professional> {
    const current = await this.repos.professionals.findById(input.tenantId, input.id);
    if (!current) throw new NotFoundError('Professional', input.id);
    const updated: Professional = { ...current, ...input.patch };
    const saved = await this.repos.professionals.update(updated, input.expectedVersion, input.actor);
    await this.repos.audit.record({
      eventId: uuid(),
      tenantId: input.tenantId,
      collection: 'professionals',
      documentId: input.id,
      operation: 'update',
      actor: input.actor,
      before: current,
      after: saved,
    });
    return saved;
  }

  async deleteProfessional(input: {
    tenantId: string;
    id: string;
    actor: string;
    expectedVersion: number;
  }): Promise<void> {
    await this.repos.professionals.softDelete(input.tenantId, input.id, input.expectedVersion, input.actor);
  }
}

export function emptyWeeklySchedule(): WeeklySchedule {
  return {
    monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
  };
}