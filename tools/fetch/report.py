#!/usr/bin/env python3
"""Отчёт о корпусе: что собрано, откуда, чего нет.

Запуск из корня репозитория:  tools/fetch/.venv/bin/python tools/fetch/report.py > docs/research/corpus-report.md
"""
import datetime
import os
from collections import defaultdict

import yaml

KIND = {
    "federal-law": "Федеральные законы и кодексы",
    "decree": "Акты Президента",
    "government": "Постановления Правительства РФ",
    "ministry": "Приказы федеральных министерств и ведомств",
    "sanpin": "Санитарные правила",
    "court": "Судебные акты",
    "letter": "Письма и методические рекомендации",
    "moscow": "Постановления Правительства Москвы",
    "donm": "Приказы и письма ДОНМ и других департаментов Москвы",
    "other": "Материалы без номера и даты (сайты, презентации, вебинары)",
}
MOD = {"K": "Кадры", "R": "Ресурсы", "P": "Процессы", "Rez": "Результаты", "I": "Информация"}
ROOT = "content/docs"


def ru(iso):
    return ".".join(reversed(iso.split("-"))) if iso else ""


def main():
    reg = yaml.safe_load(open(f"{ROOT}/registry.yaml", encoding="utf-8"))["docs"]
    meta = {}
    for name in os.listdir(ROOT):
        path = f"{ROOT}/{name}/meta.yaml"
        if os.path.exists(path):
            meta[name] = yaml.safe_load(open(path, encoding="utf-8"))
    status = lambda e: meta[e["id"]]["text"] if e["id"] in meta else "none"

    by_kind = defaultdict(lambda: defaultdict(int))
    by_mod = defaultdict(lambda: defaultdict(int))
    for e in reg:
        by_kind[e["kind"]][status(e)] += 1
        for m in e["modules"]:
            by_mod[m][status(e)] += 1
    full = sum(1 for e in reg if status(e) == "full")
    ocr = sum(1 for e in reg if status(e) == "ocr")
    size = sum(os.path.getsize(f"{ROOT}/{d}/text.md") for d in meta if os.path.exists(f"{ROOT}/{d}/text.md"))

    out = [
        "# Отчёт о корпусе",
        "",
        f"Состояние на {datetime.date.today().strftime('%d.%m.%Y')}. Файл собирает `tools/fetch/report.py`.",
        "",
        "## Итог",
        "",
        f"В реестре {len(reg)} документов: 258 позиций списка литературы 2026 и {len(reg) - 258} актов по аттестации. "
        f"С текстом {full + ocr}: {full} из текстовых официальных источников и {ocr} распознаны со сканов "
        f"официального опубликования. Без текста {len(reg) - full - ocr}. Объём текста {size / 1e6:.1f} МБ.",
        "",
        "Откуда тексты:",
        "",
        "- `actual.pravo.gov.ru` — законы, кодексы, указы, постановления Правительства РФ в действующих редакциях;",
        "- `kremlin.ru` — Конституция, Послание Президента, перечень поручений;",
        "- `government.ru` — одно постановление Правительства;",
        "- `publication.pravo.gov.ru` — приказы министерств и санитарные правила. Там лежат только сканы, "
        "поэтому текст распознан программой и может содержать ошибки. Это редакция на дату опубликования: "
        "позднейшие изменения в текст не внесены, изменившие акты перечислены в `meta.yaml` (`amended_by`).",
        "",
        "## По видам актов",
        "",
        "| Вид | Текст | Распознано | Нет |",
        "|---|---|---|---|",
    ]
    for k, title in KIND.items():
        c = by_kind[k]
        out.append(f"| {title} | {c['full']} | {c['ocr']} | {c['none'] + c['missing'] + c['bibliographic']} |")
    out += ["", "## По модулям", "", "Документ с несколькими модулями посчитан в каждом.", "",
            "| Модуль | Текст | Распознано | Нет |", "|---|---|---|---|"]
    for m, title in MOD.items():
        c = by_mod[m]
        out.append(f"| {title} | {c['full']} | {c['ocr']} | {c['none'] + c['missing'] + c['bibliographic']} |")

    out += [
        "",
        "## Почему остальных нет",
        "",
        "Доступ в интернет с рабочего компьютера идёт через зарубежный адрес, заказчик решил это не менять.",
        "",
        "- `mos.ru` обрывает соединение с зарубежных адресов. На нём лежат постановления Правительства Москвы "
        "и приказы Департамента образования; на федеральном портале опубликования раздел Москвы пуст.",
        "- `pravo.gov.ru`, сайты Рособрнадзора и Роспотребнадзора не отвечают.",
        "- Письма министерств официально почти не публикуются: в банке документов Минпросвещения нашлись три карточки, "
        "две из них сканами, у третьей не подтверждён номер.",
        "- Четыре документа найдены, но не распознавались из-за объёма: СанПиН 3.3686-21 (1092 страницы), "
        "федеральные образовательные программы (приказы 370, 371 и 704: 5683, 3317 и 2211 страниц), "
        "приказ 1026 (406 страниц). Нужные разделы можно распознать отдельно.",
        "- 23 позиции списка не являются документами: сайты, презентации, вебинары, материалы совещаний.",
        "",
        "## Распознанные документы",
        "",
        "Доля слов, в которых программа распознавания не уверена, показывает качество скана. "
        "Цитату из такого текста перед использованием сверяют со сканом по ссылке на источник.",
        "",
        "| Документ | Страниц текста, тыс. знаков | Слов под сомнением | Позднейшие изменения |",
        "|---|---|---|---|",
    ]
    import re

    for e in reg:
        m = meta.get(e["id"])
        if m and m["text"] == "ocr":
            low = re.search(r"под сомнением \d+ \(([\d.]+%)\)", m.get("note", ""))
            chars = os.path.getsize(f"{ROOT}/{e['id']}/text.md") // 2000
            out.append(
                f"| {m['title'][:90].replace('|', '/')} (№ {m.get('number', '')}) | {chars} | "
                f"{low.group(1) if low else '—'} | {len(m.get('amended_by', []))} |"
            )

    out += ["", "## Редакции текстовых документов", "", "| Документ | В списке литературы | В корпусе |", "|---|---|---|"]
    for e in reg:
        m = meta.get(e["id"])
        if m and m["text"] == "full":
            out.append(
                f"| {m['title'][:80].replace('|', '/')} ({m.get('number', 'б/н')}) | "
                f"{e.get('edition_in_list', '—')} | {ru(m.get('edition'))} |"
            )

    out += ["", "## Документы без текста", "", "| № | Вид | Модули | Название |", "|---|---|---|---|"]
    for e in reg:
        if e["id"] not in meta:
            out.append(
                f"| {e.get('list_no', '')} | {KIND[e['kind']].split(' и ')[0][:30]} | {', '.join(e['modules'])} | "
                f"{e['title'][:120].replace('|', '/')} |"
            )
    print("\n".join(out))


if __name__ == "__main__":
    main()
