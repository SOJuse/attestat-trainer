import { browserLibrary } from './libraryBrowser';
import type { Platform } from './Platform';
import { browserStore } from './storeBrowser';

/** Запуск в обычном браузере: для разработки и автотестов интерфейса. */
export const browserPlatform: Platform = {
  appVersion: async () => import.meta.env.VITE_APP_VERSION ?? 'dev',
  checkAppUpdate: async () => null,
  installAppUpdate: async () => {},
  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener');
  },
  library: browserLibrary,
  store: browserStore,
};
