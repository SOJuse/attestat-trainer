"""Расставляет верный вариант в заданиях с одним ответом по разным местам.

Авторы почти всегда пишут верный вариант первым. На экране программа варианты перемешивает,
но баланс базы (проект, раздел 5.4) требует ровного распределения и в исходниках.
Скрипт переставляет варианты целиком, вместе с их разборами; текст не меняется.
Уже опубликованные задания не трогает: их варианты могут стоять по номерам в чьём-то
незаконченном тесте.

    python3 tools/scripts/spread_options.py <модуль> [--write]
"""
import json
import pathlib
import re
import subprocess
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]


def published_ids():
    """id заданий из базы, зашитой в программу на main."""
    try:
        raw = subprocess.run(
            ["git", "show", "origin/main:app/src/bundled/tasks.json"], capture_output=True, text=True, cwd=ROOT, check=True
        ).stdout
        return {t["id"] for t in json.loads(raw)["tasks"]}
    except Exception:
        return set()


def split_tasks(text):
    parts = re.split(r"(?m)^(?=- id: )", text)
    return parts[0], parts[1:]


def reorder(block, target):
    """Ставит верный вариант на место target (с нуля), остальные сохраняют взаимный порядок."""
    start = block.index("\n  options:\n") + len("\n  options:\n")
    end = re.compile(r"(?m)^  [a-z_]+:").search(block, start).start()
    items = re.split(r"(?m)^(?=    - text:)", block[start:end])
    assert items[0] == "", "перед первым вариантом что-то есть"
    items = items[1:]
    correct = [i for i, item in enumerate(items) if re.search(r"(?m)^      correct: true\s*$", item)]
    assert len(correct) == 1, "верный вариант должен быть один"
    item = items.pop(correct[0])
    items.insert(min(target, len(items)), item)
    return block[:start] + "".join(items) + block[end:]


def main(module, write):
    skip = published_ids()
    files = sorted((ROOT / "content" / "tasks" / module).glob("*.yaml"))
    singles = []
    for path in files:
        for task in yaml.safe_load(path.read_text(encoding="utf-8")):
            if task["type"] == "single" and task["id"] not in skip:
                singles.append(task["id"])
    # места по кругу: 0, 1, 2, 3, 0, …; задания идут по id, так что результат воспроизводим
    target = {task_id: i % 4 for i, task_id in enumerate(sorted(singles))}
    counts = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        head, blocks = split_tasks(text)
        out = []
        for block in blocks:
            task_id = re.match(r"- id: (\S+)", block).group(1)
            if task_id in target:
                before = yaml.safe_load(block)[0]
                block = reorder(block, target[task_id])
                after = yaml.safe_load(block)[0]
                key = lambda o: (o["text"], o["correct"], o["why"])
                assert sorted(map(key, before["options"])) == sorted(map(key, after["options"])), task_id
                at = [o["correct"] for o in after["options"]].index(True)
                counts[at] = counts.get(at, 0) + 1
            out.append(block)
        if write:
            path.write_text(head + "".join(out), encoding="utf-8")
    print(f"{module}: заданий с одним ответом переставлено {len(target)}, пропущено опубликованных {len(skip)}")
    print("верный вариант по местам:", dict(sorted(counts.items())))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0], "--write" in sys.argv)
