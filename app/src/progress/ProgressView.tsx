import { useMemo } from 'react';
import type { TrainingFilter } from '../core/session';
import { topicStats } from '../core/stats';
import { MODULE_CODES } from '../core/taskSchema';
import { useAppData } from '../state/AppData';

type Props = { onTrain: (filter: TrainingFilter) => void };

const day = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

export function ProgressView({ onTrain }: Props) {
  const { pack, data } = useAppData();
  const stats = useMemo(() => topicStats(pack, data), [pack, data]);
  const answered = stats.some((s) => s.answered > 0);
  const exams = [...data.exams].reverse();

  return (
    <section className="view">
      <h1>Прогресс</h1>

      {!answered ? (
        <p>Здесь появится статистика после первых ответов: точность по темам и слабые места.</p>
      ) : (
        MODULE_CODES.map((module) => {
          const rows = stats.filter((s) => s.module === module);
          if (rows.length === 0) return null;
          const seen = rows.reduce((n, s) => n + s.seen, 0);
          const total = rows.reduce((n, s) => n + s.total, 0);
          return (
            <div key={module}>
              <h2>
                {pack.modules[module].title}
                <span className="progress__note">
                  {pack.modules[module].ready ? '' : 'в работе, '}пройдено {seen} из {total}
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
                      <td>
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
