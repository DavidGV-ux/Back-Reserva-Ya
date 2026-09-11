import { Currency } from './types';

export interface Service {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  price: number;
  currency: Currency;
  durationMinutes: number;
  active: boolean;
  version: number;
}

export interface WorkInterval {
  start: string;
  end: string;
}

export interface WeeklySchedule {
  monday: WorkInterval[];
  tuesday: WorkInterval[];
  wednesday: WorkInterval[];
  thursday: WorkInterval[];
  friday: WorkInterval[];
  saturday: WorkInterval[];
  sunday: WorkInterval[];
}

export interface Professional {
  id: string;
  tenantId: string;
  name: string;
  title?: string;
  avatarUrl?: string;
  serviceIds: string[];
  schedule: WeeklySchedule;
  active: boolean;
  keycloakUserId?: string;
  version: number;
}