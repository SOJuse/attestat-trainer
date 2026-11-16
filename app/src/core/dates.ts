/** Даты хранятся строками ГГГГ-ММ-ДД по местному времени: «сегодня» — это день человека, а не UTC. */

const pad = (n: number) => String(n).padStart(2, '0');

export function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Арифметика идёт в UTC по календарным числам, поэтому перевод часов её не сдвигает.
const toUtc = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDays(date: string, n: number): string {
  const d = new Date(toUtc(date) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Сколько дней от a до b; отрицательное число, если b раньше. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
