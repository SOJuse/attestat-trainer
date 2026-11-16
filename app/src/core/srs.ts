import { addDays } from './dates';

/** Через сколько дней показать задание снова на каждой ступени. */
export const INTERVALS = [1, 3, 7, 16, 35] as const;

/** box — ступень 0..4; due — день следующего показа. */
export type Srs = { box: number; due: string };

/**
 * Состояние после ответа. Верный ответ поднимает на ступень (первый верный ставит на первую),
 * неверный возвращает на первую. Интервал отсчитывается от дня ответа.
 */
export function reviewed(prev: Srs | undefined, correct: boolean, today: string): Srs {
  const box = !correct || !prev ? 0 : Math.min(prev.box + 1, INTERVALS.length - 1);
  return { box, due: addDays(today, INTERVALS[box]) };
}

/** Пора ли повторять. Задание, на которое ещё не отвечали, — новое, а не «к повторению». */
export function isDue(s: Srs | undefined, today: string): boolean {
  return s !== undefined && s.due <= today;
}
