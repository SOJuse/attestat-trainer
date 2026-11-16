import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CODES, TASKS_SCHEMA } from '../../app/src/core/taskSchema';
import { loadDoc, loadTopics } from './corpus';
import { Manifest } from './schema';
import { loadTasks, type Raw } from './tasks';
import { validateTasks } from './validate-tasks';

export type BuildTasksOptions = {
  root: string;
  out: string;
  build: number;
  date?: Date;
  pilot: boolean;
  /** версия пакета, если она уже задана манифестом библиотеки; иначе считается по дате и номеру сборки */
  packVersion?: string;
};
export type TasksInfo = { file: string; sha256: string; bytes: number; count: number };

const byId = (a: Raw, b: Raw) => String(a.id).localeCompare(String(b.id));
const without = (item: Raw, keys: string[]) =>
  Object.fromEntries(Object.entries(item).filter(([k]) => !keys.includes(k)));

/** Собирает tasks.json. База с ошибками не собирается: сначала проходит validateTasks. */
export function buildTasks({ root, out, build, date = new Date(), pilot, packVersion }: BuildTasksOptions): TasksInfo {
  const errors = validateTasks(root);
  if (errors.length) throw new Error(`в базе заданий ошибки:\n${errors.join('\n')}`);

  const { tasks, cases, cards } = loadTasks(root);
  const topics = loadTopics(root);
  const pad = (n: number) => String(n).padStart(2, '0');

  // подписи к цитатам: короткое название документа и признак «распознан со скана»
  const refsOf = (item: Raw): { doc: string }[] => [
    ...((item.refs as { doc: string }[] | undefined) ?? []),
    ...((item.steps as Raw[] | undefined) ?? []).flatMap((s) => (s.refs as { doc: string }[] | undefined) ?? []),
  ];
  const docIds = [...new Set([...tasks, ...cases, ...cards].flatMap(refsOf).map((r) => r.doc))].sort();
  const docs = Object.fromEntries(
    docIds.flatMap((id) => {
      const meta = loadDoc(root, id)?.meta;
      return meta ? [[id, { title: meta.short ?? meta.title, ocr: meta.text === 'ocr' }]] : [];
    }),
  );
  // Главный раздел нормы для темы: тот, на который чаще всего ссылаются её задания;
  // пока заданий нет, первый раздел первого документа темы с текстом.
  const topicDocs: Record<string, { id: string; anchor: string }> = {};
  for (const m of MODULE_CODES) {
    for (const t of topics.modules[m].topics) {
      const counts = new Map<string, number>();
      for (const task of tasks.filter((x) => x.module === m && x.topic === t.id)) {
        for (const ref of (task.refs as { doc: string; anchor: string }[] | undefined) ?? []) {
          const key = `${ref.doc} ${ref.anchor}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      if (top) {
        const [id, anchor] = top[0].split(' ');
        topicDocs[`${m}/${t.id}`] = { id, anchor };
        continue;
      }
      const first = t.docs.find((d) => (d.anchors?.length ?? 0) > 0 && loadDoc(root, d.doc));
      if (first) topicDocs[`${m}/${t.id}`] = { id: first.doc, anchor: first.anchors![0] };
    }
  }

  const pack = {
    schemaVersion: TASKS_SCHEMA,
    packVersion: packVersion ?? `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}.${build}`,
    pilot,
    modules: Object.fromEntries(
      MODULE_CODES.map((m) => {
        const info = topics.modules[m];
        return [m, { title: info.title, ready: info.ready, topics: info.topics.map((t) => ({ id: t.id, title: t.title })) }];
      }),
    ),
    topicDocs,
    docs,
    tasks: [...tasks].sort(byId).map((t) => without(t, ['file'])),
    cases: [...cases].sort(byId).map((c) => without(c, ['file'])),
    cards: [...cards].sort(byId).map((c) => without(c, ['file'])),
  };
  const text = JSON.stringify(pack) + '\n';
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'tasks.json'), text);
  return {
    file: 'tasks.json',
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: Buffer.byteLength(text),
    count: tasks.length,
  };
}

/**
 * Собирает базу рядом с уже собранной библиотекой и вписывает её в манифест.
 * Версия базы берётся из манифеста: у пакета одна версия на библиотеку и задания,
 * по ней программа решает, скачивать ли базу.
 */
export function buildTasksIntoPack(options: Omit<BuildTasksOptions, 'packVersion'>): TasksInfo {
  const manifestPath = join(options.out, 'manifest.json');
  if (!existsSync(manifestPath)) return buildTasks(options);
  const manifest = Manifest.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const info = buildTasks({ ...options, packVersion: manifest.packVersion });
  manifest.tasks = info;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return info;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const info = buildTasksIntoPack({
    root: arg('root', '..'),
    out: arg('out', '../dist-pack'),
    build: Number(arg('build', '1')),
    pilot: process.argv.includes('--pilot'),
  });
  console.log(`база заданий: ${info.count} заданий, ${(info.bytes / 1024).toFixed(1)} КБ`);
}
