import type { LibraryStore } from './Library';
import type { Store } from './Store';
import type { TasksSource } from './Tasks';

export type AppUpdate = { version: string; notes?: string };

/** Всё, что интерфейсу нужно от системы. Компоненты не обращаются к Tauri напрямую. */
export interface Platform {
  appVersion(): Promise<string>;
  /** null — обновлений нет. Бросает ошибку, если проверить не удалось. */
  checkAppUpdate(): Promise<AppUpdate | null>;
  /** Скачивает и ставит обновление, после успеха перезапускает программу. */
  installAppUpdate(onProgress?: (fraction: number) => void): Promise<void>;
  openExternal(url: string): Promise<void>;
  library: LibraryStore;
  /** данные пользователя: прогресс, история, настройки */
  store: Store;
  /** база заданий */
  tasks: TasksSource;
  /** Предлагает сохранить текст в файл. false — человек отменил. */
  saveFile(name: string, text: string): Promise<boolean>;
  /** Предлагает выбрать файл и отдаёт его текст. null — человек отменил. */
  pickFile(): Promise<string | null>;
}
