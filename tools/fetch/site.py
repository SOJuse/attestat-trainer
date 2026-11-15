#!/usr/bin/env python3
"""Снимок страницы аттестации и действующих файлов с неё.

Запуск из корня репозитория:  python3 tools/fetch/site.py content/sources

Нормативные акты попадают в <dir>/site, решения комиссии со списками людей —
в <dir>/private (папка не входит в репозиторий). Таблица загрузок пишется
в <dir>/SOURCES.md.
"""
import datetime
import hashlib
import pathlib
import re
import subprocess
import sys
import time
import urllib.parse

PAGE = "https://corp-univer.ru/аттестация-руководящих-кадров/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
CURRENT = re.compile(r"2025-2026|2026-2027|25-26|26-27")
FILE_LINK = re.compile(r'href="([^"]+\.(?:pdf|docx?|xlsx?))"', re.I)


def curl(url: str, dest: pathlib.Path) -> bool:
    quoted = urllib.parse.quote(url, safe=":/?=&%#")
    r = subprocess.run(
        ["curl", "-sSL", "--fail", "--max-time", "120", "-A", UA, "-o", str(dest), quoted]
    )
    return r.returncode == 0


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    root = pathlib.Path(sys.argv[1])
    site, private = root / "site", root / "private"
    site.mkdir(parents=True, exist_ok=True)
    private.mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().isoformat()

    page = site / "page.html"
    if not curl(PAGE, page):
        print("не удалось скачать страницу", file=sys.stderr)
        return 1
    html = page.read_text(encoding="utf-8", errors="ignore")
    links = sorted({urllib.parse.unquote(u) for u in FILE_LINK.findall(html)})
    wanted = [u for u in links if CURRENT.search(u) or "/ATT/" not in u]

    rows, failed = [], []
    for url in wanted:
        # Пр-930 и Пр-774 — составы комиссии, то есть тоже списки людей
        is_private = (
            "/Reshenie-AK/" in url
            or "ПР_ат" in url
            or "ат24" in url
            or "Пр-930" in url
            or "Пр-774" in url
        )
        dest = (private if is_private else site) / url.rsplit("/", 1)[-1]
        if not dest.exists():
            if not curl(url, dest):
                failed.append(url)
                continue
            time.sleep(1)
        if not is_private:
            rows.append((dest.name, url, today, dest.stat().st_size, sha256(dest)))

    # файлы, положенные вручную из архива заказчика
    listed = {r[0] for r in rows} | {"page.html"}
    for extra in sorted(list((root / "list").glob("*.pdf")) + list(site.glob("*.pdf"))):
        if extra.name not in listed:
            rows.append((extra.name, "архив заказчика", today, extra.stat().st_size, sha256(extra)))
    rows.append(("page.html", PAGE, today, page.stat().st_size, sha256(page)))

    n_private = len(list(private.iterdir()))
    out = [
        "# Исходные материалы",
        "",
        f"Снимок сделан {today} скриптом `tools/fetch/site.py`.",
        "",
        f"Решения аттестационной комиссии ({n_private} файлов) лежат в `private/`. "
        "В них списки людей, поэтому в репозиторий они не входят и здесь не перечислены.",
        "",
        "| Файл | Источник | Дата | Байт | SHA-256 |",
        "|---|---|---|---|---|",
    ]
    out += [f"| {n} | {u} | {d} | {s} | `{h}` |" for n, u, d, s, h in sorted(rows)]
    (root / "SOURCES.md").write_text("\n".join(out) + "\n", encoding="utf-8")

    print(f"ссылок на странице: {len(links)}, отобрано: {len(wanted)}, не скачано: {len(failed)}")
    for u in failed:
        print("  не скачано:", u)
    return 0


if __name__ == "__main__":
    sys.exit(main())
