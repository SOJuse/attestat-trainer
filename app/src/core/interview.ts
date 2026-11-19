import { z } from 'zod';
import { INTERVALS, isDue, reviewed, type Srs } from './srs';

/**
 * Подготовка к собеседованию с аттестационной комиссией: значения показателей своей школы
 * и собственные вопросы с тезисами ответов. Всё это вводит сам человек, в базе заданий этого нет.
 * Функции ничего не читают и не пишут, они только возвращают новое состояние.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SrsShape = z.object({ box: z.number().int().min(0).max(INTERVALS.length - 1), due: isoDate }).strict();

const IndicatorNote = z.object({ value: z.string(), note: z.string(), srs: SrsShape.optional() }).strict();
const Question = z
  .object({
    id: z.string(),
    text: z.string(),
    /** тезисы ответа */
    theses: z.string(),
    /** откуда вопрос: трансляция, коллега */
    source: z.string(),
    created: isoDate,
    srs: SrsShape.optional(),
  })
  .strict();

export const InterviewShape = z
  .object({
    /** по номеру показателя из перечня */
    indicators: z.record(z.string(), IndicatorNote),
    questions: z.array(Question),
  })
  .strict();

export type Interview = z.infer<typeof InterviewShape>;
export type InterviewQuestion = z.infer<typeof Question>;
export type IndicatorNote = z.infer<typeof IndicatorNote>;

export function emptyInterview(): Interview {
  return { indicators: {}, questions: [] };
}

/** Записывает значение и заметку к показателю. Пустая запись удаляется. */
export function setIndicator(data: Interview, id: string, value: string, note: string): Interview {
  const prev = data.indicators[id];
  const v = value.trim();
  const n = note.trim();
  if ((prev?.value ?? '') === v && (prev?.note ?? '') === n) return data;
  const indicators = { ...data.indicators };
  if (!v && !n) delete indicators[id];
  // очередь повторений сохраняется: человек уточнил ответ, а не начал заново
  else indicators[id] = prev?.srs ? { value: v, note: n, srs: prev.srs } : { value: v, note: n };
  return { ...data, indicators };
}

type QuestionInput = { text: string; theses: string; source: string };

function nextQuestionId(data: Interview): string {
  const max = data.questions.reduce((m, q) => Math.max(m, Number(q.id.slice(1)) || 0), 0);
  return `q${max + 1}`;
}

/** Добавляет вопрос. Без текста вопроса ничего не меняется. */
export function addQuestion(data: Interview, input: QuestionInput, today: string): Interview {
  const text = input.text.trim();
  if (!text) return data;
  const question: InterviewQuestion = {
    id: nextQuestionId(data),
    text,
    theses: input.theses.trim(),
    source: input.source.trim(),
    created: today,
  };
  return { ...data, questions: [...data.questions, question] };
}

export function editQuestion(data: Interview, id: string, input: QuestionInput): Interview {
  const text = input.text.trim();
  if (!text) return data;
  return {
    ...data,
    questions: data.questions.map((q) => (q.id === id ? { ...q, text, theses: input.theses.trim(), source: input.source.trim() } : q)),
  };
}

export function removeQuestion(data: Interview, id: string): Interview {
  return { ...data, questions: data.questions.filter((q) => q.id !== id) };
}

/** Что тренируется вслух: свой вопрос или показатель, по которому уже есть что сказать. */
export type PracticeRef = { kind: 'question' | 'indicator'; id: string };

function srsOf(data: Interview, ref: PracticeRef): Srs | undefined {
  return ref.kind === 'question' ? data.questions.find((q) => q.id === ref.id)?.srs : data.indicators[ref.id]?.srs;
}

/** Оценка своего ответа: уверенный ответ отодвигает повторение, неуверенный возвращает на завтра. */
export function ratePractice(data: Interview, ref: PracticeRef, confident: boolean, today: string): Interview {
  const srs = reviewed(srsOf(data, ref), confident, today);
  if (ref.kind === 'question') {
    return { ...data, questions: data.questions.map((q) => (q.id === ref.id ? { ...q, srs } : q)) };
  }
  const prev = data.indicators[ref.id];
  if (!prev) return data;
  return { ...data, indicators: { ...data.indicators, [ref.id]: { ...prev, srs } } };
}

export type PracticePool = {
  /** пора повторить, самые давние первыми */
  due: PracticeRef[];
  /** ещё ни разу не отвечали */
  fresh: PracticeRef[];
  /** всё, что вообще можно тренировать */
  all: PracticeRef[];
};

/** Показатели идут в порядке перечня: `order` — номера показателей как в распоряжении. */
export function practicePool(data: Interview, today: string, order: string[]): PracticePool {
  const all: PracticeRef[] = [
    ...data.questions.map((q) => ({ kind: 'question' as const, id: q.id })),
    ...order.filter((id) => data.indicators[id]).map((id) => ({ kind: 'indicator' as const, id })),
  ];
  const due = all
    .filter((r) => isDue(srsOf(data, r), today))
    .sort((a, b) => srsOf(data, a)!.due.localeCompare(srsOf(data, b)!.due));
  const fresh = all.filter((r) => !srsOf(data, r));
  return { due, fresh, all };
}
