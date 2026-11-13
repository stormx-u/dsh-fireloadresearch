"""End-to-end harness for py/bridge.py (development only, never shipped).

It behaves like the plugin host would: writes the request on stdin line 1 and
answers ``decision`` messages with a deterministic response, so the whole
pipeline (Fireprediction CLI -> YOLO -> review -> composition -> heat) can be
exercised without any API key.

    python scripts/test_bridge.py --request req.json
    python scripts/test_bridge.py --request req.json --answer first
    python scripts/test_bridge.py --catalog | --check
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

BRIDGE = Path(__file__).resolve().parent.parent / "py" / "bridge.py"


def make_answers(mode: str, payload: dict) -> dict:
    """Deterministic answer for a host ``decision`` request."""
    answers: dict = {}
    for question in payload.get("questions") or []:
        criteria = list((question.get("criteria") or {}).keys())
        question_id = str(question.get("id"))
        if not criteria:
            continue
        extras = [name for name in criteria if name != "unknown"]
        if mode == "first" and extras and question_id not in {"furniture_type", "visible_metal"}:
            winner = extras[0]
            probabilities = {name: (1.0 - 0.9) / max(1, len(criteria) - 1) for name in criteria}
            probabilities[winner] = 0.9
        else:
            probabilities = {name: (1.0 if name == "unknown" else 0.0) for name in criteria}
        best = max(probabilities, key=probabilities.get)
        answers[question_id] = {"choice": best, "probabilities": probabilities}
    return answers


def run(request: dict, python_exe: str, mode: str, timeout: float = 900.0) -> int:
    environment = dict(os.environ)
    environment["PYTHONIOENCODING"] = "utf-8"
    process = subprocess.Popen(
        [python_exe, str(BRIDGE)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
        env=environment,
    )
    started = time.monotonic()
    messages: list[dict] = []
    progress: list[str] = []
    assert process.stdin and process.stdout
    process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
    process.stdin.flush()
    try:
        for line in process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except ValueError:
                print(f"[non-json] {line[:200]}")
                continue
            messages.append(message)
            if message["type"] == "progress":
                progress.append(f"{message.get('stage')}: {message.get('message')}")
            elif message["type"] == "decision":
                answers = make_answers(mode, message.get("payload") or {})
                reply = {"type": "decision-answer", "id": message["id"], "answers": answers}
                process.stdin.write(json.dumps(reply, ensure_ascii=False) + "\n")
                process.stdin.flush()
                print(f"[host] answered decision {message['id'][:8]} "
                      f"({len(answers)} questions, model={message.get('payload', {}).get('requestedModel')})")
            elif message["type"] == "meta":
                print(f"[meta] python={message.get('python')} toolA={message.get('toolA')}")
            elif message["type"] == "error":
                print(f"[error] {message.get('errorType')}: {message.get('message')}")
                print((message.get("traceback") or "")[-2000:])
    finally:
        process.stdin.close()
    code = process.wait(timeout=timeout)
    stderr = process.stderr.read() if process.stderr else ""
    elapsed = time.monotonic() - started

    for entry in progress:
        print(f"[progress] {entry}")
    if stderr.strip():
        print("[stderr]", stderr.strip()[-3000:])

    results = [message for message in messages if message["type"] == "result"]
    print(f"[done] exit={code} elapsed={elapsed:.1f}s messages={len(messages)}")
    if not results:
        print("[fail] no result message")
        return 1
    payload = results[0]["payload"]
    fire = payload.get("fireLoad") or {}
    print(f"[size] payload={len(json.dumps(payload, ensure_ascii=False)) / 1024:.1f} KiB")
    print(f"[heat] status={fire.get('status')} total={fire.get('totalHeatMj')} MJ "
          f"interval={fire.get('totalHeatIntervalMj')}")
    print(f"[materials] {payload.get('composition', {}).get('materials', []) and len(payload['composition']['materials'])} rows")
    print(f"[artifacts] {payload.get('artifacts')}")
    print(f"[notices] {payload.get('notices')}")
    output_dir = Path(payload.get("outputDir") or ".")
    for name in payload.get("artifacts") or []:
        path = output_dir / name
        print(f"[file] {name} exists={path.exists()} bytes={path.stat().st_size if path.exists() else 0}")
    review = payload.get("review") or {}
    print(f"[review] status={review.get('status')} type={review.get('selected_furniture_type')} "
          f"source={review.get('furniture_type_source')}")
    stages = (payload.get("status") or {}).get("stages") or {}
    print(f"[stages] {json.dumps(stages, ensure_ascii=False)}")
    return 0 if code == 0 else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--answer", default="unknown", choices=["unknown", "first"])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--catalog", action="store_true")
    args = parser.parse_args(argv)
    if args.check or args.catalog:
        flag = "--check" if args.check else "--catalog"
        completed = subprocess.run(
            [args.python, str(BRIDGE), flag], capture_output=True, text=True, encoding="utf-8"
        )
        print(completed.stdout.strip())
        if completed.stderr.strip():
            print("[stderr]", completed.stderr.strip()[-2000:])
        return completed.returncode
    if not args.request:
        parser.error("--request is required unless --check/--catalog is used")
    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    return run(request, args.python, args.answer)


if __name__ == "__main__":
    raise SystemExit(main())
