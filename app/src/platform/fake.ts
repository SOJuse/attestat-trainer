import type { LibraryStore } from './Library';
import type { Platform } from './Platform';
import type { Store } from './Store';
import type { TasksSource } from './Tasks';

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

const EMPTY_MODULE = { title: '', ready: false, topics: [] };

/** Источник базы для тестов: по умолчанию пустая пробная база без обновлений. */
export function createFakeTasks(overrides: Partial<TasksSource> = {}): TasksSource {
  return {
    current: async () => ({
      schemaVersion: 1,
      packVersion: '2026.01.01.1',
      pilot: true,
      modules: { K: EMPTY_MODULE, R: EMPTY_MODULE, P: EMPTY_MODULE, Rez: EMPTY_MODULE, I: EMPTY_MODULE },
      docs: {},
      tasks: [],
      cases: [],
      cards: [],
    }),
    update: async () => 'up-to-date',
    ...overrides,
  };
}

type Overrides = Partial<Omit<Platform, 'library' | 'tasks'>> & {
  library?: Partial<LibraryStore>;
  tasks?: Partial<TasksSource>;
};

/** Управляемая подделка для тестов. */
export function createFakePlatform({ library, tasks, ...overrides }: Overrides = {}): Platform {
  return {
    appVersion: async () => '0.0.0-test',
    checkAppUpdate: async () => null,
    installAppUpdate: async () => {},
    openExternal: async () => {},
    library: createFakeLibrary(library),
    store: createFakeStore(),
    tasks: createFakeTasks(tasks),
    saveFile: async () => true,
    pickFile: async () => null,
    ...overrides,
  };
}
