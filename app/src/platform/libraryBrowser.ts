import { stemText } from '../core/stem';
import { LibraryError, type DocInfo, type LibraryStore, type SearchHit } from './Library';
import sample from './library-sample.json';

type SampleDoc = { info: DocInfo; sections: { anchor: string; heading: string; text: string }[] };
const docs = sample.docs as SampleDoc[];

const SNIPPET = 240;

function find(id: string): SampleDoc {
  const doc = docs.find((d) => d.info.id === id);
  if (!doc) throw new LibraryError('query');
  return doc;
}

/**
 * Библиотека для запуска в обычном браузере: три документа из файла-образца.
 * Нужна для разработки и автотестов интерфейса, настоящий поиск живёт в Rust.
 */
export const browserLibrary: LibraryStore = {
  status: async () => ({ installed: true, packVersion: sample.packVersion, docs: docs.length }),
  available: async () => null,
  update: async () => 'up-to-date',
  list: async () => docs.map((d) => d.info),

  doc: async (id) => {
    const doc = find(id);
    return {
      info: doc.info,
      sections: doc.sections.map(({ anchor, heading }, ord) => ({ anchor, heading, ord })),
    };
  },

  sections: async (docId, fromOrd, count) =>
    find(docId)
      .sections.map((s, ord) => ({ ...s, ord, context: '' }))
      .slice(fromOrd, fromOrd + count),

  search: async (query, limit = 50) => {
    const stems = stemText(query)
      .split(' ')
      .filter((w) => w.length >= 2);
    if (stems.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const doc of docs) {
      for (const s of doc.sections) {
        const words = stemText(`${s.heading} ${s.text}`).split(' ');
        if (stems.every((stem) => words.some((w) => w.startsWith(stem)))) {
          hits.push({
            docId: doc.info.id,
            docTitle: doc.info.title,
            anchor: s.anchor,
            heading: s.heading,
            snippet: s.text.length > SNIPPET ? s.text.slice(0, SNIPPET) + '…' : s.text,
          });
        }
      }
    }
    return hits.slice(0, limit);
  },
};
