import bundled from '../bundled/tasks.json';
import { parseTasksPack, type TasksPack } from '../core/taskSchema';
import type { TasksSource } from './Tasks';

/** База, зашитая в сборку: с ней программа работает до первого обновления и без сети. */
export function bundledPack(): TasksPack {
  return parseTasksPack(bundled).pack;
}

/** Ключ, под которым автотест кладёт в хранилище браузера свою базу вместо зашитой. */
export const TEST_PACK_KEY = 'attestat-test-pack';

/**
 * В браузере (разработка и автотесты) база зашитая. Автотест может подложить свою,
 * например большую: настольная версия этот источник не использует.
 */
export const browserTasks: TasksSource = {
  current: async () => {
    try {
      const override = localStorage.getItem(TEST_PACK_KEY);
      if (override) return parseTasksPack(JSON.parse(override)).pack;
    } catch {
      // подложенная база не разобралась: работаем на зашитой
    }
    return bundledPack();
  },
  update: async () => 'up-to-date',
};
