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
  const [sections, setSections] = useState<SectionBody[]>([]);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [sourceFailed, setSourceFailed] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  // номер последнего перехода: ответ на устаревший запрос отбрасывается
  const turn = useRef(0);

  /** Показать документ с раздела `ord`: всё загруженное раньше заменяется. */
  function showFrom(ord: number) {
    const mine = ++turn.current;
    setBusy(true);
    library
      .sections(docId, ord, PAGE)
      .then((page) => {
        if (mine !== turn.current) return;
        setSections(page);
        top.current?.scrollIntoView?.();
      })
      .catch(() => mine === turn.current && setFailed(true))
      .finally(() => mine === turn.current && setBusy(false));
  }

  useEffect(() => {
    let alive = true;
    library
      .doc(docId)
      .then(({ info, sections: toc }) => {
        if (!alive) return;
        const start = toc.find((s) => s.anchor === anchor)?.ord ?? 0;
        setDoc({ info, toc });
        setTarget(anchor && start > 0 ? anchor : '');
        if (toc.length > 0) showFrom(start);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      turn.current += 1;
    };
    // читалка пересоздаётся при смене документа и места, поэтому эффект нужен один раз
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const first = sections[0]?.ord ?? 0;
  const next = sections.length ? sections[sections.length - 1].ord + 1 : 0;

  /** Догрузить соседние разделы. Пока идёт один запрос, второй не начинается. */
  function extend(fromOrd: number, count: number, where: 'before' | 'after') {
    if (busy || count <= 0) return;
    const mine = turn.current;
    setBusy(true);
    library
      .sections(docId, fromOrd, count)
      .then((page) => {
        if (mine !== turn.current) return;
        setSections((prev) => (where === 'after' ? [...prev, ...page] : [...page, ...prev]));
      })
      .catch(() => mine === turn.current && setFailed(true))
      .finally(() => mine === turn.current && setBusy(false));
  }

  function jump(to: string) {
    const ord = toc.find((s) => s.anchor === to)?.ord;
    if (ord === undefined) return;
    setTarget(to);
    showFrom(ord);
  }

  function openSource(url: string) {
    setSourceFailed(false);
    openExternal(url).catch(() => setSourceFailed(true));
  }

  const hasText = info.textStatus === 'full' || info.textStatus === 'ocr';
  const original = info.editionStatus === 'original';

  return (
    <section className="view reader">
      <BackButton onBack={onBack} />
      <h1>{info.title}</h1>
      <p className="reader__meta muted">
        {[info.number && `№ ${info.number}`, info.date && `от ${formatDate(info.date)}`].filter(Boolean).join(' ')}
        {info.edition && (
          <span className="reader__edition">
            {original ? `В редакции на ${formatDate(info.edition)}` : `Редакция от ${formatDate(info.edition)}`}
          </span>
        )}
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
          <button type="button" className="button" onClick={() => openSource(info.sourceUrl!)}>
            Открыть источник
          </button>
        )}
      </div>
      {sourceFailed && info.sourceUrl && (
        <p className="reader__absent">Не удалось открыть источник. Его адрес: {info.sourceUrl}</p>
      )}

      {info.textStatus === 'ocr' && (
        <p className="reader__absent">
          Текст распознан со скана официальной публикации. В нём могут быть ошибки, чаще всего в числах
          и номерах пунктов: перед тем как на него опираться, сверяйте с источником.
        </p>
      )}
      {hasText && original && (
        <div className="reader__absent">
          <p>Это текст на дату принятия документа. Позднейшие изменения в текст не внесены.</p>
          {info.amendedBy.length > 0 && (
            <>
              <p>Документ меняли:</p>
              <ul>
                {info.amendedBy.map((act) => (
                  <li key={act}>{act}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {info.textStatus === 'missing' && (
        <p className="reader__absent">
          Текста этого документа в библиотеке нет: в открытых официальных источниках его получить не удалось.
          {info.note ? ` ${info.note}` : ''}
        </p>
      )}
      {info.textStatus === 'bibliographic' && (
        <p className="reader__absent">
          Текста этого документа в библиотеке нет: это не нормативный акт, в списке литературы он указан как
          материал для подготовки.
        </p>
      )}

      <div ref={top} />
      {sections.length > 0 && first > 0 && (
        <button
          type="button"
          className="button reader__more"
          disabled={busy}
          onClick={() => extend(Math.max(0, first - PAGE), first - Math.max(0, first - PAGE), 'before')}
        >
          Показать предыдущие
        </button>
      )}
      {sections.map((s, i) => (
        <article key={s.anchor} className="section">
          {s.context && s.context !== sections[i - 1]?.context && (
            <p className="section__context">{s.context}</p>
          )}
          <h2>{s.heading}</h2>
          {s.text.split(/\n{2,}/).map((paragraph, k) => (
            <p key={k}>{paragraph}</p>
          ))}
        </article>
      ))}
      {sections.length > 0 && next < toc.length && (
        <button type="button" className="button reader__more" disabled={busy} onClick={() => extend(next, PAGE, 'after')}>
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
