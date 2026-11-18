"""Ищет позднейшие изменения к распознанным актам, у которых поиск не проводился.

pub.py искал изменения только для позиций, где список литературы сам упоминал редакцию. У остальных
поля amended_by нет вовсе, и по meta.yaml нельзя отличить «изменений нет» от «не искали».
Скрипт проходит по таким документам и записывает amended_by: список найденных актов или пустой
список, который значит «искали, не нашли».

    python3 tools/fetch/amend_check.py            # показать
    python3 tools/fetch/amend_check.py --write    # записать в meta.yaml
"""
import pathlib
import sys
import time

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pub  # noqa: E402


def main(write):
    root = pathlib.Path(__file__).resolve().parents[2] / "content" / "docs"
    registry = {e["id"]: e for e in yaml.safe_load((root / "registry.yaml").read_text(encoding="utf-8"))["docs"]}
    for meta_path in sorted(root.glob("*/meta.yaml")):
        meta = yaml.safe_load(meta_path.read_text(encoding="utf-8"))
        if meta.get("text") != "ocr" or "amended_by" in meta:
            continue
        entry = registry.get(meta["id"])
        if not entry:
            print(f"{meta['id']}: нет в реестре")
            continue
        try:
            found = pub.search(entry["number"], entry["date"])
            doc, status, why = pub.pick(entry, found)
            if not doc:
                print(f"{meta['id']}: акт на портале не найден ({status}: {why})")
                continue
            later = pub.amendments(entry, doc, str(meta.get("edition") or entry["date"]))
        except Exception as e:  # сеть
            print(f"{meta['id']}: ошибка запроса: {e}")
            continue
        print(f"{meta['id']}: изменений {len(later)}" + ("" if not later else ": " + "; ".join(later)))
        if write:
            meta["amended_by"] = later
            ordered = {}
            for key, value in meta.items():
                if key == "note":
                    ordered["amended_by"] = later
                if key != "amended_by":
                    ordered[key] = value
            ordered.setdefault("amended_by", later)
            meta_path.write_text(yaml.safe_dump(ordered, allow_unicode=True, sort_keys=False, width=110), encoding="utf-8")
        time.sleep(0.5)


if __name__ == "__main__":
    main("--write" in sys.argv)
