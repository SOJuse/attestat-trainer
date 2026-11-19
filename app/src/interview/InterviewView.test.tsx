import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserData } from '../core/progress';
import { makePack, seeded } from '../core/testPack';
import { createFakePlatform, createFakeStore } from '../platform/fake';
import { AppDataProvider } from '../state/AppData';
import { ALL_INDICATORS } from './indicators';
import { InterviewView } from './InterviewView';

const NOW = new Date(2026, 10, 19, 10, 0, 0);

function mount(store = createFakeStore()) {
  const platform = createFakePlatform({ store, tasks: { current: async () => makePack(2) } });
  render(
    <AppDataProvider platform={platform} now={() => NOW} random={seeded(3)}>
      <InterviewView />
    </AppDataProvider>,
  );
  return store;
}
const saved = (store: { text: string | null }) => JSON.parse(store.text!) as UserData;

describe('InterviewView', () => {
  it('в перечне все показатели распоряжения, номера не повторяются', () => {
    const ids = ALL_INDICATORS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(66);
    expect(ids[0]).toBe('1');
    expect(ids[ids.length - 1]).toBe('37');
  });

  it('вопрос добавляется, правится и удаляется с подтверждением', async () => {
    const store = mount();
    expect(await screen.findByText(/Тренировать пока нечего/)).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Добавить вопрос' });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Новый вопрос'), 'Почему упала сохранность контингента?');
    await userEvent.type(screen.getByLabelText('Тезисы ответа'), 'Причины и план');
    await userEvent.click(add);
    expect(screen.getByRole('heading', { name: '1 вопрос' })).toBeInTheDocument();
    expect(saved(store).interview?.questions[0]).toMatchObject({ id: 'q1', theses: 'Причины и план', created: '2026-11-19' });

    await userEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await userEvent.type(screen.getByLabelText('Откуда вопрос'), 'коллега');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(saved(store).interview?.questions[0].source).toBe('коллега');

    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(saved(store).interview?.questions).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Да, удалить' }));
    expect(saved(store).interview?.questions).toEqual([]);
  });

  it('показатель сохраняется при выходе из поля и попадает в тренировку', async () => {
    const store = mount();
    await userEvent.click(await screen.findByRole('tab', { name: 'Показатели школы' }));
    expect(screen.getByText(/Заполнено 0 из 66/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Значение показателя 9'), '2');
    await userEvent.type(screen.getByLabelText('Заметка к показателю 9'), 'Вторая группа рейтинга');
    await userEvent.tab();
    expect(saved(store).interview?.indicators['9']).toEqual({ value: '2', note: 'Вторая группа рейтинга' });
    expect(screen.getByText(/Заполнено 1 из 66/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Взять новые' }));
    expect(screen.getByText('Показатель 9')).toBeInTheDocument();
    expect(screen.queryByText('Вторая группа рейтинга')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Показать тезисы' }));
    expect(screen.getByText('Вторая группа рейтинга')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Нужно повторить' }));
    expect(await screen.findByText('Уверенно 0 из 1')).toBeInTheDocument();
    expect(saved(store).interview?.indicators['9'].srs).toEqual({ box: 0, due: '2026-11-20' });
  });

  it('тренировка идёт по вопросам, оценка ставит их в очередь', async () => {
    const store = mount();
    for (const text of ['Первый вопрос', 'Второй вопрос']) {
      await userEvent.type(await screen.findByLabelText('Новый вопрос'), text);
      await userEvent.click(screen.getByRole('button', { name: 'Добавить вопрос' }));
    }
    expect(screen.getByText('Новых: 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Взять новые' }));
    expect(screen.getByText('1 из 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ответил уверенно' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Показать тезисы' }));
    expect(screen.getByText(/Тезисов пока нет/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ответил уверенно' }));
    await userEvent.click(screen.getByRole('button', { name: 'Закончить' }));
    expect(screen.getByText('Уверенно 1 из 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.getByText('Новых: 1')).toBeInTheDocument();
    const [first, second] = saved(store).interview!.questions;
    expect(first.srs).toEqual({ box: 0, due: '2026-11-20' });
    expect(second.srs).toBeUndefined();
  });

  it('памятка открывается вкладкой', async () => {
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: 'Памятка' }));
    const panel = screen.getByRole('tabpanel', { name: 'Памятка' });
    expect(within(panel).getByRole('heading', { name: 'На заседании' })).toBeInTheDocument();
    expect(within(panel).getByText(/не позднее чем за 3 рабочих дня/)).toBeInTheDocument();
  });
});
