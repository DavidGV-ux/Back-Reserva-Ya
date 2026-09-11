import { MembershipStatus, NotificationChannel, NotificationStatus as NStatus, NotificationType, PlatformRole, TenantRole } from './types';

export interface Notification {
  id: string;
  tenantId: string;
  appointmentId: string;
  channel: NotificationChannel;
  type: NotificationType;
  status: NStatus;
  providerMessageId?: string;
  attempts: number;
  lastError?: string;
  archived: boolean;
}

export interface TenantUser {
  tenantId: string;
  keycloakUserId: string;
  role: TenantRole;
  status: MembershipStatus;
  syncedAt: string;
}

export interface PlatformUser {
  keycloakUserId: string;
  role: PlatformRole;
  status: MembershipStatus;
  syncedAt: string;
}