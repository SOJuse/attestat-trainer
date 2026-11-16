import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { blindModule } from './blind';
import { coverage, formatCoverage } from './coverage';
import { staleTasks } from './stale';

const OK = 'src/fixtures/tasks-ok';

describe('выгрузка для слепой проверки по теме', () => {
  it('отдаёт только задания своей темы и модуля', () => {
    const doc = parse(blindModule(OK, 'K', 'otpuska')) as { tasks: { id: string }[] };
    expect(doc.tasks.map((t) => t.id)).toEqual(['K-otpuska-001', 'K-otpuska-002']);
    const other = parse(blindModule(OK, 'K', 'net-takoj-temy')) as { tasks: unknown[] };
    expect(other.tasks).toEqual([]);
  });

  it('в выгрузке нет ответов', () => {
    const text = blindModule(OK, 'K', 'otpuska');
    expect(text).not.toMatch(/correct|why|explanation|quote|answer:/);
  });
});

describe('сводка покрытия', () => {
  const c = coverage(OK, 'K');

  it('считает задания темы по типам и сложности', () => {
    const topic = c.topics.find((t) => t.topic === 'otpuska')!;
    expect(topic.total).toBe(2);
    expect(topic.byType.input).toBe(1);
    expect(topic.cases).toBe(1);
    expect(topic.cards).toBe(1);
  });

  it('показывает норму, на которую опираются два задания', () => {
    expect(c.norms.get('tk-rf st-256')).toEqual(expect.arrayContaining(['K-otpuska-001', 'K-otpuska-002']));
    expect(formatCoverage('K', c)).toMatch(/tk-rf st-256: .*K-otpuska-001.*K-otpuska-002/);
  });
});

describe('устаревшие сверки', () => {
  it('в фикстуре сверки свежее текстов', () => {
    expect(staleTasks(OK)).toEqual([]);
  });

  it('находит задание, сверенное раньше, чем скачан документ', () => {
    const stale = staleTasks('src/fixtures/tasks-stale');
    expect(stale).toEqual([{ id: 'K-otpuska-001', doc: 'tk-rf', checked: '2026-11-18', fetched: '2026-12-01' }]);
  });
});
