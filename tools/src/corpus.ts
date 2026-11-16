import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { DocMeta, Registry, Topics, type RegistryEntry } from './schema';

/** context — названия части, раздела и главы, в которых стоит раздел; пусто, если их нет. */
export type Section = { anchor: string; heading: string; text: string; ord: number; context: string };

const HEADING = /^## \{#([^}]*)\}\s*(.*)$/;
const ANCHOR = /^((preambula|podpis)(-dup\d+)?|(st|p|gl|razdel|pril)-[a-z0-9]+(-[a-z0-9]+)*)$/;
const CONTEXT = /^> (.+)$/;

/**
 * Режет text.md на разделы. Раздел начинается строкой `## {#якорь} Заголовок`
 * и продолжается до следующей такой строки. Сразу под заголовком может стоять
 * строка `> Часть / Раздел / Глава`: это контекст, в текст раздела она не входит.
 */
export function parseText(md: string): Section[] {
  const sections: Section[] = [];
  const seen = new Set<string>();
  let current: { anchor: string; heading: string; lines: string[]; line: number } | null = null;

  const close = () => {
    if (!current) return;
    // первая непустая строка вида «> …» — контекст раздела
    const lines = [...current.lines];
    while (lines.length && !lines[0].trim()) lines.shift();
    const context = lines[0]?.match(CONTEXT)?.[1].trim() ?? '';
    if (context) lines.shift();
    const text = lines.join('\n').trim();
    if (!text) throw new Error(`строка ${current.line}: пустой раздел ${current.anchor}`);
    sections.push({ anchor: current.anchor, heading: current.heading, text, ord: sections.length, context });
  };

  md.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const m = raw.match(HEADING);
    if (!m) {
      if (current) current.lines.push(raw);
      else if (raw.trim()) throw new Error(`строка ${line}: текст до первого заголовка`);
      return;
    }
    close();
    const [, anchor, heading] = m;
    if (!ANCHOR.test(anchor)) throw new Error(`строка ${line}: якорь не по формату: ${anchor}`);
    if (seen.has(anchor)) throw new Error(`строка ${line}: повтор якоря ${anchor}`);
    if (!heading.trim()) throw new Error(`строка ${line}: у раздела ${anchor} нет заголовка`);
    seen.add(anchor);
    current = { anchor, heading: heading.trim(), lines: [], line };
  });
  close();
  return sections;
}

const docsDir = (root: string) => join(root, 'content', 'docs');

export function loadRegistry(root: string): RegistryEntry[] {
  const raw = parse(readFileSync(join(docsDir(root), 'registry.yaml'), 'utf8'));
  return Registry.parse(raw).docs;
}

/** Папки документов, которые уже есть в корпусе. */
export function listDocIds(root: string): string[] {
  const dir = docsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

export function loadDoc(root: string, id: string): { meta: DocMeta; sections: Section[] } | null {
  const dir = join(docsDir(root), id);
  const metaPath = join(dir, 'meta.yaml');
  if (!existsSync(metaPath)) return null;
  const meta = DocMeta.parse(parse(readFileSync(metaPath, 'utf8')));
  const textPath = join(dir, 'text.md');
  const sections = existsSync(textPath) ? parseText(readFileSync(textPath, 'utf8')) : [];
  return { meta, sections };
}

export function loadTopics(root: string): Topics {
  return Topics.parse(parse(readFileSync(join(root, 'content', 'topics.yaml'), 'utf8')));
}
