import { describe, expect, it } from 'vitest';
import { TenantsUseCases } from '../../src/application/usecases/tenants/tenants.usecases';
import { Tenant } from '../../src/domain/entities';

function pngDataUrl(width: number, height: number, extraBytes = 0): string {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return `data:image/png;base64,${Buffer.concat([signature, ihdr, Buffer.alloc(extraBytes)]).toString('base64')}`;
}

function webpDataUrl(width: number, height: number): string {
  const data = Buffer.alloc(30);
  data.write('RIFF', 0, 'ascii');
  data.writeUInt32LE(22, 4);
  data.write('WEBP', 8, 'ascii');
  data.write('VP8X', 12, 'ascii');
  data.writeUInt32LE(10, 16);
  data[24] = (width - 1) & 0xff;
  data[25] = ((width - 1) >> 8) & 0xff;
  data[26] = ((width - 1) >> 16) & 0xff;
  data[27] = (height - 1) & 0xff;
  data[28] = ((height - 1) >> 8) & 0xff;
  data[29] = ((height - 1) >> 16) & 0xff;
  return `data:image/webp;base64,${data.toString('base64')}`;
}

function jpegDataUrl(width: number, height: number): string {
  const data = Buffer.alloc(12);
  data.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  data.writeUInt16BE(height, 7);
  data.writeUInt16BE(width, 9);
  return `data:image/jpeg;base64,${data.toString('base64')}`;
}

const tenant = {
  tenantId: 't_logo',
  slug: 'logo-test',
  version: 1,
  logoUrl: undefined,
} as unknown as Tenant;

function usecases() {
  const saved: Array<{ data: Buffer; contentType: string }> = [];
  return {
    saved,
    service: new TenantsUseCases({
      tenants: {
        findById: async () => tenant,
        update: async (t: Tenant) => t,
      },
      tenantAssets: {
        saveLogo: async (input: { data: Buffer; contentType: string }) => {
          saved.push(input);
        },
      },
    } as any),
  };
}

const upload = (service: TenantsUseCases, image: string) =>
  service.uploadLogo({ tenantId: tenant.tenantId, actor: 'test', version: 1, image });

describe('TenantsUseCases.uploadLogo — normas estrictas de logo', () => {
  it('acepta PNG de 64x64, WebP de 512x512 y JPEG válido', async () => {
    for (const image of [pngDataUrl(64, 64), webpDataUrl(512, 512), jpegDataUrl(200, 300)]) {
      const { service, saved } = usecases();
      const updated = await upload(service, image);
      expect(updated.logoUrl).toMatch(/^\/public\/tenants\/logo-test\/logo\?v=/);
      expect(saved).toHaveLength(1);
    }
  });

  it('rechaza resolución menor a 64x64 y mayor a 512x512', async () => {
    for (const image of [pngDataUrl(63, 100), pngDataUrl(100, 63), pngDataUrl(513, 100), pngDataUrl(100, 513)]) {
      const { service, saved } = usecases();
      await expect(upload(service, image)).rejects.toMatchObject({
        details: expect.objectContaining({ code: 'LOGO_INVALID_DIMENSIONS' }),
      });
      expect(saved).toHaveLength(0);
    }
  });

  it('rechaza imágenes sin dimensiones detectable, formatos no permitidos y más de 160 KB', async () => {
    for (const image of [
      `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`,
      `data:image/svg+xml;base64,${Buffer.from('<svg />').toString('base64')}`,
      pngDataUrl(200, 200, 160 * 1024),
    ]) {
      const { service, saved } = usecases();
      await expect(upload(service, image)).rejects.toThrow();
      expect(saved).toHaveLength(0);
    }
  });
});
