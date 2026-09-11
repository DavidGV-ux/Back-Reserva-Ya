import { BookingStatus, Currency, LanguageCode } from './types';

export interface AuditFields {
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SoftDeleteFields {
  deletedAt: string | null;
}

export interface Plan {
  id: string;
  name: string;
  code: string;
  commissionRate: number;
  fixedFee: number;
  active: boolean;
}

export interface TenantConfig {
  defaultLanguage: LanguageCode;
  activeLanguages: LanguageCode[];
  slotGranularityMinutes: number;
  cancellationToleranceHours: number;
  paymentTimeoutMinutes: number;
  advancePaymentPercentage: number;
  preferredNotificationChannel: 'whatsapp' | 'email' | 'sms';
  reminderHours: number;
  whatsappPhoneNumberId?: string;
}

export interface Tenant {
  id: string;
  tenantId: string;
  slug: string;
  deletedAt?: string | null;
  planId: string;
  name: string;
  tagline: string;
  description: string;
  timezone: string;
  currency: Currency;
  country?: string;
  logoUrl?: string;
  coverUrl?: string;
  address?: string;
  phone?: string;
  settings: TenantConfig;
  bookingStatus: BookingStatus;
  version: number;
}