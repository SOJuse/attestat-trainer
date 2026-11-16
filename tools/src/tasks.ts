import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { MODULE_CODES, type ModuleCode } from '../../app/src/core/taskSchema';

/** Исходник задания, кейса или карточки: содержимое YAML как есть плюс место в базе. */
export type Raw = Record<string, unknown> & { id?: unknown };
export type RawTask = Raw & { module: ModuleCode; topic: string; file: string };
export type RawCase = Raw & { module: ModuleCode; file: string };
export type RawCard = Raw & { module: ModuleCode; file: string };

const yamlFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.yaml'))
        .sort()
    : [];

const read = (path: string) => parse(readFileSync(path, 'utf8'));

/**
 * Читает content/tasks/<M>/<тема>.yaml, content/cases/<M>/<id>.yaml и content/cards/<M>.yaml.
 * Модуль и тема задания берутся из пути. Схему здесь не проверяем: это делает validateTasks.
 */
export function loadTasks(root: string): { tasks: RawTask[]; cases: RawCase[]; cards: RawCard[] } {
  const content = join(root, 'content');
  const tasks: RawTask[] = [];
  const cases: RawCase[] = [];
  const cards: RawCard[] = [];
  for (const module of MODULE_CODES) {
    for (const file of yamlFiles(join(content, 'tasks', module))) {
      const topic = file.replace(/\.yaml$/, '');
      const rel = `tasks/${module}/${file}`;
      for (const item of (read(join(content, 'tasks', module, file)) ?? []) as Raw[]) {
        tasks.push({ ...item, module, topic, file: rel });
      }
    }
    for (const file of yamlFiles(join(content, 'cases', module))) {
      cases.push({ ...(read(join(content, 'cases', module, file)) as Raw), module, file: `cases/${module}/${file}` });
    }
    const cardsFile = join(content, 'cards', `${module}.yaml`);
    if (existsSync(cardsFile)) {
      for (const item of (read(cardsFile) ?? []) as Raw[]) cards.push({ ...item, module, file: `cards/${module}.yaml` });
    }
  }
  return { tasks, cases, cards };
}
