export type LibraryErrorCode =
  | 'not-installed'
  | 'network'
  | 'checksum'
  | 'signature'
  | 'bad-pack'
  | 'app-too-old'
  | 'query'
  | 'io';

/** Ошибка библиотеки с кодом, по которому интерфейс выбирает текст. */
export class LibraryError extends Error {
  constructor(readonly code: LibraryErrorCode) {
    super(code);
    this.name = 'LibraryError';
  }
}

/** ocr — полный текст, распознанный со скана: в нём возможны ошибки распознавания. */
export type TextStatus = 'full' | 'ocr' | 'missing' | 'bibliographic';

export type DocInfo = {
  id: string;
  title: string;
  short: string | null;
  kind: string;
  number: string | null;
  date: string | null;
  edition: string | null;
  sourceUrl: string | null;
  fetched: string | null;
  modules: string[];
  textStatus: TextStatus;
  note: string | null;
  listNo: number | null;
};

export type SectionHead = { anchor: string; heading: string; ord: number };
/** context — часть, раздел и глава, в которых стоит раздел; пустая строка, если их нет. */
export type SectionBody = SectionHead & { text: string; context: string };
export type SearchHit = {
  docId: string;
  docTitle: string;
  anchor: string;
  heading: string;
  snippet: string;
};
export type LibraryStatus = { installed: boolean; packVersion: string | null; docs: number };

/** Что известно о пакете на сервере до скачивания. */
export type PackOffer = { packVersion: string; bytes: number; docs: number };

export interface LibraryStore {
  status(): Promise<LibraryStatus>;
  /** Есть ли на сервере пакет новее установленного. null — обновлять нечего. */
  available(): Promise<PackOffer | null>;
  /** Скачивает и ставит пакет, если он новее установленного. */
  update(onProgress?: (fraction: number) => void): Promise<'installed' | 'up-to-date'>;
  list(): Promise<DocInfo[]>;
  doc(id: string): Promise<{ info: DocInfo; sections: SectionHead[] }>;
  sections(docId: string, fromOrd: number, count: number): Promise<SectionBody[]>;
  /** Принимает текст, который ввёл человек. */
  search(query: string, limit?: number): Promise<SearchHit[]>;
}
