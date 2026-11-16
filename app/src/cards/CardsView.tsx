import { useEffect, useMemo, useState } from 'react';
import { localDate } from '../core/dates';
import { isDue } from '../core/srs';
import { MODULE_CODES, type ModuleCode, type PlacedCard } from '../core/taskSchema';
import { useActiveSection } from '../state/Active';
import { useAppData } from '../state/AppData';

/** Сколько новых карточек берётся за один раз. */
const NEW_BATCH = 10;

type Run = { cards: PlacedCard[]; position: number; flipped: boolean; known: boolean[] };

export function CardsView() {
  const app = useAppData();
  const { pack, data } = app;
  const today = localDate(app.now());
  const active = useActiveSection();
  const [module, setModule] = useState<ModuleCode | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [finished, setFinished] = useState<boolean[] | null>(null);

  const pool = useMemo(
    () => pack.cards.filter((c) => (!module || c.module === module) && !data.items[c.id]?.hidden),
    [pack, module, data.items],
  );
  const due = pool.filter((c) => isDue(data.items[c.id]?.srs, today));
  const seen = new Set(data.attempts.map((a) => a.id));
  const fresh = pool.filter((c) => !seen.has(c.id));

  const flip = () => setRun((r) => (r && !r.flipped ? { ...r, flipped: true } : r));

  useEffect(() => {
    if (!active || !run || run.flipped) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
        e.preventDefault();
        flip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, run]);

  if (run) {
    const card = run.cards[run.position];
    const answer = (known: boolean) => {
      app.answer({ id: card.id, revision: card.revision, correct: known, mode: 'cards' });
      const results = [...run.known, known];
      if (run.position === run.cards.length - 1) {
        setRun(null);
        setFinished(results);
      } else {
        setRun({ ...run, position: run.position + 1, flipped: false, known: results });
      }
    };
    return (
      <section className="view">
        <p className="task__meta">
          <span>{pack.modules[card.module].title}</span>
          <span className="task__position">
            Карточка {run.position + 1} из {run.cards.length}
          </span>
        </p>
        <div className="card" aria-live="polite">
          <p className="card__front">{card.front}</p>
          {run.flipped && <p className="card__back">{card.back}</p>}
        </div>
        <div className="task__actions">
          {run.flipped ? (
            <>
              <button type="button" className="button button--primary" onClick={() => answer(true)}>
                Знаю
              </button>
              <button type="button" className="button" onClick={() => answer(false)}>
                Не знаю
              </button>
            </>
          ) : (
            <button type="button" className="button button--primary" onClick={flip}>
              Показать ответ
            </button>
          )}
        </div>
        {!run.flipped && <p className="muted">Можно нажать пробел.</p>}
      </section>
    );
  }

  if (finished) {
    return (
      <section className="view">
        <h1>Итог</h1>
        <p className="summary__score">
          Знаю {finished.filter(Boolean).length} из {finished.length}
        </p>
        <p className="muted">Карточки, которые не вспомнились, вернутся завтра.</p>
        <div className="task__actions">
          <button type="button" className="button button--primary" onClick={() => setFinished(null)}>
            Готово
          </button>
        </div>
      </section>
    );
  }

  const start = (cards: PlacedCard[]) => setRun({ cards, position: 0, flipped: false, known: [] });

  return (
    <section className="view">
      <h1>Карточки</h1>
      <p>Сроки, доли и числа из норм: то, на чём чаще всего ошибаются. Вспомните ответ, потом откройте его.</p>

      {pack.cards.length === 0 ? (
        <p className="muted">Карточек в базе пока нет. Они появятся с обновлением базы.</p>
      ) : (
        <>
          <div className="filters">
            <label>
              <span>Модуль</span>
              <select aria-label="Модуль" value={module ?? ''} onChange={(e) => setModule((e.target.value || null) as ModuleCode | null)}>
                <option value="">Все модули</option>
                {MODULE_CODES.map((m) => (
                  <option key={m} value={m}>
                    {pack.modules[m].title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {due.length > 0 ? (
            <div className="task__actions">
              <button type="button" className="button button--primary" onClick={() => start(due)}>
                Повторить
              </button>
              <span>Пора повторить: {due.length}</span>
            </div>
          ) : (
            <p>На сегодня карточек нет.</p>
          )}

          {fresh.length > 0 && (
            <div className="task__actions">
              <button type="button" className={due.length ? 'button' : 'button button--primary'} onClick={() => start(fresh.slice(0, NEW_BATCH))}>
                Взять новые
              </button>
              <span>Новых: {fresh.length}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
