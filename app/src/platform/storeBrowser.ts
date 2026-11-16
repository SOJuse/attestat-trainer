import type { Store } from './Store';

const KEY = 'attestat-trainer:userdata';

/** Хранилище для запуска в браузере (разработка и автотесты): localStorage. */
export const browserStore: Store = {
  load: async () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  save: async (text) => {
    localStorage.setItem(KEY, text);
  },
};
