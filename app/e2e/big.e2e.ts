import { expect, test } from '@playwright/test';

/** База из 300 заданий: пять готовых модулей, в каждом 12 тем по 5 заданий. */
function bigPack() {
  const modules = ['K', 'R', 'P', 'Rez', 'I'];
  const topics = Array.from({ length: 12 }, (_, i) => ({ id: `tema-${i + 1}`, title: `Тема ${i + 1} с длинным названием, как в настоящей базе заданий` }));
  const info = (title: string) => ({ title, ready: true, topics });
  const tasks = modules.flatMap((module) =>
    topics.flatMap((topic) =>
      Array.from({ length: 5 }, (_, n) => ({
        id: `${module}-${topic.id}-${String(n + 1).padStart(3, '0')}`,
        module,
        topic: topic.id,
        type: 'single',
        difficulty: (n % 3) + 1,
        situation: 'Ситуация из жизни школы.',
        question: 'Как поступить? Выберите один вариант.',
        options: [
          { text: 'Верный вариант', correct: true, why: 'Так сказано в норме.' },
          { text: 'Неверный вариант', correct: false, why: 'Норма говорит иначе.' },
          { text: 'Ещё один неверный', correct: false, why: 'Норма говорит иначе.' },
        ],
        explanation: 'Разбор.',
        refs: [{ doc: 'tk-rf', anchor: 'st-1', quote: 'цитата' }],
        revision: 1,
        checked: '2026-11-16',
      })),
    ),
  );
  return {
    schemaVersion: 1,
    packVersion: '2026.12.31.1',
    pilot: false,
    modules: { K: info('Кадры'), R: info('Ресурсы'), P: info('Процессы'), Rez: info('Результаты'), I: info('Информация') },
    docs: { 'tk-rf': { title: 'Трудовой кодекс Российской Федерации', ocr: false } },
    tasks,
    cases: [],
    cards: [],
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((pack) => localStorage.setItem('attestat-test-pack', pack), JSON.stringify(bigPack()));
});

test('на полной базе сессия не больше размера из настроек', async ({ page }) => {
  await page.goto('/');
  const figure = page.locator('.figure', { hasText: 'заданий на сегодня' });
  await expect(figure.locator('b')).toHaveText('20');
});

test('на полной базе мини-тест берёт восемь заданий, а полный экзамен сорок', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Экзамен' }).click();
  await page.getByRole('button', { name: 'Мини-тест: Кадры' }).click();
  await expect(page.getByRole('navigation', { name: 'Задания' }).getByRole('button')).toHaveCount(8);
  await page.getByRole('button', { name: 'Завершить' }).click();
  await page.getByRole('button', { name: 'Да, завершить' }).click();
  await page.getByRole('button', { name: 'Готово' }).click();
  await page.getByRole('button', { name: 'Начать экзамен' }).click();
  await expect(page.getByRole('navigation', { name: 'Задания' }).getByRole('button')).toHaveCount(40);
});

test('«Прогресс» с шестьюдесятью темами помещается по ширине', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Тренировка' }).click();
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Проверить' }).click();
  await page.getByRole('button', { name: 'Закончить' }).click();
  await page.getByRole('button', { name: 'Прогресс' }).click();
  await expect(page.getByRole('heading', { name: /Кадры/ })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const wide = (el: Element) => el.scrollWidth - el.clientWidth;
    return Math.max(wide(document.documentElement), ...[...document.querySelectorAll('.content, .pane')].map(wide));
  });
  expect(overflow).toBeLessThanOrEqual(1);
});
