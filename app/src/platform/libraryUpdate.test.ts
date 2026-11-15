import { describe, expect, it, vi } from 'vitest';
import { LibraryError } from './Library';
import { decideUpdate, fetchManifest, MANIFEST_URL, runUpdate, type PackManifest } from './libraryUpdate';

const manifest = (over: Partial<PackManifest> = {}): PackManifest => ({
  schemaVersion: 1,
  packVersion: '2026.11.20.2',
  library: { file: 'library.sqlite.gz', sha256: 'a'.repeat(64), signature: 'c2lnbmF0dXJl', bytes: 8, docs: 3 },
  ...over,
});

const json = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 404, json: async () => body }) as unknown as Response;

function bodyOf(chunks: number[][]): Response {
  let i = 0;
  const reader = {
    read: async () =>
      i < chunks.length
        ? { done: false, value: new Uint8Array(chunks[i++]) }
        : { done: true, value: undefined },
  };
  return { ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response;
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof LibraryError ? e.code : `не LibraryError: ${e}`;
  }
  return 'не бросил';
};

describe('decideUpdate', () => {
  it.each([
    ['не установлено', null, 'install'],
    ['на сервере новее', '2026.11.20.1', 'install'],
    ['та же версия', '2026.11.20.2', 'skip'],
    ['на сервере старее', '2026.12.01.1', 'skip'],
    ['номер сборки сравнивается как число', '2026.11.20.10', 'skip'],
  ])('%s', (_, installed, expected) => {
    expect(decideUpdate(manifest(), installed)).toBe(expected);
  });

  it('пакет с новой схемой требует обновить программу', () => {
    expect(decideUpdate(manifest({ schemaVersion: 2 }), null)).toBe('app-too-old');
  });
});

describe('fetchManifest', () => {
  it('берёт манифест с GitHub Pages', async () => {
    const fetchImpl = vi.fn(async () => json(manifest()));
    await fetchManifest(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(MANIFEST_URL, { cache: 'no-store' });
    expect(MANIFEST_URL).toBe('https://sojuse.github.io/attestat-trainer/manifest.json');
  });

  it('сеть недоступна или 404 — ошибка network', async () => {
    expect(await code(fetchManifest(async () => Promise.reject(new Error('offline'))))).toBe('network');
    expect(await code(fetchManifest(async () => json({}, false)))).toBe('network');
  });

  it.each([
    ['не тот вид', { hello: 1 }],
    ['имя файла с путём', manifest({ library: { ...manifest().library, file: '../evil.gz' } })],
    ['имя файла с адресом', manifest({ library: { ...manifest().library, file: 'https://evil.example/x.gz' } })],
    ['хеш не по формату', manifest({ library: { ...manifest().library, sha256: 'zz' } })],
    ['нет подписи', manifest({ library: { ...manifest().library, signature: '' } })],
  ])('манифест отвергается: %s', async (_, body) => {
    expect(await code(fetchManifest(async () => json(body)))).toBe('bad-pack');
  });
});

describe('runUpdate', () => {
  const deps = (over = {}) => ({
    fetchImpl: vi.fn(async (url: string) => (url.endsWith('manifest.json') ? json(manifest()) : bodyOf([[1, 2, 3], [4, 5, 6, 7, 8]]))),
    installedVersion: async () => '2026.11.20.1' as string | null,
    install: vi.fn(async () => {}),
    ...over,
  });

  it('скачивает пакет рядом с манифестом и отдаёт его на установку', async () => {
    const d = deps();
    const seen: number[] = [];
    expect(await runUpdate(d, (f) => seen.push(f))).toBe('installed');
    expect(d.fetchImpl).toHaveBeenLastCalledWith('https://sojuse.github.io/attestat-trainer/library.sqlite.gz', {
      cache: 'no-store',
    });
    expect(d.install).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      'a'.repeat(64),
      'c2lnbmF0dXJl',
      '2026.11.20.2',
    );
    expect(seen).toEqual([0.375, 1]);
  });

  it('ничего не качает, если версия та же', async () => {
    const d = deps({ installedVersion: async () => '2026.11.20.2' });
    expect(await runUpdate(d)).toBe('up-to-date');
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    expect(d.install).not.toHaveBeenCalled();
  });

  it('новая схема пакета — app-too-old, без скачивания', async () => {
    const d = deps({ fetchImpl: vi.fn(async () => json(manifest({ schemaVersion: 2 }))) });
    expect(await code(runUpdate(d))).toBe('app-too-old');
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('обрыв загрузки — network, установка не вызывается', async () => {
    const broken = { ok: true, status: 200, body: { getReader: () => ({ read: async () => Promise.reject(new Error('reset')) }) } };
    const d = deps({
      fetchImpl: vi.fn(async (url: string) => (url.endsWith('manifest.json') ? json(manifest()) : (broken as unknown as Response))),
    });
    expect(await code(runUpdate(d))).toBe('network');
    expect(d.install).not.toHaveBeenCalled();
  });

  it('размер не совпал с манифестом — network (файл пришёл не целиком)', async () => {
    const d = deps({
      fetchImpl: vi.fn(async (url: string) => (url.endsWith('manifest.json') ? json(manifest()) : bodyOf([[1, 2]]))),
    });
    expect(await code(runUpdate(d))).toBe('network');
    expect(d.install).not.toHaveBeenCalled();
  });

  it.each(['checksum', 'signature', 'bad-pack'])('отказ установки с кодом %s доходит как LibraryError', async (c) => {
    const d = deps({ install: vi.fn(async () => Promise.reject(c)) });
    expect(await code(runUpdate(d))).toBe(c);
  });
});
