import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildLibrary } from './build-library';
import { Manifest } from './schema';
import { validateCorpus } from './validate';

const FIXTURE = 'src/fixtures/basic';
let out: string;
let db: Database.Database;
let manifest: Manifest;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'lib-'));
  buildLibrary({ root: FIXTURE, out, build: 3, date: new Date('2026-11-20T10:00:00Z') });
  manifest = Manifest.parse(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')));
  db = new Database(gunzipSync(readFileSync(join(out, 'library.sqlite.gz'))));
});

describe('buildLibrary', () => {
  it('фикстура проходит проверку корпуса', () => {
    expect(validateCorpus(FIXTURE).errors).toEqual([]);
  });

  it('кладёт в базу все документы и разделы', () => {
    expect(db.prepare('SELECT count(*) AS n FROM docs').get()).toEqual({ n: 3 });
    expect(db.prepare('SELECT count(*) AS n FROM sections').get()).toEqual({ n: 6 });
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });

  it('документ без текста попадает в docs без разделов', () => {
    const row = db.prepare("SELECT text_status, note FROM docs WHERE id = 'lit-9'").get();
    expect(row).toEqual({ text_status: 'missing', note: 'на официальных сайтах текста нет' });
    expect(db.prepare("SELECT count(*) AS n FROM sections WHERE doc_id = 'lit-9'").get()).toEqual({ n: 0 });
  });

  it('поиск по основе находит другую форму слова', () => {
    const rows = db
      .prepare(
        `SELECT s.doc_id, s.anchor FROM sections_fts f JOIN sections s ON s.rowid = f.rowid
         WHERE sections_fts MATCH ? ORDER BY s.doc_id, s.ord`,
      )
      .all('"отпуск"* "уход"*');
    expect(rows).toEqual([{ doc_id: 'tk-rf', anchor: 'st-256' }]);
  });

  it('модули хранятся строкой через запятую, разделы идут по порядку', () => {
    expect(db.prepare("SELECT modules FROM docs WHERE id = 'tk-rf'").get()).toEqual({ modules: 'K,R' });
    const ords = db.prepare("SELECT anchor, ord FROM sections WHERE doc_id = 'tk-rf' ORDER BY ord").all();
    expect(ords).toEqual([
      { anchor: 'st-255', ord: 0 },
      { anchor: 'st-256', ord: 1 },
      { anchor: 'st-257', ord: 2 },
    ]);
  });

  it('контекст раздела хранится отдельно и в поиск не попадает', () => {
    const rows = db.prepare("SELECT anchor, context FROM sections WHERE doc_id = 'tk-rf' ORDER BY ord").all();
    expect(rows).toEqual([
      { anchor: 'st-255', context: '' },
      { anchor: 'st-256', context: 'ЧАСТЬ ЧЕТВЕРТАЯ / Глава 41. ОСОБЕННОСТИ РЕГУЛИРОВАНИЯ ТРУДА ЖЕНЩИН' },
      { anchor: 'st-257', context: '' },
    ]);
    const hits = db.prepare('SELECT rowid FROM sections_fts WHERE sections_fts MATCH ?').all('"особен"*');
    expect(hits).toEqual([]);
  });

  it('распознанный со скана документ проходит проверку как текст и помечен в базе', () => {
    const report = validateCorpus('src/fixtures/ocr');
    expect(report.errors).toEqual([]);
    expect(report.stats.ocr).toBe(1);
    const dir = mkdtempSync(join(tmpdir(), 'lib-'));
    buildLibrary({ root: 'src/fixtures/ocr', out: dir, build: 1, date: new Date('2026-11-20T10:00:00Z') });
    const ocrDb = new Database(gunzipSync(readFileSync(join(dir, 'library.sqlite.gz'))));
    expect(ocrDb.prepare("SELECT text_status FROM docs WHERE id = 'prikaz-373'").get()).toEqual({ text_status: 'ocr' });
    expect(ocrDb.prepare('SELECT count(*) AS n FROM sections').get()).toEqual({ n: 3 });
  });

  it('распознанный документ без text.md — ошибка', () => {
    expect(validateCorpus('src/fixtures/ocr-empty').errors.join(' ')).toMatch(/text\.md нет/);
  });

  it('манифест описывает именно этот файл', () => {
    const gz = readFileSync(join(out, 'library.sqlite.gz'));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.packVersion).toBe('2026.11.20.3');
    expect(manifest.library.sha256).toBe(createHash('sha256').update(gz).digest('hex'));
    expect(manifest.library.bytes).toBe(gz.length);
    expect(manifest.library.docs).toBe(3);
  });

  it('повторная сборка даёт тот же файл', () => {
    const again = mkdtempSync(join(tmpdir(), 'lib-'));
    buildLibrary({ root: FIXTURE, out: again, build: 3, date: new Date('2026-11-20T10:00:00Z') });
    expect(readFileSync(join(again, 'library.sqlite.gz')).equals(readFileSync(join(out, 'library.sqlite.gz')))).toBe(
      true,
    );
  });
});
