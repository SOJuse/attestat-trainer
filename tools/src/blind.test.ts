import { describe, expect, it } from 'vitest';
import { blind } from './blind';

describe('задание для слепой проверки', () => {
  it('не содержит ответов, разборов, ловушек и ссылок', () => {
    const out = blind({
      id: 'K-a-001',
      type: 'single',
      difficulty: 2,
      situation: 'Ситуация',
      question: 'Вопрос',
      options: [
        { text: 'Я верный', correct: true, why: 'потому что' },
        { text: 'А неверный', correct: false, why: 'потому что нет' },
      ],
      explanation: 'Разбор',
      refs: [{ doc: 'tk-rf', anchor: 'st-1', quote: 'цитата' }],
      trap: { kind: 'wording', note: 'ловушка' },
      revision: 1,
    });
    expect(out).toEqual({
      id: 'K-a-001',
      type: 'single',
      difficulty: 2,
      situation: 'Ситуация',
      question: 'Вопрос',
      options: ['А неверный', 'Я верный'],
    });
  });

  it('у порядка и пар исходное расположение не сохраняется, число скрыто', () => {
    expect(blind({ type: 'sequence', question: 'q', items: ['в', 'а', 'б'] }).items).toEqual(['а', 'б', 'в']);
    const pairs = blind({ type: 'matching', question: 'q', pairs: [{ left: 'б', right: '1' }, { left: 'а', right: '2' }] });
    expect(pairs).toMatchObject({ left: ['а', 'б'], right: ['1', '2'] });
    expect(pairs.pairs).toBeUndefined();
    expect(blind({ type: 'input', question: 'q', answer: 10, unit: 'дней' })).toEqual({ type: 'input', question: 'q', unit: 'дней' });
  });
});
