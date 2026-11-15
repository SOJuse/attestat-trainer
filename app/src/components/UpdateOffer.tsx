import { useState } from 'react';
import type { AppUpdate, Platform } from '../platform/Platform';

type State =
  | { kind: 'idle' }
  | { kind: 'installing'; fraction: number }
  | { kind: 'failed' };

/** Строка «Доступна версия X» с кнопкой установки, ходом загрузки и повтором при сбое. */
export function UpdateOffer({ platform, update }: { platform: Platform; update: AppUpdate }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function install() {
    setState({ kind: 'installing', fraction: 0 });
    try {
      await platform.installAppUpdate((fraction) => setState({ kind: 'installing', fraction }));
    } catch {
      setState({ kind: 'failed' });
    }
  }

  return (
    <div className="update" role="status">
      <span>Доступна версия {update.version}</span>
      {state.kind === 'idle' && (
        <button type="button" className="button button--primary" onClick={install}>
          Обновить
        </button>
      )}
      {state.kind === 'installing' && <span>Загрузка: {Math.round(state.fraction * 100)}%</span>}
      {state.kind === 'failed' && (
        <>
          <span className="update__error">Не удалось обновить. Программа работает как раньше.</span>
          <button type="button" className="button" onClick={install}>
            Повторить
          </button>
        </>
      )}
    </div>
  );
}
