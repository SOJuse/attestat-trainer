import { LibraryError, type LibraryErrorCode } from './Library';

export const PACK_BASE_URL = 'https://sojuse.github.io/attestat-trainer/';
export const MANIFEST_URL = PACK_BASE_URL + 'manifest.json';
/** Версия схемы пакета, которую понимает эта программа. */
export const SUPPORTED_SCHEMA = 1;

export type PackManifest = {
  schemaVersion: number;
  packVersion: string;
  library: { file: string; sha256: string; signature: string; bytes: number; docs: number };
  /** база заданий; в манифестах до третьего этапа блока нет */
  tasks?: { file: string; sha256: string; signature: string; bytes: number; count: number };
};

type Fetch = (url: string, init: { cache: 'no-store' }) => Promise<Response>;

const VERSION = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;
const FILE = /^[a-z0-9][a-z0-9.-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CODES: LibraryErrorCode[] = [
  'not-installed',
  'network',
  'checksum',
  'signature',
  'bad-pack',
  'app-too-old',
  'query',
  'io',
];

function isManifest(x: unknown): x is PackManifest {
  const m = x as PackManifest;
  return (
    typeof m === 'object' &&
    m !== null &&
    Number.isInteger(m.schemaVersion) &&
    typeof m.packVersion === 'string' &&
    VERSION.test(m.packVersion) &&
    typeof m.library === 'object' &&
    m.library !== null &&
    typeof m.library.file === 'string' &&
    FILE.test(m.library.file) &&
    typeof m.library.sha256 === 'string' &&
    SHA256.test(m.library.sha256) &&
    typeof m.library.signature === 'string' &&
    m.library.signature.length > 0 &&
    Number.isInteger(m.library.bytes) &&
    m.library.bytes > 0 &&
    Number.isInteger(m.library.docs) &&
    (m.tasks === undefined ||
      (typeof m.tasks === 'object' &&
        m.tasks !== null &&
        typeof m.tasks.file === 'string' &&
        FILE.test(m.tasks.file) &&
        typeof m.tasks.sha256 === 'string' &&
        SHA256.test(m.tasks.sha256) &&
        typeof m.tasks.signature === 'string' &&
        m.tasks.signature.length > 0 &&
        Number.isInteger(m.tasks.bytes) &&
        m.tasks.bytes > 0))
  );
}

/** Версии вида 2026.11.20.3 сравниваются по частям как числа. */
export function isNewer(candidate: string, installed: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = installed.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function decideUpdate(
  manifest: PackManifest,
  installedVersion: string | null,
): 'install' | 'skip' | 'app-too-old' {
  if (manifest.schemaVersion > SUPPORTED_SCHEMA) return 'app-too-old';
  if (installedVersion === null || !VERSION.test(installedVersion)) return 'install';
  return isNewer(manifest.packVersion, installedVersion) ? 'install' : 'skip';
}

export async function fetchManifest(fetchImpl: Fetch): Promise<PackManifest> {
  let body: unknown;
  try {
    const res = await fetchImpl(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    body = await res.json();
  } catch {
    throw new LibraryError('network');
  }
  if (!isManifest(body)) throw new LibraryError('bad-pack');
  return body;
}

export async function download(
  fetchImpl: Fetch,
  url: string,
  expectedBytes: number,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(String(res.status));
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(Math.min(received / expectedBytes, 1));
    }
  } catch {
    throw new LibraryError('network');
  }
  // файл пришёл не целиком: для человека это та же проблема со связью
  if (received !== expectedBytes) throw new LibraryError('network');
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export type UpdateDeps = {
  fetchImpl: Fetch;
  installedVersion: () => Promise<string | null>;
  /**
   * Отдаёт пакет на проверку и установку. Подлинность проверяет принимающая сторона
   * по подписи и зашитому ключу. Отказ — строка с кодом ошибки.
   */
  install: (pack: Uint8Array, sha256: string, signature: string, packVersion: string) => Promise<void>;
};

export async function runUpdate(
  deps: UpdateDeps,
  onProgress?: (fraction: number) => void,
): Promise<'installed' | 'up-to-date'> {
  const manifest = await fetchManifest(deps.fetchImpl);
  const decision = decideUpdate(manifest, await deps.installedVersion());
  if (decision === 'app-too-old') throw new LibraryError('app-too-old');
  if (decision === 'skip') return 'up-to-date';

  const { file, sha256, signature, bytes } = manifest.library;
  const pack = await download(deps.fetchImpl, PACK_BASE_URL + file, bytes, onProgress);
  try {
    await deps.install(pack, sha256, signature, manifest.packVersion);
  } catch (e) {
    throw toLibraryError(e);
  }
  return 'installed';
}

/** Команды Rust отвечают на ошибку строкой с кодом. */
export function toLibraryError(e: unknown): LibraryError {
  if (e instanceof LibraryError) return e;
  const code = CODES.find((c) => c === e);
  return new LibraryError(code ?? 'io');
}
