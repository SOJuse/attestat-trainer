import type { TasksPack } from '../core/taskSchema';

/** Источник базы заданий. */
export interface TasksSource {
  /** Действующая база: установленная, если она новее зашитой в программу, иначе зашитая. */
  current(): Promise<TasksPack>;
  /** Проверяет сервер и ставит более новую базу. Ошибки сети и подписи — исключением. */
  update(): Promise<'installed' | 'up-to-date'>;
}
