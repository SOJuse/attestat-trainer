#!/usr/bin/env python3
"""Тексты актов в редакции официального опубликования с publication.pravo.gov.ru.

Портал официального опубликования отвечает по открытому API (описание методов —
http://publication.pravo.gov.ru/swagger/v1/swagger.json). Скрипт использует:
  api/Documents       поиск: Number, DocumentDate с DocumentDateSearchType=1 (точная дата),
                      Name (подстрока названия), PageSize, Index
  api/DocumentText    true, если у документа есть текст на actual.pravo.gov.ru
                      (только для отчёта: текст оттуда скрипт не берёт)
  file/pdf?eoNumber=  PDF опубликования по номеру опубликования (eoNumber)
Адрес документа на портале: http://publication.pravo.gov.ru/document/<eoNumber>.

Текст берётся только из текстового слоя PDF (pdftotext -layout). PDF-скан без
текстового слоя не распознаётся: такой документ не записывается, а попадает в отчёт.
Для постановлений Правительства РФ при скане текст берётся со страницы акта
на government.ru (поиск government.ru/docs/all/?number=N).

Команды (запуск из корня репозитория):
  pub.py search <номер> <ГГГГ-ММ-ДД>                 что находится на портале
  pub.py fetch <doc-id>                              скачать один документ из реестра
  pub.py auto [--only kind,kind] [--ids a,b] [--limit N] [--report файл]

Между запросами пауза больше секунды; при обрыве соединения запрос повторяется.
"""
import argparse
import datetime
import html as htmllib
import json
import pathlib
import re
import subprocess
import sys
import time

import yaml

from ocr import ocr_pages
from pub_text import html_paragraphs, pdf_paragraphs, squeeze, to_markdown, to_sections

BASE = "http://publication.pravo.gov.ru/"
GOV = "http://government.ru/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
ROOT = pathlib.Path("content/docs")
CACHE = pathlib.Path("/tmp/claude-501/pub/pdf")
PAUSE = 1.2
OCR = False  # включается флагом --ocr: распознавать сканы
OCR_MAX_PAGES = 250  # длиннее — не распознаём (санитарные правила на тысячу страниц)
OCR_NOTE = (
    "Текст распознан со скана официального опубликования (publication.pravo.gov.ru). "
    "В нём возможны ошибки распознавания, особенно в числах: цитату сверяйте со сканом по ссылке на источник. "
    "Позднейшие изменения в текст не внесены."
)
MAX_FULL_PDF = 40_000_000  # больше — смотрим только начало файла: есть ли в нём шрифты
PROBE_BYTES = 4_000_000
NOTE = "Текст официального опубликования. Позднейшие изменения в него не внесены."
MONTHS = "января февраля марта апреля мая июня июля августа сентября октября ноября декабря".split()

# ---------- сеть ----------


def curl(url, params=None, dest=None, attempts=6, timeout=300):
    """GET с паузой перед запросом и повтором при обрыве. Возвращает bytes (или путь, если dest)."""
    args = ["curl", "-sS", "--fail", "-m", str(timeout), "-A", UA]
    if params:
        args.append("-G")
        for k, v in params.items():
            args += ["--data-urlencode", f"{k}={v}"]
    if dest:
        args += ["-o", str(dest)]
    last = ""
    for attempt in range(attempts):
        time.sleep(PAUSE if attempt == 0 else 10 * attempt)
        out = subprocess.run(args + [url], capture_output=True)
        if out.returncode == 0:
            return dest if dest else out.stdout
        last = out.stderr.decode("utf-8", "replace").strip()[:200]
    raise RuntimeError(f"{url}: {last}")


def head(url, nbytes):
    """Первые nbytes ответа (портал не поддерживает Range, поэтому читаем поток и обрываем)."""
    time.sleep(PAUSE)
    proc = subprocess.Popen(["curl", "-sS", "--fail", "-m", "300", "-A", UA, url], stdout=subprocess.PIPE)
    data = proc.stdout.read(nbytes)
    proc.kill()
    proc.wait()
    return data


def api(path, params):
    for attempt in range(3):
        raw = curl(BASE + path, params)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            time.sleep(10)
    raise RuntimeError(f"{path}: ответ не похож на JSON")


# ---------- поиск ----------


def portal_number(number):
    """«N 845, 369» → «845/369», «N232/551» → «232/551»."""
    n = re.sub(r"^\s*(N|№)\s*", "", number or "").strip()
    return re.sub(r"\s*,\s*", "/", n)


def norm_number(number):
    return portal_number(number).lower().replace(" ", "")


def ddmmyyyy(iso):
    y, m, d = iso.split("-")
    return f"{d}.{m}.{y}"


def search(number, date):
    """Документы портала с этим номером, подписанные в этот день.

    NumberSearchType: 0 — номер целиком, 1 — начинается с, 2 — содержит, 3 — кончается на.
    Ищем «содержит»: у совместного приказа на портале номер вида «89/208», а в списке
    литературы бывает только один из двух номеров. Такие находки помечаются partial=True.
    """
    found = api(
        "api/Documents",
        {
            "Number": portal_number(number),
            "NumberSearchType": 2,
            "DocumentDateSearchType": 1,
            "DocumentDate": ddmmyyyy(date),
            "PageSize": 200,
            "Index": 1,
        },
    ).get("items") or []
    want = norm_number(number)
    out = []
    for d in found:
        if (d.get("documentDate") or "")[:10] != date:
            continue
        got = norm_number(d.get("number"))
        if got == want or want in got.split("/"):
            out.append(dict(d, partial=got != want))
    return out


EDU = [
    "Министерства просвещения Российской Федерации",
    "Министерства образования и науки Российской Федерации",
    "Министерства науки и высшего образования Российской Федерации",
    "Федеральной службы по надзору в сфере образования и науки",
]
LABOUR = [
    "Министерства труда и социальной защиты Российской Федерации",
    "Министерства здравоохранения и социального развития Российской Федерации",
    "Министерства экономического развития Российской Федерации",
    "Федеральной службы по труду и занятости",
    "Государственного комитета Российской Федерации по строительству",
]
HEALTH = [
    "Министерства здравоохранения Российской Федерации",
    "Министерства здравоохранения и социального развития Российской Федерации",
]


def expected_organs(entry):
    """(начало номера опубликования, органы, один из которых должен стоять в названии акта на портале)."""
    kind, title = entry["kind"], entry["title"]
    # «Приказ Департамента здравоохранения г. Москвы "Об утверждении …"»: орган назван до кавычек
    if kind == "moscow" or (kind == "ministry" and "Москв" in re.split(r"[\"«“]", title)[0]):
        return "77", ["Правительства Москвы", "Департамента здравоохранения города Москвы", "Мэра Москвы"]
    if kind == "sanpin":
        return "0001", ["Главного государственного санитарного врача Российской Федерации"]
    if kind == "government":
        return "0001", ["Правительства Российской Федерации"]
    if kind == "federal-law":
        return "0001", ["Закон Российской Федерации", "Федеральный закон"]
    if kind == "court":
        return "0001", ["Верховного Суда Российской Федерации"]
    # раздел списка литературы орган не определяет (ФГОС из приказа Минпросвещения стоит
    # в разделе Минтруда), поэтому орган сверяем, только если он назван в самом названии
    named = [
        (r"Минпросвещени|Министерства просвещения", EDU[:1]),
        (r"Рособрнадзор", EDU[3:]),
        (r"Минздрав", HEALTH),
        (r"Минтруд|Митруд", LABOUR[:1]),
        (r"Роструд", LABOUR[3:4]),
        (r"Минэкономразвития", LABOUR[2:3]),
        (r"Госстро", LABOUR[4:]),
    ]
    organs = [o for pattern, group in named if re.search(pattern, title) for o in group]
    return "0001", organs or EDU + LABOUR + HEALTH


def stems(text):
    return {w[:6] for w in re.findall(r"[а-яё]{4,}", text.lower().replace("ё", "е"))}


def clean_title(title):
    """Название из списка литературы без пометок о редакции и без вида, органа и номера акта впереди."""
    t = re.sub(r"\(\s*(ред|с изм)[^)]*\)?", " ", title)
    t = re.sub(r"^(Приказ|Письмо|Постановление)[^\"«“]*?(?=[\"«“])", "", t.strip())
    return t


def title_similarity(registry_title, portal_name):
    want = stems(clean_title(registry_title))
    return len(want & stems(portal_name)) / len(want) if want else 0.0


def pick(entry, found):
    """Выбирает акт среди найденных: орган, номер и дата, название похоже. Возвращает (документ, пояснение)."""
    prefix, organs = expected_organs(entry)
    by_organ = [
        d
        for d in found
        if d["eoNumber"].startswith(prefix) and any(o.lower() in d["complexName"].lower() for o in organs)
    ]
    if not by_organ:
        others = "; ".join(d["complexName"].split("\n")[0][:90] for d in found)
        return None, "not-found", "нет акта нужного органа с таким номером и датой" + (f" (есть: {others})" if others else "")
    exact = [d for d in by_organ if not d.get("partial")]
    by_organ = exact or by_organ
    if len(by_organ) > 1:
        return None, "ambiguous", "; ".join(d["complexName"].split("\n")[0] for d in by_organ)[:300]
    doc = by_organ[0]
    sim = title_similarity(entry["title"], doc.get("name") or doc["complexName"])
    if sim < 0.6:
        return None, "mismatch", f"название не похоже ({sim:.0%}): {doc['complexName'][:200]}"
    return doc, "ok", f"{sim:.0%}"


# ---------- текст ----------


def pdf_text(doc):
    """('text', страницы) или (статус, пояснение)."""
    eo, size, pages = doc["eoNumber"], doc.get("pdfFileLength") or 0, doc.get("pagesCount") or 0
    url = f"{BASE}file/pdf?eoNumber={eo}"
    if size > MAX_FULL_PDF:
        start = head(url, PROBE_BYTES)
        if b"/Font" not in start and b"/ObjStm" not in start:
            return "scan", f"скан: PDF {size // 1_000_000} МБ, {pages} стр., в начале файла только изображения, шрифтов нет"
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{eo}.pdf"
    if not path.exists() or (size and path.stat().st_size != size):
        curl(url, dest=path, timeout=900)
    out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"], capture_output=True)
    text = out.stdout.decode("utf-8", "replace")
    page_texts = text.split("\f")
    if page_texts and not page_texts[-1].strip():
        page_texts = page_texts[:-1]
    letters = re.findall(r"[^\W\d_]", text)
    if len(letters) < 100 * max(1, pages) * 0.3:
        if OCR and pages <= OCR_MAX_PAGES:
            texts, total, doubtful = ocr_pages(path, eo, pages)
            low = sum(len(d) for d in doubtful)
            if total < 100 * pages * 0.3:
                return "scan", f"скан не распознался: {pages} стр., слов {total}"
            return "ocr", (texts, total, low)
        return "scan", f"скан без текстового слоя: {pages} стр., букв в текстовом слое {len(letters)}"
    cyr = sum(1 for ch in letters if "а" <= ch.lower() <= "я" or ch.lower() == "ё")
    if cyr / len(letters) < 0.7 or text.count("�") > 20:
        return "garbled", f"текстовый слой не читается: кириллицы {cyr / len(letters):.0%}"
    return "text", page_texts


def gov_doc(entry):
    """Страница постановления на government.ru: (адрес, тело документа в HTML) или None."""
    number = portal_number(entry["number"])
    want = f"от {ddmmyyyy(entry['date'])} г. № {number}"
    for page in range(1, 6):
        params = {"number": number} if page == 1 else {"number": number, "page": page}
        listing = curl(GOV + "docs/all/", params).decode("utf-8", "replace")
        for m in re.finditer(r'<a[^>]+href="(/docs/all/\d+/)"[^>]*>(.*?)</a>', listing, re.S):
            caption = squeeze(htmllib.unescape(re.sub(r"<[^>]+>", " ", m.group(2))))
            if caption == f"Постановление Правительства Российской Федерации {want}":
                url = GOV.rstrip("/") + m.group(1)
                page_html = curl(url).decode("utf-8", "replace")
                i = page_html.find('<div class="reader_article_body"><div>')
                j = page_html.find('<div class="print print_footer">', i)
                if i < 0 or j < 0:
                    return None
                return url, page_html[i:j]
        if f"page={page + 1}" not in listing:
            break
    return None


def fix_title(paras, name):
    """Название акта на government.ru бывает со слипшимися словами («начисляемогов случае»).

    Если без пробелов и кавычек оно совпадает с названием на портале опубликования,
    берём написание портала.
    """
    def bare(s):
        return re.sub(r"[\s\"«»“”]", "", s)

    out = []
    for kind, text in paras:
        if kind == "title" and bare(text) == bare(name):
            text = name.replace("«", '"').replace("»", '"')
        out.append((kind, text))
    return out


# ---------- изменения ----------


def date_words(iso):
    y, m, d = iso.split("-")
    return f"{int(d)} {MONTHS[int(m) - 1]} {y} г."


SHORT = {
    "Министерства просвещения Российской Федерации": "Минпросвещения России",
    "Министерства образования и науки Российской Федерации": "Минобрнауки России",
    "Министерства науки и высшего образования Российской Федерации": "Минобрнауки России",
    "Федеральной службы по надзору в сфере образования и науки": "Рособрнадзора",
    "Министерства труда и социальной защиты Российской Федерации": "Минтруда России",
    "Министерства здравоохранения Российской Федерации": "Минздрава России",
    "Министерства экономического развития Российской Федерации": "Минэкономразвития России",
    "Главного государственного санитарного врача Российской Федерации": "Главного государственного санитарного врача Российской Федерации",
    "Правительства Российской Федерации": "Правительства Российской Федерации",
}


def short_ref(complex_name):
    """«Приказ Министерства просвещения Российской Федерации от 01.02.2024 № 62 …» → «приказ Минпросвещения России от 01.02.2024 № 62»."""
    first = complex_name.split("\n")[0].strip()
    m = re.match(r"^(\S+)\s+(.+?)\s+от\s+(\d\d\.\d\d\.\d{4})\s+№\s+(\S+)", first)
    if not m:
        return first
    kind, organs, date, number = m.groups()
    parts = [SHORT.get(o.strip(), o.strip()) for o in organs.split(",")]
    return f"{kind.lower()} {' и '.join(parts)} от {date} № {number}"


def amendments(entry, doc, after):
    """Акты «О внесении изменений …», в названии которых упомянут этот акт (по дате и номеру), позже `after`."""
    number = doc["number"]
    phrases = [f"{date_words(entry['date'])} № {number}", f"{ddmmyyyy(entry['date'])} № {number}"]
    seen, out = set(), []
    for phrase in phrases:
        items = api("api/Documents", {"Name": phrase, "PageSize": 200, "Index": 1}).get("items") or []
        for d in items:
            name = d.get("complexName") or ""
            if d["eoNumber"] in seen or d["eoNumber"] == doc["eoNumber"]:
                continue
            if not d["eoNumber"].startswith(doc["eoNumber"][:4]) or "изменени" not in name.lower():
                continue
            if phrase not in re.sub(r"\s+", " ", name) or (d.get("documentDate") or "")[:10] <= after:
                continue
            seen.add(d["eoNumber"])
            out.append(((d.get("documentDate") or "")[:10], short_ref(name)))
    return [ref for _, ref in sorted(out)]


# ---------- реестр и запись ----------


def registry():
    return yaml.safe_load((ROOT / "registry.yaml").read_text(encoding="utf-8"))["docs"]


def doc_title(doc):
    name = (doc.get("name") or "").strip()
    if name.startswith("«") and name.endswith("»"):
        name = name[1:-1]
    return squeeze(name.replace("«", '"').replace("»", '"')) or doc["complexName"].split("\n")[0]


def has_text_elsewhere(doc):
    try:
        return curl(BASE + "api/DocumentText", {"eonumber": doc["eoNumber"]}).strip() == b"true"
    except RuntimeError:
        return None


def write(entry, meta, markdown):
    folder = ROOT / entry["id"]
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "text.md").write_text(markdown, encoding="utf-8")
    (folder / "meta.yaml").write_text(
        yaml.safe_dump(meta, allow_unicode=True, sort_keys=False, width=110), encoding="utf-8"
    )


def fetch(entry):
    """Возвращает (статус, пояснение). Пишет content/docs/<id>/ только при успехе."""
    if not entry.get("number") or not entry.get("date"):
        return "skip", "в реестре нет номера или даты"
    found = search(entry["number"], entry["date"])
    doc, status, why = pick(entry, found)
    if not doc:
        return status, why
    ref = f"{doc['eoNumber']} ({doc['pagesCount']} стр.)"
    if doc.get("partial"):
        ref += f", на портале № {doc['number']}"
    status, got = pdf_text(doc)
    source_url, edition, note, text_from = f"{BASE}document/{doc['eoNumber']}", entry["date"], NOTE, "pdf"
    ocr_stat = None
    if status == "text":
        paras = pdf_paragraphs(got)
    elif status == "ocr":
        texts, total, low = got
        paras = pdf_paragraphs(texts)
        ocr_stat = f"слов {total}, под сомнением {low} ({low / max(total, 1):.1%})"
        note, text_from = f"{OCR_NOTE} При распознавании: {ocr_stat}.", "ocr"
    elif entry["kind"] == "government":
        gov = gov_doc(entry)
        if not gov:
            return status, f"{ref}: {got}; на government.ru страницы акта нет"
        source_url, body = gov
        paras = fix_title(html_paragraphs(body), doc_title(doc))
        text_from = "gov"
        notes = re.findall(r"\(В редакции\s+Постановлени\w*\s+Правительства\s+Российской\s+Федерации\s+от\s+"
                           r"(\d\d)\.(\d\d)\.(\d{4})\s+№\s+(\S+?)\)", htmllib.unescape(re.sub(r"<[^>]+>", " ", body)))
        if notes:
            last = max(notes, key=lambda n: (n[2], n[1], n[0]))
            edition = f"{last[2]}-{last[1]}-{last[0]}"
            note = (
                f"Текст со страницы government.ru в редакции постановления Правительства Российской Федерации "
                f"от {last[0]}.{last[1]}.{last[2]} № {last[3]}; PDF официального опубликования "
                f"(publication.pravo.gov.ru, № {doc['eoNumber']}) — скан без текстового слоя."
            )
        else:
            note = (
                f"Текст официального опубликования (PDF № {doc['eoNumber']} на publication.pravo.gov.ru — скан) "
                "по странице government.ru; позднейшие изменения в него не внесены."
            )
    else:
        flag = has_text_elsewhere(doc)
        extra = "; у портала есть ссылка «Текст правового акта» на actual.pravo.gov.ru" if flag else ""
        return status, f"{ref}: {got}{extra}"

    sections = to_sections(paras)
    markdown, count = to_markdown(sections)
    # те же пороги, что у `npm run validate`: не меньше 3 разделов и 2000 знаков текста
    chars = sum(len("\n\n".join(body)) for _, _, body, _ in sections)
    if count < 3 or chars < 2000:
        return "too-short", f"{ref}; текст из {text_from}: разделов {count}, знаков {chars} (validate требует 3 и 2000)"

    title = doc_title(doc)
    if edition != entry["date"]:
        # текст в более поздней редакции: название берём из него же (его тоже могли изменить)
        title = next((t for k, t in paras if k == "title" and re.match(r"^Об?\s", t) and len(t) > 30), title)
    meta = {
        "id": entry["id"],
        "title": title,
        "kind": entry["kind"],
        "number": doc["number"],
        "date": entry["date"],
        "edition": edition,
        "source_url": source_url,
        "fetched": datetime.date.today().isoformat(),
        "modules": entry["modules"],
        "text": "ocr" if ocr_stat else "full",
    }
    if edition == entry["date"]:
        meta["edition_status"] = "original"
    searched = ""
    if entry.get("edition_in_list"):
        later = amendments(entry, doc, edition)
        searched = f"; изменения искал, найдено {len(later)}"
        if later:
            meta["amended_by"] = later
    meta["note"] = note
    if entry.get("list_no"):
        meta["list_no"] = entry["list_no"]
    write(entry, meta, markdown)
    return "ok", f"{ref}; текст из {text_from}; разделов {count}; {len(markdown) // 1000} тыс. знаков{searched}"


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("number")
    s.add_argument("date")
    f = sub.add_parser("fetch")
    f.add_argument("id")
    a = sub.add_parser("auto")
    a.add_argument("--only", default="", help="виды документов (kind), через запятую")
    a.add_argument("--ids", default="", help="только эти документы, через запятую")
    a.add_argument("--limit", type=int, default=0)
    a.add_argument("--report", default="")
    for cmd in (f, a):
        cmd.add_argument("--ocr", action="store_true", help="распознавать сканы без текстового слоя")
    args = ap.parse_args()

    global OCR
    OCR = bool(getattr(args, "ocr", False))

    if args.cmd == "search":
        for d in search(args.number, args.date):
            print(d["eoNumber"], "|", d["complexName"].split("\n")[0], "|", d["pagesCount"], "стр.")
        return 0

    entries = registry()
    if args.cmd == "fetch":
        entry = next((e for e in entries if e["id"] == args.id), None)
        if not entry:
            print("нет такого id в реестре", file=sys.stderr)
            return 1
        print(*fetch(entry))
        return 0

    kinds = set(filter(None, args.only.split(",")))
    only_ids = set(filter(None, args.ids.split(",")))
    results, done = [], 0
    for entry in entries:
        if kinds and entry["kind"] not in kinds:
            continue
        if only_ids and entry["id"] not in only_ids:
            continue
        if (ROOT / entry["id"] / "meta.yaml").exists():
            continue
        if args.limit and done >= args.limit:
            break
        try:
            status, info = fetch(entry)
        except Exception as e:  # сеть, неожиданный ответ: записываем и идём дальше
            status, info = "error", str(e)[:200]
        done += 1
        results.append({"id": entry["id"], "list_no": entry.get("list_no"), "status": status, "info": info})
        print(f"{entry['id']:28} {status:10} {info[:150]}", flush=True)
    if args.report:
        pathlib.Path(args.report).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
