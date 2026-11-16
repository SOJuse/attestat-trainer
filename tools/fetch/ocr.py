"""Распознавание сканов официального опубликования (Tesseract, русский язык).

Языковые данные лежат в tools/fetch/tessdata (в репозиторий не входят):
  rus.traineddata — https://github.com/tesseract-ocr/tessdata_best

ocr_pages(pdf) возвращает тексты страниц в том же виде, что `pdftotext -layout`:
строки с отступами, поэтому дальше работает обычный разбор pub_text.pdf_paragraphs.
Распознанный текст может содержать ошибки, особенно в цифрах. Слова, в которых
движок не уверен, возвращаются отдельным списком: их сверяют со сканом глазами.
"""
import csv
import pathlib
import re
import statistics
import subprocess

TESSDATA = pathlib.Path(__file__).parent / "tessdata"
CACHE = pathlib.Path("/tmp/claude-501/pub/ocr3")  # таблицы слов по страницам
DPI = 300
LOW_CONF = 60.0  # ниже — слово под сомнением
DROP_LINE_CONF = 50.0  # строка, где в среднем хуже, — росчерк, штамп или печать
DASHES = {"—", "–", "-"}


RUSSIAN_WORD = re.compile(r"^[(«\"]?[А-ЯЁа-яё]{3,}[)».,;:\"]*$")


def _looks_like_text(words, line_height):
    """Строка с низкой уверенностью — всё же текст, а не росчерк: русские слова обычной высоты."""
    real = [
        w for w in words
        if RUSSIAN_WORD.match(w["text"]) and 0.5 * line_height <= int(w["height"]) <= 1.6 * line_height
    ]
    return len(real) >= max(1, len(words) / 2)


def page_lines(rows):
    """Строки страницы сверху вниз: [(текст с отступом, [сомнительные слова])].

    rows — строки TSV Tesseract (словари). Берутся только слова (level 5).
    """
    words = [r for r in rows if r.get("level") == "5" and (r.get("text") or "").strip()]
    if not words:
        return []
    heights = [int(w["height"]) for w in words if w["text"] not in DASHES]
    line_height = statistics.median(heights) if heights else 40
    lines = {}
    for w in words:
        lines.setdefault((w["block_num"], w["par_num"], w["line_num"]), []).append(w)

    char_widths = [int(w["width"]) / len(w["text"]) for w in words if len(w["text"]) > 3]
    char_width = statistics.median(char_widths) if char_widths else 22
    # левое поле страницы отступом не считается: отсчёт идёт от самой левой строки
    margin = min(int(w["left"]) for w in words if float(w["conf"]) >= LOW_CONF) if any(
        float(w["conf"]) >= LOW_CONF for w in words
    ) else 0
    out = []
    for group in lines.values():
        group.sort(key=lambda w: int(w["left"]))
        # тире ростом со строку — это широкий пробел в выключенной по ширине строке, а не знак
        kept = [w for w in group if not (w["text"] in DASHES and int(w["height"]) > line_height * 0.6)]
        if not kept:
            continue
        confs = [float(w["conf"]) for w in kept]
        if statistics.mean(confs) < DROP_LINE_CONF and not _looks_like_text(kept, line_height):
            continue
        doubtful = [w["text"] for w in kept if float(w["conf"]) < LOW_CONF]
        indent = " " * max(0, round((int(kept[0]["left"]) - margin) / char_width))
        top = min(int(w["top"]) for w in kept)
        out.append((top, indent + " ".join(w["text"] for w in kept), doubtful))
    out.sort(key=lambda item: item[0])
    return [(text, doubtful) for _, text, doubtful in out]


def _tsv(image):
    # Leptonica на macOS сама подменяет «/tmp/» системной временной папкой и не находит файл,
    # поэтому ей нужен настоящий путь (/private/tmp/…)
    image = image.resolve()
    base = image.with_suffix("")
    subprocess.run(
        ["tesseract", str(image), str(base), "--tessdata-dir", str(TESSDATA), "-l", "rus", "--psm", "3",
         "-c", "tessedit_create_tsv=1"],
        capture_output=True, check=True,
    )
    return base.with_suffix(".tsv")


def _rows(tsv_path):
    with open(tsv_path, encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))


def _quality(rows):
    """Число уверенно распознанных слов: по нему видно, что страница лежит на боку."""
    return sum(1 for r in rows if r.get("level") == "5" and len(r.get("text") or "") > 2 and float(r["conf"]) >= 80)


def _rotation(image):
    """На сколько градусов повернуть страницу, по мнению Tesseract (0, 90, 180, 270)."""
    out = subprocess.run(
        ["tesseract", str(image.resolve()), "-", "--tessdata-dir", str(TESSDATA), "--psm", "0"],
        capture_output=True, text=True,
    )
    m = re.search(r"Rotate:\s*(\d+)", out.stdout + out.stderr)
    return int(m.group(1)) if m else 0


def _recognise(pdf_path, n, folder):
    """Таблица слов страницы n. Страницу, которая распозналась плохо, пробуем повернуть."""
    prefix = folder / f"p{n:04d}"
    subprocess.run(
        ["pdftoppm", "-r", str(DPI), "-gray", "-f", str(n), "-l", str(n), "-singlefile", "-png",
         str(pdf_path), str(prefix)],
        capture_output=True, check=True,
    )
    image = prefix.with_suffix(".png")
    tsv = _tsv(image)
    rows = _rows(tsv)
    if _quality(rows) < 40:
        angle = _rotation(image)
        if angle in (90, 180, 270):
            upright = tsv.read_text(encoding="utf-8")
            subprocess.run(["sips", "-r", str(angle), str(image.resolve())], capture_output=True)
            if _quality(_rows(_tsv(image))) <= _quality(rows):
                tsv.write_text(upright, encoding="utf-8")  # поворот не помог: оставляем как было
    image.unlink()
    return tsv


def ocr_pages(pdf_path, key, pages):
    """(тексты страниц, всего слов, сомнительные слова по страницам).

    Таблица слов каждой страницы кешируется: изменив сборку строк, распознавать заново не нужно.
    """
    folder = CACHE / key
    folder.mkdir(parents=True, exist_ok=True)
    texts, total, doubtful = [], 0, []
    for n in range(1, pages + 1):
        tsv = folder / f"p{n:04d}.tsv"
        if not tsv.exists():
            _recognise(pdf_path, n, folder)
        lines = page_lines(_rows(tsv))
        page = "\n".join(t for t, _ in lines)
        texts.append(page)
        total += len(page.split())
        doubtful.append([w for _, ws in lines for w in ws])
    return texts, total, doubtful
