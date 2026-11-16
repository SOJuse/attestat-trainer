import { useMemo, useState } from 'react';
import { trainingSet, type TrainingFilter } from '../core/session';
import { MODULE_CODES, type ModuleCode, type PlacedCase, type PlacedTask } from '../core/taskSchema';
import { useAppData } from '../state/AppData';
import { RunSummary, SessionRun, type RunItem } from '../task/SessionRun';

type Props = {
  onOpenLibrary?: (at: { docId: string; anchor: string }) => void;
  openExternal?: (url: string) => Promise<void>;
  /** начальный фильтр: так сюда приходят из карты слабых тем */
  initialFilter?: TrainingFilter;
};

const TYPES: { value: PlacedTask['type']; title: string }[] = [
  { value: 'single', title: 'Один ответ' },
  { value: 'multiple', title: 'Несколько ответов' },
  { value: 'sequence', title: 'Порядок' },
  { value: 'matching', title: 'Соответствие' },
  { value: 'input', title: 'Ввод числа' },
];

type Run = { items: RunItem[]; mode: 'training' | 'case'; label?: (i: number, n: number) => string };

export function TrainingView({ onOpenLibrary, openExternal, initialFilter = {} }: Props) {
  const app = useAppData();
  const { pack, data } = app;
  const [filter, setFilter] = useState<TrainingFilter>(initialFilter);
  const [run, setRun] = useState<Run | null>(null);
  const [finished, setFinished] = useState<boolean[] | null>(null);

  const ids = useMemo(() => trainingSet({ pack, data, filter }), [pack, data, filter]);
  const topicTitle = (module: ModuleCode, topic: string) =>
    pack.modules[module].topics.find((t) => t.id === topic)?.title ?? topic;

  if (run) {
    return (
      <SessionRun
        items={run.items}
        mode={run.mode}
        label={run.label}
        onOpenLibrary={onOpenLibrary}
        openExternal={openExternal}
        onFinish={(results) => {
          setRun(null);
          setFinished(results);
        }}
        onExit={(results) => {
          setRun(null);
          setFinished(results.length > 0 ? results : null);
        }}
      />
    );
  }
  if (finished) return <RunSummary results={finished} onDone={() => setFinished(null)} />;

  const startTraining = () => {
    const byId = new Map(pack.tasks.map((t) => [t.id, t]));
    const items = ids.flatMap((id) => {
      const t = byId.get(id);
      return t ? [{ id, revision: t.revision, task: t, module: pack.modules[t.module].title, topic: topicTitle(t.module, t.topic) }] : [];
    });
    setRun({ items, mode: 'training' });
  };

  const startCase = (chain: PlacedCase) => {
    const items: RunItem[] = chain.steps.map((step, i) => ({
      id: `${chain.id}#${i + 1}`,
      revision: chain.revision,
      task: step,
      module: pack.modules[chain.module].title,
      topic: chain.title,
      lead: (
        <div className="case__lead">
          <p>{chain.intro}</p>
          {step.change && (
            <p className="case__change">
              <b>Что изменилось.</b> {step.change}
            </p>
          )}
        </div>
      ),
    }));
    setRun({ items, mode: 'case', label: (i, n) => `Шаг ${i + 1} из ${n}` });
  };

  const set = (patch: Partial<TrainingFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const topics = filter.module ? pack.modules[filter.module].topics : [];

  return (
    <section className="view training">
      <h1>Тренировка</h1>
      <div className="filters">
        <label>
          <span>Модуль</span>
          <select
            aria-label="Модуль"
            value={filter.module ?? ''}
            onChange={(e) => set({ module: (e.target.value || undefined) as ModuleCode | undefined, topic: undefined })}
          >
            <option value="">Все модули</option>
            {MODULE_CODES.map((m) => (
              <option key={m} value={m}>
                {pack.modules[m].title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Тема</span>
          <select aria-label="Тема" value={filter.topic ?? ''} disabled={!filter.module} onChange={(e) => set({ topic: e.target.value || undefined })}>
            <option value="">Все темы</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Сложность</span>
          <select
            aria-label="Сложность"
            value={filter.difficulty ?? ''}
            onChange={(e) => set({ difficulty: (Number(e.target.value) || undefined) as 1 | 2 | 3 | undefined })}
          >
            <option value="">Любая</option>
            <option value="1">Простые</option>
            <option value="2">Средние</option>
            <option value="3">Сложные</option>
          </select>
        </label>
        <label>
          <span>Тип задания</span>
          <select
            aria-label="Тип задания"
            value={filter.type ?? ''}
            onChange={(e) => set({ type: (e.target.value || undefined) as PlacedTask['type'] | undefined })}
          >
            <option value="">Любой</option>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="filters__check">
          <input type="checkbox" checked={filter.onlyErrors ?? false} onChange={(e) => set({ onlyErrors: e.target.checked || undefined })} />
          <span>Только задания с ошибкой</span>
        </label>
      </div>

      <div className="task__actions">
        <button type="button" className="button button--primary" disabled={ids.length === 0} onClick={startTraining}>
          Начать
        </button>
        <span>Подходит заданий: {ids.length}</span>
      </div>
      {ids.length === 0 && <p className="muted">Под такой набор заданий нет. Снимите один из фильтров.</p>}

      {pack.cases.length > 0 && (
        <>
          <h2>Кейсы</h2>
          <p className="muted">Одна ситуация в несколько шагов: на каждом шаге условия меняются.</p>
          <ul className="docs" aria-label="Кейсы">
            {pack.cases.map((chain) => (
              <li key={chain.id}>
                <button type="button" className="doc" onClick={() => startCase(chain)}>
                  <span className="doc__title">{chain.title}</span>
                  <span className="doc__status">
                    {pack.modules[chain.module].title}, шагов: {chain.steps.length}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
