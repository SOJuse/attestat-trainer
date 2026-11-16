import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { UpdateBanner } from './components/UpdateBanner';
import { CardsView } from './cards/CardsView';
import type { TrainingFilter } from './core/session';
import { ExamView } from './exam/ExamView';
import { LibraryView, type OpenAt } from './library/LibraryView';
import type { Platform } from './platform/Platform';
import { ProgressView } from './progress/ProgressView';
import type { SectionId } from './sections';
import { ProgressSettings } from './settings/ProgressSettings';
import { ActiveSection } from './state/Active';
import { AppDataProvider } from './state/AppData';
import { TodayView } from './today/TodayView';
import { TrainingView } from './training/TrainingView';

export default function App({ platform }: { platform: Platform }) {
  const [section, setSection] = useState<SectionId>('today');
  // разделы, в которые уже заходили: они остаются смонтированными, чтобы не терять начатое
  const [visited, setVisited] = useState<SectionId[]>(['today']);
  // куда открыть библиотеку по ссылке из разбора; seq пересоздаёт раздел на новом месте
  const [libraryAt, setLibraryAt] = useState<(OpenAt & { seq: number }) | null>(null);

  // место в «Настройках», куда встают настройки занятий и прогресса
  const [progressSlot, setProgressSlot] = useState<HTMLElement | null>(null);

  const go = (id: SectionId) => {
    setSection(id);
    setVisited((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  // фильтр, с которым открыть тренировку из карты слабых тем; seq пересоздаёт раздел
  const [trainFilter, setTrainFilter] = useState<{ filter: TrainingFilter; seq: number }>({ filter: {}, seq: 0 });
  const train = (filter: TrainingFilter) => {
    setTrainFilter((prev) => ({ filter, seq: prev.seq + 1 }));
    go('training');
  };

  const openLibrary = (at: { docId: string; anchor: string }) => {
    setLibraryAt((prev) => ({ ...at, seq: (prev?.seq ?? 0) + 1 }));
    go('library');
  };

  // Уже установленная библиотека обновляется при запуске молча: без сети просто остаётся прежней.
  useEffect(() => {
    platform.library
      .status()
      .then((s) => (s.installed ? platform.library.update() : null))
      .catch(() => {});
  }, [platform]);

  const pane = (id: SectionId, content: ReactNode) =>
    visited.includes(id) && (
      <div className="pane" hidden={section !== id} key={id}>
        <ActiveSection.Provider value={section === id}>{content}</ActiveSection.Provider>
      </div>
    );

  return (
    <div className="shell">
      <Sidebar current={section} onSelect={go} />
      <main className="content">
        <UpdateBanner platform={platform} />
        <AppDataProvider platform={platform}>
          {pane('today', <TodayView onOpenLibrary={openLibrary} openExternal={platform.openExternal} />)}
          {pane(
            'training',
            <TrainingView
              key={trainFilter.seq}
              initialFilter={trainFilter.filter}
              onOpenLibrary={openLibrary}
              openExternal={platform.openExternal}
            />,
          )}
          {pane('exam', <ExamView library={platform.library} openExternal={platform.openExternal} />)}
          {pane('cards', <CardsView />)}
          {pane('progress', <ProgressView onTrain={train} />)}
          {progressSlot && createPortal(<ProgressSettings platform={platform} />, progressSlot)}
        </AppDataProvider>
        {pane(
          'library',
          <LibraryView
            key={libraryAt?.seq ?? 0}
            library={platform.library}
            openExternal={platform.openExternal}
            openAt={libraryAt ?? undefined}
          />,
        )}
        {pane('settings', <SettingsView platform={platform} progressSlot={setProgressSlot} />)}
      </main>
    </div>
  );
}
