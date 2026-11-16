import { useEffect, useState, type ReactNode } from 'react';
import { Placeholder } from './components/Placeholder';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { UpdateBanner } from './components/UpdateBanner';
import { ExamView } from './exam/ExamView';
import { LibraryView, type OpenAt } from './library/LibraryView';
import type { Platform } from './platform/Platform';
import { sectionTitle, type SectionId } from './sections';
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

  const go = (id: SectionId) => {
    setSection(id);
    setVisited((prev) => (prev.includes(id) ? prev : [...prev, id]));
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
          {pane('training', <TrainingView onOpenLibrary={openLibrary} openExternal={platform.openExternal} />)}
          {pane('exam', <ExamView library={platform.library} openExternal={platform.openExternal} />)}
          {pane('cards', <Placeholder title={sectionTitle('cards')} />)}
          {pane('progress', <Placeholder title={sectionTitle('progress')} />)}
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
        {pane('settings', <SettingsView platform={platform} />)}
      </main>
    </div>
  );
}
