import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  emptyUserData,
  exportUserData,
  hasDraft,
  importUserData,
  parseUserData,
  reconcile,
  setHidden,
  UserDataError,
  type UserData,
} from './progress';
import type { TasksPack } from './taskSchema';
import { makePack } from './testPack';

const NOW = new Date(2026, 10, 16, 10, 0, 0);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof UserDataError ? e.code : `не UserDataError: ${e}`;
  }
  return 'не бросил';
};

describe('parseUserData', () => {
  it('пустые данные проходят туда и обратно', () => {
    expect(parseUserData(JSON.parse(JSON.stringify(emptyUserData())))).toEqual(emptyUserData());
    expect(emptyUserData().settings.dailySize).toBe(20);
  });

  it.each([
    ['null', null, 'wrong-shape'],
    ['массив', [], 'wrong-shape'],
    ['строка', 'привет', 'wrong-shape'],
    ['объект без items', { schema: 1 }, 'wrong-shape'],
    ['попытки не массив', { ...emptyUserData(), attempts: {} }, 'wrong-shape'],
    ['схема новее', { ...emptyUserData(), schema: 2 }, 'newer-schema'],
    ['ступень вне диапазона', { ...emptyUserData(), items: { a: { revision: 1, srs: { box: 9, due: '2026-11-16' } } } }, 'wrong-shape'],
  ])('отвергает: %s', (_, raw, expected) => {
    expect(code(() => parseUserData(raw))).toBe(expected);
  });
});

describe('applyAnswer', () => {
  const answer = (data: UserData, correct: boolean, mode: 'daily' | 'exam' = 'daily', now = NOW) =>
    applyAnswer(data, { id: 'K-otpuska-001', revision: 1, correct, mode, now });

  it('записывает попытку и ставит задание в очередь повторений', () => {
    const d = answer(emptyUserData(), true);
    expect(d.attempts).toEqual([
      { id: 'K-otpuska-001', at: NOW.toISOString(), day: '2026-11-16', correct: true, mode: 'daily', revision: 1, first: true },
    ]);
    expect(d.items['K-otpuska-001']).toEqual({ revision: 1, srs: { box: 0, due: '2026-11-17' } });
  });

  it('второй ответ на ту же ревизию уже не первый', () => {
    const d = answer(answer(emptyUserData(), false), true);
    expect(d.attempts.map((a) => a.first)).toEqual([true, false]);
  });

  it('после новой ревизии ответ снова первый', () => {
    const d1 = answer(emptyUserData(), true);
    const d2 = applyAnswer(d1, { id: 'K-otpuska-001', revision: 2, correct: true, mode: 'daily', now: NOW });
    expect(d2.attempts[1].first).toBe(true);
    expect(d2.items['K-otpuska-001'].revision).toBe(2);
  });

  it('не меняет переданные данные', () => {
    const before = emptyUserData();
    const frozen = JSON.stringify(before);
    answer(before, true);
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('верный ответ на экзамене ступень не двигает, неверный сбрасывает', () => {
    const learned = answer(answer(emptyUserData(), true), true); // box 1
    expect(learned.items['K-otpuska-001'].srs?.box).toBe(1);
    const right = answer(learned, true, 'exam');
    expect(right.items['K-otpuska-001'].srs).toEqual(learned.items['K-otpuska-001'].srs);
    expect(right.attempts).toHaveLength(3);
    const wrong = answer(learned, false, 'exam');
    expect(wrong.items['K-otpuska-001'].srs).toEqual({ box: 0, due: '2026-11-17' });
  });

  it('скрытое задание остаётся скрытым после ответа', () => {
    const d = answer(setHidden(emptyUserData(), 'K-otpuska-001', true), true);
    expect(d.items['K-otpuska-001'].hidden).toBe(true);
  });
});

describe('reconcile', () => {
  const pack = (revision: number, withTask = true) =>
    ({
      tasks: withTask ? [{ id: 'K-otpuska-001', revision }] : [],
      cases: [],
      cards: [{ id: 'K-card-001', revision: 1 }],
    }) as unknown as TasksPack;
  const learned = applyAnswer(emptyUserData(), { id: 'K-otpuska-001', revision: 1, correct: true, mode: 'daily', now: NOW });

  it('та же ревизия — без изменений', () => {
    expect(reconcile(learned, pack(1))).toEqual(learned);
  });

  it('ревизия выросла — очередь повторений сброшена, попытки остались', () => {
    const d = reconcile(learned, pack(2));
    expect(d.items['K-otpuska-001']).toEqual({ revision: 2 });
    expect(d.attempts).toEqual(learned.attempts);
  });

  it('задание исчезло из базы — запись и попытки остаются', () => {
    expect(reconcile(learned, pack(1, false))).toEqual(learned);
  });

  it('скрытое задание после новой ревизии снова показывается', () => {
    const hidden = setHidden(learned, 'K-otpuska-001', true);
    expect(reconcile(hidden, pack(2)).items['K-otpuska-001'].hidden).toBeUndefined();
  });
});

describe('перенос файлом', () => {
  it('экспорт и импорт возвращают те же данные', () => {
    const d = applyAnswer(emptyUserData(), { id: 'K-otpuska-001', revision: 1, correct: false, mode: 'training', now: NOW });
    const text = exportUserData(d, NOW);
    expect(JSON.parse(text).exportedAt).toBe(NOW.toISOString());
    expect(importUserData(text)).toEqual(d);
  });

  it.each([
    ['не JSON', 'это не файл прогресса', 'not-json'],
    ['чужой JSON', '{"name":"package"}', 'wrong-shape'],
    ['пустой файл', '', 'not-json'],
  ])('отказ: %s', (_, text, expected) => {
    expect(code(() => importUserData(text))).toBe(expected);
  });
});

describe('черновики и новая база', () => {
  const pack = makePack(1);
  const ids = pack.tasks.slice(0, 4).map((t) => t.id);
  const exam = { kind: 'mini' as const, module: 'K' as const, ids, answers: ['a', 'b', null, 'd'], position: 3, startedAt: 1, packVersion: 'x' };
  const daily = { kind: 'daily' as const, ids, answers: [true, false], position: 2, startedAt: 1, packVersion: 'x' };
  const without = (id: string) => ({ ...pack, tasks: pack.tasks.filter((t) => t.id !== id) });

  it('сессия и тест хранятся отдельно', () => {
    const data = { ...emptyUserData(), drafts: { daily, exam } };
    expect(parseUserData(JSON.parse(JSON.stringify(data))).drafts).toEqual({ daily, exam });
    expect(hasDraft(data)).toBe(true);
    expect(hasDraft(emptyUserData())).toBe(false);
  });

  it('если база не менялась, черновики остаются теми же', () => {
    const data = { ...emptyUserData(), drafts: { daily, exam } };
    expect(reconcile(data, pack)).toBe(data);
  });

  it('пропавшее задание выпадает из теста вместе со своим ответом', () => {
    const data = reconcile({ ...emptyUserData(), drafts: { exam } }, without(ids[1]));
    expect(data.drafts.exam).toMatchObject({ ids: [ids[0], ids[2], ids[3]], answers: ['a', null, 'd'], position: 2 });
  });

  it('в сессии место сдвигается, если пропало уже пройденное задание', () => {
    const data = reconcile({ ...emptyUserData(), drafts: { daily } }, without(ids[0]));
    expect(data.drafts.daily).toMatchObject({ ids: ids.slice(1), position: 1 });
  });

  it('черновик без единого задания снимается', () => {
    const data = reconcile({ ...emptyUserData(), drafts: { exam } }, { ...pack, tasks: [] });
    expect(data.drafts).toEqual({});
  });
});

describe('первый ответ после обновления задания', () => {
  it('считается первым и после сверки с базой', () => {
    const pack = makePack(1);
    const id = pack.tasks[0].id;
    const before = applyAnswer(emptyUserData(), { id, revision: 1, correct: false, mode: 'daily', now: NOW });
    const newer = { ...pack, tasks: pack.tasks.map((t) => (t.id === id ? { ...t, revision: 2 } : t)) };
    const after = applyAnswer(reconcile(before, newer), { id, revision: 2, correct: true, mode: 'daily', now: NOW });
    expect(after.attempts.map((a) => [a.revision, a.first])).toEqual([
      [1, true],
      [2, true],
    ]);
  });
});
