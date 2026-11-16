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
import statistics
import subprocess

TESSDATA = pathlib.Path(__file__).parent / "tessdata"
CACHE = pathlib.Path("/tmp/claude-501/pub/ocr2")  # номер в имени — версия сборки строк
DPI = 300
LOW_CONF = 60.0  # ниже — слово под сомнением
DROP_LINE_CONF = 50.0  # строка, где в среднем хуже, — росчерк, штамп или печать
DASHES = {"—", "–", "-"}


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
        if statistics.mean(confs) < DROP_LINE_CONF:
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
    with open(base.with_suffix(".tsv"), encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))


def ocr_pages(pdf_path, key, pages):
    """(тексты страниц, всего слов, сомнительные слова по страницам). Результат кешируется."""
    folder = CACHE / key
    folder.mkdir(parents=True, exist_ok=True)
    texts, total, doubtful = [], 0, []
    for n in range(1, pages + 1):
        txt, low = folder / f"{n:04d}.txt", folder / f"{n:04d}.low"
        if not txt.exists():
            prefix = folder / f"p{n:04d}"
            subprocess.run(
                ["pdftoppm", "-r", str(DPI), "-gray", "-f", str(n), "-l", str(n), "-singlefile", "-png",
                 str(pdf_path), str(prefix)],
                capture_output=True, check=True,
            )
            image = prefix.with_suffix(".png")
            lines = page_lines(_tsv(image))
            image.unlink()
            txt.write_text("\n".join(t for t, _ in lines), encoding="utf-8")
            low.write_text("\n".join(w for _, ws in lines for w in ws), encoding="utf-8")
        page = txt.read_text(encoding="utf-8")
        texts.append(page)
        total += len(page.split())
        doubtful.append([w for w in low.read_text(encoding="utf-8").split("\n") if w])
    return texts, total, doubtful
