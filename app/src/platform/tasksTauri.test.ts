import { describe, expect, it, vi } from 'vitest';
import { makePack } from '../core/testPack';
import { LibraryError } from './Library';
import { createTasksSource, type TasksDeps } from './tasksTauri';

const SHA = 'a'.repeat(64);
const bundled = { ...makePack(1), packVersion: '2026.11.20.1' };
const newer = { ...makePack(1), packVersion: '2026.12.01.1' };
const newerText = JSON.stringify(newer);
const bytes = new TextEncoder().encode(newerText);

const manifest = (over: object = {}) => ({
  schemaVersion: 1,
  packVersion: '2026.12.01.1',
  library: { file: 'library.sqlite.gz', sha256: SHA, signature: 'sig', bytes: 10, docs: 3 },
  tasks: { file: 'tasks.json', sha256: SHA, signature: 'tasks-sig', bytes: bytes.length, count: 25 },
  ...over,
});

function deps(over: Partial<TasksDeps> & { manifest?: object } = {}): TasksDeps {
  const { manifest: m = manifest(), ...rest } = over;
  return {
    fetchImpl: vi.fn(async (url: string) => (url.endsWith('manifest.json') ? new Response(JSON.stringify(m)) : new Response(bytes))),
    read: vi.fn(async () => null),
    install: vi.fn(async () => {}),
    bundled: () => bundled,
    ...rest,
  };
}

describe('база заданий в настольной версии', () => {
  it('без обновлений отдаёт зашитую базу', async () => {
    expect((await createTasksSource(deps()).current()).packVersion).toBe('2026.11.20.1');
  });

  it('отдаёт установленную базу, если она новее зашитой', async () => {
    const source = createTasksSource(deps({ read: async () => newerText }));
    expect((await source.current()).packVersion).toBe('2026.12.01.1');
  });

  it('установленная база старее зашитой не используется', async () => {
    const old = JSON.stringify({ ...makePack(1), packVersion: '2026.01.01.1' });
    expect((await createTasksSource(deps({ read: async () => old })).current()).packVersion).toBe('2026.11.20.1');
  });

  it('испорченный установленный файл не мешает работать', async () => {
    expect((await createTasksSource(deps({ read: async () => '{не json' })).current()).packVersion).toBe('2026.11.20.1');
    const failing = deps({ read: async () => Promise.reject('io') });
    expect((await createTasksSource(failing).current()).packVersion).toBe('2026.11.20.1');
  });

  it('скачивает более новую базу и отдаёт её на установку с подписью', async () => {
    const d = deps();
    expect(await createTasksSource(d).update()).toBe('installed');
    const [sent, sha, sig] = vi.mocked(d.install).mock.calls[0];
    expect(new TextDecoder().decode(sent)).toBe(newerText);
    expect([sha, sig]).toEqual([SHA, 'tasks-sig']);
    expect(d.fetchImpl).toHaveBeenCalledWith('https://sojuse.github.io/attestat-trainer/tasks.json', { cache: 'no-store' });
  });

  it('ничего не качает, если база не новее или в манифесте её нет', async () => {
    const same = deps({ read: async () => newerText });
    expect(await createTasksSource(same).update()).toBe('up-to-date');
    expect(same.install).not.toHaveBeenCalled();
    const without = deps({ manifest: manifest({ tasks: undefined }) });
    expect(await createTasksSource(without).update()).toBe('up-to-date');
    expect(without.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('отказ проверки подписи доходит кодом ошибки', async () => {
    const d = deps({ install: async () => Promise.reject('signature') });
    await expect(createTasksSource(d).update()).rejects.toMatchObject({ code: 'signature' });
  });

  it('манифест от более новой схемы просит обновить программу', async () => {
    const d = deps({ manifest: manifest({ schemaVersion: 2 }) });
    await expect(createTasksSource(d).update()).rejects.toEqual(new LibraryError('app-too-old'));
    expect(d.install).not.toHaveBeenCalled();
  });

  it('нет сети: ошибка network', async () => {
    const d = deps({ fetchImpl: async () => Promise.reject(new Error('offline')) });
    await expect(createTasksSource(d).update()).rejects.toMatchObject({ code: 'network' });
  });
});
