import { describe, expect, it } from 'vitest';
import { addQuestion, editQuestion, emptyInterview, practicePool, ratePractice, removeQuestion, setIndicator } from './interview';
import { emptyUserData, parseUserData } from './progress';

const TODAY = '2026-11-19';
const ORDER = ['1', '9', '26.1'];
const q = (text: string) => ({ text, theses: 'тезисы', source: '' });

describe('записи к собеседованию', () => {
  it('вопрос без текста не добавляется, номера не повторяются после удаления', () => {
    let d = addQuestion(emptyInterview(), q('  '), TODAY);
    expect(d.questions).toEqual([]);
    d = addQuestion(d, q(' Первый '), TODAY);
    d = addQuestion(d, q('Второй'), TODAY);
    expect(d.questions.map((x) => [x.id, x.text])).toEqual([['q1', 'Первый'], ['q2', 'Второй']]);
    d = removeQuestion(d, 'q1');
    d = addQuestion(d, q('Третий'), TODAY);
    expect(d.questions.map((x) => x.id)).toEqual(['q2', 'q3']);
  });

  it('правка вопроса сохраняет очередь повторений', () => {
    let d = addQuestion(emptyInterview(), q('Вопрос'), TODAY);
    d = ratePractice(d, { kind: 'question', id: 'q1' }, true, TODAY);
    d = editQuestion(d, 'q1', { text: 'Вопрос точнее', theses: 'новые', source: 'коллега' });
    expect(d.questions[0]).toMatchObject({ text: 'Вопрос точнее', theses: 'новые', source: 'коллега', srs: { box: 0, due: '2026-11-20' } });
  });

  it('пустой показатель не хранится, без изменений состояние то же', () => {
    const empty = emptyInterview();
    let d = setIndicator(empty, '9', ' 2 ', '');
    expect(d.indicators['9']).toEqual({ value: '2', note: '' });
    expect(setIndicator(d, '9', '2', '')).toBe(d);
    d = setIndicator(d, '9', '', ' ');
    expect(d.indicators).toEqual({});
  });

  it('в тренировку идут вопросы и заполненные показатели: сначала к повторению, потом новые', () => {
    let d = addQuestion(emptyInterview(), q('А'), TODAY);
    d = addQuestion(d, q('Б'), TODAY);
    d = setIndicator(d, '26.1', '3%', 'почему');
    d = setIndicator(d, '1', '2100', '');
    let pool = practicePool(d, TODAY, ORDER);
    expect(pool.due).toEqual([]);
    expect(pool.fresh.map((r) => r.id)).toEqual(['q1', 'q2', '1', '26.1']);

    d = ratePractice(d, { kind: 'question', id: 'q1' }, false, TODAY);
    d = ratePractice(d, { kind: 'indicator', id: '1' }, true, '2026-11-17');
    pool = practicePool(d, '2026-11-20', ORDER);
    // показатель просрочен с 18-го, вопрос с 20-го
    expect(pool.due.map((r) => r.id)).toEqual(['1', 'q1']);
    expect(pool.fresh.map((r) => r.id)).toEqual(['q2', '26.1']);
    expect(pool.all).toHaveLength(4);
  });

  it('уверенный ответ отодвигает повторение дальше, неуверенный возвращает на завтра', () => {
    let d = addQuestion(emptyInterview(), q('А'), TODAY);
    const ref = { kind: 'question' as const, id: 'q1' };
    d = ratePractice(d, ref, true, TODAY);
    d = ratePractice(d, ref, true, '2026-11-20');
    expect(d.questions[0].srs).toEqual({ box: 1, due: '2026-11-23' });
    d = ratePractice(d, ref, false, '2026-11-23');
    expect(d.questions[0].srs).toEqual({ box: 0, due: '2026-11-24' });
  });

  it('файл прогресса читается и без записей к собеседованию, и с ними', () => {
    const old = emptyUserData();
    expect(parseUserData(old).interview).toBeUndefined();
    const withNotes = { ...old, interview: setIndicator(addQuestion(emptyInterview(), q('А'), TODAY), '9', '1', '') };
    expect(parseUserData(JSON.parse(JSON.stringify(withNotes))).interview?.questions).toHaveLength(1);
  });
});
