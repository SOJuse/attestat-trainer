import { useEffect, useState } from 'react';
import type { AppUpdate, Platform } from '../platform/Platform';
import { UpdateOffer } from './UpdateOffer';

/** Один раз при запуске проверяет обновление. Без сети и при ошибке молчит. */
export function UpdateBanner({ platform }: { platform: Platform }) {
  const [update, setUpdate] = useState<AppUpdate | null>(null);

  useEffect(() => {
    let alive = true;
    platform
      .checkAppUpdate()
      .then((found) => {
        if (alive) setUpdate(found);
      })
      .catch(() => {
        // Нет сети или релизов: это не повод беспокоить человека при запуске.
      });
    return () => {
      alive = false;
    };
  }, [platform]);

  return update ? <UpdateOffer platform={platform} update={update} /> : null;
}
