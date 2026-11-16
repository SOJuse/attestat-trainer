import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDoc } from './corpus';
import { loadTasks, type Raw } from './tasks';

/**
 * Задания, которые пора сверить заново: текст документа скачан позже, чем задание проверяли.
 * Это предупреждение, а не ошибка: редакция могла и не затронуть норму.
 */
export function staleTasks(root: string): { id: string; doc: string; checked: string; fetched: string }[] {
  const { tasks, cases } = loadTasks(root);
  const fetched = new Map<string, string | undefined>();
  const fetchedOf = (doc: string) => {
    if (!fetched.has(doc)) fetched.set(doc, loadDoc(root, doc)?.meta.fetched);
    return fetched.get(doc);
  };
  const out: { id: string; doc: string; checked: string; fetched: string }[] = [];
  const check = (id: string, checked: unknown, refs: unknown) => {
    if (typeof checked !== 'string') return;
    const docs = new Set(((refs as { doc: string }[] | undefined) ?? []).map((r) => r.doc));
    for (const doc of docs) {
      const when = fetchedOf(doc);
      if (when && when > checked) out.push({ id, doc, checked, fetched: when });
    }
  };
  for (const t of tasks) check(String(t.id), t.checked, t.refs);
  for (const c of cases) {
    ((c.steps as Raw[] | undefined) ?? []).forEach((s, i) => check(`${String(c.id)}#${i + 1}`, c.checked, s.refs));
  }
  return out;
}

/**
 * Задания, которые ссылаются на текст в исходной редакции с позднейшими поправками.
 * Числа и сроки из такого текста брать нельзя; скрипт этого не понимает и только показывает,
 * какие задания проверяющему нужно посмотреть особо.
 */
export function originalEditionRefs(root: string): { id: string; doc: string }[] {
  const { tasks, cases, cards } = loadTasks(root);
  const amended = new Map<string, boolean>();
  const isAmended = (doc: string) => {
    if (!amended.has(doc)) {
      const meta = loadDoc(root, doc)?.meta;
      amended.set(doc, meta?.edition_status === 'original' && (meta.amended_by?.length ?? 0) > 0);
    }
    return amended.get(doc)!;
  };
  const out: { id: string; doc: string }[] = [];
  const check = (id: string, refs: unknown) => {
    for (const doc of new Set(((refs as { doc: string }[] | undefined) ?? []).map((r) => r.doc))) {
      if (isAmended(doc)) out.push({ id, doc });
    }
  };
  for (const t of tasks) check(String(t.id), t.refs);
  for (const c of cases) ((c.steps as Raw[] | undefined) ?? []).forEach((s, i) => check(`${String(c.id)}#${i + 1}`, s.refs));
  for (const c of cards) check(String(c.id), c.refs);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stale = staleTasks(process.argv[2] ?? '..');
  for (const s of stale) console.log(`${s.id}: документ ${s.doc} обновлён ${s.fetched}, задание сверено ${s.checked}`);
  console.log(stale.length ? `сверить заново: ${stale.length}` : 'устаревших сверок нет');
}
