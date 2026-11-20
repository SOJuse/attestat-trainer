import { describe, expect, it } from 'vitest';
import { loadDoc, loadTopics } from './corpus';
import { MODULES } from './schema';
import { validateTopics } from './validate';

const topics = loadTopics('..');

describe('темы по модулям', () => {
  it('есть все пять модулей, готовы «Кадры», «Ресурсы» и «Информация»', () => {
    expect(Object.keys(topics.modules).sort()).toEqual([...MODULES].sort());
    for (const m of MODULES) expect(topics.modules[m].ready).toBe(['K', 'R', 'I'].includes(m));
  });

  it.each(MODULES)('в модуле %s от 6 до 12 тем с уникальными id', (m) => {
    const list = topics.modules[m].topics;
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.length).toBeLessThanOrEqual(12);
    expect(new Set(list.map((t) => t.id)).size).toBe(list.length);
  });

  it('каждая тема стоит на документах с текстом и на существующих якорях', () => {
    expect(validateTopics('..')).toEqual([]);
  });

  it('у каждой темы не меньше трёх опорных разделов', () => {
    for (const m of MODULES) {
      for (const t of topics.modules[m].topics) {
        const anchors = t.docs.reduce((n, d) => n + (d.anchors?.length ?? 0), 0);
        expect(anchors, `${m}/${t.id}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('проверка ловит несуществующий якорь и документ без текста', () => {
    expect(loadDoc('..', 'tk-rf')?.sections.some((s) => s.anchor === 'st-256')).toBe(true);
    const errors = validateTopics('src/fixtures/topics-bad');
    expect(errors.join('\n')).toMatch(/st-999/);
    expect(errors.join('\n')).toMatch(/lit-9.*нет текста/);
    expect(errors.join('\n')).toMatch(/no-such-doc/);
  });
});
