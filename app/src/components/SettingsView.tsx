import { useEffect, useState } from 'react';
import type { Platform } from '../platform/Platform';

const REPO_URL = 'https://github.com/SOJuse/attestat-trainer';

export function SettingsView({ platform }: { platform: Platform }) {
  const [version, setVersion] = useState<string | null>(null);

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
