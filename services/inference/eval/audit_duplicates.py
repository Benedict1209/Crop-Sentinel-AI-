"""Read-only duplicate and label-conflict audit for evaluation images.

This tool never writes to, deletes from, or relabels the dataset it inspects. It
reads a labelled directory tree (the form ``eval/evaluate.py`` consumes) and/or a
Hugging Face parquet file, and reports:

* exact duplicate groups (identical content, by SHA-256);
* near-duplicate groups (different bytes, perceptually equal by a dHash within a
  Hamming distance the caller chooses);
* any group whose members carry more than one label -- a label conflict.

Nothing is corrected here. A conflicting group is flagged so a human can decide
whether to exclude it before the metrics are trusted. ``evaluate.py`` keeps
consuming the original tree unchanged.

Usage:
    python services/inference/eval/audit_duplicates.py --data .scratch/eval/cotton \
        --labels services/inference/eval/labels.json --crop cotton --out audit.json
    python services/inference/eval/audit_duplicates.py \
        --parquet .scratch/parquet/cotton_bangladesh2_raw_train.parquet --per-class 70
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

AUDIT_SCRIPT_VERSION = "1.1.0"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
DHASH_SIZE = 8


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def dhash(image: Image.Image, hash_size: int = DHASH_SIZE) -> int:
    """Difference hash: 1 bit per (left > right) horizontal gradient.

    Returns an integer of ``hash_size * hash_size`` bits. Two images whose
    fractional bits differ by ``hamming`` are perceptually close; identical bytes
    always give distance 0.
    """
    width = hash_size + 1
    small = image.convert("L").resize((width, hash_size), Image.BILINEAR)
    pixels = np.asarray(small, dtype=np.int16)
    gradients = pixels[:, 1:] > pixels[:, :-1]
    bits = 0
    for value in gradients.reshape(-1):
        bits = (bits << 1) | int(value)
    return bits


def dhash_hex(value: int, hash_size: int = DHASH_SIZE) -> str:
    return f"{value:0{hash_size * hash_size // 4}x}"


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def _decode(data: bytes) -> Image.Image | None:
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.load()
        return Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        return None


def collect_tree(data_dir: Path, labels_file: Path, crop: str) -> list[dict]:
    """Read a ``<class-slug>/*.jpg`` tree without modifying it."""
    label_map = json.loads(labels_file.read_text(encoding="utf-8"))[crop]["classes"]
    records: list[dict] = []
    for directory in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        entry = label_map.get(directory.name)
        if entry is None:
            print(f"  warning: directory {directory.name!r} is not declared; skipped")
            continue
        for image in sorted(
            p for p in directory.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES
        ):
            data = image.read_bytes()
            decoded = _decode(data)
            records.append(
                {
                    "path": f"{directory.name}/{image.name}",
                    "directory": directory.name,
                    "label": entry["sourceClass"],
                    "modelClass": entry["modelClass"],
                    "sha256": sha256_bytes(data),
                    "dhash": dhash_hex(dhash(decoded)) if decoded is not None else None,
                    "inEvaluation": True,
                }
            )
    return records


def collect_parquet(parquet_path: Path, per_class: int | None) -> list[dict]:
    """Read a parquet file and mark which rows the first-N-per-class sampler took."""
    import pyarrow.parquet as pq

    table = pq.read_table(parquet_path)
    metadata = json.loads(table.schema.metadata[b"huggingface"].decode())
    label_names = metadata["info"]["features"]["label"]["names"]
    labels = table.column("label").to_pylist()
    image = table.column("image").combine_chunks()
    paths = image.field("path").to_pylist()
    payloads = image.field("bytes").to_pylist()

    taken: dict[str, int] = {}
    records: list[dict] = []
    for index, (label_index, path, data) in enumerate(zip(labels, paths, payloads)):
        name = label_names[label_index]
        in_evaluation = True
        if per_class is not None:
            in_evaluation = taken.get(name, 0) < per_class
            taken[name] = taken.get(name, 0) + 1
            if not in_evaluation:
                taken[name] = per_class  # clamp so counts keep their meaning
        decoded = _decode(data)
        records.append(
            {
                "path": path,
                "row": index,
                "directory": None,
                "label": name,
                "modelClass": None,
                "sha256": sha256_bytes(data),
                "dhash": dhash_hex(dhash(decoded)) if decoded is not None else None,
                "inEvaluation": in_evaluation,
            }
        )
    return records


def find_exact_groups(records: list[dict]) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for record in records:
        buckets.setdefault(record["sha256"], []).append(record)
    groups = []
    for digest, members in buckets.items():
        if len(members) > 1:
            groups.append({"sha256": digest, "count": len(members), "members": members})
    groups.sort(key=lambda g: (-g["count"], g["sha256"]))
    return groups


def find_near_groups(records: list[dict], max_distance: int) -> list[dict]:
    """Cluster distinct-SHA images whose dHash Hamming distance is <= max_distance."""
    # Deduplicate by exact digest first: identical bytes are reported as exact
    # groups, not as a near pair with distance 0.
    unique: dict[str, dict] = {}
    for record in records:
        if record["dhash"] is not None and record["sha256"] not in unique:
            unique[record["sha256"]] = record
    items = list(unique.values())
    hashes = [int(r["dhash"], 16) for r in items]

    parent = list(range(len(items)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[max(ri, rj)] = min(ri, rj)

    distances: dict[tuple[int, int], int] = {}
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            distance = hamming(hashes[i], hashes[j])
            if distance <= max_distance:
                union(i, j)
                distances[(i, j)] = distance

    clusters: dict[int, list[int]] = {}
    for i in range(len(items)):
        clusters.setdefault(find(i), []).append(i)

    groups = []
    for members_idx in clusters.values():
        if len(members_idx) < 2:
            continue
        members = [items[i] for i in members_idx]
        cluster_edges = [
            {
                "a": items[i]["path"],
                "aRow": items[i].get("row"),
                "b": items[j]["path"],
                "bRow": items[j].get("row"),
                "distance": distances[(i, j)],
            }
            for a, i in enumerate(members_idx)
            for j in members_idx[a + 1 :]
            if (i, j) in distances
        ]
        groups.append(
            {
                "count": len(members),
                "maxDistance": max(e["distance"] for e in cluster_edges)
                if cluster_edges
                else 0,
                "edges": cluster_edges,
                "members": members,
            }
        )
    groups.sort(key=lambda g: (-g["count"], g["maxDistance"]))
    return groups


def _labels(group: dict) -> list[str]:
    return sorted({m["label"] for m in group["members"]})


def conflicting_label_groups(groups: list[dict]) -> list[dict]:
    return [g for g in groups if len(_labels(g)) > 1]


def _member_view(member: dict) -> dict:
    return {
        "path": member["path"],
        "row": member.get("row"),
        "label": member["label"],
        "modelClass": member["modelClass"],
        "inEvaluation": member["inEvaluation"],
    }


def build_report(
    records: list[dict],
    source_kind: str,
    source_path: str,
    near_threshold: int,
    per_class: int | None,
) -> dict:
    exact = find_exact_groups(records)
    near = find_near_groups(records, near_threshold)
    conflicting = conflicting_label_groups(exact) + conflicting_label_groups(near)
    return {
        "auditScript": "services/inference/eval/audit_duplicates.py",
        "auditScriptVersion": AUDIT_SCRIPT_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "kind": source_kind,
            "path": source_path,
            "perClassSample": per_class,
            "exactHash": "sha256",
            "perceptualHash": f"dhash-{DHASH_SIZE}",
            "nearThreshold": near_threshold,
        },
        "counts": {
            "images": len(records),
            "uniqueExact": len({r["sha256"] for r in records}),
            "exactDuplicateGroups": len(exact),
            "nearDuplicateGroups": len(near),
            "conflictingLabelGroups": len(conflicting),
            "exactDuplicatesInEvaluation": sum(
                len(g["members"]) for g in exact if g["members"][0]["inEvaluation"]
            ),
            "nearDuplicateGroupsInEvaluation": sum(
                1 for g in near if any(m["inEvaluation"] for m in g["members"])
            ),
        },
        "exactDuplicateGroups": [
            {
                "sha256": g["sha256"],
                "count": g["count"],
                "labels": _labels(g),
                "conflict": len(_labels(g)) > 1,
                "members": [_member_view(m) for m in g["members"]],
            }
            for g in exact
        ],
        "nearDuplicateGroups": [
            {
                "count": g["count"],
                "maxDistance": g["maxDistance"],
                "labels": _labels(g),
                "conflict": len(_labels(g)) > 1,
                "members": [_member_view(m) for m in g["members"]],
            }
            for g in near
        ],
    }


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def render_markdown(report: dict) -> str:
    lines: list[str] = []
    add = lines.append
    counts = report["counts"]
    add("# Duplicate / label-conflict audit")
    add("")
    add(f"Generated by `{report['auditScript']}` v{report['auditScriptVersion']} at "
        f"{report['generatedAt']}.")
    add(f"Source: `{report['source']['path']}` ({report['source']['kind']}); "
        f"exact hash {report['source']['exactHash']}, "
        f"perceptual {report['source']['perceptualHash']}, "
        f"near threshold {report['source']['nearThreshold']}.")
    add("")
    add(f"- Images read: **{counts['images']}**; unique by content: "
        f"**{counts['uniqueExact']}**")
    add(f"- Exact duplicate groups: **{counts['exactDuplicateGroups']}**; "
        f"near-duplicate groups: **{counts['nearDuplicateGroups']}**; "
        f"groups with conflicting labels: **{counts['conflictingLabelGroups']}**")
    add(f"- Near-duplicate groups touching the evaluation sample: "
        f"**{counts['nearDuplicateGroupsInEvaluation']}**")
    add("")
    add("## Exact duplicate groups")
    add("")
    if not report["exactDuplicateGroups"]:
        add("None.")
    for group in report["exactDuplicateGroups"]:
        flag = " — **CONFLICTING LABELS**" if group["conflict"] else ""
        add(f"- `{group['sha256'][:16]}…` × {group['count']}{flag}: "
            f"{', '.join(group['labels'])}")
        for member in group["members"]:
            where = f"row {member['row']}" if member.get("row") is not None else member["path"]
            add(f"    - {where} — {member['label']}"
                f"{' (in evaluation)' if member['inEvaluation'] else ' (not in evaluation)'}")
    add("")
    add("## Near-duplicate groups")
    add("")
    if not report["nearDuplicateGroups"]:
        add("None at this threshold.")
    for group in report["nearDuplicateGroups"]:
        flag = " — **CONFLICTING LABELS**" if group["conflict"] else ""
        add(f"- {group['count']} images, max Hamming {group['maxDistance']}{flag}: "
            f"{', '.join(group['labels'])}")
        for member in group["members"]:
            where = f"row {member['row']}" if member.get("row") is not None else member["path"]
            add(f"    - {where} — {member['label']}"
                f"{' (in evaluation)' if member['inEvaluation'] else ' (not in evaluation)'}")
    add("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, help="labelled <class-slug>/*.jpg tree")
    parser.add_argument("--labels", type=Path, default=Path(__file__).resolve().parent / "labels.json")
    parser.add_argument("--crop", help="crop key in labels.json (required with --data)")
    parser.add_argument("--parquet", type=Path, help="Hugging Face parquet file to audit")
    parser.add_argument("--per-class", type=int, help="mark the first N rows per label as in-evaluation")
    parser.add_argument("--near-threshold", type=int, default=0, help="dHash Hamming distance (default 0)")
    parser.add_argument("--out", type=Path, help="write the JSON report here")
    parser.add_argument("--markdown", type=Path, help="write a markdown report here")
    args = parser.parse_args()

    if not args.data and not args.parquet:
        parser.error("provide --data and/or --parquet")
    if args.data and args.parquet:
        parser.error("provide only one of --data or --parquet per run")

    if args.data:
        if not args.crop:
            parser.error("--crop is required with --data")
        records = collect_tree(args.data, args.labels, args.crop)
        report = build_report(records, "directory", str(args.data), args.near_threshold, None)
    else:
        records = collect_parquet(args.parquet, args.per_class)
        report = build_report(
            records, "parquet", str(args.parquet), args.near_threshold, args.per_class
        )

    print(render_markdown(report))
    if args.out:
        args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    if args.markdown:
        args.markdown.write_text(render_markdown(report), encoding="utf-8")
        print(f"wrote {args.markdown}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
