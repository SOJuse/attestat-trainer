#!/usr/bin/env python3
"""Собирает content/docs/registry.yaml из разбора списка литературы.

Запуск из корня репозитория:
  tools/fetch/.venv/bin/python tools/fetch/parse_lit.py content/sources/list/<pdf> > rows.json
  tools/fetch/.venv/bin/python tools/fetch/make_registry.py rows.json > content/docs/registry.yaml

Идентификатор и вид документа выводятся из номера и раздела. Это черновик:
после запуска реестр сверяется с PDF и правится руками.
"""
import json
import re
import sys

import yaml

MONTHS = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6,
    "июля": 7, "августа": 8, "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
}
TRANSLIT = dict(zip(
    "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
    ["a", "b", "v", "g", "d", "e", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t",
     "u", "f", "h", "ts", "ch", "sh", "sch", "", "y", "", "e", "yu", "ya"],
))
CODES = [
    ("Гражданский кодекс", "gk-rf"), ("Трудовой кодекс", "tk-rf"),
    ("об административных правонарушениях", "koap-rf"), ("Бюджетный кодекс", "bk-rf"),
    ("Налоговый кодекс", "nk-rf"), ("Уголовный кодекс", "uk-rf"), ("Семейный кодекс", "sk-rf"),
    ("Жилищный кодекс", "zhk-rf"), ("Градостроительный кодекс", "grk-rf"), ("Земельный кодекс", "zk-rf"),
    ("Конституция Российской Федерации", "konstitutsiya-rf"),
]

# Акты по аттестации со страницы Корпоративного университета, которых нет в списке литературы
# (распоряжение Р-144 в списке есть, позиция 191)
ATTESTATION = [
    ("donm-pr-13", "Положение о порядке и сроках проведения аттестации руководителей и кандидатов на должность руководителя государственной образовательной организации, подведомственной Департаменту образования и науки города Москвы", "Пр-13", "2025-01-20"),
    ("donm-pr-1182", "О внесении изменений в приказ Департамента образования и науки города Москвы от 20 января 2025 г. № Пр-13", "Пр-1182", "2025-12-11"),
    ("donm-pr-560", "О внесении изменений в приказ Департамента образования и науки города Москвы от 20 января 2025 г. № Пр-13", "Пр-560", "2026-07-17"),
    ("donm-r-3", "Распоряжение Департамента образования и науки города Москвы", "Р-3", "2026-01-21"),
    ("ku-instruktsiya-testirovanie", "Инструкция о порядке проведения квалификационных испытаний в форме тестирования в рамках аттестации на соответствие должности руководителя государственной образовательной организации", None, None),
]


def slug(text):
    out = []
    for ch in text.lower():
        if ch in TRANSLIT:
            out.append(TRANSLIT[ch])
        elif ch.isascii() and ch.isalnum():
            out.append(ch)
        else:
            out.append("-")
    return re.sub(r"-+", "-", "".join(out)).strip("-")


def parse_date(text):
    m = re.search(r"(\d{1,2})\s+([а-я]+)\s+(\d{4})", text)
    if m and m.group(2) in MONTHS:
        return f"{int(m.group(3)):04d}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}"
    m = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", text)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def classify(section, number, title):
    low = (section + " " + title).lower()
    if "верховного суда" in section.lower():
        return "court"
    if "санитарного врача" in section.lower() or "санпин" in low or "сп 2.4" in low:
        return "sanpin"
    if section.startswith("Федеральные законы"):
        if number and "ФЗ" in number or "кодекс" in low or "конституция" in low:
            return "federal-law"
        if "указ" in low or "поручение" in low or "послание" in low:
            return "decree"
        return "government"
    if "Правительства Российской Федерации" in section:
        return "government"
    if section.startswith("Письма"):
        return "letter"
    if "города Москвы" in section:
        if number and re.search(r"-(ПП|РП)$", number):
            return "moscow"
        if not number:
            return "other"
        return "donm" if ("донм" in low or "департамент" in low) else "moscow"
    return "ministry"


def make_id(kind, number, title, n):
    for needle, code in CODES:
        if needle in title:
            return code
    if not number:
        return f"lit-{n}"
    num = slug(number.replace("N", "").replace("№", ""))
    if not num:
        return f"lit-{n}"
    if kind == "federal-law":
        return "fz-" + re.sub(r"-fz$", "", num)
    prefix = {
        "decree": "ukaz", "government": "pp-rf", "ministry": "prikaz", "sanpin": "pgsv",
        "court": "ppvs", "moscow": "mos", "donm": "donm", "letter": "pismo", "other": "lit",
    }[kind]
    if kind == "moscow":
        num = re.sub(r"-(pp|rp)$", "", num)
        prefix = "pp-mos" if number.endswith("ПП") else "rp-mos" if number.endswith("РП") else "mos"
    return f"{prefix}-{num}"


def main():
    rows = json.load(open(sys.argv[1], encoding="utf-8"))
    docs, used = [], set()
    for r in rows:
        cells = r["cells"]
        date_cell, number, title = (cells + ["", ""])[:3] if len(cells) == 3 else ("", "", cells[0])
        title = re.sub(r"\s+", " ", title).strip()
        number = number.strip() or None
        kind = classify(r["section"], number, title)
        doc_id = make_id(kind, number, title, r["n"])
        if doc_id in used:
            doc_id = f"{doc_id}-n{r['n']}"
        used.add(doc_id)
        entry = {"id": doc_id, "list_no": r["n"], "section": r["section"], "title": title, "kind": kind}
        if number:
            entry["number"] = number
        date = parse_date(date_cell) if date_cell else None
        if date:
            entry["date"] = date
        m = re.search(r"\((?:в\s+)?ред\.?\s*(?:от)?\s*([\d.]+)\s*\)", title)
        if m:
            entry["edition_in_list"] = m.group(1).rstrip(".")
        entry["modules"] = r["modules"]
        docs.append(entry)
    for doc_id, title, number, date in ATTESTATION:
        entry = {"id": doc_id, "section": "Аттестация руководителей", "title": title, "kind": "donm"}
        if number:
            entry["number"] = number
        if date:
            entry["date"] = date
        entry["modules"] = ["K", "R", "P", "Rez", "I"]
        docs.append(entry)
    print("# Реестр документов корпуса. Позиции 1–258 — список литературы 2026,")
    print("# дальше акты по аттестации. Черновик собран tools/fetch/make_registry.py и сверен с PDF.")
    yaml.safe_dump({"docs": docs}, sys.stdout, allow_unicode=True, sort_keys=False, width=110)


if __name__ == "__main__":
    main()
