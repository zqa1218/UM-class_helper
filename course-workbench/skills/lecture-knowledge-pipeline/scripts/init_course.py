#!/usr/bin/env python3
"""为一门课建立流水线工作区与进度台账。"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

STAGES = [
    ("00_source", "原始录音与课件"),
    ("01_transcript", "转写稿"),
    ("02_slides", "逐页文本与关键页图"),
    ("03_align", "页与讲述对齐"),
    ("04_corrections", "纠错清单"),
    ("05_supplements", "学科补充"),
    ("06_outline", "知识点大纲"),
    ("07_notes", "笔记与总结"),
    ("08_graph", "知识图谱"),
    ("09_quiz", "题库"),
]

LEDGER = """# {name} · 课程流水线台账

- 建立日期：{today}
- 课程目录：{root}

## 输入清单

| 类别 | 文件 | 备注 |
|---|---|---|
| 录音 | 待填 | 格式与时长 |
| 课件 | 待填 | pptx / pdf / 图片 |
| 已有转写稿 | 无 | |

## 阶段状态

状态取值：未开始 / 进行中 / 已完成 / 待确认

| 阶段 | 目录 | 状态 | 备注 |
|---|---|---|---|
{rows}

## 待老师确认项

纠错阶段中置信度低、需要向讲者核实的条目列在这里。

## 出题记录

| 日期 | 范围 | 题量 | 文件 |
|---|---|---|---|
"""


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

    for path, _label in STAGES:
        os.makedirs(os.path.join(root, path), exist_ok=True)

    ledger_path = os.path.join(root, "COURSE.md")
    if os.path.exists(ledger_path) and not args.force_ledger:
        print(f"台账已存在，保留原文件：{ledger_path}")
    else:
        rows = "\n".join(
            f"| {idx} · {label} | `{path}/` | 未开始 | |"
            for idx, (path, label) in enumerate(STAGES)
        )
        with open(ledger_path, "w", encoding="utf-8") as handle:
            handle.write(
                LEDGER.format(
                    name=args.name,
                    today=_dt.date.today().isoformat(),
                    root=root,
                    rows=rows,
                )
            )
        print(f"已创建台账：{ledger_path}")

    for path, label in STAGES:
        print(f"  {path}/  {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
