import bundled from '../bundled/tasks.json';
import { parseTasksPack, type TasksPack } from '../core/taskSchema';
import type { TasksSource } from './Tasks';

/** База, зашитая в сборку: с ней программа работает до первого обновления и без сети. */
export function bundledPack(): TasksPack {
  return parseTasksPack(bundled).pack;
}

/** В браузере (разработка и автотесты) база только зашитая. */
export const browserTasks: TasksSource = {
  current: async () => bundledPack(),
  update: async () => 'up-to-date',
};
