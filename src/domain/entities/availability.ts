import { SlotOccupation } from './types';

export interface AvailabilityBlock {
  id: string;
  tenantId: string;
  professionalId: string;
  startTime: string;
  endTime: string;
  reason?: string;
  status: 'active' | 'cancelled';
  version: number;
}

export interface TimeSlot {
  id: string;
  tenantId: string;
  professionalId: string;
  slotStart: string;
  occupationType: SlotOccupation;
  appointmentId?: string;
  blockId?: string;
  createdAt: string;
}

export type SlotReason = 'block' | 'booked' | 'past' | 'gap';

export interface SlotView {
  start: string;
  end: string;
  available: boolean;
  blocked: boolean;
  reason?: SlotReason;
}

export interface OccupancyRange {
  professionalId: string;
  start: number;
  end: number;
}