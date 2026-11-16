import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyAnswer, emptyUserData, type UserData } from '../core/progress';
import { makePack } from '../core/testPack';
import { createFakePlatform, createFakeStore } from '../platform/fake';
import { AppDataProvider, useAppData } from './AppData';

const NOW = new Date(2026, 10, 16, 10, 0, 0);

function Probe() {
  const app = useAppData();
  return (
    <div>
      <p>заданий: {app.pack.tasks.length}</p>
      <p>попыток: {app.data.attempts.length}</p>
      <p>ревизия первого: {app.data.items['K-a-001']?.revision ?? 'нет'}</p>
      <p>ступень первого: {app.data.items['K-a-001']?.srs?.box ?? 'нет'}</p>
      <button onClick={() => app.answer({ id: 'K-a-001', revision: 1, correct: true, mode: 'daily' })}>ответить</button>
      <button onClick={() => app.hide('K-a-001')}>скрыть</button>
    </div>
  );
}

const mount = (over: Parameters<typeof createFakePlatform>[0] = {}) => {
  const platform = createFakePlatform({ tasks: { current: async () => makePack(4) }, ...over });
  render(
    <AppDataProvider platform={platform} now={() => NOW}>
      <Probe />
    </AppDataProvider>,
  );
  return platform;
};

describe('AppDataProvider', () => {
  it('без сохранённого прогресса начинает с пустого и отдаёт базу', async () => {
    mount();
    expect(await screen.findByText('заданий: 20')).toBeInTheDocument();
    expect(screen.getByText('попыток: 0')).toBeInTheDocument();
  });

  it('ответ сразу сохраняется в хранилище', async () => {
    const store = createFakeStore();
    mount({ store });
    await userEvent.click(await screen.findByRole('button', { name: 'ответить' }));
    expect(screen.getByText('попыток: 1')).toBeInTheDocument();
    await waitFor(() => expect(store.text).not.toBeNull());
    const saved = JSON.parse(store.text!) as UserData;
    expect(saved.attempts).toHaveLength(1);
    expect(saved.attempts[0]).toMatchObject({ id: 'K-a-001', correct: true, mode: 'daily', day: '2026-11-16' });
  });

  it('читает сохранённый прогресс и сверяет его с базой', async () => {
    // в сохранённом прогрессе ревизия 1, в базе у задания уже 2
    const saved = applyAnswer(emptyUserData(), { id: 'K-a-001', revision: 1, correct: true, mode: 'daily', now: NOW });
    const pack = makePack(4);
    pack.tasks[0] = { ...pack.tasks[0], revision: 2 };
    const store = createFakeStore(JSON.stringify(saved));
    mount({ store, tasks: { current: async () => pack } });
    expect(await screen.findByText('ревизия первого: 2')).toBeInTheDocument();
    expect(screen.getByText('ступень первого: нет')).toBeInTheDocument();
    expect(screen.getByText('попыток: 1')).toBeInTheDocument();
    await waitFor(() => expect((JSON.parse(store.text!) as UserData).items['K-a-001'].revision).toBe(2));
  });

  it('если запись не удалась, говорит об этом и по кнопке повторяет', async () => {
    const store = createFakeStore();
    const save = vi.fn().mockRejectedValueOnce(new Error('disk')).mockImplementation(async (text: string) => {
      store.text = text;
    });
    mount({ store: { load: store.load, save } });
    await userEvent.click(await screen.findByRole('button', { name: 'ответить' }));
    expect(await screen.findByText(/Не удалось сохранить прогресс/)).toBeInTheDocument();
    expect(screen.getByText('попыток: 1')).toBeInTheDocument(); // в памяти ответ остался
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText(/Не удалось сохранить прогресс/)).not.toBeInTheDocument());
    expect((JSON.parse(store.text!) as UserData).attempts).toHaveLength(1);
  });

  it.each([
    ['не JSON', 'это не файл прогресса'],
    ['чужой JSON', '{"name":"package"}'],
    ['более новая схема', JSON.stringify({ ...emptyUserData(), schema: 2 })],
  ])('повреждённый файл (%s) не перезаписывается, человеку предлагают выбор', async (_, text) => {
    const store = createFakeStore(text);
    const save = vi.spyOn(store, 'save');
    mount({ store });
    expect(await screen.findByText(/Файл с прогрессом не читается/)).toBeInTheDocument();
    expect(screen.queryByText(/заданий:/)).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(store.text).toBe(text);
  });

  it('«Начать с чистого листа» заменяет повреждённый файл пустым прогрессом после подтверждения', async () => {
    const store = createFakeStore('мусор');
    mount({ store });
    await userEvent.click(await screen.findByRole('button', { name: 'Начать с чистого листа' }));
    expect(store.text).toBe('мусор'); // первое нажатие только спрашивает
    await userEvent.click(screen.getByRole('button', { name: 'Да, начать заново' }));
    expect(await screen.findByText('попыток: 0')).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(store.text!)).toEqual(emptyUserData()));
  });

  it('«Сохранить копию файла» отдаёт прежнее содержимое', async () => {
    const saveFile = vi.fn(async () => true);
    mount({ store: createFakeStore('мусор'), saveFile });
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить копию файла' }));
    expect(saveFile).toHaveBeenCalledWith(expect.stringMatching(/^attestat-progress-povrezhdennyj-.*\.json$/), 'мусор');
  });

  it('если база не загрузилась, объясняет это', async () => {
    mount({ tasks: { current: async () => Promise.reject(new Error('bad pack')) } });
    expect(await screen.findByText(/Не удалось загрузить базу заданий/)).toBeInTheDocument();
  });

  it('новая база применяется при запуске, если нет незаконченной сессии', async () => {
    const current = vi.fn().mockResolvedValueOnce(makePack(4)).mockResolvedValueOnce(makePack(6));
    const update = vi.fn(async () => 'installed' as const);
    mount({ tasks: { current, update } });
    expect(await screen.findByText('заданий: 30')).toBeInTheDocument();
    expect(update).toHaveBeenCalledOnce();
  });

  it('при незаконченной сессии новая база ждёт', async () => {
    const draft = { kind: 'daily' as const, ids: ['K-a-001'], answers: [null], position: 0, startedAt: 1, packVersion: '2026.11.20.1' };
    const store = createFakeStore(JSON.stringify({ ...emptyUserData(), draft }));
    const current = vi.fn().mockResolvedValue(makePack(4));
    const update = vi.fn(async () => 'installed' as const);
    mount({ store, tasks: { current, update } });
    expect(await screen.findByText('заданий: 20')).toBeInTheDocument();
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(current).toHaveBeenCalledOnce();
  });

  it('сбой обновления базы работе не мешает', async () => {
    mount({ tasks: { current: async () => makePack(4), update: async () => Promise.reject(new Error('offline')) } });
    expect(await screen.findByText('заданий: 20')).toBeInTheDocument();
  });

  it('скрытое задание сохраняется', async () => {
    const store = createFakeStore();
    mount({ store });
    await userEvent.click(await screen.findByRole('button', { name: 'скрыть' }));
    await waitFor(() => expect((JSON.parse(store.text!) as UserData).items['K-a-001'].hidden).toBe(true));
  });
});
