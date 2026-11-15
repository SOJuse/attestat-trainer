"""Разбор HTML, который отдаёт actual.pravo.gov.ru, в разделы для text.md.

Разметка портала:
  <p class="H">        заголовок статьи или главы
  <p class="T">, "C"   названия частей, разделов, документа
  <p class="Y">        строка с подписью
  <p class="S">        гриф «УТВЕРЖДЕНЫ …» или «ПРИЛОЖЕНИЕ …», с него начинается приложение
  <span class="W9">    надстрочный индекс: «60<span class="W9">2</span>» читается как 60.2
  <span class="mark">  пометка портала («В редакции Федерального закона от …»), не часть нормы
  <span class="ed">    изменённый текст нормы, оставляем как есть
  <br>                 перенос строки внутри абзаца

to_sections(html) возвращает список разделов: [якорь, заголовок, [абзацы], контекст].
Контекст — названия части, раздела и главы, в которых стоит статья.
"""
import re
from html.parser import HTMLParser

# номер статьи: 256, 60.2, 6.1.1, 341.1-1
ARTICLE = re.compile(r"^Статья\s+(\d+(?:[.\-]\d+)*)\.?(?:\s|$)")
POINT = re.compile(r"^(\d{1,3})\.\s*\S")
# пометки портала, которые меняют смысл нормы и потому остаются в тексте
KEEP_NOTE = re.compile(r"утратил|не действует|Действует до|не применяется", re.I)
LEVELS = [
    (re.compile(r"^ЧАСТЬ\b", re.I), 0),
    (re.compile(r"^РАЗДЕЛ\b", re.I), 1),
    (re.compile(r"^ПОДРАЗДЕЛ\b", re.I), 2),
    (re.compile(r"^ГЛАВА\b", re.I), 3),
    (re.compile(r"^§"), 4),
]
OTHER_LEVEL = 5
NOTE_CLASSES = {"mark", "markx"}


def squeeze(text):
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


class _Paragraphs(HTMLParser):
    """Собирает абзацы: (класс, текст). Строка таблицы — один абзац с ячейками через « | »."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.in_body = False
        self.para = None  # {'cls', 'main': [], 'notes': [], 'note': []}
        self.spans = []  # классы открытых span
        self.row = None  # список ячеек текущей строки таблицы
        self.cell = None  # список кусков текущей ячейки

    # --- абзац ---
    def _open(self, cls):
        self.para = {"cls": cls, "main": [], "notes": [], "note": []}
        self.spans = []

    def _close(self):
        p, self.para = self.para, None
        if p is None:
            return
        if p["note"]:
            p["notes"].append("".join(p["note"]))
        main = squeeze("".join(p["main"]))
        cls = p["cls"]
        kept = " ".join(squeeze(n) for n in p["notes"] if KEEP_NOTE.search(n))
        if not main:
            main, kept = kept, ""
            cls = ""  # абзац из одной пометки заголовком не бывает
        if not main:
            return
        if self.cell is not None:
            self.cell.append(f"{main} {kept}".strip())
        elif cls == "H" and kept:
            # «Статья 98. (Утратила силу …)»: пометка становится текстом статьи
            self.out.append((cls, main))
            self.out.append(("", kept))
        else:
            self.out.append((cls, f"{main} {kept}".strip()))

    def _in_note(self):
        return any(c in NOTE_CLASSES for c in self.spans)

    # --- события ---
    def handle_starttag(self, tag, attrs):
        if tag == "body":
            self.in_body = True
            return
        if not self.in_body:
            return
        cls = dict(attrs).get("class") or ""
        if tag == "p":
            self._close()
            self._open(cls.split()[0] if cls else "")
        elif tag == "span" and self.para is not None:
            was_note = self._in_note()
            self.spans.append(cls)
            if cls in NOTE_CLASSES and not was_note and self.para["note"]:
                self.para["notes"].append("".join(self.para["note"]))
                self.para["note"] = []
        elif tag == "br":
            self.handle_data(" ")
        elif tag == "tr":
            self._close()
            self.row = []
        elif tag in ("td", "th"):
            self._close()
            self.cell = []

    def handle_endtag(self, tag):
        if not self.in_body:
            return
        if tag == "p":
            self._close()
        elif tag == "span" and self.para is not None and self.spans:
            closed = self.spans.pop()
            if closed in NOTE_CLASSES and not self._in_note():
                self.para["notes"].append("".join(self.para["note"]))
                self.para["note"] = []
        elif tag in ("td", "th") and self.cell is not None:
            self._close()
            if self.row is not None:
                self.row.append(" ".join(self.cell))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            cells = [c for c in self.row if c]
            if cells:
                self.out.append(("row", " | ".join(cells)))
            self.row = None
        elif tag == "body":
            self._close()
            self.in_body = False

    def handle_data(self, data):
        if not self.in_body:
            return
        if self.para is None:
            if self.cell is not None and data.strip():
                self.cell.append(squeeze(data))
            return
        if self.spans and self.spans[-1] == "W9":
            data = "." + data.strip()
        (self.para["note"] if self._in_note() else self.para["main"]).append(data)


def paragraphs(doc_html):
    parser = _Paragraphs()
    parser.feed(doc_html)
    parser.close()
    return parser.out


def _level(text):
    for pattern, level in LEVELS:
        if pattern.match(text):
            return level
    return None


class _Builder:
    def __init__(self):
        self.sections = []
        self.used = {}

    def add(self, anchor, heading, context=""):
        n = self.used.get(anchor, 0) + 1
        self.used[anchor] = n
        if n > 1:
            anchor = f"{anchor}-dup{n}"
        self.sections.append([anchor, heading, [], context])

    @property
    def body(self):
        return self.sections[-1][2]


def _articles(paras):
    b = _Builder()
    path = {}  # уровень → название
    in_signature = False

    def context():
        return " / ".join(path[k] for k in sorted(path))

    for cls, text in paras:
        if in_signature:
            b.body.append(text)
            continue
        m = ARTICLE.match(text) if cls == "H" else None
        if m:
            b.add("st-" + re.sub(r"[.\-]", "-", m.group(1)), text, context())
            continue
        if cls == "Y":
            b.add("podpis", "Подпись и реквизиты")
            b.body.append(text)
            in_signature = True
            continue
        level = _level(text) if cls in ("H", "T", "C") else None
        if level is None and cls in ("H", "T", "C") and b.sections and b.sections[-1][0] != "preambula":
            level = OTHER_LEVEL
        if level is not None:
            for deeper in [k for k in path if k >= level]:
                del path[deeper]
            path[level] = text
            continue
        if not b.sections:
            b.add("preambula", "Вводная часть")
        b.body.append(text)
    return b.sections


def _points(paras):
    b = _Builder()
    b.add("preambula", "Вводная часть")
    annex = 0
    annex_title = ""
    title_open = False  # сразу после грифа идут строки названия приложения
    last_point = 0
    context = ""
    fresh_title = False  # название раздела только что прочитано, под ним ещё ничего нет
    untitled = 0

    for cls, text in paras:
        if cls == "S":
            annex += 1
            annex_title, title_open, last_point, context = "", True, 0, ""
            fresh_title, untitled = False, 0
            b.add(f"pril-{annex}", f"Приложение {annex}")
            b.body.append(text)
            continue
        if cls == "Y" and not annex:
            b.add("podpis", "Подпись и реквизиты")
            b.body.append(text)
            continue
        if annex and title_open and cls == "T":
            annex_title = (annex_title + " " + text).strip()
            b.sections[-1][1] = annex_title
            continue
        title_open = False
        if cls in ("C", "H", "T") and (annex or b.sections[-1][0] != "preambula"):
            context = text
            fresh_title = True
            continue
        m = POINT.match(text) if cls != "row" else None
        is_point = bool(m) and int(m.group(1)) == last_point + 1 and b.sections[-1][0] != "podpis"
        if fresh_title and not is_point:
            # под новым названием идёт текст без номера: это отдельный раздел, а не хвост прошлого пункта
            untitled += 1
            prefix = f"pril-{annex}-" if annex else ""
            b.add(f"{prefix}razdel-{untitled}", context)
        fresh_title = False
        if is_point:
            last_point += 1
            if annex:
                suffix = f". {annex_title}" if annex_title else f" приложения {annex}"
                b.add(f"pril-{annex}-p-{last_point}", f"Пункт {last_point}{suffix}", context)
            else:
                b.add(f"p-{last_point}", f"Пункт {last_point}", context)
        b.body.append(text)
    return b.sections


def to_sections(doc_html):
    paras = paragraphs(doc_html)
    articles = sum(1 for cls, text in paras if cls == "H" and ARTICLE.match(text))
    sections = _articles(paras) if articles >= 3 else _points(paras)
    return [s for s in sections if s[2]]


def to_markdown(doc_html):
    """Текст для text.md и число разделов. Контекст идёт строкой «> …» сразу под заголовком."""
    sections = to_sections(doc_html)
    lines = []
    for anchor, heading, body, context in sections:
        lines += [f"## {{#{anchor}}} {heading}", ""]
        if context:
            lines += [f"> {context}", ""]
        for p in body:
            # строка, начинающаяся с «## {#» или «> », была бы принята за разметку
            lines += [("\\" + p) if p.startswith(("## {#", "> ")) else p, ""]
    return "\n".join(lines), len(sections)
