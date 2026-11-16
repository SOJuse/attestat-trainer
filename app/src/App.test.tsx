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
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Сегодня');
    await userEvent.click(screen.getByRole('button', { name: 'Карточки' }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Карточки');
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
  expect(await screen.findByRole('button', { name: 'Сохранить прогресс в файл' })).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Сегодня');
  });
});

describe('App: тренировка и библиотека', () => {
  it('из разбора задания открывает библиотеку, а тренировка остаётся на том же месте', async () => {
    const { makePack } = await import('./core/testPack');
    const doc = vi.fn(async () => ({
      info: {
        id: 'tk-rf', title: 'Трудовой кодекс', short: 'ТК РФ', kind: 'federal-law', number: null, date: null, edition: null,
        sourceUrl: null, fetched: null, modules: ['K'], textStatus: 'full' as const, note: null, listNo: 8,
        editionStatus: 'current' as const, amendedBy: [],
      },
      sections: [{ anchor: 'st-1', heading: 'Статья 1', ord: 0 }],
    }));
    const platform = createFakePlatform({
      tasks: { current: async () => makePack(2) },
      library: { doc, sections: async () => [{ anchor: 'st-1', heading: 'Статья 1', ord: 0, text: 'Текст нормы.', context: '' }] },
    });
    render(<App platform={platform} />);
    await userEvent.click(screen.getByRole('button', { name: 'Тренировка' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    await userEvent.click(await screen.findByRole('radio', { name: /^\d\s?верный$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    await userEvent.click(screen.getByRole('button', { name: 'Открыть в библиотеке' }));
    expect(await screen.findByText('Текст нормы.')).toBeInTheDocument();
    expect(doc).toHaveBeenCalledWith('tk-rf');
    await userEvent.click(screen.getByRole('button', { name: 'Тренировка' }));
    expect(screen.getByText('Задание 1 из 10')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Верно');
  });
});
