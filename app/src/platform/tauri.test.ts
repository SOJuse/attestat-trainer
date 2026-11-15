import { beforeEach, describe, expect, it, vi } from 'vitest';

const check = vi.fn();
const relaunch = vi.fn(async () => {});

vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => check() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: () => relaunch() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.0' }));

type Listener = (e: { event: string; data?: Record<string, number> }) => void;

function fakeUpdate(events: Parameters<Listener>[0][] = []) {
  return {
    version: '0.2.0',
    body: 'заметки',
    downloadAndInstall: vi.fn(async (onEvent: Listener) => events.forEach(onEvent)),
  };
}

describe('tauriPlatform', () => {
  beforeEach(async () => {
    vi.resetModules();
    check.mockReset();
    relaunch.mockClear();
  });

  it('ставит то обновление, которое нашла проверка, без повторного запроса', async () => {
    const update = fakeUpdate();
    check.mockResolvedValueOnce(update);
    const { tauriPlatform } = await import('./tauri');

    expect(await tauriPlatform.checkAppUpdate()).toEqual({ version: '0.2.0', notes: 'заметки' });
    await tauriPlatform.installAppUpdate();

    expect(check).toHaveBeenCalledOnce();
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('бросает ошибку, если ставить нечего', async () => {
    check.mockResolvedValue(null);
    const { tauriPlatform } = await import('./tauri');

    await expect(tauriPlatform.installAppUpdate()).rejects.toThrow();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('пересчитывает события загрузки в долю', async () => {
    check.mockResolvedValueOnce(
      fakeUpdate([
        { event: 'Started', data: { contentLength: 200 } },
        { event: 'Progress', data: { chunkLength: 50 } },
        { event: 'Progress', data: { chunkLength: 150 } },
        { event: 'Finished' },
      ]),
    );
    const { tauriPlatform } = await import('./tauri');
    const seen: number[] = [];

    await tauriPlatform.checkAppUpdate();
    await tauriPlatform.installAppUpdate((f) => seen.push(f));

    expect(seen).toEqual([0.25, 1, 1]);
  });
});
