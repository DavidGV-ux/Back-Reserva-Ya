import { PaymentTransaction } from '../entities/payments';

export interface PaymentGatewayProvider {
  readonly name: string;
  createCharge(input: {
    tenantId: string;
    appointmentId: string;
    internalReference: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ providerTransactionId: string; status: PaymentTransaction['status'] }>;
  createRefund(input: {
    tenantId: string;
    appointmentId: string;
    internalReference: string;
    amount: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerTransactionId: string; status: PaymentTransaction['status'] }>;
  confirmEvent(event: unknown): Promise<{
    provider: string;
    providerEventId: string;
    providerTransactionId?: string;
    operation: PaymentTransaction['operation'];
    internalReference: string;
    amount: number;
    currency: string;
    status: PaymentTransaction['status'];
    metadata?: Record<string, unknown>;
  }>;
}

export interface NotificationGateway {
  readonly channel: 'whatsapp' | 'email' | 'sms';
  send(input: {
    tenantId: string;
    appointmentId: string;
    to: string;
    type: 'confirmation' | 'reminder' | 'cancellation';
    message: string;
  }): Promise<{ providerMessageId?: string }>;
}

export type RealmRole = 'ry_owner' | 'ry_professional' | 'ry_client' | 'ry_admin';

export interface IdentityUser {
  sub: string;
  enabled: boolean;
  email?: string;
  username: string;
}

export interface IdentityGateway {
  readonly provider: string;
  ensureRealmRole(sub: string, role: RealmRole): Promise<void>;
  createUser(input: {
    username: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    temporaryPassword: string;
  }): Promise<{ sub: string }>;
  findByEmail(email: string): Promise<IdentityUser | null>;
  findBySub(sub: string): Promise<IdentityUser | null>;
}