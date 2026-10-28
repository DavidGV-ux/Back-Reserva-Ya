import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyRetention } from '../../src/infrastructure/backup/apply-retention';
import * as r2 from '../../src/infrastructure/backup/upload-to-r2';

function formatIsoDateDaysAgo(daysAgo: number): string {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('applyRetention (unit)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('borra backups mas viejos que el limite de retencion', async () => {
    const expiredBackup = `backup-${formatIsoDateDaysAgo(60)}.bin`;
    const recentBackup = `backup-${formatIsoDateDaysAgo(5)}.bin`;

    vi.spyOn(r2, 'listBackups').mockResolvedValue([expiredBackup, recentBackup]);
    const deleteSpy = vi.spyOn(r2, 'deleteBackup').mockResolvedValue(undefined);

    const result = await applyRetention(30);

    expect(result.deleted).toContain(expiredBackup);
    expect(result.kept).toContain(recentBackup);
    expect(deleteSpy).toHaveBeenCalledWith(expiredBackup);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('no borra archivos con nombre desconocido', async () => {
    vi.spyOn(r2, 'listBackups').mockResolvedValue(['archivo-raro.txt']);
    const deleteSpy = vi.spyOn(r2, 'deleteBackup').mockResolvedValue(undefined);

    const result = await applyRetention(30);

    expect(result.kept).toContain('archivo-raro.txt');
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
