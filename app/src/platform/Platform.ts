import type { LibraryStore } from './Library';
import type { Store } from './Store';

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
}
