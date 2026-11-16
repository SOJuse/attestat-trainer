import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyAnswer, emptyUserData, type UserData } from '../core/progress';
import { makePack, seeded } from '../core/testPack';
import type { CaseChain } from '../core/taskSchema';
import { createFakePlatform, createFakeStore } from '../platform/fake';
import { AppDataProvider } from '../state/AppData';
import { TrainingView } from '../training/TrainingView';
import { TodayView } from './TodayView';

const NOW = new Date(2026, 10, 16, 10, 0, 0);
const small = { ...emptyUserData(), settings: { dailySize: 5 } };

function mount(ui: React.ReactNode, store = createFakeStore(JSON.stringify(small)), pack = makePack(4)) {
  const platform = createFakePlatform({ store, tasks: { current: async () => pack } });
  const utils = render(
    <AppDataProvider platform={platform} now={() => NOW} random={seeded(7)}>
      {ui}
    </AppDataProvider>,
  );
  return { store, platform, ...utils };
}

const solve = async (correct: boolean, next: string | RegExp = /Дальше|Завершить/) => {
  await userEvent.click(await screen.findByRole('radio', { name: correct ? /^\d\s?верный$/ : /^\d\s?неверный$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Проверить' }));
  await userEvent.click(screen.getByRole('button', { name: next }));
};

describe('TodayView', () => {
  it('показывает, сколько заданий на сегодня: повторения и новые', async () => {
    let d: UserData = small;
    d = applyAnswer(d, { id: 'K-a-001', revision: 1, correct: false, mode: 'daily', now: new Date(2026, 10, 14) });
    d = applyAnswer(d, { id: 'K-b-002', revision: 1, correct: true, mode: 'daily', now: new Date(2026, 10, 15) });
    mount(<TodayView />, createFakeStore(JSON.stringify(d)));
    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(screen.getByText('заданий на сегодня')).toBeInTheDocument();
    expect(screen.getByText('2', { selector: '.figure b' })).toBeInTheDocument(); // пора повторить
    expect(screen.getByText('3', { selector: '.figure b' })).toBeInTheDocument(); // новых
    expect(screen.getByText(/Занятия два дня подряд|2 дня подряд/)).toBeInTheDocument();
  });

  it('сессия проходит до итога, ответы сохраняются', async () => {
    const { store } = mount(<TodayView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    expect(screen.getByText('Задание 1 из 5')).toBeInTheDocument();
    await solve(true);
    await solve(false);
    await solve(true);
    await solve(true);
    expect(screen.getByText('Задание 5 из 5')).toBeInTheDocument();
    await solve(true, 'Завершить');
    expect(await screen.findByText('Верно 4 из 5')).toBeInTheDocument();
    const saved = JSON.parse(store.text!) as UserData;
    expect(saved.attempts).toHaveLength(5);
    expect(saved.attempts.every((a) => a.mode === 'daily')).toBe(true);
    expect(saved.drafts.daily).toBeUndefined();
  });

  it('после перезапуска сессия продолжается с того же задания', async () => {
    const first = mount(<TodayView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    await solve(true);
    await solve(true);
    expect(screen.getByText('Задание 3 из 5')).toBeInTheDocument();
    await waitFor(() => expect((JSON.parse(first.store.text!) as UserData).drafts.daily?.position).toBe(2));
    first.unmount();

    mount(<TodayView />, createFakeStore(first.store.text));
    await userEvent.click(await screen.findByRole('button', { name: 'Продолжить' }));
    expect(screen.getByText('Задание 3 из 5')).toBeInTheDocument();
  });

  it('когда всё решено и повторять нечего, говорит об этом', async () => {
    let d: UserData = small;
    const pack = makePack(1);
    for (const t of pack.tasks) d = applyAnswer(d, { id: t.id, revision: 1, correct: true, mode: 'daily', now: NOW });
    mount(<TodayView />, createFakeStore(JSON.stringify(d)), pack);
    expect(await screen.findByText(/На сегодня всё/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Начать' })).not.toBeInTheDocument();
  });

  it('для пробной базы вместо прогноза показывает, сколько модулей готово', async () => {
    const pack = makePack(4, { pilot: true });
    for (const m of Object.values(pack.modules)) m.ready = false;
    mount(<TodayView />, undefined, pack);
    expect(await screen.findByText(/Готово модулей: 0 из 5/)).toBeInTheDocument();
    expect(screen.getByText(/пробная база/i)).toBeInTheDocument();
  });

  it('пустая база', async () => {
    mount(<TodayView />, undefined, makePack(0));
    expect(await screen.findByText(/В базе пока нет заданий/)).toBeInTheDocument();
  });

  it('скрытое в сессии задание больше не предлагается', async () => {
    const { store } = mount(<TodayView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    await userEvent.click(await screen.findByRole('radio', { name: /^\d\s?верный$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    await userEvent.click(screen.getByRole('button', { name: 'Скрыть задание' }));
    expect(screen.getByText('Задание 2 из 5')).toBeInTheDocument();
    const saved = JSON.parse(store.text!) as UserData;
    expect(Object.values(saved.items).filter((i) => i.hidden)).toHaveLength(1);
  });
});

describe('TrainingView', () => {
  it('считает задания по фильтрам и запускает тренировку', async () => {
    const { store } = mount(<TrainingView />);
    expect(await screen.findByText('Подходит заданий: 20')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Модуль' }), 'K');
    expect(screen.getByText('Подходит заданий: 4')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Тема' }), 'a');
    expect(screen.getByText('Подходит заданий: 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(screen.getByText('Задание 1 из 2')).toBeInTheDocument();
    await solve(true);
    await solve(true, 'Завершить');
    expect(await screen.findByText('Верно 2 из 2')).toBeInTheDocument();
    expect((JSON.parse(store.text!) as UserData).attempts.map((a) => a.mode)).toEqual(['training', 'training']);
  });

  it('тема выбирается только внутри модуля', async () => {
    mount(<TrainingView />);
    expect(await screen.findByRole('combobox', { name: 'Тема' })).toBeDisabled();
  });

  it('если под фильтр ничего не подходит, подсказывает, что делать', async () => {
    mount(<TrainingView />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Тип задания' }), 'input');
    expect(screen.getByText('Подходит заданий: 0')).toBeInTheDocument();
    expect(screen.getByText(/Снимите один из фильтров/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Начать' })).toBeDisabled();
  });

  it('«только ошибки» оставляет задания с неверным последним ответом', async () => {
    const d = applyAnswer(small, { id: 'K-a-001', revision: 1, correct: false, mode: 'daily', now: NOW });
    mount(<TrainingView />, createFakeStore(JSON.stringify(d)));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Только задания с ошибкой' }));
    expect(screen.getByText('Подходит заданий: 1')).toBeInTheDocument();
  });

  it('кейс проходит по шагам и показывает, что изменилось', async () => {
    const step = (change: string, q: string) => ({
      change,
      type: 'single' as const,
      difficulty: 2 as const,
      question: q,
      options: [
        { text: 'верный', correct: true, why: 'да' },
        { text: 'неверный', correct: false, why: 'нет' },
        { text: 'тоже неверный', correct: false, why: 'нет' },
      ],
      explanation: 'Разбор шага.',
      refs: [{ doc: 'tk-rf', anchor: 'st-256', quote: 'цитата' }],
    });
    const chain: CaseChain & { module: 'K' } = {
      id: 'K-case-001',
      module: 'K',
      topic: 'a',
      title: 'Отпуск по уходу за ребёнком',
      intro: 'Работница детского сада ушла в отпуск по уходу.',
      steps: [step('', 'Первый вопрос?'), step('Через полгода она хочет выйти.', 'Второй вопрос?'), step('Ставку сокращают.', 'Третий вопрос?')],
      revision: 1,
    };
    const { store } = mount(<TrainingView />, undefined, makePack(2, { cases: [chain] }));
    await userEvent.click(await screen.findByRole('button', { name: /Отпуск по уходу за ребёнком/ }));
    expect(screen.getByText('Работница детского сада ушла в отпуск по уходу.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Первый вопрос?' })).toBeInTheDocument();
    await solve(true);
    expect(screen.getByText('Через полгода она хочет выйти.')).toBeInTheDocument();
    expect(screen.getByText('Шаг 2 из 3')).toBeInTheDocument();
    await solve(false);
    await solve(true, 'Завершить');
    expect(await screen.findByText('Верно 2 из 3')).toBeInTheDocument();
    const attempts = (JSON.parse(store.text!) as UserData).attempts;
    expect(attempts.map((a) => [a.id, a.mode, a.correct])).toEqual([
      ['K-case-001#1', 'case', true],
      ['K-case-001#2', 'case', false],
      ['K-case-001#3', 'case', true],
    ]);
  });

  it('скрытый шаг кейса при следующем прохождении не показывается', async () => {
    const step = (change: string, q: string) => ({
      change,
      type: 'single' as const,
      difficulty: 2 as const,
      question: q,
      options: [
        { text: 'верный', correct: true, why: 'да' },
        { text: 'неверный', correct: false, why: 'нет' },
        { text: 'тоже неверный', correct: false, why: 'нет' },
      ],
      explanation: 'Разбор шага.',
      refs: [{ doc: 'tk-rf', anchor: 'st-256', quote: 'цитата' }],
    });
    const chain = { id: 'K-case-001', module: 'K' as const, topic: 'a', title: 'Кейс', intro: 'Вводная.', steps: [step('', 'Первый?'), step('Изменение.', 'Второй?'), step('Ещё.', 'Третий?')], revision: 1 };
    const hidden = { ...small, items: { 'K-case-001#1': { revision: 1, hidden: true as const } } };
    mount(<TrainingView />, createFakeStore(JSON.stringify(hidden)), makePack(2, { cases: [chain] }));
    const button = await screen.findByRole('button', { name: /Кейс/ });
    expect(button).toHaveTextContent('шагов: 2');
    await userEvent.click(button);
    expect(screen.getByRole('heading', { level: 1, name: 'Второй?' })).toBeInTheDocument();
    expect(screen.getByText('Шаг 1 из 2')).toBeInTheDocument();
  });

  it('открытие библиотеки из разбора передаётся наверх', async () => {
    const onOpenLibrary = vi.fn();
    mount(<TrainingView onOpenLibrary={onOpenLibrary} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    await userEvent.click(await screen.findByRole('radio', { name: /^\d\s?верный$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    await userEvent.click(screen.getByRole('button', { name: 'Открыть в библиотеке' }));
    expect(onOpenLibrary).toHaveBeenCalledWith({ docId: 'tk-rf', anchor: 'st-1' });
  });
});

describe('сессия и тест не мешают друг другу', () => {
  const exam = { kind: 'mini' as const, module: 'K' as const, ids: ['K-a-001'], answers: [null], position: 0, startedAt: NOW.getTime(), packVersion: 'x' };

  it('начатый тест переживает ежедневную сессию и виден на «Сегодня»', async () => {
    const store = createFakeStore(JSON.stringify({ ...small, drafts: { exam } }));
    mount(<TodayView />, store);
    expect(await screen.findByText(/Есть незаконченный тест/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await solve(true);
    await waitFor(() => expect((JSON.parse(store.text!) as UserData).drafts.daily?.position).toBe(1));
    expect((JSON.parse(store.text!) as UserData).drafts.exam).toEqual(exam);
  });

  it('место в сессии запоминается сразу после ответа, до «Дальше»', async () => {
    const { store } = mount(<TodayView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    await userEvent.click(await screen.findByRole('radio', { name: /^\d\s?верный$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    await waitFor(() => expect((JSON.parse(store.text!) as UserData).drafts.daily?.position).toBe(1));
  });

  it('сессию можно прервать и продолжить позже', async () => {
    mount(<TodayView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    await solve(true);
    await userEvent.click(screen.getByRole('button', { name: 'Закончить' }));
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeInTheDocument();
    expect(screen.getByText('осталось в начатой сессии').previousSibling).toHaveTextContent('4');
  });
});
