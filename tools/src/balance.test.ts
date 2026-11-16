import { describe, expect, it } from 'vitest';
import type { Task } from '../../app/src/core/taskSchema';
import { checkBalance } from './balance';

const common = { situation: 'с', question: 'в', explanation: 'р', refs: [{ doc: 'tk-rf', anchor: 'st-1', quote: 'ц' }], revision: 1, checked: '2026-11-18' };
const opt = (text: string, correct: boolean) => ({ text, correct, why: 'п' });

function make(n: number, type: Task['type'], difficulty: 1 | 2 | 3, i: number, correctAt = i % 4): Task {
  const id = `K-a-${String(n).padStart(3, '0')}`;
  const base = { ...common, id, difficulty };
  if (type === 'single') return { ...base, type, options: [0, 1, 2, 3].map((k) => opt(k === correctAt ? 'да' : 'нет, не так', k === correctAt)) };
  if (type === 'multiple') return { ...base, type, options: [opt('а', true), opt('б', true), opt('в', false)] };
  if (type === 'sequence') return { ...base, type, items: ['1', '2', '3'] };
  if (type === 'matching') return { ...base, type, pairs: [{ left: 'а', right: '1' }, { left: 'б', right: '2' }, { left: 'в', right: '3' }] };
  return { ...base, type, answer: 1 };
}

/** 60 заданий: 24 single, 21 multiple, 15 прочих; сложность 12/30/18; четыре темы по 15. */
function balanced(): { task: Task; topic: string }[] {
  const types: Task['type'][] = [
    ...Array<Task['type']>(24).fill('single'),
    ...Array<Task['type']>(21).fill('multiple'),
    ...Array<Task['type']>(5).fill('sequence'),
    ...Array<Task['type']>(5).fill('matching'),
    ...Array<Task['type']>(5).fill('input'),
  ];
  return types.map((type, i) => {
    const difficulty = (i % 10 < 2 ? 1 : i % 10 < 7 ? 2 : 3) as 1 | 2 | 3;
    return { task: make(i + 1, type, difficulty, i), topic: ['a', 'b', 'c', 'd'][i % 4] };
  });
}

describe('баланс готового модуля', () => {
  const topics = ['a', 'b', 'c', 'd'];

  it('сбалансированный модуль проходит', () => {
    expect(checkBalance('K', topics, balanced())).toEqual([]);
  });

  it('мало заданий и пустая тема', () => {
    const errors = checkBalance('K', [...topics, 'e'], balanced().slice(0, 40));
    expect(errors.join('\n')).toMatch(/заданий 40, нужно не меньше 60/);
    expect(errors.join('\n')).toMatch(/в теме e заданий 0/);
  });

  it('меньший объём принимается, если он задан для модуля', () => {
    const forty = balanced().slice(0, 40);
    expect(checkBalance('K', topics, forty).join('\n')).toMatch(/заданий 40, нужно не меньше 60/);
    expect(checkBalance('K', topics, forty, 40).join('\n')).not.toMatch(/нужно не меньше 40/);
  });

  it('перекос типов и сложности', () => {
    const items = balanced().map((x, i) => ({ ...x, task: make(i + 1, 'single', 1, i) }));
    const text = checkBalance('K', topics, items).join('\n');
    expect(text).toMatch(/с одним ответом 100%/);
    expect(text).toMatch(/с несколькими ответами 0%/);
    expect(text).toMatch(/сложности 1 100%/);
  });

  it('верный вариант, который выдаёт себя местом или длиной', () => {
    const sameSpot = balanced().map((x, i) => (x.task.type === 'single' ? { ...x, task: make(i + 1, 'single', x.task.difficulty, i, 0) } : x));
    expect(checkBalance('K', topics, sameSpot).join('\n')).toMatch(/стоит 1-м в 100%/);
    const longest = balanced().map((x) =>
      x.task.type === 'single'
        ? { ...x, task: { ...x.task, options: x.task.options.map((o) => (o.correct ? { ...o, text: 'самый длинный вариант из всех' } : o)) } }
        : x,
    );
    expect(checkBalance('K', topics, longest).join('\n')).toMatch(/самый длинный в 100%/);
  });
});
