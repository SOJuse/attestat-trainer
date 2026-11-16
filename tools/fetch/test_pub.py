"""Тесты выбора акта на портале (без сети). Запуск: python3 -m unittest tools/fetch/test_pub.py"""
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pub import date_words, pick, portal_number, short_ref, title_similarity  # noqa: E402

EDU = "Приказы и распоряжения Министерства просвещения РФ, Министерства образования и науки и высшего образования РФ, Рособрнадзора"


def item(eo, number, complex_name, name=None, partial=False):
    return {"eoNumber": eo, "number": number, "complexName": complex_name, "name": name or complex_name, "partial": partial}


class Numbers(unittest.TestCase):
    def test_portal_number(self):
        self.assertEqual(portal_number("N 776н"), "776н")
        self.assertEqual(portal_number("N232/551"), "232/551")
        self.assertEqual(portal_number("N 845, 369"), "845/369")
        self.assertEqual(portal_number("N 328-ПП"), "328-ПП")

    def test_date_words(self):
        self.assertEqual(date_words("2021-05-31"), "31 мая 2021 г.")


class Pick(unittest.TestCase):
    ENTRY = {
        "id": "prikaz-196",
        "section": EDU,
        "kind": "ministry",
        "title": '"Об утверждении Порядка проведения аттестации педагогических работников организаций, '
        'осуществляющих образовательную деятельность"',
    }
    OURS = item(
        "0001202306020031",
        "196",
        'Приказ Министерства просвещения Российской Федерации от 24.03.2023 № 196\n "Об утверждении Порядка '
        'проведения аттестации педагогических работников организаций, осуществляющих образовательную деятельность"',
        "Об утверждении Порядка проведения аттестации педагогических работников организаций, осуществляющих "
        "образовательную деятельность",
    )
    REGIONAL = item(
        "4000202303280014",
        "196",
        "Постановление Правительства Калужской области от 24.03.2023 № 196\n \"Об упразднении особо охраняемых территорий\"",
    )

    def test_regional_act_with_same_number_and_date_is_ignored(self):
        doc, status, _ = pick(self.ENTRY, [self.REGIONAL, self.OURS])
        self.assertEqual(status, "ok")
        self.assertEqual(doc["eoNumber"], "0001202306020031")

    def test_other_organ_only_means_not_found(self):
        doc, status, why = pick(self.ENTRY, [self.REGIONAL])
        self.assertIsNone(doc)
        self.assertEqual(status, "not-found")
        self.assertIn("Калужской", why)

    def test_different_title_is_rejected(self):
        other = dict(self.OURS, name="О внесении изменений в перечень профессий", complexName="Приказ Министерства "
                     "просвещения Российской Федерации от 24.03.2023 № 196\n \"О внесении изменений в перечень профессий\"")
        doc, status, _ = pick(self.ENTRY, [other])
        self.assertIsNone(doc)
        self.assertEqual(status, "mismatch")

    def test_list_section_does_not_restrict_the_organ(self):
        # ФГОС ООО (приказ Минпросвещения) стоит в списке литературы в разделе Минтруда
        entry = dict(self.ENTRY, section="Постановления, приказы и письма Министерства труда и социальной защиты")
        doc, status, _ = pick(entry, [self.OURS])
        self.assertEqual(status, "ok")

    def test_organ_named_in_the_title_is_checked(self):
        entry = dict(self.ENTRY, title="Приказ Минздрава России " + self.ENTRY["title"])
        doc, status, _ = pick(entry, [self.OURS])
        self.assertIsNone(doc)
        self.assertEqual(status, "not-found")

    def test_exact_number_beats_joint_number(self):
        joint = dict(self.OURS, eoNumber="0001202306020099", number="196/300", partial=True)
        doc, status, _ = pick(self.ENTRY, [joint, self.OURS])
        self.assertEqual(doc["eoNumber"], "0001202306020031")

    def test_registry_title_with_edition_mark_still_matches(self):
        entry = dict(self.ENTRY, title=self.ENTRY["title"] + " (ред. от 16.01.2026)")
        self.assertGreaterEqual(title_similarity(entry["title"], self.OURS["name"]), 0.99)


class References(unittest.TestCase):
    def test_short_reference_for_amended_by(self):
        self.assertEqual(
            short_ref('Приказ Министерства просвещения Российской Федерации от 01.02.2024 № 62\n "О внесении изменений"'),
            "приказ Минпросвещения России от 01.02.2024 № 62",
        )
        self.assertEqual(
            short_ref(
                "Приказ Министерства просвещения Российской Федерации, Федеральной службы по надзору в сфере "
                "образования и науки от 12.04.2024 № 243/802\n \"О внесении изменений\""
            ),
            "приказ Минпросвещения России и Рособрнадзора от 12.04.2024 № 243/802",
        )


if __name__ == "__main__":
    unittest.main()
