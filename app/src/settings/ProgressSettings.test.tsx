import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyAnswer, emptyUserData, exportUserData, type UserData } from '../core/progress';
import { makePack } from '../core/testPack';
import { createFakePlatform, createFakeStore } from '../platform/fake';
import type { Platform } from '../platform/Platform';
import { AppDataProvider } from '../state/AppData';
import { ProgressSettings } from './ProgressSettings';

const NOW = new Date('2026-11-20T10:00:00');
const pack = makePack(2);

function withAnswers(n: number): UserData {
  let data = emptyUserData();
  for (let i = 0; i < n; i++) data = applyAnswer(data, { id: pack.tasks[i].id, revision: 1, correct: true, mode: 'training', now: NOW });
  return data;
}

function setup(over: Partial<Platform> = {}, initial: UserData = withAnswers(3)) {
  const store = createFakeStore(JSON.stringify(initial));
  const platform = createFakePlatform({ store, tasks: { current: async () => pack }, ...over });
  render(
    <AppDataProvider platform={platform} now={() => NOW}>
      <ProgressSettings platform={platform} />
    </AppDataProvider>,
  );
  const saved = () => JSON.parse(store.text ?? 'null') as UserData;
  return { store, platform, saved };
}

describe('настройки занятий', () => {
  it('размер ежедневной сессии сохраняется', async () => {
    const { saved } = setup();
    const field = await screen.findByRole('textbox', { name: 'Заданий в ежедневной сессии' });
    expect(field).toHaveValue('20');
    await userEvent.clear(field);
    await userEvent.type(field, '35');
    await waitFor(() => expect(saved().settings.dailySize).toBe(35));
  });

  it('число вне границ не сохраняется, человек видит подсказку', async () => {
    const { saved } = setup();
    const field = await screen.findByRole('textbox', { name: 'Заданий в ежедневной сессии' });
    await userEvent.clear(field);
    await userEvent.type(field, '70');
    expect(screen.getByRole('alert')).toHaveTextContent('от 5 до 50');
    expect(saved().settings.dailySize).not.toBe(70);
  });
});

describe('перенос прогресса', () => {
  it('сохраняет прогресс в файл с датой в имени', async () => {
    const saveFile = vi.fn(async () => true);
    setup({ saveFile });
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить прогресс в файл' }));
    expect(await screen.findByText('Файл сохранён.')).toBeInTheDocument();
    const [name, text] = saveFile.mock.calls[0] as unknown as [string, string];
    expect(name).toBe('attestat-progress-2026-11-20.json');
    expect(JSON.parse(text).attempts).toHaveLength(3);
  });

  it('отмена в диалоге сохранения ничего не сообщает', async () => {
    setup({ saveFile: async () => false });
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить прогресс в файл' }));
    expect(screen.queryByText('Файл сохранён.')).not.toBeInTheDocument();
  });

  it('загружает прогресс из файла после подтверждения', async () => {
    const file = exportUserData({ ...withAnswers(1), drafts: { daily: { kind: 'daily', ids: ['x'], answers: [null], position: 0, startedAt: 1, packVersion: 'old' } } }, NOW);
    const { saved } = setup({ pickFile: async () => file });
    await userEvent.click(await screen.findByRole('button', { name: 'Загрузить прогресс из файла' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Загрузка прогресса' });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveTextContent('3 ответа');
    expect(dialog).toHaveTextContent('1 ответ)');
    expect(saved().attempts).toHaveLength(3);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Заменить' }));
    expect(await screen.findByText('Прогресс загружен.')).toBeInTheDocument();
    await waitFor(() => expect(saved().attempts).toHaveLength(1));
    expect(saved().drafts).toEqual({});
  });

  it('отмена подтверждения оставляет прежний прогресс', async () => {
    const { saved } = setup({ pickFile: async () => exportUserData(withAnswers(1), NOW) });
    await userEvent.click(await screen.findByRole('button', { name: 'Загрузить прогресс из файла' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(saved().attempts).toHaveLength(3);
  });

  it.each([
    ['не json', 'Это не файл прогресса'],
    ['{"schema":1,"что-то":"чужое"}', 'Файл не подошёл'],
    ['{"schema":99}', 'более новой версией'],
  ])('чужой файл %s отвергается, прежние данные целы', async (text, message) => {
    const { saved } = setup({ pickFile: async () => text });
    await userEvent.click(await screen.findByRole('button', { name: 'Загрузить прогресс из файла' }));
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(saved().attempts).toHaveLength(3);
  });

  it('отмена выбора файла ничего не меняет', async () => {
    const { saved } = setup({ pickFile: async () => null });
    await userEvent.click(await screen.findByRole('button', { name: 'Загрузить прогресс из файла' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(saved().attempts).toHaveLength(3);
  });
});

describe('сброс прогресса', () => {
  it('срабатывает только после ввода слова и сохраняет настройки', async () => {
    const { saved } = setup({}, { ...withAnswers(3), settings: { dailySize: 30 } });
    await userEvent.click(await screen.findByRole('button', { name: 'Сбросить прогресс' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Сброс прогресса' });
    expect(within(dialog).getByRole('textbox')).toHaveFocus();
    const confirm = within(dialog).getByRole('button', { name: 'Сбросить' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'сброс');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'ить');
    await userEvent.click(confirm);
    expect(await screen.findByText('Прогресс сброшен.')).toBeInTheDocument();
    await waitFor(() => expect(saved().attempts).toHaveLength(0));
    expect(saved().settings.dailySize).toBe(30);
  });

  it('отмена ничего не удаляет', async () => {
    const { saved } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Сбросить прогресс' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(saved().attempts).toHaveLength(3);
  });
});
