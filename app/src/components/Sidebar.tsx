import logo from '../assets/logo-1103.jpeg';
import { SECTIONS, type SectionId } from '../sections';

type Props = {
  current: SectionId;
  onSelect: (id: SectionId) => void;
};

export function Sidebar({ current, onSelect }: Props) {
  return (
    <aside className="sidebar">
      <img className="sidebar__logo" src={logo} alt="Школа № 1103" />
      <nav className="sidebar__nav" aria-label="Разделы">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="sidebar__item"
            aria-current={current === s.id ? 'page' : undefined}
            onClick={() => onSelect(s.id)}
          >
            {s.title}
          </button>
        ))}
      </nav>
      <button
        type="button"
        className="sidebar__item sidebar__settings"
        aria-label="Настройки"
        aria-current={current === 'settings' ? 'page' : undefined}
        onClick={() => onSelect('settings')}
      >
        Настройки
      </button>
    </aside>
  );
}
