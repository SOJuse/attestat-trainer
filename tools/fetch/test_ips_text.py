"""Тесты разбора HTML портала. Запуск: python3 -m unittest tools/fetch/test_ips_text.py

Фрагменты разметки взяты из настоящих ответов actual.pravo.gov.ru.
"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ips_text import to_sections  # noqa: E402

CMD = '<span class="cmd" cmdprm="gohash=abc goparaid=0 goback=1">от&nbsp;30.06.2006&nbsp;№&nbsp;90-ФЗ</span>'


def wrap(body):
    return f"<html><head><style>p.H{{font-weight:bold}}</style></head><body>{body}</body></html>"


def law(*parts):
    return wrap("".join(parts))


def article(num_html, title, *paras):
    body = "".join(f'<p id="p1">{p}</p>' for p in paras)
    return f'<p class="H" id="p0">Статья {num_html}. {title}</p><p>&nbsp;</p>{body}'


def anchors(sections):
    return [s[0] for s in sections]


class ArticleMode(unittest.TestCase):
    def test_superscript_index_becomes_dotted_number(self):
        doc = law(
            article("60", "Запрещение требовать", "Запрещается требовать."),
            article('60<span class="W9">1</span>', "Работа по совместительству", "Работник имеет право."),
            article('60<span class="W9">2</span>', "Совмещение профессий", "С письменного согласия."),
            article("601", "Вымышленная", "Текст."),
        )
        s = to_sections(doc)
        self.assertEqual(anchors(s), ["st-60", "st-60-1", "st-60-2", "st-601"])
        self.assertEqual(s[1][1], "Статья 60.1. Работа по совместительству")

    def test_three_level_number_does_not_collide(self):
        doc = law(
            article('6.1<span class="W9">1</span>', "Побои", "Нанесение побоев."),
            article("6.11", "Занятие проституцией", "Занятие проституцией."),
            article("6.12", "Получение дохода", "Получение дохода."),
        )
        self.assertEqual(anchors(to_sections(doc)), ["st-6-1-1", "st-6-11", "st-6-12"])

    def test_number_with_hyphen_suffix_is_an_article(self):
        doc = law(
            article('341<span class="W9">1-1</span>', "Организации", "Организации вправе."),
            article('341<span class="W9">1-2</span>', "Договор", "Договор заключается."),
            article('341<span class="W9">2</span>', "Особенности", "Особенности таковы."),
        )
        s = to_sections(doc)
        self.assertEqual(anchors(s), ["st-341-1-1", "st-341-1-2", "st-341-2"])
        self.assertEqual(s[0][1], "Статья 341.1-1. Организации")

    def test_superscript_inside_text(self):
        doc = law(
            article("81", "Расторжение", 'по пункту 7<span class="W9">1</span>) части первой статьи 71<span class="W9">1</span>'),
            article("82", "Б", "б"),
            article("83", "В", "в"),
        )
        self.assertEqual(to_sections(doc)[0][2], ["по пункту 7.1) части первой статьи 71.1"])

    def test_edition_notes_are_removed(self):
        doc = law(
            article(
                "256",
                "Отпуска по уходу за ребенком",
                f'По заявлению женщины ей предоставляется отпуск.<span class="mark"> (В редакции Федерального закона {CMD})</span>',
                f'<span class="mark">(О несоответствии Конституции - Постановление {CMD})</span>',
                '<span class="ed">Право на получение пособия сохраняется.</span>',
            ),
            article("257", "Б", "б"),
            article("258", "В", "в"),
        )
        self.assertEqual(
            to_sections(doc)[0][2],
            ["По заявлению женщины ей предоставляется отпуск.", "Право на получение пособия сохраняется."],
        )

    def test_repealed_article_keeps_its_own_note(self):
        doc = law(
            article("6", "Разграничение полномочий", "Текст шестой."),
            '<p class="H" id="p4590">Статья 7. </p>'
            f'<p class="H" id="p6426"><span class="mark">(Статья утратила силу&nbsp;- Федеральный закон {CMD})</span></p>',
            article("8", "Локальные нормативные акты", "Работодатели принимают акты."),
        )
        s = to_sections(doc)
        self.assertEqual(anchors(s), ["st-6", "st-7", "st-8"])
        self.assertEqual(s[1][2], ["(Статья утратила силу - Федеральный закон от 30.06.2006 № 90-ФЗ)"])
        self.assertEqual(s[2][2], ["Работодатели принимают акты."])

    def test_repealed_article_with_note_inside_heading_is_kept(self):
        doc = law(
            article("97", "А", "а"),
            f'<p class="H">Статья 98. <span class="mark">(Утратила силу - Федеральный закон {CMD})</span></p>',
            article("99", "Сверхурочная работа", "Сверхурочная работа - это работа."),
        )
        s = to_sections(doc)
        self.assertEqual(anchors(s), ["st-97", "st-98", "st-99"])
        self.assertEqual(s[1][1], "Статья 98.")
        self.assertEqual(s[1][2], ["(Утратила силу - Федеральный закон от 30.06.2006 № 90-ФЗ)"])

    def test_repealed_item_keeps_its_note_in_place(self):
        doc = law(
            article(
                "81",
                "Расторжение",
                "1) ликвидации организации;",
                f'2) <span class="mark">(Пункт утратил силу - Федеральный закон {CMD})</span>',
                f'3) несоответствия работника;<span class="mark"> (В редакции Федерального закона {CMD})</span>',
            ),
            article("82", "Б", "б"),
            article("83", "В", "в"),
        )
        self.assertEqual(
            to_sections(doc)[0][2],
            [
                "1) ликвидации организации;",
                "2) (Пункт утратил силу - Федеральный закон от 30.06.2006 № 90-ФЗ)",
                "3) несоответствия работника;",
            ],
        )

    def test_chapter_titles_go_to_the_next_article_never_the_previous(self):
        doc = law(
            '<p class="T">ЧАСТЬ ПЕРВАЯ</p><p class="C">Раздел I. ОБЩИЕ ПОЛОЖЕНИЯ</p>'
            '<p class="H">Глава 1. ОСНОВНЫЕ НАЧАЛА</p>',
            article("1", "Цели", "Целями являются."),
            '<p class="T">ЧАСТЬ ВТОРАЯ</p><p class="H">Глава 2. ОТНОШЕНИЯ</p>',
            article("2", "Принципы", "Принципы такие."),
            article("3", "Запрещение", "Запрещается."),
        )
        s = to_sections(doc)
        self.assertEqual(anchors(s), ["st-1", "st-2", "st-3"])
        self.assertEqual(s[0][2], ["Целями являются."])
        self.assertEqual(s[1][2], ["Принципы такие."])
        self.assertEqual(s[0][3], "ЧАСТЬ ПЕРВАЯ / Раздел I. ОБЩИЕ ПОЛОЖЕНИЯ / Глава 1. ОСНОВНЫЕ НАЧАЛА")
        self.assertEqual(s[1][3], "ЧАСТЬ ВТОРАЯ / Глава 2. ОТНОШЕНИЯ")
        self.assertEqual(s[2][3], "ЧАСТЬ ВТОРАЯ / Глава 2. ОТНОШЕНИЯ")

    def test_signature_is_its_own_section(self):
        doc = law(
            article("422", "А", "а"),
            article("423", "Б", "б"),
            article("424", "Применение", "Настоящий Кодекс применяется."),
            '<p class="Y" id="p2370">Президент Российской Федерации&nbsp;&nbsp;&nbsp;&nbsp;В.Путин</p>'
            "<p>Москва, Кремль</p><p>30&nbsp;декабря 2001&nbsp;года</p><p>№&nbsp;197-ФЗ</p>",
        )
        s = to_sections(doc)
        self.assertEqual(anchors(s), ["st-422", "st-423", "st-424", "podpis"])
        self.assertEqual(s[2][2], ["Настоящий Кодекс применяется."])
        self.assertEqual(s[3][2][0], "Президент Российской Федерации В.Путин")

    def test_line_breaks_do_not_glue_words(self):
        doc = law(
            article("1", "А", "нарушение отношений<br/>и (или) использование<br>электрической энергии"),
            article("2", "Б", "б"),
            article("3", "В", "в"),
        )
        self.assertEqual(to_sections(doc)[0][2], ["нарушение отношений и (или) использование электрической энергии"])


DECREE = wrap(
    '<p class="T">ПРАВИТЕЛЬСТВО РОССИЙСКОЙ ФЕДЕРАЦИИ</p><p class="T">ПОСТАНОВЛЕНИЕ</p>'
    '<p class="T">Об утверждении Правил оказания платных образовательных услуг</p>'
    "<p>В соответствии с частью 9 статьи 54 Правительство постановляет:</p>"
    "<p>1.&nbsp;Утвердить прилагаемые Правила.</p>"
    '<p>2.&nbsp;Настоящее постановление вступает в силу с 1 января 2021 г. и действует <span class="edx">до 1 сентября 2032 г.</span>'
    f'<span class="markx">&nbsp;(В редакции Постановления {CMD})</span></p>'
    '<p class="Y" id="p9">Председатель Правительства<br/>Российской Федерации&nbsp;&nbsp;&nbsp;М.Мишустин</p>'
    '<p class="S" id="p10">УТВЕРЖДЕНЫ<br/>постановлением Правительства<br/>Российской Федерации<br/>от&nbsp;15&nbsp;сентября 2020&nbsp;г. №&nbsp;1441</p>'
    '<p class="T" id="p11">ПРАВИЛА<br/>оказания платных образовательных услуг</p>'
    '<p class="C" id="p12">I. Общие положения</p>'
    "<p>1.&nbsp;Настоящие Правила определяют порядок.</p>"
    "<p>2.&nbsp;В настоящих Правилах используются понятия:</p><p>«заказчик» - лицо;</p>"
    '<p class="C">II. Информация о платных услугах</p>'
    "<p>3.&nbsp;Исполнитель обязан довести информацию.</p>"
)


class PointMode(unittest.TestCase):
    def test_act_points_and_annex_points_are_kept_apart(self):
        s = to_sections(DECREE)
        self.assertEqual(
            anchors(s),
            ["preambula", "p-1", "p-2", "podpis", "pril-1", "pril-1-p-1", "pril-1-p-2", "pril-1-p-3"],
        )

    def test_act_point_ends_before_signature(self):
        s = dict((x[0], x) for x in to_sections(DECREE))
        self.assertEqual(
            s["p-2"][2], ["2. Настоящее постановление вступает в силу с 1 января 2021 г. и действует до 1 сентября 2032 г."]
        )
        self.assertEqual(s["podpis"][2], ["Председатель Правительства Российской Федерации М.Мишустин"])

    def test_annex_has_readable_heading_and_stamp(self):
        s = dict((x[0], x) for x in to_sections(DECREE))
        self.assertEqual(s["pril-1"][1], "ПРАВИЛА оказания платных образовательных услуг")
        self.assertEqual(
            s["pril-1"][2][0], "УТВЕРЖДЕНЫ постановлением Правительства Российской Федерации от 15 сентября 2020 г. № 1441"
        )
        self.assertEqual(s["pril-1-p-2"][1], "Пункт 2. ПРАВИЛА оказания платных образовательных услуг")
        self.assertEqual(s["pril-1-p-2"][2], ["2. В настоящих Правилах используются понятия:", "«заказчик» - лицо;"])

    def test_section_title_inside_annex_belongs_to_the_next_point(self):
        s = dict((x[0], x) for x in to_sections(DECREE))
        self.assertEqual(s["pril-1-p-1"][3], "I. Общие положения")
        self.assertEqual(s["pril-1-p-3"][3], "II. Информация о платных услугах")
        self.assertNotIn("II. Информация о платных услугах", s["pril-1-p-2"][2])

    def test_unnumbered_text_under_a_new_title_gets_its_own_section(self):
        doc = wrap(
            "<p>1. Утвердить прилагаемые условия.</p><p>2. Вступает в силу.</p>"
            '<p class="S">УТВЕРЖДЕНЫ<br/>постановлением</p><p class="T">ТИПОВЫЕ УСЛОВИЯ</p>'
            '<p class="C">I. Условия об обязанностях исполнителя</p>'
            "<p>1. Исполнитель обязан обеспечить.</p><p>2. Исполнитель обязан хранить.</p>"
            '<p class="C">II. Условия об обязанностях заказчика</p>'
            "<p>Заказчик обязан предоставить помещения.</p><p>Заказчик вправе проверять.</p>"
        )
        s = to_sections(doc)
        self.assertEqual(
            anchors(s), ["p-1", "p-2", "pril-1", "pril-1-p-1", "pril-1-p-2", "pril-1-razdel-1"]
        )
        last = s[-1]
        self.assertEqual(last[1], "II. Условия об обязанностях заказчика")
        self.assertEqual(last[2], ["Заказчик обязан предоставить помещения.", "Заказчик вправе проверять."])
        self.assertEqual(s[-2][2], ["2. Исполнитель обязан хранить."])

    def test_table_rows_keep_their_cells_together(self):
        doc = wrap(
            "<p>1. Установить продолжительность отпуска согласно приложению.</p><p>2. Признать утратившим силу.</p>"
            '<p class="S">ПРИЛОЖЕНИЕ<br/>к постановлению</p><p class="T">Продолжительность отпусков</p>'
            "<table><tr><td><p>Наименования должностей работников</p></td><td><p>Продолжительность, дней</p></td></tr>"
            "<tr><td><p>Воспитатели, музыкальные руководители</p></td><td><p>42</p></td></tr>"
            "<tr><td><p>Учителя</p></td><td><p>56</p></td></tr></table>"
        )
        s = dict((x[0], x) for x in to_sections(doc))
        self.assertEqual(
            s["pril-1"][2][1:],
            [
                "Наименования должностей работников | Продолжительность, дней",
                "Воспитатели, музыкальные руководители | 42",
                "Учителя | 56",
            ],
        )


if __name__ == "__main__":
    unittest.main()
