# Каркас и выпуск: план реализации (этап 1 из 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Публичный репозиторий `SOJuse/attestat-trainer` с пустой программой «Аттестация 1103» (боковая навигация, шесть разделов-заглушек, настройки), которая собирается под macOS и Windows по тегу и сама обновляется с GitHub.

**Architecture:** Tauri 2 поверх React + TypeScript + Vite в папке `app/`. Интерфейс не зовёт Tauri напрямую: всё идёт через интерфейс `Platform` с двумя реализациями (Tauri и браузер), поэтому тесты и разработка идут в обычном браузере. Выпуск делает `tauri-action` по тегу `vX.Y.Z`, обновления подписываются ключом Tauri (не Apple).

**Tech Stack:** Node 24, npm, Vite 8, React 19, TypeScript, Vitest 5 + Testing Library, ESLint, Rust 1.96, Tauri 2.12 (`@tauri-apps/plugin-updater`, `plugin-process`, `plugin-opener`), GitHub Actions, `tauri-apps/tauri-action@v0`.

**Spec:** `docs/superpowers/specs/2026-11-15-attestat-trainer-design.md`

Проект разбит на четыре плана, каждый даёт работающий результат: 1) каркас и выпуск (этот файл); 2) корпус документов и библиотека; 3) ядро и интерфейс на пробной базе; 4) база заданий. Планы 2–4 пишутся перед своим этапом, когда известны итоги предыдущего.

## Global Constraints

- Обязательная цель сборки: `aarch64-apple-darwin`. Дополнительно `x86_64-apple-darwin` и `x86_64-pc-windows-msvc`.
- Подписи Apple нет: в `tauri.conf.json` стоит `bundle.macOS.signingIdentity: "-"` (ad-hoc).
- Минимальное окно 1024 × 700, стартовое 1280 × 820.
- Цвета только из токенов спецификации (раздел 8): `#13293D`, `#6E7F8D`, `#0F6CB0`, `#DCE6EE`, `#E4EFF7`, `#EFF5FA`, `#FFFFFF`, `#357F2C`, `#D8332A`, `#F0B429`. Тёмной темы нет.
- Шрифты на этом этапе системные (`system-ui`); пара шрифтов выбирается заказчиком по макету в плане 3.
- Весь видимый пользователю русский текст (интерфейс, README, заметки к релизу) перед коммитом проходит через навык `humanizer-ru`.
- Сабагенты запускаются только с `model: opus`.
- Телеметрии нет. Сеть: только `github.com` за обновлениями.
- Имена файлов сборок только латиницей: GitHub портит кириллицу в именах вложений релиза, и ссылки из `latest.json` ломаются. Поэтому `productName` — `Attestat1103`, а русское имя задаётся отдельно (заголовок окна и `CFBundleDisplayName`).
- Идентификатор приложения: `io.github.sojuse.attestat-trainer`. Менять его после первого релиза нельзя: от него зависит папка данных пользователя.
- Коммиты на русском или английском, в конце строка `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. Запуск без сети: проверка обновлений падает молча, программа открывается как обычно, баннера ошибки нет. → тест в Task 3.
2. Адрес `latest.json` отдаёт 404 (релизов ещё нет или GitHub недоступен): то же поведение, что без сети. → тест в Task 3.
3. Загрузка обновления оборвалась посередине: пользователь видит «Не удалось обновить» и кнопку «Повторить», программа продолжает работать на старой версии. → тест в Task 3.
4. Первый запуск неподписанной сборки на macOS и Windows: без инструкции человек решит, что файл повреждён. → README со снимками, Task 6.
5. Узкое окно (1024 × 700): боковая панель и содержимое не дают горизонтальной прокрутки. → тест вёрстки в Task 1 (проверка `min-width` в конфиге) и ручная проверка в Task 6.

---

## Структура файлов

```
.gitignore
LICENSE                         MIT, код
LICENSE-content                 CC BY 4.0, задания (текст-заглушка со ссылкой на лицензию)
README.md                       что это, установка, оговорка
.github/workflows/ci.yml
.github/workflows/release.yml
app/
  package.json  vite.config.ts  tsconfig.json  eslint.config.js  index.html
  src/
    main.tsx                    точка входа, выбирает реализацию Platform
    App.tsx                     оболочка: боковая панель + текущий раздел
    sections.ts                 список разделов (id, название)
    styles/tokens.css           цвета, отступы, радиусы
    styles/app.css              вёрстка оболочки
    assets/logo-1103.jpeg       копия pedsovet-1103/ref/ppt/media/image3.jpeg
    platform/Platform.ts        интерфейс
    platform/browser.ts         реализация для браузера
    platform/tauri.ts           реализация для Tauri
    platform/fake.ts            управляемая подделка для тестов
    components/Sidebar.tsx
    components/Placeholder.tsx  заглушка раздела
    components/UpdateBanner.tsx
    components/SettingsView.tsx
    **/*.test.tsx               рядом с компонентами
  src-tauri/
    Cargo.toml  tauri.conf.json  Info.plist  capabilities/default.json
    src/main.rs  src/lib.rs
    icons/
```

---

### Task 1: Каркас программы и оболочка с навигацией

**Files:**
- Create: всё из дерева выше, кроме `platform/*`, `UpdateBanner`, `SettingsView`, workflows, README
- Test: `app/src/App.test.tsx`, `app/src/config.test.ts`

**Interfaces:**
- Produces: `sections.ts` экспортирует
  `type SectionId = 'today' | 'training' | 'exam' | 'cards' | 'library' | 'progress' | 'settings'` и
  `const SECTIONS: { id: SectionId; title: string }[]` с названиями по порядку: «Сегодня», «Тренировка», «Экзамен», «Карточки», «Библиотека», «Прогресс» (настройки в список не входят, у них отдельная кнопка внизу панели с `aria-label="Настройки"`).
- Produces: `<App />` без обязательных пропсов на этом шаге (в Task 2 появится `platform`).

- [ ] **Step 1: Создать проект.** В корне: `npm create tauri-app@latest app -- --template react-ts --manager npm --identifier io.github.sojuse.attestat-trainer --yes`. Удалить демо-код шаблона (`App.css`, логотипы, команду `greet` в `lib.rs`). Поставить dev-зависимости: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`. Скрипты в `app/package.json`: `dev`, `build` (`tsc -b && vite build`), `test` (`vitest run`), `lint` (`eslint .`), `typecheck` (`tsc -b --noEmit`), `tauri`.

- [ ] **Step 2: Написать падающие тесты.**

```tsx
// app/src/App.test.tsx
it('показывает шесть разделов по порядку', () => {
  render(<App />);
  const nav = screen.getByRole('navigation', { name: 'Разделы' });
  expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(
    ['Сегодня', 'Тренировка', 'Экзамен', 'Карточки', 'Библиотека', 'Прогресс']);
});
it('открывает «Сегодня» при запуске и переключает раздел по клику', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Сегодня');
  await userEvent.click(screen.getByRole('button', { name: 'Библиотека' }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Библиотека');
  expect(screen.getByRole('button', { name: 'Библиотека' })).toHaveAttribute('aria-current', 'page');
});
it('показывает логотип школы', () => {
  render(<App />);
  expect(screen.getByAltText('Школа № 1103')).toBeInTheDocument();
});
```

```ts
// app/src/config.test.ts — читает src-tauri/tauri.conf.json через fs
it('окно и сборка настроены по спецификации', () => {
  expect(conf.productName).toBe('Attestat1103');
  expect(conf.identifier).toBe('io.github.sojuse.attestat-trainer');
  const w = conf.app.windows[0];
  expect([w.minWidth, w.minHeight, w.width, w.height]).toEqual([1024, 700, 1280, 820]);
  expect(w.title).toBe('Аттестация 1103');
  expect(conf.bundle.macOS.signingIdentity).toBe('-');
});
```

- [ ] **Step 3: Запустить** `cd app && npm test` — ожидается FAIL (нет `SECTIONS`, конфиг шаблонный).

- [ ] **Step 4: Реализовать.** `tokens.css` — переменные `--ink`, `--muted`, `--accent`, `--line`, `--soft`, `--softer`, `--bg`, `--ok`, `--bad`, `--warn` со значениями из Global Constraints. `App.tsx` держит текущий раздел в `useState<SectionId>('today')`, библиотеки маршрутизации нет. `Sidebar` — `<nav aria-label="Разделы">`, ширина 208px, логотип сверху, кнопка настроек снизу. `Placeholder` показывает `<h1>` с названием раздела и строку «Раздел появится в следующих версиях». Содержимое `main` получает `min-width: 0`, чтобы не появлялась горизонтальная прокрутка. `tauri.conf.json` — значения из теста; `Info.plist` в `src-tauri/` с `CFBundleDisplayName` = `Аттестация 1103`. Скопировать логотип. Иконки: нарисовать `app-icon.svg` (белая цифра «1103» на `#0F6CB0`, скруглённый квадрат) и выполнить `npm run tauri icon app-icon.svg`.

- [ ] **Step 5: Проверить.** `npm test` — PASS (4 теста); `npm run lint && npm run typecheck` — без ошибок; `npm run tauri dev` — открывается окно с панелью, разделы переключаются.

- [ ] **Step 6: Commit** `feat: каркас программы и навигация по разделам` (вместе с `.gitignore`, `LICENSE`, `LICENSE-content`). Отдельным первым коммитом `docs: проект и план этапа 1` закоммитить папку `docs/superpowers/`.

---

### Task 2: Интерфейс Platform и экран настроек

**Files:**
- Create: `app/src/platform/{Platform,browser,tauri,fake}.ts`, `app/src/components/SettingsView.tsx`
- Modify: `app/src/main.tsx`, `app/src/App.tsx`
- Test: `app/src/components/SettingsView.test.tsx`

**Interfaces:**
- Produces:

```ts
// platform/Platform.ts
export type AppUpdate = { version: string; notes?: string };
export interface Platform {
  appVersion(): Promise<string>;
  checkAppUpdate(): Promise<AppUpdate | null>;          // null — обновлений нет; бросает при ошибке сети
  installAppUpdate(onProgress?: (fraction: number) => void): Promise<void>; // после успеха перезапускает программу
  openExternal(url: string): Promise<void>;
}
```

- Produces: `createFakePlatform(overrides?: Partial<Platform>): Platform` — по умолчанию версия `'0.0.0-test'`, обновлений нет.
- Produces: `<App platform={Platform} />` — проп обязателен; `main.tsx` выбирает `tauri` при наличии `window.__TAURI_INTERNALS__`, иначе `browser`.
- `browser.ts`: `appVersion` возвращает `import.meta.env.VITE_APP_VERSION ?? 'dev'`, `checkAppUpdate` — `null`, `openExternal` — `window.open(url, '_blank', 'noopener')`.
- `tauri.ts`: `getVersion` из `@tauri-apps/api/app`, `openUrl` из `@tauri-apps/plugin-opener`; методы обновления на этом шаге возвращают `null` и ничего не делают (заполняются в Task 3).

- [ ] **Step 1: Падающий тест.**

```tsx
it('показывает версию программы и оговорку', async () => {
  render(<SettingsView platform={createFakePlatform({ appVersion: async () => '0.1.0' })} />);
  expect(await screen.findByText('Версия программы: 0.1.0')).toBeInTheDocument();
  expect(screen.getByText(/не связан с Корпоративным университетом/)).toBeInTheDocument();
});
it('ссылка на репозиторий открывается через платформу', async () => {
  const openExternal = vi.fn(async () => {});
  render(<SettingsView platform={createFakePlatform({ openExternal })} />);
  await userEvent.click(screen.getByRole('button', { name: 'Открыть страницу проекта' }));
  expect(openExternal).toHaveBeenCalledWith('https://github.com/SOJuse/attestat-trainer');
});
```

- [ ] **Step 2:** `npm test` — FAIL.
- [ ] **Step 3: Реализовать** по интерфейсам выше. Текст оговорки (до прогона через humanizer-ru): «Тренажёр неофициальный и не связан с Корпоративным университетом московского образования и Департаментом образования и науки города Москвы. Задания авторские, они не взяты из экзаменационного банка.» Добавить `plugin-opener` в `Cargo.toml`, `lib.rs` и `capabilities/default.json` (`opener:allow-open-url` с разрешением `https://github.com/*`). Тесты Task 1 обновить: `render(<App platform={createFakePlatform()} />)`.
- [ ] **Step 4:** `npm test` — PASS; `npm run lint && npm run typecheck`.
- [ ] **Step 5: Commit** `feat: слой Platform и экран настроек`.

---

### Task 3: Автообновление программы

**Files:**
- Create: `app/src/components/UpdateBanner.tsx`
- Modify: `app/src/platform/tauri.ts`, `app/src/App.tsx`, `app/src-tauri/{Cargo.toml,src/lib.rs,tauri.conf.json,capabilities/default.json}`
- Test: `app/src/components/UpdateBanner.test.tsx`

**Interfaces:**
- Consumes: `Platform`, `createFakePlatform` из Task 2.
- Produces: `<UpdateBanner platform={Platform} />` — сам проверяет обновление один раз при монтировании; ничего не рисует, пока обновления нет.

- [ ] **Step 1: Падающие тесты.**

```tsx
it('ничего не показывает, если обновлений нет', async () => {
  const { container } = render(<UpdateBanner platform={createFakePlatform()} />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
it('молчит, если проверка упала (нет сети, 404)', async () => {
  const p = createFakePlatform({ checkAppUpdate: async () => { throw new Error('offline'); } });
  const { container } = render(<UpdateBanner platform={p} />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});
it('предлагает обновление и запускает установку', async () => {
  const installAppUpdate = vi.fn(async () => {});
  const p = createFakePlatform({ checkAppUpdate: async () => ({ version: '0.2.0' }), installAppUpdate });
  render(<UpdateBanner platform={p} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Обновить' }));
  expect(screen.getByRole('status')).toHaveTextContent('Доступна версия 0.2.0');
  expect(installAppUpdate).toHaveBeenCalledOnce();
});
it('при сбое установки показывает ошибку и кнопку «Повторить»', async () => {
  const installAppUpdate = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined);
  const p = createFakePlatform({ checkAppUpdate: async () => ({ version: '0.2.0' }), installAppUpdate });
  render(<UpdateBanner platform={p} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Обновить' }));
  expect(await screen.findByText('Не удалось обновить')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect(installAppUpdate).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2:** `npm test` — FAIL.
- [ ] **Step 3: Сгенерировать ключ обновлений.** `npm run tauri signer generate -- -w ~/.tauri/attestat-trainer.key --ci` (пароль пустой). Приватный ключ в репозиторий не попадает. Публичный ключ записать в `tauri.conf.json`:

```json
"bundle": { "createUpdaterArtifacts": true },
"plugins": { "updater": {
  "pubkey": "<содержимое ~/.tauri/attestat-trainer.key.pub>",
  "endpoints": ["https://github.com/SOJuse/attestat-trainer/releases/latest/download/latest.json"]
} }
```

- [ ] **Step 4: Реализовать.** Подключить `tauri-plugin-updater` и `tauri-plugin-process` (Cargo, `lib.rs`, права `updater:default`, `process:allow-restart`). В `tauri.ts`: `checkAppUpdate` вызывает `check()` и возвращает `{ version, notes: body }` или `null`; `installAppUpdate` вызывает `downloadAndInstall` с пересчётом событий `Started/Progress/Finished` в долю, затем `relaunch()`. `UpdateBanner` — полоска над содержимым с `role="status"`, во время загрузки кнопка заменяется на процент. `App` рисует баннер над текущим разделом. В `SettingsView` добавить кнопку «Проверить обновления», она показывает «У вас последняя версия» или тот же баннер.
- [ ] **Step 5:** `npm test` — PASS; `npm run tauri build -- --target aarch64-apple-darwin` с переменной `TAURI_SIGNING_PRIVATE_KEY` — в `src-tauri/target/aarch64-apple-darwin/release/bundle/` появились `.dmg`, `.app.tar.gz` и `.app.tar.gz.sig`.
- [ ] **Step 6: Commit** `feat: автообновление программы`.

---

### Task 4: CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Написать workflow.** Триггеры: `push` в `main`, `pull_request`. Одна задача на `ubuntu-latest`: `actions/checkout@v4`, `actions/setup-node@v4` (node 24, кэш npm по `app/package-lock.json`), затем в `app/`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Rust в CI не собирается: его проверяет release-сборка, а на каждый push это 10+ минут.
- [ ] **Step 2: Проверить локально** те же пять команд подряд — все проходят.
- [ ] **Step 3: Commit** `ci: проверки на каждый push`. Запуск на GitHub проверяется в Task 5 после создания репозитория.

Дымовой тест интерфейса в браузере и проверка базы из спецификации (раздел 9) добавляются в этот файл в планах 3 и 2: сейчас им нечего проверять.

---

### Task 5: Репозиторий и release-сборки

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Написать workflow.** Триггер: `push` тегов `v*`. `permissions: contents: write`. Матрица:

| runner | args |
|---|---|
| `macos-latest` | `--target aarch64-apple-darwin` |
| `macos-latest` | `--target x86_64-apple-darwin` |
| `windows-latest` | (пусто) |

Шаги: checkout, setup-node 24, `dtolnay/rust-toolchain@stable` (для macOS `targets: aarch64-apple-darwin,x86_64-apple-darwin`), `swatinem/rust-cache@v2` (`workspaces: app/src-tauri`), `npm ci` в `app/`, затем `tauri-apps/tauri-action@v0` с `projectPath: app`, `tagName: ${{ github.ref_name }}`, `releaseName: 'Аттестация 1103 ${{ github.ref_name }}'`, `releaseDraft: false`, `prerelease: false`, `includeUpdaterJson: true`, `args: ${{ matrix.args }}`; env: `GITHUB_TOKEN`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Версия берётся из `tauri.conf.json`; отдельный первый шаг падает, если она не равна тегу без `v`.
- [ ] **Step 2: Commit и создание репозитория.** Commit `ci: сборка релизов по тегу`. `gh repo create SOJuse/attestat-trainer --public --source . --remote origin --description "Тренажёр для подготовки к аттестационному тестированию руководителей школ"`; `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/attestat-trainer.key`; `gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""`; `git push -u origin main`.
- [ ] **Step 3: Проверить CI.** `gh run watch` для запуска `ci` на `main` — зелёный.
- [ ] **Step 4: Выпустить v0.1.0.** Версия `0.1.0` в `app/package.json`, `tauri.conf.json`, `Cargo.toml`; commit `chore: версия 0.1.0`; `git tag v0.1.0 && git push origin main v0.1.0`.
- [ ] **Step 5: Проверить релиз.** `gh run watch` — три задачи зелёные. `gh release view v0.1.0 --json assets -q '.assets[].name'` содержит: два `.dmg` (`aarch64`, `x64`), `-setup.exe`, `.app.tar.gz` и `.sig` для обеих архитектур, `latest.json`. `curl -sL https://github.com/SOJuse/attestat-trainer/releases/latest/download/latest.json` — JSON с `version: "0.1.0"` и платформами `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`; каждая ссылка из него отвечает 200 (`curl -sIL`).

Если какая-то ссылка из `latest.json` отвечает 404 из-за имени файла, исправить `productName` и повторить выпуск как `v0.1.1`: тег `v0.1.0` не переписывать.

---

### Task 6: Проверка обновления на этом Mac и README

**Files:**
- Create: `README.md`, `docs/install/` (снимки экрана)

- [ ] **Step 1: Поставить v0.1.0 как обычный пользователь.** Скачать `.dmg` для `aarch64` через браузер (так на файл попадает карантин), перенести программу в «Программы», запустить. Пройти путь разрешения в «Системных настройках → Конфиденциальность и безопасность», снять снимки каждого шага в `docs/install/`. Если macOS пишет «файл повреждён» вместо предложения разрешить — зафиксировать это и добавить в README команду `xattr -dr com.apple.quarantine /Applications/Attestat1103.app` как запасной путь.
- [ ] **Step 2: Ручная проверка окна.** Сжать окно до минимума — горизонтальной прокрутки нет, панель и заголовок читаются. Имя программы в Dock и в меню — «Аттестация 1103».
- [ ] **Step 3: Написать README.** Разделы: что это; скачать (ссылка на последний релиз, какой файл для какого компьютера); первый запуск на macOS со снимками; первый запуск на Windows (окно SmartScreen: «Подробнее → Выполнить в любом случае»); как обновляется; оговорка о неофициальности; лицензии (MIT, CC BY 4.0, логотип школы принадлежит школе и под лицензии не попадает); как собрать самому (`cd app && npm ci && npm run tauri dev`). Текст прогнать через `humanizer-ru`.
- [ ] **Step 4: Выпустить v0.1.1.** Поднять версию в трёх файлах, commit `docs: README и инструкция по установке`, тег, push, дождаться релиза.
- [ ] **Step 5: Проверить цепочку обновления.** Открыть установленную v0.1.0: появляется «Доступна версия 0.1.1», кнопка «Обновить» скачивает, программа перезапускается, в настройках «Версия программы: 0.1.1». Отключить Wi-Fi и запустить снова: программа открывается, баннера и ошибок нет.
- [ ] **Step 6: Итог.** В заметках к релизу v0.1.1 одной строкой указать, что сборка для Windows собрана в CI, но на настоящем Windows не запускалась.

---

## Готово, когда

- `https://github.com/SOJuse/attestat-trainer/releases/latest` отдаёт сборки для Apple Silicon, Intel Mac и Windows;
- программа на этом MacBook сама обновилась с 0.1.0 до 0.1.1;
- CI зелёный на `main`;
- README объясняет установку без подписи.
