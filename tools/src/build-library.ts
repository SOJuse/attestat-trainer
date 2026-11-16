import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { stemText } from '../../app/src/core/stem';
import { loadDoc, loadRegistry } from './corpus';
import type { Manifest } from './schema';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE docs (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, short TEXT, kind TEXT NOT NULL,
  number TEXT, date TEXT, edition TEXT, source_url TEXT, fetched TEXT,
  modules TEXT NOT NULL, text_status TEXT NOT NULL, note TEXT, list_no INTEGER,
  edition_status TEXT NOT NULL DEFAULT 'current', amended_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE sections (
  rowid INTEGER PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES docs(id),
  anchor TEXT NOT NULL, heading TEXT NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  UNIQUE (doc_id, anchor)
);
CREATE VIRTUAL TABLE sections_fts USING fts5(heading, text, content='', tokenize='unicode61');
`;

export type BuildOptions = { root: string; out: string; build: number; date?: Date };

/**
 * Собирает из корпуса базу библиотеки с поисковым индексом и манифест к ней.
 * Документы из реестра, которых ещё нет в корпусе, попадают в базу со статусом missing:
 * человек видит, что акт в списке есть, а текста пока нет.
 */
export function buildLibrary({ root, out, build, date = new Date() }: BuildOptions): Manifest {
  mkdirSync(out, { recursive: true });
  const dbPath = join(out, 'library.sqlite');
  rmSync(dbPath, { force: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = OFF');
  db.exec(SCHEMA);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);

  const insertDoc = db.prepare(
    `INSERT INTO docs VALUES (@id, @title, @short, @kind, @number, @date, @edition, @source_url,
       @fetched, @modules, @text_status, @note, @list_no, @edition_status, @amended_by)`,
  );
  const insertSection = db.prepare(
    'INSERT INTO sections (rowid, doc_id, anchor, heading, ord, text, context) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insertFts = db.prepare('INSERT INTO sections_fts (rowid, heading, text) VALUES (?, ?, ?)');

  const registry = [...loadRegistry(root)].sort((a, b) => a.id.localeCompare(b.id));
  let rowid = 0;
  db.transaction(() => {
    for (const entry of registry) {
      const doc = loadDoc(root, entry.id);
      const meta = doc?.meta;
      insertDoc.run({
        id: entry.id,
        title: meta?.title ?? entry.title,
        short: meta?.short ?? null,
        kind: meta?.kind ?? entry.kind,
        number: meta?.number ?? entry.number ?? null,
        date: meta?.date ?? entry.date ?? null,
        edition: meta?.edition ?? null,
        source_url: meta?.source_url ?? null,
        fetched: meta?.fetched ?? null,
        modules: (meta?.modules ?? entry.modules).join(','),
        text_status: meta?.text ?? 'missing',
        note: meta?.note ?? null,
        list_no: entry.list_no ?? null,
        edition_status: meta?.edition_status ?? 'current',
        // по акту на строку
        amended_by: (meta?.amended_by ?? []).join('\n'),
      });
      for (const s of doc?.sections ?? []) {
        rowid += 1;
        insertSection.run(rowid, entry.id, s.anchor, s.heading, s.ord, s.text, s.context);
        insertFts.run(rowid, stemText(s.heading), stemText(s.text));
      }
    }
  })();
  db.exec("INSERT INTO sections_fts(sections_fts) VALUES ('optimize')");
  db.exec('VACUUM');
  db.close();

  const gz = gzipSync(readFileSync(dbPath), { level: 9 });
  rmSync(dbPath);
  writeFileSync(join(out, 'library.sqlite.gz'), gz);

  const pad = (n: number) => String(n).padStart(2, '0');
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    packVersion: `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}.${build}`,
    library: {
      file: 'library.sqlite.gz',
      sha256: createHash('sha256').update(gz).digest('hex'),
      bytes: gz.length,
      docs: registry.length,
    },
  };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const manifest = buildLibrary({
    root: arg('root', '..'),
    out: arg('out', '../dist-pack'),
    build: Number(arg('build', '1')),
  });
  const mb = (manifest.library.bytes / 1024 / 1024).toFixed(1);
  console.log(`пакет ${manifest.packVersion}: документов ${manifest.library.docs}, ${mb} МБ`);
}
