import { useCallback, useEffect, useState } from 'react';
import type { LibraryStore } from '../platform/Library';
import { DocBrowser } from './DocBrowser';
import { InstallState } from './InstallState';
import { Reader } from './Reader';

export type OpenAt = { docId: string; anchor?: string };

type Props = {
  library: LibraryStore;
  openExternal: (url: string) => Promise<void>;
  /**
   * Открыть сразу на документе и разделе: так сюда приходят из разбора задания.
   * Читается один раз при появлении раздела; чтобы открыть другое место, раздел
   * пересоздают с новым `key`.
   */
  openAt?: OpenAt;
};

export function LibraryView({ library, openExternal, openAt }: Props) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [open, setOpen] = useState<OpenAt | null>(openAt ?? null);

  const refresh = useCallback(
    () =>
      library
        .status()
        .then((s) => setInstalled(s.installed))
        .catch(() => setInstalled(false)),
    [library],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (installed === null) return <section className="view" aria-busy="true" />;
  if (!installed) return <InstallState library={library} onInstalled={refresh} />;
  if (open) {
    return (
      <Reader
        library={library}
        docId={open.docId}
        anchor={open.anchor}
        onBack={() => setOpen(null)}
        openExternal={openExternal}
      />
    );
  }
  return <DocBrowser library={library} onOpen={(docId, anchor) => setOpen({ docId, anchor })} />;
}
