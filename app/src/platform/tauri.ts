import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { tauriLibrary } from './libraryTauri';
import type { Platform } from './Platform';
import { tauriStore } from './storeTauri';

/** Обновление, найденное последней проверкой. Ставится именно оно, без второго запроса. */
let found: Update | null = null;

export const tauriPlatform: Platform = {
  appVersion: () => getVersion(),

  checkAppUpdate: async () => {
    found = await check();
    return found ? { version: found.version, notes: found.body } : null;
  },

  installAppUpdate: async (onProgress) => {
    const update = found ?? (await check());
    if (!update) throw new Error('обновление недоступно');
    let total = 0;
    let received = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
      } else if (event.event === 'Progress') {
        received += event.data.chunkLength;
        if (total > 0) onProgress?.(Math.min(received / total, 1));
      } else {
        onProgress?.(1);
      }
    });
    await relaunch();
  },

  openExternal: (url) => openUrl(url),
  library: tauriLibrary,
  store: tauriStore,
};
