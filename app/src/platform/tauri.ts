import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import type { Platform } from './Platform';

export const tauriPlatform: Platform = {
  appVersion: () => getVersion(),

  checkAppUpdate: async () => {
    const update = await check();
    return update ? { version: update.version, notes: update.body } : null;
  },

  installAppUpdate: async (onProgress) => {
    const update = await check();
    if (!update) return;
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
};
