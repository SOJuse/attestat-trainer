import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

describe('App', () => {
  it('показывает шесть разделов по порядку', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Сегодня', 'Тренировка', 'Экзамен', 'Карточки', 'Библиотека', 'Прогресс',
    ]);
  });

  it('открывает «Сегодня» при запуске и переключает раздел по клику', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Сегодня');
    await userEvent.click(screen.getByRole('button', { name: 'Библиотека' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Библиотека');
    expect(screen.getByRole('button', { name: 'Библиотека' })).toHaveAttribute('aria-current', 'page');
  });

  it('показывает логотип школы', () => {
    render(<App />);
    expect(screen.getByAltText('Школа № 1103')).toBeInTheDocument();
  });
});
