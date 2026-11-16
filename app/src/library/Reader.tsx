import { useEffect, useRef, useState } from 'react';
import { formatDate } from '../core/modules';
import type { DocInfo, LibraryStore, SectionBody, SectionHead } from '../platform/Library';

/** Сколько разделов грузится за раз: кодекс на тысячу статей не должен подвешивать окно. */
const PAGE = 30;

type Props = {
  library: LibraryStore;
  docId: string;
  anchor?: string;
  onBack: () => void;
  openExternal: (url: string) => Promise<void>;
};

type Loaded = { info: DocInfo; toc: SectionHead[] };

/** Читалка одного документа. При смене документа или места пересоздаётся целиком. */
export function Reader(props: Props) {
  return <ReaderInner key={`${props.docId}#${props.anchor ?? ''}`} {...props} />;
}

function ReaderInner({ library, docId, anchor, onBack, openExternal }: Props) {
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [from, setFrom] = useState(0);
  const [sections, setSections] = useState<SectionBody[]>([]);
  const [target, setTarget] = useState(anchor ?? '');
  const top = useRef<HTMLDivElement>(null);

  // документ и его оглавление
  useEffect(() => {
    let alive = true;
    library
      .doc(docId)
      .then(({ info, sections: toc }) => {
        if (!alive) return;
        const start = toc.find((s) => s.anchor === anchor)?.ord ?? 0;
        setDoc({ info, toc });
        setTarget(anchor && start > 0 ? anchor : '');
        setFrom(start);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [library, docId, anchor]);

  // первая порция текста от выбранного места
  useEffect(() => {
    if (!doc || doc.toc.length === 0) return;
    let alive = true;
    library
      .sections(docId, from, PAGE)
      .then((page) => alive && setSections(page))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [library, docId, doc, from]);

  if (failed) {
    return (
      <section className="view">
        <BackButton onBack={onBack} />
        <p>Не удалось открыть документ.</p>
      </section>
    );
  }
  if (!doc) return <section className="view" aria-busy="true" />;

  const { info, toc } = doc;
  const first = sections[0]?.ord ?? from;
  const next = sections.length ? sections[sections.length - 1].ord + 1 : from;

  async function showMore() {
    const page = await library.sections(docId, next, PAGE);
    setSections((prev) => [...prev, ...page]);
  }

  async function showEarlier() {
    const start = Math.max(0, first - PAGE);
    const page = await library.sections(docId, start, first - start);
    setSections((prev) => [...page, ...prev]);
  }

  function jump(to: string) {
    const ord = toc.find((s) => s.anchor === to)?.ord;
    if (ord === undefined) return;
    setTarget(to);
    setSections([]);
    setFrom(ord);
    top.current?.scrollIntoView?.();
  }

  return (
    <section className="view reader">
      <BackButton onBack={onBack} />
      <h1>{info.title}</h1>
      <p className="reader__meta muted">
        {[info.number && `№ ${info.number}`, info.date && `от ${formatDate(info.date)}`].filter(Boolean).join(' ')}
        {info.edition && <span className="reader__edition">Редакция от {formatDate(info.edition)}</span>}
        {info.fetched && <span>скачано {formatDate(info.fetched)}</span>}
      </p>

      <div className="reader__tools">
        {toc.length > 0 && (
          <select aria-label="Перейти к разделу" value={target} onChange={(e) => jump(e.target.value)}>
            <option value="" disabled>
              Перейти к разделу
            </option>
            {toc.map((s) => (
              <option key={s.anchor} value={s.anchor}>
                {s.heading}
              </option>
            ))}
          </select>
        )}
        {info.sourceUrl && (
          <button type="button" className="button" onClick={() => openExternal(info.sourceUrl!)}>
            Открыть источник
          </button>
        )}
      </div>

      {info.textStatus === 'ocr' && (
        <p className="reader__absent">
          Текст распознан со скана официальной публикации. В нём могут быть ошибки, чаще всего в числах
          и номерах пунктов: перед тем как на него опираться, сверяйте с источником.
        </p>
      )}
      {info.textStatus !== 'full' && info.textStatus !== 'ocr' && (
        <p className="reader__absent">
          Текста этого документа в библиотеке нет: в действующей редакции его не удалось получить из
          официального источника.{info.note ? ` ${info.note}` : ''}
        </p>
      )}

      <div ref={top} />
      {first > 0 && (
        <button type="button" className="button reader__more" onClick={showEarlier}>
          Показать предыдущие
        </button>
      )}
      {sections.map((s, i) => (
        <article key={s.anchor} className="section">
          {s.context && s.context !== sections[i - 1]?.context && (
            <p className="section__context">{s.context}</p>
          )}
          <h2>{s.heading}</h2>
          {s.text.split(/\n{2,}/).map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </article>
      ))}
      {sections.length > 0 && next < toc.length && (
        <button type="button" className="button reader__more" onClick={showMore}>
          Показать дальше
        </button>
      )}
    </section>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="reader__back" onClick={onBack}>
      К списку
    </button>
  );
}
