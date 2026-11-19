import { Fragment, useEffect, useState } from 'react';
import { localDate } from '../core/dates';
import {
  addQuestion,
  editQuestion,
  emptyInterview,
  practicePool,
  ratePractice,
  removeQuestion,
  setIndicator,
  type Interview,
  type InterviewQuestion,
  type PracticeRef,
} from '../core/interview';
import { plural } from '../core/plural';
import { useActiveSection } from '../state/Active';
import { useAppData } from '../state/AppData';
import { ALL_INDICATORS, INDICATOR_GROUPS, INDICATORS_SOURCE, indicatorById, type Indicator } from './indicators';
import { PROCEDURE, PROCEDURE_SOURCE } from './procedure';

/** Сколько новых вопросов берётся за один раз. */
const NEW_BATCH = 10;
const ORDER = ALL_INDICATORS.map((i) => i.id);

type Tab = 'questions' | 'indicators' | 'memo';
const TABS: { id: Tab; title: string }[] = [
  { id: 'questions', title: 'Вопросы' },
  { id: 'indicators', title: 'Показатели школы' },
  { id: 'memo', title: 'Памятка' },
];

type Run = { refs: PracticeRef[]; position: number; revealed: boolean; confident: boolean[] };

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function InterviewView() {
  const app = useAppData();
  const interview = app.data.interview ?? emptyInterview();
  const today = localDate(app.now());
  const [tab, setTab] = useState<Tab>('questions');
  const [run, setRun] = useState<Run | null>(null);
  const [finished, setFinished] = useState<boolean[] | null>(null);

  if (run) {
    return (
      <Practice
        key={run.position}
        interview={interview}
        run={run}
        onReveal={() => setRun({ ...run, revealed: true })}
        onRate={(confident) => {
          app.updateInterview((d) => ratePractice(d, run.refs[run.position], confident, today));
          const results = [...run.confident, confident];
          if (run.position === run.refs.length - 1) {
            setRun(null);
            setFinished(results);
          } else {
            setRun({ ...run, position: run.position + 1, revealed: false, confident: results });
          }
        }}
        onStop={() => {
          setRun(null);
          setFinished(run.confident.length > 0 ? run.confident : null);
        }}
      />
    );
  }

  if (finished) {
    return (
      <section className="view">
        <h1>Итог</h1>
        <p className="summary__score">
          Уверенно {finished.filter(Boolean).length} из {finished.length}
        </p>
        <p className="muted">Ответы, в которых вы не уверены, вернутся завтра. Тезисы к ним можно дописать во вкладке «Вопросы».</p>
        <div className="task__actions">
          <button type="button" className="button button--primary" onClick={() => setFinished(null)}>
            Готово
          </button>
        </div>
      </section>
    );
  }

  const pool = practicePool(interview, today, ORDER);
  const start = (refs: PracticeRef[]) => setRun({ refs, position: 0, revealed: false, confident: [] });

  return (
    <section className="view">
      <h1>Собеседование</h1>
      <p>
        Второй этап аттестации: комиссия смотрит аттестационную справку и задаёт вопросы. Запишите сюда вопросы, которые
        слышали на трансляциях и от коллег, и значения показателей своей школы, а потом отвечайте вслух.
      </p>

      <h2>Тренировка вслух</h2>
      {pool.all.length === 0 ? (
        <p className="muted">Тренировать пока нечего. Добавьте первый вопрос или заполните показатель школы.</p>
      ) : (
        <>
          {pool.due.length > 0 && (
            <div className="task__actions">
              <button type="button" className="button button--primary" onClick={() => start(pool.due)}>
                Повторить
              </button>
              <span>Пора повторить: {pool.due.length}</span>
            </div>
          )}
          {pool.fresh.length > 0 && (
            <div className="task__actions">
              <button
                type="button"
                className={pool.due.length ? 'button' : 'button button--primary'}
                onClick={() => start(pool.fresh.slice(0, NEW_BATCH))}
              >
                Взять новые
              </button>
              <span>Новых: {pool.fresh.length}</span>
            </div>
          )}
          {pool.due.length === 0 && pool.fresh.length === 0 && (
            <div className="task__actions">
              <button type="button" className="button" onClick={() => start(pool.all)}>
                Пройти всё ещё раз
              </button>
              <span>Повторять сегодня нечего.</span>
            </div>
          )}
        </>
      )}

      <div className="tabs" role="tablist" aria-label="Подготовка к собеседованию">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="tabs__tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.title}
          </button>
        ))}
      </div>

      {tab === 'questions' && <Questions interview={interview} today={today} update={app.updateInterview} />}
      {tab === 'indicators' && <Indicators interview={interview} update={app.updateInterview} />}
      {tab === 'memo' && <Memo />}
    </section>
  );
}

type Update = (fn: (interview: Interview) => Interview) => void;

function Practice({
  interview,
  run,
  onReveal,
  onRate,
  onStop,
}: {
  interview: Interview;
  run: Run;
  onReveal: () => void;
  onRate: (confident: boolean) => void;
  onStop: () => void;
}) {
  const active = useActiveSection();
  const ref = run.refs[run.position];
  const [seconds, setSeconds] = useState(0);

  // секундомер идёт, пока человек отвечает; на новом вопросе компонент создаётся заново
  useEffect(() => {
    if (run.revealed || !active) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [run.position, run.revealed, active]);

  const question = ref.kind === 'question' ? interview.questions.find((q) => q.id === ref.id) : undefined;
  const indicator = ref.kind === 'indicator' ? indicatorById(ref.id) : undefined;
  const note = ref.kind === 'indicator' ? interview.indicators[ref.id] : undefined;

  return (
    <section className="view">
      <p className="task__meta">
        <span>{ref.kind === 'question' ? 'Вопрос' : `Показатель ${ref.id}`}</span>
        <span className="task__position">
          {run.position + 1} из {run.refs.length}
        </span>
      </p>
      <div className="card" aria-live="polite">
        {question && <p className="card__front">{question.text}</p>}
        {indicator && (
          <>
            <p className="card__front">{indicator.title}</p>
            <p className="practice__ask">Назовите значение по школе, объясните его и скажите, что вы с ним сделаете.</p>
          </>
        )}
        {run.revealed && question && (
          <p className="card__back practice__theses">{question.theses || 'Тезисов пока нет. Допишите их во вкладке «Вопросы».'}</p>
        )}
        {run.revealed && note && (
          <div className="card__back">
            <p className="practice__theses">
              <strong>Значение:</strong> {note.value || 'не записано'}
            </p>
            {note.note && <p className="practice__theses">{note.note}</p>}
          </div>
        )}
      </div>
      <p className="muted practice__clock" aria-label="Время ответа">
        {clock(seconds)}
      </p>
      <div className="task__actions">
        {run.revealed ? (
          <>
            <button type="button" className="button button--primary" onClick={() => onRate(true)}>
              Ответил уверенно
            </button>
            <button type="button" className="button" onClick={() => onRate(false)}>
              Нужно повторить
            </button>
          </>
        ) : (
          <button type="button" className="button button--primary" onClick={onReveal}>
            Показать тезисы
          </button>
        )}
      </div>
      {!run.revealed && <p className="muted">Ответьте вслух, как перед комиссией, и только потом откройте тезисы.</p>}
      <div className="run__bar">
        <button type="button" className="link" onClick={onStop}>
          Закончить
        </button>
      </div>
    </section>
  );
}

const EMPTY_FORM = { text: '', theses: '', source: '' };

function Questions({ interview, today, update }: { interview: Interview; today: string; update: Update }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const submit = () => {
    if (!form.text.trim()) return;
    update((d) => (editing ? editQuestion(d, editing, form) : addQuestion(d, form, today)));
    setForm(EMPTY_FORM);
    setEditing(null);
  };
  const edit = (q: InterviewQuestion) => {
    setEditing(q.id);
    setRemoving(null);
    setForm({ text: q.text, theses: q.theses, source: q.source });
  };
  const cancel = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const list = [...interview.questions].reverse();
  const n = interview.questions.length;

  return (
    <div role="tabpanel" aria-label="Вопросы">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span>{editing ? 'Вопрос (правка)' : 'Новый вопрос'}</span>
          <textarea rows={2} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        </label>
        <label className="field">
          <span>Тезисы ответа</span>
          <textarea rows={5} value={form.theses} onChange={(e) => setForm({ ...form, theses: e.target.value })} />
        </label>
        <label className="field">
          <span>Откуда вопрос</span>
          <input
            type="text"
            placeholder="например, трансляция 24 ноября"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          />
        </label>
        <div className="task__actions">
          <button type="submit" className="button button--primary" disabled={!form.text.trim()}>
            {editing ? 'Сохранить' : 'Добавить вопрос'}
          </button>
          {editing && (
            <button type="button" className="button" onClick={cancel}>
              Отмена
            </button>
          )}
        </div>
      </form>

      <h2>
        {n === 0 ? 'Вопросов пока нет' : `${n} ${plural(n, 'вопрос', 'вопроса', 'вопросов')}`}
      </h2>
      {n === 0 && (
        <p className="muted">
          Готовых «вопросов комиссии» в программе нет: официально их никто не публикует. Самый надёжный источник это записи
          заседаний, адрес есть в памятке.
        </p>
      )}
      <ul className="qlist">
        {list.map((q) => (
          <li key={q.id} className="qlist__item">
            <p className="qlist__text">{q.text}</p>
            {q.theses ? <p className="qlist__theses">{q.theses}</p> : <p className="muted">Тезисов пока нет.</p>}
            <p className="muted qlist__meta">
              {q.source && <span>{q.source}</span>}
              <button type="button" className="link" onClick={() => edit(q)}>
                Изменить
              </button>
              {removing === q.id ? (
                <>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      update((d) => removeQuestion(d, q.id));
                      setRemoving(null);
                      if (editing === q.id) cancel();
                    }}
                  >
                    Да, удалить
                  </button>
                  <button type="button" className="link" onClick={() => setRemoving(null)}>
                    Оставить
                  </button>
                </>
              ) : (
                <button type="button" className="link" onClick={() => setRemoving(q.id)}>
                  Удалить
                </button>
              )}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IndicatorRow({ indicator, interview, update }: { indicator: Indicator; interview: Interview; update: Update }) {
  const saved = interview.indicators[indicator.id];
  const [value, setValue] = useState(saved?.value ?? '');
  const [note, setNote] = useState(saved?.note ?? '');
  // записи заменили извне (загрузили файл прогресса): поля показывают новое
  const savedValue = saved?.value ?? '';
  const savedNote = saved?.note ?? '';
  const [seen, setSeen] = useState({ value: savedValue, note: savedNote });
  if (seen.value !== savedValue || seen.note !== savedNote) {
    setSeen({ value: savedValue, note: savedNote });
    if (value.trim() !== savedValue) setValue(savedValue);
    if (note.trim() !== savedNote) setNote(savedNote);
  }
  // запись идёт, когда человек вышел из поля: не на каждую букву
  const commit = () => update((d) => setIndicator(d, indicator.id, value, note));

  return (
    <li className="indicator">
      <p className="indicator__title">
        <span className="indicator__no">{indicator.id}</span> {indicator.title}
      </p>
      {indicator.parts && <p className="muted indicator__parts">Из них: {indicator.parts.join('; ')}.</p>}
      <div className="indicator__fields">
        <label className="field field--narrow">
          <span>Значение по школе</span>
          <input
            type="text"
            aria-label={`Значение показателя ${indicator.id}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
          />
        </label>
        <label className="field">
          <span>Почему так и что с этим делать</span>
          <textarea
            rows={2}
            aria-label={`Заметка к показателю ${indicator.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={commit}
          />
        </label>
      </div>
    </li>
  );
}

function Indicators({ interview, update }: { interview: Interview; update: Update }) {
  const filled = ALL_INDICATORS.filter((i) => interview.indicators[i.id]).length;
  return (
    <div role="tabpanel" aria-label="Показатели школы">
      <p>
        Эти показатели попадают в аттестационную справку из городских систем. Впишите значения своей школы и короткое
        объяснение к каждому: заполненные показатели появятся в тренировке вслух. Записи хранятся только на этом компьютере.
      </p>
      <p className="muted">
        Заполнено {filled} из {ALL_INDICATORS.length}. {INDICATORS_SOURCE}
      </p>
      {INDICATOR_GROUPS.map((group) => (
        <div key={group.id}>
          <h2>
            {group.id}. {group.title}
          </h2>
          <ul className="indicators">
            {group.items.map((item, i) => (
              <Fragment key={item.id}>
                {item.heading && item.heading !== group.items[i - 1]?.heading && (
                  <li className="indicators__heading">{item.heading}</li>
                )}
                <IndicatorRow indicator={item} interview={interview} update={update} />
              </Fragment>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Memo() {
  return (
    <div role="tabpanel" aria-label="Памятка">
      {PROCEDURE.map((block) => (
        <div key={block.title}>
          <h2>{block.title}</h2>
          <ul className="plain memo">
            {block.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ))}
      <p className="muted">{PROCEDURE_SOURCE}</p>
    </div>
  );
}
