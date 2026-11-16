import type { PlacedTask, TasksPack } from './taskSchema';
import { MODULE_CODES, type ModuleCode } from './taskSchema';

/** База для тестов: в каждом модуле по `perModule` заданий, темы «a» и «b» через одно. */
export function makePack(perModule: number, over: Partial<TasksPack> = {}): TasksPack {
  const tasks: PlacedTask[] = [];
  for (const module of MODULE_CODES) {
    for (let i = 1; i <= perModule; i++) {
      const topic = i % 2 ? 'a' : 'b';
      tasks.push(makeTask(module, topic, i));
    }
  }
  const info = (m: ModuleCode) => ({
    title: m,
    ready: true,
    topics: [
      { id: 'a', title: `${m}: тема А` },
      { id: 'b', title: `${m}: тема Б` },
    ],
  });
  return {
    schemaVersion: 1,
    packVersion: '2026.11.20.1',
    pilot: false,
    modules: { K: info('K'), R: info('R'), P: info('P'), Rez: info('Rez'), I: info('I') },
    docs: {},
    tasks,
    cases: [],
    cards: [],
    ...over,
  };
}

export function makeTask(module: ModuleCode, topic: string, n: number): PlacedTask {
  return {
    id: `${module}-${topic}-${String(n).padStart(3, '0')}`,
    module,
    topic,
    type: 'single',
    difficulty: ((n % 3) + 1) as 1 | 2 | 3,
    situation: `Ситуация ${n}`,
    question: `Вопрос ${n}?`,
    options: [
      { text: 'верный', correct: true, why: 'так в норме' },
      { text: 'неверный', correct: false, why: 'не так' },
      { text: 'тоже неверный', correct: false, why: 'не так' },
    ],
    explanation: 'Разбор.',
    refs: [{ doc: 'tk-rf', anchor: 'st-1', quote: 'цитата' }],
    revision: 1,
    checked: '2026-11-18',
  };
}

/** Генератор «случайных» чисел с известной последовательностью. */
export function seeded(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
