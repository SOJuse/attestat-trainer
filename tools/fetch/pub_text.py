"""Разбор текста акта в разделы для text.md: из PDF с текстовым слоем и из HTML government.ru.

PDF читается через `pdftotext -layout`: строки сохраняют отступы, по ним видно,
где начинается абзац, какая строка стоит по центру (заголовок) и какая прижата
вправо (гриф «УТВЕРЖДЕН …», «Приложение …»).

Шаги:
  pdf_paragraphs(pages)  страницы → абзацы [(вид, текст)];
                         колонтитулы и номера страниц убираются, строки абзаца
                         склеиваются, перенос слова через дефис снимается
  html_paragraphs(html)  тело документа со страницы government.ru → абзацы
  to_sections(paras)     абзацы → разделы [якорь, заголовок, [абзацы], контекст]
  to_markdown(sections)  текст для text.md

Вид абзаца: ""      обычный текст
            "title" строка по центру: название акта, приложения, раздела
            "stamp" гриф приложения («УТВЕРЖДЕН …», «Приложение № 1 …»)
            "sign"  подпись
            "row"   строка таблицы, ячейки через « | »

Якоря как в ips_text.py: preambula, p-N, podpis, pril-K, pril-K-p-N, pril-K-razdel-N.
"""
import collections
import html as htmllib
import re

POINT = re.compile(r"^(\d{1,3})\.(?!\d)\s*\S")
STAMP = re.compile(r"^(УТВЕРЖДЕН[АЫО]?|Утвержден[аыо]?|ПРИЛОЖЕНИЕ|Приложение)(\s|$)")
# гриф с номером («Приложение № 2 к приказу») открывает новое приложение даже сразу после другого грифа
STAMP_NUMBERED = re.compile(r"^(ПРИЛОЖЕНИЕ|Приложение)\s*(№|N)?\s*\d")
SECTION_TITLE = re.compile(r"^([IVXLC]+\.\s|Глава\s|ГЛАВА\s|Раздел\s|РАЗДЕЛ\s)")
LIST_START = re.compile(r"^(\d+(\.\d+)*\.(\s|$)|\d+(\.\d+)*\)\s|[а-яё]\)\s|[–—•]\s|\d+\.\d+(\.\d+)*\s)")
PAGE_NUMBER = re.compile(r"^[-–—]?\s*\d{1,4}\s*[-–—]?$")
# колонтитул с шифром документа внизу страницы скана: «Порядок - 03», «©б утверждении Порядка — 03»
DOC_FOOTER = re.compile(r"^[©@]?\s*[А-ЯЁа-яё][А-ЯЁа-яё ]{2,45}\s[-–—]\s?\d{2}$")
# сколько номеров пунктов можно перескочить, если номер не распознался
MAX_POINT_GAP = 3
NAME_AT_END = re.compile(r"(^|\s)([А-ЯЁ]\.\s?){1,2}[А-ЯЁ][а-яё]+(-[А-ЯЁ][а-яё]+)?$")
NAME = re.compile(r"^([А-ЯЁ]\.\s?){1,2}[А-ЯЁ][а-яё]+(-[А-ЯЁ][а-яё]+)?$|^[А-ЯЁ][а-яё]+\s([А-ЯЁ]\.\s?){1,2}$")
POSITION = re.compile(
    r"^(Министр|Председатель|Руководитель|Заместитель|Первый заместитель|Временно исполняющий|"
    r"Исполняющий обязанности|Главный государственный санитарный врач|Мэр|Президент|Директор|Врио)\b"
)
SENTENCE_END = re.compile(r"[.:;!?]$")
# частые первые части сложных слов: «медико-педагогический», «санитарно-эпидемиологический»
COMPOUND_HEADS = {
    "медико", "психолого", "санитарно", "научно", "учебно", "социально", "военно", "финансово",
    "информационно", "культурно", "физкультурно", "спортивно", "историко", "нормативно",
    "организационно", "профессионально", "общественно", "материально", "лечебно", "опытно",
    "коммунально", "жилищно", "административно", "уголовно", "гражданско", "северо", "юго",
}
ADJ_ENDINGS = ("ый", "ий", "ой", "ая", "яя", "ое", "ее", "ые", "ие", "ого", "его", "ому", "ему",
               "ым", "им", "ых", "их", "ую", "юю", "ыми", "ими")
# пометка редакции, которую ставит ИПС «Законодательство России» (и government.ru вслед за ней):
# «(В редакции Постановления … от 02.08.2019 № 1011)», «(Дополнен - Постановление … от 02.08.2019 № 1011)».
# Пометки «(Утратил силу - …)» не трогаем: они заменяют собой текст нормы.
EDITION_NOTE = re.compile(
    r"\s*\((?:[А-ЯЁа-яё]+\s+)?(?:[Вв] редакции|Дополнен[аоы]?|Изложен[аоы]?)\b[^()]*?"
    r"от \d{2}\.\d{2}\.\d{4} № [^()\s]+\)"
)


def squeeze(text):
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def unspace_letters(text):
    """«п р и к а з ы в а ю» → «приказываю»: разрядка букв в PDF — это оформление, не текст."""
    return re.sub(
        r"(?<![А-Яа-яЁё\w])((?:[А-Яа-яЁё] ){3,}[А-Яа-яЁё])(?![А-Яа-яЁё\w])",
        lambda m: m.group(1).replace(" ", ""),
        text,
    )


# ---------- PDF ----------


def _furniture(pages):
    """Номера страниц и повторяющиеся колонтитулы: множество (страница, строка), которые надо убрать."""
    drop = set()
    edges = collections.defaultdict(list)  # текст крайней строки (цифры → #) → [(страница, строка)]
    for pi, lines in enumerate(pages):
        filled = [i for i, s in enumerate(lines) if s.strip()]
        if not filled:
            continue
        for i in filled[:2] + filled[-2:]:
            text = lines[i].strip()
            if PAGE_NUMBER.match(text) or re.match(r"^(Страница|стр\.)\s*\d+(\s*из\s*\d+)?$", text, re.I):
                drop.add((pi, i))
        for i in filled:
            if DOC_FOOTER.match(lines[i].strip()):
                drop.add((pi, i))
        for i in {filled[0], filled[-1]}:
            edges[re.sub(r"\d+", "#", squeeze(lines[i]))].append((pi, i))
    pages_with_text = sum(1 for lines in pages if any(s.strip() for s in lines))
    for places in edges.values():
        if len({p for p, _ in places}) >= 3 and len(places) >= pages_with_text / 2:
            drop.update(places)
    return drop


def _geometry(lines):
    """Левое поле и правый край тела текста (в символах) по длинным строкам."""
    long = [ln for ln in lines if len(ln.strip()) > 40 and not re.search(r"\S {4,}\S", ln.strip())]
    if not long:
        long = lines
    leads = collections.Counter(len(ln) - len(ln.lstrip()) for ln in long)
    # самый левый отступ, который встречается хотя бы у двадцатой части длинных строк
    enough = [k for k, n in leads.items() if n >= max(1, len(long) // 20)] or list(leads)
    left = min(enough)
    widths = sorted(len(ln.rstrip()) for ln in long)
    right = widths[int(len(widths) * 0.9)]
    return left, max(right, left + 30)


def _kind(line, left, right):
    """Вид строки по её положению: flush, indent, center, right, sign, row."""
    text = line.strip()
    lead = len(line) - len(line.lstrip()) - left
    tail = right - len(line.rstrip())
    gap = re.search(r"\S( {6,})\S", text)
    if gap:
        head, last = text[: gap.start(1)].strip(), text[gap.end(1) :].strip()
        if NAME.match(last) and len(head) < 60:
            return "sign"
        return "row"
    starts_item = bool(POINT.match(text) or LIST_START.match(text))
    if lead >= 6 and tail >= 6 and abs(lead - tail) <= max(4, lead // 4) and not (starts_item and lead <= 8):
        return "center"
    if lead >= (right - left) * 0.35:
        return "right"
    if lead >= 2:
        return "indent"
    return "flush"


def _join(prev, nxt, vocab):
    """Склейка строк абзаца. Перенос слова через дефис снимается, дефис сложного слова остаётся."""
    if prev.endswith("\xad"):
        return prev[:-1] + nxt
    m = re.search(r"([А-Яа-яЁёA-Za-z]+)-$", prev)
    if m and nxt[:1].islower():
        head = m.group(1)
        tail = re.match(r"[А-Яа-яЁёA-Za-z]*", nxt).group(0)
        whole, hyphened = (head + tail).lower(), (head + "-" + tail).lower()
        if hyphened in vocab:
            keep = True
        elif whole in vocab:
            keep = False
        else:
            keep = len(tail) >= 5 and (head.lower() in COMPOUND_HEADS or _adjective_head(head, vocab))
        return prev + nxt if keep else prev[:-1] + nxt
    if re.search(r"\d-$", prev) or (prev.endswith("-") and nxt[:1].isupper()):
        return prev + nxt  # «№ 273-» + «ФЗ», «Санкт-» + «Петербург»
    return prev + " " + nxt


def _adjective_head(head, vocab):
    """«санитарно» — первая часть сложного слова, если в тексте есть «санитарные», «санитарных» …"""
    low = head.lower()
    if len(low) < 5 or not low.endswith("о"):
        return False
    stem = low[:-1]
    return any(stem + end in vocab for end in ADJ_ENDINGS)


def _vocab(lines):
    words = set()
    for ln in lines:
        words.update(w.lower() for w in re.findall(r"[А-Яа-яЁёA-Za-z]+(?:-[А-Яа-яЁёA-Za-z]+)*", ln))
    return words


def pdf_paragraphs(pages):
    """pages — тексты страниц из `pdftotext -layout` (строки с отступами)."""
    split = [p.replace("\f", "").split("\n") for p in pages]
    drop = _furniture(split)
    lines = [
        ln.rstrip().expandtabs(8)
        for pi, page in enumerate(split)
        for i, ln in enumerate(page)
        if (pi, i) not in drop and ln.strip()
    ]
    if not lines:
        return []
    left, right = _geometry(lines)
    vocab = _vocab(lines)
    paras = []  # [вид абзаца, текст, вид последней строки, длина последней строки]
    for line in lines:
        text = squeeze(line)
        kind = _kind(line, left, right)
        prev = paras[-1] if paras else None
        if kind == "sign":
            text = re.sub(r" {2,}", " ", text)
            # «Председатель Правительства» на строке выше относится к подписи
            if prev and prev[0] == "" and POSITION.match(prev[1]) and len(prev[1]) < 60:
                prev[0], prev[1], prev[2] = "sign", prev[1] + " " + text, kind
            else:
                paras.append(["sign", text, kind, len(line)])
            continue
        if kind == "row":
            cells = [squeeze(c) for c in re.split(r" {3,}", line.strip()) if c.strip()]
            paras.append(["row", " | ".join(cells), kind, len(line)])
            continue
        if kind == "center":
            joins = (
                prev is not None
                and prev[0] == "title"
                and not SECTION_TITLE.match(text)
                and not re.match(r"от \d", text)
                and (text[:1].islower() or prev[1].endswith(("-", ",")))
            )
            if joins:
                prev[1] = _join(prev[1], text, vocab)
            else:
                paras.append(["title", text, kind, len(line)])
            continue
        if kind == "right":
            starts_stamp = bool(STAMP.match(text))
            # гриф кончается строкой с датой и номером акта: «от 24 марта 2023 г. № 196»
            closed = prev is not None and prev[0] == "stamp" and re.search(r"\bот\s.+№\s*\S+$", prev[1])
            if prev is not None and prev[2] == "right" and not starts_stamp and not closed:
                prev[1] = _join(prev[1], text, vocab)
            else:
                paras.append(["stamp" if starts_stamp else "", text, kind, len(line)])
            continue
        new = (
            prev is None
            or prev[0] != ""
            or prev[2] in ("center", "right")
            or kind == "indent"
            or bool(LIST_START.match(text))
            or (bool(SENTENCE_END.search(prev[1])) and prev[3] < right - 8)
            or (bool(SENTENCE_END.search(prev[1])) and bool(POSITION.match(text)) and len(text) < 60)
        )
        if new:
            paras.append(["", text, kind, len(line)])
        else:
            prev[1] = _join(prev[1], text, vocab)
            prev[2], prev[3] = kind, len(line)
    out = []
    for kind, text, _, _ in paras:
        text = unspace_letters(squeeze(text))
        if text:
            out.append((kind, text))
    return out


LETTER_ITEM = re.compile(r"^([а-яё])\)\s")


def fix_misreadings(paras):
    """Правит ошибки распознавания, которые однозначно видны по соседям.

    «6)» вместо «б)» сразу после подпункта «а)»; «м?» вместо «м²»; значок © на месте буквы «о».
    Числа и слова не трогаются: их сверяют со сканом.
    """
    out, prev_letter = [], ""
    for kind, text in paras:
        if prev_letter == "а" and text.startswith("6) "):
            text = "б" + text[1:]
        m = LETTER_ITEM.match(text)
        prev_letter = m.group(1) if m else ("" if re.match(r"^\d+[.)]\s", text) else prev_letter)
        text = re.sub(r"(\d\s?)м\?(?=\s|$|[,.;)])", r"\1м²", text)
        text = re.sub(r"(?<=[а-яё,] )©(?= [а-яё])", "о", text)
        out.append((kind, text))
    return out


# ---------- HTML government.ru ----------


def _spaces_added(body):
    """government.ru добавляет пробел после каждой запятой и закрывающей скобки.

    Признак: после запятой почти всегда два пробела, а там, где в акте пробела не было,
    стоит один («0, 5 процента» вместо «0,5 процента»); запятой вплотную к слову нет.
    """
    two = len(re.findall(r", {2}\S", body))
    one = len(re.findall(r", \S", body))
    tight = len(re.findall(r",[^\s\d]", body))
    return two >= 3 and tight == 0 and two >= 0.6 * (two + one)


# предлоги из одной буквы, которые не бывают окончанием слова перед ними («размер+а», «контракт+у» — бывают)
ONE_LETTER_WORDS = set("вск")


def _unglue(text, vocab):
    """В заголовках и грифах government.ru теряет переносы строк: «начисляемогов случае»,
    «Федерацииот 30 августа», «контрактом(за». Слово разрезается, только если самого его
    в тексте акта нет, обе части есть, и такой разрез единственный.
    """
    text = re.sub(r"([А-Яа-яЁё])\(", r"\1 (", text)

    def fix(m):
        word = m.group(0)
        low = word.lower()
        if low in vocab or len(low) < 4:
            return word
        cuts = [
            i
            for i in range(1, len(low))
            if low[:i] in vocab
            and low[i:] in vocab
            and (i > 1 or low[:i] in ONE_LETTER_WORDS)
            and (len(low) - i > 1 or low[i:] in ONE_LETTER_WORDS)
        ]
        return word[: cuts[0]] + " " + word[cuts[0] :] if len(cuts) == 1 else word

    return re.sub(r"[А-Яа-яЁё]+", fix, text)


def html_paragraphs(body_html):
    """Тело документа со страницы government.ru/docs/all/N/: <h4> — заголовки, <p> — абзацы."""
    blocks = []
    for m in re.finditer(r"<(h4|p)\b[^>]*>(.*?)</\1>", body_html, re.S | re.I):
        raw = htmllib.unescape(re.sub(r"<br\s*/?>", " ", m.group(2), flags=re.I))
        blocks.append((m.group(1).lower(), re.sub(r"<[^>]+>", "", raw).replace("\xa0", " ")))
    plain = "\n".join(t for _, t in blocks)
    undo = (",", ")") if _spaces_added(plain) else ()
    vocab = _vocab(t for tag, t in blocks if tag == "p" and not STAMP.match(t.strip()))

    paras = []
    for tag, raw in blocks:
        for ch in undo:
            raw = raw.replace(ch + " ", ch)
        # перед словом после запятой или скобки пробел нужен всегда (на месте пропавшего переноса строки)
        raw = re.sub(r"([,)])(?=[А-Яа-яЁёA-Za-z])", r"\1 ", raw)
        text = squeeze(EDITION_NOTE.sub("", squeeze(raw)))
        if not text or re.fullmatch(r"_+", text):
            continue
        if tag == "h4" or STAMP.match(text):
            text = _unglue(text, vocab)
        if tag == "h4":
            paras.append(("title", text))
        elif STAMP.match(text):
            paras.append(("stamp", text))
        elif POSITION.match(text) and not SENTENCE_END.search(text) and (NAME_AT_END.search(text) or len(text) < 40):
            paras.append(("sign", text))
        elif paras and paras[-1][0] == "sign" and not NAME_AT_END.search(paras[-1][1]) and NAME_AT_END.search(text):
            paras[-1] = ("sign", paras[-1][1] + " " + text)
        else:
            paras.append(("", text))
    return paras


# ---------- разделы ----------


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
    def last(self):
        return self.sections[-1][0]

    @property
    def body(self):
        return self.sections[-1][2]


def to_sections(paras):
    b = _Builder()
    b.add("preambula", "Вводная часть")
    st = {"annex": 0, "title": "", "title_open": False, "point": 0, "context": "", "fresh": False, "untitled": 0}
    signed = False

    def open_annex(first_para, heading=""):
        last = b.sections[-1]
        only_stamp = annex_open_only_with_stamp(last)
        if first_para and only_stamp and not STAMP_NUMBERED.match(first_para):
            # «Приложение» и следом «УТВЕРЖДЕН приказом…» — гриф одного приложения
            last[2].append(first_para)
            st["title_open"] = True
            return
        st.update(annex=st["annex"] + 1, title=heading, title_open=True, point=0, context="", fresh=False, untitled=0)
        b.add(f"pril-{st['annex']}", heading or f"Приложение {st['annex']}")
        if first_para:
            b.body.append(first_para)

    def annex_open_only_with_stamp(section):
        return (
            section[0] == f"pril-{st['annex']}" and st["annex"] > 0 and st["title_open"]
            and len(section[2]) == 1 and not st["title"] and STAMP.match(section[2][0]) is not None
        )

    def flush_title():
        """Название, под которым так и не начался пункт, остаётся в тексте абзацем."""
        if st["fresh"]:
            b.body.append(st["context"])
            st["fresh"] = False

    for kind, text in paras:
        annex = st["annex"]
        if kind == "stamp":
            flush_title()
            open_annex(text)
            continue
        if kind == "sign" and not annex:
            flush_title()
            if not signed:
                b.add("podpis", "Подпись и реквизиты")
                signed = True
            b.body.append(text)
            continue
        m = POINT.match(text) if kind in ("", "title") else None
        number = int(m.group(1)) if m else 0
        is_point = (
            bool(m)
            and st["point"] < number <= st["point"] + MAX_POINT_GAP
            and not (signed and not annex)
            # пропуск номера допустим только когда нумерация уже идёт
            and (number == st["point"] + 1 or st["point"] > 0)
        )
        if kind == "title" and not is_point:
            if annex and st["title_open"] and not SECTION_TITLE.match(text):
                st["title"] = (st["title"] + " " + text).strip()
                b.sections[-1][1] = st["title"]
                continue
            if signed and not annex:
                # приложение без грифа: после подписи сразу идёт название («ПОРЯДОК …»)
                open_annex("", text)
                continue
            st["title_open"] = False
            if annex or b.last != "preambula":
                flush_title()
                st["context"], st["fresh"] = text, True
                continue
        st["title_open"] = False
        if st["fresh"] and not is_point:
            # под новым названием идёт текст без номера: это отдельный раздел, а не хвост прошлого пункта
            st["untitled"] += 1
            prefix = f"pril-{annex}-" if annex else ""
            b.add(f"{prefix}razdel-{st['untitled']}", st["context"])
        st["fresh"] = False
        if is_point:
            st["point"] = number
            n = st["point"]
            if annex:
                suffix = f". {st['title']}" if st["title"] else f" приложения {annex}"
                b.add(f"pril-{annex}-p-{n}", f"Пункт {n}{suffix}", st["context"])
            else:
                b.add(f"p-{n}", f"Пункт {n}", st["context"])
        b.body.append(text)
    flush_title()
    return [s for s in b.sections if s[2]]


def to_markdown(sections):
    """Текст для text.md и число разделов. Контекст идёт строкой «> …» сразу под заголовком."""
    lines = []
    for anchor, heading, body, context in sections:
        lines += [f"## {{#{anchor}}} {heading}", ""]
        if context:
            lines += [f"> {context}", ""]
        for p in body:
            lines += [("\\" + p) if p.startswith(("## {#", "> ")) else p, ""]
    return "\n".join(lines), len(sections)
