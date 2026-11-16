import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTasksPack } from '../../app/src/core/taskSchema';
import { buildTasks } from './build-tasks';
import { loadTasks } from './tasks';
import { normalizeQuote, validateTasks } from './validate-tasks';

const OK = 'src/fixtures/tasks-ok';
const BAD = 'src/fixtures/tasks-bad';

describe('loadTasks', () => {
  it('берёт модуль и тему из пути файла', () => {
    const { tasks, cases, cards } = loadTasks(OK);
    expect(tasks.map((t) => [t.id, t.module, t.topic])).toEqual([
      ['K-otpuska-001', 'K', 'otpuska'],
      ['K-otpuska-002', 'K', 'otpuska'],
      ['P-doshkolnye-gruppy-001', 'P', 'doshkolnye-gruppy'],
    ]);
    expect(cases.map((c) => [c.id, c.module])).toEqual([['K-case-001', 'K']]);
    expect(cards.map((c) => [c.id, c.module])).toEqual([['K-card-001', 'K']]);
  });
});

describe('normalizeQuote', () => {
  it('сглаживает пробелы, кавычки, ё и тире', () => {
    expect(normalizeQuote('  «Ребёнок» —  это\n“человек”  ')).toBe('"ребенок" - это "человек"');
  });
});

describe('validateTasks', () => {
  it('верная база проходит без ошибок', () => {
    expect(validateTasks(OK)).toEqual([]);
  });

  it.each([
    ['цитата не найдена', /K-otpuska-001.*цитат/],
    ['повтор id', /K-otpuska-001.*повтор/],
    ['нет раздела', /K-otpuska-003.*st-999/],
    ['документ без текста', /K-otpuska-004.*lit-9.*нет текста/],
    ['модуль не совпадает с папкой', /R-zakupki-005.*модул/],
    ['формат задания', /K-otpuska-006/],
    ['темы нет в topics.yaml', /K-uvolnenie-001.*тем/],
    ['распознанный документ без страницы скана', /P-doshkolnye-gruppy-001.*scan_page/],
  ])('ловит: %s', (_, re) => {
    expect(validateTasks(BAD).join('\n')).toMatch(re);
  });
});

describe('buildTasks', () => {
  const build = () => {
    const out = mkdtempSync(join(tmpdir(), 'tasks-'));
    const info = buildTasks({ root: OK, out, build: 4, date: new Date('2026-11-20T10:00:00Z'), pilot: true });
    return { out, info, raw: readFileSync(join(out, 'tasks.json'), 'utf8') };
  };

  it('собирает базу, которую программа разбирает без пропусков', () => {
    const { raw, info } = build();
    const { pack, skipped } = parseTasksPack(JSON.parse(raw));
    expect(skipped).toEqual([]);
    expect(pack.packVersion).toBe('2026.11.20.4');
    expect(pack.pilot).toBe(true);
    expect([pack.tasks.length, pack.cases.length, pack.cards.length]).toEqual([3, 1, 1]);
    expect(pack.modules.K.topics).toEqual([{ id: 'otpuska', title: 'Отпуска' }]);
    expect(info.count).toBe(3);
    expect(info.file).toBe('tasks.json');
    expect(info.bytes).toBe(Buffer.byteLength(raw));
  });

  it('повторная сборка даёт тот же файл', () => {
    expect(build().raw).toBe(build().raw);
  });

  it('база с ошибками не собирается', () => {
    const out = mkdtempSync(join(tmpdir(), 'tasks-'));
    expect(() => buildTasks({ root: BAD, out, build: 1, pilot: true })).toThrow(/ошиб/i);
  });
});
