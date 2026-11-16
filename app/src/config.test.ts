import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// vitest запускается из папки app/
const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));

it('окно и сборка настроены по спецификации', () => {
  expect(conf.productName).toBe('Attestat1103');
  expect(conf.identifier).toBe('io.github.sojuse.attestat-trainer');
  const w = conf.app.windows[0];
  expect([w.minWidth, w.minHeight, w.width, w.height]).toEqual([1024, 700, 1280, 820]);
  expect(w.title).toBe('Аттестация 1103');
  expect(conf.bundle.macOS.signingIdentity).toBe('-');
});

it('обновления настроены: ключ, адрес манифеста, файлы обновления', () => {
  expect(conf.bundle.createUpdaterArtifacts).toBe(true);
  expect(conf.plugins.updater.pubkey.length).toBeGreaterThan(50);
  expect(conf.plugins.updater.endpoints).toEqual([
    'https://github.com/SOJuse/attestat-trainer/releases/latest/download/latest.json',
  ]);
});

it('на Windows издатель не «github», лишний MSI не собирается', () => {
  expect(conf.bundle.publisher).toBe('SOJuse');
  expect(conf.bundle.targets).toEqual(['app', 'dmg', 'nsis']);
});

it('в меню macOS программа называется по-русски', () => {
  const plist = readFileSync('src-tauri/Info.plist', 'utf8');
  expect(plist).toMatch(/<key>CFBundleName<\/key>\s*<string>Аттестация 1103<\/string>/);
});

it('релиз публикуется только после всех сборок', () => {
  const wf = readFileSync('../.github/workflows/release.yml', 'utf8');
  expect(wf).toMatch(/releaseDraft: true/);
  expect(wf).toMatch(/publish:\s*\n\s*needs: build/);
  expect(wf).toMatch(/gh release edit .* --draft=false/);
});


it('политика содержимого: только свои ресурсы и адрес пакета базы', () => {
  const csp: string = conf.app.security.csp;
  const rule = (name: string) =>
    csp
      .split(';')
      .map((r) => r.trim().split(/\s+/))
      .find(([n]) => n === name)
      ?.slice(1);
  expect(rule('default-src')).toEqual(["'self'"]);
  expect(rule('script-src')).toBeUndefined(); // наследует default-src: никаких inline и eval
  expect(rule('connect-src')).toEqual(["'self'", 'ipc:', 'http://ipc.localhost', 'https://sojuse.github.io']);
  expect(rule('img-src')).toEqual(["'self'", 'data:']);
  expect(rule('object-src')).toEqual(["'none'"]);
  expect(csp).not.toMatch(/unsafe-eval|\*/);
});

it('источники актов открываются только по разрешённым адресам', () => {
  const caps = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
  const opener = caps.permissions.find((p: { identifier?: string }) => p.identifier === 'opener:allow-open-url');
  expect(opener.allow.map((a: { url: string }) => a.url).sort()).toEqual([
    'http://actual.pravo.gov.ru/*',
    'http://government.ru/*',
    'http://publication.pravo.gov.ru/*',
    'http://www.kremlin.ru/*',
    'https://github.com/*',
  ]);
});

it('адрес источника каждого документа корпуса разрешён к открытию', () => {
  const caps = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'));
  const opener = caps.permissions.find((p: { identifier?: string }) => p.identifier === 'opener:allow-open-url');
  const prefixes: string[] = opener.allow.map((a: { url: string }) => a.url.replace(/\*$/, ''));
  const blocked: string[] = [];
  for (const id of readdirSync('../content/docs')) {
    const path = `../content/docs/${id}/meta.yaml`;
    if (!existsSync(path)) continue;
    const url = readFileSync(path, 'utf8').match(/^source_url: (\S+)$/m)?.[1];
    if (url && !prefixes.some((p) => url.startsWith(p))) blocked.push(`${id}: ${url}`);
  }
  expect(blocked).toEqual([]);
});

it('пакеты базы подписаны своим ключом, а не ключом обновлений программы', () => {
  const rust = readFileSync('src-tauri/src/library.rs', 'utf8');
  const key = rust.match(/pub const PACK_PUBKEY: &str = "([^"]+)";/)?.[1];
  expect(key).toBeTruthy();
  expect(key).not.toBe(conf.plugins.updater.pubkey);
});

it('версия схемы пакета одна и та же в программе, в Rust и в сборщике', () => {
  const rust = readFileSync('src-tauri/src/library.rs', 'utf8').match(/const SCHEMA_VERSION: i64 = (\d+);/)?.[1];
  const builder = readFileSync('../tools/src/build-library.ts', 'utf8').match(/export const SCHEMA_VERSION = (\d+);/)?.[1];
  const app = readFileSync('src/platform/libraryUpdate.ts', 'utf8').match(/export const SUPPORTED_SCHEMA = (\d+);/)?.[1];
  expect([rust, builder, app]).toEqual(['1', '1', '1']);
});
