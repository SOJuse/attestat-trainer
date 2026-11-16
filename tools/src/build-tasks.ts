import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_CODES, TASKS_SCHEMA } from '../../app/src/core/taskSchema';
import { loadTopics } from './corpus';
import { loadTasks, type Raw } from './tasks';
import { validateTasks } from './validate-tasks';

export type BuildTasksOptions = { root: string; out: string; build: number; date?: Date; pilot: boolean };
export type TasksInfo = { file: string; sha256: string; bytes: number; count: number };

const byId = (a: Raw, b: Raw) => String(a.id).localeCompare(String(b.id));
const without = (item: Raw, keys: string[]) =>
  Object.fromEntries(Object.entries(item).filter(([k]) => !keys.includes(k)));

/** Собирает tasks.json. База с ошибками не собирается: сначала проходит validateTasks. */
export function buildTasks({ root, out, build, date = new Date(), pilot }: BuildTasksOptions): TasksInfo {
  const errors = validateTasks(root);
  if (errors.length) throw new Error(`в базе заданий ошибки:\n${errors.join('\n')}`);

  const { tasks, cases, cards } = loadTasks(root);
  const topics = loadTopics(root);
  const pad = (n: number) => String(n).padStart(2, '0');
  const pack = {
    schemaVersion: TASKS_SCHEMA,
    packVersion: `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}.${build}`,
    pilot,
    modules: Object.fromEntries(
      MODULE_CODES.map((m) => {
        const info = topics.modules[m];
        return [m, { title: info.title, ready: info.ready, topics: info.topics.map((t) => ({ id: t.id, title: t.title })) }];
      }),
    ),
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name: string, fallback: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : fallback;
  };
  const info = buildTasks({
    root: arg('root', '..'),
    out: arg('out', '../dist-pack'),
    build: Number(arg('build', '1')),
    pilot: process.argv.includes('--pilot'),
  });
  console.log(`база заданий: ${info.count} заданий, ${(info.bytes / 1024).toFixed(1)} КБ`);
}
