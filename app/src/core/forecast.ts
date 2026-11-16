import { daysBetween } from './dates';
import { EXAM } from './examConfig';
import type { UserData } from './progress';
import type { ModuleCode, TasksPack } from './taskSchema';

/** Меньше этого числа ответов в модуле прогноз не показывается: по десятку ответов обещать зачёт нельзя. */
export const MIN_ANSWERS = 30;
/** Вес ответа убывает на 3% за каждый день давности. */
const DAILY_DECAY = 0.97;
/** Сглаживание: к ответам добавляются два условных верных и два неверных. */
const PRIOR = 2;

/**
 * Оценка вероятности верного ответа на задание модуля. Берутся только первые ответы
 * на каждое задание: повторный ответ на знакомый вопрос знания нормы не показывает.
 */
export function moduleEstimate(
  data: UserData,
  pack: TasksPack,
  module: ModuleCode,
  today: string,
): { answers: number; p: number | null } {
  const inModule = new Set(pack.tasks.filter((t) => t.module === module).map((t) => t.id));
  let answers = 0;
  let weight = 0;
  let right = 0;
  for (const a of data.attempts) {
    if (!a.first || !inModule.has(a.id)) continue;
    const w = DAILY_DECAY ** Math.max(0, daysBetween(a.day, today));
    answers += 1;
    weight += w;
    if (a.correct) right += w;
  }
  if (answers < MIN_ANSWERS) return { answers, p: null };
  return { answers, p: (right + PRIOR) / (weight + 2 * PRIOR) };
}

/** Вероятности числа верных ответов 0..n при вероятности p на каждое задание. */
function binomial(n: number, p: number): number[] {
  let dist = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((q, k) => {
      next[k] += q * (1 - p);
      next[k + 1] += q * p;
    });
    dist = next;
  }
  return dist;
}

/**
 * Вероятность сдать экзамен на случайном варианте: в каждом модуле не ниже своего порога
 * и в сумме не ниже общего. `ps` — оценки по модулям в любом порядке.
 */
export function passProbability(ps: number[]): number {
  const minModule = Math.ceil(EXAM.perModule * EXAM.passModule);
  const minTotal = Math.ceil(EXAM.perModule * ps.length * EXAM.passTotal);
  // sums[s] — вероятность набрать в сумме s, не провалив ни одного из уже учтённых модулей
  let sums = [1];
  for (const p of ps) {
    const dist = binomial(EXAM.perModule, p);
    const next = new Array(sums.length + EXAM.perModule).fill(0);
    sums.forEach((q, s) => {
      for (let k = minModule; k <= EXAM.perModule; k++) next[s + k] += q * dist[k];
    });
    sums = next;
  }
  return sums.slice(minTotal).reduce((a, b) => a + b, 0);
}
