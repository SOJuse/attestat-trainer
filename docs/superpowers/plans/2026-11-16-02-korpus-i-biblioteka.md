# Корпус документов и библиотека: план реализации (этап 2 из 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать тексты актов из списка литературы 2026 и действующей нормативки по аттестации в размеченный корпус, составить список тем по модулям и дать в программе раздел «Библиотека» с полнотекстовым поиском и чтением по статьям.

**Architecture:** Исходники корпуса живут в `content/` как текст (`meta.yaml` + `text.md` на документ). Скрипты `tools/` (Node + TypeScript) проверяют корпус и собирают из него пакет `library.sqlite.gz` с FTS5-индексом и `manifest.json`; пакет публикуется на GitHub Pages. Программа скачивает пакет в папку данных, проверяет SHA-256 и читает его через Rust-команды. Словоформы учитываются стеммингом Snowball в TypeScript: один и тот же модуль стеммит текст при сборке индекса и запрос при поиске, Rust только выполняет SQL.

**Tech Stack:** Node 24, TypeScript, zod, yaml, better-sqlite3, snowball-stemmers; Rust: rusqlite (bundled), reqwest, flate2, sha2; GitHub Pages; для разовой загрузки документов — Python 3.12 (pdfplumber, pypdf) и `curl` с этого компьютера.

**Spec:** `docs/superpowers/specs/2026-11-15-attestat-trainer-design.md` (разделы 5.1, 6.1, 6.3, 7.1 п. 5, 7.4, 9)

## Global Constraints

- Сабагенты запускаются только с `model: opus`.
- Тексты актов берутся с официальных источников: `pravo.gov.ru` (ИПС «Законодательство России»), `publication.pravo.gov.ru`, `mos.ru`, сайты Минпросвещения, Рособрнадзора, Роспотребнадзора, Верховного Суда. Массово выкачивать коммерческие справочные системы нельзя. Если действующей редакции в официальном источнике нет, документ получает `text: missing` и попадает в отчёт; решение по нему принимает заказчик.
- Выдумывать, дополнять по памяти или «восстанавливать» текст нормы запрещено. В `text.md` попадает только то, что скачано, с указанием URL и даты.
- Решения аттестационной комиссии со списками людей хранятся только в `content/sources/private/`, папка в `.gitignore`. В репозиторий, пакет и заметки фамилии не попадают.
- Позиции списка литературы, которые не являются официальными документами, входят в библиотеку только библиографической записью.
- Весь видимый пользователю русский текст интерфейса проходит через `humanizer-ru`. Тексты актов не правятся.
- Цвета только из `app/src/styles/tokens.css`. Текст на любом фоне держит контраст 4.5:1 (тест `contrast.test.ts` уже есть).
- Текст из пакета выводится только как текст: никакого `dangerouslySetInnerHTML`.
- Идентификатор приложения и ключ подписи обновлений не меняются.
- Работа идёт в ветке `feat/korpus-i-biblioteka`, в `main` попадает через PR.
- Версия программы после этапа: `0.2.0`.

## Review Focus

1. Первый запуск без сети: библиотеки ещё нет. Раздел объясняет, что нужно подключение, остальные разделы работают. → тест в Task 10.
2. Загрузка пакета оборвалась или SHA-256 не сошёлся: прежняя библиотека остаётся на месте, пользователь видит причину и кнопку «Повторить». → тесты в Task 8 (Rust) и Task 10.
3. В запросе есть кавычки, звёздочки, скобки, слова `AND`/`OR`/`NOT`, одни знаки препинания или пустая строка: поиск не падает, а отдаёт пустой список или обычные результаты. → тест в Task 6.
4. «ё» и «е», разный регистр, словоформы («отпуска», «отпуском», «отпуску»): находятся одни и те же места. → тест в Task 6.
5. Очень большой документ (Гражданский кодекс): открытие не подвешивает окно, текст отрисовывается по разделам. → тест в Task 10.
6. `schemaVersion` в манифесте новее, чем понимает программа: пакет не скачивается, показано «Обновите программу». → тест в Task 9.
7. Документ с `text: missing`: в списке он виден, вместо текста пояснение и ссылка на источник. → тест в Task 10.

---

## Структура файлов

```
content/
  sources/                    снимок исходного материала
    SOURCES.md                что откуда и когда взято, SHA-256
    list/                     список литературы 2026 (PDF)
    site/                     страница аттестации (HTML) и действующие акты с неё
    private/                  решения комиссии (в .gitignore)
  docs/
    registry.yaml             258 позиций списка литературы + акты по аттестации
    <doc-id>/meta.yaml
    <doc-id>/text.md
  topics.yaml                 темы по модулям
tools/
  package.json  tsconfig.json  vitest.config.ts
  src/schema.ts               zod-схемы: registry, meta, topics, manifest
  src/corpus.ts               чтение content/, разбор text.md на разделы
  src/validate.ts             npm run validate
  src/build-library.ts        npm run build:library
  src/*.test.ts
  fetch/                      разовые скрипты загрузки (Python), в CI не запускаются
  prompts/fetch-doc.md        поручение сабагенту-сборщику
  prompts/verify-doc.md       поручение сабагенту-проверяющему
app/src/core/stem.ts          стемминг и нормализация, общий для tools и программы
app/src/core/searchQuery.ts   запрос пользователя → выражение FTS5
app/src/library/              компоненты раздела «Библиотека»
app/src/platform/Library.ts   интерфейс LibraryStore и его реализации
app/src-tauri/src/library.rs  команды и загрузка пакета
.github/workflows/content.yml
docs/research/attestation-site-notes.md   выводы из страницы аттестации, без фамилий
```

## Форматы, общие для задач

**Идентификатор документа** — латиница, нижний регистр, дефисы: вид и номер. Примеры: `tk-rf`, `gk-rf`, `fz-273`, `fz-152`, `pp-rf-1441`, `prikaz-minpros-582`, `sanpin-2-4-3648-20`, `donm-pr-13`, `donm-r-144`. Правило и полный список закрепляются в `registry.yaml`.

**`meta.yaml`**

```yaml
id: tk-rf
title: Трудовой кодекс Российской Федерации
short: ТК РФ
kind: federal-law        # federal-law | decree | government | ministry | sanpin | court | moscow | donm | letter | other
number: 197-ФЗ
date: 2001-12-30
edition: 2025-12-29      # дата последней редакции в скачанном тексте
source_url: https://...
fetched: 2026-11-17
modules: [K, R, P]
list_no: 8               # номер в списке литературы; у актов по аттестации отсутствует
text: full               # full | missing | bibliographic
note: ""                 # например, «сводная редакция составлена по Пр-13 и Пр-1182, Пр-533, Пр-560»
```

**`text.md`** — каждый раздел начинается строкой заголовка второго уровня с якорем, дальше текст раздела до следующего заголовка:

```
## {#st-256} Статья 256. Отпуска по уходу за ребенком

По заявлению женщины ей предоставляется отпуск…
```

Якоря: `st-N` (статья), `p-N` и `p-N-M` (пункт, подпункт), `gl-N` (глава без статей), `pril-N` и `pril-N-p-M` (приложения), `preambula`. Точки в номерах заменяются дефисами (`st-60-2` для статьи 60.2). Якоря уникальны внутри документа.

**Коды модулей:** `K`, `R`, `P`, `Rez`, `I`.

---

### Task 1: Снимок исходников

**Files:**
- Create: `content/sources/SOURCES.md`, `content/sources/list/*.pdf`, `content/sources/site/*`, `tools/fetch/site.py`, `docs/research/attestation-site-notes.md`
- Modify: `.gitignore` (добавить `content/sources/private/`)

- [ ] **Step 1:** Скопировать из архива заказчика (`~/Downloads/Telegram Desktop/Архив.zip`, папка `документы/`) пять PDF: список литературы в `content/sources/list/`, остальные четыре в `content/sources/site/`. Старый тренажёр не копировать.
- [ ] **Step 2:** `tools/fetch/site.py <папка>`: скачивает страницу `https://corp-univer.ru/аттестация-руководящих-кадров/`, сохраняет HTML, выбирает ссылки на файлы с `2025-2026`, `2026-2027`, `25-26`, `26-27` в пути (на 15.11.2026 их 67: 9 в `normativ`, 58 в `Reshenie-AK`) плюс три ссылки вне `/ATT/`. Файлы из `normativ` и вне `/ATT/` идут в `content/sources/site/`, из `Reshenie-AK` — в `content/sources/private/`. Между запросами пауза 1 секунда, заголовок `User-Agent` обычного браузера без личных данных. Скрипт пишет таблицу в `SOURCES.md`: файл, URL, дата загрузки, размер, SHA-256.
- [ ] **Step 3:** Запустить, проверить: `ls content/sources/site | wc -l` не меньше 13; `git status --short content/sources/private` пусто (папка игнорируется).
- [ ] **Step 4:** Прочитать акты из `site/` и решения из `private/`. В `docs/research/attestation-site-notes.md` записать без фамилий: какие акты действуют и что они меняют в Пр-13; формат и сроки процедуры; какие типы решений принимает комиссия и с какими формулировками; что из этого годится как материал для заданий модуля и темы «аттестация руководителя». Отдельной строкой: удалось ли открыть демо-версию `att.corp-univer.ru/testdemo` и что она говорит о числе заданий и времени (40 и 60 минут пока взяты из старого тренажёра).
- [ ] **Step 5: Commit** `content: снимок исходных документов`.

---

### Task 2: Пакет tools, схемы и реестр списка литературы

**Files:**
- Create: `tools/package.json`, `tools/tsconfig.json`, `tools/vitest.config.ts`, `tools/src/schema.ts`, `tools/src/corpus.ts`, `tools/src/validate.ts`, `tools/src/schema.test.ts`, `tools/src/registry.test.ts`, `tools/fetch/parse_lit.py`, `content/docs/registry.yaml`
- Modify: `.github/workflows/ci.yml` (задача `content`: `npm ci`, `npm test`, `npm run validate` в `tools/`)

**Interfaces:**
- Produces (`tools/src/schema.ts`): zod-схемы и типы `ModuleCode = 'K'|'R'|'P'|'Rez'|'I'`, `RegistryEntry`, `DocMeta`, `Topic`, `Manifest`.

```ts
type RegistryEntry = {
  id: string;            // идентификатор документа
  list_no?: number;      // 1..258; нет у актов по аттестации
  section: string;       // раздел списка: «Федеральные законы» и т. д.
  title: string;
  kind: DocMeta['kind'];
  number?: string;
  date?: string;         // ISO
  edition_in_list?: string; // «ред. от …», как напечатано в списке
  modules: ModuleCode[]; // не пусто
};
```

- Produces (`tools/src/corpus.ts`): `loadRegistry(root): RegistryEntry[]`, `loadDoc(root, id): { meta: DocMeta; sections: Section[] } | null`, `parseText(md: string): Section[]`, где `Section = { anchor: string; heading: string; text: string; ord: number }`. `parseText` бросает ошибку с номером строки на повторный якорь, пустой раздел, якорь не по формату.
- Produces: `npm run validate` в `tools/` печатает отчёт и выходит с кодом 1 при ошибках.

- [ ] **Step 1: Падающие тесты.**

```ts
// schema.test.ts
it('parseText режет документ по заголовкам с якорями', () => {
  const s = parseText('## {#st-1} Статья 1. Цели\n\nТекст один.\n\n## {#st-60-2} Статья 60.2\n\nТекст два.\n');
  expect(s.map(x => [x.anchor, x.heading, x.ord])).toEqual([
    ['st-1', 'Статья 1. Цели', 0], ['st-60-2', 'Статья 60.2', 1]]);
  expect(s[0].text).toBe('Текст один.');
});
it.each([
  ['## {#st-1} А\n\nт\n\n## {#st-1} Б\n\nт\n', /повтор.*st-1/i],
  ['## {#st-1} А\n\n## {#st-2} Б\n\nт\n', /пуст/i],
  ['## {#Статья1} А\n\nт\n', /якор/i],
  ['Текст до первого заголовка\n\n## {#st-1} А\n\nт\n', /до первого/i],
])('parseText отвергает некорректный текст', (md, re) => {
  expect(() => parseText(md)).toThrow(re);
});

// registry.test.ts — читает настоящий content/docs/registry.yaml
it('в реестре все 258 позиций списка, без пропусков и повторов', () => {
  const nos = reg.filter(e => e.list_no).map(e => e.list_no).sort((a, b) => a - b);
  expect(nos).toEqual(Array.from({ length: 258 }, (_, i) => i + 1));
});
it('идентификаторы уникальны и по формату', () => {
  expect(new Set(reg.map(e => e.id)).size).toBe(reg.length);
  reg.forEach(e => expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/));
});
it('модули известных актов совпадают со списком', () => {
  const by = (n: number) => reg.find(e => e.list_no === n)!;
  expect(by(1).modules).toEqual(['P']);            // Конституция
  expect(by(6).modules).toEqual(['K', 'R', 'P', 'I']); // ГК РФ
  expect(by(7).modules).toEqual(['K']);            // 181-ФЗ
});
```

- [ ] **Step 2:** `cd tools && npm test` — FAIL.
- [ ] **Step 3: Реализовать схемы и `corpus.ts`.**
- [ ] **Step 4: Составить реестр.** `tools/fetch/parse_lit.py` читает PDF через `pdfplumber`: строки таблицы группируются по номеру в первой колонке, модули определяются по горизонтальной координате знаков «+» относительно координат пяти заголовков колонок, раздел — по строкам-заголовкам без номера. Скрипт пишет черновик `registry.yaml`. После него вручную сверить с PDF: число позиций, все многострочные названия, все позиции, где скрипт нашёл 0 или 5 модулей. Число 258 взято из старого тренажёра: если в PDF последняя позиция имеет другой номер, исправить число в тесте и записать это в журнал.
- [ ] **Step 5: Добавить акты по аттестации** в реестр без `list_no`, раздел «Аттестация руководителей»: Пр-13 (20.01.2025), Пр-1182 (11.12.2025), Пр-560 (17.07.2026), Р-3 (21.01.2026), Р-144 (27.10.2025), инструкция о тестировании и то, что найдено в Task 1. Модули у них — все пять.
- [ ] **Step 6:** `npm test` — PASS; `npm run validate` — без ошибок (документов ещё нет, это предупреждение, а не ошибка).
- [ ] **Step 7: Commit** `content: реестр списка литературы и проверка корпуса`.

---

### Task 3: Проба источников и поручения сабагентам

**Files:**
- Create: `tools/prompts/fetch-doc.md`, `tools/prompts/verify-doc.md`, `tools/fetch/to_text.py`, `content/docs/{tk-rf,fz-273,…}/` (пять документов пробы)
- Modify: `tools/src/validate.ts` (проверки документа)

**Interfaces:**
- Produces: `python3 tools/fetch/to_text.py <html-или-pdf> --kind <kind>` печатает `text.md` в stdout. Разбирает HTML ИПС и текстовые PDF; распознавания сканов нет: скан даёт ошибку «нет текстового слоя».
- Produces: `npm run validate` дополнительно проверяет каждый документ: `meta.yaml` по схеме; `id` есть в реестре; `text: full` ⇒ есть `text.md`, он разбирается `parseText`, в нём не меньше 3 разделов и не меньше 2000 знаков; `edition` не раньше `date`; `source_url` начинается с `https://` или `http://` и его домен входит в список разрешённых из Global Constraints.

- [ ] **Step 1: Падающие тесты** на новые проверки `validate` (по одному минимальному корпусу-фикстуре в `tools/src/fixtures/` на каждое правило: чужой домен источника, `edition` раньше `date`, `text: full` без файла, меньше 3 разделов).
- [ ] **Step 2: Проба на пяти документах разного вида:** ТК РФ, 273-ФЗ, один приказ Минпросвещения из списка, одно постановление главного санитарного врача, одно постановление Правительства Москвы. Для каждого найти с этого компьютера (`curl`) официальный адрес с действующей редакцией, скачать, прогнать через `to_text.py`, сверить три произвольных статьи или пункта с источником глазами. Записать в журнал, какой источник сработал для какого вида и какие виды не достаются.
- [ ] **Step 3: Написать `fetch-doc.md`.** Поручение сабагенту на пачку документов: вход — записи реестра; для каждой найти официальный источник по таблице «вид → источник» из пробы, скачать `curl`, получить `text.md` через `to_text.py`, заполнить `meta.yaml`, запустить `npm run validate`. Запреты из Global Constraints дословно. Итог сабагента — таблица: id, статус (`full`/`missing`/`bibliographic`), редакция, источник, что не получилось.
- [ ] **Step 4: Написать `verify-doc.md`.** Поручение проверяющему: для выборки документов заново открыть `source_url`, сравнить редакцию и три случайных раздела с `text.md` дословно, проверить, что редакция не старее указанной в списке литературы (`edition_in_list`). Итог — список расхождений.
- [ ] **Step 5:** `npm test`, `npm run validate` — PASS на пяти документах.
- [ ] **Step 6: Commit** `content: проба источников, пять документов, поручения`.

Если проба покажет, что официальные источники отдают действующие редакции меньше чем для половины видов, остановиться и принести заказчику выбор: что делать с недоступными видами.

---

### Task 4: Сбор корпуса

**Files:**
- Create: `content/docs/<id>/{meta.yaml,text.md}` для всех позиций реестра
- Create: `docs/research/corpus-report.md`

- [ ] **Step 1: Раздать пачки.** Реестр делится на пачки по 10–15 документов одного раздела. Каждую пачку берёт отдельный сабагент (`model: opus`) с поручением `fetch-doc.md`. Одновременно не больше четырёх сабагентов; пачки не пересекаются по папкам. Кодексы (ТК, ГК, БК, НК, КоАП, УК в части, указанной в списке) идут по одному на сабагента.
- [ ] **Step 2: После каждой пачки** запускать `npm run validate` и коммитить `content: корпус, <раздел>, пачка N`.
- [ ] **Step 3: Проверка.** Отдельные сабагенты с `verify-doc.md` проверяют: все кодексы и 273-ФЗ целиком по 10 разделам, остальные — каждый пятый документ по 3 разделам. Расхождения исправляются повторной загрузкой, не ручной правкой текста.
- [ ] **Step 4: Акты по аттестации.** Пр-13 собрать в сводной редакции: взять исходный текст и применить изменения из Пр-1182 и Пр-560 по их тексту (Пр-533 Положение не менял: он касался составов комиссии и отменён, см. `docs/research/attestation-site-notes.md`); в `note` указать, что сводная редакция составлена нами, а исходные приказы лежат в `content/sources/site/`. Отдельный проверяющий сабагент сверяет каждое внесённое изменение с текстом приказа об изменении.
- [ ] **Step 5: Отчёт** `docs/research/corpus-report.md`: сколько документов `full`, `missing`, `bibliographic`; список `missing` с причиной; объём текста в мегабайтах по модулям; документы, чья редакция в источнике новее указанной в списке литературы.
- [ ] **Step 6:** `npm run validate` — без ошибок. **Commit** `content: отчёт о корпусе`.

---

### Task 5: Темы по модулям

**Files:**
- Create: `content/topics.yaml`
- Modify: `tools/src/schema.ts`, `tools/src/validate.ts`
- Test: `tools/src/topics.test.ts`

**Interfaces:**
- Produces:

```ts
type Topic = {
  id: string;        // латиница, уникален в пределах модуля: otpusk, zakupki
  module: ModuleCode;
  title: string;     // «Отпуска»
  docs: { doc: string; anchors?: string[] }[];  // на чём стоит тема; не пусто
};
// topics.yaml: { modules: { K: { title: 'Кадры', ready: false, topics: Topic[] }, … } }
```

- [ ] **Step 1: Падающие тесты:** в каждом модуле от 8 до 12 тем; `id` уникальны в модуле; каждый `doc` есть в корпусе с `text: full`; каждый якорь из `anchors` существует в документе; каждый документ корпуса с `text: full` назначен хотя бы одной теме своего модуля или перечислен в `unassigned` с причиной.
- [ ] **Step 2: Составить темы.** По каждому модулю сабагент (`model: opus`) читает оглавления документов модуля и предлагает 8–12 тем с опорными статьями. Темы режутся по управленческим ситуациям (приём на работу, отпуска, закупки, платные услуги, персональные данные), а не по названиям актов. Итог сводится в `topics.yaml`, `ready: false` у всех модулей.
- [ ] **Step 3:** `npm test`, `npm run validate` — PASS. **Commit** `content: темы по модулям`.
- [ ] **Step 4:** Показать заказчику список тем одной таблицей и спросить, чего не хватает. Правки внести до плана 4.

---

### Task 6: Стемминг и запрос поиска

**Files:**
- Create: `app/src/core/stem.ts`, `app/src/core/searchQuery.ts`
- Test: `app/src/core/stem.test.ts`, `app/src/core/searchQuery.test.ts`

**Interfaces:**
- Produces: `normalize(text: string): string` — нижний регистр, `ё`→`е`, всё кроме букв и цифр → пробел, пробелы схлопнуты.
- Produces: `stemText(text: string): string` — `normalize`, затем каждое слово длиннее 3 букв заменяется основой Snowball (русский), слова из латиницы и цифр остаются как есть.
- Produces: `toFtsQuery(input: string): string | null` — `stemText`, слова короче 2 знаков отброшены, каждое слово в двойных кавычках со звёздочкой, через пробел (неявное И): `"отпуск"* "уход"*`. `null`, если слов не осталось.

- [ ] **Step 1: Падающие тесты.**

```ts
it.each([['отпуска', 'отпуском'], ['увольнения', 'увольнению'], ['работницы', 'работницей']])(
  'словоформы %s и %s дают одну основу', (a, b) => expect(stemText(a)).toBe(stemText(b)));
it('ё и регистр не влияют', () => expect(stemText('Ребёнок')).toBe(stemText('ребенок')));
it('номера и латиница сохраняются', () => expect(stemText('273-ФЗ, ст. 47')).toBe('273 фз ст 47'));
it('toFtsQuery строит запрос из основ со звёздочками', () =>
  expect(toFtsQuery('Отпуск по уходу')).toBe('"отпуск"* "по"* "уход"*'));
it.each(['', '   ', '"""', '*', '( ) -', '!!!'])('пустой и знаковый запрос %j → null', q =>
  expect(toFtsQuery(q)).toBeNull());
it('операторы FTS обезврежены', () => {
  expect(toFtsQuery('отпуск AND NOT "уход" OR (пособие*)')).toBe('"отпуск"* "and"* "not"* "уход"* "or"* "пособ"*');
});
```

- [ ] **Step 2:** `npm test` в `app/` — FAIL.
- [ ] **Step 3: Реализовать.** Библиотека `snowball-stemmers` (чистый JS). Точное значение основ в последнем тесте взять из первого прогона и закрепить.
- [ ] **Step 4:** `npm test` — PASS. **Commit** `feat: стемминг и разбор поискового запроса`.

Поиск находит формы одного слова. Однокоренные слова разных частей речи («увольнение» и «уволить») Snowball не сводит, это ограничение записывается в журнал как отступление от примера в спецификации (раздел 6.3).

---

### Task 7: Сборка пакета библиотеки и публикация

**Files:**
- Create: `tools/src/build-library.ts`, `tools/src/build-library.test.ts`, `.github/workflows/content.yml`
- Modify: `tools/package.json` (скрипт `build:library`)

**Interfaces:**
- Consumes: `loadRegistry`, `loadDoc` (Task 2), `stemText` (Task 6, импорт по относительному пути `../../app/src/core/stem`).
- Produces: `npm run build:library -- --out <dir>` пишет `<dir>/library.sqlite.gz` и `<dir>/manifest.json`.
- Produces — схема SQLite (`PRAGMA user_version = 1`):

```sql
CREATE TABLE docs (id TEXT PRIMARY KEY, title TEXT NOT NULL, short TEXT, kind TEXT NOT NULL,
  number TEXT, date TEXT, edition TEXT, source_url TEXT, fetched TEXT,
  modules TEXT NOT NULL,          -- 'K,R,P'
  text_status TEXT NOT NULL,      -- full | missing | bibliographic
  note TEXT, list_no INTEGER);
CREATE TABLE sections (rowid INTEGER PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES docs(id),
  anchor TEXT NOT NULL, heading TEXT NOT NULL, ord INTEGER NOT NULL, text TEXT NOT NULL,
  UNIQUE (doc_id, anchor));
CREATE VIRTUAL TABLE sections_fts USING fts5(heading, text, content='', tokenize='unicode61');
-- в sections_fts лежит stemText(heading) и stemText(text), rowid совпадает с sections.rowid
```

- Produces — `manifest.json`:

```json
{ "schemaVersion": 1, "packVersion": "2026.11.20.1",
  "library": { "file": "library.sqlite.gz", "sha256": "…", "bytes": 0, "docs": 0 } }
```

- [ ] **Step 1: Падающие тесты** на фикстуре из трёх документов: в базе три записи `docs` и верное число `sections`; запрос `SELECT rowid FROM sections_fts WHERE sections_fts MATCH '"отпуск"*'` находит раздел со словом «отпуском»; `manifest.json` проходит схему `Manifest`, `sha256` совпадает с настоящим хешем файла; документ `missing` попал в `docs` без разделов; повторная сборка того же корпуса даёт тот же SHA-256.
- [ ] **Step 2:** FAIL → реализовать → PASS. Для повторяемости: документы и разделы вставляются в отсортированном порядке, `VACUUM` в конце, gzip с `mtime = 0`. `packVersion` — дата UTC и порядковый номер из аргумента `--build`.
- [ ] **Step 3: Измерить.** Собрать пакет на настоящем корпусе, записать в журнал размер `library.sqlite` и `.gz`. Если `.gz` больше 90 МБ (предел файла на GitHub Pages — 100 МБ), разбить библиотеку на файлы по модулям и поменять `library` в манифесте на массив; это решение записать в журнал.
- [ ] **Step 4: `content.yml`.** Триггер: push в `main` с изменениями в `content/**`, `tools/**`, `app/src/core/stem.ts`; плюс `workflow_dispatch`. Шаги: checkout, node 24, `npm ci` в `tools/` и `app/`, `npm test`, `npm run validate`, `npm run build:library -- --out ../site --build ${{ github.run_number }}`, затем `actions/upload-pages-artifact` и `actions/deploy-pages`. Права: `pages: write`, `id-token: write`. Включить Pages: `gh api -X POST repos/SOJuse/attestat-trainer/pages -f build_type=workflow`.
- [ ] **Step 5: Проверить** после слияния в `main` (Task 11): `curl -s https://sojuse.github.io/attestat-trainer/manifest.json` отдаёт JSON, файл из него скачивается и его SHA-256 сходится.
- [ ] **Step 6: Commit** `feat: сборка и публикация пакета библиотеки`.

---

### Task 8: Rust — хранение, загрузка и запросы к библиотеке

**Files:**
- Create: `app/src-tauri/src/library.rs`, `app/src-tauri/tests/fixtures/library.sqlite`
- Modify: `app/src-tauri/src/lib.rs`, `app/src-tauri/Cargo.toml`, `.github/workflows/ci.yml` (задача `rust`: зависимости webkit2gtk, `cargo test`)

**Interfaces:**
- Produces — команды Tauri (имена и типы в JSON; поля в camelCase):

```
library_status() -> { installed: bool, packVersion: string | null, docs: number }
library_install(url: string, sha256: string, packVersion: string) -> ()   // события 'library-progress' { fraction: number }
library_list() -> DocInfo[]      // { id, title, short, kind, number, date, edition, sourceUrl, fetched, modules: string[], textStatus, note, listNo }
library_doc(id: string) -> { info: DocInfo, sections: { anchor, heading, ord }[] }
library_section(docId: string, anchor: string) -> { anchor, heading, ord, text }
library_sections(docId: string, fromOrd: number, count: number) -> { anchor, heading, ord, text }[]
library_search(ftsQuery: string, limit: number) -> { docId, docTitle, anchor, heading, snippet }[]
```

- `library_install`: качает во временный файл в папке данных, считает SHA-256 по сжатому файлу, распаковывает, открывает и проверяет `PRAGMA user_version == 1` и `SELECT count(*) FROM docs > 0`, затем атомарно переименовывает в `library.sqlite` и пишет `library.json` (`packVersion`). При любой ошибке временные файлы удаляются, прежняя библиотека не тронута. Адрес разрешён только с `https://sojuse.github.io/attestat-trainer/`.
- `library_search`: принимает уже готовое выражение FTS5 от `toFtsQuery`; `snippet` — первые 240 знаков текста раздела от ближайшего к началу совпавшего слова (совпадение ищется по основам в самом тексте), без разметки. Сортировка по `bm25`. `limit` не больше 100.
- Ошибки возвращаются строковым кодом: `not-installed`, `network`, `checksum`, `bad-pack`, `forbidden-url`, `query`.

- [ ] **Step 1: Падающие тесты (`cargo test`)** на функциях без Tauri: установка из локального gz-файла с верным хешем создаёт базу; с неверным хешем возвращает `checksum`, и прежний файл остаётся байт в байт; пакет с `user_version = 2` даёт `bad-pack`; `search` по фикстуре находит раздел и возвращает сниппет без тегов; синтаксически неверное выражение даёт `query`, а не панику; `sections(doc, 0, 2)` возвращает два первых раздела по порядку.
- [ ] **Step 2:** FAIL → реализовать (логика в обычных функциях с путём к папке данных, команды — тонкие обёртки) → PASS.
- [ ] **Step 3:** Зарегистрировать команды, добавить их в `capabilities/default.json`. **Commit** `feat: библиотека на стороне Rust`.

---

### Task 9: Слой платформы для библиотеки

**Files:**
- Create: `app/src/platform/Library.ts`, `app/src/platform/libraryTauri.ts`, `app/src/platform/libraryBrowser.ts`, `app/src/platform/library-sample.json`, `app/src/platform/libraryUpdate.ts`
- Modify: `app/src/platform/{Platform,fake,browser,tauri}.ts`
- Test: `app/src/platform/libraryUpdate.test.ts`, `app/src/platform/libraryBrowser.test.ts`

**Interfaces:**
- Produces:

```ts
export type LibraryError = 'not-installed' | 'network' | 'checksum' | 'bad-pack' | 'app-too-old' | 'query';
export interface LibraryStore {
  status(): Promise<{ installed: boolean; packVersion: string | null; docs: number }>;
  /** Сверяется с манифестом; ставит пакет, если он новее. Возвращает, что произошло. */
  update(onProgress?: (fraction: number) => void): Promise<'installed' | 'up-to-date'>;
  list(): Promise<DocInfo[]>;
  doc(id: string): Promise<{ info: DocInfo; sections: SectionHead[] }>;
  sections(docId: string, fromOrd: number, count: number): Promise<SectionBody[]>;
  search(query: string, limit?: number): Promise<SearchHit[]>;   // принимает текст пользователя
}
// Platform получает поле: library: LibraryStore
```

- `update()` бросает `Error` с `cause: LibraryError`. Общая логика в `libraryUpdate.ts`: `decideUpdate(manifest, installedVersion, supportedSchema = 1): 'install' | 'skip' | 'app-too-old'`.
- `search()` вызывает `toFtsQuery`; при `null` возвращает `[]`, не обращаясь к хранилищу.
- Браузерная реализация читает `library-sample.json` (три коротких документа из корпуса) и ищет подстрокой по `stemText`; `update()` сразу возвращает `'up-to-date'`.
- `createFakePlatform` получает `library` с пустой установленной библиотекой и возможностью переопределить методы.

- [ ] **Step 1: Падающие тесты:** `decideUpdate` — новее ⇒ `install`, та же версия ⇒ `skip`, `schemaVersion: 2` ⇒ `app-too-old`, не установлено ⇒ `install`; браузерная реализация находит «отпуском» по запросу «отпуск» и возвращает `[]` на `'"""'`.
- [ ] **Step 2:** FAIL → реализовать → PASS. **Commit** `feat: слой платформы для библиотеки`.

---

### Task 10: Раздел «Библиотека»

**Files:**
- Create: `app/src/library/{LibraryView,DocList,SearchBox,SearchResults,Reader,InstallState}.tsx`, тесты рядом
- Modify: `app/src/App.tsx`, `app/src/styles/app.css`

Перед вёрсткой загрузить навыки `frontend-design` и `impeccable` и следовать им в рамках токенов шаблона. Шрифты пока системные.

**Поведение:**
- Вход в раздел: если библиотека не установлена — экран с объяснением («Библиотека скачивается один раз, дальше работает без интернета»), размером из манифеста, кнопкой «Скачать» и ходом загрузки. Ошибки: нет сети, не сошёлся хеш, программа устарела — каждая своим текстом, у первых двух кнопка «Повторить».
- Установлена: слева список документов с фильтром по пяти модулям и строкой поиска сверху; справа читалка.
- Строка поиска: запрос уходит через 250 мс после остановки ввода. Результаты — список «документ · раздел · отрывок»; клик открывает документ на этом разделе. Пустой результат: «Ничего не нашлось. Попробуйте другое слово или его начало».
- Читалка: заголовок, строка «Редакция от … · загружено …», кнопка «Открыть источник», оглавление по разделам, текст. Разделы подгружаются порциями по 30 через `sections()` при прокрутке. Переход по оглавлению прокручивает к разделу и подгружает нужную порцию.
- Документ `missing`: «Текст в действующей редакции достать не удалось» и кнопка источника. `bibliographic`: только запись.
- Если библиотека уже установлена, программа при запуске молча вызывает `update()`: новый пакет ставится без вопросов, ошибки не показываются. Проверка «раз в сутки» из спецификации (7.4) появится в плане 3 вместе с обновлением заданий.
- Внешний компонент принимает `openAt?: { docId: string; anchor: string }` — этим пропсом в плане 3 пользуются разбор задания и панель экзамена.

- [ ] **Step 1: Падающие тесты** (с `createFakePlatform`): экран установки при `installed: false`, клик «Скачать» вызывает `update` и показывает проценты; `update` бросил `network` ⇒ текст про подключение и «Повторить»; `app-too-old` ⇒ «Обновите программу» без кнопки повтора; фильтр по модулю оставляет только его документы; ввод запроса вызывает `search` один раз после паузы, клик по результату открывает читалку на разделе; документ на 500 разделов: при открытии запрошено 30 разделов, а не все; `missing` показывает пояснение; `openAt` открывает нужный раздел.
- [ ] **Step 2:** FAIL → реализовать → PASS; `npm run lint`, `npm run typecheck`.
- [ ] **Step 3: Тексты интерфейса** прогнать через `humanizer-ru`.
- [ ] **Step 4: Визуальная проверка** в браузере (`npm run dev`) на 1280 × 820 и 1024 × 700: нет горизонтальной прокрутки, длинные названия актов переносятся, фокус с клавиатуры виден.
- [ ] **Step 5: Commit** `feat: раздел «Библиотека»`.

---

### Task 11: Безопасность, выпуск 0.2.0

**Files:**
- Modify: `app/src-tauri/tauri.conf.json`, `app/src-tauri/capabilities/default.json`, `app/src/config.test.ts`, `app/.gitignore`, `README.md`, версии в трёх файлах

- [ ] **Step 1: Падающий тест конфигурации:** `app.security.csp` задан и содержит `default-src 'self'`; в `capabilities` нет `core:default` и `updater:default`, есть `core:app:allow-version`, `core:event:default`, `updater:allow-check`, `updater:allow-download-and-install`, `process:allow-restart`, ограниченный `opener` и команды библиотеки.
- [ ] **Step 2: Реализовать.** CSP: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost`. Разрешение `opener` расширить доменами источников из Global Constraints: кнопка «Открыть источник» ведёт на них.
- [ ] **Step 3:** Собрать локально (`CI=true npm run tauri build -- --target aarch64-apple-darwin`), запустить программу из `bundle/macos`, убедиться по журналу Tauri, что обновление проверяется и ход загрузки приходит. Если остатки шаблона в `app/` уже удалены заказчиком, убрать их строки из `app/.gitignore`.
- [ ] **Step 4:** README: абзац о библиотеке (скачивается при первом открытии раздела, размер). Версия `0.2.0`. PR в `main`, после слияния — тег `v0.2.0`, дождаться релиза и запуска `content.yml`, выполнить проверку из Task 7 Step 5.
- [ ] **Step 5:** Заказчик проверяет на Mac: программа обновилась до 0.2.0, библиотека скачалась, поиск «отпуск по уходу» находит статью 256 ТК РФ.

---

## Готово, когда

- в `content/docs/` лежат все позиции реестра, по каждой известен статус, отчёт называет недоступные поимённо;
- `content/topics.yaml` содержит 8–12 тем на модуль и просмотрен заказчиком;
- `https://sojuse.github.io/attestat-trainer/manifest.json` отдаёт манифест, пакет скачивается;
- в программе 0.2.0 раздел «Библиотека» скачивает пакет, ищет с учётом словоформ и открывает документ на нужной статье;
- CI зелёный: `app`, `content`, `rust`.
