import { BookingStatus, Currency, LanguageCode } from './types';

export const TENANT_CATEGORIES = [
  'beauty',
  'health',
  'pets',
  'food',
  'bars_cafes',
  'leisure',
  'sports',
  'education',
  'home',
  'shopping',
  'events',
  'other',
] as const;

export type TenantCategory = (typeof TENANT_CATEGORIES)[number];

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
  /**
   * `exclusive`: cada profesional atiende una sola reserva a la vez
   * (barberías, clínicas, etc.).
   * `capacity`: el negocio atiende varias reservas simultáneas hasta
   * `capacityPerSlot` (cafés, restaurantes, eventos).
   * Si no se define, se infiere de la categoría del negocio.
   */
  bookingMode?: 'exclusive' | 'capacity';
  capacityPerSlot?: number;
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
  category?: TenantCategory;
  city?: string;
  logoUrl?: string;
  coverUrl?: string;
  address?: string;
  phone?: string;
  settings: TenantConfig;
  bookingStatus: BookingStatus;
  version: number;
}