import { describe, expect, it } from 'vitest';
import { stemText } from './stem';
import { toFtsQuery } from './searchQuery';

describe('toFtsQuery', () => {
  it('строит запрос из основ со звёздочками', () => {
    const [a, b] = stemText('отпуск уходу').split(' ');
    expect(toFtsQuery('Отпуск по уходу')).toBe(`"${a}"* "по"* "${b}"*`);
  });

  it.each(['', '   ', '"""', '*', '( ) -', '!!!', 'а'])('пустой и знаковый запрос %j даёт null', (q) => {
    expect(toFtsQuery(q)).toBeNull();
  });

  it('операторы и спецсимволы FTS становятся обычными словами', () => {
    const fts = toFtsQuery('отпуск AND NOT "уход" OR (пособие*) NEAR col:x')!;
    expect(fts).toMatch(/^("[a-zа-я0-9]+"\*)( "[a-zа-я0-9]+"\*)*$/);
    expect(fts).toContain('"and"*');
    expect(fts).toContain('"not"*');
    expect(fts).not.toMatch(/[()*:]"|"[^*]*[()":][^*]*"\*/);
  });

  it('ограничивает число слов', () => {
    const many = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(' ');
    expect(toFtsQuery(many)!.split(' ').length).toBe(12);
  });
});
