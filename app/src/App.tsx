import { useState } from 'react';
import { Placeholder } from './components/Placeholder';
import { Sidebar } from './components/Sidebar';
import { sectionTitle, type SectionId } from './sections';

export default function App() {
  const [section, setSection] = useState<SectionId>('today');

  return (
    <div className="shell">
      <Sidebar current={section} onSelect={setSection} />
      <main className="content">
        <Placeholder title={sectionTitle(section)} />
      </main>
    </div>
  );
}
