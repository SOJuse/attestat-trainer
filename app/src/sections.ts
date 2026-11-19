export type SectionId =
  | 'today'
  | 'training'
  | 'exam'
  | 'cards'
  | 'interview'
  | 'library'
  | 'progress'
  | 'settings';

export const SECTIONS: { id: SectionId; title: string }[] = [
  { id: 'today', title: 'Сегодня' },
  { id: 'training', title: 'Тренировка' },
  { id: 'exam', title: 'Экзамен' },
  { id: 'cards', title: 'Карточки' },
  { id: 'interview', title: 'Собеседование' },
  { id: 'library', title: 'Библиотека' },
  { id: 'progress', title: 'Прогресс' },
];

export function sectionTitle(id: SectionId): string {
  return SECTIONS.find((s) => s.id === id)?.title ?? 'Настройки';
}
