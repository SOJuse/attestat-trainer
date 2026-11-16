/**
 * Хранилище данных пользователя: один текстовый файл.
 * Запись атомарная: при сбое прежнее содержимое остаётся целым.
 */
export interface Store {
  /** null — файла ещё нет. */
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
}
