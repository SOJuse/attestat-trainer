import { useState } from 'react';
import { emptyUserData, exportUserData, importUserData, reconcile, UserDataError, type UserData } from '../core/progress';
import { plural } from '../core/plural';
import type { Platform } from '../platform/Platform';
import { useAppData } from '../state/AppData';

const MIN = 5;
const MAX = 50;
const WORD = 'сбросить';

const IMPORT_ERRORS: Record<UserDataError['code'], string> = {
  'not-json': 'Это не файл прогресса тренажёра. Текущий прогресс не изменён.',
  'wrong-shape': 'Файл не подошёл: в нём нет данных прогресса или он повреждён. Текущий прогресс не изменён.',
  'newer-schema': 'Файл сохранён более новой версией программы. Обновите программу и загрузите его снова.',
};

type Dialog = { kind: 'none' } | { kind: 'import'; data: UserData } | { kind: 'reset'; typed: string };

/** Настройки занятий и перенос прогресса. Живёт внутри AppDataProvider. */
export function ProgressSettings({ platform }: { platform: Platform }) {
  const app = useAppData();
  const { data, pack } = app;
  const [size, setSize] = useState(String(data.settings.dailySize));
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const [message, setMessage] = useState('');

  const sizeNumber = Number(size);
  const sizeValid = /^\d+$/.test(size.trim()) && sizeNumber >= MIN && sizeNumber <= MAX;

  const changeSize = (text: string) => {
    setSize(text);
    const n = Number(text);
    if (/^\d+$/.test(text.trim()) && n >= MIN && n <= MAX) app.setSettings({ ...data.settings, dailySize: n });
  };

  const save = async () => {
    setMessage('');
    const now = app.now();
    try {
      const saved = await platform.saveFile(`attestat-progress-${now.toISOString().slice(0, 10)}.json`, exportUserData(data, now));
      if (saved) setMessage('Файл сохранён.');
    } catch {
      setMessage('Не удалось сохранить файл.');
    }
  };

  const pick = async () => {
    setMessage('');
    let text: string | null;
    try {
      text = await platform.pickFile();
    } catch {
      setMessage('Не удалось прочитать файл.');
      return;
    }
    if (text === null) return;
    try {
      setDialog({ kind: 'import', data: importUserData(text) });
    } catch (e) {
      setMessage(e instanceof UserDataError ? IMPORT_ERRORS[e.code] : IMPORT_ERRORS['wrong-shape']);
    }
  };

  const confirmImport = (incoming: UserData) => {
    // незаконченная сессия из файла могла быть начата на другой базе: её не переносим
    const next = { ...incoming };
    delete next.draft;
    app.replaceData(reconcile(next, pack));
    setSize(String(next.settings.dailySize));
    setDialog({ kind: 'none' });
    setMessage('Прогресс загружен.');
  };

  const confirmReset = () => {
    app.replaceData({ ...emptyUserData(), settings: data.settings });
    setDialog({ kind: 'none' });
    setMessage('Прогресс сброшен.');
  };

  const answers = (n: number) => `${n} ${plural(n, 'ответ', 'ответа', 'ответов')}`;

  return (
    <>
      <h2>Занятия</h2>
      <label className="settings__field">
        <span>Заданий в ежедневной сессии</span>
        <input
          type="text"
          inputMode="numeric"
          className="number__field"
          aria-label="Заданий в ежедневной сессии"
          aria-invalid={!sizeValid}
          value={size}
          onChange={(e) => changeSize(e.target.value)}
        />
      </label>
      {!sizeValid && (
        <p className="settings__hint" role="alert">
          Введите число от {MIN} до {MAX}.
        </p>
      )}

      <h2>Прогресс</h2>
      <p>
        Прогресс хранится на этом компьютере. Чтобы перенести его на другой, сохраните файл здесь и загрузите там.
      </p>
      <div className="task__actions">
        <button type="button" className="button" onClick={() => void save()}>
          Сохранить прогресс в файл
        </button>
        <button type="button" className="button" onClick={() => void pick()}>
          Загрузить прогресс из файла
        </button>
        <button type="button" className="button" onClick={() => setDialog({ kind: 'reset', typed: '' })}>
          Сбросить прогресс
        </button>
      </div>

      {dialog.kind === 'import' && (
        <div className="confirm" role="alertdialog" aria-label="Загрузка прогресса">
          <p>
            Текущий прогресс ({answers(data.attempts.length)}) будет заменён прогрессом из файла ({answers(dialog.data.attempts.length)}).
            Вернуть его можно будет только из сохранённого файла.
          </p>
          <div className="task__actions">
            <button type="button" className="button button--primary" onClick={() => confirmImport(dialog.data)}>
              Заменить
            </button>
            <button type="button" className="button" onClick={() => setDialog({ kind: 'none' })}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {dialog.kind === 'reset' && (
        <div className="confirm" role="alertdialog" aria-label="Сброс прогресса">
          <p>Все ответы, очередь повторений и история экзаменов будут удалены. Чтобы подтвердить, введите слово «{WORD}».</p>
          <input
            type="text"
            className="number__field settings__word"
            aria-label="Слово для подтверждения"
            autoComplete="off"
            value={dialog.typed}
            onChange={(e) => setDialog({ kind: 'reset', typed: e.target.value })}
          />
          <div className="task__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={dialog.typed.trim().toLowerCase() !== WORD}
              onClick={confirmReset}
            >
              Сбросить
            </button>
            <button type="button" className="button" onClick={() => setDialog({ kind: 'none' })}>
              Отмена
            </button>
          </div>
        </div>
      )}

      <p className="settings__check" role="status">
        {message}
      </p>
    </>
  );
}
