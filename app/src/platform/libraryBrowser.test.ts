import { describe, expect, it } from 'vitest';
import { LibraryError } from './Library';
import { browserLibrary } from './libraryBrowser';

describe('browserLibrary', () => {
  it('установлена и отдаёт список документов', async () => {
    expect(await browserLibrary.status()).toEqual({ installed: true, packVersion: '2026.01.01.1', docs: 3 });
    expect((await browserLibrary.list()).map((d) => d.id)).toEqual(['tk-rf', 'fz-273', 'lit-242']);
    expect(await browserLibrary.update()).toBe('up-to-date');
    expect(await browserLibrary.available()).toBeNull();
  });

  it('находит другую форму слова', async () => {
    const hits = await browserLibrary.search('отпуском по уходу');
    expect(hits.map((h) => [h.docId, h.anchor])).toEqual([['tk-rf', 'st-256']]);
    expect(hits[0].snippet).toContain('отпуск по уходу');
  });

  it.each(['"""', '', '( * )'])('на запрос %j отвечает пустым списком', async (q) => {
    expect(await browserLibrary.search(q)).toEqual([]);
  });

  it('отдаёт оглавление и разделы порциями', async () => {
    const doc = await browserLibrary.doc('tk-rf');
    expect(doc.sections).toEqual([
      { anchor: 'st-255', heading: 'Статья 255. Отпуска по беременности и родам', ord: 0 },
      { anchor: 'st-256', heading: 'Статья 256. Отпуска по уходу за ребенком', ord: 1 },
      { anchor: 'st-60-2', heading: 'Статья 60.2. Совмещение профессий (должностей)', ord: 2 },
    ]);
    const page = await browserLibrary.sections('tk-rf', 1, 1);
    expect(page.map((s) => s.anchor)).toEqual(['st-256']);
  });

  it('неизвестный документ — ошибка query', async () => {
    await expect(browserLibrary.doc('nope')).rejects.toEqual(new LibraryError('query'));
  });
});
