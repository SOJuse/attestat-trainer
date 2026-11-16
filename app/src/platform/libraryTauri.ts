import { invoke } from '@tauri-apps/api/core';
import { toFtsQuery } from '../core/searchQuery';
import type { DocInfo, LibraryStatus, LibraryStore, SearchHit, SectionBody, SectionHead } from './Library';
import { decideUpdate, fetchManifest, runUpdate, toLibraryError, type UpdateDeps } from './libraryUpdate';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw toLibraryError(e);
  }
}

const status = () => call<LibraryStatus>('library_status');

const deps: UpdateDeps = {
  fetchImpl: (url, init) => fetch(url, init),
  installedVersion: async () => (await status()).packVersion,
  // тело запроса — сам пакет, остальное в заголовках: так байты не превращаются в JSON
  install: (pack, sha256, signature, packVersion) =>
    invoke<void>('library_install', pack, {
      headers: { 'x-sha256': sha256, 'x-signature': signature, 'x-pack-version': packVersion },
    }),
};

export const tauriLibrary: LibraryStore = {
  status,

  available: async () => {
    const manifest = await fetchManifest(deps.fetchImpl);
    const decision = decideUpdate(manifest, await deps.installedVersion());
    if (decision === 'app-too-old') throw toLibraryError('app-too-old');
    if (decision === 'skip') return null;
    return { packVersion: manifest.packVersion, bytes: manifest.library.bytes, docs: manifest.library.docs };
  },

  update: (onProgress) => runUpdate(deps, onProgress),
  list: () => call<DocInfo[]>('library_list'),
  doc: (id) => call<{ info: DocInfo; sections: SectionHead[] }>('library_doc', { id }),
  sections: (docId, fromOrd, count) => call<SectionBody[]>('library_sections', { docId, fromOrd, count }),

  search: async (query, limit = 50) => {
    const ftsQuery = toFtsQuery(query);
    if (ftsQuery === null) return [];
    return call<SearchHit[]>('library_search', { ftsQuery, limit });
  },
};
