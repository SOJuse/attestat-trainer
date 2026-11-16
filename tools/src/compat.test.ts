import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTasks } from './build-tasks';
import { parseTasksPack as parseAsReleased } from './fixtures/schema-0.3.0/taskSchema';

/**
 * База публикуется сразу после слияния в main, раньше выхода новой программы. Поэтому собранный
 * tasks.json обязан читаться схемой уже выпущенной версии: иначе у людей молча встанут обновления.
 * Фикстура — taskSchema.ts из тега v0.3.0. Когда выйдет версия, которой нужна новая схема,
 * фикстуру меняют на её схему.
 */
describe('совместимость базы с выпущенной программой', () => {
  const build = (root: string) => {
    const out = mkdtempSync(join(tmpdir(), 'compat-'));
    buildTasks({ root, out, build: 1, date: new Date('2026-11-20T00:00:00Z'), pilot: true });
    return JSON.parse(readFileSync(join(out, 'tasks.json'), 'utf8'));
  };

  it('фикстурная база читается программой 0.3.0 без пропусков', () => {
    const { pack, skipped } = parseAsReleased(build('src/fixtures/tasks-ok'));
    expect(skipped).toEqual([]);
    expect(pack.tasks).toHaveLength(3);
  });

  it('настоящая база читается программой 0.3.0 без пропусков', () => {
    const raw = build('..');
    const { pack, skipped } = parseAsReleased(raw);
    expect(skipped).toEqual([]);
    expect(pack.tasks.length).toBe(raw.tasks.length);
    expect(pack.cases.length).toBe(raw.cases.length);
    expect(pack.cards.length).toBe(raw.cards.length);
  });
});
