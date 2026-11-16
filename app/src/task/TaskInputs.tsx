import { useId, type KeyboardEvent } from 'react';
import type { Answer } from '../core/grade';
import type { CaseStep, Task } from '../core/taskSchema';

type Gradable = Task | CaseStep;

/** Перемешивает индексы 0..n-1 (Фишер — Йетс). С генератором, который всегда отдаёт почти 1, порядок не меняется. */
export function shuffled(n: number, random: () => number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Перемешивание для задания на порядок: начальная расстановка не должна оказаться верной,
 * иначе ответ засчитается без единого действия. Если перемешать не вышло, шаги сдвигаются по кругу.
 */
export function shuffledAway(n: number, random: () => number): number[] {
  if (n < 2) return shuffled(n, random);
  for (let attempt = 0; attempt < 5; attempt++) {
    const order = shuffled(n, random);
    if (order.some((x, i) => x !== i)) return order;
  }
  return Array.from({ length: n }, (_, i) => (i + 1) % n);
}

/** Пустой ответ для задания; у «порядка» это начальная расстановка шагов. */
export function emptyAnswer(task: Gradable, order: number[]): Answer {
  switch (task.type) {
    case 'single':
      return { type: 'single', choice: null };
    case 'multiple':
      return { type: 'multiple', choices: [] };
    case 'sequence':
      return { type: 'sequence', order };
    case 'matching':
      return { type: 'matching', rights: task.pairs.map(() => null) };
    case 'input':
      return { type: 'input', text: '' };
  }
}

type Props = {
  task: Gradable;
  answer: Answer;
  /** порядок показа вариантов или правых частей пар */
  order: number[];
  disabled: boolean;
  onChange: (answer: Answer) => void;
  /** после проверки варианты подсвечиваются и получают разбор */
  reviewed: boolean;
};

export function TaskInputs({ task, answer, order, disabled, onChange, reviewed }: Props) {
  // на экране может быть несколько заданий сразу (разделы остаются смонтированными, протокол экзамена)
  const uid = useId();
  if ((task.type === 'single' || task.type === 'multiple') && answer.type === task.type) {
    const chosen = answer.type === 'single' ? (answer.choice === null ? [] : [answer.choice]) : answer.choices;
    const toggle = (index: number) => {
      if (answer.type === 'single') return onChange({ type: 'single', choice: index });
      const next = chosen.includes(index) ? chosen.filter((x) => x !== index) : [...chosen, index].sort((a, b) => a - b);
      onChange({ type: 'multiple', choices: next });
    };
    return (
      <div className="options" role={task.type === 'single' ? 'radiogroup' : 'group'} aria-label="Варианты ответа">
        {order.map((index, position) => {
          const option = task.options[index];
          const isChosen = chosen.includes(index);
          const verdict = !reviewed
            ? ''
            : option.correct
              ? isChosen
                ? 'верно, отмечено'
                : 'верно, пропущено'
              : isChosen
                ? 'неверно, отмечено'
                : '';
          const tone = !reviewed ? '' : option.correct ? ' option--right' : isChosen ? ' option--wrong' : '';
          return (
            <div key={index} className={`option${tone}`}>
              <label className="option__row">
                <input
                  type={task.type === 'single' ? 'radio' : 'checkbox'}
                  name={`option-${uid}`}
                  checked={isChosen}
                  disabled={disabled}
                  onChange={() => toggle(index)}
                />
                <span className="option__num">{position + 1}</span>
                <span className="option__text">{option.text}</span>
                {verdict && <span className="option__verdict">{verdict}</span>}
              </label>
              {reviewed && <p className="option__why">{option.why}</p>}
            </div>
          );
        })}
      </div>
    );
  }

  if (task.type === 'sequence' && answer.type === 'sequence') {
    const move = (position: number, delta: number) => {
      const target = position + delta;
      if (target < 0 || target >= answer.order.length) return;
      const next = [...answer.order];
      [next[position], next[target]] = [next[target], next[position]];
      onChange({ type: 'sequence', order: next });
    };
    const onKey = (e: KeyboardEvent, position: number) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        move(position, e.key === 'ArrowUp' ? -1 : 1);
      }
    };
    return (
      <ol className="sequence" aria-label="Порядок шагов">
        {answer.order.map((index, position) => (
          <li key={index} className="sequence__item" onKeyDown={(e) => !disabled && onKey(e, position)}>
            <span className="sequence__text">{task.items[index]}</span>
            {!disabled && (
              <span className="sequence__moves">
                <button type="button" className="button button--small" disabled={position === 0} onClick={() => move(position, -1)}>
                  Выше
                </button>
                <button
                  type="button"
                  className="button button--small"
                  disabled={position === answer.order.length - 1}
                  onClick={() => move(position, 1)}
                >
                  Ниже
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
    );
  }

  if (task.type === 'matching' && answer.type === 'matching') {
    return (
      <div className="matching">
        {task.pairs.map((pair, i) => {
          const chosen = answer.rights[i];
          const ok = reviewed && chosen === i;
          return (
            <div key={pair.left} className="matching__row">
              <label htmlFor={`match-${uid}-${i}`} className="matching__left">
                {pair.left}
              </label>
              <select
                id={`match-${uid}-${i}`}
                aria-label={pair.left}
                disabled={disabled}
                value={chosen === null ? '' : task.pairs[chosen].right}
                onChange={(e) => {
                  const picked = task.pairs.findIndex((p) => p.right === e.target.value);
                  const rights = [...answer.rights];
                  rights[i] = picked < 0 ? null : picked;
                  onChange({ type: 'matching', rights });
                }}
              >
                <option value="">Выберите</option>
                {order.map((index) => (
                  <option key={index} value={task.pairs[index].right}>
                    {task.pairs[index].right}
                  </option>
                ))}
              </select>
              {reviewed && (
                <span className={ok ? 'matching__verdict matching__verdict--right' : 'matching__verdict matching__verdict--wrong'}>
                  {ok ? 'верно' : `верно: ${pair.right}`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (task.type === 'input' && answer.type === 'input') {
    return (
      <div className="number">
        <input
          type="text"
          inputMode="decimal"
          className="number__field"
          aria-label="Ваш ответ"
          autoComplete="off"
          disabled={disabled}
          value={answer.text}
          onChange={(e) => onChange({ type: 'input', text: e.target.value })}
        />
        {task.unit && <span className="number__unit">{task.unit}</span>}
      </div>
    );
  }

  return null;
}
