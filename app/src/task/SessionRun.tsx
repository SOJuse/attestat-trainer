import { useMemo, useState, type ReactNode } from 'react';
import type { Mode } from '../core/progress';
import type { CaseStep, Task } from '../core/taskSchema';
import { useAppData } from '../state/AppData';
import { TaskView } from './TaskView';

export type RunItem = {
  /** под этим id ответ записывается в прогресс */
  id: string;
  revision: number;
  task: (Task | CaseStep) & { situation?: string };
  module: string;
  topic: string;
  /** что показать над заданием: вводная кейса, «что изменилось» */
  lead?: ReactNode;
};

type Props = {
  items: RunItem[];
  mode: Mode;
  startAt?: number;
  /** подпись места: «Задание 3 из 20», «Шаг 2 из 4» */
  label?: (index: number, total: number) => string;
  /** вызывается при переходе к следующему заданию: с какого места продолжать и что уже отвечено */
  onPosition?: (position: number, results: boolean[]) => void;
  onFinish: (results: boolean[]) => void;
  /** человек прервал набор: что успел ответить */
  onExit?: (results: boolean[]) => void;
  onOpenLibrary?: (at: { docId: string; anchor: string }) => void;
  openExternal?: (url: string) => Promise<void>;
  initialResults?: boolean[];
};

const defaultLabel = (i: number, n: number) => `Задание ${i + 1} из ${n}`;

/** Проводит по списку заданий: показывает по одному, записывает ответы, в конце отдаёт результаты. */
export function SessionRun({
  items,
  mode,
  startAt = 0,
  label = defaultLabel,
  onPosition,
  onFinish,
  onExit,
  onOpenLibrary,
  openExternal,
  initialResults = [],
}: Props) {
  const app = useAppData();
  const [position, setPosition] = useState(Math.min(startAt, Math.max(0, items.length - 1)));
  const [results, setResults] = useState<boolean[]>(initialResults);

  const { ocrDocs, docTitles } = useDocLabels();

  const item = items[position];
  if (!item) return null;
  const last = position === items.length - 1;

  const next = (after: boolean[]) => {
    if (last) return onFinish(after);
    setPosition(position + 1);
  };

  return (
    <div className="run">
      {onExit && (
        <div className="run__bar">
          <button type="button" className="link" onClick={() => onExit(results)}>
            Закончить
          </button>
        </div>
      )}
      {item.lead}
      <TaskView
        key={item.id}
        task={item.task}
        id={item.id}
        meta={{ module: item.module, topic: item.topic, position: label(position, items.length) }}
        mode="learn"
        packVersion={app.pack.packVersion}
        random={app.random}
        ocrDocs={ocrDocs}
        docTitles={docTitles}
        nextLabel={last ? 'Завершить' : 'Дальше'}
        onAnswered={(correct) => {
          app.answer({ id: item.id, revision: item.revision, correct, mode });
          const after = [...results, correct];
          setResults(after);
          // место запоминается сразу: после перезапуска то же задание второй раз не спросят
          onPosition?.(position + 1, after);
        }}
        onNext={() => next(results)}
        onHide={() => {
          app.hide(item.id);
          onPosition?.(position + 1, results);
          next(results);
        }}
        onOpenLibrary={onOpenLibrary}
        openExternal={openExternal}
      />
    </div>
  );
}

/** Подписи под цитатами: название документа и пометка «распознано со скана». Библиотека уточняет то, что есть в базе. */
export function useDocLabels(): { ocrDocs: Set<string>; docTitles: Record<string, string> } {
  const { docs, pack } = useAppData();
  return useMemo(() => {
    const ocrDocs = new Set(Object.entries(pack.docs).flatMap(([id, d]) => (d.ocr ? [id] : [])));
    const docTitles = Object.fromEntries(Object.entries(pack.docs).map(([id, d]) => [id, d.title]));
    for (const d of Object.values(docs)) {
      docTitles[d.id] = d.short ?? d.title;
      if (d.textStatus === 'ocr') ocrDocs.add(d.id);
      else ocrDocs.delete(d.id);
    }
    return { ocrDocs, docTitles };
  }, [docs, pack]);
}

/** Итог сессии. */
export function RunSummary({ results, onDone, children }: { results: boolean[]; onDone: () => void; children?: ReactNode }) {
  const right = results.filter(Boolean).length;
  return (
    <section className="view">
      <h1>Итог</h1>
      <p className="summary__score">
        Верно {right} из {results.length}
      </p>
      {children}
      <div className="task__actions">
        <button type="button" className="button button--primary" onClick={onDone}>
          Готово
        </button>
      </div>
    </section>
  );
}
