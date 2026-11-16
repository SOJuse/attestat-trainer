import { useMemo, useState } from 'react';
import { localDate } from '../core/dates';
import { moduleEstimate, passProbability } from '../core/forecast';
import { plural } from '../core/plural';
import { isDue } from '../core/srs';
import { dailySession } from '../core/session';
import { streak, topicStats } from '../core/stats';
import { MODULE_CODES } from '../core/taskSchema';
import { useAppData } from '../state/AppData';
import { RunSummary, SessionRun, type RunItem } from '../task/SessionRun';

type Props = {
  onOpenLibrary?: (at: { docId: string; anchor: string }) => void;
  openExternal?: (url: string) => Promise<void>;
};

export function TodayView({ onOpenLibrary, openExternal }: Props) {
  const app = useAppData();
  const { pack, data } = app;
  const today = localDate(app.now());
  const [running, setRunning] = useState<{ ids: string[]; startAt: number; results: boolean[] } | null>(null);
  const [finished, setFinished] = useState<boolean[] | null>(null);

  const draft = data.drafts.daily ?? null;
  // состав пересчитывается по текущему прогрессу; у начатой сессии он записан в черновике и не меняется
  const planned = useMemo(
    () => dailySession({ pack, data, today, size: data.settings.dailySize, random: app.random }),
    [pack, data, today, app.random],
  );

  const byId = useMemo(() => new Map(pack.tasks.map((t) => [t.id, t])), [pack]);
  const toItems = (ids: string[]): RunItem[] =>
    ids.flatMap((id) => {
      const t = byId.get(id);
      if (!t) return [];
      const topic = pack.modules[t.module].topics.find((x) => x.id === t.topic)?.title ?? t.topic;
      return [{ id, revision: t.revision, task: t, module: pack.modules[t.module].title, topic }];
    });

  if (running) {
    return (
      <SessionRun
        items={toItems(running.ids)}
        mode="daily"
        startAt={running.startAt}
        initialResults={running.results}
        onOpenLibrary={onOpenLibrary}
        openExternal={openExternal}
        onExit={() => setRunning(null)}
        onPosition={(position, results) =>
          app.setDraft('daily', {
            kind: 'daily',
            ids: running.ids,
            answers: results,
            position,
            startedAt: draft?.startedAt ?? app.now().getTime(),
            packVersion: pack.packVersion,
          })
        }
        onFinish={(results) => {
          app.setDraft('daily', undefined);
          setRunning(null);
          setFinished(results);
        }}
      />
    );
  }

  if (finished) {
    const weak = topicStats(pack, data).filter((s) => s.weak);
    return (
      <RunSummary results={finished} onDone={() => setFinished(null)}>
        {weak.length > 0 && (
          <>
            <h2>Где слабее всего</h2>
            <ul className="plain">
              {weak.map((s) => (
                <li key={`${s.module}/${s.topic}`}>
                  {s.title}: {Math.round((s.accuracy ?? 0) * 100)}%
                </li>
              ))}
            </ul>
          </>
        )}
      </RunSummary>
    );
  }

  const start = () => {
    if (draft) {
      const results = draft.answers.filter((a): a is boolean => typeof a === 'boolean');
      if (draft.position >= draft.ids.length) {
        // на последнее задание уже ответили, оставалось только закрыть сессию
        app.setDraft('daily', undefined);
        setFinished(results);
        return;
      }
      setRunning({ ids: draft.ids, startAt: draft.position, results });
      return;
    }
    app.setDraft('daily', { kind: 'daily', ids: planned, answers: [], position: 0, startedAt: app.now().getTime(), packVersion: pack.packVersion });
    setRunning({ ids: planned, startAt: 0, results: [] });
  };

  const dueCount = planned.filter((id) => isDue(data.items[id]?.srs, today)).length;
  const days = streak(data, today);
  const readyModules = MODULE_CODES.filter((m) => pack.modules[m].ready).length;
  const estimates = MODULE_CODES.map((m) => moduleEstimate(data, pack, m, today));
  const allReady = !pack.pilot && readyModules === MODULE_CODES.length;
  const chance = allReady && estimates.every((e) => e.p !== null) ? passProbability(estimates.map((e) => e.p!)) : null;

  return (
    <section className="view today">
      <h1>Сегодня</h1>
      {days > 0 && (
        <p className="muted">
          Занятия {days} {plural(days, 'день', 'дня', 'дней')} подряд.
        </p>
      )}

      {data.drafts.exam && (
        <p className="today__notice">Есть незаконченный тест. Он ждёт в разделе «Экзамен», время идёт.</p>
      )}

      {pack.tasks.length === 0 ? (
        <p>В базе пока нет заданий. Они появятся с обновлением базы.</p>
      ) : draft ? (
        <div className="plan">
          <div className="figure">
            <b>{Math.max(draft.ids.length - draft.position, 0)}</b>
            <span>осталось в начатой сессии</span>
          </div>
          <button type="button" className="button button--primary" onClick={start}>
            Продолжить
          </button>
        </div>
      ) : planned.length === 0 ? (
        <p>На сегодня всё. Повторять нечего, новых заданий в базе нет.</p>
      ) : (
        <div className="plan">
          <div className="figure">
            <b>{planned.length}</b>
            <span>заданий на сегодня</span>
          </div>
          <div className="figure">
            <b>{dueCount}</b>
            <span>пора повторить</span>
          </div>
          <div className="figure">
            <b>{planned.length - dueCount}</b>
            <span>новых</span>
          </div>
          <button type="button" className="button button--primary" onClick={start}>
            Начать
          </button>
        </div>
      )}

      <h2>Готовность к экзамену</h2>
      {allReady ? (
        chance !== null ? (
          <>
            <div className="bar" role="img" aria-label={`Шанс сдать тест: около ${Math.round(chance * 100)}%`}>
              <i style={{ width: `${Math.round(chance * 100)}%` }} />
            </div>
            <p>Шанс сдать тест: около {Math.round(chance * 100)}%.</p>
          </>
        ) : (
          <p>Прогноз появится, когда в каждом модуле наберётся 30 ответов.</p>
        )
      ) : (
        <p>
          Готово модулей: {readyModules} из {MODULE_CODES.length}. Прогноз и полный экзамен откроются, когда будут готовы все.
          {pack.pilot && ' Сейчас в программе пробная база: по нескольку заданий на модуль.'}
        </p>
      )}
      <p className="muted">Для зачёта нужно не меньше 70% за весь тест и не меньше 50% в каждом модуле.</p>
    </section>
  );
}
