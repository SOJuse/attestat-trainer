import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Task } from '../core/taskSchema';
import { issueUrl, TaskView } from './TaskView';

const base = {
  id: 'K-otpuska-001',
  difficulty: 2 as const,
  situation: 'Воспитатель находится в отпуске по уходу за ребёнком.',
  question: 'На каких условиях она может выйти на работу?',
  explanation: 'Право на пособие сохраняется.',
  refs: [{ doc: 'tk-rf', anchor: 'st-256', quote: 'сохраняется в случае, если женщина' }],
  revision: 1,
  checked: '2026-11-18',
};
const o = (text: string, correct: boolean) => ({ text, correct, why: `Разбор варианта «${text}».` });
const single: Task = { ...base, type: 'single', options: [o('Первый', false), o('Второй', true), o('Третий', false)] };
const multiple: Task = { ...base, type: 'multiple', options: [o('Первый', true), o('Второй', false), o('Третий', true)] };
const sequence: Task = { ...base, type: 'sequence', items: ['Шаг А', 'Шаг Б', 'Шаг В'] };
const matching: Task = {
  ...base,
  type: 'matching',
  pairs: [
    { left: 'Замечание', right: 'статья 192' },
    { left: 'Отпуск', right: 'статья 114' },
    { left: 'Договор', right: 'статья 56' },
  ],
};
const input: Task = { ...base, type: 'input', answer: 3, unit: 'рабочих дня' };

// порядок показа в тестах не перемешивается
const identity = () => 0.999999;
const show = (task: Task, props: Partial<Parameters<typeof TaskView>[0]> = {}) => {
  const onAnswered = vi.fn();
  render(
    <TaskView
      task={task}
      meta={{ module: 'Кадры', topic: 'Отпуска', position: 'Задание 7 из 20' }}
      mode="learn"
      packVersion="2026.11.20.1"
      onAnswered={onAnswered}
      onNext={vi.fn()}
      onOpenLibrary={vi.fn()}
      random={identity}
      {...props}
    />,
  );
  return onAnswered;
};
const check = () => userEvent.click(screen.getByRole('button', { name: 'Проверить' }));

describe('TaskView', () => {
  it('показывает ситуацию, вопрос и место задания', () => {
    show(single);
    expect(screen.getByText(base.situation)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: base.question })).toBeInTheDocument();
    expect(screen.getByText('Кадры')).toBeInTheDocument();
    expect(screen.getByText('Отпуска')).toBeInTheDocument();
    expect(screen.getByText('Задание 7 из 20')).toBeInTheDocument();
    expect(screen.getByLabelText('Сложность 2 из 3')).toBeInTheDocument();
  });

  it('«Проверить» неактивна, пока ответ не выбран', async () => {
    show(single);
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: /Второй/ }));
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeEnabled();
  });

  it('single: верный ответ, разбор каждого варианта и общий разбор', async () => {
    const onAnswered = show(single);
    await userEvent.click(screen.getByRole('radio', { name: /Второй/ }));
    await check();
    expect(onAnswered).toHaveBeenCalledWith(true, { type: 'single', choice: 1 });
    expect(screen.getByRole('status')).toHaveTextContent('Верно');
    expect(screen.getByText('Разбор варианта «Первый».')).toBeInTheDocument();
    expect(screen.getByText('Разбор варианта «Второй».')).toBeInTheDocument();
    expect(screen.getByText(base.explanation)).toBeInTheDocument();
    expect(screen.getByText(/сохраняется в случае, если женщина/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Проверить' })).not.toBeInTheDocument();
  });

  it('single: неверный ответ', async () => {
    const onAnswered = show(single);
    await userEvent.click(screen.getByRole('radio', { name: /Первый/ }));
    await check();
    expect(onAnswered).toHaveBeenCalledWith(false, { type: 'single', choice: 0 });
    expect(screen.getByRole('status')).toHaveTextContent('Неверно');
  });

  it('multiple: засчитывается только полный набор', async () => {
    const onAnswered = show(multiple);
    await userEvent.click(screen.getByRole('checkbox', { name: /Первый/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Третий/ }));
    await check();
    expect(onAnswered).toHaveBeenCalledWith(true, { type: 'multiple', choices: [0, 2] });
  });

  it('sequence: шаги двигаются кнопками и стрелками', async () => {
    const onAnswered = show(sequence, { random: () => 0 }); // перемешано предсказуемо
    const list = screen.getByRole('list', { name: 'Порядок шагов' });
    const order = () => within(list).getAllByRole('listitem').map((li) => li.textContent?.replace(/Выше|Ниже/g, '').trim());
    const start = order();
    expect([...start].sort()).toEqual(['Шаг А', 'Шаг Б', 'Шаг В']);
    // привести к верному порядку кнопками «Выше»
    for (const step of ['Шаг А', 'Шаг Б', 'Шаг В']) {
      const target = ['Шаг А', 'Шаг Б', 'Шаг В'].indexOf(step);
      while (order().indexOf(step) > target) {
        const item = within(list).getAllByRole('listitem')[order().indexOf(step)];
        await userEvent.click(within(item).getByRole('button', { name: 'Выше' }));
      }
    }
    expect(order()).toEqual(['Шаг А', 'Шаг Б', 'Шаг В']);
    await check();
    expect(onAnswered).toHaveBeenCalledWith(true, { type: 'sequence', order: [0, 1, 2] });
  });

  it('sequence: стрелка вниз на шаге опускает его', async () => {
    show(sequence, { random: identity }); // порядок как в задании
    const list = screen.getByRole('list', { name: 'Порядок шагов' });
    const first = within(list).getAllByRole('listitem')[0];
    within(first).getByRole('button', { name: 'Ниже' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Шаг А');
  });

  it('matching: к каждой левой части выбирается правая', async () => {
    const onAnswered = show(matching);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Замечание' }), 'статья 192');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Отпуск' }), 'статья 114');
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Договор' }), 'статья 56');
    await check();
    expect(onAnswered).toHaveBeenCalledWith(true, { type: 'matching', rights: [0, 1, 2] });
  });

  it('input: число с единицей измерения', async () => {
    const onAnswered = show(input);
    const field = screen.getByRole('textbox', { name: 'Ваш ответ' });
    expect(screen.getByText('рабочих дня')).toBeInTheDocument();
    await userEvent.type(field, 'три');
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, '3{Enter}');
    expect(onAnswered).toHaveBeenCalledWith(true, { type: 'input', text: '3' });
    expect(screen.getByText(/Верный ответ: 3 рабочих дня/)).toBeInTheDocument();
  });

  it('цифры выбирают вариант, Enter проверяет, второй Enter ведёт дальше', async () => {
    const onNext = vi.fn();
    const onAnswered = show(single, { onNext });
    await userEvent.keyboard('2{Enter}');
    expect(onAnswered).toHaveBeenCalledWith(true, { type: 'single', choice: 1 });
    await userEvent.keyboard('{Enter}');
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('в режиме экзамена разбора нет, ответ уходит наверх при каждом изменении', async () => {
    const onAnswered = show(single, { mode: 'exam' });
    await userEvent.click(screen.getByRole('radio', { name: /Первый/ }));
    expect(onAnswered).toHaveBeenLastCalledWith(false, { type: 'single', choice: 0 });
    expect(screen.queryByRole('button', { name: 'Проверить' })).not.toBeInTheDocument();
    expect(screen.queryByText('Разбор варианта «Первый».')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('в экзамене показывает ранее данный ответ', () => {
    show(single, { mode: 'exam', initialAnswer: { type: 'single', choice: 2 } });
    expect(screen.getByRole('radio', { name: /Третий/ })).toBeChecked();
  });

  it('ссылка на норму открывает библиотеку на нужном разделе', async () => {
    const onOpenLibrary = vi.fn();
    show(single, { onOpenLibrary });
    await userEvent.click(screen.getByRole('radio', { name: /Второй/ }));
    await check();
    await userEvent.click(screen.getByRole('button', { name: 'Открыть в библиотеке' }));
    expect(onOpenLibrary).toHaveBeenCalledWith({ docId: 'tk-rf', anchor: 'st-256' });
  });

  it('у нормы из распознанного документа стоит пометка и страница скана', async () => {
    const scanned: Task = { ...single, refs: [{ doc: 'prikaz-373', anchor: 'pril-1-p-7', quote: 'сроки получения', scan_page: 5 }] };
    show(scanned, { ocrDocs: new Set(['prikaz-373']), docTitles: { 'prikaz-373': 'Порядок дошкольного образования' } });
    await userEvent.click(screen.getByRole('radio', { name: /Второй/ }));
    await check();
    expect(screen.getByText(/Порядок дошкольного образования/)).toBeInTheDocument();
    expect(screen.getByText(/распознано со скана, сверено по странице 5/)).toBeInTheDocument();
  });

  it('после проверки можно скрыть задание и сообщить об ошибке', async () => {
    const onHide = vi.fn();
    const openExternal = vi.fn(async () => {});
    show(single, { onHide, openExternal });
    expect(screen.queryByRole('button', { name: 'Скрыть задание' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Второй/ }));
    await check();
    await userEvent.click(screen.getByRole('button', { name: 'Скрыть задание' }));
    expect(onHide).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Сообщить об ошибке' }));
    expect(openExternal).toHaveBeenCalledWith(issueUrl('K-otpuska-001', '2026.11.20.1'));
  });

  it('у ловушки в формулировке есть пояснение в разборе', async () => {
    show({ ...single, trap: { kind: 'wording', note: '«Выйти на работу» и «прервать отпуск» — не одно и то же.' } });
    await userEvent.click(screen.getByRole('radio', { name: /Второй/ }));
    await check();
    expect(screen.getByText(/«Выйти на работу» и «прервать отпуск»/)).toBeInTheDocument();
  });
});

describe('issueUrl', () => {
  it('ведёт в новое обращение с id задания и версией базы', () => {
    const url = new URL(issueUrl('K-otpuska-001', '2026.11.20.1'));
    expect(url.origin + url.pathname).toBe('https://github.com/SOJuse/attestat-trainer/issues/new');
    expect(url.searchParams.get('title')).toBe('Ошибка в задании K-otpuska-001');
    expect(url.searchParams.get('body')).toContain('K-otpuska-001');
    expect(url.searchParams.get('body')).toContain('2026.11.20.1');
  });
});

describe('TaskView: клавиши и чужие поля ввода', () => {
  it('цифры, набранные в поле поиска рядом с заданием, ответ не меняют', async () => {
    const onAnswered = vi.fn();
    render(
      <div>
        <input type="search" aria-label="Поиск" />
        <TaskView task={single} meta={{ module: 'Кадры', topic: 'Отпуска' }} mode="exam" packVersion="1" onAnswered={onAnswered} random={identity} />
      </div>,
    );
    await userEvent.type(screen.getByRole('searchbox', { name: 'Поиск' }), 'ст 81 273{Enter}');
    expect(onAnswered).not.toHaveBeenCalled();
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
  });

  it('подсказывает, если в поле числа вписано не число', async () => {
    show(input);
    await userEvent.type(screen.getByRole('textbox', { name: 'Ваш ответ' }), 'три');
    expect(screen.getByRole('alert')).toHaveTextContent('Впишите одно число');
    await userEvent.clear(screen.getByRole('textbox', { name: 'Ваш ответ' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Ваш ответ' }), '3дня');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeEnabled();
  });
});

describe('TaskView: разбор в протоколе', () => {
  it('показывает ответ человека и верный вариант без кнопок', () => {
    show(single, { review: true, heading: 'h3', initialAnswer: { type: 'single', choice: 0 }, onNext: undefined });
    expect(screen.getByRole('status')).toHaveTextContent('Неверно');
    expect(screen.getByText('неверно, отмечено')).toBeInTheDocument();
    expect(screen.getByText('верно, пропущено')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Проверить' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument();
  });

  it('задание без ответа помечено', () => {
    show(single, { review: true, onNext: undefined });
    expect(screen.getByRole('status')).toHaveTextContent('Без ответа');
  });
});

describe('TaskView: порядок на экзамене', () => {
  it('показанная расстановка шагов сразу считается ответом', () => {
    const onAnswered = show(sequence, { mode: 'exam' });
    expect(onAnswered).toHaveBeenCalledTimes(1);
    expect(onAnswered).toHaveBeenCalledWith(true, { type: 'sequence', order: [0, 1, 2] });
  });

  it('при возврате к заданию ответ не пересылается заново', () => {
    const onAnswered = show(sequence, { mode: 'exam', initialAnswer: { type: 'sequence', order: [2, 0, 1] } });
    expect(onAnswered).not.toHaveBeenCalled();
  });
});
