import { LibraryError, type LibraryErrorCode } from '../platform/Library';

export function errorCode(e: unknown): LibraryErrorCode {
  return e instanceof LibraryError ? e.code : 'io';
}

/** Текст для человека и можно ли повторить попытку. */
export function describeInstallError(code: LibraryErrorCode): { text: string; canRetry: boolean } {
  switch (code) {
    case 'network':
      return { text: 'Не удалось скачать библиотеку: нужно подключение к интернету.', canRetry: true };
    case 'app-too-old':
      return {
        text: 'Эта версия программы не умеет читать новую библиотеку. Обновите программу в настройках.',
        canRetry: false,
      };
    case 'checksum':
    case 'signature':
    case 'bad-pack':
      return { text: 'Файл библиотеки пришёл повреждённым и не был установлен.', canRetry: true };
    default:
      return { text: 'Не удалось сохранить библиотеку на диск.', canRetry: true };
  }
}
