#!/usr/bin/env python3
"""Письма и методические рекомендации из банка документов Минпросвещения России (docs.edu.gov.ru).

Как устроен банк (по коду его страниц, CMS LiveStreet + Vue):
  * главная страница выдаёт сессионные cookies и ключ LIVESTREET_SECURITY_KEY;
  * поиск — POST https://docs.edu.gov.ru/document/ajax/search/ с полями
      val                    подстрока НАЗВАНИЯ документа (без морфологии; текст файлов не ищется),
      type, activity         вид документа и направление (справочники: ajax/types/, ajax/activities/),
      date_publication_from  на деле дата ПОДПИСАНИЯ («Принят»), формат ГГГГ.ММ.ДД;
      date_publication_to    заполнена не у всех документов,
      page                   страница выдачи (по 15 документов),
      security_ls_key        ключ с главной страницы;
    ответ — JSON {items: [{title, url, date_publication, type}], count, paging}.
    Пустой val с указанным type выдаёт весь раздел;
  * карточка https://docs.edu.gov.ru/document/<hash>/ — название (h1), «Номер документа»,
    «Принят», «Опубликован» (есть не у всех) и файлы …/download/<n>/ (PDF, DOCX, ODT, DOC).
  Вида «Письма» в банке нет: письма лежат в «Методиках и рекомендациях», «Документации»,
  «Информационных материалах». Номер письма в названии бывает редко.

Сертификат docs.edu.gov.ru и edu.gov.ru выдан российским удостоверяющим центром:
curl получает --cacert tools/fetch/certs/bundle.pem. Проверка сертификата не отключается.

Команды (запуск из корня репозитория):
  edu.py search <строка> [--type N] [--signed ГГГГ-ММ-ДД]   поиск по названию
  edu.py show <адрес карточки>                               карточка и файлы
  edu.py fetch <doc-id> [--url адрес] [--out DIR] [--dry]     один документ из реестра
  edu.py auto [--ids a,b] [--report файл] [--out DIR] [--dry] все письма (kind: letter)

Документ попадает в корпус, только если номер и дата из реестра подтверждены источником:
полем карточки или текстом файла. --dry пишет результат в рабочую папку, а не в корпус
(для просмотра разбора); подтверждение номера при этом не требуется.
Рабочая папка (cookies, скачанные файлы) — $EDU_WORK или <tmp>/edu-fetch.
"""
import argparse
import datetime
import html
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import zipfile
import xml.etree.ElementTree as ET

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from docout import ROOT, squeeze, text_size, write_doc  # noqa: E402

BASE = "https://docs.edu.gov.ru/"
SEARCH = BASE + "document/ajax/search/"
CA = pathlib.Path(__file__).resolve().parent / "certs" / "bundle.pem"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
WORK = pathlib.Path(os.environ.get("EDU_WORK") or pathlib.Path(tempfile.gettempdir()) / "edu-fetch")
FETCHED = "2026-11-16"
MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября",
          "октября", "ноября", "декабря"]

# Подстроки названий, по которым ищем каждое письмо (кроме номера и даты подписания).
TOPICS = {
    "pismo-08-415-124": ["педагогических работников на дополнительное", "дополнительное профессиональное образование"],
    "pismo-13-312": ["Публичных докладов", "Публичного доклада", "публичный доклад"],
    "pismo-06-836": ["экскурси"],
    "pismo-06-836-n145": ["экскурси"],
    "pismo-vk-262-09": ["советов обучающихся", "совета обучающихся"],
    "pismo-03-1669": ["Информационно-методическ"],
    "pismo-yar-15972-13-516": ["программам профессионального обучения", "05-500"],
    "pismo-yar-15972-13-516-n135": ["программам профессионального обучения", "05-500"],
    "pismo-10-238": ["пунктов медицинской помощи", "пунктах проведения экзаменов"],
    "pismo-10-238-n132": ["пунктов медицинской помощи", "пунктах проведения экзаменов"],
    "pismo-04-78": ["особенностях проведения государственной итоговой"],
    "pismo-10-744": ["графика внесения сведений", "региональные информационные системы"],
    "pismo-04-103": ["проведении государственной итоговой аттестации"],
    "pismo-05-401": ["в пределах освоения"],
    "pismo-mn-6-2820": ["комплексной безопасности"],
    "pismo-ash-p25-7426": ["обработки персональных данных", "итоговом собеседовании"],
    "pismo-03-652": ["продленного дня", "продлённого дня", "досуговой"],
    "pismo-07-3004": ["продленного дня", "продлённого дня", "присмотра и ухода"],
    "pismo-ab-3915-06": ["персонифицированного"],
    "pismo-03-1142": ["продленного дня", "продлённого дня", "присмотру и уходу"],
    "pismo-sk-749-02": ["готовности организаций", "началу учебного года"],
    "pismo-ak-923-07": ["девиантн"],
    "pismo-ak-2563-05": ["сетевых форм", "сетевой форм"],
    "pismo-ak-630-14": ["учебно-практических", "террористической направленности"],
    "pismo-ab-3935-06": ["обновления содержания, методов", "качества дополнительного образования"],
    "lit-147": ["меню", "мониторинга питания"],
    "lit-148": ["нарушения зрения", "нарушений зрения"],
}


# ---------- сеть ----------


def curl(args, attempts=4):
    """curl с сертификатом из bundle.pem. Пауза перед каждым запросом, при обрыве — повтор."""
    WORK.mkdir(parents=True, exist_ok=True)
    jar = str(WORK / "cookies.txt")
    last = ""
    for attempt in range(attempts):
        time.sleep(1.2 if attempt == 0 else 10 * attempt)
        out = subprocess.run(
            ["curl", "-sS", "--fail", "-L", "-m", "180", "--cacert", str(CA), "-A", UA,
             "-c", jar, "-b", jar, *args],
            capture_output=True,
        )
        if out.returncode == 0:
            return out.stdout
        last = out.stderr.decode("utf-8", "replace").strip()[:200]
    raise RuntimeError(f"сайт не ответил: {last}")


_KEY = None


def security_key():
    global _KEY
    if _KEY is None:
        page = curl([BASE]).decode("utf-8", "replace")
        m = re.search(r"LIVESTREET_SECURITY_KEY\s*=\s*'([0-9a-f]+)'", page)
        if not m:
            raise RuntimeError("на главной странице банка нет ключа LIVESTREET_SECURITY_KEY")
        _KEY = m.group(1)
    return _KEY


def search(val="", type_="", signed="", max_pages=20):
    """Все документы, в названии которых есть val. signed — дата подписания ГГГГ-ММ-ДД."""
    found, page = [], 1
    signed = signed.replace("-", ".")
    while page <= max_pages:
        data = {"val": val, "type": type_, "activity": "", "date_publication_from": signed,
                "date_publication_to": signed, "page": str(page), "security_ls_key": security_key()}
        args = ["-H", "X-Requested-With: XMLHttpRequest", "-e", BASE]
        for k, v in data.items():
            args += ["--data-urlencode", f"{k}={v}"]
        raw = curl(args + [SEARCH])
        try:
            res = json.loads(raw)
        except json.JSONDecodeError:
            raise RuntimeError("поиск вернул не JSON")
        if not isinstance(res, dict) or res.get("bStateError"):
            raise RuntimeError(f"поиск отказал: {str(res)[:200]}")
        found += res.get("items") or []
        paging = res.get("paging") or {}
        if page >= int(paging.get("iCountPage") or 1):
            break
        page += 1
    return found


def ru_date(text):
    """«20 июня 2018» -> 2018-06-20."""
    m = re.search(r"(\d{1,2})\s+([а-я]+)\s+(\d{4})", text or "")
    if not m or m.group(2) not in MONTHS:
        return ""
    return f"{m.group(3)}-{MONTHS.index(m.group(2)) + 1:02d}-{int(m.group(1)):02d}"


def card(url):
    """Карточка документа: название, поля и файлы."""
    page = curl([url]).decode("utf-8", "replace")
    i = page.find('class="layout-document"')
    if i < 0:
        raise RuntimeError(f"{url}: не похоже на карточку документа")
    j = page.find("section__social-links", i)
    part = page[i:j if j > 0 else len(page)]
    title = squeeze(html.unescape(re.sub(r"<[^>]+>", "", re.search(r"<h1>(.*?)</h1>", part, re.S).group(1))))
    fields = {}
    for li in re.findall(r"<li>(.*?)</li>", part, re.S):
        k, _, v = squeeze(html.unescape(re.sub(r"<[^>]+>", "", li))).partition(":")
        fields[k.strip()] = v.strip()
    files = []
    for m in re.finditer(
        r'fft-([a-z]+)[^"]*".*?filesize">([^<]*)<.*?<a href="([^"]+/download/\d+/)"[^>]*>(.*?)</a>', part, re.S
    ):
        files.append({"kind": m.group(1), "size": m.group(2).strip(), "url": m.group(3),
                      "name": squeeze(html.unescape(re.sub(r"<[^>]+>", "", m.group(4))))})
    return {"url": url, "title": title, "number": fields.get("Номер документа", ""),
            "signed": ru_date(fields.get("Принят", "")), "published": ru_date(fields.get("Опубликован", "")),
            "files": files}


def download(url):
    folder = WORK / "files" / re.sub(r"[^0-9a-z]+", "-", urllib.parse.urlparse(url).path).strip("-")
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / "file.bin"
    if not dest.exists() or dest.stat().st_size == 0:
        dest.write_bytes(curl([url]))
    return dest


# ---------- извлечение текста ----------


def file_kind(path):
    head = path.read_bytes()[:8]
    if head.startswith(b"%PDF"):
        return "pdf"
    if head.startswith(b"PK"):
        names = zipfile.ZipFile(path).namelist()
        if "word/document.xml" in names:
            return "docx"
        if "content.xml" in names:
            return "odt"
        return "zip"
    if head.startswith(b"\xd0\xcf\x11\xe0"):
        return "doc"
    return "unknown"


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def safe_xml(data):
    """Разбор XML из скачанного файла. DTD и сущности в DOCX/ODT не нужны: такой файл отвергаем."""
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise ValueError("XML файла содержит DTD или сущности: не разбираем")
    return ET.fromstring(data)


def docx_paragraphs(path):
    """Абзацы DOCX по порядку; строка таблицы — один абзац с ячейками через « | »."""
    root = safe_xml(zipfile.ZipFile(path).read("word/document.xml"))

    def ptext(p):
        out = []
        for el in p.iter():
            if el.tag == W + "t":
                out.append(el.text or "")
            elif el.tag in (W + "tab", W + "br", W + "cr"):
                out.append(" ")
        return squeeze("".join(out))

    paras = []
    for block in root.find(W + "body"):
        if block.tag == W + "p":
            paras.append(ptext(block))
        elif block.tag == W + "tbl":
            for row in block.iter(W + "tr"):
                cells = [" ".join(ptext(p) for p in tc.iter(W + "p")).strip() for tc in row.findall(W + "tc")]
                if any(cells):
                    paras.append(" | ".join(cells))
    return [p for p in paras if p]


def odt_paragraphs(path):
    root = safe_xml(zipfile.ZipFile(path).read("content.xml"))
    t = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
    tbl = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
    paras = []

    def walk(el):
        for ch in el:
            if ch.tag in (t + "p", t + "h"):
                paras.append(squeeze("".join(ch.itertext())))
            elif ch.tag == tbl + "table-row":
                cells = [squeeze("".join(c.itertext())) for c in ch if c.tag == tbl + "table-cell"]
                if any(cells):
                    paras.append(" | ".join(cells))
            else:
                walk(ch)

    walk(root)
    return [p for p in paras if p]


LIST_START = re.compile(r"^(\d{1,3}(\.\d{1,3})*\.?\)?|[а-я]\)|[IVXLC]+\.|[-–—•])\s")


def pdf_paragraphs(path):
    """Абзацы PDF с текстовым слоем. Строки собираются по координатам слов (pdfplumber),
    абзац начинается с красной строки, после короткой строки, после пропуска по вертикали
    или с маркера списка. Номера страниц отбрасываются, таблицы — построчно через « | »."""
    import pdfplumber

    paras, cur = [], []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            tables = page.find_tables()
            boxes = [t.bbox for t in tables]
            words = [w for w in page.extract_words(x_tolerance=1.5, y_tolerance=3)
                     if not any(b[0] - 1 <= w["x0"] and w["x1"] <= b[2] + 1 and b[1] - 1 <= w["top"] and w["bottom"] <= b[3] + 1 for b in boxes)]
            lines = []
            for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
                if lines and abs(lines[-1]["top"] - w["top"]) <= 3:
                    ln = lines[-1]
                    ln["words"].append(w)
                    ln["x1"] = max(ln["x1"], w["x1"])
                    ln["bottom"] = max(ln["bottom"], w["bottom"])
                else:
                    lines.append({"top": w["top"], "bottom": w["bottom"], "x0": w["x0"], "x1": w["x1"], "words": [w]})
            for ln in lines:
                ln["words"].sort(key=lambda w: w["x0"])
                ln["x0"] = ln["words"][0]["x0"]
                ln["text"] = " ".join(w["text"] for w in ln["words"])
            # номер страницы — одинокое число у верхнего или нижнего края
            lines = [ln for ln in lines if not (re.fullmatch(r"\d{1,3}", ln["text"])
                                                and (ln["top"] < 80 or ln["bottom"] > page.height - 60))]
            items = [("line", ln["top"], ln) for ln in lines] + [("table", t.bbox[1], t) for t in tables]
            if not lines and not tables:
                continue
            left = min((ln["x0"] for ln in lines), default=0)
            right = max((ln["x1"] for ln in lines), default=page.width)
            heights = sorted(ln["bottom"] - ln["top"] for ln in lines) or [12]
            lh = heights[len(heights) // 2]
            prev = None
            for kind, _, obj in sorted(items, key=lambda x: x[1]):
                if kind == "table":
                    if cur:
                        paras.append(" ".join(cur))
                        cur = []
                    for row in obj.extract():
                        # пустые ячейки — следы объединённых клеток, их не показываем
                        cells = [squeeze(c or "") for c in row if squeeze(c or "")]
                        if cells:
                            paras.append(" | ".join(cells))
                    prev = None
                    continue
                ln = obj
                centered = (ln["x0"] - left > 8 and right - ln["x1"] > 8
                            and abs((ln["x0"] - left) - (right - ln["x1"])) < 15)
                if (centered and prev is not None and prev.get("centered") and cur
                        and ln["top"] - prev["bottom"] <= 1.2 * lh):
                    cur.append(ln["text"])  # заголовок по центру в несколько строк
                    ln["centered"] = True
                    prev = ln
                    continue
                ln["centered"] = centered
                new = (
                    not cur
                    or ln["x0"] - left > 15  # красная строка
                    or LIST_START.match(ln["text"])
                    or (prev is not None and ln["top"] - prev["bottom"] > 1.2 * lh)
                    or (prev is not None and right - prev["x1"] > 60)  # предыдущая строка короткая
                )
                if new and cur:
                    paras.append(" ".join(cur))
                    cur = []
                if cur and cur[-1].endswith("-") and re.match(r"[а-яё]", ln["text"]):
                    cur[-1] += ln["text"]  # перенос по слогам или дефис: склеиваем без пробела, дефис оставляем
                else:
                    cur.append(ln["text"])
                prev = ln
    if cur:
        paras.append(" ".join(cur))
    return [squeeze(p) for p in paras if squeeze(p)]


def text_layer_chars(path):
    out = subprocess.run(["pdftotext", "-q", str(path), "-"], capture_output=True)
    pages = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True).stdout
    m = re.search(r"Pages:\s+(\d+)", pages)
    return len(out.stdout.decode("utf-8", "replace").strip()), int(m.group(1)) if m else 1


def extract(path):
    """(абзацы, вид файла) или исключение с понятной причиной."""
    kind = file_kind(path)
    if kind == "pdf":
        chars, pages = text_layer_chars(path)
        if chars < 200 * pages:
            raise ValueError(f"скан без текстового слоя ({pages} стр., {chars} знаков текста)")
        return pdf_paragraphs(path), kind
    if kind == "docx":
        return docx_paragraphs(path), kind
    if kind == "odt":
        return odt_paragraphs(path), kind
    raise ValueError(f"формат {kind} не разбирается")


def looks_garbled(paras):
    """Каша: мало кириллицы или много «абзацев» из одного-двух слов."""
    text = " ".join(paras)
    letters = re.findall(r"[A-Za-zА-Яа-яЁё]", text)
    cyr = re.findall(r"[А-Яа-яЁё]", text)
    if not letters or len(cyr) / len(letters) < 0.8:
        return "в тексте мало кириллицы"
    short = sum(1 for p in paras if len(p.split()) <= 2 and not LIST_START.match(p))
    if paras and short / len(paras) > 0.25:
        return f"много обрывков: {short} из {len(paras)} абзацев в 1–2 слова"
    return ""


# ---------- сверка с реестром ----------


def norm(s):
    s = (s or "").lower().replace("\xa0", " ").replace("ё", "е")
    s = re.sub(r"[‐-―−]", "-", s)
    return re.sub(r"\s+", "", s)


def number_core(number):
    return norm(re.sub(r"^\s*(N|№)\s*", "", number or ""))


def date_forms(iso):
    y, m, d = iso.split("-")
    return [f"{d}.{m}.{y}", f"{int(d)}.{m}.{y}", f"{d}{MONTHS[int(m) - 1]}{y}", f"{int(d)}{MONTHS[int(m) - 1]}{y}"]


def confirmed(entry, info, paras):
    """Какие реквизиты подтверждены источником: поле карточки или текст файла."""
    num, date = number_core(entry.get("number")), entry.get("date", "")
    text = norm(" ".join(paras[:60]) + " " + info["title"])  # реквизиты письма — в его начале
    got = {
        "number": bool(num) and (num == norm(info["number"]) or num in text),
        "date": bool(date) and (date == info["signed"] or any(norm(f) in text for f in date_forms(date))),
        "organ": any(o in text for o in ("минпросвещения", "министерствопросвещения", "минобрнауки",
                                         "министерствообразованияинауки")),
    }
    return got


def title_score(a, b):
    stems = lambda s: {w[:6] for w in re.findall(r"[а-яё]{5,}", s.lower())}
    sa, sb = stems(a), stems(b)
    return len(sa & sb) / len(sa) if sa else 0


def candidates(entry):
    """Документы банка, похожие на письмо из реестра: по номеру, дате подписания и словам названия."""
    queries = []
    num = re.sub(r"^\s*(N|№)\s*", "", entry.get("number") or "").replace(" ", "")
    if num:
        queries.append(("номер", num, ""))
        tail = num.split("-", 1)[-1]
        if tail != num and len(tail) >= 4:
            queries.append(("номер", tail, ""))
    if entry.get("date"):
        queries.append(("дата", "", entry["date"]))
    for q in TOPICS.get(entry["id"], []):
        queries.append(("название", q, ""))
    seen = {}
    for how, val, signed in queries:
        for item in search(val, signed=signed):
            title = squeeze(html.unescape(item.get("title", "")))
            score = title_score(entry["title"], title)
            has_num = bool(num) and norm(num) in norm(title)
            pub = ru_date(item.get("date_publication", ""))
            if entry.get("date") and pub and pub < entry["date"]:
                continue  # опубликован раньше, чем подписано письмо
            # по дате подписания находится всё, что подписано в тот день: нужно ещё похожее название
            if has_num or (how == "дата" and score >= 0.3) or score >= 0.5:
                old = seen.get(item["url"])
                if not old or score > old["score"]:
                    seen[item["url"]] = {"url": item["url"], "title": title, "published": pub,
                                         "score": round(score, 2), "how": how, "has_num": has_num}
    return sorted(seen.values(), key=lambda c: (not c["has_num"], -c["score"]))


# ---------- разделы ----------

APPENDIX = re.compile(r"^(ПРИЛОЖЕНИЕ|Приложение)(\s*(№|N)?\s*\d+)?(\s|$)")
SIGN = re.compile(r"^(Заместитель Министра|Министр|Первый заместитель|Статс-секретарь|Директор Департамента|"
                  r"Руководитель|Врио|И\.\s?о\.)")
ROMAN = re.compile(r"^([IVXLC]+)\.\s+(.{3,160})$")
TOP = re.compile(r"^(\d{1,3})\.\s+(.*)$")
SUB = re.compile(r"^(\d{1,3})\.(\d{1,3})\.?\s+")


def _is_heading(text):
    return len(text) < 150 and not re.search(r"[.;:,]$", text)


def body_sections(paras, prefix, context_base):
    """Нумерованные пункты: «1.» — пункт; если «1.» — короткий заголовок, пунктами считаются «1.1.»."""
    tops = [TOP.match(p) for p in paras]
    head_like = [m for m in tops if m and _is_heading(m.group(2))]
    by_sub = len(head_like) >= 2 and len(head_like) >= len([m for m in tops if m]) / 2
    sections, intro, current, ctx = [], [], None, context_base
    for p in paras:
        r, t, s = ROMAN.match(p), TOP.match(p), SUB.match(p)
        if r and _is_heading(r.group(2)):
            ctx = " / ".join(x for x in (context_base, p) if x)
            current = None
            continue
        if by_sub and t and _is_heading(t.group(2)):
            ctx = " / ".join(x for x in (context_base, p) if x)
            current = None
            continue
        key = None
        if by_sub and s:
            key = (f"{prefix}p-{s.group(1)}-{s.group(2)}", f"Пункт {s.group(1)}.{s.group(2)}")
        elif not by_sub and t:
            key = (f"{prefix}p-{t.group(1)}", f"Пункт {t.group(1)}")
        if key and key[0] not in {x[0] for x in sections}:
            current = [key[0], key[1], [p], ctx]
            sections.append(current)
        elif current is not None:
            current[2].append(p)
        elif sections:
            sections[-1][2].append(p)  # абзац после заголовка раздела до первого пункта
        else:
            intro.append(p)
    return intro, sections


def letter_sections(paras):
    """Письмо: вводная часть (реквизиты, текст), подпись, приложения pril-K с пунктами pril-K-p-N."""
    starts = [i for i, p in enumerate(paras) if APPENDIX.match(p) and len(p) < 120]
    letter, apps = (paras[:starts[0]], []) if starts else (paras, [])
    for n, s in enumerate(starts):
        apps.append(paras[s:starts[n + 1] if n + 1 < len(starts) else len(paras)])
    sign_at = next((i for i, p in enumerate(letter) if SIGN.match(p)), None)
    body, sign = (letter[:sign_at], letter[sign_at:]) if sign_at is not None else (letter, [])
    intro, points = body_sections(body, "", "")
    sections = []
    if intro:
        sections.append(["preambula", "Вводная часть" if points else "Текст письма", intro, ""])
    sections += points
    if sign:
        sections.append(["podpis", "Подпись", sign, ""])
    for k, app in enumerate(apps, 1):
        # заголовок приложения — строки до первого пункта или раздела
        head = []
        for p in app:
            if ROMAN.match(p) or TOP.match(p) or SUB.match(p) or len(head) >= 6:
                break
            head.append(p)
        title = next((p for p in head[1:] if not re.match(r"^(к письму|УТВЕРЖДЕН|от\s|№)", p, re.I)), head[0])
        title = title if len(title) <= 200 else title[:200].rsplit(" ", 1)[0] + "…"
        a_intro, a_points = body_sections(app[len(head):], f"pril-{k}-", "")
        sections.append([f"pril-{k}", f"Приложение {k}. {title}" if len(apps) > 1 else f"Приложение. {title}",
                         head + a_intro, ""])
        sections += a_points
    return sections


# ---------- реестр и запись ----------


def registry():
    return yaml.safe_load((ROOT / "registry.yaml").read_text(encoding="utf-8"))["docs"]


def fetch(entry, url=None, out=ROOT, dry=False):
    """(статус, пояснение). В корпус пишет только при подтверждённых номере и дате."""
    cands = [{"url": url, "title": "", "score": 1, "how": "адрес"}] if url else candidates(entry)
    if not cands:
        return "not-found", "в банке документов нет документа с таким номером, датой или названием"
    notes = []
    want = number_core(entry.get("number"))
    for c in cands[:5]:
        info = card(c["url"])
        if want and info["number"] and number_core(info["number"]) != want:
            notes.append(f"{c['url']}: в карточке другой номер ({info['number']})")
            continue
        if not info["files"]:
            notes.append(f"{c['url']}: у карточки нет файлов")
            continue
        for f in info["files"]:
            path = download(f["url"])
            try:
                paras, kind = extract(path)
            except ValueError as e:
                notes.append(f"{f['url']}: {e}")
                continue
            got = confirmed(entry, info, paras)
            bad = looks_garbled(paras)
            if bad:
                notes.append(f"{f['url']}: текст извлёкся плохо — {bad}")
                continue
            if not dry and not (got["number"] and got["date"] and got["organ"]):
                miss = ", ".join(k for k, v in got.items() if not v)
                notes.append(f"{f['url']} («{info['title'][:80]}»): не подтверждено источником: {miss}")
                continue
            sections = letter_sections(paras)
            size = text_size(sections)
            if not dry and (len(sections) < 3 or size < 2000):
                notes.append(f"{f['url']}: разделов {len(sections)}, знаков {size} — меньше порога корпуса")
                continue
            meta = {
                "id": entry["id"],
                "title": info["title"],
                "kind": entry["kind"],
                "number": re.sub(r"^\s*(N|№)\s*", "", entry.get("number") or "").strip(),
                "date": entry.get("date"),
                "edition": entry.get("date"),
                "edition_status": "original",
                "source_url": f["url"],
                "fetched": FETCHED,
                "modules": entry["modules"],
                "text": "full",
                "note": f"Текст файла {kind.upper()} из банка документов Минпросвещения России (карточка {info['url']}).",
                "list_no": entry.get("list_no"),
            }
            target = WORK / "dry" if dry else out
            write_doc(meta, sections, target)
            flag = "" if all(got.values()) else " (НЕ подтверждено: " + ", ".join(k for k, v in got.items() if not v) + ")"
            return ("dry" if dry else "ok"), f"{info['title'][:90]}; {kind}; разделов {len(sections)}; {size // 1000} тыс. знаков{flag}; {target}/{entry['id']}"
    if all("другой номер" in n for n in notes):
        return "not-found", "похожие по названию или дате документы банка имеют другие номера: " + " | ".join(notes)[:600]
    return "unverified", " | ".join(notes)[:900]


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("val")
    s.add_argument("--type", default="")
    s.add_argument("--signed", default="")
    c = sub.add_parser("show")
    c.add_argument("url")
    f = sub.add_parser("fetch")
    f.add_argument("id")
    f.add_argument("--url", default="")
    f.add_argument("--out", default=str(ROOT))
    f.add_argument("--dry", action="store_true")
    a = sub.add_parser("auto")
    a.add_argument("--ids", default="")
    a.add_argument("--report", default="")
    a.add_argument("--out", default=str(ROOT))
    a.add_argument("--dry", action="store_true")
    a.add_argument("--force", action="store_true", help="перекачать уже собранные")
    args = ap.parse_args()

    if args.cmd == "search":
        for it in search(args.val, args.type, args.signed):
            print(it["date_publication"], "|", it["type"]["title"], "|", squeeze(it["title"])[:140], "|", it["url"])
        return 0
    if args.cmd == "show":
        print(json.dumps(card(args.url), ensure_ascii=False, indent=1))
        return 0

    entries = registry()
    if args.cmd == "fetch":
        entry = next((e for e in entries if e["id"] == args.id), None)
        if not entry:
            print("нет такого id в реестре", file=sys.stderr)
            return 1
        print(*fetch(entry, args.url or None, args.out, args.dry))
        return 0

    only = set(filter(None, args.ids.split(",")))
    results = []
    for entry in entries:
        if entry["kind"] != "letter" or (only and entry["id"] not in only):
            continue
        if (pathlib.Path(args.out) / entry["id"] / "meta.yaml").exists() and not args.force and not args.dry:
            continue
        try:
            status, info = fetch(entry, None, args.out, args.dry)
        except Exception as e:  # сеть, неожиданный ответ: записываем и идём дальше
            status, info = "error", str(e)[:300]
        results.append({"id": entry["id"], "list_no": entry.get("list_no"), "status": status, "info": info})
        print(f"{entry['id']:30} {status:10} {info[:400]}", flush=True)
    if args.report:
        pathlib.Path(args.report).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
