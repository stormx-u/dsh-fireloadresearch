"""Small, single-attempt client for OpenRouter's typed Decisions API.

API contract checked against the official reference and multimodal guide:
https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request
https://openrouter.ai/docs/guides/community/multimodal-decisions

Only ``last_metadata`` is suitable for saving with an exported result. Request
state, image data, credentials, raw responses and transport exceptions are never
logged or attached to that metadata.
"""
from __future__ import annotations

import base64
from io import BytesIO
import math
import re
from collections.abc import Callable

from PIL import Image, ImageOps
import requests


DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"
DEFAULT_MODEL = "perplexity/pplx-decider-v1.2"
DEFAULT_TIMEOUT = (10.0, 45.0)
# These are conservative application limits, not claims about provider limits.
MAX_IMAGES = 4
MAX_IMAGE_SIDE = 1536
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024
MAX_QUESTIONS = 64
_ID = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}\Z")
_MODEL = re.compile(r"[~A-Za-z0-9][A-Za-z0-9_./~-]{0,199}\Z")
_META_ID = re.compile(r"[A-Za-z0-9_.:-]{1,200}\Z")


class DecisionError(RuntimeError):
    """A user-displayable failure containing no raw request or response data."""


def _number(value: object) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value) and value >= 0
    except (OverflowError, ValueError):
        return False


def _prepare_questions(questions: list[dict]) -> dict:
    if not isinstance(questions, list) or not 1 <= len(questions) <= MAX_QUESTIONS:
        raise ValueError("决策问题数量无效。")
    prepared = {}
    for question in questions:
        if not isinstance(question, dict):
            raise ValueError("决策问题格式无效。")
        question_id = question.get("id")
        instructions = question.get("instructions")
        criteria = question.get("criteria")
        if (
            not isinstance(question_id, str)
            or not _ID.fullmatch(question_id)
            or question_id in prepared
            or question.get("type", "choice") != "choice"
            or not isinstance(instructions, str)
            or not instructions.strip()
            or not isinstance(criteria, dict)
            or not 2 <= len(criteria) <= 255
            or "unknown" not in criteria
        ):
            raise ValueError("决策问题必须具有唯一 ID、说明和包含 unknown 的固定候选。")
        if any(
            not isinstance(option, str)
            or not _ID.fullmatch(option)
            or (description is not None and not isinstance(description, str))
            for option, description in criteria.items()
        ):
            raise ValueError("决策候选格式无效。")
        prepared[question_id] = {
            "type": "choice",
            "instructions": instructions,
            "criteria": dict(criteria),
        }
    return prepared


def _encode_image(image: Image.Image) -> bytes:
    if not isinstance(image, Image.Image):
        raise ValueError("决策图片格式无效。")
    try:
        oriented = ImageOps.exif_transpose(image)
        if "A" in oriented.getbands() or (
            oriented.mode == "P" and "transparency" in oriented.info
        ):
            rgba = oriented.convert("RGBA")
            clean = Image.new("RGB", rgba.size, "white")
            clean.paste(rgba, mask=rgba.getchannel("A"))
        else:
            # A new image prevents EXIF, comments and other metadata travelling.
            clean = Image.new("RGB", oriented.size)
            clean.paste(oriented.convert("RGB"))
        clean.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
        output = BytesIO()
        clean.save(output, format="JPEG", quality=90)
        data = output.getvalue()
    except Exception:
        raise ValueError("无法准备决策图片。") from None
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("决策图片过大，请缩小图片。")
    return data


def _parse_answers(payload: object, questions: dict) -> dict:
    if not isinstance(payload, dict) or not isinstance(payload.get("answers"), dict):
        raise DecisionError("决策服务返回的数据格式无效。")
    answers = payload["answers"]
    if set(answers) != set(questions):
        raise DecisionError("决策服务未完整回答本次问题。")
    parsed = {}
    for question_id, question in questions.items():
        answer = answers[question_id]
        if not isinstance(answer, dict) or answer.get("type") != "choice":
            raise DecisionError("决策服务返回了不支持的回答类型。")
        probabilities = answer.get("probabilities")
        options = question["criteria"]
        if not isinstance(probabilities, dict) or set(probabilities) != set(options):
            raise DecisionError("决策服务返回的候选概率不完整。")
        if not all(_number(value) for value in probabilities.values()):
            raise DecisionError("决策服务返回了无效概率。")
        try:
            total = math.fsum(probabilities.values())
        except (OverflowError, ValueError):
            raise DecisionError("决策服务返回了无效概率。") from None
        if not math.isfinite(total) or total <= 0:
            raise DecisionError("决策服务返回了无效概率。")
        normalized = {option: probabilities[option] / total for option in options}
        choice = answer.get("choice")
        if not isinstance(choice, str) or choice not in options:
            raise DecisionError("决策服务返回了未知候选。")
        # A conflicting choice must not silently override the distribution.
        if normalized[choice] < max(normalized.values()):
            raise DecisionError("决策服务的选择与候选概率不一致。")
        parsed[question_id] = {"probabilities": normalized, "choice": choice}
    return parsed


class DecisionClient:
    """Submit all questions in one paid request, with no automatic retry.

    ``questions`` is a list of ``{id, instructions, criteria}`` dictionaries;
    ``type`` may be omitted or set to ``choice``. Every criteria mapping must
    include the explicit fallback ID ``unknown``. ``request`` can be replaced
    by a callable with the ``requests.post`` signature for offline tests.

    The timeout bounds connection establishment and each socket read. The
    client does not follow redirects, retry, or change to another model.
    """

    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_MODEL,
        *,
        timeout: tuple[float, float] = DEFAULT_TIMEOUT,
        request: Callable | None = None,
    ):
        if (
            not isinstance(api_key, str)
            or not api_key.strip()
            or len(api_key) > 4096
            or any(character.isspace() for character in api_key.strip())
        ):
            raise ValueError("请提供有效的 OpenRouter API 密钥。")
        if not isinstance(model, str) or not _MODEL.fullmatch(model):
            raise ValueError("决策模型 ID 无效。")
        if (
            not isinstance(timeout, (tuple, list))
            or len(timeout) != 2
            or not all(_number(value) and 0 < value <= 120 for value in timeout)
        ):
            raise ValueError("决策连接与读取超时必须在 0 到 120 秒之间。")
        self._api_key = api_key.strip()
        self.model = model
        self.timeout = tuple(float(value) for value in timeout)
        self._request = request if request is not None else requests.post
        self.network_calls = 0
        self.last_metadata: dict = {}

    def _metadata(self, payload: dict) -> dict:
        def safe_string(value: object, pattern: re.Pattern) -> str | None:
            if (
                isinstance(value, str)
                and pattern.fullmatch(value)
                and self._api_key not in value
            ):
                return value
            return None

        usage = payload.get("usage")
        safe_usage = {}
        if isinstance(usage, dict):
            for field in ("input_tokens", "output_tokens", "total_tokens", "cost"):
                value = usage.get(field)
                if _number(value):
                    safe_usage[field] = value
        return {
            "id": safe_string(payload.get("id"), _META_ID),
            "model": safe_string(payload.get("model"), _MODEL),
            "usage": safe_usage,
        }

    def decide(self, state_text: str, images: list[Image.Image], questions: list[dict]) -> dict:
        self.last_metadata = {}
        if not isinstance(state_text, str) or not state_text.strip():
            raise ValueError("决策说明不能为空。")
        prepared_questions = _prepare_questions(questions)
        if not isinstance(images, list) or len(images) > MAX_IMAGES:
            raise ValueError("每次决策最多使用 4 张图片。")
        encoded = [_encode_image(image) for image in images]
        if sum(map(len, encoded)) > MAX_TOTAL_IMAGE_BYTES:
            raise ValueError("决策图片总大小过大，请缩小图片。")
        state = [state_text]
        for data in encoded:
            state.append({
                "type": "image_url",
                "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(data).decode("ascii")},
            })
        body = {"model": self.model, "state": state, "questions": prepared_questions}
        self.network_calls += 1
        try:
            response = self._request(
                DECISIONS_URL,
                json=body,
                headers={"Authorization": "Bearer " + self._api_key, "Content-Type": "application/json"},
                timeout=self.timeout,
                allow_redirects=False,
            )
        except requests.Timeout:
            raise DecisionError("决策请求超时；本次未自动重试。") from None
        except Exception:
            raise DecisionError("无法连接决策服务；本次未自动重试。") from None
        try:
            status = response.status_code
            if not isinstance(status, int) or isinstance(status, bool) or not 200 <= status < 300:
                code = str(status) if isinstance(status, int) and not isinstance(status, bool) else "未知"
                if status == 402:
                    raise DecisionError("OpenRouter 账户或密钥余额不足（HTTP 402），请检查额度；本次未自动重试。")
                raise DecisionError(f"决策服务请求失败（HTTP {code}）；本次未自动重试。")
            try:
                payload = response.json()
            except Exception:
                raise DecisionError("决策服务返回了无法解析的数据。") from None
            if isinstance(payload, dict):
                self.last_metadata = self._metadata(payload)
            return _parse_answers(payload, prepared_questions)
        finally:
            try:
                response.close()
            except Exception:
                pass
