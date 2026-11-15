import { browserPlatform } from './browser';
import type { Platform } from './Platform';
import { tauriPlatform } from './tauri';

export function detectPlatform(): Platform {
  return '__TAURI_INTERNALS__' in window ? tauriPlatform : browserPlatform;
}
