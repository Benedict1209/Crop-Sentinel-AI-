"""Download the pinned model artifacts into services/inference/weights/.

Every file is pinned to a repository commit and verified by SHA-256, so a
re-fetch either reproduces the verified bytes or fails loudly. The weights are
kept out of version control (see .gitignore); this script is how a fresh
checkout obtains them.

Usage:
    python services/inference/fetch_models.py            # both crops
    python services/inference/fetch_models.py --crop cotton
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from cropsentinel_inference import registry  # noqa: E402

WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"

#: Extra (small) repository files kept next to the weights so the class-index
#: mapping is read from the published source rather than from our own code.
EXTRA_FILES = {
    "cotton": ["classes.json", "metadata.json", "README.md"],
    "soybean": ["config.json", "README.md"],
}

FILE_NAMES = {"cotton": "classes.json", "soybean": "config.json"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url) as response, tmp.open("wb") as fh:
        while True:
            chunk = response.read(1024 * 256)
            if not chunk:
                break
            fh.write(chunk)
            print(".", end="", flush=True)
    print()
    tmp.replace(dest)


def _raw_url(spec: registry.ModelSpec, filename: str) -> str:
    return f"{spec.source_url}/resolve/{spec.revision}/{filename}"


def fetch_crop(spec: registry.ModelSpec) -> dict:
    print(f"\n[{spec.crop}] {spec.model_id} @ {spec.revision[:12]}")
    weights_path = registry.weights_path(spec, WEIGHTS_DIR)
    if weights_path.exists() and _sha256(weights_path) == spec.weights_sha256:
        print(f"  ok   {weights_path.relative_to(WEIGHTS_DIR)} (checksum already verified)")
    else:
        name = Path(spec.weights_file).name
        print(f"  get  {name} ({spec.weights_bytes / 1e6:.1f} MB)")
        _download(_raw_url(spec, name), weights_path)
        actual = _sha256(weights_path)
        if actual != spec.weights_sha256:
            raise SystemExit(
                f"  FAIL checksum mismatch for {name}: expected {spec.weights_sha256}, got {actual}"
            )
        print(f"  ok   {name} sha256 verified")

    for extra in EXTRA_FILES[spec.crop]:
        dest = weights_path.parent / extra
        if dest.exists():
            print(f"  ok   {extra}")
            continue
        print(f"  get  {extra}")
        _download(_raw_url(spec, extra), dest)

    return {
        "crop": spec.crop,
        "modelId": spec.model_id,
        "revision": spec.revision,
        "weightsFile": spec.weights_file,
        "sha256": spec.weights_sha256,
        "bytes": spec.weights_bytes,
        "license": spec.license,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--crop", choices=registry.supported_crops(), action="append")
    args = parser.parse_args()
    targets = registry.SPECS if not args.crop else [
        s for s in registry.SPECS if s.crop in args.crop
    ]
    manifest = [fetch_crop(s) for s in targets]
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    (WEIGHTS_DIR / "manifest.json").write_text(
        json.dumps({"files": manifest}, indent=2), encoding="utf-8"
    )
    print(f"\nmanifest written to {WEIGHTS_DIR / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
