import { Appointment, Professional, Tenant } from '../../domain/entities';

/**
 * Publica el evento `appointment.created` en el webhook interno del servicio de
 * WhatsApp independiente (WHATSAPP_EVENTS_ENDPOINT), para que el bot informe al
 * dueño/profesional y programe los recordatorios (8h y 1h antes).
 *
 * Fire-and-forget: si el endpoint no está configurado o falla, la reserva sigue.
 */
export async function publishAppointmentCreated(input: {
  appointment: Appointment;
  tenant?: Tenant;
  professional?: Professional;
}): Promise<void> {
  const endpoint = process.env.WHATSAPP_EVENTS_ENDPOINT;
  if (!endpoint) return;
  const secret = process.env.WHATSAPP_BOT_SECRET ?? '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        type: 'appointment.created',
        appointment: {
          id: input.appointment.id,
          tenantId: input.appointment.tenantId,
          professionalId: input.appointment.professionalId,
          serviceId: input.appointment.serviceId,
          serviceName: input.appointment.serviceSnapshot.name,
          price: input.appointment.serviceSnapshot.price,
          currency: input.appointment.serviceSnapshot.currency,
          durationMinutes: input.appointment.serviceSnapshot.durationMinutes,
          startTime: input.appointment.startTime,
          endTime: input.appointment.endTime,
          status: input.appointment.status,
          paymentStatus: input.appointment.paymentStatus,
          paymentReference: input.appointment.paymentReference,
          clientName: input.appointment.clientInfo.name,
          clientPhone: input.appointment.clientInfo.phone,
          clientEmail: input.appointment.clientInfo.email,
          source: input.appointment.source,
        },
        tenant: input.tenant
          ? {
            tenantId: input.tenant.tenantId,
            name: input.tenant.name,
            slug: input.tenant.slug,
            city: input.tenant.city,
            address: input.tenant.address,
            businessPhone: input.tenant.phone,
            timezone: input.tenant.timezone,
          }
          : undefined,
        professional: input.professional
          ? {
            id: input.professional.id,
            name: input.professional.name,
            phone: input.professional.phone,
          }
          : undefined,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    console.error(
      '[whatsapp-events] publish appointment.created failed',
      err instanceof Error ? err.message : err,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pide al bot de WhatsApp que envíe al usuario una invitación a usar el
 * servicio por ese canal (se dispara la primera vez que completa su perfil
 * tras el registro). Devuelve true si el bot respondió ok, false si no.
 */
export async function publishUserInvite(input: {
  phone: string;
  name?: string;
  city?: string;
}): Promise<boolean> {
  const endpoint = process.env.WHATSAPP_EVENTS_ENDPOINT;
  if (!endpoint) return false;
  const secret = process.env.WHATSAPP_BOT_SECRET ?? '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        type: 'user.invite',
        user: { name: input.name, phone: input.phone, city: input.city },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error('[whatsapp-events] user.invite rejected', response.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      '[whatsapp-events] publish user.invite failed',
      err instanceof Error ? err.message : err,
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}