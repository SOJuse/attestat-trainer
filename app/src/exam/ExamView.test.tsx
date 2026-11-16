import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyUserData, type UserData } from '../core/progress';
import { makePack, seeded } from '../core/testPack';
import { createFakePlatform, createFakeStore } from '../platform/fake';
import { AppDataProvider } from '../state/AppData';
import { ExamView } from './ExamView';

function mount(pack = makePack(10), store = createFakeStore(), clock = { ms: new Date(2026, 10, 16, 10, 0, 0).getTime() }) {
  const platform = createFakePlatform({ store, tasks: { current: async () => pack } });
  const utils = render(
    <AppDataProvider platform={platform} now={() => new Date(clock.ms)} random={seeded(5)}>
      <ExamView library={platform.library} openExternal={platform.openExternal} />
    </AppDataProvider>,
  );
  return { store, clock, ...utils };
}

const pick = async (correct: boolean) =>
  userEvent.click(await screen.findByRole('radio', { name: correct ? /^\d\s?верный$/ : /^\d\s?неверный$/ }));
const next = () => userEvent.click(screen.getByRole('button', { name: 'Следующее' }));
const saved = (store: { text: string | null }) => JSON.parse(store.text!) as UserData;

describe('ExamView: вход', () => {
  it('полный экзамен и мини-тесты по модулям доступны, когда база готова', async () => {
    mount();
    expect(await screen.findByRole('button', { name: 'Начать экзамен' })).toBeEnabled();
    expect(screen.getByText(/40 заданий, 60 минут/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Мини-тест/ })).toHaveLength(5);
  });

  it('для пробной базы экзамен закрыт с объяснением, мини-тест помечен', async () => {
    const pack = makePack(5, { pilot: true });
    for (const m of Object.values(pack.modules)) m.ready = false;
    mount(pack);
    expect(await screen.findByText(/Полный экзамен откроется, когда будут готовы все пять модулей/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Начать экзамен' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Мини-тест/ })).toHaveLength(5);
    expect(screen.getAllByText(/пробная база/).length).toBeGreaterThan(0);
  });

  it('модуль без заданий мини-теста не предлагает', async () => {
    const pack = makePack(10);
    pack.tasks = pack.tasks.filter((t) => t.module !== 'Rez');
    mount(pack);
    expect(await screen.findAllByRole('button', { name: /Мини-тест/ })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Начать экзамен' })).not.toBeInTheDocument();
  });
});

describe('ExamView: мини-тест', () => {
  const startMini = async () => userEvent.click(await screen.findByRole('button', { name: 'Мини-тест: K' }));

  it('идёт без разбора, с таймером и переходом между заданиями', async () => {
    const { clock } = mount();
    await startMini();
    expect(screen.getByRole('timer')).toHaveTextContent('12:00');
    expect(screen.getByText('Задание 1 из 8')).toBeInTheDocument();
    await pick(true);
    expect(screen.queryByText('так в норме')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Проверить' })).not.toBeInTheDocument();
    await next();
    expect(screen.getByText('Задание 2 из 8')).toBeInTheDocument();
    // вернуться к первому: ответ на месте
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Задания' })).getByRole('button', { name: /^1/ }));
    expect(await screen.findByRole('radio', { name: /^\d\s?верный$/ })).toBeChecked();
    clock.ms += 90_000;
    await waitFor(() => expect(screen.getByRole('timer')).toHaveTextContent('10:30'), { timeout: 3000 });
  });

  it('завершение с неотвеченными спрашивает подтверждение, протокол считает их неверными', async () => {
    const { store } = mount();
    await startMini();
    for (let i = 0; i < 4; i++) {
      await pick(true);
      await next();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    expect(screen.getByText(/Без ответа осталось заданий: 4/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Да, завершить' }));
    expect(await screen.findByText('Зачёт')).toBeInTheDocument();
    expect(screen.getByText('4 из 8, 50%')).toBeInTheDocument();
    const data = saved(store);
    expect(data.exams).toHaveLength(1);
    expect(data.exams[0]).toMatchObject({ kind: 'mini', module: 'K', total: 8, correct: 4, passed: true });
    // в прогресс идут только отвеченные: остальных заданий человек мог и не видеть
    expect(data.attempts).toHaveLength(4);
    expect(data.attempts.every((a) => a.mode === 'exam')).toBe(true);
    // в протоколе у ошибки виден верный вариант
    expect(screen.getAllByText('Без ответа')).toHaveLength(4);
    expect(screen.getAllByText('верно, пропущено').length).toBeGreaterThan(0);
    expect(data.drafts.exam).toBeUndefined();
  });

  it('когда время вышло, тест завершается сам', async () => {
    const { clock, store } = mount();
    await startMini();
    await pick(true);
    clock.ms += 13 * 60_000;
    expect(await screen.findByText('Незачёт', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('1 из 8, 13%')).toBeInTheDocument();
    expect(screen.getByText(/Время вышло/)).toBeInTheDocument();
    expect(saved(store).exams[0].passed).toBe(false);
  });

  it('после перезапуска продолжается с теми же ответами и тем же временем', async () => {
    const first = mount();
    await startMini();
    await pick(true);
    await next();
    await waitFor(() => expect(saved(first.store).drafts.exam?.kind).toBe('mini'));
    first.unmount();

    const clock = { ms: first.clock.ms + 5 * 60_000 };
    mount(makePack(10), createFakeStore(first.store.text), clock);
    expect(await screen.findByRole('timer')).toHaveTextContent('07:00');
    expect(screen.getByText('Задание 2 из 8')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Задания' })).getByRole('button', { name: /^1/ }));
    expect(await screen.findByRole('radio', { name: /^\d\s?верный$/ })).toBeChecked();
  });

  it('если за время, пока программа была закрыта, время вышло, сразу показывает протокол', async () => {
    const first = mount();
    await startMini();
    await pick(true);
    await waitFor(() => expect(saved(first.store).drafts.exam?.answers[0]).toBeTruthy());
    first.unmount();
    mount(makePack(10), createFakeStore(first.store.text), { ms: first.clock.ms + 60 * 60_000 });
    expect(await screen.findByText('Незачёт')).toBeInTheDocument();
    expect(screen.getByText(/Время вышло/)).toBeInTheDocument();
  });

  it('в протоколе есть разбор ошибок', async () => {
    mount();
    await startMini();
    await pick(false);
    await userEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    await userEvent.click(screen.getByRole('button', { name: 'Да, завершить' }));
    expect(await screen.findByRole('heading', { name: 'Разбор ошибок' })).toBeInTheDocument();
    expect(screen.getAllByText('Разбор.').length).toBe(8);
  });

  it('панель библиотеки открывается и закрывается', async () => {
    mount();
    await startMini();
    expect(screen.queryByRole('searchbox', { name: 'Поиск по документам' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Библиотека' }));
    expect(await screen.findByRole('searchbox', { name: 'Поиск по документам' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Скрыть библиотеку' }));
    expect(screen.queryByRole('searchbox', { name: 'Поиск по документам' })).not.toBeInTheDocument();
  });
});

describe('ExamView: полный экзамен', () => {
  it('40 заданий, протокол называет невыполненное правило', async () => {
    const { store } = mount(makePack(10), createFakeStore(JSON.stringify(emptyUserData())));
    await userEvent.click(await screen.findByRole('button', { name: 'Начать экзамен' }));
    expect(screen.getByRole('timer')).toHaveTextContent('60:00');
    expect(screen.getByText('Задание 1 из 40')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    await userEvent.click(screen.getByRole('button', { name: 'Да, завершить' }));
    expect(await screen.findByText('Незачёт')).toBeInTheDocument();
    expect(screen.getByText(/меньше 70% за весь тест/)).toBeInTheDocument();
    expect(saved(store).exams[0]).toMatchObject({ kind: 'full', total: 40, correct: 0, passed: false });
  });
});
