import { Appointment, Tenant } from '../../../domain/entities';

export interface RenderedTemplate {
  subject: string;
  text: string;
  html: string;
  metaTemplateName: string;
  metaTemplateLanguage: string;
  metaTemplateParams: string[];
}

export function formatMoneyCop(amount: number, currency = 'COP'): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatBogotaDateTime(iso: string, timezone = 'America/Bogota'): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/**
 * B-06: Plantilla aprobada de bienvenida en español (texto + HTML + Meta WABA template).
 */
export function buildWelcomeTemplate(input: {
  clientName: string;
  city?: string;
  tenantName?: string;
}): RenderedTemplate {
  const negocio = input.tenantName ?? 'ReservaYa';
  const ciudad = input.city ? ` en ${input.city}` : '';
  const subject = `¡Bienvenido(a) a ${negocio}, ${input.clientName}!`;
  const text = `Hola ${input.clientName}, te damos la bienvenida a ${negocio}${ciudad}. Ya puedes agendar tus citas y gestionar tus reservas directamente por WhatsApp o en nuestra plataforma web.`;
  const html = `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; background-color: #ffffff;">
    <h2 style="color: #0f172a; margin-top: 0;">¡Bienvenido(a) a ${negocio}!</h2>
    <p>Hola <strong>${input.clientName}</strong>,</p>
    <p>Tu perfil ha quedado vinculado exitosamente${ciudad}. A partir de ahora puedes:</p>
    <ul>
      <li>Consultar disponibilidad y agendar turnos por WhatsApp con nuestro asistente IA.</li>
      <li>Pagar tu anticipo de forma segura con enlace de pago.</li>
      <li>Recibir tus recibos y recordatorios automáticos antes de cada cita.</li>
    </ul>
    <p style="margin-bottom: 0; color: #64748b; font-size: 13px;">Equipo ${negocio} · Impulsado por ReservaYa</p>
  </div>
</body>
</html>`;

  return {
    subject,
    text,
    html,
    metaTemplateName: 'reservaya_bienvenida_es',
    metaTemplateLanguage: 'es',
    metaTemplateParams: [input.clientName, negocio],
  };
}

/**
 * B-06: Plantilla aprobada de confirmación de cita y recibo de pago en español (texto + HTML + Meta WABA).
 */
export function buildConfirmationReceiptTemplate(input: {
  appointment: Appointment;
  tenant?: Tenant;
  paidAmount?: number;
}): RenderedTemplate {
  const { appointment, tenant } = input;
  const negocio = tenant?.name ?? appointment.tenantId;
  const timezone = tenant?.timezone ?? 'America/Bogota';
  const fechaHora = formatBogotaDateTime(appointment.startTime, timezone);
  const montoPagado = input.paidAmount ?? appointment.paidAmount ?? appointment.serviceSnapshot.price;
  const montoFormateado = formatMoneyCop(montoPagado, appointment.serviceSnapshot.currency);
  const totalServicio = formatMoneyCop(
    appointment.serviceSnapshot.price,
    appointment.serviceSnapshot.currency,
  );
  const referencia = appointment.paymentReference ?? appointment.id;

  const subject = `Confirmación y recibo de pago — ${negocio} (${referencia})`;
  const text =
    `✅ Cita confirmada en ${negocio}.\n` +
    `Cliente: ${appointment.clientInfo.name}\n` +
    `Servicio: ${appointment.serviceSnapshot.name} (${appointment.serviceSnapshot.durationMinutes} min)\n` +
    `Fecha y hora: ${fechaHora}\n` +
    `Referencia de pago: ${referencia}\n` +
    `Anticipo pagado: ${montoFormateado} (Total servicio: ${totalServicio})`;

  const html = `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; background-color: #ffffff;">
    <h2 style="color: #16a34a; margin-top: 0;">✅ Cita Confirmada y Recibo de Pago</h2>
    <p>Hola <strong>${appointment.clientInfo.name}</strong>, hemos confirmado tu reserva en <strong>${negocio}</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 8px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Servicio</td><td style="padding: 8px; border-bottom: 1px solid #f1f5f9;"><strong>${appointment.serviceSnapshot.name}</strong> (${appointment.serviceSnapshot.durationMinutes} min)</td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Fecha y hora</td><td style="padding: 8px; border-bottom: 1px solid #f1f5f9;"><strong>${fechaHora}</strong></td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Referencia de pago</td><td style="padding: 8px; border-bottom: 1px solid #f1f5f9;"><code>${referencia}</code></td></tr>
      <tr><td style="padding: 8px; border-bottom: 1px solid #f1f5f9; color: #64748b;">Anticipo recibido</td><td style="padding: 8px; border-bottom: 1px solid #f1f5f9;"><strong>${montoFormateado}</strong></td></tr>
      <tr><td style="padding: 8px; color: #64748b;">Valor total del servicio</td><td style="padding: 8px;">${totalServicio}</td></tr>
    </table>
    <p style="margin-bottom: 0; color: #64748b; font-size: 13px;">Gracias por reservar con ${negocio} a través de ReservaYa.</p>
  </div>
</body>
</html>`;

  return {
    subject,
    text,
    html,
    metaTemplateName: 'reservaya_recibo_pago_es',
    metaTemplateLanguage: 'es',
    metaTemplateParams: [
      appointment.clientInfo.name,
      negocio,
      appointment.serviceSnapshot.name,
      fechaHora,
      referencia,
      montoFormateado,
    ],
  };
}

/**
 * Plantilla de recordatorio programado de cita (B-03 / B-06).
 */
export function buildReminderTemplate(input: {
  appointment: Appointment;
  tenant?: Tenant;
}): RenderedTemplate {
  const { appointment, tenant } = input;
  const negocio = tenant?.name ?? appointment.tenantId;
  const timezone = tenant?.timezone ?? 'America/Bogota';
  const fechaHora = formatBogotaDateTime(appointment.startTime, timezone);

  const subject = `Recordatorio de tu cita en ${negocio}`;
  const text =
    `⏰ Recordatorio: Hola ${appointment.clientInfo.name}, tienes una cita programada en ${negocio} ` +
    `para el servicio "${appointment.serviceSnapshot.name}" el ${fechaHora}. ¡Te esperamos!`;

  const html = `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; background-color: #ffffff;">
    <h2 style="color: #2563eb; margin-top: 0;">⏰ Recordatorio de Cita</h2>
    <p>Hola <strong>${appointment.clientInfo.name}</strong>,</p>
    <p>Te recordamos tu próxima cita en <strong>${negocio}</strong>:</p>
    <ul>
      <li><strong>Servicio:</strong> ${appointment.serviceSnapshot.name}</li>
      <li><strong>Fecha y hora:</strong> ${fechaHora}</li>
    </ul>
    <p style="margin-bottom: 0; color: #64748b; font-size: 13px;">¡Te esperamos puntual!</p>
  </div>
</body>
</html>`;

  return {
    subject,
    text,
    html,
    metaTemplateName: 'reservaya_recordatorio_cita_es',
    metaTemplateLanguage: 'es',
    metaTemplateParams: [
      appointment.clientInfo.name,
      negocio,
      appointment.serviceSnapshot.name,
      fechaHora,
    ],
  };
}

/**
 * Plantilla de cancelación de cita (B-02 / B-06).
 */
export function buildCancellationTemplate(input: {
  appointment: Appointment;
  tenant?: Tenant;
}): RenderedTemplate {
  const { appointment, tenant } = input;
  const negocio = tenant?.name ?? appointment.tenantId;
  const timezone = tenant?.timezone ?? 'America/Bogota';
  const fechaHora = formatBogotaDateTime(appointment.startTime, timezone);
  const refundAmount = appointment.cancellation?.refundAmount ?? 0;
  const refundTexto =
    refundAmount > 0
      ? `Reembolso aprobado/en proceso por ${formatMoneyCop(refundAmount, appointment.serviceSnapshot.currency)}.`
      : 'Cancelación procesada según la política del establecimiento.';

  const subject = `Cancelación de cita — ${negocio}`;
  const text =
    `❌ Tu cita en ${negocio} para "${appointment.serviceSnapshot.name}" (${fechaHora}) ha sido cancelada. ` +
    refundTexto;

  const html = `<!DOCTYPE html>
<html lang="es">
<body style="font-family: Arial, sans-serif; color: #1e293b; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; background-color: #ffffff;">
    <h2 style="color: #dc2626; margin-top: 0;">❌ Cita Cancelada</h2>
    <p>Hola <strong>${appointment.clientInfo.name}</strong>,</p>
    <p>Tu cita en <strong>${negocio}</strong> para el servicio <strong>${appointment.serviceSnapshot.name}</strong> programada el <strong>${fechaHora}</strong> ha sido cancelada.</p>
    <p>${refundTexto}</p>
  </div>
</body>
</html>`;

  return {
    subject,
    text,
    html,
    metaTemplateName: 'reservaya_cancelacion_cita_es',
    metaTemplateLanguage: 'es',
    metaTemplateParams: [
      appointment.clientInfo.name,
      negocio,
      appointment.serviceSnapshot.name,
      fechaHora,
    ],
  };
}
