import { expect, test, type Page } from '@playwright/test';

const TYPES = ['single', 'multiple', 'sequence', 'matching', 'input'] as const;

/** Даёт какой-нибудь полный ответ на показанное задание: верность здесь не важна. */
async function answerAnything(page: Page) {
  const task = page.locator('.task').first();
  const radios = task.getByRole('radio');
  const boxes = task.getByRole('checkbox');
  const selects = task.locator('.matching select');
  const field = task.getByRole('textbox', { name: 'Ваш ответ' });
  if (await radios.count()) await radios.first().check();
  else if (await boxes.count()) {
    await boxes.nth(0).check();
    await boxes.nth(1).check();
  } else if (await selects.count()) {
    for (let i = 0; i < (await selects.count()); i++) await selects.nth(i).selectOption({ index: 1 });
  } else if (await field.count()) await field.fill('1');
  // у задания на порядок начальная расстановка уже считается ответом
}

test('тренировка: по одному заданию каждого типа проходит до разбора', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Тренировка' }).click();
  for (const type of TYPES) {
    await page.getByLabel('Тип задания').selectOption(type);
    await expect(page.getByText(/Подходит заданий: [1-9]/)).toBeVisible();
    await page.getByRole('button', { name: 'Начать', exact: true }).click();
    await answerAnything(page);
    await page.getByRole('button', { name: 'Проверить' }).click();
    await expect(page.getByRole('heading', { name: 'Разбор' })).toBeVisible();
    await expect(page.locator('.quote').first()).toBeVisible();
    // выйти из набора: заново открыть раздел через карту тем нельзя, поэтому просто перезагрузка
    await page.reload();
    await page.getByRole('button', { name: 'Тренировка' }).click();
  }
});

test('мини-тест доходит до протокола', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Экзамен' }).click();
  await page.getByRole('button', { name: /^Мини-тест:/ }).first().click();
  await expect(page.getByRole('timer')).toBeVisible();
  await answerAnything(page);
  await page.getByRole('button', { name: 'Завершить' }).click();
  await page.getByRole('button', { name: 'Да, завершить' }).click();
  await expect(page.getByRole('heading', { name: 'Протокол' })).toBeVisible();
});

test('библиотека находит статью по словам из текста', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Библиотека' }).click();
  await page.getByRole('searchbox', { name: 'Поиск по документам' }).fill('отпуск по уходу');
  const hits = page.getByRole('list', { name: 'Результаты поиска' });
  await expect(hits.getByText(/Статья 256/).first()).toBeVisible();
});

test('прогресс сохраняется в файл', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Настройки' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить прогресс в файл' }).click();
  expect((await download).suggestedFilename()).toMatch(/^attestat-progress-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(page.getByText('Файл сохранён.')).toBeVisible();
});
