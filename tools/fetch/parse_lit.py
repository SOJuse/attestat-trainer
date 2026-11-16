#!/usr/bin/env python3
"""Черновик реестра из PDF со списком литературы.

Запуск:  tools/fetch/.venv/bin/python tools/fetch/parse_lit.py <pdf> > rows.json

Печатает JSON: по записи на строку таблицы — номер, раздел, ячейки текста слева
направо и модули. Модуль определяется по горизонтальному положению знака «+»
относительно пяти колонок. Идентификаторы и вид документа назначает make_registry.py.
"""
import json
import re
import sys

import pdfplumber

MODULES = ["K", "R", "P", "Rez", "I"]
NUM = re.compile(r"^(\d{1,3})\.$")


def column_centres(page):
    """Центры пяти колонок модулей по словам второй строки шапки."""
    names = ["КАДРАМИ", "РЕСУРСАМИ", "ПРОЦЕССАМИ", "РЕЗУЛЬТАТАМИ", "ИНФОРМАЦИЕЙ"]
    words = {w["text"]: w for w in page.extract_words() if w["text"] in names}
    if len(words) != 5:
        return None
    return [(words[n]["x0"] + words[n]["x1"]) / 2 for n in names]


def cell_text(words):
    lines = {}
    for w in words:
        lines.setdefault(round(w["top"] / 3), []).append(w)
    out = []
    for key in sorted(lines):
        out.append(" ".join(w["text"] for w in sorted(lines[key], key=lambda w: w["x0"])))
    return " ".join(out).strip()


def bands(page):
    """Строки таблицы: промежутки между горизонтальными линиями в колонке номеров."""
    tops = sorted(
        {round(r["top"], 1) for r in page.rects if r["height"] < 2 and 14 < r["x0"] < 18 and 55 < r["x1"] < 66}
    )
    return list(zip(tops, tops[1:]))


def has_inner_columns(page, top, bottom):
    """В строке три ячейки (дата, номер, название), если её пересекает вертикаль у x≈177."""
    for r in page.rects:
        if r["width"] < 2 and 170 < r["x0"] < 195 and r["top"] < bottom - 2 and r["bottom"] > top + 2:
            return True
    return False


def main():
    pdf = pdfplumber.open(sys.argv[1])
    centres = None
    section = ""
    rows = []
    for page in pdf.pages:
        centres = column_centres(page) or centres
        left_edge = centres[0] - 40
        words = page.extract_words()
        for top, bottom in bands(page):
            inside = [w for w in words if top <= (w["top"] + w["bottom"]) / 2 <= bottom]
            if not inside or any(w["text"] in ("МОДУЛИ", "УПРАВЛЕНИЕ", "НАИМЕНОВАНИЕ") for w in inside):
                continue
            pluses = [w for w in inside if w["text"] == "+" and w["x0"] > left_edge]
            texts = [w for w in inside if w not in pluses]
            number = None
            for w in texts:
                m = NUM.match(w["text"])
                if m and w["x0"] < 60:
                    number = int(m.group(1))
                    texts.remove(w)
                    break
            if not texts and number is None:
                continue
            if has_inner_columns(page, top, bottom):
                cells = [
                    cell_text([w for w in texts if w["x1"] < 180]),
                    cell_text([w for w in texts if 180 <= w["x1"] and w["x0"] < 264]),
                    cell_text([w for w in texts if w["x0"] >= 264]),
                ]
            else:
                cells = [cell_text(texts)]
            modules = sorted(
                {MODULES[min(range(5), key=lambda i: abs(centres[i] - (p["x0"] + p["x1"]) / 2))] for p in pluses},
                key=MODULES.index,
            )
            if number is None:
                # заголовок раздела: одна ячейка на всю ширину, без модулей
                if not pluses and len(cells) == 1:
                    section = " ".join(c for c in cells if c)
                elif rows:
                    # строка, перенесённая на следующую страницу
                    prev = rows[-1]
                    while len(prev["cells"]) < len(cells):
                        prev["cells"].append("")
                    for k, c in enumerate(cells):
                        if c:
                            prev["cells"][k] = (prev["cells"][k] + " " + c).strip()
                    prev["modules"] = sorted(set(prev["modules"]) | set(modules), key=MODULES.index)
                continue
            rows.append({"n": number, "section": section, "cells": cells, "modules": modules})
    json.dump(rows, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
