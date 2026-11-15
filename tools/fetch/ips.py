#!/usr/bin/env python3
"""Тексты актов в действующей редакции с официального портала actual.pravo.gov.ru.

Портал — интерфейс системы «Законодательство России». Скрипт обращается к тем же
адресам, что и страница портала в браузере:
  attrsearch  — поиск акта по номеру и дате подписания;
  redactions  — список редакций, среди них одна помечена как актуальная;
  redtext     — текст выбранной редакции в HTML.

Команды (запуск из корня репозитория):
  ips.py search <номер> <ГГГГ-ММ-ДД>          показать, что находится
  ips.py fetch <doc-id>                        скачать один документ из реестра
  ips.py auto [--only kind,kind] [--limit N]   пройти по реестру и скачать всё, что находится

Между запросами пауза в секунду. Текст в text.md — только то, что отдал портал.
"""
import argparse
import datetime
import html
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.parse

import yaml

API = "http://actual.pravo.gov.ru:8000/api/ebpi/"
PAGE = "http://actual.pravo.gov.ru/text.html#hash="
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
ROOT = pathlib.Path("content/docs")
ACTUAL_START = ""  # без нижней границы: с датой портал прячет акты, которые давно не менялись
TTL = 3


def api(path):
    time.sleep(1)
    out = subprocess.run(
        ["curl", "-sS", "--fail", "-m", "180", "-A", UA, API + path], capture_output=True, text=True
    )
    if out.returncode != 0:
        raise RuntimeError(f"портал не ответил: {out.stderr.strip()[:200]}")
    return json.loads(out.stdout)


def q(obj):
    return urllib.parse.quote(json.dumps(obj, ensure_ascii=False))


def norm_number(number):
    return re.sub(r"^\s*(N|№)\s*", "", number or "").strip().lower().replace(" ", "")


def search(number, date):
    """Акты с таким номером, подписанные в этот день."""
    ymd = date.replace("-", "")
    cond = [
        {"AttrId": 6, "AttrMode": 0, "Words": [re.sub(r"^\s*(N|№)\s*", "", number).strip()]},
        {"AttrId": 5, "DateFrom": ymd, "DateTo": ymd},
        # последний ноль: без ограничения по виду акта (с единицей портал ищет только законы и указы)
        {"AttrId": 999, "AttrMode": 1, "Words": [20, "-date", ACTUAL_START, 0, 0]},
    ]
    found = api("attrsearch/?bpa=ebpi&q=" + q(cond)).get("docs") or []
    want = norm_number(number)
    return [d for d in found if norm_number(d.get("docpass0number")) == want and d.get("docpass0date") == ymd]


def actual_redaction(dochash):
    # ttl=3 — режим «все редакции»: в нём портал отдаёт текст и для актов, у которых
    # сводная редакция помечена как ознакомительная (постановления, приказы)
    reds = api("redactions/?bpa=ebpi&t=" + q({"hash": dochash, "ttl": TTL})).get("redactions") or []
    for r in reds:
        if r.get("actual"):
            return r
    # у акта без изменений пометки «актуальная» нет: берём последнюю уже вступившую редакцию с текстом
    today = datetime.date.today().strftime("%Y%m%d")
    in_force = [r for r in reds if r.get("hascontent") and r.get("reddate", "9") <= today]
    return max(in_force, key=lambda r: r["reddate"]) if in_force else None


# ---------- HTML → text.md ----------

TAG = re.compile(r"<[^>]+>")
PARA = re.compile(r"<p\b([^>]*)>(.*?)</p>", re.S)
ARTICLE = re.compile(r"^Статья\s+(\d+(?:[.\-]\d+)*)\.?(?:\s|$)")
POINT = re.compile(r"^(\d{1,3})\.\s+\S")
ANNEX = re.compile(r"^(ПРИЛОЖЕНИЕ|Приложение|УТВЕРЖД[ЕЁ]Н[АОЫ]?)\b")


SUP = re.compile(r"<sup\b[^>]*>\s*([\d\-]+)\s*</sup>", re.I)


def clean(fragment):
    # надстрочный номер («Статья 11¹», «пункт 2¹») в официальных текстах означает 11.1 и 2.1
    fragment = SUP.sub(r".\1", fragment)
    text = html.unescape(TAG.sub("", fragment)).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def paragraphs(doc_html):
    body = doc_html.split("<body", 1)[-1]
    out = []
    for attrs, inner in PARA.findall(body):
        text = clean(inner)
        if text:
            is_heading = bool(re.search(r'class="[^"]*\bH\b', attrs))
            out.append((is_heading, text))
    return out


def anchor_num(num):
    return re.sub(r"[.\-]+", "-", num).strip("-")


def to_sections(paras):
    """Список (якорь, заголовок, [абзацы]). Режим выбирается по строению документа."""
    articles = sum(1 for _, t in paras if ARTICLE.match(t))
    sections, used = [], {}

    def add(anchor, heading):
        n = used.get(anchor, 0) + 1
        used[anchor] = n
        if n > 1:
            anchor = f"{anchor}-dup{n}"
        sections.append([anchor, heading, []])

    if articles >= 3:
        # Названия разделов и глав ждут в `carry` и встают первой строкой следующей статьи.
        carry = []
        for is_heading, text in paras:
            m = ARTICLE.match(text)
            if m and (is_heading or len(text) < 300):
                add("st-" + anchor_num(m.group(1)), text)
                sections[-1][2].extend(carry)
                carry = []
            elif is_heading:
                carry.append(text)
            else:
                if not sections:
                    add("preambula", "Вводная часть")
                sections[-1][2].extend(carry)
                carry = []
                sections[-1][2].append(text)
        return sections

    annex, last_point = 0, 0
    add("preambula", "Вводная часть")
    for is_heading, text in paras:
        if ANNEX.match(text) and len(text) < 200:
            annex += 1
            last_point = 0
            add(f"pril-{annex}", text)
            continue
        m = POINT.match(text)
        if m and int(m.group(1)) == last_point + 1:
            last_point += 1
            prefix = f"pril-{annex}-p-" if annex else "p-"
            where = f" приложения {annex}" if annex else ""
            add(prefix + str(last_point), f"Пункт {last_point}{where}")
        sections[-1][2].append(text)
    return sections


def to_markdown(doc_html):
    sections = [s for s in to_sections(paragraphs(doc_html)) if s[2]]
    lines = []
    for anchor, heading, body in sections:
        lines.append(f"## {{#{anchor}}} {heading}")
        lines.append("")
        for p in body:
            # строка, начинающаяся с «## {#», была бы принята за заголовок раздела
            lines.append(p if not p.startswith("## {#") else "\\" + p)
            lines.append("")
    return "\n".join(lines), len(sections)


# ---------- реестр и запись ----------


def registry():
    return yaml.safe_load((ROOT / "registry.yaml").read_text(encoding="utf-8"))["docs"]


def iso(ymd):
    return f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:8]}"


def fetch(entry):
    """Возвращает (статус, пояснение). Пишет content/docs/<id>/ только при успехе."""
    if not entry.get("number") or not entry.get("date"):
        return "skip", "в реестре нет номера или даты"
    found = search(entry["number"], entry["date"])
    if not found:
        return "not-found", "на портале нет акта с таким номером и датой"
    if len(found) > 1:
        return "ambiguous", "; ".join(d["docpassing"] for d in found)[:300]
    doc = found[0]
    red = actual_redaction(doc["dochash"])
    if not red:
        return "no-actual", f"{doc['docpassing']}: нет актуальной редакции ({doc.get('docstate')})"
    if not red.get("hascontent"):
        return "no-text", f"{doc['docpassing']}: у актуальной редакции нет текста"
    text_html = api(f"redtext?bpa=ebpi&t={red['redid']}&ttl={TTL}").get("redtext") or ""
    markdown, count = to_markdown(text_html)
    if count < 3 or len(markdown) < 2000:
        return "too-short", f"{doc['docpassing']}: разделов {count}, знаков {len(markdown)}"

    edition = iso(red["reddate"])
    if edition < entry["date"]:
        edition = entry["date"]
    meta = {
        "id": entry["id"],
        "title": doc.get("docnames") or entry["title"],
        "kind": entry["kind"],
        "number": re.sub(r"^\s*(N|№)\s*", "", entry["number"]).strip(),
        "date": entry["date"],
        "edition": edition,
        "source_url": PAGE + doc["dochash"],
        "fetched": datetime.date.today().isoformat(),
        "modules": entry["modules"],
        "text": "full",
        "note": f"{doc['docpassing']}. Редакция портала: {red.get('redcaption', '').strip()}."
        + ("" if red.get("redofficial") else " Портал помечает эту сводную редакцию как ознакомительную."),
    }
    if entry.get("list_no"):
        meta["list_no"] = entry["list_no"]
    folder = ROOT / entry["id"]
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "text.md").write_text(markdown, encoding="utf-8")
    (folder / "meta.yaml").write_text(
        yaml.safe_dump(meta, allow_unicode=True, sort_keys=False, width=110), encoding="utf-8"
    )
    return "ok", f"{doc['docpassing']}; редакция {edition}; разделов {count}; {len(markdown) // 1000} тыс. знаков"


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("search")
    s.add_argument("number")
    s.add_argument("date")
    f = sub.add_parser("fetch")
    f.add_argument("id")
    a = sub.add_parser("auto")
    a.add_argument("--only", default="")
    a.add_argument("--limit", type=int, default=0)
    a.add_argument("--report", default="")
    a.add_argument("--force", action="store_true", help="перекачать уже собранные документы")
    args = ap.parse_args()

    if args.cmd == "search":
        for d in search(args.number, args.date):
            print(d["docpassing"], "|", d["docnames"][:100], "|", d["docstate"], "|", d["dochash"])
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
    results, done = [], 0
    for entry in entries:
        if kinds and entry["kind"] not in kinds:
            continue
        if (ROOT / entry["id"] / "meta.yaml").exists() and not args.force:
            continue
        if args.force and not (ROOT / entry["id"] / "meta.yaml").exists():
            continue  # --force перекачивает только то, что уже есть
        if args.limit and done >= args.limit:
            break
        try:
            status, info = fetch(entry)
        except Exception as e:  # сеть, неожиданный ответ: записываем и идём дальше
            status, info = "error", str(e)[:200]
        done += 1
        results.append({"id": entry["id"], "list_no": entry.get("list_no"), "status": status, "info": info})
        print(f"{entry['id']:28} {status:10} {info[:110]}", flush=True)
    if args.report:
        pathlib.Path(args.report).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
