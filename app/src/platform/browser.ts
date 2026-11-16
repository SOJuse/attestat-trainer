import { browserLibrary } from './libraryBrowser';
import type { Platform } from './Platform';
import { browserStore } from './storeBrowser';
import { browserTasks } from './tasksBrowser';

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
  tasks: browserTasks,

  saveFile: async (name, text) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
    return true;
  },

  pickFile: () =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        file.text().then(resolve, () => resolve(null));
      };
      input.oncancel = () => resolve(null);
      input.click();
    }),
};
