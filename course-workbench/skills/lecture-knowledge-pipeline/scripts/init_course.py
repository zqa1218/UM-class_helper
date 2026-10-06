#!/usr/bin/env python3
"""为一门课建立流水线工作区与进度台账。

阶段目录与台账模板都不在本文件里：和课程工作台共用
../stages.json 与 ../assets/ledger-template.md，避免两边各写一份再慢慢走偏。
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_stages() -> list[tuple[str, str]]:
    """(目录名, 中文标签) 列表，顺序即台账里的编号顺序。"""
    with open(os.path.join(SKILL_DIR, "stages.json"), encoding="utf-8") as handle:
        return [(stage["key"], stage["label"]) for stage in json.load(handle)]


def load_template() -> str:
    with open(
        os.path.join(SKILL_DIR, "assets", "ledger-template.md"), encoding="utf-8"
    ) as handle:
        return handle.read()


def render_ledger(template: str, name: str, root: str, stages: list[tuple[str, str]]) -> str:
    rows = "\n".join(
        f"| {index} · {label} | `{key}/` | 未开始 | |"
        for index, (key, label) in enumerate(stages)
    )
    values = {
        "name": name,
        "today": _dt.date.today().isoformat(),
        "root": root,
        "term": "未填",
        "teacher": "未填",
        "rows": rows,
    }
    for key, value in values.items():
        template = template.replace("{" + key + "}", value)
    return template


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="建立课程流水线工作区。")
    parser.add_argument("root", help="课程目录")
    parser.add_argument("--name", required=True, help="课程名，写入台账标题")
    parser.add_argument(
        "--force-ledger",
        action="store_true",
        help="覆盖已存在的 COURSE.md（默认保留）",
    )
    args = parser.parse_args(argv)

    root = os.path.abspath(args.root)
    os.makedirs(root, exist_ok=True)

    stages = load_stages()
    for key, _label in stages:
        os.makedirs(os.path.join(root, key), exist_ok=True)

    ledger_path = os.path.join(root, "COURSE.md")
    if os.path.exists(ledger_path) and not args.force_ledger:
        print(f"台账已存在，保留原文件：{ledger_path}")
    else:
        with open(ledger_path, "w", encoding="utf-8") as handle:
            handle.write(render_ledger(load_template(), args.name, root, stages))
        print(f"已创建台账：{ledger_path}")

    for key, label in stages:
        print(f"  {key}/  {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
