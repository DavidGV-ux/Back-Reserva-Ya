import { ClientSession, Db } from 'mongodb';
import { ConflictError, NotFoundError } from '../../../../shared/errors';
import { AvailabilityBlock, TimeSlot } from '../../../../domain/entities';
import { AvailabilityBlockRepository, TimeSlotRepository } from '../../../../domain/ports/repositories';
import { assertUpdated, auditCreate, coll, occUpdate } from './base';
import { bsonId, isDuplicateKeyError } from '../bson';
import { blockToDomain, timeSlotToDomain } from '../mappers/mappers';

export class AvailabilityBlockMongoRepository implements AvailabilityBlockRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'availability_blocks');
  }

  async findActiveByProfessional(tenantId: string, professionalId: string, from: string, to: string): Promise<AvailabilityBlock[]> {
    const docs = await this.collection
      .find(
        {
          tenant_id: tenantId,
          professional_id: bsonId(professionalId),
          status: 'active',
          start_time: { $lt: new Date(to) },
          end_time: { $gt: new Date(from) },
        },
        { session: this.session },
      )
      .sort({ start_time: 1 })
      .toArray();
    return docs.map((d) => blockToDomain(d));
  }

  async create(block: AvailabilityBlock, actor: string): Promise<AvailabilityBlock> {
    const doc = auditCreate(
      {
        tenant_id: block.tenantId,
        professional_id: bsonId(block.professionalId),
        start_time: new Date(block.startTime),
        end_time: new Date(block.endTime),
        reason: block.reason ?? '',
        status: 'active',
      },
      actor,
    );
    const res = await this.collection.insertOne(doc, { session: this.session });
    return blockToDomain({ ...doc, _id: res.insertedId });
  }

  async updateStatus(tenantId: string, id: string, expectedVersion: number, status: 'active' | 'cancelled', actor: string): Promise<AvailabilityBlock> {
    const updated = await occUpdate(
      this.collection,
      { _id: bsonId(id), tenant_id: tenantId },
      expectedVersion,
      { status },
      actor,
      this.session,
    );
    assertUpdated(id, updated);
    return blockToDomain(updated!);
  }
}

export class TimeSlotMongoRepository implements TimeSlotRepository {
  private readonly collection;
  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'time_slots');
  }

  async findOccupiedWithinRange(tenantId: string, professionalId: string, from: string, to: string): Promise<TimeSlot[]> {
    const docs = await this.collection
      .find(
        {
          tenant_id: tenantId,
          professional_id: bsonId(professionalId),
          slot_start: { $gte: new Date(from), $lt: new Date(to) },
        },
        { session: this.session },
      )
      .toArray();
    return docs.map((d) => timeSlotToDomain(d));
  }

  async insertMany(slots: TimeSlot[]): Promise<void> {
    const docs = slots.map((s) => ({
      tenant_id: s.tenantId,
      professional_id: bsonId(s.professionalId),
      slot_start: new Date(s.slotStart),
      occupation_type: s.occupationType,
      ...(s.appointmentId ? { appointment_id: bsonId(s.appointmentId) } : {}),
      ...(s.blockId ? { block_id: bsonId(s.blockId) } : {}),
      created_at: new Date(s.createdAt),
    }));
    try {
      await this.collection.insertMany(docs, { session: this.session, ordered: true });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new ConflictError('AVAILABILITY_CONFLICT', 'slot is already occupied');
      }
      throw err;
    }
  }

  async insertSlotIfFree(slot: TimeSlot): Promise<boolean> {
    const doc = {
      tenant_id: slot.tenantId,
      professional_id: bsonId(slot.professionalId),
      slot_start: new Date(slot.slotStart),
      occupation_type: slot.occupationType,
      ...(slot.appointmentId ? { appointment_id: bsonId(slot.appointmentId) } : {}),
      ...(slot.blockId ? { block_id: bsonId(slot.blockId) } : {}),
      created_at: new Date(),
    };
    try {
      await this.collection.insertOne(doc, { session: this.session });
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  async removeForBlock(tenantId: string, blockId: string): Promise<void> {
    await this.collection.deleteMany(
      { tenant_id: tenantId, block_id: bsonId(blockId) },
      { session: this.session },
    );
  }

  async removeForAppointment(tenantId: string, appointmentId: string): Promise<void> {
    await this.collection.deleteMany(
      { tenant_id: tenantId, appointment_id: bsonId(appointmentId) },
      { session: this.session },
    );
  }

  async occupationByRange(tenantId: string, professionalIds: string[], from: string, to: string): Promise<Map<string, { occupationType: TimeSlot['occupationType']; start: number; end: number }[]>> {
    const docs = await this.collection
      .find(
        {
          tenant_id: tenantId,
          professional_id: { $in: professionalIds.map((id) => bsonId(id)) },
          slot_start: { $gte: new Date(from), $lt: new Date(to) },
        },
        { session: this.session },
      )
      .toArray();
    const map = new Map<string, { occupationType: TimeSlot['occupationType']; start: number; end: number }[]>();
    for (const d of docs) {
      const key = String(d.professional_id);
      const list = map.get(key) ?? [];
      const start = new Date(d.slot_start as string | Date).getTime();
      list.push({ occupationType: d.occupation_type as TimeSlot['occupationType'], start, end: start + 15 * 60_000 });
      map.set(key, list);
    }
    return map;
  }
}

export { NotFoundError };