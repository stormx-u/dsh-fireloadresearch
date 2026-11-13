"""Probe tool A's physical.py against a real Fireprediction CLI export."""
import json
import sys

TOOL_A = r"C:\Users\Administrator\Documents\Codex\2026-11-06\https-github-com-zhouyc98-fire-load\outputs\furniture-material-tool"
sys.path.insert(0, TOOL_A)

import physical  # noqa: E402

EXPORT = r"D:\dsh workplace\.tmp\pred-table.json"
IMAGE = r"D:\Fireprediction\examples\images\01_桌子.jpg"

raw = open(EXPORT, "rb").read()
print("first bytes:", raw[:6])
print("utf-8 decodes:", end=" ")
try:
    raw.decode("utf-8")
    print("yes")
except UnicodeDecodeError as error:
    print("no ->", error)

result = physical.load_fireprediction(EXPORT, image_path=IMAGE)
print(json.dumps({key: result[key] for key in ("mass", "volume", "derived", "dimensions")}, ensure_ascii=False, indent=2))
print("association:", json.dumps(result["association"], ensure_ascii=False))
