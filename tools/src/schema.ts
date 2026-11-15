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
    text: z.enum(['full', 'missing', 'bibliographic']),
    note: z.string().optional(),
  })
  .strict();
export type DocMeta = z.infer<typeof DocMeta>;

export const Manifest = z
  .object({
    schemaVersion: z.number().int().positive(),
    packVersion: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d+$/),
    library: z
      .object({
        file: z.string(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        bytes: z.number().int().positive(),
        docs: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type Manifest = z.infer<typeof Manifest>;
