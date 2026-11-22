import { ClientSession, Db } from 'mongodb';
import { TenantAssetRepository, TenantLogoAsset } from '../../../../domain/ports/repositories';
import { coll } from './base';

function toBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.byteLength === 'number' && obj.byteLength >= 0) {
      try {
        const buf = Buffer.from(value as Uint8Array);
        if (buf.length === (obj.byteLength as number)) return buf;
      } catch {
        // continue with other strategies
      }
    }
    if (obj.buffer instanceof ArrayBuffer) {
      return Buffer.from(obj.buffer);
    }
    if (obj.buffer instanceof Uint8Array) {
      return Buffer.from(obj.buffer);
    }
    if (typeof obj.toString === 'function' && obj._bsontype === 'Binary') {
      try {
        const encoded = (obj.toString as (format?: string) => string)('base64');
        if (encoded && /^[A-Za-z0-9+/=]+$/.test(encoded)) {
          const buf = Buffer.from(encoded, 'base64');
          if (buf.length > 0) return buf;
        }
      } catch {
        // ignore and fall through
      }
    }
  }
  return null;
}

function logoId(tenantId: string): string {
  return `logo:${tenantId}`;
}

/**
 * Guarda el logo como BinData en una colección aparte. El documento
 * `tenants` solo conserva la URL versionada, de modo que el catálogo,
 * el panel y las reservas no leen los bytes de la imagen.
 */
export class TenantAssetMongoRepository implements TenantAssetRepository {
  private readonly collection;

  constructor(db: Db, private readonly session?: ClientSession) {
    this.collection = coll(db, 'tenant_assets') as unknown as import('mongodb').Collection<any>;
  }

  async findLogo(tenantId: string): Promise<TenantLogoAsset | null> {
    const doc = await this.collection.findOne(
      { _id: logoId(tenantId), kind: 'logo' },
      { session: this.session },
    );
    if (!doc) return null;
    const data = toBuffer(doc.data);
    if (!data) return null;
    return {
      tenantId,
      data,
      contentType: typeof doc.content_type === 'string' ? doc.content_type : 'application/octet-stream',
      version: Number(doc.version ?? 0),
      updatedAt: doc.updated_at instanceof Date ? doc.updated_at.toISOString() : String(doc.updated_at ?? ''),
    };
  }

  async saveLogo(input: {
    tenantId: string;
    data: Buffer;
    contentType: string;
    version: number;
  }): Promise<void> {
    await this.collection.updateOne(
      { _id: logoId(input.tenantId) },
      {
        $set: {
          tenant_id: input.tenantId,
          kind: 'logo',
          data: input.data,
          content_type: input.contentType,
          version: input.version,
          updated_at: new Date(),
        },
      },
      { upsert: true, session: this.session },
    );
  }

  async deleteLogo(tenantId: string): Promise<void> {
    await this.collection.deleteOne({ _id: logoId(tenantId) }, { session: this.session });
  }
}
