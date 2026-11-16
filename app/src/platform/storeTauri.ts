import { invoke } from '@tauri-apps/api/core';
import type { Store } from './Store';

export const tauriStore: Store = {
  load: () => invoke<string | null>('store_load'),
  save: (text) => invoke<void>('store_save', { text }),
};
