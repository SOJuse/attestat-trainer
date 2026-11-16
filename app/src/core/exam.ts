import { EXAM, MINI } from './examConfig';
import { grade, type Answer } from './grade';
import type { UserData } from './progress';
import { MODULE_CODES, type ModuleCode, type PlacedTask, type TasksPack } from './taskSchema';

type Pick = { pack: TasksPack; data: UserData; random: () => number };

/**
 * Выбирает `count` заданий модуля: поровну из разных тем, в каждой теме первыми идут те,
 * что давно не встречались (или не встречались вовсе). Скрытые задания не берутся.
 */
function pickFromModule({ pack, data, random }: Pick, module: ModuleCode, count: number): string[] {
  const lastSeen = new Map<string, string>();
  for (const a of data.attempts) lastSeen.set(a.id, a.at);

  const byTopic = new Map<string, { id: string; seen: string; tie: number }[]>();
  for (const t of pack.tasks) {
    if (t.module !== module || data.items[t.id]?.hidden) continue;
    const list = byTopic.get(t.topic) ?? [];
    list.push({ id: t.id, seen: lastSeen.get(t.id) ?? '', tie: random() });
    byTopic.set(t.topic, list);
  }
  const queues = [...byTopic.values()]
    .map((list) => ({ list: list.sort((a, b) => a.seen.localeCompare(b.seen) || a.tie - b.tie), tie: random() }))
    .sort((a, b) => a.tie - b.tie)
    .map((q) => q.list);

  const picked: string[] = [];
  while (picked.length < count && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && picked.length < count) picked.push(next.id);
    }
  }
  return picked;
}

/** Состав полного экзамена или null, если его пока нельзя собрать. */
export function buildExam(p: Pick): string[] | null {
  if (p.pack.pilot) return null;
  const ids: string[] = [];
  for (const module of MODULE_CODES) {
    if (!p.pack.modules[module].ready) return null;
    const picked = pickFromModule(p, module, EXAM.perModule);
    if (picked.length < EXAM.perModule) return null;
    ids.push(...picked);
  }
  return ids;
}

/** Состав мини-теста по модулю или null, если заданий не хватает или модуль не готов. */
export function buildMiniTest(p: Pick & { module: ModuleCode }): string[] | null {
  if (!p.pack.pilot && !p.pack.modules[p.module].ready) return null;
  const picked = pickFromModule(p, p.module, MINI.tasks);
  const minimum = p.pack.pilot ? MINI.pilotMinimum : MINI.tasks;
  return picked.length >= minimum ? picked : null;
}

export type Failed = { rule: 'total' } | { rule: 'module'; module: ModuleCode };
export type ExamScore = {
  correct: number;
  total: number;
  byModule: Partial<Record<ModuleCode, { total: number; correct: number }>>;
  passed: boolean;
  /** какие правила не выполнены: общий порог и модули ниже своего порога */
  failed: Failed[];
};

/** Подсчёт результата. Задание без ответа считается неверным. */
export function scoreExam(tasks: PlacedTask[], answers: (Answer | undefined)[], kind: 'full' | 'mini'): ExamScore {
  const byModule: ExamScore['byModule'] = {};
  let correct = 0;
  tasks.forEach((task, i) => {
    const answer = answers[i];
    const ok = answer !== undefined && grade(task, answer);
    const tally = (byModule[task.module] ??= { total: 0, correct: 0 });
    tally.total += 1;
    if (ok) {
      tally.correct += 1;
      correct += 1;
    }
  });

  const total = tasks.length;
  const failed: Failed[] = [];
  if (kind === 'mini') {
    if (total === 0 || correct / total < MINI.pass) failed.push({ rule: 'total' });
  } else {
    if (total === 0 || correct / total < EXAM.passTotal) failed.push({ rule: 'total' });
    for (const module of MODULE_CODES) {
      const tally = byModule[module];
      if (tally && tally.correct / tally.total < EXAM.passModule) failed.push({ rule: 'module', module });
    }
  }
  return { correct, total, byModule, passed: failed.length === 0, failed };
}

/**
 * Сколько секунд осталось. Считается по часам, а не по тикам таймера: сон компьютера и свёрнутое
 * окно лишнего времени не дают. Если часы перевели назад, остаток не превышает лимита.
 */
export function remainingSeconds(startedAt: number, now: number, limitSeconds: number): number {
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  return Math.max(0, limitSeconds - elapsed);
}
