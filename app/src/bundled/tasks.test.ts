import { describe, expect, it } from 'vitest';
import { MODULE_CODES, parseTasksPack } from '../core/taskSchema';
import bundled from './tasks.json';

describe('зашитая база заданий', () => {
  const { pack, skipped } = parseTasksPack(bundled);

  it('разбирается без пропусков', () => {
    expect(skipped).toEqual([]);
  });

  it('пробная: 25 заданий, кейс и 10 карточек', () => {
    expect(pack.pilot).toBe(true);
    expect([pack.tasks.length, pack.cases.length, pack.cards.length]).toEqual([25, 1, 10]);
  });

  it.each(MODULE_CODES)('в модуле %s есть задание каждого типа', (module) => {
    const types = pack.tasks.filter((t) => t.module === module).map((t) => t.type);
    expect([...types].sort()).toEqual(['input', 'matching', 'multiple', 'sequence', 'single']);
  });

  it('тема каждого задания, кейса и карточки есть в своём модуле', () => {
    for (const item of [...pack.tasks, ...pack.cases, ...pack.cards]) {
      expect(pack.modules[item.module].topics.map((t) => t.id)).toContain(item.topic);
    }
  });
});
