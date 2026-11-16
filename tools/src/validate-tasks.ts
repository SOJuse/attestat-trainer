import { Card, CaseChain, Task, type TaskRef } from '../../app/src/core/taskSchema';
import { checkBalance } from './balance';
import { loadDoc, loadTopics } from './corpus';
import { loadTasks, type Raw } from './tasks';

/** Приводит текст к виду, в котором сравниваются цитата и норма. */
export function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»“”„‟"]/g, '"')
    .replace(/[‐‑‒–—−-]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

type DocView = { status: string; sections: Map<string, string> } | null;

/**
 * Проверяет задания, кейсы и карточки: формат, место в базе, ссылки на нормы и цитаты.
 * Возвращает список ошибок; пустой список — база в порядке.
 */
export function validateTasks(root: string): string[] {
  const errors: string[] = [];
  const { tasks, cases, cards } = loadTasks(root);
  const topics = loadTopics(root);
  const docs = new Map<string, DocView>();

  const doc = (id: string): DocView => {
    if (!docs.has(id)) {
      let loaded = null;
      try {
        loaded = loadDoc(root, id);
      } catch {
        loaded = null;
      }
      const hasText = loaded && (loaded.meta.text === 'full' || loaded.meta.text === 'ocr');
      docs.set(
        id,
        hasText
          ? { status: loaded!.meta.text, sections: new Map(loaded!.sections.map((s) => [s.anchor, normalizeQuote(s.text)])) }
          : null,
      );
    }
    return docs.get(id)!;
  };

  const checkRefs = (where: string, refs: TaskRef[]) => {
    for (const ref of refs) {
      const d = doc(ref.doc);
      if (!d) {
        errors.push(`${where}: у документа ${ref.doc} нет текста в корпусе`);
        continue;
      }
      const section = d.sections.get(ref.anchor);
      if (section === undefined) {
        errors.push(`${where}: в документе ${ref.doc} нет раздела ${ref.anchor}`);
        continue;
      }
      if (!section.includes(normalizeQuote(ref.quote))) {
        errors.push(`${where}: цитата не найдена в ${ref.doc} ${ref.anchor}: «${ref.quote.slice(0, 60)}»`);
      }
      if (d.status === 'ocr' && !ref.scan_page) {
        errors.push(`${where}: документ ${ref.doc} распознан со скана, нужен scan_page (страница, по которой сверена цитата)`);
      }
    }
  };

  const seen = new Set<string>();
  const idOf = (item: Raw, file: string) => (typeof item.id === 'string' ? item.id : `(без id, ${file})`);
  const unique = (id: string) => {
    if (seen.has(id)) errors.push(`${id}: повтор id`);
    seen.add(id);
  };
  const strip = <T extends Raw>(item: T, keys: string[]) =>
    Object.fromEntries(Object.entries(item).filter(([k]) => !keys.includes(k)));
  const topicKnown = (module: string, topic: string) =>
    topics.modules[module as keyof typeof topics.modules].topics.some((t) => t.id === topic);

  const placed: Record<string, { task: Task; topic: string }[]> = {};
  for (const raw of tasks) {
    const id = idOf(raw, raw.file);
    unique(id);
    const parsed = Task.safeParse(strip(raw, ['module', 'topic', 'file']));
    if (!parsed.success) {
      errors.push(`${id}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      continue;
    }
    if (!topicKnown(raw.module, raw.topic)) errors.push(`${id}: темы ${raw.module}/${raw.topic} нет в topics.yaml`);
    if (!id.startsWith(`${raw.module}-${raw.topic}-`)) {
      errors.push(`${id}: модуль и тема в id не совпадают с папкой ${raw.file}`);
    }
    checkRefs(id, parsed.data.refs);
    (placed[raw.module] ??= []).push({ task: parsed.data, topic: raw.topic });
  }

  // баланс считается только у модулей, объявленных готовыми
  for (const [module, info] of Object.entries(topics.modules)) {
    if (info.ready) errors.push(...checkBalance(module, info.topics.map((t) => t.id), placed[module] ?? [], info.target));
  }

  for (const raw of cases) {
    const id = idOf(raw, raw.file);
    unique(id);
    const parsed = CaseChain.safeParse(strip(raw, ['module', 'file']));
    if (!parsed.success) {
      errors.push(`${id}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      continue;
    }
    if (!id.startsWith(`${raw.module}-case-`)) errors.push(`${id}: модуль в id не совпадает с папкой ${raw.file}`);
    if (!topicKnown(raw.module, parsed.data.topic)) {
      errors.push(`${id}: темы ${raw.module}/${parsed.data.topic} нет в topics.yaml`);
    }
    parsed.data.steps.forEach((step, i) => checkRefs(`${id}, шаг ${i + 1}`, step.refs));
  }

  for (const raw of cards) {
    const id = idOf(raw, raw.file);
    unique(id);
    const parsed = Card.safeParse(strip(raw, ['module', 'file']));
    if (!parsed.success) {
      errors.push(`${id}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      continue;
    }
    if (!id.startsWith(`${raw.module}-card-`)) errors.push(`${id}: модуль в id не совпадает с файлом ${raw.file}`);
    if (!topicKnown(raw.module, parsed.data.topic)) {
      errors.push(`${id}: темы ${raw.module}/${parsed.data.topic} нет в topics.yaml`);
    }
    checkRefs(id, parsed.data.refs);
  }

  return errors;
}
