import { describe, expect, it } from 'vitest';
import { parseText } from './corpus';

describe('parseText', () => {
  it('режет документ по заголовкам с якорями', () => {
    const s = parseText(
      '## {#st-1} Статья 1. Цели\n\nТекст один.\n\n## {#st-60-2} Статья 60.2\n\nТекст два.\nВторая строка.\n',
    );
    expect(s.map((x) => [x.anchor, x.heading, x.ord])).toEqual([
      ['st-1', 'Статья 1. Цели', 0],
      ['st-60-2', 'Статья 60.2', 1],
    ]);
    expect(s[0].text).toBe('Текст один.');
    expect(s[1].text).toBe('Текст два.\nВторая строка.');
  });

  it.each([
    ['## {#st-1} А\n\nт\n\n## {#st-1} Б\n\nт\n', /повтор.*st-1/i],
    ['## {#st-1} А\n\n## {#st-2} Б\n\nт\n', /пуст/i],
    ['## {#Статья1} А\n\nт\n', /якор/i],
    ['Текст до первого заголовка\n\n## {#st-1} А\n\nт\n', /до первого/i],
    ['## {#st-1}\n\nт\n', /заголов/i],
  ])('отвергает некорректный текст %#', (md, re) => {
    expect(() => parseText(md)).toThrow(re);
  });

  it('строка «> …» под заголовком — контекст раздела, в текст она не входит', () => {
    const s = parseText(
      '## {#st-1} Статья 1. Цели\n\n> ЧАСТЬ ПЕРВАЯ / Глава 1. ОСНОВНЫЕ НАЧАЛА\n\nТекст один.\n\n## {#st-2} Статья 2\n\nТекст два.\n\n> это уже цитата внутри текста\n',
    );
    expect(s[0].context).toBe('ЧАСТЬ ПЕРВАЯ / Глава 1. ОСНОВНЫЕ НАЧАЛА');
    expect(s[0].text).toBe('Текст один.');
    expect(s[1].context).toBe('');
    expect(s[1].text).toBe('Текст два.\n\n> это уже цитата внутри текста');
  });

  it('раздел из одного контекста без текста — ошибка', () => {
    expect(() => parseText('## {#st-1} А\n\n> Глава 1\n\n## {#st-2} Б\n\nт\n')).toThrow(/пуст/i);
  });

  it.each(['podpis', 'preambula', 'pril-1', 'pril-2-p-14', 'st-6-1-1', 'st-12-dup2', 'podpis-dup2'])(
    'якорь %s допустим',
    (anchor) => {
      expect(parseText(`## {#${anchor}} Заголовок\n\nтекст\n`)[0].anchor).toBe(anchor);
    },
  );

  it('в сообщении об ошибке есть номер строки', () => {
    expect(() => parseText('## {#st-1} А\n\nт\n\n## {#st-1} Б\n\nт\n')).toThrow(/строка 5/);
  });
});
