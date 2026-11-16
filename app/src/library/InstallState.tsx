import { useCallback, useEffect, useState } from 'react';
import type { LibraryErrorCode, LibraryStore, PackOffer } from '../platform/Library';
import { describeInstallError, errorCode } from './errors';

type State =
  | { kind: 'checking' }
  | { kind: 'ready'; offer: PackOffer | null }
  | { kind: 'loading'; fraction: number }
  | { kind: 'failed'; code: LibraryErrorCode; during: 'check' | 'download' };

const megabytes = (bytes: number) => Math.max(1, Math.round(bytes / 1024 / 1024));

/** Экран первой загрузки библиотеки. */
export function InstallState({ library, onInstalled }: { library: LibraryStore; onInstalled: () => void }) {
  const [state, setState] = useState<State>({ kind: 'checking' });

  const check = useCallback(
    () =>
      library
        .available()
        .then((offer) => setState({ kind: 'ready', offer }))
        .catch((e) => setState({ kind: 'failed', code: errorCode(e), during: 'check' })),
    [library],
  );

  useEffect(() => {
    void check();
  }, [check]);

  function retryCheck() {
    setState({ kind: 'checking' });
    void check();
  }

  async function download() {
    setState({ kind: 'loading', fraction: 0 });
    try {
      await library.update((fraction) => setState({ kind: 'loading', fraction }));
      onInstalled();
    } catch (e) {
      setState({ kind: 'failed', code: errorCode(e), during: 'download' });
    }
  }

  const failure = state.kind === 'failed' ? describeInstallError(state.code) : null;

  return (
    <section className="view">
      <h1>Библиотека</h1>
      <p>
        Здесь будут тексты законов и приказов из списка литературы, по ним можно искать. Библиотека
        скачивается один раз, дальше работает без интернета.
      </p>
      <div className="install" aria-live="polite">
        {state.kind === 'ready' && (
          <button type="button" className="button button--primary" onClick={download}>
            {state.offer ? `Скачать, ${megabytes(state.offer.bytes)} МБ` : 'Скачать'}
          </button>
        )}
        {state.kind === 'loading' && <p>Загрузка: {Math.round(state.fraction * 100)}%</p>}
        {state.kind === 'failed' && failure && (
          <>
            <p className="install__error">{failure.text}</p>
            {failure.canRetry && (
              <button
                type="button"
                className="button"
                onClick={state.during === 'check' ? retryCheck : download}
              >
                Повторить
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
