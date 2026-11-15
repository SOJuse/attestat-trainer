import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listDocIds, loadDoc, loadRegistry } from './corpus';
import { ALLOWED_SOURCE_HOSTS } from './schema';

export type Report = { errors: string[]; warnings: string[]; stats: Record<string, number> };

const MIN_SECTIONS = 3;
const MIN_CHARS = 2000;

function hostAllowed(url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    host = u.hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
  return ALLOWED_SOURCE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

/** Проверяет корпус в папке `root` (корень репозитория). */
export function validateCorpus(root: string): Report {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stats = { registry: 0, full: 0, missing: 0, bibliographic: 0, absent: 0 };

  let registry;
  try {
    registry = loadRegistry(root);
  } catch (e) {
    return { errors: [`registry.yaml: ${(e as Error).message}`], warnings, stats };
  }
  stats.registry = registry.length;

  const ids = new Set<string>();
  for (const entry of registry) {
    if (ids.has(entry.id)) errors.push(`registry.yaml: повтор id ${entry.id}`);
    ids.add(entry.id);
  }

  for (const id of listDocIds(root)) {
    if (!ids.has(id)) errors.push(`${id}: папка есть, а в реестре документа нет`);
  }

  for (const entry of registry) {
    const where = `${entry.id}:`;
    let doc;
    try {
      doc = loadDoc(root, entry.id);
    } catch (e) {
      errors.push(`${where} ${(e as Error).message}`);
      continue;
    }
    if (!doc) {
      stats.absent++;
      continue;
    }
    const { meta, sections } = doc;
    stats[meta.text]++;
    if (meta.id !== entry.id) errors.push(`${where} в meta.yaml другой id: ${meta.id}`);
    if (meta.date && meta.edition && meta.edition < meta.date) {
      errors.push(`${where} редакция ${meta.edition} раньше даты акта ${meta.date}`);
    }
    if (meta.source_url && !hostAllowed(meta.source_url)) {
      errors.push(`${where} источник не из разрешённого списка: ${meta.source_url}`);
    }
    if (meta.text === 'full') {
      if (!existsSync(join(root, 'content', 'docs', entry.id, 'text.md'))) {
        errors.push(`${where} text: full, а файла text.md нет`);
        continue;
      }
      if (!meta.source_url) errors.push(`${where} у полного текста не указан source_url`);
      if (!meta.fetched) errors.push(`${where} у полного текста не указана дата загрузки`);
      if (sections.length < MIN_SECTIONS) {
        errors.push(`${where} разделов ${sections.length}, нужно не меньше ${MIN_SECTIONS}`);
      }
      const chars = sections.reduce((n, s) => n + s.text.length, 0);
      if (chars < MIN_CHARS) errors.push(`${where} текста ${chars} знаков, нужно не меньше ${MIN_CHARS}`);
    } else if (sections.length > 0) {
      errors.push(`${where} text: ${meta.text}, но text.md есть`);
    }
  }

  if (stats.absent > 0) warnings.push(`документов из реестра ещё нет в корпусе: ${stats.absent}`);
  return { errors, warnings, stats };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = validateCorpus(process.argv[2] ?? '..');
  const s = report.stats;
  console.log(
    `реестр: ${s.registry}, полный текст: ${s.full}, без текста: ${s.missing}, ` +
      `только запись: ${s.bibliographic}, не собрано: ${s.absent}`,
  );
  report.warnings.forEach((w) => console.log('предупреждение:', w));
  report.errors.forEach((e) => console.error('ошибка:', e));
  process.exit(report.errors.length ? 1 : 0);
}
