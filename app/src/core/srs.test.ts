import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, localDate } from './dates';
import { INTERVALS, isDue, reviewed } from './srs';

describe('даты', () => {
  it('местная дата меняется в полночь по местному времени', () => {
    expect(localDate(new Date(2026, 10, 16, 23, 30))).toBe('2026-11-16');
    expect(localDate(new Date(2026, 10, 17, 0, 30))).toBe('2026-11-17');
  });

  it('addDays переходит через конец месяца и года', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-11-16', 35)).toBe('2026-12-21');
  });

  it('daysBetween считает целые дни в обе стороны', () => {
    expect(daysBetween('2026-11-16', '2026-11-16')).toBe(0);
    expect(daysBetween('2026-11-16', '2026-11-19')).toBe(3);
    expect(daysBetween('2026-11-19', '2026-11-16')).toBe(-3);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2); // через перевод часов в странах, где он есть
  });
});

describe('интервальные повторения', () => {
  const today = '2026-11-16';

  it('интервалы: 1, 3, 7, 16, 35 дней', () => {
    expect([...INTERVALS]).toEqual([1, 3, 7, 16, 35]);
  });

  it('первый верный ответ ставит на первую ступень', () => {
    expect(reviewed(undefined, true, today)).toEqual({ box: 0, due: '2026-11-17' });
  });

  it('верные ответы поднимают по ступеням до последней', () => {
    let s = reviewed(undefined, true, today);
    const dues = [s.due];
    for (let i = 0; i < 6; i++) {
      s = reviewed(s, true, s.due);
      dues.push(s.due);
    }
    expect(s.box).toBe(4);
    expect(dues).toEqual([
      '2026-11-17', // +1
      '2026-11-20', // +3
      '2026-11-27', // +7
      '2026-12-13', // +16
      '2027-01-17', // +35
      '2027-02-21', // +35
      '2027-03-28', // +35
    ]);
  });

  it('неверный ответ с любой ступени возвращает на первую', () => {
    expect(reviewed({ box: 3, due: '2026-11-10' }, false, today)).toEqual({ box: 0, due: '2026-11-17' });
    expect(reviewed(undefined, false, today)).toEqual({ box: 0, due: '2026-11-17' });
  });

  it('к повторению — то, что назначено на сегодня или раньше', () => {
    expect(isDue({ box: 1, due: '2026-11-15' }, today)).toBe(true);
    expect(isDue({ box: 1, due: '2026-11-16' }, today)).toBe(true);
    expect(isDue({ box: 1, due: '2026-11-17' }, today)).toBe(false);
    expect(isDue(undefined, today)).toBe(false);
  });

  it('если часы перевели назад, ничего не ломается', () => {
    const s = reviewed(undefined, true, '2026-11-16');
    expect(isDue(s, '2026-11-10')).toBe(false);
    expect(reviewed(s, true, '2026-11-10')).toEqual({ box: 1, due: '2026-11-13' });
  });

  it('не меняет переданное состояние', () => {
    const s = Object.freeze({ box: 2, due: '2026-11-16' });
    expect(reviewed(s, true, today)).toEqual({ box: 3, due: '2026-12-02' });
  });
});
