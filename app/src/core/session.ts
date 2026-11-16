import type { UserData } from './progress';
import { isDue } from './srs';
import { lastAnswers, topicStats } from './stats';
import type { ModuleCode, PlacedTask, TasksPack } from './taskSchema';

type DailyInput = { pack: TasksPack; data: UserData; today: string; size: number; random: () => number };

/** Во сколько раз чаще в сессию попадают новые задания из слабых тем. */
const WEAK_WEIGHT = 2;

/**
 * Состав ежедневной сессии: сначала всё, что пора повторить (самое просроченное первым),
 * затем новые задания, причём из слабых тем вдвое охотнее. Скрытые задания не попадают.
 */
export function dailySession({ pack, data, today, size, random }: DailyInput): string[] {
  const visible = pack.tasks.filter((t) => !data.items[t.id]?.hidden);

  const due = visible
    .filter((t) => isDue(data.items[t.id]?.srs, today))
    .sort((a, b) => {
      const da = data.items[a.id].srs!.due;
      const db = data.items[b.id].srs!.due;
      return da === db ? a.id.localeCompare(b.id) : da.localeCompare(db);
    })
    .map((t) => t.id)
    .slice(0, size);
  if (due.length >= size) return due;

  const weak = new Set(
    topicStats(pack, data)
      .filter((s) => s.weak)
      .map((s) => `${s.module}/${s.topic}`),
  );
  const pool = visible
    // новое — всё, чего нет в очереди повторений: и то, на что не отвечали, и то, что верно решили
    // только на экзамене, и задание с обновлённым содержанием
    .filter((t) => !data.items[t.id]?.srs)
    .map((t) => ({ id: t.id, weight: weak.has(`${t.module}/${t.topic}`) ? WEAK_WEIGHT : 1 }));

  const fresh: string[] = [];
  while (fresh.length < size - due.length && pool.length > 0) {
    const total = pool.reduce((n, p) => n + p.weight, 0);
    let roll = random() * total;
    let index = pool.findIndex((p) => (roll -= p.weight) < 0);
    if (index < 0) index = pool.length - 1;
    fresh.push(pool[index].id);
    pool.splice(index, 1);
  }
  return [...due, ...fresh];
}

export type TrainingFilter = {
  module?: ModuleCode;
  topic?: string;
  difficulty?: 1 | 2 | 3;
  type?: PlacedTask['type'];
  /** только задания, последний ответ на которые неверный */
  onlyErrors?: boolean;
};

/** Задания для свободной тренировки по фильтру, в порядке базы. */
export function trainingSet({ pack, data, filter }: { pack: TasksPack; data: UserData; filter: TrainingFilter }): string[] {
  const last = filter.onlyErrors ? lastAnswers(data) : null;
  return pack.tasks
    .filter(
      (t) =>
        !data.items[t.id]?.hidden &&
        (!filter.module || t.module === filter.module) &&
        (!filter.topic || t.topic === filter.topic) &&
        (!filter.difficulty || t.difficulty === filter.difficulty) &&
        (!filter.type || t.type === filter.type) &&
        (!last || last.get(t.id) === false),
    )
    .map((t) => t.id);
}
