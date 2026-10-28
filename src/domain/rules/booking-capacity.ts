import { Tenant, TenantCategory } from '../entities';

export type BookingMode = 'exclusive' | 'capacity';

export interface BookingPolicy {
  mode: BookingMode;
  capacityPerSlot: number;
}

/**
 * Categorías en las que el "profesional" no es un recurso exclusivo: un mesero,
 * barista o anfitrión puede atender varias mesas/clientes en la misma franja.
 * La barbería, la clínica o el entrenador personal siguen siendo exclusivos.
 */
export const SHARED_CAPACITY_CATEGORIES: TenantCategory[] = [
  'food',
  'bars_cafes',
  'leisure',
  'events',
  'shopping',
];

export const DEFAULT_CAPACITY_BY_CATEGORY: Partial<Record<TenantCategory, number>> = {
  food: 20,
  bars_cafes: 20,
  leisure: 30,
  events: 50,
  shopping: 10,
};

/**
 * Resuelve cómo se controla la concurrencia de un negocio.
 *
 * - Si `settings.bookingMode` está definido, manda esa configuración.
 * - Si no, las categorías de capacidad compartida usan `capacity`; el resto
 *   usa `exclusive` (una reserva por profesional y franja).
 * - `capacityPerSlot` se puede sobreescribir por tenant; si no, se usa un
 *   valor razonable según la categoría.
 */
export function resolveBookingPolicy(
  tenant: Pick<Tenant, 'category'> & { settings?: Partial<Tenant['settings']> },
): BookingPolicy {
  const configured = tenant.settings?.bookingMode;
  const mode: BookingMode =
    configured === 'capacity' || configured === 'exclusive'
      ? configured
      : tenant.category && SHARED_CAPACITY_CATEGORIES.includes(tenant.category)
        ? 'capacity'
        : 'exclusive';

  if (mode === 'exclusive') {
    return { mode, capacityPerSlot: 1 };
  }

  const configuredCapacity = Number(tenant.settings?.capacityPerSlot);
  const fallback = (tenant.category && DEFAULT_CAPACITY_BY_CATEGORY[tenant.category]) ?? 10;
  const capacityPerSlot =
    Number.isFinite(configuredCapacity) && configuredCapacity > 0
      ? Math.floor(configuredCapacity)
      : fallback;

  return { mode, capacityPerSlot: Math.max(1, capacityPerSlot) };
}
