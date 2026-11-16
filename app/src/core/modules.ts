export const MODULES = [
  { code: 'K', title: 'Кадры' },
  { code: 'R', title: 'Ресурсы' },
  { code: 'P', title: 'Процессы' },
  { code: 'Rez', title: 'Результаты' },
  { code: 'I', title: 'Информация' },
] as const;

export type ModuleCode = (typeof MODULES)[number]['code'];

/** 2026-09-01 → 01.09.2026 */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
