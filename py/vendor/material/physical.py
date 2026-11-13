"""Validated physical evidence; envelope volume always includes closed voids.

All returned masses use kg, volumes m³, and densities kg/m³. A density derived
from the same mass and volume is never an additional independent constraint.
This module uses only the standard library and never runs prediction or APIs.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
from uuid import UUID


FIREPREDICTION_VOLUME_DEFINITION = "外壳包裹体积（含封闭内部空腔）/轴对齐包围盒体积"
_STATUSES = {"measured", "estimated"}
_VOLUME_KINDS = {"envelope", "material_volume"}
_MAX_JSON_BYTES = 5 * 1024 * 1024


class PhysicalDataError(ValueError):
    """A rejected import, with a stable code and a user-facing explanation."""

    def __init__(self, message: str, code: str = "invalid_physical_data"):
        super().__init__(message)
        self.code = code


def _positive(value, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PhysicalDataError(f"{name}必须是数值，不能是文本或布尔值。")
    try:
        number = float(value)
    except (OverflowError, ValueError):
        raise PhysicalDataError(f"{name}必须是大于零的有限数值。") from None
    if not math.isfinite(number) or number <= 0:
        raise PhysicalDataError(f"{name}必须是大于零的有限数值。")
    return number


def _text(value, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PhysicalDataError(f"{name}缺失或不是有效文本。")
    return value


def _object(value, name: str) -> dict:
    if not isinstance(value, dict):
        raise PhysicalDataError(f"{name}必须是 JSON 对象。")
    return value


def _sha256(value, name: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", value):
        raise PhysicalDataError(f"{name}必须是完整的 SHA256。")
    return value.lower()


def _prediction_id(value, name: str = "预测记录ID") -> str:
    try:
        if not isinstance(value, str):
            raise ValueError
        parsed = UUID(value)
        if str(parsed) != value.lower():
            raise ValueError
    except ValueError:
        raise PhysicalDataError(f"{name}必须是标准 UUID。") from None
    return str(parsed)


def _file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
    except OSError as exc:
        raise PhysicalDataError(f"无法读取所选图片：{exc}", "image_unavailable") from exc
    return digest.hexdigest()


def _equal(actual: float, expected: float, name: str) -> None:
    if not math.isfinite(expected) or expected <= 0 or not math.isclose(
        actual, expected, rel_tol=1e-8, abs_tol=0.0
    ):
        raise PhysicalDataError(f"{name}与导出文件内的其他数值不一致。", "inconsistent_values")


def _density(mass: float, volume: float) -> float:
    return _positive(mass / volume, "派生平均密度（kg/m³）")


def _derived(mass: float, volume: dict) -> dict:
    return {
        "bulk_density_kg_m3": _density(mass, volume["value_m3"]),
        "envelope_bulk_density_kg_m3": (
            _density(mass, volume["envelope_m3"]) if volume["envelope_m3"] is not None else None
        ),
        "bbox_bulk_density_kg_m3": (
            _density(mass, volume["bbox_m3"]) if volume["bbox_m3"] is not None else None
        ),
        "material_density_kg_m3": (
            _density(mass, volume["material_volume_m3"])
            if volume["material_volume_m3"] is not None else None
        ),
        "independent_constraint": False,
        "interpretation": "由同一质量除以对应体积得到，不能作为第三条独立物理约束。",
    }


def _volume(value: float, kind: str, status: str, *, bbox=None, ratio=None, model_id=None) -> dict:
    return {
        "value_m3": value,
        "kind": kind,
        "status": status,
        "envelope_m3": value if kind == "envelope" else None,
        "material_volume_m3": value if kind == "material_volume" else None,
        "bbox_m3": bbox,
        "envelope_ratio": ratio,
        "definition": (
            "envelope_including_closed_voids" if kind == "envelope" else "solid_material_volume_excluding_voids"
        ),
        "model_id": model_id,
    }


def _pairs_without_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PhysicalDataError(f"JSON 含有重复字段：{key}。")
        result[key] = value
    return result


def _reject_constant(value):
    raise PhysicalDataError(f"JSON 含有非有限数值：{value}。")


def _finite_json_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise PhysicalDataError("JSON 含有超出有限数值范围的数值。")
    return number


def load_fireprediction(
    path,
    *,
    image_path=None,
    expected_prediction_id=None,
    expected_image_sha256=None,
    require_match=True,
) -> dict:
    """Read a Fireprediction 1.0 JSON export and verify its explicit association.

    The caller supplies the current image/path hash, or a previously associated
    prediction UUID. Source filenames and categories are never matching evidence.
    All supplied identities must agree, even when require_match=False. Without
    matching evidence, require_match=False is for inspection only; it returns an
    ``unverified`` association and must not silently attach data to a photograph.
    """
    if not isinstance(require_match, bool):
        raise PhysicalDataError("require_match 必须是布尔值。")
    source_path = Path(path).expanduser().resolve()
    try:
        with source_path.open("rb") as stream:
            raw = stream.read(_MAX_JSON_BYTES + 1)
    except OSError as exc:
        raise PhysicalDataError(f"无法读取物理量 JSON：{exc}", "source_unavailable") from exc
    if len(raw) > _MAX_JSON_BYTES:
        raise PhysicalDataError("物理量 JSON 超过 5 MiB 上限。")
    return _normalize_fireprediction(
        raw, source_path, image_path=image_path,
        expected_prediction_id=expected_prediction_id,
        expected_image_sha256=expected_image_sha256, require_match=require_match,
    )


def _normalize_fireprediction(
    raw, source_path, *, image_path=None, expected_prediction_id=None,
    expected_image_sha256=None, require_match=True,
    source_kind="fireprediction_json", read_method="file",
):
    if not isinstance(require_match, bool):
        raise PhysicalDataError("require_match 必须是布尔值。")
    try:
        data = _object(json.loads(
            raw.decode("utf-8-sig"), object_pairs_hook=_pairs_without_duplicates,
            parse_constant=_reject_constant, parse_float=_finite_json_float,
        ), "根节点")
    except PhysicalDataError:
        raise
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise PhysicalDataError("文件不是有效的 UTF-8 JSON 导出。", "invalid_json") from exc
    if data.get("schema_version") != "1.0":
        raise PhysicalDataError("仅支持 Fireprediction schema_version 1.0 的 JSON 导出。", "unsupported_schema")
    prediction_id = _prediction_id(data.get("prediction_id"))
    created_at = _text(data.get("created_at"), "预测时间")
    try:
        parsed_time = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if parsed_time.utcoffset() is None:
            raise ValueError
    except ValueError:
        raise PhysicalDataError("预测时间必须包含时区。") from None
    category = _text(data.get("category"), "家具类别")
    image = _object(data.get("image"), "image")
    source_image_path = _text(image.get("path"), "导出图片路径")
    source_image_sha = _sha256(image.get("sha256"), "导出图片 SHA256")
    mass_data = _object(data.get("mass"), "mass")
    mass = _positive(mass_data.get("estimated_kg"), "预测质量（kg）")
    mass_model = _text(mass_data.get("model_id"), "质量模型")
    volume_data = _object(data.get("volume"), "volume")
    envelope = _positive(volume_data.get("estimated_m3"), "预测包络体积（m³）")
    bbox = _positive(volume_data.get("bbox_m3"), "包围盒体积（m³）")
    ratio = _positive(volume_data.get("ratio"), "包络体积占比")
    if ratio > 1:
        raise PhysicalDataError("包络体积占比不能大于 1。")
    percent = _positive(volume_data.get("ratio_percent"), "包络体积占比（%）")
    _equal(percent, ratio * 100.0, "百分比")
    _equal(envelope, bbox * ratio, "包络体积")
    volume_model = _text(volume_data.get("model_id"), "体积模型")
    if volume_data.get("definition") != FIREPREDICTION_VOLUME_DEFINITION:
        raise PhysicalDataError("体积定义与 Fireprediction 包络体积契约不符，不能视为材料体积。", "unknown_volume_definition")
    dimensions = _object(data.get("dimensions"), "dimensions")
    unit = dimensions.get("unit")
    if unit not in ("mm", "cm", "m"):
        raise PhysicalDataError("尺寸单位仅支持 mm、cm、m。")
    factor = {"mm": 0.001, "cm": 0.01, "m": 1.0}[unit]
    meters = [_positive(dimensions.get(key), label) * factor for key, label in (
        ("width", "宽度"), ("height", "高度"), ("depth", "深度")
    )]
    if any(not math.isfinite(side) or side <= 0 or side > 100 for side in meters):
        raise PhysicalDataError("换算后的尺寸必须大于零且不超过 100 米。")
    _equal(bbox, math.prod(meters), "包围盒体积")
    if "width_height_depth_cm" in dimensions:
        centimeters = dimensions["width_height_depth_cm"]
        if not isinstance(centimeters, list) or len(centimeters) != 3:
            raise PhysicalDataError("width_height_depth_cm 必须按宽、高、深提供三项数值。")
        for actual, side in zip(centimeters, meters):
            _equal(_positive(actual, "厘米尺寸"), side * 100.0, "厘米尺寸")
    notices = data.get("notices", [])
    if not isinstance(notices, list) or any(not isinstance(item, str) for item in notices):
        raise PhysicalDataError("notices 必须是文本列表。")

    matched_by = []
    current_sha = None
    selected_image_path = None
    if expected_prediction_id is not None:
        if _prediction_id(expected_prediction_id, "当前关联预测记录ID") != prediction_id:
            raise PhysicalDataError("预测记录ID不匹配；所选导出不属于当前关联记录。", "prediction_id_mismatch")
        matched_by.append("prediction_id")
    if expected_image_sha256 is not None:
        current_sha = _sha256(expected_image_sha256, "当前图片 SHA256")
        if current_sha != source_image_sha:
            raise PhysicalDataError("图片 SHA256 不匹配；所选导出不属于当前图片。", "image_sha256_mismatch")
        matched_by.append("image_sha256")
    if image_path is not None:
        selected_image_path = str(Path(image_path).expanduser().resolve())
        actual_sha = _file_digest(Path(selected_image_path))
        if current_sha is not None and current_sha != actual_sha:
            raise PhysicalDataError("当前图片文件与提供的 SHA256 不一致，请重新载入图片。", "image_sha256_mismatch")
        current_sha = actual_sha
        if current_sha != source_image_sha:
            raise PhysicalDataError("图片 SHA256 不匹配；所选导出不属于当前图片。", "image_sha256_mismatch")
        if "image_sha256" not in matched_by:
            matched_by.append("image_sha256")
    if require_match and not matched_by:
        raise PhysicalDataError("缺少当前图片 SHA256 或已关联的预测记录ID，不能自动套用所选导出。", "association_required")

    volume = _volume(envelope, "envelope", "estimated", bbox=bbox, ratio=ratio, model_id=volume_model)
    return {
        "schema_version": "1.0",
        "category": category,
        "source": {
            "kind": source_kind, "path": str(source_path),
            "sha256": hashlib.sha256(raw).hexdigest(), "prediction_id": prediction_id,
            "created_at": created_at, "read_method": read_method,
            "sha256_scope": "file" if source_kind == "fireprediction_json" else "selected_record_payload",
        },
        "association": {
            "state": "verified_sha256" if "image_sha256" in matched_by else ("id_only" if matched_by else "unverified"),
            "image_path": source_image_path, "image_sha256": source_image_sha,
            "selected_image_path": selected_image_path, "expected_image_sha256": current_sha,
            "matched_by": matched_by,
        },
        "mass": {"value_kg": mass, "status": "estimated", "model_id": mass_model},
        "volume": volume,
        "dimensions": {"width_m": meters[0], "height_m": meters[1], "depth_m": meters[2], "status": "user_input"},
        "derived": _derived(mass, volume),
        "notices": list(notices) + ["包络体积包含封闭空腔，不能直接当作实心材料体积。"],
    }


def _history_signatures(db_path: Path) -> dict:
    signatures = {}
    try:
        for path in (db_path, Path(str(db_path) + "-wal"), Path(str(db_path) + "-shm")):
            if path.exists():
                if not path.is_file():
                    raise PhysicalDataError("历史数据库或伴随文件不是普通文件。", "history_unavailable")
                stat = path.stat()
                signatures[path.name] = (stat.st_size, stat.st_mtime_ns)
    except OSError as exc:
        raise PhysicalDataError(f"无法检查历史数据库：{exc}", "history_unavailable") from exc
    if db_path.name not in signatures:
        raise PhysicalDataError("历史数据库不存在。", "history_unavailable")
    return signatures


def _query_history(db_path: Path, prediction_id=None, *, local_snapshot=False):
    # A writable local snapshot may let SQLite recover its copied WAL. The source
    # database always opens mode=ro; immutable is never used for live databases.
    uri = db_path.as_uri() + ("?mode=rw" if local_snapshot else "?mode=ro")
    connection = sqlite3.connect(uri, uri=True, timeout=3)
    try:
        connection.execute("PRAGMA query_only=ON")
        sql = "SELECT prediction_id, created_at, category, payload FROM prediction_history"
        if prediction_id is None:
            return connection.execute(sql + " ORDER BY created_at DESC, prediction_id").fetchall()
        return connection.execute(sql + " WHERE prediction_id = ?", (prediction_id,)).fetchall()
    finally:
        connection.close()


def _read_history(db_path, prediction_id=None):
    db_path = Path(db_path).expanduser().resolve()
    _history_signatures(db_path)
    try:
        return db_path, _query_history(db_path, prediction_id), "readonly"
    except sqlite3.Error:
        pass
    snapshot_root = Path(__file__).resolve().parent / ".runtime" / "history-snapshot"
    try:
        snapshot_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="history-", dir=snapshot_root) as folder:
            before = _history_signatures(db_path)
            for name in before:
                shutil.copyfile(db_path.parent / name, Path(folder) / name)
            after = _history_signatures(db_path)
            if before != after:
                raise PhysicalDataError(
                    "复制期间 Fireprediction 历史发生变化；请关闭 Fireprediction 后重试，或先导出 JSON。",
                    "history_changed_during_snapshot",
                )
            rows = _query_history(Path(folder) / db_path.name, prediction_id, local_snapshot=True)
        return db_path, rows, "verified_local_snapshot"
    except PhysicalDataError:
        raise
    except (OSError, sqlite3.Error) as exc:
        raise PhysicalDataError(
            f"无法只读加载历史数据库；请关闭 Fireprediction 后重试，或先导出 JSON。原因：{exc}",
            "history_unavailable",
        ) from exc


def _normalize_history_row(row, db_path, read_method, **kwargs):
    row_id, created_at, category, payload = row
    if not isinstance(payload, str) or len(payload.encode("utf8")) > _MAX_JSON_BYTES:
        raise PhysicalDataError("历史记录 payload 无效或超过大小上限。", "invalid_history_record")
    result = _normalize_fireprediction(
        payload.encode("utf8"), db_path, source_kind="fireprediction_history",
        read_method=read_method, **kwargs,
    )
    if row_id != result["source"]["prediction_id"] or created_at != result["source"]["created_at"] or category != result["category"]:
        raise PhysicalDataError("历史记录索引与 payload 不一致，拒绝载入。", "invalid_history_record")
    result["source"]["table"] = "prediction_history"
    return result


def list_history(db_path) -> list[dict]:
    """List validated records for explicit UI selection; never choose the latest."""
    source_path, rows, method = _read_history(db_path)
    summaries = []
    for row in rows:
        result = _normalize_history_row(row, source_path, method, require_match=False)
        summaries.append({
            "prediction_id": result["source"]["prediction_id"],
            "created_at": result["source"]["created_at"], "category": result["category"],
            "image_path": result["association"]["image_path"],
            "image_sha256": result["association"]["image_sha256"],
            "mass_kg": result["mass"]["value_kg"], "mass_status": "estimated",
            "volume_m3": result["volume"]["value_m3"], "volume_kind": "envelope",
            "bbox_m3": result["volume"]["bbox_m3"], "read_method": method,
        })
    return summaries


def load_history_record(
    db_path, prediction_id, *, image_path=None, expected_prediction_id=None,
    expected_image_sha256=None, require_match=True,
) -> dict:
    """Load exactly the selected UUID; choosing a row alone is not image matching."""
    selected_id = _prediction_id(prediction_id)
    source_path, rows, method = _read_history(db_path, selected_id)
    if len(rows) != 1:
        raise PhysicalDataError("历史记录中没有唯一对应的预测记录ID。", "history_record_not_found")
    return _normalize_history_row(
        rows[0], source_path, method, image_path=image_path,
        expected_prediction_id=expected_prediction_id,
        expected_image_sha256=expected_image_sha256, require_match=require_match,
    )


def make_manual_physical(
    mass_kg,
    volume_m3,
    *,
    volume_kind="envelope",
    mass_status="measured",
    volume_status="measured",
) -> dict:
    """Normalize explicit manual inputs without claiming image/UUID matching."""
    mass = _positive(mass_kg, "质量（kg）")
    value = _positive(volume_m3, "体积（m³）")
    if not isinstance(volume_kind, str) or volume_kind not in _VOLUME_KINDS:
        raise PhysicalDataError("体积口径必须是 envelope 或 material_volume。")
    if not isinstance(mass_status, str) or not isinstance(volume_status, str) or mass_status not in _STATUSES or volume_status not in _STATUSES:
        raise PhysicalDataError("物理量状态必须是 measured 或 estimated。")
    volume = _volume(value, volume_kind, volume_status)
    return {
        "schema_version": "1.0", "category": None,
        "source": {
            "kind": "manual", "path": None, "sha256": None, "prediction_id": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        "association": {
            "state": "manual_input", "image_path": None, "image_sha256": None,
            "selected_image_path": None, "expected_image_sha256": None, "matched_by": [],
        },
        "mass": {"value_kg": mass, "status": mass_status, "model_id": None},
        "volume": volume,
        "dimensions": None,
        "derived": _derived(mass, volume),
        "notices": (["包络体积包含封闭空腔，不能直接当作实心材料体积。"] if volume_kind == "envelope" else []),
    }
