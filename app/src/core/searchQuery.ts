import { stemText } from './stem';

const MAX_WORDS = 12;
const MIN_LENGTH = 2;

/**
 * Запрос пользователя → выражение для FTS5: каждое слово как префикс, все слова обязательны.
 * После stemText в словах остаются только буквы и цифры, так что кавычки, скобки
 * и операторы FTS из ввода превращаются в обычные слова или исчезают.
 * null, если искать нечего.
 */
export function toFtsQuery(input: string): string | null {
  const words = stemText(input)
    .split(' ')
    .filter((w) => w.length >= MIN_LENGTH)
    .slice(0, MAX_WORDS);
  if (words.length === 0) return null;
  return words.map((w) => `"${w}"*`).join(' ');
}
