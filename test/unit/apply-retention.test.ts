import { describe, expect, it, vi, beforeEach } from 'vitest';
import { applyRetention } from '../../src/infrastructure/backup/apply-retention';
import * as r2 from '../../src/infrastructure/backup/upload-to-r2';

describe('applyRetention (unit)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('borra backups mas viejos que el limite de retencion', async () => {
    vi.spyOn(r2, 'listBackups').mockResolvedValue([
      'backup-2026-01-01.bin', 
      'backup-2026-09-20.bin', 
    ]);
    const deleteSpy = vi.spyOn(r2, 'deleteBackup').mockResolvedValue(undefined);

    const result = await applyRetention(30);

    expect(result.deleted).toContain('backup-2026-01-01.bin');
    expect(result.kept).toContain('backup-2026-09-20.bin');
    expect(deleteSpy).toHaveBeenCalledWith('backup-2026-01-01.bin');
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