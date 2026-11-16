import { describe, expect, it } from 'vitest';
import { applyAnswer, emptyUserData, setHidden, type UserData } from './progress';
import { dailySession, trainingSet } from './session';
import { makePack, seeded } from './testPack';

const at = (day: string) => new Date(`${day}T10:00:00`);
const answer = (d: UserData, id: string, correct: boolean, day: string) =>
  applyAnswer(d, { id, revision: 1, correct, mode: 'daily', now: at(day) });

describe('dailySession', () => {
  const pack = makePack(6); // 30 заданий

  it('в пустой базе сессия пустая', () => {
    const empty = makePack(0);
    expect(dailySession({ pack: empty, data: emptyUserData(), today: '2026-11-16', size: 20, random: seeded() })).toEqual([]);
  });

  it('для новичка берёт новые задания, не больше размера и без повторов', () => {
    const ids = dailySession({ pack, data: emptyUserData(), today: '2026-11-16', size: 20, random: seeded() });
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('если заданий меньше размера, отдаёт все', () => {
    const ids = dailySession({ pack: makePack(2), data: emptyUserData(), today: '2026-11-16', size: 20, random: seeded() });
    expect(ids).toHaveLength(10);
  });

  it('сначала идёт то, что пора повторить, самое просроченное первым', () => {
    let d = emptyUserData();
    d = answer(d, 'K-a-001', true, '2026-11-10'); // к повторению 11-11
    d = answer(d, 'R-a-001', true, '2026-11-14'); // к повторению 11-15
    d = answer(d, 'P-a-001', true, '2026-11-16'); // к повторению 11-17: ещё не пора
    const ids = dailySession({ pack, data: d, today: '2026-11-16', size: 5, random: seeded() });
    expect(ids.slice(0, 2)).toEqual(['K-a-001', 'R-a-001']);
    expect(ids).not.toContain('P-a-001');
    expect(ids).toHaveLength(5);
  });

  it('когда повторений больше размера, новых не добавляет', () => {
    let d = emptyUserData();
    for (const t of pack.tasks.slice(0, 8)) d = answer(d, t.id, false, '2026-11-10');
    const ids = dailySession({ pack, data: d, today: '2026-11-16', size: 5, random: seeded() });
    expect(ids).toHaveLength(5);
    expect(ids.every((id) => pack.tasks.slice(0, 8).some((t) => t.id === id))).toBe(true);
  });

  it('скрытые задания не попадают ни в повторения, ни в новые', () => {
    let d = answer(emptyUserData(), 'K-a-001', false, '2026-11-10');
    d = setHidden(d, 'K-a-001', true);
    d = setHidden(d, 'K-b-002', true);
    const ids = dailySession({ pack, data: d, today: '2026-11-16', size: 30, random: seeded() });
    expect(ids).not.toContain('K-a-001');
    expect(ids).not.toContain('K-b-002');
    expect(ids).toHaveLength(28);
  });

  it('слабая тема среди новых встречается чаще', () => {
    // тема K/a: пять ответов, все неверные → слабая
    let d = emptyUserData();
    const big = makePack(40);
    for (const t of big.tasks.filter((x) => x.module === 'K' && x.topic === 'a').slice(0, 5)) {
      d = answer(d, t.id, false, '2026-11-16');
    }
    let weak = 0;
    let other = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const ids = dailySession({ pack: big, data: d, today: '2026-11-16', size: 10, random: seeded(seed) });
      weak += ids.filter((id) => id.startsWith('K-a-')).length;
      other += ids.filter((id) => id.startsWith('R-a-')).length;
    }
    // в теме K/a осталось 15 новых заданий с двойным весом против 20 в R/a: ожидаемое отношение 1,5
    expect(weak).toBeGreaterThan(other * 1.25);
  });
});

describe('trainingSet', () => {
  const pack = makePack(6);

  it('без фильтра отдаёт все задания, кроме скрытых', () => {
    const d = setHidden(emptyUserData(), 'K-a-001', true);
    expect(trainingSet({ pack, data: d, filter: {} })).toHaveLength(29);
  });

  it('фильтрует по модулю, теме, сложности и типу', () => {
    expect(trainingSet({ pack, data: emptyUserData(), filter: { module: 'K' } })).toHaveLength(6);
    expect(trainingSet({ pack, data: emptyUserData(), filter: { module: 'K', topic: 'a' } })).toEqual([
      'K-a-001',
      'K-a-003',
      'K-a-005',
    ]);
    expect(trainingSet({ pack, data: emptyUserData(), filter: { difficulty: 1 } })).toHaveLength(10);
    expect(trainingSet({ pack, data: emptyUserData(), filter: { type: 'input' } })).toEqual([]);
  });

  it('«только ошибки» — задания, последний ответ на которые неверный', () => {
    let d = emptyUserData();
    d = answer(d, 'K-a-001', false, '2026-11-10');
    d = answer(d, 'K-a-001', true, '2026-11-11'); // исправил
    d = answer(d, 'K-b-002', true, '2026-11-10');
    d = answer(d, 'K-b-002', false, '2026-11-11'); // ошибся позже
    expect(trainingSet({ pack, data: d, filter: { onlyErrors: true } })).toEqual(['K-b-002']);
  });
});
