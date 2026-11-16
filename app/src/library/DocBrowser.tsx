import { useEffect, useState } from 'react';
import { MODULES, type ModuleCode } from '../core/modules';
import type { DocInfo, LibraryStore, SearchHit } from '../platform/Library';

const SEARCH_DELAY_MS = 250;
const SEARCH_LIMIT = 50;

type Props = {
  library: LibraryStore;
  query: string;
  onQuery: (query: string) => void;
  module: ModuleCode | null;
  onModule: (module: ModuleCode | null) => void;
  onOpen: (docId: string, anchor?: string) => void;
};

/** Список документов с фильтром по модулю и поиском по тексту. Запрос и фильтр хранит родитель. */
export function DocBrowser({ library, query, onQuery, module, onModule, onOpen }: Props) {
  const [docs, setDocs] = useState<DocInfo[]>([]);
  // результаты хранятся вместе с запросом, на который они получены
  const [found, setFound] = useState<{ query: string; hits: SearchHit[] } | null>(null);

  useEffect(() => {
    let alive = true;
    library
      .list()
      .then((list) => alive && setDocs(list))
      .catch(() => alive && setDocs([]));
    return () => {
      alive = false;
    };
  }, [library]);

  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed) return;
    let alive = true;
    const timer = setTimeout(() => {
      library
        .search(trimmed, SEARCH_LIMIT)
        .then((hits) => alive && setFound({ query: trimmed, hits }))
        .catch(() => alive && setFound({ query: trimmed, hits: [] }));
    }, SEARCH_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [library, trimmed]);

  const hits = found && found.query === trimmed ? found.hits : null;
  const shown = module ? docs.filter((d) => d.modules.includes(module)) : docs;

  return (
    <section className="view library">
      <h1>Библиотека</h1>
      <input
        type="search"
        className="library__search"
        aria-label="Поиск по документам"
        placeholder="Слово или фраза из текста, например «отпуск по уходу»"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
      />

      {trimmed ? (
        <div aria-live="polite">
          {hits === null && <p className="muted">Ищем…</p>}
          {hits !== null && hits.length === 0 && (
            <p className="muted">Ничего не нашлось. Попробуйте другое слово или только его начало.</p>
          )}
          {hits !== null && hits.length > 0 && (
            <ul className="hits" aria-label="Результаты поиска">
              {hits.map((hit) => (
                <li key={`${hit.docId}#${hit.anchor}`}>
                  <button type="button" className="hit" onClick={() => onOpen(hit.docId, hit.anchor)}>
                    <span className="hit__heading">{hit.heading}</span>
                    <span className="hit__doc">{hit.docTitle}</span>
                    <span className="hit__snippet">{hit.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="filter" role="group" aria-label="Модуль">
            <button type="button" className="chip" aria-pressed={module === null} onClick={() => onModule(null)}>
              Все
            </button>
            {MODULES.map((m) => (
              <button
                key={m.code}
                type="button"
                className="chip"
                aria-pressed={module === m.code}
                onClick={() => onModule(m.code)}
              >
                {m.title}
              </button>
            ))}
          </div>
          <ul className="docs" aria-label="Документы">
            {shown.map((d) => (
              <li key={d.id}>
                <button type="button" className="doc" onClick={() => onOpen(d.id)}>
                  <span className="doc__title">{d.short ? `${d.short}. ${d.title}` : d.title}</span>
                  {d.textStatus === 'ocr' && <span className="doc__status">распознан со скана</span>}
                  {d.textStatus !== 'full' && d.textStatus !== 'ocr' && (
                    <span className="doc__status">без текста</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
