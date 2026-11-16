import { z } from 'zod';

/**
 * Формат заданий, кейсов, карточек и базы целиком.
 * Одна схема на всех: по ней сборщик проверяет исходники в content/, а программа — базу при загрузке.
 */

export const MODULE_CODES = ['K', 'R', 'P', 'Rez', 'I'] as const;
export const ModuleCode = z.enum(MODULE_CODES);
export type ModuleCode = z.infer<typeof ModuleCode>;

/** Версия схемы базы, которую понимает эта программа. */
export const TASKS_SCHEMA = 1;

const text = z.string().trim().min(1);
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const TaskRef = z
  .object({
    doc: slug,
    anchor: text,
    /** дословная цитата нормы: сборщик ищет её в тексте раздела */
    quote: text,
    /** страница скана, по которой цитата сверена; обязательна для распознанных документов */
    scan_page: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type TaskRef = z.infer<typeof TaskRef>;

const Option = z.object({ text, correct: z.boolean(), why: text }).strict();

/** Ловушка допустима только в формулировке; варианты на устаревших редакциях запрещены. */
const Trap = z.object({ kind: z.literal('wording'), note: text }).strict();

const common = {
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  question: text,
  explanation: text,
  refs: z.array(TaskRef).min(1),
  trap: Trap.optional(),
};

const options = z.array(Option).min(3).max(6);
const correctCount = (list: { correct: boolean }[]) => list.filter((o) => o.correct).length;

const bodies = {
  single: {
    type: z.literal('single'),
    options: options.refine((o) => correctCount(o) === 1, 'у single ровно один верный вариант'),
  },
  multiple: {
    type: z.literal('multiple'),
    options: options.refine(
      (o) => correctCount(o) >= 2 && correctCount(o) < o.length,
      'у multiple от двух верных вариантов, но не все',
    ),
  },
  sequence: { type: z.literal('sequence'), items: z.array(text).min(3).max(7) },
  matching: {
    type: z.literal('matching'),
    pairs: z
      .array(z.object({ left: text, right: text }).strict())
      .min(3)
      .max(6)
      .refine((p) => new Set(p.map((x) => x.right)).size === p.length, 'правые части пар не должны повторяться')
      .refine((p) => new Set(p.map((x) => x.left)).size === p.length, 'левые части пар не должны повторяться'),
  },
  input: { type: z.literal('input'), answer: z.number().finite(), unit: text.optional() },
} as const;

const taskFields = {
  id: z.string().regex(/^(K|R|P|Rez|I)-[a-z0-9]+(-[a-z0-9]+)*-\d{3}$/),
  situation: text,
  revision: z.number().int().positive(),
  checked: isoDate,
  ...common,
};

export const Task = z.discriminatedUnion('type', [
  z.object({ ...taskFields, ...bodies.single }).strict(),
  z.object({ ...taskFields, ...bodies.multiple }).strict(),
  z.object({ ...taskFields, ...bodies.sequence }).strict(),
  z.object({ ...taskFields, ...bodies.matching }).strict(),
  z.object({ ...taskFields, ...bodies.input }).strict(),
]);
export type Task = z.infer<typeof Task>;

/** Шаг кейса: то же задание, но вместо ситуации — что в ней изменилось. */
const stepFields = { change: z.string().trim(), ...common };
export const CaseStep = z.discriminatedUnion('type', [
  z.object({ ...stepFields, ...bodies.single }).strict(),
  z.object({ ...stepFields, ...bodies.multiple }).strict(),
  z.object({ ...stepFields, ...bodies.sequence }).strict(),
  z.object({ ...stepFields, ...bodies.matching }).strict(),
  z.object({ ...stepFields, ...bodies.input }).strict(),
]);
export type CaseStep = z.infer<typeof CaseStep>;

export const CaseChain = z
  .object({
    id: z.string().regex(/^(K|R|P|Rez|I)-case-\d{3}$/),
    topic: slug,
    title: text,
    intro: text,
    steps: z
      .array(CaseStep)
      .min(3)
      .max(5)
      .refine((steps) => steps.slice(1).every((s) => s.change.length > 0), 'у шагов после первого нужно поле change'),
    revision: z.number().int().positive().default(1),
    checked: isoDate.optional(),
  })
  .strict();
export type CaseChain = z.infer<typeof CaseChain>;

export const Card = z
  .object({
    id: z.string().regex(/^(K|R|P|Rez|I)-card-\d{3}$/),
    topic: slug,
    front: text,
    back: text,
    refs: z.array(TaskRef).min(1),
    revision: z.number().int().positive().default(1),
  })
  .strict();
export type Card = z.infer<typeof Card>;

const place = { module: ModuleCode, topic: slug };
const placed = <T extends z.ZodTypeAny>(schema: T) => z.intersection(schema, z.object(place));

export const PlacedTask = placed(Task);
export type PlacedTask = Task & { module: ModuleCode; topic: string };
export const PlacedCase = z.intersection(CaseChain, z.object({ module: ModuleCode }));
export type PlacedCase = CaseChain & { module: ModuleCode };
export const PlacedCard = z.intersection(Card, z.object({ module: ModuleCode }));
export type PlacedCard = Card & { module: ModuleCode };

const ModuleInfo = z
  .object({
    title: text,
    ready: z.boolean(),
    topics: z.array(z.object({ id: slug, title: text }).strict()),
  })
  .strict();

const Envelope = z.object({
  schemaVersion: z.literal(TASKS_SCHEMA),
  packVersion: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d+$/),
  /** пробная база: мини-тесты открыты на тех заданиях, что есть; экзамен и прогноз закрыты */
  pilot: z.boolean(),
  modules: z.object({ K: ModuleInfo, R: ModuleInfo, P: ModuleInfo, Rez: ModuleInfo, I: ModuleInfo }).strict(),
  tasks: z.array(z.unknown()),
  cases: z.array(z.unknown()),
  cards: z.array(z.unknown()),
});

export type TasksPack = Omit<z.infer<typeof Envelope>, 'tasks' | 'cases' | 'cards'> & {
  tasks: PlacedTask[];
  cases: PlacedCase[];
  cards: PlacedCard[];
};

function keepValid<T>(items: unknown[], schema: z.ZodTypeAny, skipped: string[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      out.push(parsed.data as T);
    } else {
      const id = typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : undefined;
      skipped.push(typeof id === 'string' ? id : '(без id)');
    }
  }
  return out;
}

/**
 * Разбирает базу. Отдельное задание, кейс или карточка, которые не прошли схему, пропускаются:
 * одна ошибка в базе не должна оставлять человека без тренажёра. Их id возвращаются в `skipped`.
 * Если не разбирается сам конверт базы, бросает ошибку.
 */
export function parseTasksPack(raw: unknown): { pack: TasksPack; skipped: string[] } {
  const envelope = Envelope.parse(raw);
  const skipped: string[] = [];
  const pack: TasksPack = {
    ...envelope,
    tasks: keepValid<PlacedTask>(envelope.tasks, PlacedTask, skipped),
    cases: keepValid<PlacedCase>(envelope.cases, PlacedCase, skipped),
    cards: keepValid<PlacedCard>(envelope.cards, PlacedCard, skipped),
  };
  return { pack, skipped };
}
