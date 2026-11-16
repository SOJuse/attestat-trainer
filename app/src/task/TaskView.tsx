import { useEffect, useRef, useState } from 'react';
import { grade, isComplete, type Answer } from '../core/grade';
import type { CaseStep, Task } from '../core/taskSchema';
import { emptyAnswer, shuffled, TaskInputs } from './TaskInputs';

const ISSUES = 'https://github.com/SOJuse/attestat-trainer/issues/new';

/** Адрес нового обращения об ошибке в задании. */
export function issueUrl(taskId: string, packVersion: string): string {
  const params = new URLSearchParams({
    title: `Ошибка в задании ${taskId}`,
    body: `Задание: ${taskId}\nВерсия базы: ${packVersion}\n\nЧто не так:\n`,
  });
  return `${ISSUES}?${params.toString()}`;
}

type Gradable = (Task | CaseStep) & { id?: string; situation?: string };

type Props = {
  task: Gradable;
  /** id для обращения об ошибке, если у самого задания его нет (шаг кейса) */
  id?: string;
  meta: { module: string; topic: string; position?: string };
  /** learn — проверка и разбор сразу; exam — ответ уходит наверх молча */
  mode: 'learn' | 'exam';
  packVersion: string;
  initialAnswer?: Answer;
  onAnswered: (correct: boolean, answer: Answer) => void;
  onNext?: () => void;
  onOpenLibrary?: (at: { docId: string; anchor: string }) => void;
  onHide?: () => void;
  openExternal?: (url: string) => Promise<void>;
  /** документы, распознанные со скана: у их цитат стоит пометка */
  ocrDocs?: Set<string>;
  docTitles?: Record<string, string>;
  nextLabel?: string;
  random?: () => number;
};

export function TaskView({
  task,
  id,
  meta,
  mode,
  packVersion,
  initialAnswer,
  onAnswered,
  onNext,
  onOpenLibrary,
  onHide,
  openExternal,
  ocrDocs,
  docTitles,
  nextLabel = 'Дальше',
  random = Math.random,
}: Props) {
  const size = task.type === 'single' || task.type === 'multiple' ? task.options.length : task.type === 'sequence' ? task.items.length : task.type === 'matching' ? task.pairs.length : 0;
  // порядок показа выбирается один раз на показ задания
  const [order] = useState(() => shuffled(size, random));
  const [answer, setAnswer] = useState<Answer>(() => initialAnswer ?? emptyAnswer(task, order));
  const [result, setResult] = useState<boolean | null>(null);
  const reviewed = result !== null;
  const taskId = id ?? task.id ?? '';

  const change = (next: Answer) => {
    setAnswer(next);
    if (mode === 'exam') onAnswered(grade(task, next), next);
  };

  const check = () => {
    if (reviewed || !isComplete(task, answer)) return;
    const correct = grade(task, answer);
    setResult(correct);
    onAnswered(correct, answer);
  };

  // состояние для обработчика клавиш без переподписки на каждое изменение
  const live = useRef({ answer, reviewed, check, change, onNext });
  useEffect(() => {
    live.current = { answer, reviewed, check, change, onNext };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'SELECT' || (el?.tagName === 'INPUT' && (el as HTMLInputElement).type === 'text');
      const now = live.current;
      if (e.key === 'Enter' && mode === 'learn') {
        if (el?.tagName === 'BUTTON') return; // кнопка сама отработает нажатие
        e.preventDefault();
        if (now.reviewed) now.onNext?.();
        else now.check();
        return;
      }
      if (typing || now.reviewed || !/^[1-9]$/.test(e.key)) return;
      const index = order[Number(e.key) - 1];
      if (index === undefined) return;
      if (now.answer.type === 'single') now.change({ type: 'single', choice: index });
      if (now.answer.type === 'multiple') {
        const chosen = now.answer.choices;
        const next = chosen.includes(index) ? chosen.filter((x) => x !== index) : [...chosen, index].sort((a, b) => a - b);
        now.change({ type: 'multiple', choices: next });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, order]);

  return (
    <section className="view task">
      <div className="task__meta">
        <span>{meta.module}</span>
        <span>{meta.topic}</span>
        <span className="dots" aria-label={`Сложность ${task.difficulty} из 3`}>
          {[1, 2, 3].map((n) => (
            <i key={n} className={n <= task.difficulty ? 'on' : ''} />
          ))}
        </span>
        {meta.position && <span className="task__position">{meta.position}</span>}
      </div>

      {task.situation && <p className="task__situation">{task.situation}</p>}
      <h1 className="task__question">{task.question}</h1>

      <TaskInputs task={task} answer={answer} order={order} disabled={reviewed} onChange={change} reviewed={reviewed} />

      {mode === 'learn' && !reviewed && (
        <div className="task__actions">
          <button type="button" className="button button--primary" disabled={!isComplete(task, answer)} onClick={check}>
            Проверить
          </button>
        </div>
      )}

      {reviewed && (
        <div className="review">
          <p className={result ? 'review__result review__result--right' : 'review__result review__result--wrong'} role="status">
            {result ? 'Верно' : 'Неверно'}
          </p>
          {task.type === 'sequence' && (
            <div>
              <p className="muted">Верный порядок:</p>
              <ol className="review__list">
                {task.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </div>
          )}
          {task.type === 'input' && (
            <p>
              Верный ответ: {String(task.answer).replace('.', ',')}
              {task.unit ? ` ${task.unit}` : ''}
            </p>
          )}
          <h2>Разбор</h2>
          <p>{task.explanation}</p>
          {task.trap && <p className="review__trap">{task.trap.note}</p>}

          {task.refs.map((ref) => (
            <blockquote key={`${ref.doc}#${ref.anchor}#${ref.quote}`} className="quote">
              {ref.quote}
              <cite>
                {docTitles?.[ref.doc] ?? ref.doc}
                {ocrDocs?.has(ref.doc) &&
                  (ref.scan_page ? `, распознано со скана, сверено по странице ${ref.scan_page}` : ', распознано со скана')}
              </cite>
              {onOpenLibrary && (
                <button type="button" className="link" onClick={() => onOpenLibrary({ docId: ref.doc, anchor: ref.anchor })}>
                  Открыть в библиотеке
                </button>
              )}
            </blockquote>
          ))}

          <div className="task__actions">
            {onNext && (
              <button type="button" className="button button--primary" onClick={onNext}>
                {nextLabel}
              </button>
            )}
            {openExternal && taskId && (
              <button type="button" className="link" onClick={() => void openExternal(issueUrl(taskId, packVersion)).catch(() => {})}>
                Сообщить об ошибке
              </button>
            )}
            {onHide && (
              <button type="button" className="link" onClick={onHide}>
                Скрыть задание
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
