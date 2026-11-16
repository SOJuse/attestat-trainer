import { addDays } from './dates';
import type { UserData } from './progress';
import { MODULE_CODES, type ModuleCode, type TasksPack } from './taskSchema';

/** Ниже этой точности тема считается слабой… */
export const WEAK_ACCURACY = 0.6;
/** …если по ней набралось хотя бы столько ответов. */
export const WEAK_MIN_ANSWERS = 5;

export type TopicStat = {
  module: ModuleCode;
  topic: string;
  title: string;
  /** сколько всего ответов дано по заданиям темы */
  answered: number;
  /** доля заданий, последний ответ на которые верный; null, пока ответов нет */
  accuracy: number | null;
  /** на сколько заданий темы отвечали хотя бы раз */
  seen: number;
  total: number;
  weak: boolean;
};

/** Последний ответ на каждое задание: по нему видно, знает ли человек норму сейчас. */
export function lastAnswers(data: UserData): Map<string, boolean> {
  const last = new Map<string, boolean>();
  for (const a of data.attempts) last.set(a.id, a.correct);
  return last;
}

export function topicStats(pack: TasksPack, data: UserData): TopicStat[] {
  const last = lastAnswers(data);
  const counts = new Map<string, number>();
  for (const a of data.attempts) counts.set(a.id, (counts.get(a.id) ?? 0) + 1);

  const out: TopicStat[] = [];
  for (const module of MODULE_CODES) {
    for (const { id: topic, title } of pack.modules[module].topics) {
      const tasks = pack.tasks.filter((t) => t.module === module && t.topic === topic);
      const seenTasks = tasks.filter((t) => last.has(t.id));
      const answered = tasks.reduce((n, t) => n + (counts.get(t.id) ?? 0), 0);
      const accuracy = seenTasks.length ? seenTasks.filter((t) => last.get(t.id)).length / seenTasks.length : null;
      out.push({
        module,
        topic,
        title,
        answered,
        accuracy,
        seen: seenTasks.length,
        total: tasks.length,
        weak: accuracy !== null && accuracy < WEAK_ACCURACY && answered >= WEAK_MIN_ANSWERS,
      });
    }
  }
  return out;
}

/**
 * Сколько дней подряд человек занимается. Если сегодня ответов ещё не было, серия не сгорает
 * до конца дня: она считается от вчера.
 */
export function streak(data: UserData, today: string): number {
  const days = new Set(data.attempts.map((a) => a.day));
  let day = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(day)) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}
