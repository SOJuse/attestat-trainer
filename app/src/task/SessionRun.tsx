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
  onOpenLibrary,
  openExternal,
  initialResults = [],
}: Props) {
  const app = useAppData();
  const [position, setPosition] = useState(Math.min(startAt, Math.max(0, items.length - 1)));
  const [results, setResults] = useState<boolean[]>(initialResults);

  const ocrDocs = useMemo(
    () => new Set(Object.values(app.docs).filter((d) => d.textStatus === 'ocr').map((d) => d.id)),
    [app.docs],
  );
  const docTitles = useMemo(
    () => Object.fromEntries(Object.values(app.docs).map((d) => [d.id, d.short ?? d.title])),
    [app.docs],
  );

  const item = items[position];
  if (!item) return null;
  const last = position === items.length - 1;

  const next = (after: boolean[]) => {
    if (last) return onFinish(after);
    setPosition(position + 1);
    onPosition?.(position + 1, after);
  };

  return (
    <div className="run">
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
          setResults((prev) => [...prev, correct]);
        }}
        onNext={() => next(results)}
        onHide={() => {
          app.hide(item.id);
          next(results);
        }}
        onOpenLibrary={onOpenLibrary}
        openExternal={openExternal}
      />
    </div>
  );
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
