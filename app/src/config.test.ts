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
