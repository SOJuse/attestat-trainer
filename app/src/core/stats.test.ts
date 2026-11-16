import { describe, expect, it } from 'vitest';
import { applyAnswer, emptyUserData, type UserData } from './progress';
import { streak, topicStats } from './stats';
import { makePack } from './testPack';

const answer = (d: UserData, id: string, correct: boolean, day: string) =>
  applyAnswer(d, { id, revision: 1, correct, mode: 'daily', now: new Date(`${day}T10:00:00`) });

describe('topicStats', () => {
  const pack = makePack(12);

  it('без ответов точности нет и слабых тем нет', () => {
    const stats = topicStats(pack, emptyUserData());
    expect(stats).toHaveLength(10);
    expect(stats[0]).toEqual({ module: 'K', topic: 'a', title: 'K: тема А', answered: 0, accuracy: null, seen: 0, total: 6, weak: false });
  });

  it('считает точность по последнему ответу на каждое задание и число пройденных', () => {
    let d = emptyUserData();
    d = answer(d, 'K-a-001', false, '2026-11-10');
    d = answer(d, 'K-a-001', true, '2026-11-11');
    d = answer(d, 'K-a-003', false, '2026-11-11');
    const s = topicStats(pack, d).find((x) => x.module === 'K' && x.topic === 'a')!;
    expect(s.seen).toBe(2);
    expect(s.answered).toBe(3);
    expect(s.accuracy).toBe(0.5);
    expect(s.weak).toBe(false); // ответов меньше пяти
  });

  it('тема слабая при точности ниже 60% и не менее пяти ответах', () => {
    let d = emptyUserData();
    for (const id of ['K-a-001', 'K-a-003', 'K-a-005']) d = answer(d, id, false, '2026-11-10');
    for (const id of ['K-a-007', 'K-a-009']) d = answer(d, id, true, '2026-11-10');
    expect(topicStats(pack, d).find((x) => x.module === 'K' && x.topic === 'a')!.weak).toBe(true);
    d = answer(d, 'K-a-001', true, '2026-11-11'); // теперь 3 из 5 верны
    expect(topicStats(pack, d).find((x) => x.module === 'K' && x.topic === 'a')!.weak).toBe(false);
  });

  it('ответы на задания, которых нет в базе, не учитываются', () => {
    const d = answer(emptyUserData(), 'K-a-999', false, '2026-11-10');
    expect(topicStats(pack, d).every((s) => s.answered === 0)).toBe(true);
  });
});

describe('streak', () => {
  const days = (...list: string[]) => list.reduce((d, day) => answer(d, 'K-a-001', true, day), emptyUserData());

  it('без ответов серия нулевая', () => {
    expect(streak(emptyUserData(), '2026-11-16')).toBe(0);
  });

  it('считает дни подряд, заканчивая сегодня', () => {
    expect(streak(days('2026-11-14', '2026-11-15', '2026-11-16'), '2026-11-16')).toBe(3);
  });

  it('несколько ответов в один день — один день серии', () => {
    expect(streak(days('2026-11-16', '2026-11-16'), '2026-11-16')).toBe(1);
  });

  it('если сегодня ещё не занимались, серия держится до конца дня', () => {
    expect(streak(days('2026-11-14', '2026-11-15'), '2026-11-16')).toBe(2);
  });

  it('пропущенный день обрывает серию', () => {
    expect(streak(days('2026-11-12', '2026-11-13', '2026-11-15', '2026-11-16'), '2026-11-16')).toBe(2);
    expect(streak(days('2026-11-10'), '2026-11-16')).toBe(0);
  });

  it('ответы «из будущего» после перевода часов назад серию не ломают', () => {
    expect(streak(days('2026-11-15', '2026-11-16', '2026-11-20'), '2026-11-16')).toBe(2);
  });
});
