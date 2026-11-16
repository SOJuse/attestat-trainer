import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from mend import mend, parse  # noqa: E402
from pub_text import to_sections  # noqa: E402

TEXT = """## {#pril-1-p-22} Пункт 22. ПОРЯДОК

> II. Аттестация

22. Аттестацию не проходят:

е) отсутствовавшие более четырех месяцев.

## {#pril-1-razdel-1} Аттестация работников, предусмотренных подпунктами

«г» и «д» настоящего пункта, возможна не ранее чем через два года.

Аттестация работников по подпункту «е» возможна через год.

## {#pril-1-p-23} Пункт 23. ПОРЯДОК

> Аттестация работников, предусмотренных подпунктами

23. Комиссии дают рекомендации.

## {#pril-1-razdel-2} III. Аттестация в целях установления категории

Настоящий раздел действует с 1 сентября.
"""


class MendTest(unittest.TestCase):
    def test_tail_returns_to_its_point(self):
        text, moved = mend(TEXT)
        sections = {s[0]: s for s in parse(text)}
        self.assertIn(
            "Аттестация работников, предусмотренных подпунктами «г» и «д» настоящего пункта, возможна не ранее чем через два года.",
            sections["pril-1-p-22"][3],
        )
        self.assertIn("Аттестация работников по подпункту «е» возможна через год.", sections["pril-1-p-22"][3])
        self.assertEqual(moved["pril-1-razdel-1"], "pril-1-p-22")

    def test_next_point_gets_real_context_back(self):
        text, _ = mend(TEXT)
        sections = {s[0]: s for s in parse(text)}
        self.assertEqual(sections["pril-1-p-23"][2], "II. Аттестация")

    def test_real_section_is_kept_and_renumbered(self):
        text, moved = mend(TEXT)
        anchors = [s[0] for s in parse(text)]
        self.assertEqual(anchors, ["pril-1-p-22", "pril-1-p-23", "pril-1-razdel-1"])
        self.assertEqual(moved["pril-1-razdel-2"], "pril-1-razdel-1")

    def test_tail_of_a_renumbered_section_points_to_its_new_anchor(self):
        text = (
            "## {#p-1} Пункт 1\n\n1. Текст.\n\n"
            "## {#razdel-1} Оборванная строка\n\nпродолжение первого пункта.\n\n"
            "## {#razdel-2} II. Настоящий раздел\n\nТекст раздела.\n\n"
            "## {#razdel-3} Ещё одна оборванная\n\nстрока раздела.\n"
        )
        mended, moved = mend(text)
        self.assertEqual([s[0] for s in parse(mended)], ["p-1", "razdel-1"])
        self.assertEqual(moved, {"razdel-1": "p-1", "razdel-2": "razdel-1", "razdel-3": "razdel-1"})

    def test_two_line_section_title_is_rebuilt_not_glued_to_the_point(self):
        text = (
            "## {#pril-1-p-44} Пункт 44\n\n> Ш. Первая и высшая категории\n\n44. Категории сохраняются.\n\n"
            "## {#pril-1-razdel-1} ГУ. Аттестация в целях установления\n\nкатегории «педагог-методист»\n\n"
            "## {#pril-1-p-45} Пункт 45\n\n> ГУ. Аттестация в целях установления\n\n45. Аттестация проводится по желанию.\n"
        )
        mended, moved = mend(text)
        sections = {s[0]: s for s in parse(mended)}
        self.assertEqual(sections["pril-1-p-44"][3], ["44. Категории сохраняются."])
        self.assertEqual(sections["pril-1-p-45"][2], "ГУ. Аттестация в целях установления категории «педагог-методист»")
        self.assertEqual(moved, {"pril-1-razdel-1": "pril-1-p-45"})

    def test_two_line_title_with_text_under_it_stays_a_section(self):
        text = (
            "## {#p-1} Пункт 1\n\n1. Текст.\n\n"
            "## {#razdel-1} III. Особенности проведения\n\nдля лиц с ограниченными возможностями\n\nРаздел применяется с сентября.\n"
        )
        mended, moved = mend(text)
        sections = parse(mended)
        self.assertEqual(sections[1][:2], ["razdel-1", "III. Особенности проведения для лиц с ограниченными возможностями"])
        self.assertEqual(sections[1][3], ["Раздел применяется с сентября."])
        self.assertEqual(moved, {})

    def test_clean_text_is_untouched(self):
        clean = "## {#p-1} Пункт 1\n\n1. Текст.\n"
        text, moved = mend(clean)
        self.assertEqual(moved, {})
        self.assertEqual(parse(text), parse(clean))


class SplitTest(unittest.TestCase):
    def test_line_mistaken_for_title_stays_in_the_point(self):
        paras = [
            ("stamp", "УТВЕРЖДЕН приказом"),
            ("title", "ПОРЯДОК"),
            ("title", "II. Аттестация"),
            ("", "1. Аттестацию не проходят: е) отсутствовавшие более четырех месяцев."),
            ("title", "Аттестация работников, предусмотренных подпунктами"),
            ("", "«г» и «д» настоящего пункта, возможна не ранее чем через два года."),
            ("", "2. Комиссии дают рекомендации."),
        ]
        sections = {s[0]: s for s in to_sections(paras)}
        self.assertNotIn("pril-1-razdel-1", sections)
        self.assertIn(
            "Аттестация работников, предусмотренных подпунктами «г» и «д» настоящего пункта, возможна не ранее чем через два года.",
            sections["pril-1-p-1"][2],
        )
        self.assertEqual(sections["pril-1-p-2"][3], "II. Аттестация")

    def test_untitled_section_with_capital_start_is_still_a_section(self):
        paras = [
            ("stamp", "УТВЕРЖДЕН приказом"),
            ("title", "ПОРЯДОК"),
            ("", "1. Первый пункт."),
            ("title", "III. Особые случаи"),
            ("", "Настоящий раздел действует с 1 сентября."),
        ]
        anchors = [s[0] for s in to_sections(paras)]
        self.assertIn("pril-1-razdel-1", anchors)



class TwoLineTitleTest(unittest.TestCase):
    def test_second_line_of_section_title_extends_the_title(self):
        paras = [
            ("stamp", "УТВЕРЖДЕН приказом"),
            ("title", "ПОРЯДОК"),
            ("", "1. Первый пункт."),
            ("title", "IV. Аттестация в целях установления"),
            ("", "категории «педагог-методист»"),
            ("", "2. Второй пункт."),
        ]
        sections = {s[0]: s for s in to_sections(paras)}
        self.assertEqual(sections["pril-1-p-1"][2], ["1. Первый пункт."])
        self.assertEqual(sections["pril-1-p-2"][3], "IV. Аттестация в целях установления категории «педагог-методист»")


if __name__ == "__main__":
    unittest.main()
