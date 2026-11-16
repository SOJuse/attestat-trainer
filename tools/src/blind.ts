import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { MODULE_CODES } from '../../app/src/core/taskSchema';
import { loadTopics } from './corpus';
import { loadTasks, type Raw } from './tasks';

/**
 * Готовит задания для слепой проверки: без верных ответов, разборов, ловушек и ссылок на нормы.
 * Проверяющий решает задание сам по текстам корпуса, поэтому подсказок в файле быть не должно.
 */

const sorted = (list: string[]) => [...list].sort((a, b) => a.localeCompare(b, 'ru'));

/** Задание или шаг кейса без всего, что выдаёт ответ. Порядок вариантов — алфавитный. */
export function blind(item: Raw): Raw {
  const out: Raw = {};
  for (const key of ['id', 'type', 'difficulty', 'situation', 'change', 'question', 'unit']) {
    if (item[key] !== undefined && item[key] !== '') out[key] = item[key];
  }
  if (Array.isArray(item.options)) out.options = sorted(item.options.map((o: { text: string }) => o.text));
  if (Array.isArray(item.items)) out.items = sorted(item.items as string[]);
  if (Array.isArray(item.pairs)) {
    const pairs = item.pairs as { left: string; right: string }[];
    out.left = sorted(pairs.map((p) => p.left));
    out.right = sorted(pairs.map((p) => p.right));
  }
  return out;
}

export function blindModule(root: string, module: string): string {
  const { tasks, cases, cards } = loadTasks(root);
  const topics = loadTopics(root).modules[module as (typeof MODULE_CODES)[number]].topics;
  const norms = (topic: string) => topics.find((t) => t.id === topic)?.docs ?? [];
  const doc = {
    tasks: tasks
      .filter((t) => t.module === module)
      .map((t) => ({ ...blind(t), topic: t.topic, norms: norms(t.topic) })),
    cases: cases
      .filter((c) => c.module === module)
      .map((c) => ({
        id: c.id,
        title: c.title,
        intro: c.intro,
        norms: norms(String(c.topic)),
        steps: (c.steps as Raw[]).map((s, i) => ({ ...blind(s), id: `${String(c.id)}#${i + 1}` })),
      })),
    cards: cards
      .filter((c) => c.module === module)
      .map((c) => ({ id: c.id, front: c.front, norms: norms(String(c.topic)) })),
  };
  return stringify(doc, { lineWidth: 110 });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, out] = process.argv.slice(2);
  if (!root || !out) {
    console.error('использование: tsx src/blind.ts <корень репозитория> <папка для файлов>');
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  for (const module of MODULE_CODES) writeFileSync(join(out, `${module}.yaml`), blindModule(root, module));
  console.log(`файлы для слепой проверки: ${out}`);
}
