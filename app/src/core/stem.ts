import { newStemmer } from 'snowball-stemmers';

const russian = newStemmer('russian');
const CYRILLIC = /^[а-я]+$/;

/** Нижний регистр, «ё» как «е», всё кроме букв и цифр — пробел. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
}

/**
 * Текст в основах слов. Один и тот же код готовит и индекс библиотеки, и запрос
 * пользователя, поэтому формы одного слова находят друг друга.
 * Русские слова длиннее трёх букв заменяются основой Snowball, остальное не меняется.
 */
export function stemText(text: string): string {
  const normalized = normalize(text);
  if (!normalized) return '';
  return normalized
    .split(' ')
    .map((word) => (word.length > 3 && CYRILLIC.test(word) ? russian.stem(word) : word))
    .join(' ');
}
