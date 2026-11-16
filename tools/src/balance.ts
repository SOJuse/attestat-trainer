import type { Task } from '../../app/src/core/taskSchema';

/**
 * Требования к балансу готового модуля (проект, раздел 5.4). Проверяется то, что считается:
 * объём, покрытие тем, доли типов и сложности, не выдаёт ли себя верный вариант длиной или местом.
 * Повтор одной нормы с одним поворотом ситуации скрипт не видит, это смотрит проверяющий.
 */
export const BALANCE = {
  perModule: 60,
  perTopic: 4,
  singleMax: 0.45,
  multipleMin: 0.3,
  otherMin: 0.15,
  difficulty: { 1: 0.2, 2: 0.5, 3: 0.3 } as Record<number, number>,
  difficultyTolerance: 0.1,
  longestCorrectMax: 0.35,
  /** доля одной позиции верного ответа в single: при четырёх вариантах ровно было бы 25% */
  positionMax: 0.4,
};

type Placed = { task: Task; topic: string };

const share = (n: number, total: number) => (total ? n / total : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function checkBalance(module: string, topics: string[], items: Placed[], target = BALANCE.perModule): string[] {
  const errors: string[] = [];
  const fail = (text: string) => errors.push(`баланс ${module}: ${text}`);
  const total = items.length;

  if (total < target) fail(`заданий ${total}, нужно не меньше ${target}`);
  for (const topic of topics) {
    const n = items.filter((i) => i.topic === topic).length;
    if (n < BALANCE.perTopic) fail(`в теме ${topic} заданий ${n}, нужно не меньше ${BALANCE.perTopic}`);
  }

  const byType = (type: Task['type']) => items.filter((i) => i.task.type === type).length;
  const single = share(byType('single'), total);
  const multiple = share(byType('multiple'), total);
  const other = 1 - single - multiple;
  if (single > BALANCE.singleMax) fail(`заданий с одним ответом ${pct(single)}, допустимо не больше ${pct(BALANCE.singleMax)}`);
  if (multiple < BALANCE.multipleMin) fail(`заданий с несколькими ответами ${pct(multiple)}, нужно не меньше ${pct(BALANCE.multipleMin)}`);
  if (total && other < BALANCE.otherMin) fail(`заданий на порядок, соответствие и число ${pct(other)}, нужно не меньше ${pct(BALANCE.otherMin)}`);

  for (const [level, target] of Object.entries(BALANCE.difficulty)) {
    const actual = share(items.filter((i) => i.task.difficulty === Number(level)).length, total);
    if (Math.abs(actual - target) > BALANCE.difficultyTolerance) {
      fail(`заданий сложности ${level} ${pct(actual)}, нужно около ${pct(target)}`);
    }
  }

  const singles = items.flatMap((i) => (i.task.type === 'single' ? [i.task] : []));
  if (singles.length > 0) {
    const longest = singles.filter((t) => {
      const correct = t.options.find((o) => o.correct)!;
      return t.options.every((o) => o === correct || o.text.length < correct.text.length);
    }).length;
    if (share(longest, singles.length) > BALANCE.longestCorrectMax) {
      fail(`верный вариант самый длинный в ${pct(share(longest, singles.length))} заданий с одним ответом, допустимо ${pct(BALANCE.longestCorrectMax)}`);
    }
    const positions = new Map<number, number>();
    for (const t of singles) {
      const at = t.options.findIndex((o) => o.correct);
      positions.set(at, (positions.get(at) ?? 0) + 1);
    }
    for (const [at, n] of positions) {
      if (singles.length >= 10 && share(n, singles.length) > BALANCE.positionMax) {
        fail(`верный вариант стоит ${at + 1}-м в ${pct(share(n, singles.length))} заданий с одним ответом, расставьте ровнее`);
      }
    }
  }
  return errors;
}
