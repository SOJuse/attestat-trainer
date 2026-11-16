import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLibrary } from './build-library';
import { Manifest } from './schema';
import { addSignature } from './sign-manifest';

function pack(): string {
  const out = mkdtempSync(join(tmpdir(), 'sign-'));
  buildLibrary({ root: 'src/fixtures/basic', out, build: 1, date: new Date('2026-11-20T00:00:00Z') });
  return out;
}

describe('addSignature', () => {
  it('переносит подпись из .sig в манифест', () => {
    const out = pack();
    writeFileSync(join(out, 'library.sqlite.gz.sig'), 'c2lnbmF0dXJl\n');
    addSignature(out);
    const manifest = Manifest.parse(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')));
    expect(manifest.library.signature).toBe('c2lnbmF0dXJl');
  });

  it('без файла подписи падает: неподписанный пакет публиковать нельзя', () => {
    expect(() => addSignature(pack())).toThrow(/подпис/i);
  });

  it('пустая подпись тоже ошибка', () => {
    const out = pack();
    writeFileSync(join(out, 'library.sqlite.gz.sig'), '  \n');
    expect(() => addSignature(out)).toThrow(/подпис/i);
  });
});
