import { useEffect, useMemo, useRef, useState } from 'react';
import { buildExam, buildMiniTest, remainingSeconds, scoreExam, type ExamScore } from '../core/exam';
import { EXAM, MINI } from '../core/examConfig';
import type { Answer } from '../core/grade';
import type { Draft } from '../core/progress';
import { MODULE_CODES, type ModuleCode, type PlacedTask } from '../core/taskSchema';
import { LibraryView } from '../library/LibraryView';
import type { LibraryStore } from '../platform/Library';
import { useAppData } from '../state/AppData';
import { TaskView } from '../task/TaskView';

type Props = { library: LibraryStore; openExternal: (url: string) => Promise<void> };
type Kind = 'full' | 'mini';
type Done = { kind: Kind; module?: ModuleCode; tasks: PlacedTask[]; answers: (Answer | undefined)[]; score: ExamScore; timeUp: boolean };

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const percent = (score: { correct: number; total: number }) => (score.total ? Math.round((score.correct / score.total) * 100) : 0);
const fixed = () => 0; // для проверки «можно ли собрать тест» случайность не нужна

export function ExamView({ library, openExternal }: Props) {
  const app = useAppData();
  const { pack, data } = app;
  const [done, setDone] = useState<Done | null>(null);
  const draft = data.draft && data.draft.kind !== 'daily' ? data.draft : null;

  const canFull = useMemo(() => buildExam({ pack, data, random: fixed }) !== null, [pack, data]);
  const miniModules = useMemo(
    () => MODULE_CODES.filter((module) => buildMiniTest({ pack, data, module, random: fixed }) !== null),
    [pack, data],
  );

  if (done) return <Protocol done={done} onClose={() => setDone(null)} />;
  if (draft) return <ExamRun draft={draft} library={library} openExternal={openExternal} onDone={setDone} />;

  const start = (kind: Kind, module?: ModuleCode) => {
    const ids = kind === 'full' ? buildExam({ pack, data, random: app.random }) : buildMiniTest({ pack, data, module: module!, random: app.random });
    if (!ids) return;
    app.setDraft({
      kind: kind === 'full' ? 'exam' : 'mini',
      module,
      ids,
      answers: ids.map(() => null),
      position: 0,
      startedAt: app.now().getTime(),
      packVersion: pack.packVersion,
    });
  };

  const last = data.exams[data.exams.length - 1];

  return (
    <section className="view">
      <h1>Экзамен</h1>

      <h2>Как в аудитории</h2>
      <p>
        {EXAM.total} заданий, {EXAM.seconds / 60} минут, по {EXAM.perModule} из каждого модуля. Разбора по ходу нет, к заданиям можно
        возвращаться. Рядом открывается поиск по библиотеке: на экзамене для этого дают второй компьютер.
      </p>
      {canFull ? (
        <button type="button" className="button button--primary" onClick={() => start('full')}>
          Начать экзамен
        </button>
      ) : (
        <p className="reader__absent">
          Полный экзамен откроется, когда будут готовы все пять модулей и в каждом наберётся не меньше {EXAM.perModule} заданий.
        </p>
      )}

      <h2>Мини-тест по модулю</h2>
      <p>
        {MINI.tasks} заданий одного модуля, {MINI.seconds / 60} минут, зачёт от половины верных ответов.
        {pack.pilot && ' Сейчас подключена пробная база, поэтому заданий в тесте столько, сколько есть в модуле.'}
      </p>
      {miniModules.length === 0 ? (
        <p className="muted">Пока ни в одном модуле не хватает заданий для мини-теста.</p>
      ) : (
        <div className="task__actions">
          {miniModules.map((module) => (
            <button key={module} type="button" className="button" onClick={() => start('mini', module)}>
              Мини-тест: {pack.modules[module].title}
            </button>
          ))}
        </div>
      )}

      {last && (
        <p className="muted">
          Последний результат: {last.correct} из {last.total}, {last.passed ? 'зачёт' : 'незачёт'}. Вся история в разделе «Прогресс».
        </p>
      )}
    </section>
  );
}

type RunProps = Props & { draft: Draft; onDone: (done: Done) => void };

function ExamRun({ draft, library, openExternal, onDone }: RunProps) {
  const app = useAppData();
  const { pack } = app;
  const kind: Kind = draft.kind === 'exam' ? 'full' : 'mini';
  const limit = kind === 'full' ? EXAM.seconds : MINI.seconds;

  const tasks = useMemo(() => {
    const byId = new Map(pack.tasks.map((t) => [t.id, t]));
    return draft.ids.flatMap((id) => byId.get(id) ?? []);
  }, [pack, draft.ids]);

  const [answers, setAnswers] = useState<(Answer | undefined)[]>(() => draft.ids.map((_, i) => (draft.answers[i] as Answer | null) ?? undefined));
  const [position, setPosition] = useState(Math.min(draft.position, Math.max(0, tasks.length - 1)));
  const [confirming, setConfirming] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [left, setLeft] = useState(() => remainingSeconds(draft.startedAt, app.now().getTime(), limit));
  const finished = useRef(false);

  const finish = (timeUp: boolean, current = answers) => {
    if (finished.current) return;
    finished.current = true;
    const score = scoreExam(tasks, current, kind);
    const byModule = Object.fromEntries(Object.entries(score.byModule));
    app.finishExam(
      {
        at: app.now().toISOString(),
        kind,
        module: draft.module,
        total: score.total,
        correct: score.correct,
        byModule,
        passed: score.passed,
        packVersion: pack.packVersion,
      },
      tasks.map((t, i) => ({ id: t.id, revision: t.revision, correct: current[i] !== undefined && scoreExam([t], [current[i]], 'mini').correct === 1 })),
    );
    onDone({ kind, module: draft.module, tasks, answers: current, score, timeUp });
  };

  // время считается по часам: сон компьютера и свёрнутое окно лишних минут не дают
  const live = useRef({ finish });
  useEffect(() => {
    live.current = { finish };
  });
  useEffect(() => {
    const tick = () => {
      const now = remainingSeconds(draft.startedAt, app.now().getTime(), limit);
      setLeft(now);
      if (now === 0) live.current.finish(true);
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [draft.startedAt, limit, app]);

  const save = (nextAnswers: (Answer | undefined)[], nextPosition: number) =>
    app.setDraft({ ...draft, answers: nextAnswers.map((a) => a ?? null), position: nextPosition });

  const go = (index: number) => {
    setPosition(index);
    setConfirming(false);
    save(answers, index);
  };

  const task = tasks[position];
  if (!task) return null;
  const unanswered = answers.filter((a) => a === undefined).length;
  const topicTitle = pack.modules[task.module].topics.find((t) => t.id === task.topic)?.title ?? task.topic;

  return (
    <div className={showLibrary ? 'exam exam--split' : 'exam'}>
      <div className="exam__main">
        <div className="exam__bar">
          <span className={left <= 300 ? 'exam__timer exam__timer--low' : 'exam__timer'} role="timer" aria-label="Осталось времени">
            {clock(left)}
          </span>
          {pack.pilot && <span className="muted">пробная база</span>}
          <button type="button" className="button button--small" onClick={() => setShowLibrary((v) => !v)}>
            {showLibrary ? 'Скрыть библиотеку' : 'Библиотека'}
          </button>
          <button type="button" className="button button--small" onClick={() => (unanswered > 0 ? setConfirming(true) : finish(false))}>
            Завершить
          </button>
        </div>

        {confirming && (
          <div className="confirm exam__confirm" role="alertdialog" aria-label="Подтверждение">
            <p>Без ответа осталось заданий: {unanswered}. Они будут засчитаны как неверные.</p>
            <div className="task__actions">
              <button type="button" className="button button--primary" onClick={() => finish(false)}>
                Да, завершить
              </button>
              <button type="button" className="button" onClick={() => setConfirming(false)}>
                Вернуться к тесту
              </button>
            </div>
          </div>
        )}

        <nav className="exam__nav" aria-label="Задания">
          {tasks.map((t, i) => (
            <button
              key={t.id}
              type="button"
              className="exam__num"
              aria-current={i === position ? 'true' : undefined}
              aria-label={`${i + 1}${answers[i] !== undefined ? ', отвечено' : ''}`}
              data-answered={answers[i] !== undefined || undefined}
              onClick={() => go(i)}
            >
              {i + 1}
            </button>
          ))}
        </nav>

        <TaskView
          key={task.id}
          task={task}
          meta={{ module: pack.modules[task.module].title, topic: topicTitle, position: `Задание ${position + 1} из ${tasks.length}` }}
          mode="exam"
          packVersion={pack.packVersion}
          random={app.random}
          initialAnswer={answers[position]}
          onAnswered={(_, answer) => {
            const next = [...answers];
            next[position] = answer;
            setAnswers(next);
            save(next, position);
          }}
        />
        <div className="exam__step">
          <button type="button" className="button" disabled={position === 0} onClick={() => go(position - 1)}>
            Предыдущее
          </button>
          <button type="button" className="button" disabled={position === tasks.length - 1} onClick={() => go(position + 1)}>
            Следующее
          </button>
        </div>
      </div>
      {showLibrary && (
        <aside className="exam__library" aria-label="Библиотека">
          <LibraryView library={library} openExternal={openExternal} />
        </aside>
      )}
    </div>
  );
}

function Protocol({ done, onClose }: { done: Done; onClose: () => void }) {
  const { pack } = useAppData();
  const { score, tasks, answers, kind, timeUp } = done;
  const wrong = tasks.filter((t, i) => answers[i] === undefined || scoreExam([t], [answers[i]], 'mini').correct === 0);

  return (
    <section className="view">
      <h1>Протокол</h1>
      {timeUp && <p className="muted">Время вышло, тест завершён автоматически.</p>}
      <p className={score.passed ? 'protocol__verdict protocol__verdict--pass' : 'protocol__verdict protocol__verdict--fail'}>
        {score.passed ? 'Зачёт' : 'Незачёт'}
      </p>
      <p className="summary__score">
        {score.correct} из {score.total}, {percent(score)}%
      </p>

      {score.failed.map((f) =>
        f.rule === 'total' ? (
          <p key="total">
            {kind === 'full'
              ? `Набрано меньше ${Math.round(EXAM.passTotal * 100)}% за весь тест.`
              : `Набрано меньше ${Math.round(MINI.pass * 100)}% верных ответов.`}
          </p>
        ) : (
          <p key={f.module}>
            В модуле «{pack.modules[f.module].title}» меньше {Math.round(EXAM.passModule * 100)}% верных ответов.
          </p>
        ),
      )}

      {kind === 'full' && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Модуль</th>
              <th scope="col">Верно</th>
              <th scope="col">Доля</th>
            </tr>
          </thead>
          <tbody>
            {MODULE_CODES.filter((m) => score.byModule[m]).map((m) => (
              <tr key={m}>
                <th scope="row">{pack.modules[m].title}</th>
                <td>
                  {score.byModule[m]!.correct} из {score.byModule[m]!.total}
                </td>
                <td>{percent(score.byModule[m]!)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {wrong.length > 0 && (
        <>
          <h2>Разбор ошибок</h2>
          {wrong.map((t) => (
            <article key={t.id} className="mistake">
              <p className="muted">{t.situation}</p>
              <h3>{t.question}</h3>
              <p>{t.explanation}</p>
              {t.refs.map((ref) => (
                <blockquote key={`${ref.doc}#${ref.anchor}`} className="quote">
                  {ref.quote}
                </blockquote>
              ))}
            </article>
          ))}
        </>
      )}

      <div className="task__actions">
        <button type="button" className="button button--primary" onClick={onClose}>
          Готово
        </button>
      </div>
    </section>
  );
}
