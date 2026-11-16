"""Тесты сборки строк из таблицы слов Tesseract. Запуск: python3 -m unittest tools/fetch/test_ocr.py"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ocr import page_lines  # noqa: E402


def word(text, left, top, conf=95.0, height=42, width=None, line=1, par=1, block=1):
    return {
        "level": "5", "block_num": str(block), "par_num": str(par), "line_num": str(line),
        "left": str(left), "top": str(top), "width": str(width or 22 * len(text)), "height": str(height),
        "conf": str(conf), "text": text,
    }


class PageLines(unittest.TestCase):
    def test_words_of_a_line_are_joined_in_reading_order(self):
        rows = [word("приказываю:", 600, 100), word("г.", 300, 101), word("2018", 200, 100)]
        self.assertEqual([t.strip() for t, _ in page_lines(rows)], ["2018 г. приказываю:"])

    def test_dash_invented_from_a_wide_gap_is_dropped(self):
        # настоящее тире низкое (несколько точек), а «тире» на месте широкого пробела — высотой в строку
        rows = [
            word("утвержденного", 200, 100),
            word("—", 520, 90, conf=56, height=76, width=27),
            word("постановлением", 560, 100),
            word("программам", 900, 100),
            word("—", 1140, 118, conf=93, height=7, width=32),
        ]
        self.assertEqual(page_lines(rows)[0][0].strip(), "утвержденного постановлением программам —")

    def test_line_of_unreadable_scribble_is_dropped(self):
        rows = [
            word("«его", 200, 100, conf=46, line=1), word("слл/.", 320, 100, conf=0, line=1),
            word("478", 900, 100, conf=8, line=1),
            word("Москва", 500, 200, conf=96, line=2),
        ]
        self.assertEqual([t.strip() for t, _ in page_lines(rows)], ["Москва"])

    def test_short_russian_line_with_low_confidence_is_kept(self):
        # последняя строка абзаца из одного слова со сноской: уверенность низкая, но это текст нормы
        rows = [
            word("за", 200, 100, line=1), word("итоговое", 280, 100, line=1), word("сочинение", 480, 100, line=1),
            word("(изложение)", 200, 160, conf=12, line=2),
        ]
        lines = page_lines(rows)
        self.assertEqual([t.strip() for t, _ in lines], ["за итоговое сочинение", "(изложение)"])
        self.assertEqual(lines[1][1], ["(изложение)"])

    def test_one_doubtful_word_does_not_remove_a_good_line(self):
        rows = [word("образовательным", 200, 100, conf=54), word("программам", 560, 100), word("дошкольного", 800, 100)]
        lines = page_lines(rows)
        self.assertEqual(lines[0][0].strip(), "образовательным программам дошкольного")
        self.assertEqual(lines[0][1], ["образовательным"])

    def test_indent_is_kept_as_leading_spaces(self):
        rows = [
            word("1.", 310, 100, line=1), word("Утвердить", 380, 100, line=1),
            word("образовательной", 200, 160, line=2), word("деятельности", 560, 160, line=2),
        ]
        first, second = (t for t, _ in page_lines(rows))
        self.assertGreater(len(first) - len(first.lstrip()), len(second) - len(second.lstrip()))
        self.assertEqual(second.lstrip(), "образовательной деятельности")

    def test_page_margin_is_not_counted_as_indent(self):
        rows = [
            word("образовательной", 300, 100, line=1), word("деятельности", 660, 100, line=1),
            word("программам", 300, 160, line=2), word("дошкольного", 560, 160, line=2),
            word("Москва", 1100, 220, line=3),
        ]
        body1, body2, centred = (t for t, _ in page_lines(rows))
        self.assertEqual(body1, "образовательной деятельности")
        self.assertEqual(body2, "программам дошкольного")
        self.assertTrue(centred.startswith(" " * 20))

    def test_lines_go_top_to_bottom_across_blocks(self):
        rows = [
            word("вторая", 200, 300, block=1), word("первая", 200, 100, block=2), word("третья", 200, 500, block=3),
        ]
        self.assertEqual([t.strip() for t, _ in page_lines(rows)], ["первая", "вторая", "третья"])

    def test_empty_page(self):
        self.assertEqual(page_lines([]), [])


if __name__ == "__main__":
    unittest.main()
