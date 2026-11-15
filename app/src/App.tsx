import { useState } from 'react';
import { Placeholder } from './components/Placeholder';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import type { Platform } from './platform/Platform';
import { sectionTitle, type SectionId } from './sections';

export default function App({ platform }: { platform: Platform }) {
  const [section, setSection] = useState<SectionId>('today');

  return (
    <div className="shell">
      <Sidebar current={section} onSelect={setSection} />
      <main className="content">
        {section === 'settings' ? (
          <SettingsView platform={platform} />
        ) : (
          <Placeholder title={sectionTitle(section)} />
        )}
      </main>
    </div>
  );
}
