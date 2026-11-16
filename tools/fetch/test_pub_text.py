"""Тесты разбора текста PDF и HTML government.ru. Запуск: python3 -m unittest tools/fetch/test_pub_text.py

Страницы PDF заданы так, как их отдаёт `pdftotext -layout`: строки выровнены пробелами,
ширина строки тела текста 78 знаков, первая строка абзаца с отступом.
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pub_text import html_paragraphs, pdf_paragraphs, to_markdown, to_sections  # noqa: E402

WIDTH = 78


def J(text, indent=0):
    """Строка по ширине: пробелы между словами добавляются, как при выключке."""
    words = text.split()
    room = WIDTH - indent - len("".join(words))
    assert WIDTH - indent - len(text) in range(0, 12), f"строка не для выключки: {text}"
    gaps = len(words) - 1
    out = ""
    for i, w in enumerate(words):
        out += w
        if i < gaps:
            n = room // gaps + (1 if i < room % gaps else 0)
            out += " " * n
    return " " * indent + out


def I(text):  # noqa: E743 — первая строка абзаца (с отступом)
    return J(text, indent=5)


def L(text, indent=0):
    """Последняя строка абзаца: без выключки."""
    return " " * indent + text


def C(text):
    pad = (WIDTH - len(text)) // 2
    return " " * pad + text


def R(text):
    return " " * 46 + text


def page(*lines):
    return "\n".join(lines) + "\n"


ORDER = [
    page(
        C("МИНИСТЕРСТВО ПРОСВЕЩЕНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ"),
        C("П Р И К А З"),
        "« 24 » марта 2023 г." + " " * 48 + "№ 196",
        C("Москва"),
        C("Об утверждении Порядка проведения аттестации"),
        C("педагогических работников"),
        I("В соответствии со статьей 49 Федерального закона от 29.12.2012 № 273-"),
        L("ФЗ «Об образовании в Российской Федерации» п р и к а з ы в а ю:"),
        I("1. Утвердить прилагаемый Порядок проведения аттестации педагогических"),
        L("работников организаций, осуществляющих образовательную деятельность."),
        L("2. Настоящий приказ вступает в силу с 1 сентября 2023 г.", indent=5),
        "",
        "Министр" + " " * 58 + "С.С. Кравцов",
    ),
    page(
        C("2"),
        R("УТВЕРЖДЕН"),
        R("приказом Министерства просвещения"),
        R("Российской Федерации"),
        R("от 24 марта 2023 г. № 196"),
        "",
        C("ПОРЯДОК"),
        C("проведения аттестации педагогических работников"),
        "",
        C("I. Общие положения"),
        I("1. Настоящий Порядок определяет правила проведения аттестации педаго-"),
        J("гических работников организаций, осуществляющих образовательную дея-"),
        L("тельность."),
        I("2. Аттестация проводится в целях подтверждения соответствия психолого-"),
        L("педагогическим требованиям и установления квалификационной категории."),
        C("II. Аттестация в целях установления категории"),
        I("3. Аттестация проводится по заявлению педагогических работников, которое"),
        L("подается в аттестационную комиссию."),
    ),
]


def anchors(sections):
    return [s[0] for s in sections]


def by_anchor(sections):
    return {s[0]: s for s in sections}


class PdfParagraphs(unittest.TestCase):
    def setUp(self):
        self.s = by_anchor(to_sections(pdf_paragraphs(ORDER)))

    def test_order_points_signature_and_annex(self):
        self.assertEqual(
            anchors(to_sections(pdf_paragraphs(ORDER))),
            ["preambula", "p-1", "p-2", "podpis", "pril-1", "pril-1-p-1", "pril-1-p-2", "pril-1-p-3"],
        )

    def test_lines_of_a_paragraph_are_glued(self):
        self.assertEqual(
            self.s["p-1"][2],
            [
                "1. Утвердить прилагаемый Порядок проведения аттестации педагогических работников "
                "организаций, осуществляющих образовательную деятельность."
            ],
        )

    def test_hyphenation_is_removed_but_compound_words_keep_hyphen(self):
        self.assertEqual(
            self.s["pril-1-p-1"][2],
            [
                "1. Настоящий Порядок определяет правила проведения аттестации педагогических работников "
                "организаций, осуществляющих образовательную деятельность."
            ],
        )
        self.assertIn("психолого-педагогическим требованиям", self.s["pril-1-p-2"][2][0])

    def test_hyphen_before_capital_or_after_digit_stays(self):
        self.assertIn("№ 273-ФЗ «Об образовании", " ".join(self.s["preambula"][2]))

    def test_letter_spacing_is_collapsed(self):
        pre = self.s["preambula"][2]
        self.assertIn("ПРИКАЗ", pre)
        self.assertTrue(pre[-1].endswith("приказываю:"))

    def test_title_lines_are_one_paragraph(self):
        self.assertIn("Об утверждении Порядка проведения аттестации педагогических работников", self.s["preambula"][2])

    def test_signature(self):
        self.assertEqual(self.s["podpis"][2], ["Министр С.С. Кравцов"])

    def test_page_number_is_dropped(self):
        everything = [p for sec in self.s.values() for p in sec[2]]
        self.assertNotIn("2", everything)

    def test_stamp_and_annex_title(self):
        pril = self.s["pril-1"]
        self.assertEqual(pril[1], "ПОРЯДОК проведения аттестации педагогических работников")
        self.assertEqual(
            pril[2], ["УТВЕРЖДЕН приказом Министерства просвещения Российской Федерации от 24 марта 2023 г. № 196"]
        )
        self.assertEqual(self.s["pril-1-p-1"][1], "Пункт 1. ПОРЯДОК проведения аттестации педагогических работников")

    def test_section_title_goes_to_the_next_point(self):
        self.assertEqual(self.s["pril-1-p-1"][3], "I. Общие положения")
        self.assertEqual(self.s["pril-1-p-3"][3], "II. Аттестация в целях установления категории")
        self.assertNotIn("II. Аттестация в целях установления категории", self.s["pril-1-p-2"][2])

    def test_date_and_number_line_is_kept(self):
        self.assertIn("« 24 » марта 2023 г. | № 196", self.s["preambula"][2])


class PdfFurniture(unittest.TestCase):
    def test_running_header_on_every_page_is_dropped(self):
        pages = [
            page(
                L("Приказ № 196 — страница 1"),
                L("1. Первый пункт приказа о порядке проведения аттестации работников.", indent=5),
            ),
            page(
                L("Приказ № 196 — страница 2"),
                L("2. Второй пункт приказа о порядке проведения аттестации работников.", indent=5),
            ),
            page(
                L("Приказ № 196 — страница 3"),
                L("3. Третий пункт приказа о порядке проведения аттестации работников.", indent=5),
            ),
        ]
        paras = [t for _, t in pdf_paragraphs(pages)]
        self.assertEqual(paras[0], "1. Первый пункт приказа о порядке проведения аттестации работников.")
        self.assertFalse(any("страница" in p for p in paras))

    def test_paragraph_continues_across_page_break(self):
        pages = [
            page(
                I("1. Пункт, который начинается на одной странице и продолжается на"),
                C("1"),
            ),
            page(
                C("2"),
                L("следующей странице без нового абзаца."),
                L("2. Следующий пункт с новой строки и с отступом, как положено.", indent=5),
            ),
        ]
        paras = [t for _, t in pdf_paragraphs(pages)]
        self.assertEqual(
            paras[0], "1. Пункт, который начинается на одной странице и продолжается на следующей странице без нового абзаца."
        )
        self.assertEqual(len(paras), 2)


class PdfDecree(unittest.TestCase):
    DECREE = [
        page(
            C("ПРАВИТЕЛЬСТВО РОССИЙСКОЙ ФЕДЕРАЦИИ"),
            C("ПОСТАНОВЛЕНИЕ"),
            C("от 7 июня 2025 г. № 850"),
            C("МОСКВА"),
            L("Правительство Российской Федерации постановляет:", indent=5),
            I("1. Утвердить прилагаемые изменения, которые вносятся в постановление"),
            L("Правительства Российской Федерации от 31 мая 2021 г. № 825."),
            L("2. Настоящее постановление вступает в силу с 1 сентября 2025 г.", indent=5),
            "",
            "Председатель Правительства",
            "Российской Федерации" + " " * 46 + "М.Мишустин",
        ),
        page(
            R("Приложение № 1"),
            R("к постановлению Правительства"),
            R("Российской Федерации"),
            R("от 7 июня 2025 г. № 850"),
            C("ПЕРЕЧЕНЬ ДОЛЖНОСТЕЙ"),
            "Наименование должности" + " " * 30 + "Продолжительность, дней",
            "Учителя" + " " * 47 + "56",
        ),
    ]

    def test_two_line_signature_is_one_paragraph(self):
        s = by_anchor(to_sections(pdf_paragraphs(self.DECREE)))
        self.assertEqual(s["podpis"][2], ["Председатель Правительства Российской Федерации М.Мишустин"])
        self.assertEqual(s["p-2"][2], ["2. Настоящее постановление вступает в силу с 1 сентября 2025 г."])

    def test_annex_stamp_and_table_rows(self):
        s = by_anchor(to_sections(pdf_paragraphs(self.DECREE)))
        self.assertEqual(s["pril-1"][1], "ПЕРЕЧЕНЬ ДОЛЖНОСТЕЙ")
        self.assertEqual(
            s["pril-1"][2],
            [
                "Приложение № 1 к постановлению Правительства Российской Федерации от 7 июня 2025 г. № 850",
                "Наименование должности | Продолжительность, дней",
                "Учителя | 56",
            ],
        )


class Sections(unittest.TestCase):
    def test_annex_without_stamp_starts_after_signature(self):
        paras = [
            ("", "1. Утвердить прилагаемый Порядок."),
            ("", "2. Приказ вступает в силу."),
            ("sign", "Министр С.С. Кравцов"),
            ("title", "ПОРЯДОК"),
            ("title", "I. Общие положения"),
            ("", "1. Настоящий Порядок определяет правила."),
        ]
        s = to_sections(paras)
        self.assertEqual(anchors(s), ["p-1", "p-2", "podpis", "pril-1-p-1"])
        self.assertEqual(s[-1][1], "Пункт 1. ПОРЯДОК")
        self.assertEqual(s[-1][3], "I. Общие положения")

    def test_unnumbered_text_under_title_gets_its_own_section(self):
        paras = [
            ("", "1. Утвердить."),
            ("stamp", "УТВЕРЖДЕНЫ приказом"),
            ("title", "ТРЕБОВАНИЯ"),
            ("title", "I. Общие требования"),
            ("", "Организация обязана обеспечить."),
            ("", "Организация вправе проверять."),
        ]
        s = to_sections(paras)
        self.assertEqual(anchors(s), ["p-1", "pril-1", "pril-1-razdel-1"])
        self.assertEqual(s[-1][1], "I. Общие требования")
        self.assertEqual(s[-1][2], ["Организация обязана обеспечить.", "Организация вправе проверять."])

    def test_markdown_format(self):
        md, n = to_markdown(to_sections([("", "Вводный текст."), ("", "1. Пункт."), ("", "> не цитата")]))
        self.assertEqual(n, 2)
        self.assertEqual(
            md, "## {#preambula} Вводная часть\n\nВводный текст.\n\n## {#p-1} Пункт 1\n\n1. Пункт.\n\n\\> не цитата\n"
        )


GOV = (
    "<div><p> </p><h4>ПРАВИТЕЛЬСТВО РОССИЙСКОЙ ФЕДЕРАЦИИ</h4><h4>ПОСТАНОВЛЕНИЕ</h4>"
    "<h4>от 30 августа 2017 г. № 1042</h4>"
    "<h4>(В редакции  Постановления  Правительства  Российской Федерации от 02.08.2019 № 1011) </h4>"
    "<p>В соответствии со статьей 34 Федерального закона Правительство Российской Федерации постановляет:</p>"
    "<p>1. Утвердить прилагаемые Правила,  изменения и перечни,  а также формы. "
    "(В редакции  Постановления  Правительства  Российской Федерации от 02.08.2019 № 1011) </p>"
    "<p>2. Признать утратившим силу постановление от 25 ноября 2013 г. № 1063.</p>"
    "<p>Председатель  Правительства</p><p>Российской Федерации                               Д.Медведев</p>"
    "<h4>____________</h4>"
    "<p>УТВЕРЖДЕНЫ постановлением  Правительства Российской Федерацииот 30 августа 2017 г. № 1042</p>"
    "<h4>ПРАВИЛА определения размера штрафа</h4>"
    "<p>1. Размер штрафа устанавливается контрактом (за исключением случая,  указанного ниже) .</p>"
    "<p>г)  0, 5 процента цены контракта (этапа)  в случае,  если цена составляет от 100 млн. рублей;</p>"
    "<p>(Подпункт в редакции  Постановления  Правительства  Российской Федерации от 02.08.2019 № 1011)</p>"
    "<p>в)  (Утратил силу  - Постановление  Правительства  Российской Федерации от 02.08.2019 № 1011)</p>"
    "<p>2. Общая сумма штрафов,  начисленных по контракту,  не может превышать цену контракта.</p></div>"
)


class GovHtml(unittest.TestCase):
    def setUp(self):
        self.s = by_anchor(to_sections(html_paragraphs(GOV)))

    def test_structure(self):
        self.assertEqual(
            anchors(to_sections(html_paragraphs(GOV))),
            ["preambula", "p-1", "p-2", "podpis", "pril-1", "pril-1-p-1", "pril-1-p-2"],
        )

    def test_added_spaces_after_commas_and_brackets_are_undone(self):
        self.assertEqual(
            self.s["pril-1-p-1"][2][0], "1. Размер штрафа устанавливается контрактом (за исключением случая, указанного ниже)."
        )
        self.assertEqual(
            self.s["pril-1-p-1"][2][1], "г) 0,5 процента цены контракта (этапа) в случае, если цена составляет от 100 млн. рублей;"
        )

    def test_edition_notes_are_removed_but_repeal_stays(self):
        self.assertEqual(self.s["p-1"][2], ["1. Утвердить прилагаемые Правила, изменения и перечни, а также формы."])
        self.assertNotIn("В редакции", " ".join(self.s["preambula"][2]))
        self.assertEqual(
            self.s["pril-1-p-1"][2][2], "в) (Утратил силу - Постановление Правительства Российской Федерации от 02.08.2019 № 1011)"
        )

    def test_signature_stamp_and_title(self):
        self.assertEqual(self.s["podpis"][2], ["Председатель Правительства Российской Федерации Д.Медведев"])
        self.assertEqual(
            self.s["pril-1"][2], ["УТВЕРЖДЕНЫ постановлением Правительства Российской Федерации от 30 августа 2017 г. № 1042"]
        )
        self.assertEqual(self.s["pril-1"][1], "ПРАВИЛА определения размера штрафа")

    def test_lost_line_breaks_in_titles_are_repaired(self):
        body = (
            "<h4>Об утверждении Правил определения размера штрафа,  начисляемогов случае исполнения "
            "контрактом(за исключением просрочки) </h4>"
            "<p>1. Штраф,  начисляемого в случае просрочки,  не взыскивается,  если контрактом "
            "(за исключением случаев) иное не установлено.</p>"
            "<h4>ИЗМЕНЕНИЯ, которые вносятся в постановление</h4>"
        )
        self.assertEqual(
            html_paragraphs(body),
            [
                ("title", "Об утверждении Правил определения размера штрафа, начисляемого в случае исполнения "
                 "контрактом (за исключением просрочки)"),
                ("", "1. Штраф, начисляемого в случае просрочки, не взыскивается, если контрактом "
                 "(за исключением случаев) иное не установлено."),
                ("title", "ИЗМЕНЕНИЯ, которые вносятся в постановление"),
            ],
        )

    def test_single_spaces_are_kept_when_site_did_not_double_them(self):
        paras = html_paragraphs("<p>Статьи 3, 4 и 5 (в части сроков) применяются.</p>")
        self.assertEqual(paras, [("", "Статьи 3, 4 и 5 (в части сроков) применяются.")])


if __name__ == "__main__":
    unittest.main()
