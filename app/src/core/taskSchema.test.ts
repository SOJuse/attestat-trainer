import { describe, expect, it } from 'vitest';
import { CaseChain, Card, parseTasksPack, Task } from './taskSchema';

const ref = { doc: 'tk-rf', anchor: 'st-256', quote: 'сохраняется в случае, если женщина' };
const base = {
  id: 'K-otpuska-001',
  difficulty: 2,
  situation: 'Воспитатель находится в отпуске по уходу за ребёнком.',
  question: 'На каких условиях она может выйти на работу?',
  explanation: 'Право на пособие сохраняется.',
  refs: [ref],
  revision: 1,
  checked: '2026-11-18',
};
const opt = (text: string, correct: boolean) => ({ text, correct, why: `потому что ${text}` });

const single = { ...base, type: 'single', options: [opt('а', true), opt('б', false), opt('в', false)] };
const multiple = { ...base, type: 'multiple', options: [opt('а', true), opt('б', true), opt('в', false)] };
const sequence = { ...base, type: 'sequence', items: ['первый шаг', 'второй шаг', 'третий шаг'] };
const matching = {
  ...base,
  type: 'matching',
  pairs: [
    { left: 'замечание', right: 'ст. 192' },
    { left: 'отпуск', right: 'ст. 114' },
    { left: 'договор', right: 'ст. 56' },
  ],
};
const input = { ...base, type: 'input', answer: 3, unit: 'рабочих дня' };

describe('Task', () => {
  it.each([single, multiple, sequence, matching, input])('принимает задание типа $type', (t) => {
    expect(Task.safeParse(t).success).toBe(true);
  });

  it.each([
    ['single с двумя верными', { ...single, options: [opt('а', true), opt('б', true), opt('в', false)] }],
    ['single без верного', { ...single, options: [opt('а', false), opt('б', false), opt('в', false)] }],
    ['multiple с одним верным', { ...multiple, options: [opt('а', true), opt('б', false), opt('в', false)] }],
    ['multiple, где верны все', { ...multiple, options: [opt('а', true), opt('б', true), opt('в', true)] }],
    ['два варианта', { ...single, options: [opt('а', true), opt('б', false)] }],
    ['семь вариантов', { ...single, options: [opt('а', true), ...'бвгдеж'.split('').map((x) => opt(x, false))] }],
    ['вариант без разбора', { ...single, options: [{ text: 'а', correct: true }, opt('б', false), opt('в', false)] }],
    ['sequence из двух шагов', { ...sequence, items: ['раз', 'два'] }],
    ['matching из двух пар', { ...matching, pairs: matching.pairs.slice(0, 2) }],
    ['matching с одинаковыми правыми', { ...matching, pairs: matching.pairs.map((p) => ({ ...p, right: 'ст. 1' })) }],
    ['input с нечисловым ответом', { ...input, answer: 'три' }],
    ['без ссылки на норму', { ...single, refs: [] }],
    ['сложность 4', { ...single, difficulty: 4 }],
    ['id не по шаблону', { ...single, id: 'otpuska-1' }],
    ['лишнее поле', { ...single, hint: 'подсказка' }],
    ['ловушка не в формулировке', { ...single, trap: { kind: 'outdated', note: 'старая редакция' } }],
  ])('отвергает: %s', (_, t) => {
    expect(Task.safeParse(t).success).toBe(false);
  });

  it('ловушка в формулировке допустима', () => {
    expect(Task.safeParse({ ...single, trap: { kind: 'wording', note: 'выйти и прервать — разное' } }).success).toBe(true);
  });
});

describe('CaseChain и Card', () => {
  // шаг кейса — задание без id, ситуации, ревизии и даты проверки, зато с полем «что изменилось»
  const step = (change: string) => ({
    type: 'single',
    difficulty: 2,
    question: base.question,
    explanation: base.explanation,
    refs: [ref],
    options: single.options,
    change,
  });
  const chain = {
    id: 'K-case-001',
    topic: 'otpuska',
    title: 'Отпуск по уходу за ребёнком',
    intro: 'Работница детского сада ушла в отпуск по уходу.',
    steps: [step(''), step('Через полгода она хочет выйти на неполный день.'), step('Её ставку сокращают.')],
  };
  it('кейс из трёх шагов принимается, из двух и из шести нет', () => {
    expect(CaseChain.safeParse(chain).success).toBe(true);
    expect(CaseChain.safeParse({ ...chain, steps: chain.steps.slice(0, 2) }).success).toBe(false);
    expect(CaseChain.safeParse({ ...chain, steps: [...chain.steps, ...chain.steps] }).success).toBe(false);
  });
  it('у шагов после первого должно быть сказано, что изменилось', () => {
    const steps = [step(''), step(''), step('Ставку сокращают.')];
    expect(CaseChain.safeParse({ ...chain, steps }).success).toBe(false);
  });
  it('карточка', () => {
    const card = { id: 'K-card-001', topic: 'otpuska', front: 'Срок предупреждения', back: 'Три рабочих дня', refs: [ref] };
    expect(Card.safeParse(card).success).toBe(true);
    expect(Card.safeParse({ ...card, back: '' }).success).toBe(false);
  });
});

describe('parseTasksPack', () => {
  const modules = Object.fromEntries(
    ['K', 'R', 'P', 'Rez', 'I'].map((m) => [m, { title: m, ready: false, topics: [{ id: 'otpuska', title: 'Отпуска' }] }]),
  );
  const pack = (tasks: unknown[]) => ({
    schemaVersion: 1,
    packVersion: '2026.11.20.1',
    pilot: true,
    modules,
    tasks,
    cases: [],
    cards: [],
  });
  const withPlace = (t: object) => ({ ...t, module: 'K', topic: 'otpuska' });

  it('отдаёт задания и ничего не пропускает', () => {
    const r = parseTasksPack(pack([withPlace(single), withPlace({ ...input, id: 'K-otpuska-002' })]));
    expect(r.pack.tasks.map((t) => t.id)).toEqual(['K-otpuska-001', 'K-otpuska-002']);
    expect(r.skipped).toEqual([]);
  });

  it('задание неизвестного типа пропускает, остальные оставляет', () => {
    const odd = withPlace({ ...single, id: 'K-otpuska-009', type: 'essay' });
    const r = parseTasksPack(pack([withPlace(single), odd, { broken: true }]));
    expect(r.pack.tasks.map((t) => t.id)).toEqual(['K-otpuska-001']);
    expect(r.skipped).toEqual(['K-otpuska-009', '(без id)']);
  });

  it.each([
    ['не объект', 'tasks'],
    ['нет schemaVersion', { ...pack([]), schemaVersion: undefined }],
    ['tasks не массив', { ...pack([]), tasks: {} }],
    ['схема новее', { ...pack([]), schemaVersion: 2 }],
  ])('бросает ошибку, если конверт не разбирается: %s', (_, raw) => {
    expect(() => parseTasksPack(raw)).toThrow();
  });
});
