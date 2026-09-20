#!/usr/bin/env python3
import difflib
from pathlib import Path
from typing import List


ROOT = Path(__file__).resolve().parents[1]
GROUND_TRUTH = ROOT / "ground-truth"


def diff_file(old_path: Path, new_path: Path, relative: Path) -> List[str]:
    old = old_path.read_text(encoding="utf-8").splitlines(keepends=True)
    new = new_path.read_text(encoding="utf-8").splitlines(keepends=True)
    return list(difflib.unified_diff(old, new, fromfile="a/{}".format(relative), tofile="b/{}".format(relative)))


def main() -> None:
    human = diff_file(
        ROOT / "app" / "speech_service.py",
        ROOT / "oracle" / "post_migration" / "speech_service.py",
        Path("app/speech_service.py"),
    )
    (GROUND_TRUTH / "human-fix.patch").write_text("".join(human), encoding="utf-8")

    variants = GROUND_TRUTH / "adversarial" / "variants"
    for variant in sorted(path for path in variants.iterdir() if path.is_dir()):
        patch: List[str] = []
        for changed in sorted((variant / "app").glob("*.py")):
            relative = Path("app") / changed.name
            patch.extend(diff_file(ROOT / relative, changed, relative))
        (GROUND_TRUTH / "adversarial" / "{}.patch".format(variant.name)).write_text("".join(patch), encoding="utf-8")


if __name__ == "__main__":
    main()
