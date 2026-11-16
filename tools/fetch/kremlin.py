#!/usr/bin/env python3
"""Тексты с сайта Президента России (kremlin.ru): Конституция, Послание 2024 года, поручение Пр-750.

Команды (запуск из корня репозитория):
  kremlin.py constitution   Конституция РФ        -> content/docs/konstitutsiya-rf
  kremlin.py poslanie       Послание 29.02.2024   -> content/docs/lit-2
  kremlin.py pr750          Пр-750 от 08.04.2014  -> content/docs/lit-5
  kremlin.py all            всё сразу
  --out DIR                 писать не в content/docs, а в DIR (для проверки)

Сайт открывается по http. Между запросами пауза, при обрыве — повтор.
В text.md попадает только текст страницы; служебные сноски сайта к Конституции
(«Редакция статьи приведена в соответствии с …») не переносятся.
"""
import argparse
import html
import pathlib
import re
import subprocess
import sys
import time
from html.parser import HTMLParser

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from docout import ROOT, squeeze, text_size, write_doc  # noqa: E402

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
FETCHED = "2026-11-16"

CONSTITUTION_URL = "http://www.kremlin.ru/acts/constitution/item"
POSLANIE_URL = "http://www.kremlin.ru/events/president/news/73585"
PR750_URL = "http://www.kremlin.ru/acts/assignments/orders/20757"
PR750_TEXT_URL = "http://www.kremlin.ru/acts/assignments/orders/copy/20757"


def get(url, attempts=4):
    last = ""
    for attempt in range(attempts):
        time.sleep(1.5 if attempt == 0 else 10 * attempt)
        out = subprocess.run(
            ["curl", "-sS", "--fail", "-L", "-m", "120", "-A", UA, url], capture_output=True
        )
        if out.returncode == 0 and out.stdout:
            return out.stdout.decode("utf-8")
        last = out.stderr.decode("utf-8", "replace").strip()[:200]
    raise RuntimeError(f"{url}: не скачалось: {last}")


# ---------- Конституция ----------


class _ConstitutionBlocks(HTMLParser):
    """Блоки текста по порядку: (вид, текст). Виды: footnote, title, part, chapter, h3, p.

    Сноски сайта (div.reference_block) пропускаются. Надстрочные цифры
    («Статья 67<sup>1</sup>», «е<sup>1</sup>)») читаются как 67.1 и е.1,
    звёздочки — пометки поправок 2020 года — отбрасываются.
    """

    TAGS = {"h1": "title", "h3": "h3", "p": "p"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.kind = None
        self.buf = []
        self.skip = 0  # глубина div внутри пропускаемой сноски
        self.sup = None

    def handle_starttag(self, tag, attrs):
        cls = dict(attrs).get("class") or ""
        if self.skip:
            if tag == "div":
                self.skip += 1
            return
        if tag == "div" and "reference_block" in cls.split():
            self.skip = 1
            return
        if tag == "sup":
            self.sup = []
            return
        if tag == "br":  # перенос строки внутри абзаца: «автономный<br>округ»
            if self.kind:
                self.buf.append(" ")
            return
        kind = None
        if tag == "span" and "footnote" in cls.split():
            kind = "footnote"
        elif tag == "h2":
            kind = "part" if "part" in cls.split() else "chapter"
        elif tag in self.TAGS:
            kind = self.TAGS[tag]
        if kind:
            self._flush()
            self.kind, self.buf = kind, []

    def handle_endtag(self, tag):
        if self.skip:
            if tag == "div":
                self.skip -= 1
            return
        if tag == "sup" and self.sup is not None:
            digits = re.sub(r"\D", "", "".join(self.sup))
            if digits and self.kind:
                self.buf.append("." + digits)
            self.sup = None
            return
        if self.kind == "footnote" and tag == "span":
            self._flush()
        elif tag in ("h1", "h2", "h3", "p"):
            self._flush()

    def handle_data(self, data):
        if self.skip:
            return
        if self.sup is not None:
            self.sup.append(data)
        elif self.kind:
            self.buf.append(data)

    def _flush(self):
        if self.kind:
            text = squeeze("".join(self.buf))
            if text:
                self.blocks.append((self.kind, text))
        self.kind, self.buf = None, []


ARTICLE = re.compile(r"^Статья (\d+(?:\.\d+)?)$")
POINT = re.compile(r"^(\d+)\.\s")


def constitution_sections(page):
    start = page.index('<span class="footnote">')
    end = page.index("reference-block__wrapper", start)
    region = re.sub(r"<!--.*?-->", "", page[start:end], flags=re.S)
    parser = _ConstitutionBlocks()
    parser.feed(region)
    parser._flush()

    sections, part, chapter, current = [], "", "", None
    preamble = ["preambula", "Преамбула", [], ""]
    sections.append(preamble)
    for kind, text in parser.blocks:
        if kind in ("footnote", "title"):
            preamble[2].append(text)
        elif kind == "part":
            part, chapter, current = text, "", None
        elif kind == "chapter":
            chapter, current = text, None
        elif kind == "h3":
            m = ARTICLE.match(text)
            if m:
                num = m.group(1)
                ctx = " / ".join(x for x in (part, chapter) if x)
                current = [f"st-{num.replace('.', '-')}", f"Статья {num}", [], ctx]
                sections.append(current)
            else:
                chapter, current = text, None  # «Заключительные и переходные положения»
        elif kind == "p":
            if not part:
                preamble[2].append(text)
                continue
            if current is None or (current[0].startswith("p-") and POINT.match(text)):
                m = POINT.match(text)
                if not m:
                    raise ValueError(f"абзац вне статьи: {text[:80]}")
                ctx = " / ".join(x for x in (part, chapter) if x)
                current = [f"p-{m.group(1)}", f"Пункт {m.group(1)}", [], ctx]
                sections.append(current)
            current[2].append(text)
    return sections


def constitution(out):
    page = get(CONSTITUTION_URL)
    if "КОНСТИТУЦИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ" not in page:
        raise RuntimeError("на странице нет заголовка Конституции")
    sections = constitution_sections(page)
    articles = [s[0] for s in sections if s[0].startswith("st-")]
    plain = sorted(int(a[3:]) for a in articles if "-" not in a[3:])
    if plain != list(range(1, 138)):
        raise RuntimeError(f"статьи 1–137 не все: {len(plain)}")
    # последняя поправка, вошедшая в текст: наименования новых субъектов в ч. 1 ст. 65
    if "от 4 октября 2022 г." not in html.unescape(page).replace("\xa0", " "):
        raise RuntimeError("в сносках нет ФКЗ от 4 октября 2022 г.: проверить дату редакции")
    meta = {
        "id": "konstitutsiya-rf",
        "title": "Конституция Российской Федерации",
        "kind": "federal-law",
        "date": "1993-12-12",
        "edition": "2022-10-04",
        "edition_status": "current",
        "source_url": CONSTITUTION_URL,
        "fetched": FETCHED,
        "modules": ["P"],
        "text": "full",
        "note": "Текст Конституции с сайта Президента России с изменениями, одобренными 1 июля 2020 г., и "
        "наименованиями субъектов по ФКЗ от 4 октября 2022 г. № 5-ФКЗ – 8-ФКЗ; сноски сайта о поправках не перенесены.",
        "list_no": 1,
    }
    write_doc(meta, sections, out)
    extra = [a for a in articles if "-" in a[3:]]
    return f"статей {len(articles)} (в том числе {', '.join(extra)}), разделов {len(sections)}, {text_size(sections) // 1000} тыс. знаков"


# ---------- Послание ----------

# Смысловые блоки: (первый абзац, абзац для заголовка, начало первого абзаца для сверки
# [, сколько вводных предложений абзаца пропустить в заголовке: «Далее.», «Хотел бы сказать отдельно.»]).
# Номера абзацев — по порядку <p> в тексте стенограммы (0 — «В.Путин: Уважаемые сенаторы!»).
POSLANIE_BLOCKS = [
    (0, 1, "В.Путин: Уважаемые сенаторы!"),
    (8, 8, "Эти качества чётко"),
    (17, 18, "Уважаемые друзья!"),
    (29, 29, "Россия готова к диалогу"),
    (42, 42, "Очевидно, что необходимо работать"),
    (51, 51, "Кстати, уважаемые друзья"),
    (63, 63, "О ряде конкретных инициатив"),
    (75, 76, "Уважаемые коллеги!"),
    (84, 84, "Далее. За последние годы", 1),
    (91, 92, "Уважаемые коллеги!"),
    (104, 105, "Уважаемые коллеги!"),
    (110, 110, "Начну с кадровой базы"),
    (125, 126, "Уважаемые друзья!"),
    (137, 137, "Проекты технологического суверенитета"),
    (146, 147, "Уважаемые коллеги!"),
    (156, 156, "Наша банковская система"),
    (167, 168, "Уважаемые коллеги!"),
    (175, 175, "Далее. Мы пошли на такое решение", 1),
    (184, 185, "Уважаемые коллеги!"),
    (193, 194, "Уважаемые коллеги!"),
    (207, 208, "Уважаемые коллеги!"),
    (220, 220, "Ещё одно дополнительное решение"),
    (233, 233, "В рамках проекта «Чистый воздух»"),
    (248, 248, "Развитие туризма, региона в целом"),
    (259, 259, "Что хочу сказать здесь дополнительно?", 1),
    (267, 268, "Уважаемые граждане России!", 1),
    (277, 278, "Дорогие друзья!"),
]
POSLANIE_PARAS = 291


def heading_from(text, skip=0, limit=90):
    """Первые слова темы: первое предложение абзаца (после skip вводных), длинное — обрезанное по слову."""
    text = " ".join(re.split(r"(?<=[.!?])\s+", text)[skip:]) or text
    m = re.match(r"(.+?[.!?])(\s|$)", text)
    first = m.group(1) if m else text
    if len(first) <= limit:
        return first.rstrip(".")
    cut = first[:limit].rsplit(" ", 1)[0].rstrip(",;:–— ")
    return cut + "…"


def poslanie_paragraphs(page):
    i = page.index('itemprop="articleBody"')
    j = page.index("read__bottom", i)
    body = re.sub(r"<!--.*?-->", "", page[i:j], flags=re.S)
    body = re.sub(r"<br\s*/?>", " ", body)
    paras = [squeeze(html.unescape(re.sub(r"<[^>]+>", "", p))) for p in re.findall(r"<p[^>]*>(.*?)</p>", body, re.S)]
    return [p for p in paras if p]


def poslanie(out):
    page = get(POSLANIE_URL)
    if 'datetime="2024-02-29"' not in page or "Послание Президента Федеральному Собранию" not in page:
        raise RuntimeError("страница не похожа на Послание от 29.02.2024")
    paras = poslanie_paragraphs(page)
    if len(paras) != POSLANIE_PARAS:
        raise RuntimeError(f"абзацев {len(paras)}, ожидалось {POSLANIE_PARAS}: разбивку надо пересмотреть")
    sections = []
    for n, (start, head, prefix, *skip) in enumerate(POSLANIE_BLOCKS):
        stop = POSLANIE_BLOCKS[n + 1][0] if n + 1 < len(POSLANIE_BLOCKS) else len(paras)
        if not paras[start].startswith(prefix):
            raise RuntimeError(f"блок {n + 1}: абзац {start} начинается не с «{prefix}»")
        sections.append([f"razdel-{n + 1}", heading_from(paras[head], *skip), paras[start:stop], ""])
    assert sum(len(s[2]) for s in sections) == len(paras)
    meta = {
        "id": "lit-2",
        "title": "Послание Президента Федеральному Собранию",
        "kind": "decree",
        "date": "2024-02-29",
        "edition": "2024-02-29",
        "edition_status": "original",
        "source_url": POSLANIE_URL,
        "fetched": FETCHED,
        "modules": ["P"],
        "text": "full",
        "note": "Стенограмма оглашения Послания 29 февраля 2024 г. с сайта Президента России, без сокращений; "
        "разбивка на разделы по темам сделана при сборке корпуса.",
        "list_no": 2,
    }
    write_doc(meta, sections, out)
    sizes = [len(s[2]) for s in sections]
    return f"абзацев {len(paras)}, разделов {len(sections)} (по {min(sizes)}–{max(sizes)} абзацев), {text_size(sections) // 1000} тыс. знаков"


# ---------- Пр-750 ----------

LETTERS = dict(zip("абвгдежзиклмнопрстуфхцчшщэюя",
                   "a b v g d e zh z i k l m n o p r s t u f kh ts ch sh shch eh yu ya".split()))
SUBPOINT = re.compile(r"^([а-я])\)\s")
TOP_POINT = re.compile(r"^(\d+)\.\s")


def pr750_sections(text):
    lines = [squeeze(x) for x in text.split("\n")]
    lines = [x for x in lines if x]
    # первые строки: название, дата и время публикации, вводная фраза сайта
    title, stamp, lead, rest = lines[0], lines[1], lines[2], lines[3:]
    if not re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$", stamp):
        raise RuntimeError(f"неожиданная вторая строка текстовой версии: {stamp}")
    sections = [["preambula", "Вводная часть", [title, lead], ""]]
    current, point_head = None, ""
    for line in rest:
        m_top, m_sub = TOP_POINT.match(line), SUBPOINT.match(line)
        if m_top:
            n = m_top.group(1)
            point_head = line.rstrip(":")
            current = [f"p-{n}", f"Пункт {n}", [line], ""]
            sections.append(current)
        elif m_sub and current is not None:
            letter = m_sub.group(1)
            num = current[0].split("-")[1]
            current = [f"p-{num}-{LETTERS[letter]}", f"Пункт {num} «{letter}»", [line], point_head]
            sections.append(current)
        elif current is not None:
            current[2].append(line)
        else:
            raise RuntimeError(f"строка до первого пункта: {line[:80]}")
    return sections


def pr750(out):
    page = get(PR750_URL)
    heads = re.findall(r'<h4 id="assignment-\d+">([^<]*)</h4>', page)
    if not heads or not all(h.strip().startswith("Пр-750,") for h in heads):
        raise RuntimeError("на странице поручений нет номера Пр-750")
    if 'datetime="2014-04-08"' not in page:
        raise RuntimeError("дата на странице не 08.04.2014")
    copy = get(PR750_TEXT_URL)
    m = re.search(r"<textarea[^>]*>(.*?)</textarea>", copy, re.S)
    if not m:
        raise RuntimeError("в текстовой версии нет текста")
    sections = pr750_sections(html.unescape(m.group(1)))
    # поручение — подпункт или пункт без подпунктов
    n_items = sum(1 for s in sections[1:] if not any(t[0].startswith(s[0] + "-") for t in sections))
    if n_items != len(heads):
        raise RuntimeError(f"поручений в тексте {n_items}, на странице {len(heads)}")
    meta = {
        "id": "lit-5",
        "title": "Перечень поручений по итогам заседания Совета по развитию физической культуры и спорта",
        "kind": "decree",
        "number": "Пр-750",
        "date": "2014-04-08",
        "edition": "2014-04-08",
        "edition_status": "original",
        "source_url": PR750_TEXT_URL,
        "fetched": FETCHED,
        "modules": ["R"],
        "text": "full",
        "note": "Перечень поручений Президента от 8 апреля 2014 г. № Пр-750 (по итогам заседания Совета 24 марта 2014 г.), "
        "текстовая версия страницы kremlin.ru/acts/assignments/orders/20757.",
        "list_no": 5,
    }
    write_doc(meta, sections, out)
    return f"поручений {n_items}, разделов {len(sections)}, {text_size(sections) // 1000} тыс. знаков"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["constitution", "poslanie", "pr750", "all"])
    ap.add_argument("--out", default=str(ROOT))
    args = ap.parse_args()
    jobs = {"constitution": constitution, "poslanie": poslanie, "pr750": pr750}
    names = list(jobs) if args.what == "all" else [args.what]
    code = 0
    for name in names:
        try:
            print(f"{name:13} ok    {jobs[name](args.out)}", flush=True)
        except Exception as e:  # сеть или страница изменилась: в корпус ничего не пишем
            print(f"{name:13} error {e}", flush=True)
            code = 1
    return code


if __name__ == "__main__":
    sys.exit(main())
