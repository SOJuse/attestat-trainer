import { readFileSync } from 'node:fs';
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

it('пакеты базы проверяются тем же ключом, что и обновления программы', () => {
  const rust = readFileSync('src-tauri/src/library.rs', 'utf8');
  const m = rust.match(/pub const PACK_PUBKEY: &str = "([^"]+)";/);
  expect(m?.[1]).toBe(conf.plugins.updater.pubkey);
});
