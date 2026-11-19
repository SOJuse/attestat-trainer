import { z } from 'zod';
import { localDate } from './dates';
import { InterviewShape } from './interview';
import { INTERVALS, reviewed, type Srs } from './srs';
import { MODULE_CODES, type TasksPack } from './taskSchema';

/**
 * Данные пользователя: что он решал, когда повторять, история экзаменов, настройки.
 * Всё лежит одним файлом; функции здесь ничего не читают и не пишут, они только
 * возвращают новое состояние.
 */

export const USER_DATA_SCHEMA = 1;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SrsShape = z.object({ box: z.number().int().min(0).max(INTERVALS.length - 1), due: isoDate }).strict();

const Mode = z.enum(['daily', 'training', 'exam', 'case', 'cards']);
export type Mode = z.infer<typeof Mode>;

const Attempt = z
  .object({
    id: z.string(),
    at: z.string(),
    /** местная дата ответа: по ней считаются серия дней и очередь повторений */
    day: isoDate,
    correct: z.boolean(),
    mode: Mode,
    /** ревизия задания, на которую дан ответ */
    revision: z.number().int().positive(),
    /** первый ли это ответ на задание в этой ревизии; прогноз считается по первым ответам */
    first: z.boolean(),
  })
  .strict();
export type Attempt = z.infer<typeof Attempt>;

const Tally = z.object({ total: z.number().int().nonnegative(), correct: z.number().int().nonnegative() }).strict();
const ExamRecord = z
  .object({
    at: z.string(),
    kind: z.enum(['full', 'mini']),
    module: z.enum(MODULE_CODES).optional(),
    total: z.number().int().nonnegative(),
    correct: z.number().int().nonnegative(),
    byModule: z.record(z.string(), Tally),
    passed: z.boolean(),
    packVersion: z.string(),
  })
  .strict();
export type ExamRecord = z.infer<typeof ExamRecord>;

/** Незаконченная сессия или экзамен: состав, ответы и время начала, чтобы продолжить после перезапуска. */
const Draft = z
  .object({
    kind: z.enum(['daily', 'exam', 'mini']),
    module: z.enum(MODULE_CODES).optional(),
    ids: z.array(z.string()),
    /** ответы по номеру задания в составе; null — ещё не отвечено */
    answers: z.array(z.unknown()),
    position: z.number().int().nonnegative(),
    startedAt: z.number(),
    packVersion: z.string(),
  })
  .strict();
export type Draft = z.infer<typeof Draft>;

const Item = z.object({ srs: SrsShape.optional(), revision: z.number().int().positive(), hidden: z.literal(true).optional() }).strict();

const Shape = z
  .object({
    schema: z.literal(USER_DATA_SCHEMA),
    /** задания, шаги кейсов и карточки по id */
    items: z.record(z.string(), Item),
    attempts: z.array(Attempt),
    exams: z.array(ExamRecord),
    settings: z.object({ dailySize: z.number().int().min(5).max(50) }).strict(),
    /** незаконченные сессия и тест живут отдельно: начать одно не значит потерять другое */
    drafts: z.object({ daily: Draft.optional(), exam: Draft.optional() }).strict(),
    /** подготовка к собеседованию: появляется, когда человек что-то в неё записал */
    interview: InterviewShape.optional(),
  })
  .strict();

export type UserData = z.infer<typeof Shape>;

export type UserDataErrorCode = 'not-json' | 'wrong-shape' | 'newer-schema';

/** Файл прогресса не подошёл. По коду интерфейс выбирает, что сказать человеку. */
export class UserDataError extends Error {
  constructor(readonly code: UserDataErrorCode) {
    super(code);
    this.name = 'UserDataError';
  }
}

export function emptyUserData(): UserData {
  return { schema: USER_DATA_SCHEMA, items: {}, attempts: [], exams: [], settings: { dailySize: 20 }, drafts: {} };
}

export function parseUserData(raw: unknown): UserData {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const schema = (raw as { schema?: unknown }).schema;
    if (typeof schema === 'number' && schema > USER_DATA_SCHEMA) throw new UserDataError('newer-schema');
  }
  const parsed = Shape.safeParse(raw);
  if (!parsed.success) throw new UserDataError('wrong-shape');
  return parsed.data;
}

type AnswerInput = { id: string; revision: number; correct: boolean; mode: Mode; now: Date };

/**
 * Состояние после ответа. Попытка записывается всегда. Очередь повторений двигается по обычным
 * правилам, кроме экзамена: там верный ответ ступень не меняет (на экзамене часто угадывают),
 * а неверный возвращает задание на первую ступень.
 */
export function applyAnswer(data: UserData, { id, revision, correct, mode, now }: AnswerInput): UserData {
  const today = localDate(now);
  const prev = data.items[id];
  const sameRevision = prev?.revision === revision;
  const first = !data.attempts.some((a) => a.id === id && a.revision === revision);
  const prevSrs = sameRevision ? prev?.srs : undefined;
  const srs: Srs | undefined = mode === 'exam' && correct ? prevSrs : reviewed(prevSrs, correct, today);

  const item: UserData['items'][string] = { revision };
  if (srs) item.srs = srs;
  if (prev?.hidden) item.hidden = true;

  return {
    ...data,
    items: { ...data.items, [id]: item },
    attempts: [...data.attempts, { id, at: now.toISOString(), day: today, correct, mode, revision, first }],
  };
}

export type DraftSlot = 'daily' | 'exam';

/** Есть ли незаконченная сессия или тест. Пока они есть, базу заданий не меняют. */
export function hasDraft(data: UserData): boolean {
  return Boolean(data.drafts.daily || data.drafts.exam);
}

/**
 * Черновик под новую базу: задания, которых в базе больше нет, выпадают вместе со своими ответами.
 * Если не осталось ничего, черновика нет.
 */
function fitDraft(draft: Draft, known: Set<string>): Draft | undefined {
  if (draft.ids.every((id) => known.has(id))) return draft;
  const keep = draft.ids.map((id) => known.has(id));
  const ids = draft.ids.filter((_, i) => keep[i]);
  if (ids.length === 0) return undefined;
  // у теста ответы стоят по номерам заданий; у сессии это просто список результатов
  const answers = draft.kind === 'daily' ? draft.answers : draft.answers.filter((_, i) => keep[i]);
  const position = keep.slice(0, draft.position).filter(Boolean).length;
  return { ...draft, ids, answers, position };
}

/**
 * Сверяет прогресс с новой базой. Если у задания выросла ревизия, его содержание изменилось:
 * очередь повторений и пометка «скрыто» снимаются, история попыток остаётся. Задания, которых
 * в базе больше нет, не трогаются: их история может понадобиться, если задание вернётся.
 */
export function reconcile(data: UserData, pack: TasksPack): UserData {
  const revisions = new Map<string, number>();
  for (const t of pack.tasks) revisions.set(t.id, t.revision);
  for (const c of pack.cases) c.steps?.forEach((_, i) => revisions.set(`${c.id}#${i + 1}`, c.revision));
  for (const c of pack.cards) revisions.set(c.id, c.revision);

  let changed = false;
  const known = new Set(pack.tasks.map((t) => t.id));
  const drafts: UserData['drafts'] = {};
  for (const slot of ['daily', 'exam'] as const) {
    const draft = data.drafts[slot];
    if (!draft) continue;
    const fitted = fitDraft(draft, known);
    if (fitted) drafts[slot] = fitted;
    if (fitted !== draft) changed = true;
  }
  const items = { ...data.items };
  for (const [id, item] of Object.entries(data.items)) {
    const revision = revisions.get(id);
    if (revision !== undefined && revision > item.revision) {
      items[id] = { revision };
      changed = true;
    }
  }
  return changed ? { ...data, items, drafts } : data;
}

export function setHidden(data: UserData, id: string, hidden: boolean): UserData {
  const prev = data.items[id] ?? { revision: 1 };
  const item = { ...prev };
  if (hidden) item.hidden = true;
  else delete item.hidden;
  return { ...data, items: { ...data.items, [id]: item } };
}

/** Текст файла для переноса на другой компьютер. */
export function exportUserData(data: UserData, now: Date): string {
  return JSON.stringify({ ...data, exportedAt: now.toISOString() }, null, 2);
}

export function importUserData(text: string): UserData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UserDataError('not-json');
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const rest = { ...(raw as Record<string, unknown>) };
    delete rest.exportedAt;
    return parseUserData(rest);
  }
  return parseUserData(raw);
}
