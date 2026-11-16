import type { LibraryStore } from './Library';
import type { Platform } from './Platform';
import type { Store } from './Store';

/** Библиотека-подделка: установлена и пуста, любой метод можно переопределить. */
export function createFakeLibrary(overrides: Partial<LibraryStore> = {}): LibraryStore {
  return {
    status: async () => ({ installed: true, packVersion: '2026.01.01.1', docs: 0 }),
    available: async () => null,
    update: async () => 'up-to-date',
    list: async () => [],
    doc: async () => {
      throw new Error('в подделке нет документов');
    },
    sections: async () => [],
    search: async () => [],
    ...overrides,
  };
}

/** Хранилище в памяти. `initial` — что «лежит на диске» при запуске. */
export function createFakeStore(initial: string | null = null): Store & { text: string | null } {
  const store = {
    text: initial,
    load: async () => store.text,
    save: async (text: string) => {
      store.text = text;
    },
  };
  return store;
}

type Overrides = Partial<Omit<Platform, 'library'>> & { library?: Partial<LibraryStore> };

/** Управляемая подделка для тестов. */
export function createFakePlatform({ library, ...overrides }: Overrides = {}): Platform {
  return {
    appVersion: async () => '0.0.0-test',
    checkAppUpdate: async () => null,
    installAppUpdate: async () => {},
    openExternal: async () => {},
    library: createFakeLibrary(library),
    store: createFakeStore(),
    ...overrides,
  };
}
