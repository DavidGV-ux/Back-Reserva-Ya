import { bootstrap } from '../../infrastructure/bootstrap';

export async function expiredPaymentsHandler(): Promise<{ statusCode: number; body: string }> {
  const boot = await bootstrap();
  try {
    const result = await boot.services.payments.expirePendingPayments();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: 'expire-pending-payments', ...result }));
    return {
      statusCode: 200,
      body: JSON.stringify({ event: 'expire-pending-payments', ...result }),
    };
  } finally {
    await boot.shutdown();
  }
}

export async function repairTimeSlotsHandler(): Promise<{ statusCode: number; body: string }> {
  const boot = await bootstrap();
  try {
    const result = await boot.services.payments.repairTimeSlots();
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: 'repair-time-slots', ...result }));
    return {
      statusCode: 200,
      body: JSON.stringify({ event: 'repair-time-slots', ...result }),
    };
  } finally {
    await boot.shutdown();
  }
}

export const handler = expiredPaymentsHandler;