import { describe, expect, it } from 'vitest';
import { normalize, stemText } from './stem';

describe('normalize', () => {
  it('приводит к нижнему регистру, ё к е, знаки к пробелам', () => {
    expect(normalize('  Ребёнок — это «ЧЕЛОВЕК»!  ')).toBe('ребенок это человек');
  });
});

describe('stemText', () => {
  it.each([
    ['отпуска', 'отпуском'],
    ['увольнения', 'увольнению'],
    ['работницы', 'работницей'],
    ['пособие', 'пособия'],
  ])('словоформы %s и %s дают одну основу', (a, b) => {
    expect(stemText(a)).toBe(stemText(b));
  });

  it('ё и регистр не влияют', () => {
    expect(stemText('Ребёнок')).toBe(stemText('ребенок'));
  });

  it('номера и короткие слова сохраняются', () => {
    expect(stemText('273-ФЗ, ст. 47')).toBe('273 фз ст 47');
  });

  it('латиница не стеммится', () => {
    expect(stemText('ФГИС Moodle')).toBe('фгис moodle');
  });

  it('пустая строка даёт пустую строку', () => {
    expect(stemText('  ,.  ')).toBe('');
  });
});
