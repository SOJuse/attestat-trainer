import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  applyAnswer,
  emptyUserData,
  hasDraft,
  parseUserData,
  reconcile,
  setHidden,
  type Draft,
  type DraftSlot,
  type ExamRecord,
  type Mode,
  type UserData,
} from '../core/progress';
import type { TasksPack } from '../core/taskSchema';
import type { DocInfo } from '../platform/Library';
import type { Platform } from '../platform/Platform';

/** Как часто открытая программа проверяет, не вышла ли новая база. */
const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;

export type AppData = {
  pack: TasksPack;
  data: UserData;
  /** документы библиотеки по id: названия и пометка «распознан со скана» для цитат */
  docs: Record<string, DocInfo>;
  now: () => Date;
  random: () => number;
  answer: (a: { id: string; revision: number; correct: boolean; mode: Mode }) => void;
  hide: (id: string) => void;
  setDraft: (slot: DraftSlot, draft: Draft | undefined) => void;
  /** Завершает экзамен одной записью: ответы, строка истории, черновик снят. */
  finishExam: (record: ExamRecord, answers: { id: string; revision: number; correct: boolean }[]) => void;
  setSettings: (settings: UserData['settings']) => void;
  replaceData: (data: UserData) => void;
};

const Context = createContext<AppData | null>(null);

export function useAppData(): AppData {
  const value = useContext(Context);
  if (!value) throw new Error('useAppData вызван вне AppDataProvider');
  return value;
}

type Props = { platform: Platform; children: ReactNode; now?: () => Date; random?: () => number };

type State =
  | { kind: 'loading' }
  | { kind: 'no-pack' }
  | { kind: 'corrupt'; pack: TasksPack; /** null — файл есть, но прочитать его не удалось */ text: string | null; confirming: boolean }
  | { kind: 'ready'; pack: TasksPack; data: UserData };

const realNow = () => new Date();

/**
 * Загружает базу заданий и прогресс, отдаёт их вниз и сохраняет прогресс после каждого изменения.
 * Данные в памяти — главные: если запись не удалась, они не теряются, а человек видит строку с повтором.
 */
export function AppDataProvider({ platform, children, now = realNow, random = Math.random }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [saveFailed, setSaveFailed] = useState(false);
  const [docs, setDocs] = useState<Record<string, DocInfo>>({});
  // последнее состояние прогресса и очередь записей: записи идут строго по порядку
  const latest = useRef<UserData | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const persist = useCallback(
    (data: UserData) => {
      latest.current = data;
      queue.current = queue.current
        .then(() => platform.store.save(JSON.stringify(data)))
        .then(
          () => setSaveFailed(false),
          () => setSaveFailed(true),
        );
    },
    [platform],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      let pack: TasksPack;
      try {
        pack = await platform.tasks.current();
      } catch {
        if (alive) setState({ kind: 'no-pack' });
        return;
      }
      let text: string | null;
      try {
        text = await platform.store.load();
      } catch {
        // файл есть, но не читается: начинать с нуля нельзя, первый же ответ затёр бы его
        if (alive) setState({ kind: 'corrupt', pack, text: null, confirming: false });
        return;
      }
      if (!alive) return;
      if (text === null) {
        setState({ kind: 'ready', pack, data: emptyUserData() });
        return;
      }
      let data: UserData;
      try {
        data = parseUserData(JSON.parse(text));
      } catch {
        // файл не читается: не трогаем его и спрашиваем человека
        setState({ kind: 'corrupt', pack, text, confirming: false });
        return;
      }
      const reconciled = reconcile(data, pack);
      setState({ kind: 'ready', pack, data: reconciled });
      if (reconciled !== data) persist(reconciled);
    })();
    return () => {
      alive = false;
    };
  }, [platform, persist]);

  // библиотека нужна только для подписей к цитатам; без неё всё работает
  useEffect(() => {
    let alive = true;
    platform.library
      .list()
      .then((list) => alive && setDocs(Object.fromEntries(list.map((d) => [d.id, d]))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [platform]);

  // обновление базы: при запуске и раз в сутки; новая база не подменяется посреди сессии или экзамена
  const ready = state.kind === 'ready';
  // новая база скачана и ждёт, пока закончатся сессия и тест
  const [pendingPack, setPendingPack] = useState(false);
  const busy = state.kind === 'ready' && hasDraft(state.data);
  useEffect(() => {
    if (!pendingPack || !ready || busy) return;
    let alive = true;
    platform.tasks
      .current()
      .then((pack) => {
        if (!alive) return;
        setPendingPack(false);
        setState((prev) => {
          if (prev.kind !== 'ready' || hasDraft(prev.data)) return prev;
          const data = reconcile(prev.data, pack);
          if (data !== prev.data) persist(data);
          return { kind: 'ready', pack, data };
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pendingPack, ready, busy, platform, persist]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const check = async () => {
      try {
        if ((await platform.tasks.update()) === 'installed' && alive) setPendingPack(true);
      } catch {
        // нет сети или пакет не прошёл проверку: остаёмся на прежней базе
      }
    };
    void check();
    const timer = setInterval(check, UPDATE_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [ready, platform]);

  const change = useCallback(
    (fn: (data: UserData) => UserData) => {
      setState((prev) => {
        if (prev.kind !== 'ready') return prev;
        const data = fn(prev.data);
        if (data === prev.data) return prev;
        persist(data);
        return { ...prev, data };
      });
    },
    [persist],
  );

  useEffect(() => {
    if (state.kind === 'ready') latest.current = state.data;
  }, [state]);

  const actions = useMemo(
    () => ({
      answer: (a: { id: string; revision: number; correct: boolean; mode: Mode }) =>
        change((d) => applyAnswer(d, { ...a, now: now() })),
      hide: (id: string) => change((d) => setHidden(d, id, true)),
      setDraft: (slot: DraftSlot, draft: Draft | undefined) =>
        change((d) => {
          const drafts = { ...d.drafts };
          if (draft) drafts[slot] = draft;
          else if (drafts[slot]) delete drafts[slot];
          else return d;
          return { ...d, drafts };
        }),
      finishExam: (record: ExamRecord, answers: { id: string; revision: number; correct: boolean }[]) =>
        change((d) => {
          const at = now();
          let next = d;
          for (const a of answers) next = applyAnswer(next, { ...a, mode: 'exam', now: at });
          const drafts = { ...next.drafts };
          delete drafts.exam;
          return { ...next, exams: [...next.exams, record], drafts };
        }),
      setSettings: (settings: UserData['settings']) => change((d) => ({ ...d, settings })),
      replaceData: (data: UserData) => change(() => data),
    }),
    [change, now],
  );

  if (state.kind === 'loading') return <section className="view" aria-busy="true" />;

  if (state.kind === 'no-pack') {
    return (
      <section className="view">
        <h1>Не удалось загрузить базу заданий</h1>
        <p>Перезапустите программу. Если это повторится, установите её заново со страницы проекта.</p>
      </section>
    );
  }

  if (state.kind === 'corrupt') {
    const { pack, text, confirming } = state;
    const stamp = now().toISOString().slice(0, 10);
    const startOver = () => {
      const data = emptyUserData();
      setState({ kind: 'ready', pack, data });
      persist(data);
    };
    return (
      <section className="view">
        <h1>Файл с прогрессом не читается</h1>
        {text === null ? (
          <p>
            Программа не смогла открыть файл с прогрессом и не трогала его. Закройте программу и откройте снова.
            Если это повторится, можно начать с чистого листа, но прежний прогресс тогда пропадёт.
          </p>
        ) : (
          <p>
            Он повреждён или сохранён более новой версией программы. Программа его не трогала. Сохраните копию,
            чтобы прогресс можно было восстановить, а затем начните с чистого листа или обновите программу.
          </p>
        )}
        <div className="task__actions">
          {text !== null && (
            <button
              type="button"
              className="button"
              onClick={() => void platform.saveFile(`attestat-progress-povrezhdennyj-${stamp}.json`, text).catch(() => {})}
            >
              Сохранить копию файла
            </button>
          )}
          {!confirming && (
            <button type="button" className="button" onClick={() => setState({ ...state, confirming: true })}>
              Начать с чистого листа
            </button>
          )}
        </div>
        {confirming && (
          <div className="confirm" role="alertdialog" aria-label="Подтверждение">
            <p>Прежний файл будет заменён пустым. Если копии нет, прогресс вернуть не получится.</p>
            <div className="task__actions">
              <button type="button" className="button button--primary" onClick={startOver}>
                Да, начать заново
              </button>
              <button type="button" className="button" onClick={() => setState({ ...state, confirming: false })}>
                Отмена
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  const value: AppData = { pack: state.pack, data: state.data, docs, now, random, ...actions };
  return (
    <Context.Provider value={value}>
      {saveFailed && (
        <div className="update" role="alert">
          <span className="update__error">Не удалось сохранить прогресс. Ответы пока хранятся только в памяти программы.</span>
          <button type="button" className="button" onClick={() => latest.current && persist(latest.current)}>
            Повторить
          </button>
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
