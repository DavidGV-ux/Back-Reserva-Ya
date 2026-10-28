import { hexId } from '../../../shared/id';
import { Appointment, Notification, Tenant } from '../../../domain/entities';
import { NotificationChannel, NotificationType } from '../../../domain/entities/types';
import { NotificationGateway } from '../../../domain/ports/gateways';
import {
  AppointmentRepository,
  NotificationRepository,
  TenantRepository,
} from '../../../domain/ports/repositories';
import {
  buildCancellationTemplate,
  buildConfirmationReceiptTemplate,
  buildReminderTemplate,
} from '../../../infrastructure/integrations/notifications/templates';
import { buildFallbackEmailGateway } from '../../../infrastructure/integrations/notifications/factory';

export interface NotifyResult {
  notificationId: string;
  status: 'sent' | 'fallback_sent' | 'failed';
  channel: NotificationChannel;
  providerMessageId?: string;
  deduplicated: boolean;
  fallbackUsed: boolean;
  fallbackElapsedMs?: number;
}

export interface ReminderDispatchSummary {
  evaluatedTenants: number;
  scannedAppointments: number;
  sent: number;
  deduplicated: number;
  failed: number;
  dispatches: Array<{
    tenantId: string;
    appointmentId: string;
    reminderHours: number;
    deviationMinutes: number;
    status: NotifyResult['status'];
  }>;
}

export interface NotificationsUseCasesOptions {
  fallbackEmailGateway?: NotificationGateway;
  fallbackDelayMs?: number;
  tenants?: TenantRepository;
  appointments?: AppointmentRepository;
}

export class NotificationsUseCases {
  private readonly fallbackGateway: NotificationGateway;
  private readonly fallbackDelayMs: number;
  private readonly tenants?: TenantRepository;
  private readonly appointments?: AppointmentRepository;

  constructor(
    private readonly repo: NotificationRepository,
    private readonly gateway: NotificationGateway,
    options: NotificationsUseCasesOptions = {},
  ) {
    this.fallbackGateway = options.fallbackEmailGateway ?? buildFallbackEmailGateway();
    // RNF-17: Fallback a email en < 2 min (120_000 ms) ante fallo de WhatsApp
    this.fallbackDelayMs = Math.min(Math.max(0, options.fallbackDelayMs ?? 10), 119_000);
    this.tenants = options.tenants;
    this.appointments = options.appointments;
  }

  async notify(input: {
    tenantId: string;
    appointmentId: string;
    channel: NotificationChannel;
    type: NotificationType;
    to: string;
    fallbackEmail?: string;
    message: string;
    subject?: string;
    html?: string;
    templateName?: string;
    templateLanguage?: string;
    templateParams?: string[];
  }): Promise<NotifyResult> {
    // 1. Verificar idempotencia: 1 único envío por (tenantId, appointmentId, type, channel)
    if (this.repo.findByAppointmentTypeChannel) {
      const existing = await this.repo.findByAppointmentTypeChannel(
        input.tenantId,
        input.appointmentId,
        input.type,
        input.channel,
      );
      if (existing && (existing.status === 'sent' || existing.status === 'fallback_sent')) {
        return {
          notificationId: existing.id,
          status: existing.status,
          channel: existing.channel,
          providerMessageId: existing.providerMessageId,
          deduplicated: true,
          fallbackUsed: existing.status === 'fallback_sent',
        };
      }
    }

    const id = hexId();
    const created = await this.repo.create({
      id,
      tenantId: input.tenantId,
      appointmentId: input.appointmentId,
      channel: input.channel,
      type: input.type,
      status: 'pending',
      attempts: 0,
      archived: false,
    });

    const notificationId = created.id;
    if (created.status === 'sent' || created.status === 'fallback_sent') {
      return {
        notificationId,
        status: created.status,
        channel: created.channel,
        providerMessageId: created.providerMessageId,
        deduplicated: true,
        fallbackUsed: created.status === 'fallback_sent',
      };
    }

    const startTimeMs = Date.now();
    try {
      const activeGateway =
        input.channel === 'email' && this.gateway.channel !== 'email'
          ? this.fallbackGateway
          : this.gateway;

      const result = await activeGateway.send({
        notificationId,
        tenantId: input.tenantId,
        appointmentId: input.appointmentId,
        to: input.to,
        type: input.type,
        message: input.message,
        subject: input.subject,
        html: input.html,
        templateName: input.templateName,
        templateLanguage: input.templateLanguage,
        templateParams: input.templateParams,
      });
      await this.repo.markSent(notificationId, result.providerMessageId);
      return {
        notificationId,
        status: 'sent',
        channel: input.channel,
        providerMessageId: result.providerMessageId,
        deduplicated: false,
        fallbackUsed: false,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.repo.markFailed(notificationId, errorMsg);

      // B-01 / RNF-17: Fallback a email en < 2 min cuando el canal principal (whatsapp) falla
      if (input.channel === 'whatsapp') {
        const fallbackTo =
          input.fallbackEmail ??
          (input.to.includes('@')
            ? input.to
            : `cliente.${input.to.replace(/\D/g, '') || 'reservaya'}@reservaya.co`);

        if (this.fallbackDelayMs > 0) {
          await new Promise((r) => setTimeout(r, this.fallbackDelayMs));
        }

        try {
          const emailNotif = await this.repo.create({
            id: hexId(),
            tenantId: input.tenantId,
            appointmentId: input.appointmentId,
            channel: 'email',
            type: input.type,
            status: 'pending',
            attempts: 0,
            archived: false,
          });

          const fallbackResult = await this.fallbackGateway.send({
            notificationId: emailNotif.id,
            tenantId: input.tenantId,
            appointmentId: input.appointmentId,
            to: fallbackTo,
            type: input.type,
            message: input.message,
            subject: input.subject,
            html: input.html,
          });

          await this.repo.markSent(emailNotif.id, fallbackResult.providerMessageId);
          if (this.repo.markFallbackSent) {
            await this.repo.markFallbackSent(
              notificationId,
              fallbackResult.providerMessageId,
              errorMsg,
            );
          }

          return {
            notificationId,
            status: 'fallback_sent',
            channel: 'email',
            providerMessageId: fallbackResult.providerMessageId,
            deduplicated: false,
            fallbackUsed: true,
            fallbackElapsedMs: Date.now() - startTimeMs,
          };
        } catch (fallbackErr) {
          const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          await this.repo.markFailed(notificationId, `${errorMsg} | fallback error: ${fbMsg}`);
        }
      }

      return {
        notificationId,
        status: 'failed',
        channel: input.channel,
        deduplicated: false,
        fallbackUsed: false,
      };
    }
  }

  /**
   * B-02 / B-06: Emite notificación de negocio (confirmación, recordatorio o cancelación)
   * construyendo textos, HTML y plantillas Meta aprobadas en español.
   */
  async notifyAppointmentEvent(input: {
    appointment: Appointment;
    tenant?: Tenant;
    type: NotificationType;
    paidAmount?: number;
  }): Promise<NotifyResult> {
    const { appointment, tenant, type } = input;
    const preferredChannel: NotificationChannel =
      tenant?.settings.preferredNotificationChannel ?? 'whatsapp';

    const rendered =
      type === 'confirmation'
        ? buildConfirmationReceiptTemplate({
            appointment,
            tenant,
            paidAmount: input.paidAmount,
          })
        : type === 'reminder'
          ? buildReminderTemplate({ appointment, tenant })
          : buildCancellationTemplate({ appointment, tenant });

    const recipient =
      preferredChannel === 'email'
        ? appointment.clientInfo.email ?? appointment.clientInfo.phone ?? appointment.clientInfo.name
        : appointment.clientInfo.phone ?? appointment.clientInfo.email ?? appointment.clientInfo.name;

    return this.notify({
      tenantId: appointment.tenantId,
      appointmentId: appointment.id,
      channel: preferredChannel,
      type,
      to: recipient,
      fallbackEmail: appointment.clientInfo.email,
      message: rendered.text,
      subject: rendered.subject,
      html: rendered.html,
      templateName: rendered.metaTemplateName,
      templateLanguage: rendered.metaTemplateLanguage,
      templateParams: rendered.metaTemplateParams,
    });
  }

  /**
   * B-03 (RF-2.8 / RNF-10): Cron de recordatorios configurable por tenant (1 a 72 horas antes)
   * disparado con una desviación máxima de ±5 minutos.
   */
  async dispatchDueReminders(input?: {
    now?: string;
    toleranceMinutes?: number;
  }): Promise<ReminderDispatchSummary> {
    if (!this.tenants || !this.appointments) {
      return {
        evaluatedTenants: 0,
        scannedAppointments: 0,
        sent: 0,
        deduplicated: 0,
        failed: 0,
        dispatches: [],
      };
    }

    const nowMs = input?.now ? new Date(input.now).getTime() : Date.now();
    // RNF-10: Desviación máxima permitida de ±5 minutos
    const toleranceMin = Math.min(Math.max(1, input?.toleranceMinutes ?? 5), 5);
    const toleranceMs = toleranceMin * 60_000;

    const activeTenants = (await this.tenants.list()).filter(
      (t) => t.bookingStatus === 'active' && !t.deletedAt,
    );

    let scannedAppointments = 0;
    let sent = 0;
    let deduplicated = 0;
    let failed = 0;
    const dispatches: ReminderDispatchSummary['dispatches'] = [];

    for (const tenant of activeTenants) {
      // RF-2.8: Rango configurable de 1 a 72 horas por tenant
      const rawHours = tenant.settings.reminderHours ?? 24;
      const reminderHours = Math.min(Math.max(1, Math.round(rawHours)), 72);
      const targetStartMs = nowMs + reminderHours * 3_600_000;
      const windowFromIso = new Date(targetStartMs - toleranceMs).toISOString();
      const windowToIso = new Date(targetStartMs + toleranceMs).toISOString();

      const upcoming = await this.appointments.findUpcomingByTenant(
        tenant.tenantId,
        windowFromIso,
        windowToIso,
      );

      const confirmedInWindow = upcoming.filter((a) => a.status === 'confirmed');
      scannedAppointments += confirmedInWindow.length;

      for (const appt of confirmedInWindow) {
        const apptStartMs = new Date(appt.startTime).getTime();
        const idealTriggerMs = apptStartMs - reminderHours * 3_600_000;
        const deviationMinutes =
          Math.round((Math.abs(nowMs - idealTriggerMs) / 60_000) * 100) / 100;

        if (deviationMinutes > 5) {
          continue;
        }

        const res = await this.notifyAppointmentEvent({
          appointment: appt,
          tenant,
          type: 'reminder',
        });

        if (res.deduplicated) {
          deduplicated += 1;
        } else if (res.status === 'sent' || res.status === 'fallback_sent') {
          sent += 1;
        } else {
          failed += 1;
        }

        dispatches.push({
          tenantId: tenant.tenantId,
          appointmentId: appt.id,
          reminderHours,
          deviationMinutes,
          status: res.status,
        });
      }
    }

    return {
      evaluatedTenants: activeTenants.length,
      scannedAppointments,
      sent,
      deduplicated,
      failed,
      dispatches,
    };
  }
}
