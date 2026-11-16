import { describe, expect, it } from 'vitest';
import {
  applyAnswer,
  emptyUserData,
  exportUserData,
  importUserData,
  parseUserData,
  reconcile,
  setHidden,
  UserDataError,
  type UserData,
} from './progress';
import type { TasksPack } from './taskSchema';

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
      { id: 'K-otpuska-001', at: NOW.toISOString(), day: '2026-11-16', correct: true, mode: 'daily', first: true },
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
