import { describe, expect, it } from 'vitest';
import { buildExam, buildMiniTest, remainingSeconds, scoreExam } from './exam';
import { EXAM, MINI } from './examConfig';
import { moduleEstimate, passProbability } from './forecast';
import type { Answer } from './grade';
import { applyAnswer, emptyUserData, type UserData } from './progress';
import { MODULE_CODES } from './taskSchema';
import { makePack, makeTask, seeded } from './testPack';

const right: Answer = { type: 'single', choice: 0 };
const wrong: Answer = { type: 'single', choice: 1 };

describe('правила экзамена', () => {
  it('40 заданий, 60 минут, по 8 на модуль, пороги 70% и 50%', () => {
    expect(EXAM).toEqual({ perModule: 8, total: 40, seconds: 3600, passTotal: 0.7, passModule: 0.5 });
    expect(MINI).toEqual({ tasks: 8, seconds: 720, pass: 0.5, pilotMinimum: 3 });
  });
});

describe('buildExam', () => {
  it('берёт по 8 заданий из каждого модуля', () => {
    const pack = makePack(20);
    const ids = buildExam({ pack, data: emptyUserData(), random: seeded() })!;
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
    for (const m of MODULE_CODES) expect(ids.filter((id) => id.startsWith(`${m}-`))).toHaveLength(8);
  });

  it('закрыт для пробной базы, для неготового модуля и при нехватке заданий', () => {
    const args = { data: emptyUserData(), random: seeded() };
    expect(buildExam({ pack: makePack(20, { pilot: true }), ...args })).toBeNull();
    const notReady = makePack(20);
    notReady.modules.Rez.ready = false;
    expect(buildExam({ pack: notReady, ...args })).toBeNull();
    expect(buildExam({ pack: makePack(7), ...args })).toBeNull();
  });

  it('скрытые задания в экзамен не идут; давно не встречавшиеся идут первыми', () => {
    const pack = makePack(9);
    let data: UserData = { ...emptyUserData(), items: { 'K-a-001': { revision: 1, hidden: true } } };
    // на все задания модуля R, кроме одного, отвечали сегодня: неотвеченное должно попасть в экзамен
    for (const t of pack.tasks.filter((x) => x.module === 'R' && x.id !== 'R-a-009')) {
      data = applyAnswer(data, { id: t.id, revision: 1, correct: true, mode: 'daily', now: new Date(2026, 10, 16) });
    }
    for (let seed = 1; seed <= 20; seed++) {
      const ids = buildExam({ pack, data, random: seeded(seed) })!;
      expect(ids).not.toContain('K-a-001');
      expect(ids).toContain('R-a-009');
    }
  });

  it('задания внутри модуля берутся из разных тем', () => {
    const ids = buildExam({ pack: makePack(40), data: emptyUserData(), random: seeded(3) })!;
    const k = ids.filter((id) => id.startsWith('K-'));
    expect(k.filter((id) => id.startsWith('K-a-'))).toHaveLength(4);
    expect(k.filter((id) => id.startsWith('K-b-'))).toHaveLength(4);
  });
});

describe('buildMiniTest', () => {
  it('8 заданий одного модуля', () => {
    const ids = buildMiniTest({ pack: makePack(20), data: emptyUserData(), module: 'P', random: seeded() })!;
    expect(ids).toHaveLength(8);
    expect(ids.every((id) => id.startsWith('P-'))).toBe(true);
  });

  it('в полной базе закрыт, если модуль не готов или заданий меньше 8', () => {
    const args = { data: emptyUserData(), module: 'P' as const, random: seeded() };
    expect(buildMiniTest({ pack: makePack(7), ...args })).toBeNull();
    const notReady = makePack(20);
    notReady.modules.P.ready = false;
    expect(buildMiniTest({ pack: notReady, ...args })).toBeNull();
  });

  it('в пробной базе берёт сколько есть, но не меньше трёх', () => {
    const args = { data: emptyUserData(), module: 'P' as const, random: seeded() };
    expect(buildMiniTest({ pack: makePack(5, { pilot: true }), ...args })).toHaveLength(5);
    expect(buildMiniTest({ pack: makePack(2, { pilot: true }), ...args })).toBeNull();
  });
});

describe('scoreExam', () => {
  // rights[m] — сколько верных ответов из 8 в модуле m
  const score = (rights: number[]) => {
    const tasks = MODULE_CODES.flatMap((m) => Array.from({ length: 8 }, (_, i) => makeTask(m, 'a', i + 1)));
    const answers = MODULE_CODES.flatMap((_, mi) => Array.from({ length: 8 }, (_, i) => (i < rights[mi] ? right : wrong)));
    return scoreExam(tasks, answers, 'full');
  };

  it('28 из 40 при не менее 4 в каждом модуле — зачёт', () => {
    const r = score([8, 8, 4, 4, 4]);
    expect([r.correct, r.total, r.passed]).toEqual([28, 40, true]);
    expect(r.byModule.P).toEqual({ total: 8, correct: 4 });
    expect(r.failed).toEqual([]);
  });

  it('28 из 40, но 3 в одном модуле — незачёт с указанием модуля', () => {
    const r = score([8, 8, 5, 4, 3]);
    expect(r.passed).toBe(false);
    expect(r.failed).toEqual([{ rule: 'module', module: 'I' }]);
  });

  it('27 из 40 — незачёт по общему порогу', () => {
    const r = score([7, 6, 5, 5, 4]);
    expect(r.passed).toBe(false);
    expect(r.failed).toEqual([{ rule: 'total' }]);
  });

  it('пропущенный ответ считается неверным', () => {
    const tasks = [makeTask('K', 'a', 1), makeTask('K', 'a', 2)];
    expect(scoreExam(tasks, [right, undefined], 'mini').correct).toBe(1);
  });

  it('мини-тест: зачёт от половины', () => {
    const tasks = Array.from({ length: 8 }, (_, i) => makeTask('K', 'a', i + 1));
    const answers = (n: number) => tasks.map((_, i) => (i < n ? right : wrong));
    expect(scoreExam(tasks, answers(4), 'mini').passed).toBe(true);
    expect(scoreExam(tasks, answers(3), 'mini').passed).toBe(false);
  });
});

describe('remainingSeconds', () => {
  const start = 1_000_000;
  it('считает по часам и не уходит ниже нуля', () => {
    expect(remainingSeconds(start, start, 3600)).toBe(3600);
    expect(remainingSeconds(start, start + 90_000, 3600)).toBe(3510);
    expect(remainingSeconds(start, start + 3_600_000, 3600)).toBe(0);
    expect(remainingSeconds(start, start + 7_200_000, 3600)).toBe(0);
  });
  it('если часы перевели назад, лишнего времени не даёт', () => {
    expect(remainingSeconds(start, start - 600_000, 3600)).toBe(3600);
  });
});

describe('прогноз', () => {
  const answers = (n: number, correct: number, day = '2026-11-16') => {
    let d = emptyUserData();
    const pack = makePack(n);
    pack.tasks
      .filter((t) => t.module === 'K')
      .forEach((t, i) => {
        d = applyAnswer(d, { id: t.id, revision: 1, correct: i < correct, mode: 'daily', now: new Date(`${day}T10:00:00`) });
      });
    return { d, pack };
  };

  it('пока ответов в модуле меньше 30, оценки нет', () => {
    const { d, pack } = answers(29, 29);
    expect(moduleEstimate(d, pack, 'K', '2026-11-16')).toEqual({ answers: 29, p: null });
  });

  it('оценка сглажена: 30 верных из 30 дают меньше единицы', () => {
    const { d, pack } = answers(30, 30);
    const e = moduleEstimate(d, pack, 'K', '2026-11-16');
    expect(e.answers).toBe(30);
    expect(e.p).toBeCloseTo(32 / 34, 5);
  });

  it('считаются только первые ответы', () => {
    const { d, pack } = answers(30, 0);
    let again = d;
    for (const t of pack.tasks.filter((x) => x.module === 'K')) {
      again = applyAnswer(again, { id: t.id, revision: 1, correct: true, mode: 'daily', now: new Date('2026-11-16T12:00:00') });
    }
    expect(moduleEstimate(again, pack, 'K', '2026-11-16').p).toBeCloseTo(2 / 34, 5);
  });

  it('свежие ответы весят больше старых', () => {
    const pack = makePack(40);
    let d = emptyUserData();
    pack.tasks
      .filter((t) => t.module === 'K')
      .forEach((t, i) => {
        const old = i < 20;
        d = applyAnswer(d, { id: t.id, revision: 1, correct: !old, mode: 'daily', now: new Date(old ? '2026-08-01T10:00:00' : '2026-11-16T10:00:00') });
      });
    expect(moduleEstimate(d, pack, 'K', '2026-11-16').p!).toBeGreaterThan(0.75);
  });

  it('вероятность зачёта', () => {
    expect(passProbability([1, 1, 1, 1, 1])).toBeCloseTo(1, 9);
    expect(passProbability([0, 1, 1, 1, 1])).toBe(0);
    expect(passProbability([0.5, 0.5, 0.5, 0.5, 0.5])).toBeLessThan(0.1);
    const good = passProbability([0.875, 0.875, 0.875, 0.875, 0.875]);
    expect(good).toBeGreaterThan(0.9);
    expect(good).toBeLessThan(1);
    // один слабый модуль тянет вниз сильнее, чем то же число ошибок, размазанное поровну
    expect(passProbability([0.95, 0.95, 0.95, 0.95, 0.45])).toBeLessThan(passProbability([0.85, 0.85, 0.85, 0.85, 0.85]));
  });
});
