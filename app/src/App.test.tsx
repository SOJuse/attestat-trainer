import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createFakePlatform } from './platform/fake';

describe('App', () => {
  it('показывает шесть разделов по порядку', () => {
    render(<App platform={createFakePlatform()} />);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Сегодня', 'Тренировка', 'Экзамен', 'Карточки', 'Библиотека', 'Прогресс',
    ]);
  });

  it('открывает «Сегодня» при запуске и переключает раздел по клику', async () => {
    render(<App platform={createFakePlatform()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Сегодня');
    await userEvent.click(screen.getByRole('button', { name: 'Карточки' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Карточки');
    expect(screen.getByRole('button', { name: 'Карточки' })).toHaveAttribute('aria-current', 'page');
  });

  it('показывает логотип школы', () => {
    render(<App platform={createFakePlatform()} />);
    expect(screen.getByAltText('Школа № 1103')).toBeInTheDocument();
  });
});

it('открывает настройки по кнопке внизу панели', async () => {
  render(<App platform={createFakePlatform({ appVersion: async () => '0.1.0' })} />);
  await userEvent.click(screen.getByRole('button', { name: 'Настройки' }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Настройки');
  expect(await screen.findByText('Версия программы: 0.1.0')).toBeInTheDocument();
});

describe('App: библиотека', () => {
  it('открывает раздел «Библиотека» со строкой поиска', async () => {
    render(<App platform={createFakePlatform()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Библиотека' }));
    expect(await screen.findByRole('searchbox', { name: 'Поиск по документам' })).toBeInTheDocument();
  });

  it('установленную библиотеку молча обновляет при запуске', async () => {
    const update = vi.fn(async () => 'up-to-date' as const);
    render(<App platform={createFakePlatform({ library: { update } })} />);
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
  });

  it('не установленную при запуске не трогает и ошибок не показывает', async () => {
    const update = vi.fn(async () => 'installed' as const);
    const status = vi.fn(async () => ({ installed: false, packVersion: null, docs: 0 }));
    render(<App platform={createFakePlatform({ library: { update, status } })} />);
    await waitFor(() => expect(status).toHaveBeenCalled());
    expect(update).not.toHaveBeenCalled();
  });

  it('сбой молчаливого обновления не мешает работе', async () => {
    const update = vi.fn(async () => Promise.reject(new Error('offline')));
    render(<App platform={createFakePlatform({ library: { update } })} />);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Сегодня');
  });
});
