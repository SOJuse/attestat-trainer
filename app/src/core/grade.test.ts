import { describe, expect, it } from 'vitest';
import { grade, isComplete, parseNumber, type Answer } from './grade';
import type { Task } from './taskSchema';

const base = {
  id: 'K-otpuska-001',
  difficulty: 2 as const,
  situation: 'с',
  question: 'в',
  explanation: 'р',
  refs: [{ doc: 'tk-rf', anchor: 'st-1', quote: 'ц' }],
  revision: 1,
  checked: '2026-11-18',
};
const o = (correct: boolean) => ({ text: 'т', correct, why: 'п' });
const single: Task = { ...base, type: 'single', options: [o(false), o(true), o(false)] };
const multiple: Task = { ...base, type: 'multiple', options: [o(true), o(false), o(true), o(false)] };
const sequence: Task = { ...base, type: 'sequence', items: ['а', 'б', 'в'] };
const matching: Task = {
  ...base,
  type: 'matching',
  pairs: [
    { left: 'л1', right: 'п1' },
    { left: 'л2', right: 'п2' },
    { left: 'л3', right: 'п3' },
  ],
};
const input: Task = { ...base, type: 'input', answer: 3 };

describe('grade', () => {
  it.each<[string, Task, Answer, boolean]>([
    ['single верно', single, { type: 'single', choice: 1 }, true],
    ['single неверно', single, { type: 'single', choice: 0 }, false],
    ['single без выбора', single, { type: 'single', choice: null }, false],
    ['multiple верно в любом порядке', multiple, { type: 'multiple', choices: [2, 0] }, true],
    ['multiple с лишним вариантом', multiple, { type: 'multiple', choices: [0, 1, 2] }, false],
    ['multiple с неполным набором', multiple, { type: 'multiple', choices: [0] }, false],
    ['multiple с повтором вместо второго верного', multiple, { type: 'multiple', choices: [0, 0] }, false],
    ['multiple пусто', multiple, { type: 'multiple', choices: [] }, false],
    ['sequence верно', sequence, { type: 'sequence', order: [0, 1, 2] }, true],
    ['sequence с перестановкой', sequence, { type: 'sequence', order: [0, 2, 1] }, false],
    ['sequence неполная', sequence, { type: 'sequence', order: [0, 1] }, false],
    ['matching верно', matching, { type: 'matching', rights: [0, 1, 2] }, true],
    ['matching с перепутанной парой', matching, { type: 'matching', rights: [1, 0, 2] }, false],
    ['matching с пропуском', matching, { type: 'matching', rights: [0, null, 2] }, false],
    ['ответ другого типа', single, { type: 'input', text: '1' }, false],
  ])('%s', (_, task, answer, expected) => {
    expect(grade(task, answer)).toBe(expected);
  });

  it.each(['3', ' 3 ', '3,0', '3.0', '3 рабочих дня', '03'])('input: «%s» верно для ответа 3', (text) => {
    expect(grade(input, { type: 'input', text })).toBe(true);
  });

  it.each(['', '   ', 'три', '3 или 4', '4', '-3', '3-4', '1,5,0'])('input: «%s» неверно для ответа 3', (text) => {
    expect(grade(input, { type: 'input', text })).toBe(false);
  });

  it('input с дробным ответом принимает запятую и точку', () => {
    const half: Task = { ...base, type: 'input', answer: 1.5 };
    expect(grade(half, { type: 'input', text: '1,5' })).toBe(true);
    expect(grade(half, { type: 'input', text: '1.5' })).toBe(true);
    expect(grade(half, { type: 'input', text: '1,50 ставки' })).toBe(true);
    expect(grade(half, { type: 'input', text: '15' })).toBe(false);
  });
});

describe('parseNumber', () => {
  it.each<[string, number | null]>([
    ['10', 10],
    [' 1,5 ', 1.5],
    ['10 дней', 10],
    ['0,25', 0.25],
    ['', null],
    ['дней 10', null],
    ['1 2', null],
    ['1.2.3', null],
  ])('«%s» → %s', (text, expected) => {
    expect(parseNumber(text)).toBe(expected);
  });
});

describe('isComplete', () => {
  it('ответ можно проверять, только когда он заполнен', () => {
    expect(isComplete(single, { type: 'single', choice: null })).toBe(false);
    expect(isComplete(single, { type: 'single', choice: 2 })).toBe(true);
    expect(isComplete(multiple, { type: 'multiple', choices: [] })).toBe(false);
    expect(isComplete(multiple, { type: 'multiple', choices: [1] })).toBe(true);
    expect(isComplete(sequence, { type: 'sequence', order: [2, 0, 1] })).toBe(true);
    expect(isComplete(matching, { type: 'matching', rights: [0, null, 1] })).toBe(false);
    expect(isComplete(matching, { type: 'matching', rights: [2, 0, 1] })).toBe(true);
    expect(isComplete(input, { type: 'input', text: ' ' })).toBe(false);
    expect(isComplete(input, { type: 'input', text: 'абв' })).toBe(false);
    expect(isComplete(input, { type: 'input', text: '7' })).toBe(true);
    expect(isComplete(single, { type: 'input', text: '7' })).toBe(false);
  });
});
