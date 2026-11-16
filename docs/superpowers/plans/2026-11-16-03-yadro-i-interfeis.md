# Ядро и интерфейс на пробной базе: план реализации (этап 3 из 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Рабочий тренажёр на пробной базе из 25 заданий, одного кейса-цепочки и 10 карточек: ежедневная сессия с интервальными повторениями, свободная тренировка, мини-тест и экзамен, карточки, прогресс с картой слабых тем и прогнозом, перенос прогресса файлом.

**Architecture:** Формат заданий описан одной zod-схемой в `app/src/core/taskSchema.ts`; её используют и сборщик базы в `tools/`, и программа. Вся предметная логика (оценивание, повторения, сборка сессий и экзаменов, прогноз) — чистые функции в `app/src/core` без DOM и Tauri. База заданий — подписанный файл `tasks.json` рядом с библиотекой на GitHub Pages; копия зашита в сборку, чтобы первый запуск работал без сети. Данные пользователя хранятся JSON-файлами в папке данных приложения через интерфейс `Store` с двумя реализациями (Tauri и браузер).

**Tech Stack:** как в этапах 1–2 (Tauri 2, React 19, TypeScript, Vitest, Rust); добавляются zod в `app/`, Playwright для дымового теста, шрифты (woff2, лицензия OFL) в `app/src/assets/fonts`.

**Spec:** `docs/superpowers/specs/2026-11-15-attestat-trainer-design.md` (разделы 5.2–5.4, 6.2, 7.1–7.4, 8, 10, 11 п. 3)

## Global Constraints

- Сабагенты запускаются только с `model: opus`.
- Весь видимый пользователю русский текст (интерфейс, задания, разборы, карточки) проходит через `humanizer-ru`. В заданиях ему запрещено менять поле `quote`, числа, сроки, названия актов и слова «вправе», «обязан», «не позднее», «не менее», «по согласованию», «с письменного согласия» и подобные.
- Ловушки в заданиях только в формулировке. Вариантов ответа на основе устаревших редакций нет.
- Заданий на суммы, которые индексируются каждый год (МРОТ, размеры пособий), нет. Тип `input` — для сроков, процентов, долей и количеств.
- Каждое задание опирается на норму корпуса: `refs[].doc` существует, `refs[].anchor` существует в этом документе, `refs[].quote` дословно находится в тексте раздела после нормализации пробелов и кавычек.
- Документы со статусом `ocr`: по ним норму находят, а `quote` берут только после сверки со сканом; в задании записывается `scan_page` (страница PDF). Номер пункта берётся из скана. Таблицы цитируются только по скану.
- Документы с `edition_status: original` и непустым `amended_by`: числовые пороги и сроки из них идут в задание только после сверки с действующей редакцией; если её нет, задание на эту норму не пишется.
- Экзамен: 40 заданий, 60 минут, по 8 на модуль; зачёт при общем результате не ниже 70% и не ниже 50% в каждом модуле (Пр-13, п. 3.6). Числа 40 и 60 документами не подтверждены: они лежат константами в одном файле с комментарием об этом.
- Мини-тест по модулю: 8 заданий, 12 минут, зачёт от 50%.
- Пока в `content/topics.yaml` не у всех модулей `ready: true`: полный экзамен и прогноз закрыты, вместо них мини-тест по готовому модулю и строка «готово N из 5 модулей». На этом этапе готовых модулей нет, поэтому пробная база помечается особым флагом `pilot: true` в манифесте базы, и программа открывает мини-тест на пробных заданиях каждого модуля с пометкой «пробная база».
- Интервалы повторения: 1, 3, 7, 16, 35 дней. Ежедневная сессия по умолчанию 20 заданий.
- Слабая тема: точность ниже 60% при не менее 5 ответах. Прогноз показывается при не менее 30 ответах в модуле.
- Цвета только из `app/src/styles/tokens.css`; контраст текста 4.5:1 (`contrast.test.ts`). Тёмной темы нет.
- Текст из базы выводится только как текст: никакого `dangerouslySetInnerHTML`.
- Идентификатор приложения, ключи подписи и схема пакета библиотеки не меняются.
- Работа идёт в ветке `feat/yadro-i-interfeis`, в `main` через PR. Версия после этапа: `0.3.0`.

## Review Focus

1. Прогресс не теряется: закрытие программы посреди сессии или экзамена, сбой записи файла, обновление базы, в котором задание исчезло или у него выросла `revision`. → тесты в Task 5, 6, 12.
2. Повреждённый или чужой файл прогресса при запуске и при импорте: программа не падает, объясняет, что файл не подошёл, и прежние данные не трогает. → тесты в Task 5 и 11.
3. Смена даты и часового пояса: «сегодня» считается по местной дате; перевод часов назад не ломает очередь повторений и серию дней. → тесты в Task 4 и 6.
4. Экзамен: время вышло во время ответа, окно свернули и вернули, компьютер засыпал — время считается по часам, а не по тикам таймера; незаполненные задания считаются неверными. → тесты в Task 9.
5. Ввод в заданиях типа `input`: «1,5», «1.5», пробелы, «10 дней», пустая строка, буквы. → тесты в Task 3.
6. База с неизвестным типом задания или сломанной ссылкой на документ: программа пропускает это задание, остальные работают. → тесты в Task 2 и 7.
7. Пустые состояния: нет заданий по выбранному фильтру, нечего повторять сегодня, ни одного экзамена в истории, библиотека не скачана, а пользователь жмёт «Открыть в библиотеке». → тесты в Task 7, 8, 10.

---

## Структура файлов

```
content/
  tasks/<M>/<тема>.yaml        задания (M — K, R, P, Rez, I)
  cases/<M>/<id>.yaml          кейсы-цепочки
  cards/<M>.yaml               карточки сроков и цифр
  .review/                     журнал проверки заданий (в пакет не идёт)
tools/
  src/tasks.ts                 чтение заданий, кейсов и карточек из content/
  src/validate-tasks.ts        ссылки, цитаты, баланс
  src/build-tasks.ts           npm run build:tasks → tasks.json
  prompts/author-task.md       поручение автору заданий
  prompts/verify-task.md       поручение слепому проверяющему
app/src/
  core/taskSchema.ts           zod-схемы: Task, CaseChain, Card, TasksPack
  core/grade.ts                оценивание пяти типов
  core/srs.ts                  интервальные повторения
  core/dates.ts                местная дата, разница в днях
  core/session.ts              ежедневная сессия и выборка для тренировки
  core/exam.ts                 сборка и подсчёт экзамена и мини-теста
  core/stats.ts                темы, слабые места, серия дней
  core/forecast.ts             прогноз готовности
  core/progress.ts             модель данных пользователя, миграции, применение ответа
  core/examConfig.ts           40 / 60 / 8 / 70% / 50% и мини-тест
  platform/Store.ts            интерфейс хранилища + storeTauri.ts, storeBrowser.ts
  platform/Tasks.ts            источник базы заданий + tasksTauri.ts, tasksBrowser.ts
  bundled/tasks.json           копия базы, зашитая в сборку
  state/AppData.tsx            загрузка базы и прогресса, запись, контекст
  task/                        TaskView и пять видов ввода, разбор, действия
  today/ training/ exam/ cards/ progress/   разделы
  assets/fonts/                выбранная пара шрифтов
app/src-tauri/src/store.rs     чтение и атомарная запись файлов пользователя
app/src-tauri/src/content.rs   установка tasks.json с проверкой подписи
app/e2e/smoke.spec.ts          дымовой сценарий в браузере
```

## Форматы, общие для задач

**Задание** (`content/tasks/<M>/<тема>.yaml`, список):

```yaml
- id: K-otpuska-001            # <модуль>-<тема>-<номер>; не переиспользуется
  type: multiple                # single | multiple | sequence | matching | input
  difficulty: 2                 # 1 | 2 | 3
  situation: Воспитатель дошкольной группы находится в отпуске по уходу за ребёнком…
  question: На каких условиях она может выйти на работу? Отметьте все верные варианты.
  options:                      # single, multiple
    - { text: …, correct: true,  why: … }
    - { text: …, correct: false, why: … }
  # sequence:  items: [шаг, шаг, …] в верном порядке; программа перемешивает
  # matching:  pairs: [{ left: …, right: … }, …]; программа перемешивает правую колонку
  # input:     answer: 3, unit: рабочих дня      (число; unit показывается рядом с полем)
  explanation: Общий разбор, 2–5 предложений.
  refs:
    - { doc: tk-rf, anchor: st-256, quote: "сохраняется в случае, если женщина", scan_page: null }
  trap: { kind: wording, note: «выйти на работу» и «прервать отпуск» — разное }   # необязательно
  revision: 1
  checked: 2026-11-18
```

Модуль и тема берутся из пути файла. У `single` ровно один верный вариант, у `multiple` — от двух до всех без одного; вариантов от 3 до 6; `why` обязателен у каждого. У `sequence` от 3 до 7 шагов, у `matching` от 3 до 6 пар.

**Кейс** (`content/cases/<M>/<id>.yaml`): `id` (`K-case-001`), `topic`, `title`, `intro`, `steps[]` — 3–5 шагов, каждый шаг: `change` (что изменилось в ситуации; у первого шага пусто) и те же поля, что у задания, кроме `situation` и `id`.

**Карточка** (`content/cards/<M>.yaml`): `id` (`K-card-001`), `topic`, `front`, `back`, `refs`.

**`tasks.json`**:

```ts
type TasksPack = {
  schemaVersion: 1;
  packVersion: string;             // как у библиотеки: 2026.11.20.3
  pilot: boolean;                  // пробная база: мини-тесты открыты, экзамен и прогноз закрыты
  modules: Record<ModuleCode, { title: string; ready: boolean; topics: { id: string; title: string }[] }>;
  tasks: (Task & { module: ModuleCode; topic: string })[];
  cases: (CaseChain & { module: ModuleCode })[];
  cards: (Card & { module: ModuleCode })[];
};
```

Манифест на Pages получает второй блок рядом с `library`: `tasks: { file, sha256, signature, bytes, count }`. Программа 0.2.0 лишний блок не замечает.

---

### Task 1: Шрифты и макет

**Files:** Create `docs/design/fonts.html`, затем `app/src/assets/fonts/*`, Modify `app/src/styles/tokens.css`, `app/src/styles/app.css`

- [ ] **Step 1:** Загрузить навыки `frontend-design` и `impeccable`. Сверстать страницу-макет с двумя экранами (задание с разбором и «Сегодня») в трёх вариантах пары шрифтов: Source Serif 4 + Golos Text, PT Serif + PT Sans, Literata + Onest. Цвета и отступы — из токенов. Тексты настоящие: задание про отпуск по уходу из спецификации.
- [ ] **Step 2:** Показать макет заказчику (страница-артефакт), получить выбор пары. Это единственная остановка этапа до его конца.
- [ ] **Step 3:** Положить выбранные шрифты файлами woff2 в `app/src/assets/fonts` (только нужные начертания: текст 400 и 600, заголовки 600), подключить через `@font-face` с `font-display: swap`, записать в `--font-text` и `--font-heading`. Файл лицензии шрифтов рядом.
- [ ] **Step 4:** Проверить в браузере на 1024 × 700 разделы «Библиотека» и «Настройки»: переносы, высота строк, ширина колонки чтения. `npm test`, `npm run lint`.
- [ ] **Step 5: Commit** `feat: шрифты интерфейса`.

---

### Task 2: Схема заданий и сборка базы

**Files:**
- Create: `app/src/core/taskSchema.ts`, `app/src/core/taskSchema.test.ts`, `tools/src/tasks.ts`, `tools/src/validate-tasks.ts`, `tools/src/build-tasks.ts`, `tools/src/tasks.test.ts`, `tools/src/fixtures/tasks-ok/`, `tools/src/fixtures/tasks-bad/`
- Modify: `tools/package.json` (`build:tasks`, `validate` вызывает проверку заданий), `tools/src/schema.ts` (блок `tasks` в `Manifest`)

**Interfaces:**
- Produces (`taskSchema.ts`): zod-схемы и типы `Task`, `CaseChain`, `CaseStep`, `Card`, `TasksPack`, `TaskRef`; `parseTasksPack(json: unknown): { pack: TasksPack; skipped: string[] }` — задания, кейсы и карточки, не прошедшие схему, пропускаются, их `id` попадают в `skipped`; если не разбирается сам конверт (нет `schemaVersion`, `tasks` не массив), бросает ошибку.
- Produces (`tools/src/tasks.ts`): `loadTasks(root): { tasks, cases, cards }` с `module` и `topic` из пути.
- Produces (`validate-tasks.ts`): `validateTasks(root): string[]` — ошибки: повтор `id`; `id` не по шаблону или не совпадает с модулем и темой пути; тема не из `topics.yaml`; `doc` без текста; нет `anchor`; `quote` не найдена в тексте раздела (сравнение после `normalizeQuote`: пробелы схлопнуты, все кавычки → `"`, `ё` → `е`, тире и дефисы → `-`); у документа `ocr` нет `scan_page`; нарушение правил формата из раздела «Форматы». Для модулей с `ready: true` — баланс из спецификации 5.4.
- Produces (`build-tasks.ts`): `buildTasks({ root, out, build, date, pilot }): Manifest['tasks']` пишет `<out>/tasks.json`; порядок детерминированный (по `id`).

- [ ] **Step 1: Падающие тесты.** Схема: по одному верному примеру каждого типа; отказ на `single` с двумя верными, `multiple` с одним верным, вариант без `why`, `sequence` из двух шагов, `input` с нечисловым ответом; `parseTasksPack` пропускает задание неизвестного типа и возвращает остальные. Проверка: фикстура `tasks-ok` даёт `[]`; фикстура `tasks-bad` даёт по одной ошибке на каждое правило (текст ошибки называет `id` задания). Сборка: число заданий, `module` и `topic` из пути, повторная сборка даёт тот же файл.
- [ ] **Step 2:** FAIL → реализовать → PASS (`app` и `tools`), typecheck.
- [ ] **Step 3: Commit** `feat: схема заданий и сборка базы`.

---

### Task 3: Оценивание

**Files:** Create `app/src/core/grade.ts`, `app/src/core/grade.test.ts`

**Interfaces:**
- Produces:

```ts
type Answer =
  | { type: 'single'; choice: number | null }          // индекс варианта в порядке задания
  | { type: 'multiple'; choices: number[] }
  | { type: 'sequence'; order: number[] }              // индексы items в порядке, выбранном человеком
  | { type: 'matching'; rights: (number | null)[] }    // для каждой left — индекс выбранной right
  | { type: 'input'; text: string };
function grade(task: Task | CaseStep, answer: Answer): boolean;
function parseNumber(text: string): number | null;     // «1,5», « 1.5 », «10 дней» → число; иначе null
function isComplete(task: Task | CaseStep, answer: Answer): boolean;  // можно ли нажать «Проверить»
```

- [ ] **Step 1: Падающие тесты:** каждый тип верно и неверно; `multiple` с лишним вариантом и с неполным набором — неверно; `sequence` и `matching` только при полном совпадении; `input`: `'3'`, `' 3 '`, `'3,0'`, `'3.0'`, `'3 рабочих дня'` верны для ответа 3; `''`, `'три'`, `'3 или 4'` неверны; ответ другого типа, чем задание, — неверно, без исключения.
- [ ] **Step 2:** FAIL → реализовать → PASS. **Commit** `feat: оценивание заданий`.

---

### Task 4: Даты и интервальные повторения

**Files:** Create `app/src/core/dates.ts`, `app/src/core/srs.ts`, тесты рядом

**Interfaces:**
- Produces: `localDate(now: Date): string` (`ГГГГ-ММ-ДД` по местному времени); `addDays(date: string, n: number): string`; `daysBetween(a: string, b: string): number`.
- Produces:

```ts
const INTERVALS = [1, 3, 7, 16, 35] as const;
type Srs = { box: number; due: string };               // box 0..4; due — дата следующего показа
function reviewed(prev: Srs | undefined, correct: boolean, today: string): Srs;
function isDue(s: Srs | undefined, today: string): boolean;   // undefined (новое) — не «к повторению»
```

- [ ] **Step 1: Падающие тесты:** первый верный ответ → `box 0`, `due` через 1 день; далее верные поднимают ступень до 4 и дальше не растут (`due` через 35 дней); неверный всегда возвращает в `box 0` с `due` завтра; `isDue` при `due` в прошлом и сегодня — да, завтра — нет; если `today` раньше прежнего `due` (часы перевели назад) — не к повторению, без ошибок; `localDate` для 23:30 и 00:30 местного времени даёт разные даты; `addDays` через конец месяца и года; переход на летнее время не сдвигает дату.
- [ ] **Step 2:** FAIL → реализовать → PASS. **Commit** `feat: интервальные повторения`.

---

### Task 5: Данные пользователя и хранилище

**Files:**
- Create: `app/src/core/progress.ts` + тест, `app/src/platform/Store.ts`, `storeBrowser.ts`, `storeTauri.ts` + тесты, `app/src-tauri/src/store.rs`
- Modify: `app/src/platform/{Platform,fake,browser,tauri}.ts`, `app/src-tauri/src/lib.rs`

**Interfaces:**
- Produces:

```ts
type Attempt = { id: string; at: string; day: string; correct: boolean; mode: 'daily' | 'training' | 'exam' | 'case' | 'cards'; first: boolean };
type ExamRecord = { at: string; kind: 'full' | 'mini'; module?: ModuleCode; total: number; correct: number; byModule: Record<string, { total: number; correct: number }>; passed: boolean; packVersion: string };
type UserData = {
  schema: 1;
  items: Record<string, { srs?: Srs; revision: number; hidden?: boolean }>;   // задания, шаги кейсов, карточки по id
  attempts: Attempt[];
  exams: ExamRecord[];
  settings: { dailySize: number };
  draft?: { kind: 'daily' | 'exam' | 'mini'; … };       // незаконченная сессия: состав, ответы, время начала
};
function emptyUserData(): UserData;
function parseUserData(raw: unknown): UserData;         // бросает UserDataError с кодом 'not-json' | 'wrong-shape' | 'newer-schema'
function applyAnswer(data: UserData, p: { id: string; revision: number; correct: boolean; mode: Attempt['mode']; now: Date }): UserData;
function reconcile(data: UserData, pack: TasksPack): UserData;   // revision выросла → srs сброшен, попытки остаются
function setHidden(data: UserData, id: string, hidden: boolean): UserData;
```

- `first` в попытке — первый ли это ответ на задание текущей ревизии. `applyAnswer` в режиме `exam` попытку записывает, но ступень повторения не двигает, если ответ верный, и сбрасывает, если неверный.
- Produces: `interface Store { load(): Promise<string | null>; save(text: string): Promise<void> }` — один файл `userdata.json`. `Platform` получает поле `store`. Запись атомарная (Rust: временный файл и переименование; при ошибке прежний файл цел). Команды `store_load`, `store_save`.
- Produces: `exportUserData(data): string` и `importUserData(text): UserData` (тот же формат с полем `exportedAt`).

- [ ] **Step 1: Падающие тесты:** `parseUserData` на `null`, строке-не-JSON, массиве, объекте без `items`, `schema: 2` — нужные коды ошибок; `applyAnswer` пишет попытку, выставляет `first`, двигает `srs` по правилам Task 4 и не мутирует вход; `reconcile`: ревизия та же — без изменений, выросла — `srs` снят и `revision` обновлена, задание исчезло — запись остаётся; экспорт → импорт даёт те же данные; `cargo test`: `save` затем `load` возвращает текст, запись поверх существующего файла оставляет прежний при ошибке (каталог вместо файла), `load` без файла — `None`.
- [ ] **Step 2:** FAIL → реализовать → PASS. **Commit** `feat: данные пользователя и хранилище`.

---

### Task 6: Сессии, статистика, прогноз

**Files:** Create `app/src/core/{session,stats,forecast,exam,examConfig}.ts` и тесты

**Interfaces:**
- Produces:

```ts
// session.ts
function dailySession(p: { pack: TasksPack; data: UserData; today: string; size: number; random: () => number }): string[];
function trainingSet(p: { pack: TasksPack; data: UserData; filter: { module?: ModuleCode; topic?: string; difficulty?: 1|2|3; type?: Task['type']; onlyErrors?: boolean } }): string[];
// stats.ts
function topicStats(pack: TasksPack, data: UserData): { module: ModuleCode; topic: string; title: string; answered: number; accuracy: number | null; seen: number; total: number; weak: boolean }[];
function streak(data: UserData, today: string): number;       // подряд идущие дни с ответами, считая сегодня или вчера
// forecast.ts
function moduleEstimate(data: UserData, pack: TasksPack, module: ModuleCode): { answers: number; p: number | null };  // null при < 30 ответах
function passProbability(ps: number[]): number;               // вероятность правила 70/50 на варианте 5 × 8
// exam.ts
function buildExam(p: { pack: TasksPack; data: UserData; random: () => number }): string[] | null;   // null, если база пробная или не все модули готовы
function buildMiniTest(p: { pack: TasksPack; data: UserData; module: ModuleCode; random: () => number }): string[] | null;  // null, если заданий меньше 8 в полной базе; в пробной — берёт сколько есть, но не меньше 3
function scoreExam(tasks: Task[], answers: (Answer | undefined)[], kind: 'full' | 'mini'): { correct: number; total: number; byModule: …; passed: boolean };
function remainingSeconds(startedAt: number, now: number, limitSeconds: number): number;   // по часам, не ниже нуля
```

- `dailySession`: сначала задания к повторению (самые просроченные первыми), затем новые; среди новых слабые темы получают вдвое больший вес; скрытые задания не попадают; шаги кейсов не попадают; размер не больше `size`.
- `moduleEstimate`: доля верных среди первых ответов (`first: true`) с весом `0.97^(возраст в днях)` и сглаживанием: к сумме добавляются 2 условных верных и 2 неверных ответа.
- `passProbability`: точный перебор распределений числа верных по модулям (биномиальное, 8 испытаний) с условиями «в каждом не меньше 4» и «в сумме не меньше 28».

- [ ] **Step 1: Падающие тесты** на каждое правило выше; дополнительно: `dailySession` при пустой базе, при `size` больше числа заданий, когда к повторению больше `size`; `streak` с пропуском дня, при ответах только вчера, при часах, переведённых назад; `passProbability([1,1,1,1,1]) === 1`, `([0.5,…]) < 0.1`, при `p = 0.875` во всех модулях — в интервале 0.85–0.95; `scoreExam`: 28 из 40 при 4 в каждом модуле — зачёт, 28 из 40 при 3 в одном — незачёт, 27 — незачёт, пропущенный ответ — неверный; `remainingSeconds` при скачке часов вперёд на час — 0.
- [ ] **Step 2:** FAIL → реализовать → PASS. **Commit** `feat: сессии, статистика и прогноз`.

---

### Task 7: Экран задания

**Files:** Create `app/src/task/{TaskView,SingleInput,MultipleInput,SequenceInput,MatchingInput,NumberInput,Review,TaskActions}.tsx` и тесты; Modify `app/src/styles/app.css`

**Interfaces:**
- Produces: `<TaskView task onAnswered={(correct, answer) => …} mode="learn" | "exam" onOpenLibrary={(ref) => …} onHide? issueUrl />`. В режиме `learn` после «Проверить» показывает разбор; в режиме `exam` сразу отдаёт ответ наверх и ничего не раскрывает.
- Варианты `single`/`multiple` показываются в порядке, перемешанном один раз на показ (перестановка хранится в состоянии компонента, наружу идут индексы задания).

**Поведение:**
- Шапка: модуль, тема, сложность точками, номер в сессии.
- Клавиатура: цифры выбирают вариант, Enter — «Проверить» или «Дальше», стрелки вверх и вниз двигают выбранный шаг в `sequence`.
- Разбор: у каждого варианта отметка «верно/неверно» и его `why`; общий `explanation`; цитаты норм с подписью документа и кнопкой «Открыть в библиотеке»; у `ocr`-документа рядом пометка «распознано со скана».
- Действия под разбором: «Сообщить об ошибке» (открывает `https://github.com/SOJuse/attestat-trainer/issues/new?title=…&body=…` с `id` задания и версией базы) и «Скрыть задание».
- Если библиотека не скачана, «Открыть в библиотеке» ведёт в раздел «Библиотека» на экран загрузки.
- Задание, чей документ в библиотеке отсутствует, показывается как обычно: ссылка откроет документ со статусом «без текста».

- [ ] **Step 1: Падающие тесты** (Testing Library): каждый тип — выбрать, проверить, увидеть разбор; «Проверить» неактивна, пока ответ неполный; клавиши 1–6 и Enter; в `exam` разбора нет и `onAnswered` получает ответ; ссылка на норму вызывает `onOpenLibrary` с `doc` и `anchor`; «Скрыть задание» вызывает `onHide`; адрес обращения содержит `id` и версию базы и закодирован.
- [ ] **Step 2:** FAIL → реализовать → PASS; тексты через `humanizer-ru`. **Commit** `feat: экран задания`.

---

### Task 8: Данные приложения, «Сегодня» и «Тренировка»

**Files:** Create `app/src/platform/{Tasks,tasksBrowser,tasksTauri}.ts`, `app/src/bundled/tasks.json`, `app/src/state/AppData.tsx`, `app/src/today/TodayView.tsx`, `app/src/training/{TrainingView,CaseView}.tsx`, `app/src-tauri/src/content.rs`, тесты; Modify `App.tsx`, `lib.rs`, `fake.ts`

**Interfaces:**
- Produces: `interface TasksSource { current(): Promise<TasksPack>; update(): Promise<'installed' | 'up-to-date'> }`. `current()` отдаёт установленную базу, если она есть и новее зашитой, иначе зашитую. `update()` читает манифест, при более новой версии скачивает `tasks.json`, Rust проверяет подпись (`PACK_PUBKEY`) и хеш и сохраняет файл; ошибки — `LibraryError`.
- Produces: `<AppDataProvider platform>` и `useAppData(): { pack, data, skipped, answer(…), hide(…), saveDraft(…), setSettings(…), replaceData(…) }`. При запуске: загрузить базу и `userdata.json`, вызвать `reconcile`, сохранить. Запись после каждого ответа; при ошибке записи вверху окна строка «Не удалось сохранить прогресс» с кнопкой «Повторить», данные в памяти не теряются.
- Обновление базы: при запуске и раз в 24 часа, пока программа открыта; новая база применяется только когда нет незаконченной сессии или экзамена.
- Повреждённый `userdata.json` при запуске: файл не перезаписывается; показывается экран с двумя кнопками: «Сохранить копию файла» и «Начать с чистого листа».

**Поведение:**
- «Сегодня»: кнопка «Начать» с числом заданий (сколько к повторению и сколько новых); после сессии итог: верных, какие темы просели; прогноз или строка «готово N из 5 модулей»; серия дней. Незаконченная сессия продолжается с того же места.
- «Тренировка»: фильтры (модуль, тема, сложность, тип, только ошибки), число подходящих заданий, кнопка «Начать»; список кейсов. Кейс: вводная, шаги по очереди, перед каждым шагом строка «Что изменилось».
- Пусто по фильтру: «Под такой набор заданий нет. Снимите один из фильтров».

- [ ] **Step 1: Падающие тесты:** провайдер отдаёт зашитую базу без сети; `reconcile` вызван при запуске; ответ сохраняется (в `store.save` приходит попытка); сбой записи показывает строку и повтор срабатывает; повреждённый файл — экран выбора, `save` не вызывается; «Сегодня» показывает числа, сессия проходит до итога, перезапуск посреди сессии продолжает её; фильтры тренировки; кейс проходит по шагам. `cargo test` для `content.rs`: чужая подпись отвергается, прежний файл цел.
- [ ] **Step 2:** FAIL → реализовать → PASS. **Commit** `feat: ежедневная сессия и тренировка`.

---

### Task 9: Экзамен и мини-тест

**Files:** Create `app/src/exam/{ExamView,ExamRun,ExamProtocol,LibraryPanel}.tsx` и тесты

**Поведение:**
- Вход: карточка полного экзамена (если закрыт — почему и что нужно) и мини-тесты по модулям.
- Ход: таймер по часам (`remainingSeconds`), список номеров заданий с отметкой «отвечено», переход к любому заданию, изменение ответа до завершения; справа сворачиваемая панель поиска по библиотеке (`LibraryView` в узкой колонке).
- Завершение: по кнопке (с подтверждением, если есть неотвеченные) или по истечении времени. Состояние экзамена пишется в `draft` после каждого ответа: перезапуск программы продолжает экзамен, а если время за это время вышло — сразу показывает протокол.
- Протокол: общий процент, по модулям, «Зачёт» или «Незачёт» с указанием, какое правило не выполнено; список ошибок с разбором. Запись в `exams`, попытки с `mode: 'exam'`.

- [ ] **Step 1: Падающие тесты** (часы подменяются): время идёт по часам, а не по тикам; истечение времени завершает экзамен и считает неотвеченные неверными; перезапуск продолжает; перезапуск после истечения показывает протокол; протокол для трёх случаев из Task 6; закрытый экзамен объясняет причину; мини-тест пробной базы помечен «пробная база».
- [ ] **Step 2:** FAIL → реализовать → PASS. **Commit** `feat: экзамен и мини-тест`.

---

### Task 10: Карточки и «Прогресс»

**Files:** Create `app/src/cards/CardsView.tsx`, `app/src/progress/{ProgressView,TopicMap,ExamHistory}.tsx` и тесты

**Поведение:**
- Карточки: выбор модуля или «все к повторению»; карточка переворачивается щелчком или пробелом; «Знаю» и «Не знаю» двигают ступень как у заданий (`mode: 'cards'`); в конце итог. Нечего повторять: «На сегодня карточек нет. Новые: N» с кнопкой «Взять новые».
- Прогресс: по модулям — готов ли модуль, сколько заданий пройдено, точность; под модулем темы с точностью и пометкой слабых, у слабой темы кнопка «Тренировать» (открывает тренировку с этим фильтром) и ссылка на первый опорный документ темы; история экзаменов таблицей; прогноз по дням, если данных хватает. Пусто: «Здесь появится статистика после первых ответов».

- [ ] **Step 1: Падающие тесты:** переворот по пробелу; ответы двигают очередь; пустое состояние; карта тем по фикстуре с известной точностью; слабая тема помечена и ведёт в тренировку; история экзаменов; пустые состояния.
- [ ] **Step 2:** FAIL → реализовать → PASS. **Commit** `feat: карточки и прогресс`.

---

### Task 11: Настройки: перенос и сброс прогресса

**Files:** Modify `app/src/components/SettingsView.tsx` + тест; `Platform` получает `saveFile(name, text)` и `pickFile(): Promise<string | null>` (Tauri: `tauri-plugin-dialog` + `plugin-fs` с доступом только к выбранному файлу; браузер: ссылка-скачивание и `<input type="file">`)

**Поведение:** размер ежедневной сессии (5–50); «Сохранить прогресс в файл»; «Загрузить прогресс из файла» с подтверждением «текущий прогресс будет заменён» и с отказом, если файл не подошёл (текст по коду ошибки из Task 5); «Сбросить прогресс» с подтверждением вводом слова «сбросить»; версии программы, библиотеки и базы заданий.

- [ ] **Step 1: Падающие тесты** на каждое действие, включая отказ на чужом файле (прежние данные не тронуты) и отмену в диалогах.
- [ ] **Step 2:** FAIL → реализовать → PASS. **Commit** `feat: перенос и сброс прогресса`.

---

### Task 12: Пробная база

**Files:** Create `tools/prompts/author-task.md`, `tools/prompts/verify-task.md`, `content/tasks/**`, `content/cases/K/K-case-001.yaml`, `content/cards/*.yaml`, `content/.review/*`, `app/src/bundled/tasks.json`

- [ ] **Step 1: Поручения.** `author-task.md`: формат из раздела «Форматы», требования спецификации 5.2–5.4 и 2 (анти-цели), все правила Global Constraints о нормах, `ocr` и исходных редакциях, пример задания про отпуск по уходу; автор получает тему из `topics.yaml` и читает только тексты её опорных разделов. `verify-task.md`: проверяющий получает задание без `correct`, `why`, `answer`, `explanation` и те же тексты; решает сам и называет норму; отдельно отвечает: есть ли второй защитимый ответ, выдаёт ли верный вариант себя длиной или подробностью, честна ли ловушка, совпадает ли цитата с текстом.
- [ ] **Step 2: Автор.** По одному сабагенту на модуль: 5 заданий (по одному каждого типа, сложность 1, 2, 2, 3, 3) из разных тем, только по документам с `text: full`. Для модуля «Результаты», где почти всё распознано, задания берутся по статьям закона об образовании (ст. 58–60) и по тем пунктам `ocr`-документов, которые сабагент сверил со сканом и записал `scan_page`. Модуль «Кадры» дополнительно: кейс из 4 шагов (отпуск по уходу за ребёнком, пример заказчика) и 10 карточек сроков.
- [ ] **Step 3:** `npm run validate` в `tools/` — без ошибок (ссылки и цитаты).
- [ ] **Step 4: `humanizer-ru`** по разрешённым полям; снова `validate`.
- [ ] **Step 5: Слепая проверка.** Свежий сабагент на модуль. Расхождение или сомнение возвращает задание автору один раз, затем шаги 3–5 повторяются; не сошлось — задание выбрасывается и заменяется новым. Журнал в `content/.review/<модуль>.md`.
- [ ] **Step 6:** `npm run build:tasks -- --pilot --out ../app/src/bundled`; тест в `app` проверяет, что зашитая база разбирается без пропусков и в ней 25 заданий, 1 кейс, 10 карточек, все пять типов в каждом модуле.
- [ ] **Step 7: Commit** `content: пробная база заданий`.

---

### Task 13: Публикация базы, дымовой тест, выпуск 0.3.0

**Files:** Modify `.github/workflows/content.yml` (сборка и подпись `tasks.json`, блок `tasks` в манифесте), `.github/workflows/ci.yml` (задача `e2e`), Create `app/e2e/smoke.spec.ts`, `app/playwright.config.ts`; версии в трёх файлах; `README.md`

- [ ] **Step 1:** `content.yml`: после сборки библиотеки `npm run build:tasks -- --pilot --out ../pack`; задача `sign` подписывает оба файла и вписывает обе подписи в манифест. Тест сборки манифеста в `tools`.
- [ ] **Step 2: Дымовой сценарий** (Playwright, собранный интерфейс в Chromium, браузерная платформа): открыть «Тренировку», решить по одному заданию каждого типа; пройти мини-тест до протокола; найти статью в библиотеке; сохранить прогресс в файл. Задача `e2e` в CI.
- [ ] **Step 3:** Если заказчик подтвердил, что обновление и скачивание библиотеки в 0.2.0 работают: сузить права в `capabilities/default.json` (`core:app:allow-version`, `core:event:default`, `updater:allow-check`, `updater:allow-download-and-install`) с тестом конфигурации. Если не подтвердил — не трогать и записать в журнал.
- [ ] **Step 4:** README: разделы о тренировке, экзамене и переносе прогресса. Версия `0.3.0`. Локальная сборка под Apple Silicon, запуск. PR, проверки, итоговая проверка ветки сабагентом, исправления.
- [ ] **Step 5:** После слияния: тег `v0.3.0`, дождаться релиза и `content.yml`; проверить манифест (оба блока, обе подписи принимаются `cargo test real_pack`).
- [ ] **Step 6:** Заказчик проверяет на Mac: обновление до 0.3.0, сессия «Сегодня», мини-тест, карточки, сохранение и загрузка прогресса.

---

## Готово, когда

- в программе 0.3.0 работают все шесть разделов на пробной базе;
- прогресс переживает перезапуск, обновление базы и перенос файлом;
- пробные 25 заданий прошли слепую проверку и лежат в журнале;
- CI зелёный: `app`, `content`, `rust`, `e2e`;
- заказчик выбрал шрифты и видел программу на своём Mac.
