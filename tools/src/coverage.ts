import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULE_CODES, type ModuleCode } from '../../app/src/core/taskSchema';
import { loadTopics } from './corpus';
import { loadTasks, type Raw } from './tasks';

/**
 * Сводка по модулю для раскладки заданий и поиска дублей: сколько заданий каждого типа
 * и сложности в теме и какие задания опираются на одну и ту же норму.
 */

const TYPES = ['single', 'multiple', 'sequence', 'matching', 'input'] as const;

export type TopicCoverage = {
  topic: string;
  title: string;
  total: number;
  byType: Record<(typeof TYPES)[number], number>;
  byDifficulty: Record<1 | 2 | 3, number>;
  cases: number;
  cards: number;
};

export type Coverage = {
  topics: TopicCoverage[];
  /** «документ якорь» → id заданий, шагов кейсов и карточек, которые на него ссылаются */
  norms: Map<string, string[]>;
};

const refsOf = (item: Raw) => (item.refs as { doc: string; anchor: string }[] | undefined) ?? [];

export function coverage(root: string, module: ModuleCode): Coverage {
  const { tasks, cases, cards } = loadTasks(root);
  const info = loadTopics(root).modules[module];
  const mine = tasks.filter((t) => t.module === module);

  const topics = info.topics.map((t) => {
    const inTopic = mine.filter((x) => x.topic === t.id);
    const count = <K extends string | number>(keys: readonly K[], field: string) =>
      Object.fromEntries(keys.map((k) => [k, inTopic.filter((x) => x[field] === k).length])) as Record<K, number>;
    return {
      topic: t.id,
      title: t.title,
      total: inTopic.length,
      byType: count(TYPES, 'type'),
      byDifficulty: count([1, 2, 3] as const, 'difficulty'),
      cases: cases.filter((c) => c.module === module && c.topic === t.id).length,
      cards: cards.filter((c) => c.module === module && c.topic === t.id).length,
    };
  });

  const norms = new Map<string, string[]>();
  const add = (id: string, item: Raw) => {
    for (const ref of refsOf(item)) {
      const key = `${ref.doc} ${ref.anchor}`;
      const list = norms.get(key) ?? [];
      if (!list.includes(id)) list.push(id);
      norms.set(key, list);
    }
  };
  for (const t of mine) add(String(t.id), t);
  for (const c of cases.filter((x) => x.module === module)) {
    ((c.steps as Raw[] | undefined) ?? []).forEach((step, i) => add(`${String(c.id)}#${i + 1}`, step));
  }
  for (const c of cards.filter((x) => x.module === module)) add(String(c.id), c);
  return { topics, norms };
}

export function formatCoverage(module: string, c: Coverage): string {
  const lines: string[] = [];
  const total = c.topics.reduce((n, t) => n + t.total, 0);
  lines.push(`Модуль ${module}: заданий ${total}, кейсов ${c.topics.reduce((n, t) => n + t.cases, 0)}, карточек ${c.topics.reduce((n, t) => n + t.cards, 0)}`);
  lines.push('');
  lines.push('тема | всего | single multiple sequence matching input | сложность 1 2 3 | кейсы | карточки');
  for (const t of c.topics) {
    lines.push(
      `${t.topic} | ${t.total} | ${TYPES.map((k) => t.byType[k]).join(' ')} | ${t.byDifficulty[1]} ${t.byDifficulty[2]} ${t.byDifficulty[3]} | ${t.cases} | ${t.cards}`,
    );
  }
  lines.push('');
  lines.push('Нормы, на которые опирается больше одного задания (проверить, не один ли это поворот):');
  const shared = [...c.norms.entries()].filter(([, ids]) => ids.filter((id) => !id.includes('-card-')).length > 1).sort();
  if (shared.length === 0) lines.push('нет');
  for (const [norm, ids] of shared) lines.push(`${norm}: ${ids.join(', ')}`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [module, root = '..'] = process.argv.slice(2);
  if (!(MODULE_CODES as readonly string[]).includes(module)) {
    console.error('использование: npm run coverage -- <модуль>');
    process.exit(2);
  }
  console.log(formatCoverage(module, coverage(root, module as ModuleCode)));
}
