import { useMemo } from 'react';
import { localDate } from '../core/dates';
import { moduleEstimate, passProbability } from '../core/forecast';
import type { TrainingFilter } from '../core/session';
import { topicStats } from '../core/stats';
import { MODULE_CODES } from '../core/taskSchema';
import { useAppData } from '../state/AppData';

type Props = {
  onTrain: (filter: TrainingFilter) => void;
  onOpenLibrary?: (at: { docId: string; anchor: string }) => void;
};

const day = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

export function ProgressView({ onTrain, onOpenLibrary }: Props) {
  const app = useAppData();
  const { pack, data } = app;
  const today = localDate(app.now());
  const chance = useMemo(() => {
    if (pack.pilot || !MODULE_CODES.every((m) => pack.modules[m].ready)) return null;
    const estimates = MODULE_CODES.map((m) => moduleEstimate(data, pack, m, today).p);
    return estimates.every((p) => p !== null) ? passProbability(estimates as number[]) : null;
  }, [pack, data, today]);
  const stats = useMemo(() => topicStats(pack, data), [pack, data]);
  const answered = stats.some((s) => s.answered > 0);
  const exams = [...data.exams].reverse();
  const docOf = (module: string, topic: string) => pack.topicDocs[`${module}/${topic}`];

  return (
    <section className="view">
      <h1>Прогресс</h1>
      {chance !== null && <p>Шанс сдать тест сегодня: около {Math.round(chance * 100)}%.</p>}

      {!answered ? (
        <p>Здесь появится статистика после первых ответов: точность по темам и слабые места.</p>
      ) : (
        MODULE_CODES.map((module) => {
          const rows = stats.filter((s) => s.module === module);
          if (rows.length === 0) return null;
          const seen = rows.reduce((n, s) => n + s.seen, 0);
          const total = rows.reduce((n, s) => n + s.total, 0);
          // точность темы считается по последнему ответу на каждое пройденное задание; модуль — так же
          const right = rows.reduce((n, s) => n + (s.accuracy ?? 0) * s.seen, 0);
          const ready = pack.modules[module].ready;
          return (
            <div key={module}>
              <h2>
                {pack.modules[module].title}
                <span className="progress__note">
                  {ready ? (seen > 0 ? `точность ${Math.round((right / seen) * 100)}%, ` : '') : 'в работе, '}пройдено {seen} из {total}
                </span>
              </h2>
              <table className="table table--wide">
                <thead>
                  <tr>
                    <th scope="col">Тема</th>
                    <th scope="col">Точность</th>
                    <th scope="col">Пройдено</th>
                    <th scope="col">
                      <span className="visually-hidden">Действие</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.topic}>
                      <th scope="row">{s.title}</th>
                      <td className={s.weak ? 'progress__weak' : undefined}>
                        {s.accuracy === null ? 'нет ответов' : `${Math.round(s.accuracy * 100)}%`}
                        {s.weak && ', слабая тема'}
                      </td>
                      <td>
                        {s.seen} из {s.total}
                      </td>
                      <td className="progress__actions">
                        {s.total > 0 && (
                          <button
                            type="button"
                            className="link"
                            aria-label={`Тренировать тему «${s.title}»`}
                            onClick={() => onTrain({ module: s.module, topic: s.topic })}
                          >
                            Тренировать
                          </button>
                        )}
                        {s.weak && onOpenLibrary && docOf(s.module, s.topic) && (
                          <button
                            type="button"
                            className="link"
                            aria-label={`Открыть норму по теме «${s.title}»`}
                            onClick={() => {
                              const doc = docOf(s.module, s.topic)!;
                              onOpenLibrary({ docId: doc.id, anchor: doc.anchor });
                            }}
                          >
                            Открыть норму
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}

      <h2>История экзаменов</h2>
      {exams.length === 0 ? (
        <p className="muted">Экзаменов пока не было.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Дата</th>
              <th scope="col">Тест</th>
              <th scope="col">Верно</th>
              <th scope="col">Итог</th>
            </tr>
          </thead>
          <tbody>
            {exams.map((e) => (
              <tr key={e.at}>
                <td>{day(e.at)}</td>
                <td>{e.kind === 'full' ? 'Полный экзамен' : `Мини-тест: ${e.module ? pack.modules[e.module].title : ''}`}</td>
                <td>
                  {e.correct} из {e.total}
                </td>
                <td className={e.passed ? 'progress__pass' : 'progress__weak'}>{e.passed ? 'зачёт' : 'незачёт'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
