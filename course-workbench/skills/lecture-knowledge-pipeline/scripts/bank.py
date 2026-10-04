#!/usr/bin/env python3
"""题库维护：追加题目、覆盖度统计、按知识点抽题、重复检测、错题记录。"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

DEFAULT_DUPE_RATIO = 0.85


def load(path: str) -> dict:
    if not os.path.exists(path):
        return {"course": "", "updated": "", "items": []}
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SystemExit(f"题库格式错误（应为对象）：{path}")
    items = data.setdefault("items", [])
    if not isinstance(items, list):
        raise SystemExit(f"题库格式错误（items 应为数组）：{path}")
    return data


def save(path: str, data: dict) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def next_id(items: list[dict]) -> str:
    top = 0
    for item in items:
        ident = str(item.get("id", ""))
        if ident.startswith("Q") and ident[1:].isdigit():
            top = max(top, int(ident[1:]))
    return f"Q{top + 1:03d}"


def stem_of(item: dict) -> str:
    stem = item.get("stem") or item.get("question") or ""
    return " ".join(str(stem).split())


def find_dupes(items: list[dict], ratio: float) -> list[tuple[str, str, float]]:
    found: list[tuple[str, str, float]] = []
    stems = [stem_of(item) for item in items]
    for i in range(len(items)):
        if not stems[i]:
            continue
        for j in range(i + 1, len(items)):
            if not stems[j]:
                continue
            score = difflib.SequenceMatcher(None, stems[i], stems[j]).ratio()
            if score >= ratio:
                found.append(
                    (str(items[i].get("id", "?")), str(items[j].get("id", "?")), score)
                )
    return found


def matches_scope(item: dict, tag: str) -> bool:
    return any(str(p).startswith(tag) for p in item.get("pointIds", []) or [])


def cmd_add(args: argparse.Namespace) -> int:
    with open(args.file, encoding="utf-8") as handle:
        payload = json.load(handle)
    incoming = payload.get("items", payload) if isinstance(payload, dict) else payload
    if not isinstance(incoming, list):
        raise SystemExit("导入文件应为题目数组，或含 items 数组的对象。")

    data = load(args.bank)
    items = data["items"]
    added, skipped = 0, 0

    for item in incoming:
        if not isinstance(item, dict):
            raise SystemExit("题目条目应为对象。")
        stem = stem_of(item)
        duplicate_of = None
        if stem:
            for existing in items:
                prior = stem_of(existing)
                if not prior:
                    continue
                score = difflib.SequenceMatcher(None, stem, prior).ratio()
                if score >= args.ratio:
                    duplicate_of = (existing.get("id", "?"), score)
                    break
        if duplicate_of and not args.keep_duplicates:
            print(
                f"跳过疑似重复：{item.get('id', '(无 ID)')} 与 "
                f"{duplicate_of[0]} 相似度 {duplicate_of[1]:.2f}"
            )
            skipped += 1
            continue

        item.setdefault("id", next_id(items))
        item.setdefault("created", "")
        item.setdefault("attempts", 0)
        item.setdefault("wrongCount", 0)
        item.setdefault("pointIds", [])
        item.setdefault("difficulty", "")
        item.setdefault("type", "single")
        item.setdefault("answer", [])
        if isinstance(item["answer"], str):
            item["answer"] = [item["answer"]]
        items.append(item)
        added += 1

    if args.course:
        data["course"] = args.course
    if args.updated:
        data["updated"] = args.updated
    save(args.bank, data)
    print(f"新增 {added} 题，跳过 {skipped} 题，题库现有 {len(items)} 题。")
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    data = load(args.bank)
    items = data["items"]
    print(f"题库：{args.bank}")
    print(f"课程：{data.get('course') or '(未填)'}    更新：{data.get('updated') or '(未填)'}")
    print(f"总题量：{len(items)}")

    by_point: dict[str, int] = {}
    by_difficulty: dict[str, int] = {}
    by_type: dict[str, int] = {}
    extension = 0
    for item in items:
        for point in item.get("pointIds", []) or ["(未标注)"]:
            by_point[point] = by_point.get(point, 0) + 1
        by_difficulty[item.get("difficulty") or "(未标注)"] = (
            by_difficulty.get(item.get("difficulty") or "(未标注)", 0) + 1
        )
        by_type[item.get("type") or "(未标注)"] = (
            by_type.get(item.get("type") or "(未标注)", 0) + 1
        )
        if item.get("isExtension"):
            extension += 1

    def dump(title: str, table: dict[str, int]) -> None:
        print(f"\n{title}")
        for key in sorted(table, key=lambda k: (-table[k], k)):
            print(f"  {key}: {table[key]}")

    dump("按知识点", by_point)
    dump("按难度", by_difficulty)
    dump("按题型", by_type)
    if extension:
        print(f"\n拓展题：{extension}")

    wrong = [i for i in items if i.get("wrongCount")]
    if wrong:
        print(f"\n有错题记录的题目：{len(wrong)} 道")
        for item in sorted(wrong, key=lambda i: -int(i.get("wrongCount", 0)))[:20]:
            print(f"  {item.get('id')}  错 {item.get('wrongCount')} 次")

    if args.outline and os.path.exists(args.outline):
        with open(args.outline, encoding="utf-8") as handle:
            outline = json.load(handle)
        points: list[str] = []
        for unit in outline.get("units", []):
            for section in unit.get("sections", []):
                for point in section.get("points", []):
                    points.append(str(point.get("id")))
        gaps = [p for p in points if by_point.get(p, 0) == 0]
        print(f"\n覆盖缺口：{len(gaps)}/{len(points)} 个知识点尚无题目")
        for point in gaps[:40]:
            print(f"  {point}")
    return 0


def cmd_pick(args: argparse.Namespace) -> int:
    data = load(args.bank)
    pool = [i for i in data["items"] if matches_scope(i, args.tag)]
    if args.exclude_extension:
        pool = [i for i in pool if not i.get("isExtension")]
    if args.min_wrong:
        pool = [i for i in pool if int(i.get("wrongCount", 0)) >= args.min_wrong]
    if args.only_wrong:
        pool = [i for i in pool if int(i.get("wrongCount", 0)) > 0]

    if not pool:
        print(f"范围内没有匹配的题目：{args.tag}")
        return 0

    pool.sort(key=lambda i: (int(i.get("wrongCount", 0)), i.get("id", "")), reverse=True)
    chosen = pool[: args.n] if args.n else pool
    for item in chosen:
        print(f"{item.get('id')}  [{item.get('difficulty') or '?'}｜{item.get('type') or '?'}]")
        print(f"  知识点：{', '.join(item.get('pointIds', []) or ['(未标注)'])}")
        print(f"  {stem_of(item)}")
        print(f"  答案：{'、'.join(item.get('answer', []) or [])}")
        print()
    print(f"共 {len(pool)} 道匹配，列出 {len(chosen)} 道。")
    return 0


def cmd_dupes(args: argparse.Namespace) -> int:
    data = load(args.bank)
    found = find_dupes(data["items"], args.ratio)
    if not found:
        print(f"未发现相似度 ≥ {args.ratio} 的重复题。")
        return 0
    for left, right, score in found:
        print(f"{left} ≈ {right}  相似度 {score:.2f}")
    print(f"\n共 {len(found)} 组疑似重复。")
    return 0


def cmd_record(args: argparse.Namespace) -> int:
    data = load(args.bank)
    hit = False
    for item in data["items"]:
        if str(item.get("id")) == args.id:
            item["attempts"] = int(item.get("attempts", 0)) + 1
            if args.wrong:
                item["wrongCount"] = int(item.get("wrongCount", 0)) + 1
            if args.right and int(item.get("wrongCount", 0)) > 0:
                item["wrongCount"] = int(item.get("wrongCount", 0)) - 1
            hit = True
            print(
                f"{args.id} 已更新：作答 {item['attempts']} 次，"
                f"累计错误 {item.get('wrongCount', 0)} 次"
            )
            break
    if not hit:
        print(f"题库中找不到题目 {args.id}")
        return 1
    if args.updated:
        data["updated"] = args.updated
    save(args.bank, data)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="课程题库维护工具。")
    parser.add_argument("--version", action="version", version="bank.py 1.0")
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("add", help="把题目追加进题库")
    add.add_argument("bank")
    add.add_argument("--file", required=True, help="含题目数组或 items 数组的 JSON")
    add.add_argument("--course", default="", help="写入课程名")
    add.add_argument("--updated", default="", help="写入更新日期")
    add.add_argument("--ratio", type=float, default=DEFAULT_DUPE_RATIO)
    add.add_argument("--keep-duplicates", action="store_true", help="重复题也保留")
    add.set_defaults(func=cmd_add)

    stats = sub.add_parser("stats", help="覆盖度与难度分布")
    stats.add_argument("bank")
    stats.add_argument("--outline", default="", help="对照 outline.json 找覆盖缺口")
    stats.set_defaults(func=cmd_stats)

    pick = sub.add_parser("pick", help="按知识点前缀抽题")
    pick.add_argument("bank")
    pick.add_argument("--tag", required=True, help="知识点 ID 前缀，如 CN03-02")
    pick.add_argument("--n", type=int, default=0, help="抽取数量，0 表示全部")
    pick.add_argument("--only-wrong", action="store_true", help="只抽有错题记录的")
    pick.add_argument("--min-wrong", type=int, default=0, help="错误次数下限")
    pick.add_argument("--exclude-extension", action="store_true", help="排除拓展题")
    pick.set_defaults(func=cmd_pick)

    dupes = sub.add_parser("dupes", help="查重")
    dupes.add_argument("bank")
    dupes.add_argument("--ratio", type=float, default=DEFAULT_DUPE_RATIO)
    dupes.set_defaults(func=cmd_dupes)

    record = sub.add_parser("record", help="记录作答结果，用于错题重练")
    record.add_argument("bank")
    record.add_argument("--id", required=True)
    record.add_argument("--wrong", action="store_true")
    record.add_argument("--right", action="store_true")
    record.add_argument("--updated", default="")
    record.set_defaults(func=cmd_record)

    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
