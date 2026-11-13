"""Dev-only: compare the vendored engine with FirepredictionCLI.exe output.

    <venv python> scripts/test_builtin_fireprediction.py

Requires D:\\Fireprediction\\FirepredictionCLI.exe (only for this comparison,
not at runtime).
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "py"))
sys.path.insert(0, str(ROOT / "py" / "vendor"))

from fireprediction import engine as fp_engine  # noqa: E402

CLI = Path(r"D:\Fireprediction\FirepredictionCLI.exe")
IMAGES = Path(r"D:\Fireprediction\examples\images")


CASES = [
    ("01_桌子.jpg", "桌子", 120, 75, 60, "cm", "general"),
    ("02_椅子.jpg", "椅子", 45, 90, 50, "cm", "general"),
    ("03_凳子.jpg", "凳子", 35, 45, 35, "cm", "general"),
    ("04_床.jpg", "床", 200, 60, 180, "cm", "general"),
    ("05_扶手椅.jpg", "扶手椅", 80, 100, 85, "cm", "general"),
    ("06_沙发.jpg", "沙发", 220, 90, 95, "cm", "general"),
    ("cabinet_reference.jpg", "柜子", 120, 200, 60, "cm", "cabinet_experimental"),
    ("volume_reference.jpg", "架子", 100, 180, 40, "mm", "general"),
]


def compare(label: str, left, right, path: str = "") -> float:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        scale = max(abs(float(left)), abs(float(right)), 1e-12)
        delta = abs(float(left) - float(right)) / scale
    else:
        delta = 0.0 if left == right else 1.0
    flag = "OK " if delta < 1e-9 else ("~  " if delta < 1e-6 else "BAD")
    if delta >= 1e-9:
        print(f"  {flag} {path}: cli={left!r} builtin={right!r} rel={delta:.3e}")
    return delta


def main() -> int:
    if not CLI.is_file():
        print(f"SKIP: CLI not found at {CLI}")
        return 0
    engine = fp_engine.FirepredictionEngine(cpu_threads=4)
    print(json.dumps(engine.info(), ensure_ascii=False))
    worst = 0.0
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, category, width, height, depth, unit, profile in CASES:
            image = IMAGES / name
            if not image.is_file():
                print(f"SKIP {name}: missing")
                continue
            out = Path(tmp) / f"{name}.json"
            command = [
                str(CLI), "predict",
                "--category", category,
                "--width", str(width), "--height", str(height), "--depth", str(depth),
                "--unit", unit,
                "--image", str(image),
                "--output", str(out),
            ]
            if profile != "general":
                command += ["--volume-profile", profile]
            result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
            if result.returncode != 0 or not out.is_file():
                print(f"CLI failed for {name}: {result.returncode} {result.stderr[:300]}")
                failures += 1
                continue
            cli = json.loads(out.read_text(encoding="utf-8"))
            builtin = engine.predict(
                image, category, width, height, depth, unit=unit, volume_profile=profile
            )
            print(f"case {name} ({category} {profile})")
            worst = max(worst, compare("mass", cli["mass"]["estimated_kg"], builtin["mass"]["estimated_kg"], "mass.estimated_kg"))
            worst = max(worst, compare("image_kg", cli["mass"]["image_component_kg"], builtin["mass"]["image_component_kg"], "mass.image_component_kg"))
            worst = max(worst, compare("ratio", cli["volume"]["ratio"], builtin["volume"]["ratio"], "volume.ratio"))
            worst = max(worst, compare("volume", cli["volume"]["estimated_m3"], builtin["volume"]["estimated_m3"], "volume.estimated_m3"))
            worst = max(worst, compare("bbox", cli["volume"]["bbox_m3"], builtin["volume"]["bbox_m3"], "volume.bbox_m3"))
            worst = max(worst, compare("model", cli["volume"]["model_id"], builtin["volume"]["model_id"], "volume.model_id"))
            worst = max(worst, compare("profile", cli["volume"]["profile"], builtin["volume"]["profile"], "volume.profile"))
            worst = max(worst, compare("sha", cli["image"]["sha256"], builtin["image"]["sha256"], "image.sha256"))
    print(f"worst relative delta: {worst:.3e}  failures={failures}")
    if failures:
        return 1
    return 0 if worst < 1e-6 else 1


if __name__ == "__main__":
    raise SystemExit(main())
