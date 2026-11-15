import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFakePlatform } from '../platform/fake';
import { SettingsView } from './SettingsView';

describe('SettingsView', () => {
  it('показывает версию программы и оговорку', async () => {
    render(<SettingsView platform={createFakePlatform({ appVersion: async () => '0.1.0' })} />);
    expect(await screen.findByText('Версия программы: 0.1.0')).toBeInTheDocument();
    expect(screen.getByText(/не связан с Корпоративным университетом/)).toBeInTheDocument();
  });

  it('ссылка на репозиторий открывается через платформу', async () => {
    const openExternal = vi.fn(async () => {});
    render(<SettingsView platform={createFakePlatform({ openExternal })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Открыть страницу проекта' }));
    expect(openExternal).toHaveBeenCalledWith('https://github.com/SOJuse/attestat-trainer');
  });
});

describe('SettingsView: проверка обновлений', () => {
  it('сообщает, что версия последняя', async () => {
    render(<SettingsView platform={createFakePlatform()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Проверить обновления' }));
    expect(await screen.findByText('У вас последняя версия.')).toBeInTheDocument();
  });

  it('сообщает, если проверить не удалось', async () => {
    const platform = createFakePlatform({
      checkAppUpdate: async () => {
        throw new Error('offline');
      },
    });
    render(<SettingsView platform={platform} />);
    await userEvent.click(screen.getByRole('button', { name: 'Проверить обновления' }));
    expect(await screen.findByText(/Не удалось проверить обновления/)).toBeInTheDocument();
  });

  it('показывает найденную версию', async () => {
    const platform = createFakePlatform({ checkAppUpdate: async () => ({ version: '0.2.0' }) });
    render(<SettingsView platform={platform} />);
    await userEvent.click(screen.getByRole('button', { name: 'Проверить обновления' }));
    expect(await screen.findByText('Доступна версия 0.2.0')).toBeInTheDocument();
  });
});
