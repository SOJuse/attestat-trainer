import { useEffect, useState } from 'react';
import type { AppUpdate, Platform } from '../platform/Platform';
import { UpdateOffer } from './UpdateOffer';

const REPO_URL = 'https://github.com/SOJuse/attestat-trainer';

type Check =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'latest' }
  | { kind: 'failed' }
  | { kind: 'found'; update: AppUpdate };

export function SettingsView({ platform }: { platform: Platform }) {
  const [version, setVersion] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>({ kind: 'idle' });

  async function checkUpdates() {
    setCheck({ kind: 'checking' });
    try {
      const update = await platform.checkAppUpdate();
      setCheck(update ? { kind: 'found', update } : { kind: 'latest' });
    } catch {
      setCheck({ kind: 'failed' });
    }
  }

  useEffect(() => {
    let alive = true;
    platform.appVersion().then((v) => {
      if (alive) setVersion(v);
    });
    return () => {
      alive = false;
    };
  }, [platform]);

  return (
    <section className="view">
      <h1>Настройки</h1>

      <h2>Обновления</h2>
      <button
        type="button"
        className="button"
        disabled={check.kind === 'checking'}
        onClick={checkUpdates}
      >
        Проверить обновления
      </button>
      <div className="settings__check" aria-live="polite">
        {check.kind === 'latest' && <p>У вас последняя версия.</p>}
        {check.kind === 'failed' && (
          <p>Не удалось проверить обновления. Проверьте подключение к интернету.</p>
        )}
        {check.kind === 'found' && <UpdateOffer platform={platform} update={check.update} />}
      </div>

      <h2>О программе</h2>
      {version !== null && <p>Версия программы: {version}</p>}
      <p className="muted">
        Тренажёр неофициальный. Он не связан с Корпоративным университетом московского образования
        и Департаментом образования и науки города Москвы. Задания авторские, из экзаменационного
        банка они не взяты.
      </p>
      <button type="button" className="button" onClick={() => platform.openExternal(REPO_URL)}>
        Открыть страницу проекта
      </button>
    </section>
  );
}
