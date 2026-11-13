"""Batch mode: Excel in (编号 / 家具类型 / 尺寸) + image folder -> Excel out.

The single-item pipeline is reused as-is: every row becomes an ordinary
bridge request that goes through ``bridge.run_job`` while stdout is rerouted
so the batch driver can tag each event with its row index and collect the
result payload.

Header detection is forgiving (编号/序号/id, 家具类型/类别, 尺寸/外观尺寸 …)
and can be overridden from the UI.  Rows whose image cannot be matched are
reported as 跳过 instead of aborting the whole batch.
"""

from __future__ import annotations

import json
import re
import time
import traceback
from pathlib import Path

import bridge
import xlsxio

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}

ID_HEADERS = ("编号", "序号", "家具编号", "图片编号", "样品编号", "id", "no", "code", "index")
TYPE_HEADERS = ("家具类型", "家具类别", "类型", "类别", "品种", "category", "type", "furniture")
DIM_HEADERS = ("尺寸", "外观尺寸", "外形尺寸", "长宽高", "规格", "dimension", "dimensions", "size")

CN_DIGITS = "零一二三四五六七八九"

RESULT_HEADERS = [
    "编号",
    "家具类型",
    "尺寸",
    "单位",
    "图片文件",
    "状态",
    "区域识别",
    "质量体积来源",
    "质量(kg)",
    "包裹体积(m³)",
    "平均密度(kg/m³)",
    "材料平均密度(kg/m³)",
    "材料占比合计",
    "主材质",
    "材质组合",
    "平均热值(MJ/kg)",
    "热值口径",
    "火灾荷载(MJ)",
    "火灾荷载区间(MJ)",
    "覆盖率",
    "用时(s)",
    "备注",
]


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def _norm(value) -> str:
    text = str(value if value is not None else "").strip().lower()
    return re.sub(r"[\s()（）:：、,_-]+", "", text)


def _clean(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _number(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _round(value, digits: int = 2):
    number = _number(value)
    if number is None:
        return None
    return round(number, digits)


def _heat_basis_cell(fire_load) -> str:
    """Short heat-value basis label for the result sheet."""
    if not isinstance(fire_load, dict):
        return ""
    label = str(fire_load.get("heatBasisLabel") or "").strip()
    bases = [str(item) for item in (fire_load.get("heatBases") or [])]
    if fire_load.get("mixedHeatBasis"):
        return label or "混合口径"
    if bases == ["LHV"]:
        return "LHV（净热值）"
    if bases == ["HHV"]:
        return "HHV（毛热值）"
    return label


def parse_dimensions(value, default_unit: str = "cm"):
    """'120×75×60' / '1.2m*0.75m*0.6m' / '1200,750,600mm' -> (w, h, d, unit)."""
    text = "" if value is None else str(value)
    numbers = [float(item) for item in re.findall(r"\d+(?:\.\d+)?", text)]
    unit = ""
    match = re.search(r"(millimet(?:er|re)s?|mm|centimet(?:er|re)s?|cm|met(?:er|re)s?|(?<![a-z])m(?![a-z]))", text, re.I)
    if match:
        token = match.group(1).lower()
        if token.startswith("m") and not token.startswith("mm"):
            unit = "m"
        elif token.startswith("cm") or token.startswith("centi"):
            unit = "cm"
        else:
            unit = "mm"
    if not unit:
        unit = (default_unit or "cm").strip().lower() or "cm"
    if len(numbers) < 3:
        return None, None, None, unit, "尺寸格式无法识别（需要 3 个数值，例如 120×75×60 cm）"
    width, height, depth = numbers[0], numbers[1], numbers[2]
    if width <= 0 or height <= 0 or depth <= 0:
        return None, None, None, unit, "尺寸必须为正数"
    # "1.2 0.75 0.6" with no unit suffix is almost certainly metres.
    if not match and max(width, height, depth) <= 5:
        unit = "m"
    return width, height, depth, unit, ""


def _detect_columns(header_row, override):
    """Map logical roles to column indexes (override may be str header or int)."""
    mapping = {"id": None, "type": None, "dimensions": None}
    normalized = [_norm(cell) for cell in (header_row or [])]
    for role, names in (("id", ID_HEADERS), ("type", TYPE_HEADERS), ("dimensions", DIM_HEADERS)):
        for index, cell in enumerate(normalized):
            if not cell:
                continue
            if any(cell == _norm(name) or cell.startswith(_norm(name)) for name in names):
                mapping[role] = index
                break
    for role, wanted in (override or {}).items():
        if role not in mapping:
            continue
        if wanted is None or wanted == "":
            continue
        if isinstance(wanted, int):
            mapping[role] = wanted
            continue
        target = _norm(wanted)
        for index, cell in enumerate(normalized):
            if cell and (cell == target or target in cell):
                mapping[role] = index
                break
    has_header = any(value is not None for value in mapping.values())
    if not has_header:
        mapping = {"id": 0, "type": 1, "dimensions": 2}
        return mapping, False
    # Fill the gaps cheaply: unclaimed columns in order.
    used = {value for value in mapping.values() if value is not None}
    spare = [index for index in range(max(len(normalized), 3)) if index not in used]
    for role in ("id", "type", "dimensions"):
        if mapping[role] is None and spare:
            mapping[role] = spare.pop(0)
    return mapping, True


def _index_images(images_dir: Path) -> list[tuple[str, Path]]:
    items = []
    for path in sorted(images_dir.rglob("*")):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
            items.append((path.stem.strip().lower(), path))
    return items


def _match_image(raw_id: str, index: list[tuple[str, Path]]):
    wanted = str(raw_id).strip().lower()
    if not wanted:
        return None
    exact = [path for stem, path in index if stem == wanted]
    if exact:
        return sorted(exact, key=lambda path: (len(path.name), path.name))[0]
    padded = wanted.lstrip("0") or wanted
    for stem, path in index:
        if stem.lstrip("0") == padded:
            return path
    prefix = []
    for stem, path in index:
        if stem.startswith(wanted) and len(stem) > len(wanted):
            separator = stem[len(wanted)]
            if separator in "_-. （(【[#":
                prefix.append(path)
    if prefix:
        return sorted(prefix, key=lambda path: (len(path.name), path.name))[0]
    contains = [path for stem, path in index if wanted in stem]
    if contains:
        return sorted(contains, key=lambda path: (len(path.name), path.name))[0]
    return None


def _safe_name(text: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff._-]+", "_", str(text)).strip("._-")
    return cleaned[:40] or "item"


def _fmt_cell(value, digits: int = 2) -> str:
    number = _number(value)
    if number is None:
        return ""
    return ("%.*f" % (digits, number)).rstrip("0").rstrip(".")


# --------------------------------------------------------------------------- #
# template
# --------------------------------------------------------------------------- #
def write_template(path: str | Path) -> str:
    rows = [
        ["001", "桌子", "120×75×60 cm"],
        ["002", "沙发", "200×90×85 cm"],
        ["003", "床", "200×60×180 cm"],
    ]
    return xlsxio.write_sheet(path, ["编号", "家具类型", "尺寸"], rows, sheet_name="输入")


# --------------------------------------------------------------------------- #
# batch runner
# --------------------------------------------------------------------------- #
def run_batch(request: dict, reader) -> int:
    started = time.monotonic()
    batch_id = str(request.get("batchId") or "batch")
    xlsx_path = Path(str(request.get("xlsxPath") or "")).expanduser()
    images_dir = Path(str(request.get("imagesDir") or "")).expanduser()
    out_dir = Path(str(request.get("outputDir") or (Path.cwd() / "batch-out"))).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    for notice in request.get("batchNotices") or []:
        bridge.emit({"type": "batch-log", "level": "warn", "message": str(notice)})

    if not xlsx_path.exists():
        raise RuntimeError(f"找不到 Excel 文件：{xlsx_path}")
    if not images_dir.exists() or not images_dir.is_dir():
        raise RuntimeError(f"找不到图片文件夹：{images_dir}")

    rows = xlsxio.read_rows(xlsx_path)
    if not rows:
        raise RuntimeError("Excel 里没有任何内容。")
    mapping, has_header = _detect_columns(rows[0], request.get("headers"))
    defaults = request.get("defaults") or {}
    default_unit = str(defaults.get("unit") or request.get("unit") or "cm")
    limit = int(request.get("limit") or 0)
    index = _index_images(images_dir)

    items = []
    data_rows = rows[1:] if has_header else rows
    for offset, row in enumerate(data_rows):
        if limit and len(items) >= limit:
            break
        raw_id = _clean(row[mapping["id"]]) if mapping["id"] is not None and mapping["id"] < len(row) else ""
        category = _clean(row[mapping["type"]]) if mapping["type"] is not None and mapping["type"] < len(row) else ""
        dims_text = (
            _clean(row[mapping["dimensions"]])
            if mapping["dimensions"] is not None and mapping["dimensions"] < len(row)
            else ""
        )
        if not raw_id and not dims_text:
            continue
        width, height, depth, unit, problem = parse_dimensions(dims_text, default_unit)
        image = _match_image(raw_id, index) if raw_id else None
        if image is None and not problem:
            problem = f"没有找到编号 {raw_id} 对应的图片"
        items.append(
            {
                "index": len(items),
                "row": offset + (2 if has_header else 1),
                "id": raw_id or f"row{offset + 1}",
                "category": category,
                "dimensionsText": dims_text,
                "width": width,
                "height": height,
                "depth": depth,
                "unit": unit,
                "imagePath": str(image) if image else "",
                "problem": problem,
            }
        )
    if not items:
        raise RuntimeError("没有解析出可用的行（需要 编号 / 家具类型 / 尺寸 三列）。")

    bridge.emit(
        {
            "type": "batch-meta",
            "batchId": batch_id,
            "xlsxPath": str(xlsx_path),
            "imagesDir": str(images_dir),
            "outputDir": str(out_dir),
            "hasHeader": has_header,
            "columns": mapping,
            "defaultUnit": default_unit,
            "total": len(items),
            "ready": sum(1 for item in items if not item["problem"]),
            "items": [{key: item[key] for key in ("index", "row", "id", "category", "dimensionsText", "imagePath", "problem")} for item in items],
        }
    )

    base = dict(request)
    for key in ("mode", "xlsxPath", "imagesDir", "headers", "limit", "defaults", "pipeline", "batchId", "outputDir"):
        base.pop(key, None)
    pipeline = dict(request.get("pipeline") or {})
    results = []
    ok_count = 0
    failed_count = 0
    skipped_count = 0

    for position, item in enumerate(items, start=1):
        row_started = time.monotonic()
        bridge.emit(
            {
                "type": "batch-progress",
                "position": position,
                "total": len(items),
                "index": item["index"],
                "id": item["id"],
                "stage": "start",
            }
        )
        if item["problem"]:
            skipped_count += 1
            record = _record(item, "跳过", problem=item["problem"])
            results.append(record)
            bridge.emit({"type": "batch-item", "index": item["index"], "id": item["id"], "status": "skipped", "problem": item["problem"], "total": len(items), "position": position})
            continue

        item_dir = out_dir / f"{position:03d}-{_safe_name(item['id'])}"
        item_dir.mkdir(parents=True, exist_ok=True)
        sub = dict(base)
        sub.update(pipeline)
        sub.update(
            {
                "jobId": f"{batch_id}-{position:03d}",
                "imagePath": item["imagePath"],
                "imageName": Path(item["imagePath"]).name,
                "category": item["category"] or base.get("category"),
                "furnitureType": item["category"] or base.get("furnitureType") or "",
                "furnitureName": item["category"] or "家具",
                "dimensions": {"width": item["width"], "height": item["height"], "depth": item["depth"], "unit": item["unit"]},
                "outputDir": str(item_dir),
                # Batch items ask the host for LLM segmentation / mass-volume
                # estimates over the JSON-line channel; a single job cannot.
                "llmSegmentationChannel": "host",
                "llmEstimateChannel": "host",
            }
        )
        payload_box: dict = {}

        def handler(message, box=payload_box, position=position, item=item):
            kind = message.get("type")
            if kind == "result":
                box["payload"] = message.get("payload") or {}
                return
            if kind == "progress":
                bridge.emit(
                    {
                        "type": "batch-log",
                        "index": item["index"],
                        "id": item["id"],
                        "position": position,
                        "stage": message.get("stage"),
                        "level": message.get("level") or "info",
                        "message": message.get("message"),
                    }
                )
                return
            if kind in ("meta", "trace"):
                return
            bridge.emit_raw(message)

        try:
            with bridge.output_route(handler):
                bridge.run_job(sub, reader)
            payload = payload_box.get("payload") or {}
            record = _record(item, "完成", payload=payload, elapsed=time.monotonic() - row_started)
            ok_count += 1
            bridge.emit(
                {
                    "type": "batch-item",
                    "index": item["index"],
                    "id": item["id"],
                    "status": "ok",
                    "total": len(items),
                    "position": position,
                    "summary": record.get("summary"),
                    "elapsedMs": record["elapsedMs"],
                    "outputDir": str(item_dir),
                }
            )
        except Exception as error:  # one bad row must not kill the batch
            failed_count += 1
            record = _record(item, "失败", problem=str(error) or type(error).__name__, elapsed=time.monotonic() - row_started)
            bridge.emit(
                {
                    "type": "batch-item",
                    "index": item["index"],
                    "id": item["id"],
                    "status": "failed",
                    "total": len(items),
                    "position": position,
                    "problem": record["problem"],
                    "traceback": traceback.format_exc()[-1500:],
                }
            )
        results.append(record)

    output_xlsx = out_dir / f"批量结果-{batch_id}.xlsx"
    xlsxio.write_sheet(
        output_xlsx,
        RESULT_HEADERS,
        [record["cells"] for record in results],
        sheet_name="结果",
    )
    detail = {
        "batchId": batch_id,
        "xlsxPath": str(xlsx_path),
        "imagesDir": str(images_dir),
        "outputXlsx": str(output_xlsx),
        "total": len(items),
        "ok": ok_count,
        "failed": failed_count,
        "skipped": skipped_count,
        "elapsedMs": int((time.monotonic() - started) * 1000),
        "items": results,
    }
    (out_dir / "batch-result.json").write_text(json.dumps(detail, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    bridge.emit({"type": "batch-done", **{key: detail[key] for key in ("batchId", "outputXlsx", "total", "ok", "failed", "skipped", "elapsedMs")}})
    return 0


def _record(item, status, *, payload=None, problem="", elapsed=0.0):
    payload = payload or {}
    physical = payload.get("physical") or {}
    composition = payload.get("composition") or {}
    fire_load = payload.get("fireLoad") or {}
    review = payload.get("review") or {}
    mass = ((physical.get("mass") or {}).get("value_kg"))
    volume = ((physical.get("volume") or {}).get("value_m3"))
    materials = composition.get("materials") or []
    main_materials = composition.get("mainMaterials") or []
    if not main_materials:
        main_materials = [row.get("name") for row in materials[:2] if row.get("name")]
    top = []
    for row in materials[:3]:
        name = row.get("name") or ""
        share = _number(row.get("massFraction"))
        if not name:
            continue
        top.append(f"{name} {share * 100:.1f}%" if share is not None else name)
    if len(materials) > 3:
        top.append(f"等 {len(materials)} 种")
    total_heat = _number(fire_load.get("totalHeatMj"))
    heat_value = None
    if total_heat is not None and mass:
        heat_value = total_heat / float(mass)
    heat_basis = _heat_basis_cell(fire_load)
    interval = fire_load.get("totalHeatIntervalMj") or []
    interval_text = ""
    if isinstance(interval, list) and len(interval) == 2:
        low, high = _round(interval[0], 1), _round(interval[1], 1)
        if low is not None and high is not None:
            interval_text = f"{low} ~ {high}"
    notes = []
    source = payload.get("physicalSource") or ""
    physical_labels = {
        "llm-estimate": "视觉大模型估计",
        "builtin-fireprediction": "内置训练模型",
        "fireprediction": "Fireprediction",
        "manual": "手工输入",
        "manual_input": "手工输入",
    }
    physical_label = physical_labels.get(source, source or "—")
    estimate_info = payload.get("llmEstimate") or {}
    estimate_error = (payload.get("input") or {}).get("llmEstimateError") or ""
    if not payload:
        physical_label = "—"
    if source:
        notes.append(f"物理量来源：{source}")
    if estimate_error:
        notes.append(f"视觉模型估计质量/体积不可用，已回退 Fireprediction：{estimate_error}")
    elif source == "builtin-fireprediction":
        notes.append("质量与体积由插件内置的训练模型推理（weight_fusion_v3 / volume_convnext_general）")
    elif source == "llm-estimate" and estimate_info:
        notes.append(
            "质量与体积由视觉模型直接估计（%s，未经 Fireprediction 或实称校验）"
            % (estimate_info.get("model") or "视觉模型")
        )
    segmentation = payload.get("segmentation") or {}
    region_label = "视觉大模型" if segmentation.get("source") == "llm" else "本机 YOLO"
    if not payload:
        region_label = "—"
    fallback = (payload.get("input") or {}).get("segmentationFallbackError") or segmentation.get("fallbackError")
    if fallback:
        notes.append(f"视觉模型分割不可用，已回退 YOLO：{fallback}")
    elif segmentation.get("source") == "llm":
        llm_info = segmentation.get("llm") or {}
        if llm_info.get("materials"):
            notes.append("可见材质面积占比由视觉模型直接判定（未做本机分割）")
    if review.get("status") and review.get("status") != "complete":
        notes.append(f"判定状态：{review.get('status')}")
    for warning in (composition.get("warnings") or [])[:1]:
        notes.append(str(warning))
    if problem:
        notes.insert(0, problem)
    summary = {
        "massKg": _round(mass, 3),
        "volumeM3": _round(volume, 4),
        "bulkDensityKgM3": _round(composition.get("bulkDensityKgM3"), 2),
        "materialDensityKgM3": _round(composition.get("materialDensityKgM3"), 2),
        "massFractionSum": _round(composition.get("massFractionSum"), 4),
        "mainMaterials": main_materials[:3],
        "heatValueMjKg": _round(heat_value, 2),
        "heatBasis": heat_basis,
        "fireLoadMj": _round(total_heat, 3),
        "coverage": _round(fire_load.get("coverageMassFraction"), 4),
        "status": status,
        "regionEngine": region_label,
        "segmentationSource": segmentation.get("source"),
        "segmentationFallbackError": fallback or "",
        "physicalSource": source,
        "physicalLabel": physical_label,
        "llmEstimateError": estimate_error,
    }
    cells = [
        item["id"],
        item["category"],
        item["dimensionsText"],
        item["unit"],
        Path(item["imagePath"]).name if item["imagePath"] else "",
        status,
        region_label,
        physical_label,
        _fmt_cell(summary["massKg"], 3),
        _fmt_cell(summary["volumeM3"], 4),
        _fmt_cell(summary["bulkDensityKgM3"], 2),
        _fmt_cell(summary["materialDensityKgM3"], 2),
        ("%.2f%%" % (summary["massFractionSum"] * 100)) if summary["massFractionSum"] is not None else "",
        " / ".join(str(name) for name in main_materials[:2] if name),
        "、".join(top),
        _fmt_cell(summary["heatValueMjKg"], 2),
        summary["heatBasis"],
        _fmt_cell(summary["fireLoadMj"], 3),
        interval_text,
        ("%.1f%%" % (summary["coverage"] * 100)) if summary["coverage"] is not None else "",
        _fmt_cell(elapsed, 1),
        "；".join(notes),
    ]
    return {"index": item["index"], "id": item["id"], "status": status, "problem": problem, "elapsedMs": int(elapsed * 1000), "summary": summary, "cells": cells}
