"""Запись документа корпуса: content/docs/<id>/text.md и meta.yaml.

Раздел — список [якорь, заголовок, [абзацы], контекст]. Формат text.md тот же,
что у ips_text.to_markdown: «## {#якорь} Заголовок», под ним строка «> контекст»,
дальше абзацы через пустую строку.
"""
import pathlib
import re

import yaml

ROOT = pathlib.Path("content/docs")
ANCHOR = re.compile(r"^((preambula|podpis)(-dup\d+)?|(st|p|gl|razdel|pril)-[a-z0-9]+(-[a-z0-9]+)*)$")


def squeeze(text):
    return re.sub(r"\s+", " ", text.replace("\xa0", " ").replace("​", "")).strip()


def to_markdown(sections):
    lines, seen = [], set()
    for anchor, heading, body, context in sections:
        if not ANCHOR.match(anchor):
            raise ValueError(f"якорь не по формату: {anchor}")
        if anchor in seen:
            raise ValueError(f"повтор якоря: {anchor}")
        seen.add(anchor)
        body = [p for p in body if p.strip()]
        if not body:
            raise ValueError(f"пустой раздел: {anchor}")
        lines += [f"## {{#{anchor}}} {heading}", ""]
        if context:
            lines += [f"> {context}", ""]
        for p in body:
            # строка, начинающаяся с «## {#» или «> », была бы принята за разметку
            lines += [("\\" + p) if p.startswith(("## {#", "> ")) else p, ""]
    return "\n".join(lines)


def text_size(sections):
    return sum(len("\n\n".join(s[2])) for s in sections)


def write_doc(meta, sections, root=ROOT):
    """Пишет папку документа. Порядок полей meta.yaml — как у ips.py."""
    order = ["id", "title", "kind", "number", "date", "edition", "edition_status", "source_url",
             "fetched", "modules", "text", "note", "list_no"]
    meta = {k: meta[k] for k in order if meta.get(k) not in (None, "")}
    folder = pathlib.Path(root) / meta["id"]
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "text.md").write_text(to_markdown(sections), encoding="utf-8")
    (folder / "meta.yaml").write_text(
        yaml.safe_dump(meta, allow_unicode=True, sort_keys=False, width=110), encoding="utf-8"
    )
    return folder
