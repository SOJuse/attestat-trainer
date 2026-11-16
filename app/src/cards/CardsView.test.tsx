import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyAnswer, emptyUserData, type UserData } from '../core/progress';
import type { PlacedCard } from '../core/taskSchema';
import { makePack, seeded } from '../core/testPack';
import { createFakePlatform, createFakeStore } from '../platform/fake';
import { ProgressView } from '../progress/ProgressView';
import { AppDataProvider } from '../state/AppData';
import { CardsView } from './CardsView';

const NOW = new Date(2026, 10, 16, 10, 0, 0);
const card = (n: number, module: PlacedCard['module'] = 'K'): PlacedCard => ({
  id: `${module}-card-${String(n).padStart(3, '0')}`,
  module,
  topic: 'a',
  front: `Вопрос карточки ${n}`,
  back: `Ответ карточки ${n}`,
  refs: [{ doc: 'tk-rf', anchor: 'st-1', quote: 'цитата' }],
  revision: 1,
});

function mount(ui: React.ReactNode, pack = makePack(2, { cards: [card(1), card(2), card(3, 'R')] }), store = createFakeStore()) {
  const platform = createFakePlatform({ store, tasks: { current: async () => pack } });
  render(
    <AppDataProvider platform={platform} now={() => NOW} random={seeded(3)}>
      {ui}
    </AppDataProvider>,
  );
  return store;
}
const saved = (store: { text: string | null }) => JSON.parse(store.text!) as UserData;

describe('CardsView', () => {
  it('для новичка предлагает взять новые карточки', async () => {
    mount(<CardsView />);
    expect(await screen.findByText(/На сегодня карточек нет/)).toBeInTheDocument();
    expect(screen.getByText(/Новых: 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Взять новые' }));
    expect(screen.getByText('Карточка 1 из 3')).toBeInTheDocument();
  });

  it('карточка переворачивается щелчком и пробелом, ответ двигает очередь', async () => {
    const store = mount(<CardsView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Взять новые' }));
    const front = screen.getByText(/Вопрос карточки/).textContent!;
    const n = front.match(/\d+/)![0];
    expect(screen.queryByText(`Ответ карточки ${n}`)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Знаю' })).not.toBeInTheDocument();
    await userEvent.keyboard(' ');
    expect(screen.getByText(`Ответ карточки ${n}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Знаю' }));
    expect(screen.getByText('Карточка 2 из 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Показать ответ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await userEvent.click(screen.getByRole('button', { name: 'Показать ответ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Знаю' }));
    expect(await screen.findByText('Знаю 2 из 3')).toBeInTheDocument();
    const data = saved(store);
    expect(data.attempts.map((a) => [a.mode, a.correct])).toEqual([
      ['cards', true],
      ['cards', false],
      ['cards', true],
    ]);
    expect(Object.values(data.items).every((i) => i.srs?.due === '2026-11-17')).toBe(true);
  });

  it('показывает карточки, которые пора повторить', async () => {
    const d = applyAnswer(emptyUserData(), { id: 'K-card-001', revision: 1, correct: true, mode: 'cards', now: new Date(2026, 10, 14) });
    mount(<CardsView />, undefined, createFakeStore(JSON.stringify(d)));
    expect(await screen.findByText(/Пора повторить: 1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(screen.getByText('Вопрос карточки 1')).toBeInTheDocument();
    expect(screen.getByText('Карточка 1 из 1')).toBeInTheDocument();
  });

  it('можно выбрать модуль', async () => {
    mount(<CardsView />);
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Модуль' }), 'R');
    expect(screen.getByText(/Новых: 1/)).toBeInTheDocument();
  });

  it('если карточек в базе нет, говорит об этом', async () => {
    mount(<CardsView />, makePack(2));
    expect(await screen.findByText(/Карточек в базе пока нет/)).toBeInTheDocument();
  });
});

describe('ProgressView', () => {
  const answered = () => {
    let d = emptyUserData();
    const pack = makePack(12);
    // тема K/a: 5 ответов, 2 верных → слабая; тема K/b: 2 ответа, оба верные
    ['K-a-001', 'K-a-003', 'K-a-005'].forEach((id) => (d = applyAnswer(d, { id, revision: 1, correct: false, mode: 'daily', now: NOW })));
    ['K-a-007', 'K-a-009', 'K-b-002', 'K-b-004'].forEach((id) => (d = applyAnswer(d, { id, revision: 1, correct: true, mode: 'daily', now: NOW })));
    d = {
      ...d,
      exams: [
        { at: '2026-11-15T09:00:00.000Z', kind: 'mini', module: 'K', total: 8, correct: 3, byModule: { K: { total: 8, correct: 3 } }, passed: false, packVersion: '2026.11.20.1' },
        { at: '2026-11-16T09:00:00.000Z', kind: 'full', total: 40, correct: 30, byModule: {}, passed: true, packVersion: '2026.11.20.1' },
      ],
    };
    return { d, pack };
  };

  it('без ответов объясняет, что здесь будет', async () => {
    mount(<ProgressView onTrain={() => {}} />);
    expect(await screen.findByText(/Здесь появится статистика после первых ответов/)).toBeInTheDocument();
  });

  it('показывает точность по темам и помечает слабые', async () => {
    const { d, pack } = answered();
    mount(<ProgressView onTrain={() => {}} />, pack, createFakeStore(JSON.stringify(d)));
    const weak = (await screen.findByText('K: тема А')).closest('tr')!;
    expect(weak).toHaveTextContent('40%');
    expect(weak).toHaveTextContent('5 из 6');
    expect(weak).toHaveTextContent('слабая тема');
    const fine = screen.getByText('K: тема Б').closest('tr')!;
    expect(fine).toHaveTextContent('100%');
    expect(fine).not.toHaveTextContent('слабая тема');
    const untouched = screen.getByText('R: тема А').closest('tr')!;
    expect(untouched).toHaveTextContent('нет ответов');
  });

  it('из слабой темы можно перейти в тренировку по ней', async () => {
    const { d, pack } = answered();
    let got: unknown = null;
    mount(<ProgressView onTrain={(f) => (got = f)} />, pack, createFakeStore(JSON.stringify(d)));
    await userEvent.click(await screen.findByRole('button', { name: 'Тренировать тему «K: тема А»' }));
    await waitFor(() => expect(got).toEqual({ module: 'K', topic: 'a' }));
  });

  it('показывает историю экзаменов, последние сверху', async () => {
    const { d, pack } = answered();
    mount(<ProgressView onTrain={() => {}} />, pack, createFakeStore(JSON.stringify(d)));
    await screen.findByRole('heading', { name: 'История экзаменов' });
    const rows = screen.getAllByRole('row').filter((r) => /зачёт/i.test(r.textContent ?? ''));
    expect(rows[0]).toHaveTextContent('Полный экзамен');
    expect(rows[0]).toHaveTextContent('30 из 40');
    expect(rows[0]).toHaveTextContent('зачёт');
    expect(rows[1]).toHaveTextContent('Мини-тест: K');
    expect(rows[1]).toHaveTextContent('3 из 8');
    expect(rows[1]).toHaveTextContent('незачёт');
  });

  it('без экзаменов истории нет', async () => {
    mount(<ProgressView onTrain={() => {}} />);
    expect(await screen.findByText(/Экзаменов пока не было/)).toBeInTheDocument();
  });
});
