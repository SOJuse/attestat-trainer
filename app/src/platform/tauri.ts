import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Platform } from './Platform';

export const tauriPlatform: Platform = {
  appVersion: () => getVersion(),
  checkAppUpdate: async () => null,
  installAppUpdate: async () => {},
  openExternal: (url) => openUrl(url),
};
