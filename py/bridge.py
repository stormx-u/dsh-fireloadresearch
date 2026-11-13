"""DSH plugin bridge: run the integrated furniture -> fire-load pipeline.

This process is spawned by the plugin host (lib/index.js) with a JSON request on
the first stdin line.  It re-uses the two original tools instead of copying them:

  * tool A (furniture-material-tool, Python)  -> local YOLO segmentation, visual
    review, broad/composition inference, material proportions and potential heat
    (Q = sum(m_i * H_i)).
  * tool B (Fireprediction, Windows CLI)      -> furniture weight and envelope
    volume, exported as a Fireprediction 1.0 JSON document.

Protocol (UTF-8 JSON lines)
---------------------------
stdin  line 1 : request object (see README "Request schema")
stdin  later  : {"type":"decision-answer","id":"...","answers":{...}} or
                {"type":"decision-answer","id":"...","error":"..."}
stdout        : {"type":"meta"|"progress"|"decision"|"result"|"error", ...}

The host only has to relay ``decision`` messages to a model and echo the answers
back, which is how the JEV-style judgement call can be served by DeepSeek (the
DSH session model) without the plugin holding an API key.

Standalone use::

    python bridge.py --catalog            # print categories / furniture types
    python bridge.py --check              # import smoke test
    python bridge.py --request job.json   # run a job, stream JSON lines
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
import os
import queue
import re
import subprocess
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path

PROTOCOL_VERSION = 1

# 材质分析模块内置在插件里（py/vendor/material），不再依赖外部工具目录。
VENDOR_MATERIAL = Path(__file__).resolve().parent / "vendor" / "material"
# 只有用户手工配置时才用的旧默认路径（作为最后兜底）。
DEFAULT_TOOL_A = (
    r"C:\Users\Administrator\Documents\Codex\2026-11-06"
    r"\https-github-com-zhouyc98-fire-load\outputs\furniture-material-tool"
)
DEFAULT_TOOL_B = r"D:\Fireprediction"


def _has_material_module(directory: Path) -> bool:
    try:
        return directory.is_dir() and (directory / "analysis.py").is_file()
    except OSError:
        return False


def resolve_material_dir(request) -> Path:
    """按「请求里配置的目录 → 插件内置副本 → 旧默认路径」的顺序定位材质分析模块。"""
    candidates = []
    raw = str((request or {}).get("toolA") or "").strip()
    if raw:
        candidates.append(Path(raw))
    candidates.append(VENDOR_MATERIAL)
    candidates.append(Path(DEFAULT_TOOL_A))
    for candidate in candidates:
        if _has_material_module(candidate):
            return candidate
    raise RuntimeError(
        "找不到家具材质分析模块：内置副本缺失（py/vendor/material），"
        "也没有配置可用的工具目录。请重新安装插件。"
    )

REVIEW_QUESTION_IDS = {"furniture_type", "visible_metal"}
REVIEW_QUESTION_PREFIXES = ("candidate_",)

DECIDER_SYSTEM_PROMPT = (
    "你是一个家具材质与火灾荷载评估的判定器。你只输出一个 JSON 对象，"
    "不输出解释、不输出 markdown 代码围栏、不输出多余文字。"
    "概率是相对证据强度，不是经过校准的正确率。"
)


# --------------------------------------------------------------------------- #
# output / input plumbing
# --------------------------------------------------------------------------- #
_OUT_LOCK = threading.Lock()
_OUTPUT_ROUTE = None


class output_route:
    """Temporarily redirect emit() into a callable (used by batch mode)."""

    def __init__(self, handler) -> None:
        self.handler = handler
        self._previous = None

    def __enter__(self):
        global _OUTPUT_ROUTE
        self._previous = _OUTPUT_ROUTE
        _OUTPUT_ROUTE = self.handler
        return self

    def __exit__(self, *_exc):
        global _OUTPUT_ROUTE
        _OUTPUT_ROUTE = self._previous
        return False


def emit(message: dict) -> None:
    handler = _OUTPUT_ROUTE
    if handler is not None:
        handler(message)
        return
    emit_raw(message)


def emit_raw(message: dict) -> None:
    """Always write to stdout, bypassing any active output_route."""
    line = json.dumps(message, ensure_ascii=False, allow_nan=False)
    with _OUT_LOCK:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def progress(stage: str, message: str, **extra) -> None:
    emit({"type": "progress", "stage": stage, "message": message, **extra})


class StdinReader:
    """Synchronous stdin line reader.

    Deliberately *not* threaded: on this Windows/CPython build a background
    thread blocked inside ``sys.stdin.readline`` deadlocks the very next
    module import (reproduced with torch/ultralytics imports hanging forever),
    so every read stays on the main thread. The host always answers or kills
    the process, which bounds the blocking read.
    """

    def __init__(self) -> None:
        self.closed = False

    def next_message(self, timeout: float = 0.0):
        if self.closed:
            return None
        try:
            line = sys.stdin.readline()
        except Exception:  # pragma: no cover - stdin closed by the host
            self.closed = True
            return None
        if not line:
            self.closed = True
            return None
        text = line.strip()
        if not text:
            return "timeout"
        try:
            message = json.loads(text)
        except ValueError:
            return {"type": "raw", "text": text}
        if isinstance(message, dict) and message.get("type") == "request":
            return message.get("payload") or message
        return message


# --------------------------------------------------------------------------- #
# decision clients (the "JEV" node of the flow chart)
# --------------------------------------------------------------------------- #
class DecisionFailure(Exception):
    """Raised when a judgement cannot be produced."""


def _question_ids(questions) -> list[str]:
    return [str(question.get("id")) for question in questions]


def _is_review_question(question_id: str) -> bool:
    return question_id in REVIEW_QUESTION_IDS or question_id.startswith(REVIEW_QUESTION_PREFIXES)


def validate_answers(raw_answers, questions):
    """Normalise a {question_id: {choice, probabilities}} map.

    The original tool validates through decision_client._parse_answers; reusing it
    keeps our DeepSeek/host answers on exactly the same contract as JEV answers.
    """
    from decision_client import _parse_answers, _prepare_questions

    if not isinstance(raw_answers, dict):
        raise DecisionFailure("模型没有返回可解析的答案对象。")
    envelope = {"answers": {}}
    for question in questions:
        question_id = question["id"]
        answer = raw_answers.get(question_id)
        if not isinstance(answer, dict):
            raise DecisionFailure(f"模型遗漏了问题 {question_id} 的回答。")
        envelope["answers"][question_id] = {
            "type": "choice",
            "choice": answer.get("choice"),
            "probabilities": answer.get("probabilities"),
        }
    return _parse_answers(envelope, _prepare_questions(questions))


class PassiveUnknownClient:
    """Offline client: every question resolves to ``unknown``, no network."""

    accepts_images = False

    def __init__(self) -> None:
        self.network_calls = 0
        self.last_metadata = {
            "model": "offline-unknown",
            "api_family": "offline",
            "score_origin": "not_assessed",
        }

    def decide(self, state_text: str, images, questions):
        answers = {}
        for question in questions:
            criteria = list((question.get("criteria") or {}).keys())
            if not criteria:
                continue
            if "unknown" in criteria:
                probabilities = {name: (1.0 if name == "unknown" else 0.0) for name in criteria}
            else:  # defensive: the original validator requires an unknown option
                probabilities = {name: 1.0 / len(criteria) for name in criteria}
            best = max(probabilities, key=probabilities.get)
            answers[question["id"]] = {"choice": best, "probabilities": probabilities}
        return answers


class StubDecider:
    """Deterministic local decider used by --check / automated smoke tests."""

    accepts_images = False

    def __init__(self) -> None:
        self.network_calls = 0
        self.last_metadata = {
            "model": "stub-decider",
            "api_family": "offline-stub",
            "score_origin": "diagnostic_stub",
        }

    def decide(self, state_text: str, images, questions):
        answers = {}
        for question in questions:
            criteria = list((question.get("criteria") or {}).keys())
            if not criteria:
                continue
            unknown = "unknown" in criteria
            candidates = [name for name in criteria if name != "unknown"]
            if not candidates or question["id"] in REVIEW_QUESTION_IDS or question["id"].startswith("candidate_"):
                probabilities = {name: (1.0 if name == "unknown" else 0.0) for name in criteria}
            elif len(candidates) == 1:
                probabilities = {candidates[0]: 1.0}
                if unknown:
                    probabilities["unknown"] = 0.0
            else:
                winner = candidates[0]
                share = 0.92 if not unknown else 0.90
                rest = [name for name in criteria if name != winner]
                probabilities = {winner: share}
                for name in rest:
                    probabilities[name] = (1.0 - share) / max(1, len(rest))
            best = max(probabilities, key=probabilities.get)
            answers[question["id"]] = {"choice": best, "probabilities": probabilities}
        return answers


def _build_prompt(state_text: str, questions) -> str:
    payload = {
        str(question["id"]): {
            "instructions": question.get("instructions", ""),
            "criteria": question.get("criteria", {}),
        }
        for question in questions
    }
    return (
        "任务状态（JSON 文本，供你判断）：\n"
        f"{state_text}\n\n"
        "需要判定的问题：\n"
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n\n"
        "要求：\n"
        "1. 对每个问题，为 criteria 中的每一个候选给出 0~1 的概率，同一问题内合计约等于 1。\n"
        "2. choice 必须是该问题中概率最大的候选 id。\n"
        "3. 证据不足时让 unknown 最大，不要臆测。\n"
        "4. 只输出一个 JSON 对象，形如：\n"
        '{"answers":{"问题id":{"choice":"候选id","probabilities":{"候选id":0.0}}}}\n'
    )


class HostLlmClient:
    """Decider executed by the DSH host model (no API key needed).

    The host decides whether the selected session model can take images (the
    ``deepseek-modlens`` route advertises an ``image`` input modality, the plain
    DeepSeek routes do not), so the frames are exported to disk and handed over
    as file paths: the host attaches them only when the route supports images.
    """

    accepts_images = True
    api_family = "dsh-host-llm"
    MAX_IMAGE_SIDE = 1536
    MAX_IMAGES = 4

    def __init__(
        self,
        reader: StdinReader,
        model: str = "",
        timeout: float = 300.0,
        image_dir: "Path | None" = None,
        attach_images: bool = True,
    ) -> None:
        self.reader = reader
        self.model = model
        self.timeout = timeout
        self.image_dir = Path(image_dir) if image_dir else None
        self.attach_images = bool(attach_images)
        self.network_calls = 0
        self.last_metadata = {
            "model": model or "dsh-session-model",
            "api_family": self.api_family,
            "score_origin": "text_model_uncalibrated",
            "image_input": False,
        }

    def _export_images(self, images, request_id: str) -> list:
        """Write the decision frames as JPEG files so the host can attach them."""
        if not self.attach_images or not images:
            return []
        directory = self.image_dir or (Path.cwd() / "decision-images")
        try:
            directory.mkdir(parents=True, exist_ok=True)
            exported = []
            seen: set = set()
            for index, image in enumerate(list(images)[: self.MAX_IMAGES], start=1):
                frame = image.convert("RGB")
                if max(frame.size) > self.MAX_IMAGE_SIDE:
                    frame.thumbnail((self.MAX_IMAGE_SIDE, self.MAX_IMAGE_SIDE))
                digest = hashlib.sha1(frame.tobytes()).hexdigest()
                if digest in seen:  # whole-image runs pass preview and crop as the same pixels
                    continue
                seen.add(digest)
                name = f"{request_id[:8]}-frame-{len(exported) + 1}.jpg"
                target = directory / name
                frame.save(target, format="JPEG", quality=85, optimize=True)
                exported.append(
                    {
                        "path": str(target),
                        "name": name,
                        "mediaType": "image/jpeg",
                        "width": frame.width,
                        "height": frame.height,
                    }
                )
            return exported
        except Exception as error:  # a broken frame must not break the decision
            progress("decider", f"判定图像导出失败（{error}），本次按纯文本判定。", level="warn")
            return []

    def decide(self, state_text: str, images, questions):
        request_id = uuid.uuid4().hex
        self.network_calls += 1
        exported = self._export_images(images, request_id)
        emit(
            {
                "type": "decision",
                "id": request_id,
                "payload": {
                    "kind": "furniture-fireload-decision",
                    "requestedModel": self.model,
                    "system": DECIDER_SYSTEM_PROMPT,
                    "prompt": _build_prompt(state_text, questions),
                    "questions": [
                        {
                            "id": question.get("id"),
                            "instructions": question.get("instructions", ""),
                            "criteria": question.get("criteria", {}),
                        }
                        for question in questions
                    ],
                    "questionIds": _question_ids(questions),
                    "hasImages": bool(images),
                    "imageCount": len(images or []),
                    "images": exported,
                    "imagesRequested": bool(images) and self.attach_images,
                },
            }
        )
        deadline = time.monotonic() + self.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise DecisionFailure("等待宿主模型判定超时。")
            message = self.reader.next_message(min(remaining, 30.0))
            if message == "timeout":
                continue
            if message is None:
                raise DecisionFailure("宿主通道已关闭，无法取得模型判定。")
            if message.get("type") == "decision-answer" and message.get("id") == request_id:
                if message.get("error"):
                    raise DecisionFailure(str(message["error"]))
                answers = message.get("answers")
                if isinstance(message.get("payload"), dict):
                    answers = message["payload"].get("answers", answers)
                model_used = message.get("model") or self.model or "dsh-session-model"
                images_sent = message.get("images")
                try:
                    images_sent = int(images_sent or 0)
                except (TypeError, ValueError):
                    images_sent = 0
                score_origin = "text_model_uncalibrated"
                if images_sent > 0:
                    score_origin = "multimodal_model_uncalibrated"
                    progress("decider", f"本次判定已随请求附带 {images_sent} 张图片（视觉通道）。")
                self.last_metadata = {
                    "model": model_used,
                    "api_family": self.api_family,
                    "score_origin": score_origin,
                    "image_input": images_sent > 0,
                    "images_sent": images_sent,
                }
                return validate_answers(answers, questions)


def _image_data_url(image, max_side: int = 1536, quality: int = 85) -> str:
    """Encode a PIL image as a JPEG data URL for image_url content blocks."""
    frame = image.convert("RGB")
    width, height = frame.size
    longest = max(width, height)
    if longest > max_side:
        scale = max_side / float(longest)
        frame = frame.resize((max(1, int(width * scale)), max(1, int(height * scale))))
    buffer = io.BytesIO()
    frame.save(buffer, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _chat_endpoint(raw_url: str) -> str:
    """Accept a base URL or a full chat-completions URL."""
    url = str(raw_url or "").strip().rstrip("/")
    if not url:
        return ""
    if url.endswith("/chat/completions"):
        return url
    return url + "/chat/completions"


def _custom_decider(cfg: dict, side: str = "composition"):
    """Build a decider for a user-defined OpenAI-compatible endpoint."""
    prefix = "reviewCustom" if side == "review" else "custom"
    def pick(name: str):
        value = cfg.get(prefix + name)
        if value in (None, "") and prefix != "custom":
            value = cfg.get("custom" + name)
        return value

    base_url = _chat_endpoint(pick("BaseUrl"))
    model = str(pick("Model") or cfg.get("model") or "").strip()
    api_key = str(pick("ApiKey") or "").strip()
    label = str(pick("Label") or "自定义模型").strip() or "自定义模型"
    if not model:
        progress(side, "自定义模型缺少模型名，按离线 unknown 处理。", level="warn")
        return None
    return OpenAICompatClient(
        api_key,
        model=model,
        base_url=base_url,
        label=label,
        accepts_images=bool(pick("Vision")),
    )


class OpenAICompatClient:
    """Chat-completions decider for OpenAI-compatible endpoints.

    Used for DeepSeek's public API and for any user-defined model in the panel's
    custom-model library. Images are only attached when ``accepts_images`` is on.
    """

    accepts_images = False

    def __init__(
        self,
        api_key: str,
        model: str = "deepseek-chat",
        base_url: str = "https://api.deepseek.com/chat/completions",
        timeout: float = 120.0,
        *,
        label: str = "DeepSeek",
        accepts_images: bool = False,
        json_mode: bool = True,
    ) -> None:
        if not api_key:
            raise DecisionFailure(f"未配置 {label} API 密钥。")
        if not str(base_url or "").strip():
            raise DecisionFailure(f"未配置 {label} API 地址。")
        self.api_key = api_key
        self.model = model
        self.base_url = str(base_url).strip()
        self.timeout = timeout
        self.label = label or "外部 API"
        self.accepts_images = bool(accepts_images)
        self.json_mode = bool(json_mode)
        self.network_calls = 0
        self.api_family = "openai-chat-completions"
        self.last_metadata = {
            "model": model,
            "api_family": self.api_family,
            "score_origin": "multimodal_model_uncalibrated" if self.accepts_images else "text_model_uncalibrated",
        }

    def decide(self, state_text: str, images, questions):
        import requests

        content = [{"type": "text", "text": _build_prompt(state_text, questions)}]
        sent_images = 0
        if self.accepts_images and images:
            for image in list(images)[:4]:
                try:
                    url = _image_data_url(image)
                except Exception as error:  # encoding problems must not abort the run
                    progress("decider", f"图片编码失败（{error}），本次不附带该图片。", level="warn")
                    continue
                if not url:
                    continue
                content.append({"type": "image_url", "image_url": {"url": url}})
                sent_images += 1
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": DECIDER_SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            "temperature": 0.2,
            "max_tokens": 1600,
            "stream": False,
        }
        if self.json_mode:
            body["response_format"] = {"type": "json_object"}

        def call(payload_body):
            try:
                return requests.post(
                    self.base_url,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload_body,
                    timeout=(10.0, self.timeout),
                )
            except Exception as error:  # requests raises a broad family of errors
                raise DecisionFailure(f"{self.label} 请求失败：{error}") from error

        response = call(body)
        if response.status_code == 400 and "response_format" in body and "response_format" in (response.text or ""):
            body.pop("response_format", None)
            response = call(body)
        self.network_calls += 1
        if response.status_code == 401:
            raise DecisionFailure(f"{self.label} 密钥无效或已过期（HTTP 401）。")
        if response.status_code == 402:
            raise DecisionFailure(f"{self.label} 账户余额不足（HTTP 402）。")
        if response.status_code == 429:
            raise DecisionFailure(f"{self.label} 触发限流（HTTP 429），请稍后重试。")
        if response.status_code >= 400:
            raise DecisionFailure(f"{self.label} 返回 HTTP {response.status_code}：{response.text[:300]}")
        try:
            payload = response.json()
            raw_content = payload["choices"][0]["message"]["content"]
            if isinstance(raw_content, list):
                raw_content = "".join(
                    part.get("text", "") for part in raw_content if isinstance(part, dict)
                )
        except Exception as error:
            raise DecisionFailure(f"{self.label} 响应格式异常：{error}") from error
        usage = payload.get("usage") if isinstance(payload, dict) else None
        metadata = {
            "model": (payload.get("model") if isinstance(payload, dict) else None) or self.model,
            "api_family": self.api_family,
            "score_origin": "multimodal_model_uncalibrated" if sent_images else "text_model_uncalibrated",
            "image_input": sent_images > 0,
            "images_sent": sent_images,
        }
        if isinstance(usage, dict):
            metadata["usage"] = {
                key: usage[key]
                for key in ("prompt_tokens", "completion_tokens", "total_tokens")
                if isinstance(usage.get(key), (int, float))
            }
        self.last_metadata = metadata
        return validate_answers(_parse_json_object(raw_content), questions)


def _parse_json_object(text: str) -> dict:
    if not isinstance(text, str):
        raise DecisionFailure("模型没有返回文本内容。")
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[: -3]
    try:
        value = json.loads(cleaned)
    except ValueError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise DecisionFailure("模型输出不是 JSON：" + text[:200])
        try:
            value = json.loads(cleaned[start : end + 1])
        except ValueError as error:
            raise DecisionFailure(f"模型输出 JSON 解析失败：{error}") from error
    if isinstance(value, dict) and isinstance(value.get("answers"), dict):
        return value["answers"]
    if isinstance(value, dict):
        return value
    raise DecisionFailure("模型输出的 JSON 顶层不是对象。")


def _openrouter_key(request: dict) -> str:
    decider = request.get("decider") or {}
    review = request.get("review") or {}
    for candidate in (
        decider.get("reviewApiKey"),
        decider.get("openrouterApiKey"),
        review.get("apiKey"),
        os.environ.get("OPENROUTER_API_KEY", ""),
    ):
        key = str(candidate or "").strip()
        if key:
            return key
    try:
        from credentials import get_key

        return (get_key() or "").strip()
    except Exception:
        return ""


_FREE_MODEL_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_./-]*\Z")


def _normalize_free_model(model: str) -> tuple[str, str | None]:
    """Free-only endpoints reject any id that does not end with ``:free``.

    Returns ``(model_id, notice)``. A bare ``vendor/model`` gets ``:free``
    appended; anything else unusable falls back to the tool's default free model
    so a stale UI value can never abort the whole run.
    """
    from free_vision_client import DEFAULT_FREE_MODEL

    value = str(model or "").strip()
    if not value:
        return DEFAULT_FREE_MODEL, None
    if value.endswith(":free"):
        return value, None
    if _FREE_MODEL_PATTERN.fullmatch(value):
        return value + ":free", f"免费视觉模型 ID 缺少 :free 后缀，已按 {value}:free 使用。"
    return (
        DEFAULT_FREE_MODEL,
        f"“{value}”不是免费的视觉模型 ID（必须以 :free 结尾），已改用默认免费模型 {DEFAULT_FREE_MODEL}。",
    )


def _openrouter_decider(kind: str, request: dict, model: str, side: str = "review"):
    key = _openrouter_key(request)
    if not key:
        return None
    configured_model = str(model or "").strip()
    if kind == "decider":
        from decision_client import DecisionClient

        client = DecisionClient(key, **({"model": configured_model} if configured_model else {}))
    else:
        from free_vision_client import FreeVisionClient

        configured_model, notice = _normalize_free_model(configured_model)
        if notice:
            progress(side, notice, level="warn")
        client = FreeVisionClient(key, model=configured_model)
    # Both OpenRouter clients accept images, so the router may forward evidence.
    try:
        client.accepts_images = True
    except Exception:
        pass
    return client


def _client_label(client) -> str:
    """Human-readable one-line description of a decision client (no secrets)."""
    name = type(client).__name__
    model = getattr(client, "model", None)
    return f"{name}({model})" if model else name


class RouterClient:
    """Split review questions from construction questions between two models."""

    def __init__(self, review, decision) -> None:
        self.review = review
        self.decision = decision
        self.network_calls = 0
        self.last_metadata = {}

    def decide(self, state_text: str, images, questions):
        review_questions = [q for q in questions if _is_review_question(str(q.get("id")))]
        other_questions = [q for q in questions if not _is_review_question(str(q.get("id")))]
        answers: dict = {}
        if review_questions:
            try:
                answers.update(self.review.decide(state_text, images, review_questions))
                self.last_metadata = dict(getattr(self.review, "last_metadata", {}) or {})
            except Exception as error:
                progress(
                    "review",
                    f"视觉复核不可用（{error}），保留本机分割并把候选材质标记为未确认。",
                    level="warn",
                )
                answers.update(PassiveUnknownClient().decide(state_text, [], review_questions))
                self.last_metadata = {
                    "model": "offline-unknown",
                    "api_family": "offline",
                    "score_origin": "not_assessed",
                }
        if other_questions:
            decision_images = images if getattr(self.decision, "accepts_images", False) else []
            try:
                answers.update(self.decision.decide(state_text, decision_images, other_questions))
                if not self.last_metadata:
                    self.last_metadata = dict(getattr(self.decision, "last_metadata", {}) or {})
            except Exception as error:
                progress(
                    "composition",
                    f"构造判定模型不可用（{error}），构造候选按 unknown 处理。",
                    level="warn",
                )
                answers.update(PassiveUnknownClient().decide(state_text, [], other_questions))
        self.network_calls += int(getattr(self.review, "network_calls", 0) or 0)
        self.network_calls += int(getattr(self.decision, "network_calls", 0) or 0)
        return answers


def build_router(request: dict, reader: StdinReader) -> RouterClient:
    cfg = request.get("decider") or {}
    provider = str(cfg.get("provider") or "deepseek").strip().lower()
    model = str(cfg.get("model") or "").strip()
    channel = str(cfg.get("channel") or "host").strip().lower()
    review_provider = str(cfg.get("reviewProvider") or "auto").strip().lower()
    review_model = str(cfg.get("reviewModel") or "").strip()

    # --- review side (furniture type / visible metal / segmentation candidates)
    review = None
    try:
        if review_provider in {"auto", "openrouter-free", "free-vision"}:
            review = _openrouter_decider("free", request, review_model, "review")
            if review is None and review_provider != "auto":
                progress("review", "没有可用的 OpenRouter 密钥，视觉复核改为离线（候选保留未确认）。", level="warn")
        elif review_provider in {"openrouter-decider", "jev"}:
            review = _openrouter_decider("decider", request, review_model, "review")
            if review is None:
                progress("review", "没有可用的 OpenRouter 密钥，视觉复核改为离线。", level="warn")
        elif review_provider in {"stub"}:
            review = StubDecider()
        elif review_provider in {"custom", "api"}:
            review = _custom_decider(cfg, "review")
            if review is None:
                progress("review", "自定义复核模型不可用，视觉复核改为离线。", level="warn")
    except Exception as error:  # a bad config must degrade, never abort the run
        progress("review", f"视觉复核模型初始化失败（{error}），改为离线未确认。", level="warn")
        review = None
    if review is None:
        review = PassiveUnknownClient()

    # --- construction side (the flow chart's "JEV 类大模型 -> 判定" node)
    decision = None
    try:
        if provider in {"none", "offline"}:
            decision = PassiveUnknownClient()
        elif provider in {"stub"}:
            decision = StubDecider()
        elif provider in {"deepseek"}:
            if channel == "api":
                decision = OpenAICompatClient(
                    str(cfg.get("deepseekApiKey") or os.environ.get("DEEPSEEK_API_KEY") or "").strip(),
                    model=model or str(cfg.get("deepseekModel") or "deepseek-chat"),
                    base_url=str(cfg.get("deepseekBaseUrl") or "https://api.deepseek.com/chat/completions"),
                )
            else:
                out_dir = Path(str(request.get("outputDir") or "")).expanduser()
                decision = HostLlmClient(
                    reader,
                    model=model or str(cfg.get("deepseekModel") or ""),
                    image_dir=(out_dir / "decision-images") if str(out_dir) else None,
                    attach_images=str(cfg.get("vision") or "auto").strip().lower() != "off",
                )
        elif provider in {"jev", "decider"}:
            decision = _openrouter_decider("decider", request, model, "composition")
            if decision is None:
                progress("composition", "没有可用的 OpenRouter 密钥，构造判定改为离线 unknown。", level="warn")
                decision = PassiveUnknownClient()
        elif provider in {"free-vision", "openrouter-free"}:
            decision = _openrouter_decider("free", request, model, "composition")
            if decision is None:
                progress("composition", "没有可用的 OpenRouter 密钥，构造判定改为离线 unknown。", level="warn")
                decision = PassiveUnknownClient()
        elif provider in {"custom", "api"}:
            decision = _custom_decider(cfg, "composition")
            if decision is None:
                progress("composition", "自定义判定模型不可用，构造判定改为离线 unknown。", level="warn")
                decision = PassiveUnknownClient()
        else:
            progress("composition", f"未知判定模型 {provider}，按离线 unknown 处理。", level="warn")
            decision = PassiveUnknownClient()
    except Exception as error:  # e.g. invalid model id or bad key format
        progress("composition", f"构造判定模型初始化失败（{error}），构造候选按 unknown 处理。", level="warn")
        decision = None
    if decision is None:
        decision = PassiveUnknownClient()

    return RouterClient(review, decision)


# --------------------------------------------------------------------------- #
# physical inputs (weight + volume)
# --------------------------------------------------------------------------- #
VENDOR_FIREPREDICTION = Path(__file__).resolve().parent / "vendor" / "fireprediction"
_BUILTIN_ENGINE = None
_BUILTIN_ENGINE_LOCK = threading.Lock()


def _load_builtin_engine_module():
    """Import py/vendor/fireprediction/engine.py without touching sys.path."""
    path = VENDOR_FIREPREDICTION / "engine.py"
    if not path.is_file():
        return None
    import importlib.util

    spec = importlib.util.spec_from_file_location("ff_builtin_fireprediction", path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def builtin_fireprediction_available() -> bool:
    try:
        module = _load_builtin_engine_module()
        return bool(module is not None and module.is_available())
    except Exception:
        return False


def _builtin_engine():
    global _BUILTIN_ENGINE
    with _BUILTIN_ENGINE_LOCK:
        if _BUILTIN_ENGINE is not None:
            return _BUILTIN_ENGINE
        module = _load_builtin_engine_module()
        if module is None or not module.is_available():
            raise RuntimeError("插件内置的 Fireprediction 模型文件不完整（py/vendor/fireprediction/models）。")
        _BUILTIN_ENGINE = module.FirepredictionEngine(cpu_threads=4)
        return _BUILTIN_ENGINE


def run_builtin_fireprediction(
    out_dir: Path,
    image_path: str,
    category: str,
    dimensions: dict,
    volume_profile: str = "general",
) -> Path:
    engine = _builtin_engine()
    unit = str(dimensions.get("unit") or "cm").strip() or "cm"
    progress("physical", "正在用内置 Fireprediction 模型推理重量与包裹体积（本机 CPU）…")
    data = engine.predict(
        image_path,
        str(category),
        dimensions.get("width"),
        dimensions.get("height"),
        dimensions.get("depth"),
        unit=unit,
        volume_profile=volume_profile,
    )
    export_path = out_dir / "fireprediction.json"
    export_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return export_path


def run_fireprediction_cli(
    cli_path: Path,
    image_path: str,
    category: str,
    dimensions: dict,
    output_path: Path,
    timeout: float = 420.0,
) -> Path:
    if not cli_path.exists():
        raise RuntimeError(f"找不到 FirepredictionCLI.exe：{cli_path}")
    unit = str(dimensions.get("unit") or "cm").strip() or "cm"
    command = [
        str(cli_path),
        "predict",
        "--category",
        str(category),
        "--width",
        _format_number(dimensions.get("width")),
        "--height",
        _format_number(dimensions.get("height")),
        "--depth",
        _format_number(dimensions.get("depth")),
        "--unit",
        unit,
        "--image",
        str(image_path),
        "--output",
        str(output_path),
    ]
    progress("physical", "正在调用 Fireprediction 预测重量与包裹体积（约 10 秒）…")
    completed = subprocess.run(
        command,
        cwd=str(cli_path.parent),
        capture_output=True,
        timeout=timeout,
    )
    if completed.returncode != 0 or not output_path.exists():
        detail = (completed.stderr or completed.stdout or b"").decode("utf-8", "replace").strip()
        raise RuntimeError(f"Fireprediction 预测失败（退出码 {completed.returncode}）：{detail[:400]}")
    return output_path


def _format_number(value) -> str:
    number = float(value)
    return str(int(number)) if abs(number - int(number)) < 1e-9 else f"{number:g}"


def resolve_physical(request: dict, out_dir: Path, image_path: str) -> tuple:
    """Return (physical dict | None, source label, notices)."""
    import physical

    notices: list[str] = []
    manual = request.get("physical") or {}
    mass = manual.get("massKg")
    volume = manual.get("volumeM3")
    volume_kind = manual.get("volumeKind")
    if mass in (None, "", 0) or volume in (None, "", 0):
        # The panel sends the manual values at the top level; accept both shapes.
        mass = request.get("massKg", mass)
        volume = request.get("volumeM3", volume)
        volume_kind = request.get("volumeKind", volume_kind)
    if mass not in (None, "", 0) and volume not in (None, "", 0):
        source = str(request.get("physicalSource") or "manual").strip() or "manual"
        status = "estimated" if source == "llm-estimate" else "measured"
        data = physical.make_manual_physical(
            float(mass),
            float(volume),
            volume_kind=str(volume_kind or "envelope"),
            mass_status=status,
            volume_status=status,
        )
        if source == "llm-estimate":
            notices.append(
                "质量与体积来自 LLM 图片直接估计（未经 Fireprediction 或实称校验），火荷载结果只作量级参考。"
            )
        return data, source, notices

    if not request.get("useFireprediction", True):
        notices.append("已关闭 Fireprediction 预测，未提供质量与体积。")
        return None, "none", notices

    dimensions = request.get("dimensions") or {}
    category = str(request.get("category") or "").strip()
    if not category or not all(dimensions.get(key) for key in ("width", "height", "depth")):
        notices.append("缺少家具类别或外包围盒尺寸，跳过 Fireprediction 预测。")
        return None, "none", notices

    cli_path = Path(str(request.get("toolB") or DEFAULT_TOOL_B)) / "FirepredictionCLI.exe"
    export_path = out_dir / "fireprediction.json"
    volume_profile = str(request.get("volumeProfile") or "general").strip() or "general"

    engine_error = None
    engine_pref = str(request.get("physicalEngine") or "auto").strip().lower()
    builtin = False
    if engine_pref in {"auto", "builtin"}:
        try:
            run_builtin_fireprediction(out_dir, image_path, category, dimensions, volume_profile)
            builtin = True
        except Exception as error:  # noqa: BLE001 - 内置引擎不可用时退回外部 CLI
            engine_error = error
    elif engine_pref == "none":
        notices.append("已关闭 Fireprediction（本机内置模型与外部 CLI 都不使用），未提供质量与体积。")
        return None, "none", notices

    if builtin:
        try:
            data = physical.load_fireprediction(export_path, image_path=image_path)
        except Exception as error:
            notices.append(f"内置 Fireprediction 结果校验失败：{error}")
            return None, "fireprediction-invalid", notices
        notices.append(
            "质量与体积由插件内置模型推理（weight_fusion_v3 + volume_convnext_general），"
            "不需要外部 Fireprediction 目录。"
        )
        association = (data.get("association") or {}).get("state")
        if association != "verified_sha256":
            notices.append(f"图片与预测记录关联状态为 {association}；未按同图校验通过。")
        return data, "builtin-fireprediction", notices

    if not cli_path.is_file():
        detail = f"（内置引擎：{engine_error}）" if engine_error else ""
        notices.append(
            "找不到 Fireprediction：插件内置模型不可用且没有 FirepredictionCLI.exe"
            f"{detail}：本单没有质量与体积，只能给出材质结论。"
        )
        return None, "fireprediction-missing", notices
    try:
        run_fireprediction_cli(cli_path, image_path, category, dimensions, export_path)
    except Exception as error:
        notices.append(f"Fireprediction 预测未完成：{error}")
        return None, "fireprediction-failed", notices
    try:
        data = physical.load_fireprediction(export_path, image_path=image_path)
    except Exception as error:
        notices.append(f"Fireprediction 结果校验失败：{error}")
        return None, "fireprediction-invalid", notices
    association = (data.get("association") or {}).get("state")
    if association != "verified_sha256":
        notices.append(f"图片与预测记录关联状态为 {association}；未按同图校验通过。")
    return data, "fireprediction", notices


# --------------------------------------------------------------------------- #
# payload for the panel UI
# --------------------------------------------------------------------------- #
def _finite(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    return None


def _interval(value):
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return [_finite(value[0]), _finite(value[1])]
    return None


def _heat_basis_label(fire_load) -> str:
    """Human readable heat-value basis (LHV / HHV) taken from the source table."""
    if not isinstance(fire_load, dict):
        return "未计算"
    bases = [str(item) for item in (fire_load.get("heat_bases") or [])]
    if not bases:
        if fire_load.get("status") == "unavailable":
            return "未计算（缺质量或体积）"
        return "原表未说明"
    if bases == ["LHV"]:
        return "低位热值（LHV，净热值）"
    if bases == ["HHV"]:
        return "高位热值（HHV，毛热值）"
    return "混合或未说明口径（" + "、".join(bases) + "）"


def _llm_estimate_summary(request: dict) -> dict | None:
    """Compact view of an LLM mass/volume estimate (batch mode asks per item)."""
    estimate = request.get("physicalEstimate")
    if not isinstance(estimate, dict):
        return None
    return {
        "model": estimate.get("model"),
        "images": estimate.get("images"),
        "vision": bool(estimate.get("vision")),
        "confidence": _finite(estimate.get("confidence")),
        "massKg": _finite(estimate.get("massKg")),
        "volumeM3": _finite(estimate.get("volumeM3")),
        "heatValueMjKg": _finite(estimate.get("heatValueMjKg")),
        "fireLoadMj": _finite(estimate.get("fireLoadMj")),
        "notes": estimate.get("notes") or "",
        "source": "llm-estimate",
    }


def _bulk_density(physical) -> float | None:
    """mass / envelope volume - i.e. the density of the whole bounding volume."""
    if not isinstance(physical, dict):
        return None
    mass = _finite((physical.get("mass") or {}).get("value_kg"))
    volume = _finite((physical.get("volume") or {}).get("value_m3"))
    if not mass or not volume or mass <= 0 or volume <= 0:
        return None
    return mass / volume


def _material_density(physical, void_summary) -> float | None:
    """mass / (envelope volume - void) = density of the material that is really there.

    This is the quantity the density constraint compares against material
    density ranges; the bulk density above is not.
    """
    if not isinstance(physical, dict):
        return None
    mass = _finite((physical.get("mass") or {}).get("value_kg"))
    volume = _finite((physical.get("volume") or {}).get("value_m3"))
    if not mass or not volume or mass <= 0 or volume <= 0:
        return None
    kind = str((physical.get("volume") or {}).get("kind") or "envelope")
    if kind == "material_volume":
        return mass / volume
    void = _finite((void_summary or {}).get("mean")) if isinstance(void_summary, dict) else None
    if void is None or not 0.0 <= void < 1.0:
        return None
    material_volume = volume * (1.0 - void)
    if material_volume <= 0:
        return None
    return mass / material_volume


def _part_rows(result) -> list[dict]:
    from analysis import CN

    rows = []
    target_pixels = max(1, int(result.target_mask.sum()))
    for part in result.parts:
        overlap = part.mask & result.target_mask
        rows.append(
            {
                "id": part.id,
                "label": part.label,
                "labelCn": CN.get(part.label, part.label),
                "score": _finite(part.score),
                "review": part.review,
                "source": part.source,
                "pixelRatio": round(float(overlap.sum()) / target_pixels, 6),
            }
        )
    return rows


def _trim_refinement(stage: dict) -> dict:
    if not isinstance(stage, dict):
        return {}
    groups = []
    for group in stage.get("groups") or []:
        options = []
        for option in group.get("options") or []:
            options.append(
                {
                    "id": option.get("id"),
                    "name": option.get("name"),
                    "broad": option.get("broad"),
                    "prior": _finite(option.get("prior")),
                    "posterior": _finite(option.get("posterior_conditional")),
                    "massFraction": _finite(option.get("mass_fraction")),
                    "materialVolumeFraction": _finite(option.get("material_volume_fraction")),
                    "estimatedMassKg": _finite(option.get("estimated_mass_kg")),
                    "densityBasis": option.get("density_basis"),
                    "refinementStatus": option.get("refinement_status"),
                }
            )
        options.sort(key=lambda row: row.get("posterior") or 0.0, reverse=True)
        groups.append(
            {
                "broad": group.get("broad"),
                "name": group.get("name"),
                "broadPresenceWeight": _finite(group.get("broad_presence_weight")),
                "evidenceStage": group.get("evidence_stage"),
                "options": options[:8],
                "omittedOptions": max(0, len(options) - 8),
            }
        )
    return {
        "status": stage.get("status"),
        "method": stage.get("method"),
        "physicsUsed": stage.get("physics_used"),
        "note": stage.get("note"),
        "groups": groups,
    }


def _trim_broad_stage(stage: dict) -> dict:
    if not isinstance(stage, dict):
        return {}
    proposals = []
    for proposal in stage.get("proposals") or []:
        proposals.append(
            {
                "id": proposal.get("id"),
                "label": proposal.get("label"),
                "broads": proposal.get("broads"),
                "prior": _finite(proposal.get("prior")),
                "imageScore": _finite(proposal.get("image_score")),
                "posteriorWeight": _finite(proposal.get("posterior_weight")),
            }
        )
    decision = stage.get("decision") or {}
    return {
        "status": stage.get("status"),
        "method": stage.get("method"),
        "frequencyUsed": stage.get("frequency_used"),
        "decision": {
            "used": decision.get("used"),
            "choice": decision.get("choice"),
            "unknownScore": _finite(decision.get("unknown_score")),
            "scoresAre": decision.get("scores_are"),
        },
        "proposals": proposals,
        "note": stage.get("note"),
    }


def build_payload(result, physical_data, physical_source: str, request: dict, meta: dict) -> dict:
    output = result.composition if isinstance(getattr(result, "composition", None), dict) else {}
    fire_load = output.get("fire_load") if isinstance(output.get("fire_load"), dict) else {}
    materials = []
    raw_materials = sorted(
        output.get("materials") or [],
        key=lambda row: _finite(row.get("mass_fraction")) or 0.0,
        reverse=True,
    )
    for material in raw_materials:
        materials.append(
            {
                "id": material.get("id"),
                "name": material.get("name"),
                "broad": material.get("broad"),
                "massFraction": _finite(material.get("mass_fraction")),
                "massFractionInterval": _interval(material.get("mass_fraction_interval")),
                "materialVolumeFraction": _finite(material.get("material_volume_fraction")),
                "materialVolumeFractionInterval": _interval(material.get("material_volume_fraction_interval")),
                "estimatedMassKg": _finite(material.get("estimated_mass_kg")),
                "densityBasis": material.get("density_basis"),
                "refinementStatus": material.get("refinement_status"),
                "source": material.get("source"),
            }
        )
    candidates = []
    for candidate in (output.get("candidates") or [])[:3]:
        candidates.append(
            {
                "id": candidate.get("id"),
                "label": candidate.get("label"),
                "prior": _finite(candidate.get("prior")),
                "imageScore": _finite(candidate.get("image_score")),
                "weight": _finite(candidate.get("weight")),
                "closureFailure": candidate.get("closure_failure"),
            }
        )
    heat_materials = []
    raw_heat = sorted(
        fire_load.get("materials") or [],
        key=lambda row: _finite(row.get("heat_mj")) or 0.0,
        reverse=True,
    )
    for material in raw_heat[:15]:
        heat_materials.append(
            {
                "id": material.get("id"),
                "name": material.get("name"),
                "broad": material.get("broad"),
                "massFraction": _finite(material.get("mass_fraction")),
                "massKg": _finite(material.get("mass_kg")),
                "heatValueMjKg": _finite(material.get("heat_value_mj_kg")),
                "heatMj": _finite(material.get("heat_mj")),
                "status": material.get("status"),
                "missing": material.get("missing") or [],
                "heatBasis": material.get("heat_basis"),
            }
        )
    statistics = result.statistics()
    raw_llm_segmentation = getattr(result, "llm_segmentation", None)
    llm_segmentation_summary = None
    if isinstance(raw_llm_segmentation, dict):
        llm_segmentation_summary = {
            "model": raw_llm_segmentation.get("model"),
            "images": raw_llm_segmentation.get("images"),
            "confidence": _finite(raw_llm_segmentation.get("confidence")),
            "target": raw_llm_segmentation.get("target"),
            "materials": [
                {
                    "broad": row.get("broad"),
                    "name": row.get("name"),
                    "share": _finite(row.get("share")),
                }
                for row in (raw_llm_segmentation.get("materials") or [])
            ],
            "dropped": raw_llm_segmentation.get("dropped") or [],
            "notes": raw_llm_segmentation.get("notes") or "",
        }
    payload = {
        "schema": "furniture-fireload-payload/1",
        "meta": meta,
        "input": {
            "imagePath": request.get("imagePath"),
            "imageName": Path(str(request.get("imagePath") or "")).name,
            "category": request.get("category"),
            "furnitureType": request.get("furnitureType"),
            "dimensions": request.get("dimensions"),
            "device": request.get("device"),
            "decider": {
                "provider": (request.get("decider") or {}).get("provider"),
                "model": (request.get("decider") or {}).get("model"),
                "channel": (request.get("decider") or {}).get("channel"),
                "reviewProvider": (request.get("decider") or {}).get("reviewProvider"),
                "reviewModel": (request.get("decider") or {}).get("reviewModel"),
            },
            "useFireprediction": request.get("useFireprediction", True),
            "segmentationEngine": str((request.get("segmentation") or {}).get("engine") or "yolo"),
            "segmentationModel": (llm_segmentation_summary or {}).get("model"),
            "segmentationFallbackError": request.get("llmSegmentationError") or None,
            "llmEstimate": request.get("llmEstimate") or None,
            "llmEstimateError": request.get("llmEstimateError") or None,
        },
        "status": result.auto_status,
        "physical": physical_data,
        "physicalSource": physical_source,
        "llmEstimate": _llm_estimate_summary(request),
        "segmentation": {
            "name": result.name,
            "source": "llm" if isinstance(getattr(result, "llm_segmentation", None), dict) else "yolo",
            "targetMode": getattr(result.target, "mode", None),
            "llm": llm_segmentation_summary,
            "fallbackError": request.get("llmSegmentationError") or None,
            "settings": result.settings,
            "statistics": statistics,
            "parts": _part_rows(result),
        },
        "review": result.ai_review if isinstance(result.ai_review, dict) else {},
        "composition": {
            "status": output.get("status"),
            "methodVersion": output.get("method_version"),
            "proportionReportingAllowed": output.get("proportion_reporting_allowed"),
            "mainBasis": output.get("main_basis"),
            "frequencyEffect": output.get("frequency_effect"),
            "materials": materials,
            "materialCount": len(materials),
            "mainMaterials": output.get("main_materials") or [],
            "hasMassFractions": bool(materials),
            "massFractionSum": _finite(sum((row.get("massFraction") or 0.0) for row in materials)),
            "massKgSum": _finite(sum((row.get("estimatedMassKg") or 0.0) for row in materials)),
            "broadMassFractions": output.get("broad_mass_fractions"),
            "voidFraction": output.get("void_fraction_of_envelope"),
            "bulkDensityKgM3": _bulk_density(physical_data),
            "materialDensityKgM3": _material_density(physical_data, output.get("void_fraction_of_envelope")),
            "densityConstraint": (
                "密度约束用的是「材料平均密度 = 质量 ÷ 去空腔后的材料体积」，"
                "等价于 Σ(wᵢ/ρᵢ) × 体密度 ≤ 1；不是用含空腔的体密度。"
            ),
            "decision": output.get("decision"),
            "broadStage": _trim_broad_stage(output.get("broad_stage") or {}),
            "refinementStage": _trim_refinement(output.get("refinement_stage") or {}),
            "candidates": candidates,
            "warnings": output.get("warnings") or [],
            "assumptions": {
                key: value
                for key, value in (output.get("assumptions") or {}).items()
                if key in {"identifiability", "proportion_interval", "volume_definition", "physical_input"}
            },
        },
        "fireLoad": {
            "status": fire_load.get("status"),
            "totalHeatMj": _finite(fire_load.get("total_heat_mj")),
            "knownHeatMj": _finite(fire_load.get("known_heat_mj")),
            "totalHeatIntervalMj": _interval(fire_load.get("total_heat_interval_mj")),
            "coverageMassFraction": _finite(fire_load.get("coverage_mass_fraction")),
            "unaccountedMassFraction": _finite(fire_load.get("unaccounted_mass_fraction")),
            "formula": fire_load.get("formula"),
            "methodVersion": fire_load.get("method_version"),
            "materials": heat_materials,
            "omittedMaterials": max(0, len(raw_heat) - 15),
            "materialCount": len(raw_heat),
            "warnings": fire_load.get("warnings") or [],
            "floorAreaM2": _finite(fire_load.get("floor_area_m2")),
            "fireLoadDensityMjM2": _finite(fire_load.get("fire_load_density_mj_m2")),
            "heatBases": [str(item) for item in (fire_load.get("heat_bases") or [])],
            "mixedHeatBasis": bool(fire_load.get("mixed_heat_basis")),
            "heatBasisLabel": _heat_basis_label(fire_load),
        },
    }
    return payload


# --------------------------------------------------------------------------- #
# llm segmentation (no local YOLO)
# --------------------------------------------------------------------------- #
def _llm_target(analysis, document, segmentation: dict, name: str):
    """Turn the vision model's normalised box into an analysis.Target."""
    width, height = document.image.size
    box = segmentation.get("target") if isinstance(segmentation, dict) else None
    if isinstance(box, dict):
        try:
            x0 = float(box.get("x0"))
            y0 = float(box.get("y0"))
            x1 = float(box.get("x1"))
            y1 = float(box.get("y1"))
        except (TypeError, ValueError):
            x0, y0, x1, y1 = 0.0, 0.0, 1.0, 1.0
        x0 = min(max(x0, 0.0), 1.0) * width
        x1 = min(max(x1, 0.0), 1.0) * width
        y0 = min(max(y0, 0.0), 1.0) * height
        y1 = min(max(y1, 0.0), 1.0) * height
        if x1 - x0 >= 8 and y1 - y0 >= 8:
            return analysis.Target(bbox=(x0, y0, x1, y1), mode="llm", name=name)
    return analysis.Target(bbox=(0, 0, width, height), mode="llm", name=name)


def _llm_result_class(analysis):
    """analysis.Result stand-in whose visible material shares come from a model."""

    class LlmSegmentResult(analysis.Result):
        llm_segmentation = {}

        def statistics(self):
            total = int(self.target_mask.sum())
            rows = []
            for item in self.llm_segmentation.get("materials") or []:
                broad = str(item.get("broad") or "").strip()
                if broad not in analysis.MATERIALS:
                    continue
                try:
                    share = float(item.get("share") or 0.0)
                except (TypeError, ValueError):
                    continue
                if share <= 0:
                    continue
                pixels = int(round(total * share))
                if pixels <= 0:
                    continue
                rows.append(
                    {
                        "material": broad,
                        "name": analysis.CN.get(broad, broad),
                        "pixels": pixels,
                        "ratio": pixels / total if total else 0.0,
                        "highest_model_score": None,
                        "source": "视觉模型直接判定",
                    }
                )
            used = sum(row["pixels"] for row in rows)
            unknown_pixels = max(0, total - used)
            rows.append(
                {
                    "material": "unknown",
                    "name": analysis.CN["unknown"],
                    "pixels": unknown_pixels,
                    "ratio": unknown_pixels / total if total else 0.0,
                    "highest_model_score": None,
                    "source": "未判断",
                }
            )
            known = sum(row["ratio"] for row in rows if row["material"] != "unknown")
            metal = any(row["material"] == "metal" for row in rows)
            return {
                "target_pixels": total,
                "materials": rows,
                "known_ratio": min(1.0, known),
                "metal_state": "model_confirmed_present" if metal else "model_not_visible",
                "pending_metal_count": 0,
                "model_accepted_metal_count": 0,
                "model_uncertain_metal_count": 0,
                "ai_review_status": "skipped",
            }

    return LlmSegmentResult


def _build_llm_result(analysis, document, target, segmentation, name, settings, review):
    crop, roi_original, target_mask = analysis.prepare_crop(document, target)
    ResultClass = _llm_result_class(analysis)
    result = ResultClass(
        document=document,
        target=target,
        crop=crop,
        roi_original=roi_original,
        target_mask=target_mask,
        parts=[],
        name=name,
        settings=settings,
        ai_review=review,
        auto_status={},
    )
    result.llm_segmentation = dict(segmentation or {})
    return result


# --------------------------------------------------------------------------- #
# job runner
# --------------------------------------------------------------------------- #
def request_segmentation(reader: "StdinReader", request: dict, timeout: float = 300.0) -> dict:
    """Ask the host for a vision-model segmentation result (used by batch mode).

    Batch runs every item inside one Python process, so the host cannot precompute
    the segmentation the way it does for a single job. The bridge therefore asks
    the host over the same JSON-line channel it already uses for decisions.
    """
    request_id = uuid.uuid4().hex
    image_path = str(request.get("imagePath") or "")
    emit_raw(
        {
            "type": "segment-request",
            "id": request_id,
            "payload": {
                "kind": "furniture-fireload-segmentation",
                "imagePath": image_path,
                "imageName": Path(image_path).name if image_path else "",
                "category": str(request.get("category") or ""),
                "furnitureType": str(request.get("furnitureType") or ""),
                "furnitureName": str(request.get("furnitureName") or ""),
                "dimensions": request.get("dimensions") or {},
            },
        }
    )
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("等待视觉模型分割超时。")
        message = reader.next_message(min(30.0, remaining))
        if message is None:
            raise RuntimeError("宿主通道已关闭，无法取得视觉模型分割结果。")
        if message == "timeout":
            continue
        if not isinstance(message, dict):
            continue
        if message.get("type") == "raw":
            continue
        if message.get("id") != request_id:
            continue
        if message.get("error"):
            raise RuntimeError(str(message["error"]))
        payload = message.get("payload")
        segmentation = message.get("segmentation")
        if not isinstance(segmentation, dict) and isinstance(payload, dict):
            segmentation = payload.get("segmentation")
        if not isinstance(segmentation, dict) or not segmentation.get("materials"):
            raise RuntimeError("宿主没有返回可用的分割结果。")
        segmentation.setdefault("model", message.get("model"))
        segmentation.setdefault("images", message.get("images"))
        return segmentation


def request_estimate(reader: "StdinReader", request: dict, timeout: float = 300.0) -> dict:
    """Ask the host for an LLM mass/volume estimate (used by batch mode).

    Batch runs every item inside one Python process, so the host cannot
    precompute the estimate the way it does for a single job. The bridge asks
    over the same JSON-line channel it uses for decisions and segmentation.
    """
    request_id = uuid.uuid4().hex
    image_path = str(request.get("imagePath") or "")
    emit_raw(
        {
            "type": "estimate-request",
            "id": request_id,
            "payload": {
                "kind": "furniture-fireload-estimate",
                "imagePath": image_path,
                "imageName": Path(image_path).name if image_path else "",
                "category": str(request.get("category") or ""),
                "furnitureType": str(request.get("furnitureType") or ""),
                "furnitureName": str(request.get("furnitureName") or ""),
                "dimensions": request.get("dimensions") or {},
            },
        }
    )
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("等待视觉模型估计质量与体积超时。")
        message = reader.next_message(min(30.0, remaining))
        if message is None:
            raise RuntimeError("宿主通道已关闭，无法取得视觉模型的质量与体积估计。")
        if message == "timeout":
            continue
        if not isinstance(message, dict):
            continue
        if message.get("type") == "raw":
            continue
        if message.get("id") != request_id:
            continue
        if message.get("error"):
            raise RuntimeError(str(message["error"]))
        payload = message.get("payload")
        estimate = message.get("estimate")
        if not isinstance(estimate, dict) and isinstance(payload, dict):
            estimate = payload.get("estimate")
        if not isinstance(estimate, dict):
            raise RuntimeError("宿主没有返回可用的质量与体积估计。")
        mass = estimate.get("massKg")
        volume = estimate.get("volumeM3")
        if not isinstance(mass, (int, float)) or not isinstance(volume, (int, float)) or mass <= 0 or volume <= 0:
            raise RuntimeError("视觉模型没有给出可用的质量/体积。")
        estimate.setdefault("model", message.get("model"))
        estimate.setdefault("images", message.get("images"))
        return estimate


def run_job(request: dict, reader: StdinReader) -> int:
    started = time.monotonic()
    image_path = str(request.get("imagePath") or "").strip()
    if not image_path or not Path(image_path).exists():
        raise RuntimeError(f"图片不存在：{image_path or '(空)'}")
    out_dir = Path(str(request.get("outputDir") or (Path.cwd() / "out"))).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    material_dir = resolve_material_dir(request)
    tool_a = str(material_dir)
    tool_b = str(request.get("toolB") or DEFAULT_TOOL_B).strip()
    physical_engine = str(request.get("physicalEngine") or "auto").strip().lower()
    builtin_physical = bool(
        physical_engine in {"auto", "builtin"} and builtin_fireprediction_available()
    )
    if tool_a not in sys.path:
        sys.path.insert(0, tool_a)
    runtime_dir = str(request.get("runtimeDir") or "").strip()
    os.environ.setdefault(
        "FM_RUNTIME_DIR",
        str(Path(runtime_dir) if runtime_dir else (material_dir / ".runtime")),
    )

    meta = {
        "protocol": PROTOCOL_VERSION,
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "toolA": tool_a,
        "toolB": tool_b,
        "physicalEngine": "builtin" if builtin_physical else (physical_engine or "auto"),
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "jobId": request.get("jobId"),
    }
    emit({"type": "meta", **meta})

    trace_enabled = bool(os.environ.get("FM_TRACE"))

    def trace(message: str) -> None:
        if trace_enabled:
            emit({"type": "trace", "message": message, "elapsed": round(time.monotonic() - started, 3)})

    trace("importing analysis")
    import analysis

    trace("importing auto_workflow")
    import auto_workflow

    trace("importing composition_report")
    import composition_report

    trace("importing physical")
    import physical as physical_module  # noqa: F401  (imported for resolve_physical)

    trace("imports complete")

    notices: list[str] = []

    # LLM mass/volume estimate: in batch mode the host is asked per item instead
    # of precomputing it before spawning Python.
    estimate_cfg = request.get("llmEstimate") or {}
    estimate_enabled = (
        isinstance(estimate_cfg, dict)
        and bool(estimate_cfg.get("enabled"))
        and str(request.get("llmEstimateChannel") or "") == "host"
    )
    manual_values = request.get("physical") or {}
    has_manual_physical = bool(
        (manual_values.get("massKg") and manual_values.get("volumeM3"))
        or (request.get("massKg") and request.get("volumeM3"))
    )
    if estimate_enabled and not has_manual_physical and not request.get("physicalEstimate"):
        progress("physical", "正在请视觉模型直接估计质量与体积（不用 Fireprediction）…")
        try:
            estimate = request_estimate(reader, request)
            request["physicalEstimate"] = estimate
            request["massKg"] = float(estimate["massKg"])
            request["volumeM3"] = float(estimate["volumeM3"])
            request["volumeKind"] = "envelope"
            request["physicalSource"] = "llm-estimate"
            request["useFireprediction"] = False
            progress(
                "physical",
                "视觉模型估计质量 {:.2f} kg / 体积 {:.4f} m³（来源 llm-estimate，跳过 Fireprediction）。".format(
                    float(estimate["massKg"]), float(estimate["volumeM3"])
                ),
            )
        except Exception as error:  # fall back to Fireprediction, keep the item running
            text = str(error)
            request["llmEstimateError"] = text
            request["useFireprediction"] = True
            progress("physical", f"视觉模型估计不可用（{text}），本次改用 Fireprediction。", level="warn")
            notices.append(f"视觉模型估计质量/体积不可用（{text}），已回退 Fireprediction。")

    progress("physical", "正在准备质量与体积（Fireprediction 或手工输入）…")
    physical_data, physical_source, physical_notices = resolve_physical(request, out_dir, image_path)
    notices.extend(physical_notices)
    for notice in physical_notices:
        progress("physical", notice, level="warn")
    if physical_data is not None:
        mass = (physical_data.get("mass") or {}).get("value_kg")
        volume = (physical_data.get("volume") or {}).get("value_m3")
        progress(
            "physical",
            f"质量 {mass} kg / 体积 {volume} m³（来源：{physical_source}）。",
        )

    llm_segmentation = request.get("llmSegmentation")
    engine = str((request.get("segmentation") or {}).get("engine") or "yolo").strip().lower()
    if engine == "llm" and not (isinstance(llm_segmentation, dict) and llm_segmentation.get("materials")):
        progress("segmentation", "正在请视觉模型判定材质区域（不用本机 YOLO）…")
        try:
            llm_segmentation = request_segmentation(reader, request)
            request["llmSegmentation"] = llm_segmentation
        except Exception as error:  # fall back to local YOLO, keep the item running
            text = str(error)
            request["llmSegmentationError"] = text
            llm_segmentation = None
            request["llmSegmentation"] = None
            progress("segmentation", f"视觉模型分割不可用（{text}），本次回退本机 YOLO。", level="warn")
            notices.append(f"视觉模型分割不可用（{text}），已回退本机 YOLO。")
    llm_mode = isinstance(llm_segmentation, dict) and bool(llm_segmentation.get("materials"))

    progress("segmentation", "正在打开图片…" if llm_mode else "正在打开图片并准备本机分割…")
    document = analysis.Document.open(image_path)
    name = str(request.get("furnitureName") or "家具").strip() or "家具"
    target_cfg = request.get("target") or {}
    rect = target_cfg.get("rect")
    device = str(request.get("device") or "").strip()
    segmentation = request.get("segmentation") or {}
    conf = float(segmentation.get("conf", 0.25))
    metal_conf = float(segmentation.get("metalConf", 0.20))
    metal_enabled = bool(segmentation.get("metalEnabled", True))

    def on_progress(text: str) -> None:
        progress("pipeline", str(text))

    if llm_mode:
        if isinstance(rect, (list, tuple)) and len(rect) == 4:
            notices.append("本次由视觉模型判断家具目标框，已忽略手动画框。")
        target = _llm_target(analysis, document, llm_segmentation, name)
        settings = {
            "segmentation_engine": "llm",
            "segmentation_model": llm_segmentation.get("model"),
            "segmentation_images": llm_segmentation.get("images"),
            "segmentation_confidence": llm_segmentation.get("confidence"),
            "target_source": "llm",
        }
        review = {
            "status": "skipped",
            "mode": "llm-segmentation",
            "reason": "材质区域与可见面积占比由视觉模型直接给出，未做本机 YOLO 分割与逐区域复核。",
            "score_origin": "multimodal_model_uncalibrated",
            "metadata": {
                "model": llm_segmentation.get("model"),
                "images": llm_segmentation.get("images"),
                "confidence": llm_segmentation.get("confidence"),
                "notes": llm_segmentation.get("notes"),
                "target": llm_segmentation.get("target"),
                "dropped": llm_segmentation.get("dropped") or [],
            },
        }
        result = _build_llm_result(analysis, document, target, llm_segmentation, name, settings, review)
        shares = "、".join(
            f"{analysis.CN.get(str(row.get('broad')), row.get('broad'))} {float(row.get('share') or 0) * 100:.1f}%"
            for row in llm_segmentation.get("materials") or []
        )
        progress("segmentation", f"视觉模型直接判定：{shares}（不做本机分割与逐区域复核）。")
        for dropped in llm_segmentation.get("dropped") or []:
            notices.append(f"视觉模型给出的大类「{dropped}」不属于本工具的五类材质，已忽略。")
        router = build_router(request, reader)
        progress(
            "decider",
            "构造判定：" + _client_label(router.decision) + "｜视觉复核：" + _client_label(router.review),
        )
        furniture_type = str(request.get("furnitureType") or "").strip()
        progress("composition", "正在结合尺寸、质量与可见材质占比推断材料组合…")
        trace("importing catalog/composition for llm segmentation")
        from catalog import Catalog
        import composition

        catalog = Catalog()
        output = composition.infer(
            result,
            catalog,
            physical=physical_data,
            decision_client=router,
            furniture_type=furniture_type,
            progress=on_progress,
        )
        result.composition = output
        if output:
            output["warnings"] = [
                "视觉模型直接判定模式下可见材质依据不足（known_ratio<0.15），结果不确定性高。"
                if "本机分割尚无充分可见材质依据" in str(warning)
                else warning
                for warning in (output.get("warnings") or [])
            ]
        refinement = (output or {}).get("refinement_stage") or {}
        fire_load_result = (output or {}).get("fire_load") or {}
        result.auto_status = {
            "status": "complete" if output else "partial",
            "stage": "finished",
            "stages": {
                "segmentation": {"status": "complete", "source": "llm", "model": llm_segmentation.get("model")},
                "ai_review": {"status": "skipped", "reason": "llm_segmentation"},
                "composition": {"status": "complete" if output else "not_run"},
                "material_refinement": {"status": refinement.get("status") or "not_run"},
                "fire_load": {"status": fire_load_result.get("status") or "not_run"},
            },
            "errors": [],
            "ratio_status": (output or {}).get("status"),
            "physical_notices": list(physical_notices),
        }
    else:
        if isinstance(rect, (list, tuple)) and len(rect) == 4:
            target = analysis.Target(tuple(float(value) for value in rect), mode="rectangle", name=name)
        else:
            target = analysis.Target(mode="whole", name=name)
        engine = analysis.Engine(device or None)
        router = build_router(request, reader)
        progress(
            "decider",
            "构造判定：" + _client_label(router.decision) + "｜视觉复核：" + _client_label(router.review),
        )
        furniture_type = str(request.get("furnitureType") or "").strip()
        result = auto_workflow.run_full_analysis(
            document,
            target,
            engine,
            physical=physical_data,
            furniture_type=furniture_type,
            client=router,
            progress=on_progress,
            conf=conf,
            metal_conf=metal_conf,
            metal_enabled=metal_enabled,
        )

    artifacts: list[str] = []
    progress("artifacts", "正在生成标注图与报告…")
    if llm_mode:
        try:
            overlay = document.preview.copy()
            drawer = analysis.ImageDraw.Draw(overlay)
            preview_width, preview_height = overlay.size
            image_width, image_height = document.image.size
            bx0, by0, bx1, by1 = target.bbox
            scale_x = preview_width / image_width
            scale_y = preview_height / image_height
            drawer.rectangle(
                [bx0 * scale_x, by0 * scale_y, bx1 * scale_x, by1 * scale_y],
                outline=(206, 96, 70),
                width=max(2, int(min(preview_width, preview_height) * 0.006)),
            )
            overlay_path = out_dir / "overlay.png"
            overlay.save(overlay_path)
            artifacts.append(overlay_path.name)
        except Exception as error:  # rendering is cosmetic, never fatal
            notices.append(f"标注图渲染失败：{error}")
    else:
        try:
            overlay = analysis.render_overlay(result)
            overlay_path = out_dir / "overlay.png"
            overlay.save(overlay_path)
            artifacts.append(overlay_path.name)
        except Exception as error:  # rendering is cosmetic, never fatal
            notices.append(f"标注图渲染失败：{error}")
    try:
        crop_path = out_dir / "crop.png"
        result.crop.save(crop_path)
        artifacts.append(crop_path.name)
    except Exception as error:
        notices.append(f"裁剪图保存失败：{error}")

    output = result.composition if isinstance(getattr(result, "composition", None), dict) else {}
    if output:
        try:
            for filename, data in composition_report.extra_files(result, output).items():
                (out_dir / filename).write_bytes(data)
                artifacts.append(filename)
        except Exception as error:
            notices.append(f"报告导出失败：{error}")
    else:
        notices.append("构造与热量估计未完成，未生成材料报告。")

    payload = build_payload(result, physical_data, physical_source, request, meta)
    payload["elapsedMs"] = int((time.monotonic() - started) * 1000)
    payload["artifacts"] = artifacts
    payload["notices"] = notices
    payload["outputDir"] = str(out_dir)
    (out_dir / "result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    fire_load = payload.get("fireLoad") or {}
    if fire_load.get("totalHeatMj") is not None:
        progress("finished", f"单个家具潜在热量约 {fire_load['totalHeatMj']:.1f} MJ。")
    emit({"type": "result", "payload": payload})
    return 0


def _catalog_report(tool_a: str) -> int:
    resolved = str(resolve_material_dir({"toolA": tool_a}))
    if resolved not in sys.path:
        sys.path.insert(0, resolved)
    from catalog import Catalog

    catalog = Catalog()
    emit(
        {
            "type": "catalog",
            "furnitureTypes": catalog.summary().get("furniture_types", []),
            "materialCount": catalog.summary().get("material_count"),
            "python": sys.version.split()[0],
        }
    )
    return 0


def _check(tool_a: str) -> int:
    resolved = str(resolve_material_dir({"toolA": tool_a}))
    sys.path.insert(0, resolved)
    report: dict = {
        "ok": True,
        "python": sys.version.split()[0],
        "materialDir": resolved,
        "modules": {},
    }
    for name in (
        "analysis",
        "auto_workflow",
        "catalog",
        "composition",
        "composition_report",
        "fire_load",
        "physical",
        "refinement",
        "decision_client",
        "free_vision_client",
        "model_clients",
        "credentials",
    ):
        try:
            __import__(name)
            report["modules"][name] = "ok"
        except Exception as error:
            report["modules"][name] = f"{type(error).__name__}: {error}"
            report["ok"] = False
    try:
        import requests  # noqa: F401

        report["requests"] = "ok"
    except Exception as error:
        report["requests"] = f"{type(error).__name__}: {error}"
    try:
        report["fireprediction"] = "ok" if builtin_fireprediction_available() else "内置模型缺失"
    except Exception as error:  # noqa: BLE001
        report["fireprediction"] = f"{type(error).__name__}: {error}"
    emit({"type": "check", **report})
    return 0 if report["ok"] else 1


def main(argv=None) -> int:
    if os.environ.get("FM_TRACE"):
        try:
            import faulthandler

            faulthandler.dump_traceback_later(15, repeat=True)
        except Exception:
            pass
    try:
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
        sys.stdin.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="DSH furniture fire-load bridge")
    parser.add_argument("--request", help="path to a JSON request file (default: first stdin line)")
    parser.add_argument("--batch", help="path to a batch request JSON file (Excel in / Excel out)")
    parser.add_argument("--xlsx-template", help="write an example batch input workbook and exit")
    parser.add_argument("--catalog", action="store_true", help="print furniture categories")
    parser.add_argument("--check", action="store_true", help="import smoke test")
    parser.add_argument("--toolA", default=os.environ.get("FURNITURE_TOOL_A") or DEFAULT_TOOL_A)
    args = parser.parse_args(argv)

    if args.xlsx_template:
        import batch as batch_module

        path = batch_module.write_template(args.xlsx_template)
        emit({"type": "template", "path": path})
        return 0
    if args.batch:
        import batch as batch_module

        request = json.loads(Path(args.batch).read_text(encoding="utf-8-sig"))
        return batch_module.run_batch(request, StdinReader())

    if args.catalog:
        return _catalog_report(args.toolA)
    if args.check:
        return _check(args.toolA)

    reader = StdinReader()
    try:
        if args.request:
            request = json.loads(Path(args.request).read_text(encoding="utf-8-sig"))
        else:
            first = reader.next_message(120.0)
            if first == "timeout" or first is None:
                raise RuntimeError("没有收到任务请求（120 秒内 stdin 无内容）。")
            request = first
        return run_job(request, reader)
    except Exception as error:
        emit(
            {
                "type": "error",
                "message": str(error) or type(error).__name__,
                "errorType": type(error).__name__,
                "traceback": traceback.format_exc()[-4000:],
            }
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
