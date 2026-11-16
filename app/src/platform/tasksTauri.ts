import { invoke } from '@tauri-apps/api/core';
import { parseTasksPack, type TasksPack } from '../core/taskSchema';
import { LibraryError } from './Library';
import { download, fetchManifest, isNewer, PACK_BASE_URL, SUPPORTED_SCHEMA, toLibraryError } from './libraryUpdate';
import type { TasksSource } from './Tasks';
import { bundledPack } from './tasksBrowser';

export type TasksDeps = {
  fetchImpl: (url: string, init: { cache: 'no-store' }) => Promise<Response>;
  /** текст установленной базы или null, если обновлений ещё не было */
  read: () => Promise<string | null>;
  /** отдаёт файл на проверку подписи и установку; отказ — строка с кодом ошибки */
  install: (file: Uint8Array, sha256: string, signature: string) => Promise<void>;
  bundled: () => TasksPack;
};

export function createTasksSource(deps: TasksDeps): TasksSource {
  const current = async (): Promise<TasksPack> => {
    const bundled = deps.bundled();
    try {
      const text = await deps.read();
      if (text === null) return bundled;
      const { pack } = parseTasksPack(JSON.parse(text));
      // после обновления программы зашитая база может оказаться новее скачанной раньше
      return isNewer(pack.packVersion, bundled.packVersion) ? pack : bundled;
    } catch {
      // установленный файл не читается или не разбирается: работаем на зашитой базе
      return bundled;
    }
  };

  return {
    current,
    update: async () => {
      const manifest = await fetchManifest(deps.fetchImpl);
      if (manifest.schemaVersion > SUPPORTED_SCHEMA) throw new LibraryError('app-too-old');
      if (!manifest.tasks) return 'up-to-date';
      const have = await current();
      if (!isNewer(manifest.packVersion, have.packVersion)) return 'up-to-date';
      const { file, sha256, signature, bytes } = manifest.tasks;
      const body = await download(deps.fetchImpl, PACK_BASE_URL + file, bytes);
      // Ставим только базу, которую эта программа понимает целиком и которая действительно новее:
      // иначе непонятный файл заменил бы на диске рабочую базу.
      try {
        const { pack, skipped } = parseTasksPack(JSON.parse(new TextDecoder().decode(body)));
        if (skipped.length > 0 || pack.packVersion !== manifest.packVersion) throw new Error('не та база');
      } catch {
        throw new LibraryError('bad-pack');
      }
      try {
        await deps.install(body, sha256, signature);
      } catch (e) {
        throw toLibraryError(e);
      }
      return 'installed';
    },
  };
}

export const tauriTasks: TasksSource = createTasksSource({
  fetchImpl: (url, init) => fetch(url, init),
  read: () => invoke<string | null>('content_read'),
  install: (file, sha256, signature) =>
    invoke<void>('content_install', file, { headers: { 'x-sha256': sha256, 'x-signature': signature } }),
  bundled: bundledPack,
});
