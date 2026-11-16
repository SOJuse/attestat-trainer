import { describe, expect, it } from 'vitest';
import { localDate } from '../core/dates';
import { applyAnswer, emptyUserData, reconcile } from '../core/progress';
import { dailySession } from '../core/session';
import { MODULE_CODES, parseTasksPack } from '../core/taskSchema';
import bundled from './tasks.json';

describe('зашитая база заданий', () => {
  const { pack, skipped } = parseTasksPack(bundled);

  it('разбирается без пропусков', () => {
    expect(skipped).toEqual([]);
    expect(pack.tasks.length).toBeGreaterThanOrEqual(25);
  });

  it.each(MODULE_CODES)('в модуле %s есть задание каждого типа', (module) => {
    const types = new Set(pack.tasks.filter((t) => t.module === module).map((t) => t.type));
    expect([...types].sort()).toEqual(['input', 'matching', 'multiple', 'sequence', 'single']);
  });

  it('тема каждого задания, кейса и карточки есть в своём модуле', () => {
    for (const item of [...pack.tasks, ...pack.cases, ...pack.cards]) {
      expect(pack.modules[item.module].topics.map((t) => t.id)).toContain(item.topic);
    }
  });

  it('у каждой ссылки на норму есть подпись документа', () => {
    const refs = [...pack.tasks, ...pack.cards, ...pack.cases.flatMap((c) => c.steps)].flatMap((x) => x.refs);
    for (const ref of refs) expect(pack.docs[ref.doc]?.title, ref.doc).toBeTruthy();
  });
});

describe('обновление задания у человека, который уже занимался', () => {
  const { pack } = parseTasksPack(bundled);
  const now = new Date(2026, 10, 20, 10, 0, 0);
  const today = localDate(now);
  const task = pack.tasks[0];

  it('прогресс по заданию сбрасывается, история и начатая сессия остаются', () => {
    const draft = { kind: 'daily' as const, ids: [task.id, pack.tasks[1].id], answers: [true], position: 1, startedAt: 1, packVersion: pack.packVersion };
    const before = { ...applyAnswer(emptyUserData(), { id: task.id, revision: task.revision, correct: true, mode: 'daily', now }), drafts: { daily: draft } };
    expect(before.items[task.id].srs).toBeDefined();

    const newer = { ...pack, tasks: pack.tasks.map((t) => (t.id === task.id ? { ...t, revision: t.revision + 1 } : t)) };
    const after = reconcile(before, newer);

    expect(after.items[task.id]).toEqual({ revision: task.revision + 1 });
    expect(after.attempts).toHaveLength(1);
    expect(after.drafts.daily).toEqual(draft);
    const session = dailySession({ pack: newer, data: { ...after, drafts: {} }, today, size: 50, random: () => 0 });
    expect(session).toContain(task.id);
  });
});
