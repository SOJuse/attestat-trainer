import { z } from 'zod';

export const MODULES = ['K', 'R', 'P', 'Rez', 'I'] as const;
export const ModuleCode = z.enum(MODULES);
export type ModuleCode = z.infer<typeof ModuleCode>;

export const DOC_KINDS = [
  'federal-law',
  'decree',
  'government',
  'ministry',
  'sanpin',
  'court',
  'moscow',
  'donm',
  'letter',
  'other',
] as const;
export const DocKind = z.enum(DOC_KINDS);

const DocId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id: латиница, цифры и дефисы');
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате ГГГГ-ММ-ДД');

export const RegistryEntry = z
  .object({
    id: DocId,
    list_no: z.number().int().positive().optional(),
    section: z.string().min(1),
    title: z.string().min(1),
    kind: DocKind,
    number: z.string().optional(),
    date: IsoDate.optional(),
    edition_in_list: z.string().optional(),
    // у четырёх позиций списка (224, 232, 242, 249) модуль в PDF не отмечен
    modules: z.array(ModuleCode),
  })
  .strict();
export type RegistryEntry = z.infer<typeof RegistryEntry>;

export const Registry = z.object({ docs: z.array(RegistryEntry) }).strict();

/** Сайты, с которых разрешено брать тексты актов. */
export const ALLOWED_SOURCE_HOSTS = [
  'pravo.gov.ru',
  'publication.pravo.gov.ru',
  'ips.pravo.gov.ru',
  'kremlin.ru',
  'government.ru',
  'mos.ru',
  'edu.gov.ru',
  'docs.edu.gov.ru',
  'obrnadzor.gov.ru',
  'rospotrebnadzor.ru',
  'vsrf.ru',
  'minobrnauki.gov.ru',
  'mintrud.gov.ru',
  'minfin.gov.ru',
  'corp-univer.ru',
  'dpomos.ru',
] as const;

export const DocMeta = z
  .object({
    id: DocId,
    title: z.string().min(1),
    short: z.string().optional(),
    kind: DocKind,
    number: z.string().optional(),
    date: IsoDate.optional(),
    edition: IsoDate.optional(),
    source_url: z.string().optional(),
    fetched: IsoDate.optional(),
    modules: z.array(ModuleCode),
    list_no: z.number().int().positive().optional(),
    // ocr — полный текст, распознанный со скана: возможны ошибки распознавания
    text: z.enum(['full', 'ocr', 'missing', 'bibliographic']),
    // current — действующая сводная редакция; original — текст официальной публикации,
    // более поздние изменения в него не внесены (их перечисляет amended_by)
    edition_status: z.enum(['current', 'original']).optional(),
    amended_by: z.array(z.string()).optional(),
    note: z.string().optional(),
  })
  .strict();
export type DocMeta = z.infer<typeof DocMeta>;

export const Topic = z
  .object({
    id: DocId,
    title: z.string().min(1),
    // какие решения руководителя проверяет тема
    why: z.string().min(1),
    docs: z.array(z.object({ doc: DocId, anchors: z.array(z.string()).optional() }).strict()).min(1),
  })
  .strict();
export type Topic = z.infer<typeof Topic>;

const ModuleTopics = z.object({ title: z.string().min(1), ready: z.boolean(), topics: z.array(Topic) }).strict();
export const Topics = z
  .object({ modules: z.object({ K: ModuleTopics, R: ModuleTopics, P: ModuleTopics, Rez: ModuleTopics, I: ModuleTopics }).strict() })
  .strict();
export type Topics = z.infer<typeof Topics>;

export const Manifest = z
  .object({
    schemaVersion: z.number().int().positive(),
    packVersion: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d+$/),
    library: z
      .object({
        file: z.string(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        // появляется после подписи пакета; без неё программа пакет не примет
        signature: z.string().min(1).optional(),
        bytes: z.number().int().positive(),
        docs: z.number().int().nonnegative(),
      })
      .strict(),
    // база заданий лежит рядом с библиотекой; программа 0.2.0 этот блок не читает
    tasks: z
      .object({
        file: z.string(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        signature: z.string().min(1).optional(),
        bytes: z.number().int().positive(),
        count: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Manifest = z.infer<typeof Manifest>;
