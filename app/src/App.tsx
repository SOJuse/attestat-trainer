import { useEffect, useState } from 'react';
import { Placeholder } from './components/Placeholder';
import { SettingsView } from './components/SettingsView';
import { UpdateBanner } from './components/UpdateBanner';
import { Sidebar } from './components/Sidebar';
import { LibraryView } from './library/LibraryView';
import type { Platform } from './platform/Platform';
import { sectionTitle, type SectionId } from './sections';

export default function App({ platform }: { platform: Platform }) {
  const [section, setSection] = useState<SectionId>('today');

  // Уже установленная библиотека обновляется при запуске молча: без сети просто остаётся прежней.
  useEffect(() => {
    platform.library
      .status()
      .then((s) => (s.installed ? platform.library.update() : null))
      .catch(() => {});
  }, [platform]);

  return (
    <div className="shell">
      <Sidebar current={section} onSelect={setSection} />
      <main className="content">
        <UpdateBanner platform={platform} />
        {section === 'settings' && <SettingsView platform={platform} />}
        {section === 'library' && (
          <LibraryView library={platform.library} openExternal={platform.openExternal} />
        )}
        {section !== 'settings' && section !== 'library' && <Placeholder title={sectionTitle(section)} />}
      </main>
    </div>
  );
}
