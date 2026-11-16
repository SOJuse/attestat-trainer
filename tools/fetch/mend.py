"""Чинит уже собранный text.md: возвращает в пункт абзацы, которые разбор принял за новый раздел.

Строку посреди абзаца распознавание иногда считает строкой по центру, то есть названием раздела.
Тогда конец пункта уезжал в отдельный раздел `razdel-N`, а следующие пункты получали это «название»
в строку контекста. Признак: текст такого раздела начинается со строчной буквы.

Разбор в pub_text.py исправлен так же; этот скрипт нужен, чтобы не распознавать сканы заново.

    python3 tools/fetch/mend.py            # показать, что изменится
    python3 tools/fetch/mend.py --write    # переписать text.md и якоря в topics.yaml
"""
import pathlib
import re
import sys

from pub_text import CONTINUES

HEAD = re.compile(r"^## \{#([^}]+)\} (.*)$")
RAZDEL = re.compile(r"^(.*?)razdel-(\d+)(-dup\d+)?$")


def parse(markdown):
    """text.md → [[якорь, заголовок, контекст, [абзацы]]]."""
    sections = []
    for block in re.split(r"(?m)^(?=## \{#)", markdown):
        if not block.strip():
            continue
        lines = block.split("\n")
        m = HEAD.match(lines[0])
        if not m:
            raise ValueError(f"не раздел: {lines[0][:60]}")
        paras = [p for p in "\n".join(lines[1:]).split("\n\n") if p.strip()]
        paras = [p.strip("\n") for p in paras]
        context = ""
        if paras and paras[0].startswith("> "):
            context = paras.pop(0)[2:]
        sections.append([m.group(1), m.group(2), context, paras])
    return sections


def render(sections):
    lines = []
    for anchor, heading, context, paras in sections:
        lines += [f"## {{#{anchor}}} {heading}", ""]
        if context:
            lines += [f"> {context}", ""]
        for p in paras:
            lines += [p, ""]
    return "\n".join(lines)


def mend(markdown):
    """Возвращает (новый текст, {старый якорь: новый якорь})."""
    sections = parse(markdown)
    out, moved, fake = [], {}, {}
    for anchor, heading, context, paras in sections:
        is_tail = RAZDEL.match(anchor) and paras and CONTINUES.match(paras[0]) and out
        if is_tail:
            prev = out[-1]
            prev[3].append(f"{heading} {paras[0]}")
            prev[3].extend(paras[1:])
            moved[anchor] = prev[0]
            fake[heading] = prev[2]
            continue
        if context in fake:
            context = fake[context]
        out.append([anchor, heading, context, paras])

    # оставшиеся разделы без номера нумеруются заново, как их пронумеровал бы разбор
    counters = {}
    for section in out:
        m = RAZDEL.match(section[0])
        if not m:
            continue
        prefix = m.group(1)
        counters[prefix] = counters.get(prefix, 0) + 1
        new = f"{prefix}razdel-{counters[prefix]}"
        if new != section[0]:
            moved[section[0]] = new
            section[0] = new
    # хвост мог уйти в раздел, который затем сам получил новый номер
    tails = {old: target for old, target in moved.items() if RAZDEL.match(old) and old not in {s[0] for s in out}}
    renamed = {old: new for old, new in moved.items()}
    for old, target in tails.items():
        if target in renamed and renamed[target] != target and not any(s[0] == target for s in out):
            moved[old] = renamed[target]
    return render(out), moved


def main(write):
    import yaml

    root = pathlib.Path(__file__).resolve().parents[2] / "content"
    renames = {}
    for meta_path in sorted(root.glob("docs/*/meta.yaml")):
        meta = yaml.safe_load(meta_path.read_text(encoding="utf-8"))
        if meta.get("text") != "ocr":
            continue
        text_path = meta_path.with_name("text.md")
        text = text_path.read_text(encoding="utf-8")
        mended, moved = mend(text)
        if not moved:
            continue
        renames[meta["id"]] = moved
        print(f"{meta['id']}: якорей изменено {len(moved)}")
        if write:
            text_path.write_text(mended, encoding="utf-8")

    topics_path = root / "topics.yaml"
    topics = topics_path.read_text(encoding="utf-8")
    data = yaml.safe_load(topics)
    touched = 0
    for module in data["modules"].values():
        for topic in module["topics"]:
            for doc in topic["docs"]:
                moved = renames.get(doc["doc"], {})
                new = []
                for anchor in doc.get("anchors", []):
                    target = moved.get(anchor, anchor)
                    touched += target != anchor
                    if target not in new:
                        new.append(target)
                doc["anchors"] = new
    print(f"якорей в topics.yaml к замене: {touched}")
    if write and touched:
        header = "".join(line for line in topics.splitlines(keepends=True) if line.startswith("#"))
        topics_path.write_text(header + yaml.safe_dump(data, allow_unicode=True, sort_keys=False, width=110), encoding="utf-8")
    return renames


if __name__ == "__main__":
    main("--write" in sys.argv)
