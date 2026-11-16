import type { CaseStep, Task } from './taskSchema';

/** Ответ человека. Индексы — номера вариантов, шагов и пар в том порядке, как они записаны в задании. */
export type Answer =
  | { type: 'single'; choice: number | null }
  | { type: 'multiple'; choices: number[] }
  | { type: 'sequence'; order: number[] }
  | { type: 'matching'; rights: (number | null)[] }
  | { type: 'input'; text: string };

type Gradable = Task | CaseStep;

/**
 * Число из того, что вписал человек: «1,5», « 1.5 », «10 дней», «30%», «72ч».
 * Число должно стоять в начале и быть одним; всё прочее — null.
 */
export function parseNumber(text: string): number | null {
  const m = text.trim().match(/^(\d+(?:[.,]\d+)?)(?![.,\d])/);
  if (!m) return null;
  // после числа допустима единица измерения, но не второе число и не «или 4»
  const rest = text.trim().slice(m[1].length);
  if (/\d/.test(rest)) return null;
  const value = Number(m[1].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

const sameSet = (a: number[], b: number[]) => a.length === b.length && new Set(a).size === a.length && a.every((x) => b.includes(x));

/** Верен ли ответ. Несколько вариантов, порядок и соответствие засчитываются только целиком. */
export function grade(task: Gradable, answer: Answer): boolean {
  if (task.type !== answer.type) return false;
  switch (task.type) {
    case 'single': {
      const a = answer as Extract<Answer, { type: 'single' }>;
      return a.choice !== null && task.options[a.choice]?.correct === true;
    }
    case 'multiple': {
      const a = answer as Extract<Answer, { type: 'multiple' }>;
      const correct = task.options.flatMap((o, i) => (o.correct ? [i] : []));
      return sameSet(a.choices, correct);
    }
    case 'sequence': {
      const a = answer as Extract<Answer, { type: 'sequence' }>;
      return a.order.length === task.items.length && a.order.every((x, i) => x === i);
    }
    case 'matching': {
      const a = answer as Extract<Answer, { type: 'matching' }>;
      return a.rights.length === task.pairs.length && a.rights.every((x, i) => x === i);
    }
    case 'input': {
      const a = answer as Extract<Answer, { type: 'input' }>;
      const value = parseNumber(a.text);
      return value !== null && Math.abs(value - task.answer) < 1e-9;
    }
  }
}

/** Заполнен ли ответ настолько, чтобы его можно было проверять. */
export function isComplete(task: Gradable, answer: Answer): boolean {
  if (task.type !== answer.type) return false;
  switch (answer.type) {
    case 'single':
      return answer.choice !== null;
    case 'multiple':
      return answer.choices.length > 0;
    case 'sequence':
      return task.type === 'sequence' && answer.order.length === task.items.length;
    case 'matching':
      return task.type === 'matching' && answer.rights.length === task.pairs.length && answer.rights.every((x) => x !== null);
    case 'input':
      return parseNumber(answer.text) !== null;
  }
}
