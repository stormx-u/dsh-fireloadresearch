"""Offline composition reports with explicit evidence and freshness boundaries."""
from __future__ import annotations

import csv
import html
from io import StringIO
import json
import math
import re

from composition import analysis_fingerprint


STALE_NOTE = "主要材料组成结果已过期：当前图片、目标、复核结果或综合输入（质量、体积口径、误差假设、家具类型等）已改变；本次仅导出可见表面报告，请重新分析主要材料。"
_SECRET_KEYS = {"authorization", "apikey", "password", "secret", "token", "accesstoken", "refreshtoken", "credentials", "credential"}
_RATIO_KEYS = ("mass_fraction", "mass_fraction_interval", "material_volume_fraction", "material_volume_fraction_interval", "envelope_volume_fraction", "estimated_mass_kg")


def _sensitive_key(key):
    normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
    return (normalized in _SECRET_KEYS or "apikey" in normalized
            or normalized.endswith(("secret", "password", "accesstoken", "refreshtoken", "privatekey"))
            or normalized in {"key", "openrouterkey", "apitoken", "bearertoken"})


def is_fresh(result, output) -> bool:
    if not isinstance(output, dict) or output.get("stale") or not output.get("segmentation_fingerprint"):
        return False
    if output.get("image_sha256") not in (None, result.document.sha256):
        return False
    return output["segmentation_fingerprint"] == analysis_fingerprint(result)


def stale_note(output):
    reason = output.get("stale_reason") if isinstance(output, dict) else None
    return STALE_NOTE + (" 原因：" + _clean(reason) if isinstance(reason, str) and reason.strip() else "")


def _clean(value):
    """Remove authentication fields while retaining model names and token usage."""
    if isinstance(value, dict):
        return {str(key): _clean(item) for key, item in value.items()
                if not _sensitive_key(key)}
    if isinstance(value, (list, tuple)):
        return [_clean(item) for item in value]
    if isinstance(value, str):
        value = re.sub(r"\bsk-(?:or-v1-)?[A-Za-z0-9_-]{12,}\b", "[REDACTED]", value)
        value = re.sub(r"(?i)\bBearer\s+[^\s\"'<>]+", "Bearer [REDACTED]", value)
        return re.sub(r"(?i)\b(api[_-]?key|password|secret|access[_-]?token)\s*[:=]\s*[^\s,;<>]+", r"\1=[REDACTED]", value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _has_physical(output):
    physical = output.get("physical_input") or {}
    if not isinstance(physical, dict):
        return False
    mass = _number((physical.get("mass") or {}).get("value_kg"))
    volume = _number((physical.get("volume") or {}).get("value_m3"))
    return mass is not None and mass > 0 and volume is not None and volume > 0


def _policy(output):
    physical = _has_physical(output)
    decision = output.get("decision") or {}
    unknown = _number(decision.get("unknown_score")) or 0.0
    computed = _number(output.get("computed_candidate_weight"))
    computed = 0.0 if computed is None else computed
    status = output.get("status", "materials_only")
    allowed = (physical and status not in {"materials_only", "insufficient_evidence", "infeasible", "no_physical_input"}
               and computed >= 0.5 and output.get("proportion_reporting_allowed", True) is not False)
    weak = unknown >= 0.4 or computed < 0.95 or status not in {"conditional_estimate", "estimated"}
    return {"has_physical": physical, "proportions_shown": allowed, "weak_evidence": weak,
            "computed_candidate_weight": computed, "unknown_score": unknown}


def _payload(result, output):
    data = _clean(output)
    data["ai_review"] = _clean(getattr(result, "ai_review", {}) or {})
    data["auto_status"] = _clean(getattr(result, "auto_status", {}) or {})
    physical = data.get("physical_input")
    if isinstance(physical, dict) and (physical.get("source") or {}).get("parameters_verified") is False:
        for field in ("mass", "volume"):
            quantity = physical.get(field)
            if isinstance(quantity, dict):
                quantity["reported_status"] = quantity.get("status")
                quantity["status"] = "estimated"
        data.setdefault("warnings", []).append("来源类别、尺寸等参数尚未核实；仍可计算条件比例，物理输入按估计量展示，不视为实测真值。")
    policy = _policy(data)
    if not policy["has_physical"]:
        candidate_estimates = [material for candidate in data.get("candidates") or []
                               for material in candidate.get("material_estimates") or []]
        for material in (data.get("materials") or []) + (data.get("conditional_materials") or []) + candidate_estimates:
            for key in _RATIO_KEYS:
                material[key] = None
        data["broad_mass_fractions"] = {}
        data["void_fraction_of_envelope"] = None
        data["main_basis"] = "top_construction_candidate"
        effect = data.get("frequency_effect")
        if isinstance(effect, dict):
            for mode in ("with_frequency", "without_frequency"):
                if isinstance(effect.get(mode), dict):
                    effect[mode]["material_mass_fractions"] = {}
                    effect[mode]["material_volume_fractions"] = {}
            for material in effect.get("material_deltas") or []:
                for key in ("with_mass", "without_mass", "delta_mass", "with_volume", "without_volume", "delta_volume"):
                    material[key] = None
    fire = data.get("fire_load")
    if isinstance(fire, dict) and not policy["proportions_shown"]:
        # A cached heat result must not outlive the mass proportions supporting
        # it. Keep the source properties, but suppress unsupported quantities.
        fire["status"] = "unavailable"
        for key in ("total_heat_mj", "known_heat_mj", "total_heat_interval_mj", "fire_load_density_mj_m2",
                    "candidate_weighted_total_heat_mj", "candidate_heat_sensitivity_envelope_mj"):
            fire[key] = None
        fire["coverage_mass_fraction"] = 0.0
        for material in fire.get("materials") or []:
            for key in ("mass_fraction", "mass_fraction_interval", "mass_kg", "material_volume_fraction", "heat_mj"):
                material[key] = None
            material["status"] = "unsupported_composition"
            material["missing"] = ["reportable_material_proportions_missing"]
        if not policy["has_physical"]:
            fire["candidate_results"] = []
        fire.setdefault("warnings", []).append("本次没有可报告的整件材料比例，缓存热量已停止展示。")
    data["report_export"] = {
        "schema_version": 1, "furniture_name": _clean(result.name),
        "surface_image_sha256": result.document.sha256, "freshness_verified": True,
        **policy,
        "proportion_meaning": "质量比例以整件家具质量为分母；材料体积比例以与各组分密度口径一致的组分占据体积为分母，不含包络内额外空隙。",
        "interval_meaning": "5%–95% 是给定候选、密度、角色先验和物理输入下的条件敏感性区间，不是校准置信区间或正确概率。",
        "density_meaning": "m/V 是同一质量与体积的派生量，不作为第三条独立约束。",
        "envelope_meaning": "包裹/包络体积包含封闭内部空腔，不等于组分占据体积；泡沫有效密度已含泡孔，额外空隙不是总孔隙率。",
    }
    return data


def primary_summary_html(result, output):
    """The primary outcome, suitable for the top of the evidence report."""
    if not is_fresh(result, output):
        return ""
    data = _payload(result, output)
    policy = data["report_export"]
    candidates = sorted(data.get("candidates") or [], key=lambda row: _number(row.get("weight")) or 0, reverse=True)
    top = candidates[0] if candidates else {}
    e = lambda value: html.escape(str(value))
    estimates = sorted(data.get("materials") or [], key=lambda row: _number(row.get("mass_fraction")) or 0, reverse=True)
    body = f"<p>最可能构造（仍为推测）：{e(top.get('label', '尚无可区分构造'))}</p>"
    if policy["proportions_shown"] and estimates:
        rows = "".join("<tr>" + "".join(f"<td>{e(v)}</td>" for v in (
            material.get("name", material.get("id", "未知")),
            _percent(material.get("mass_fraction"), weak=policy["weak_evidence"]),
            _interval(material.get("mass_fraction_interval"), policy["weak_evidence"]),
            _percent(material.get("material_volume_fraction"), weak=policy["weak_evidence"]),
            _interval(material.get("material_volume_fraction_interval"), policy["weak_evidence"]),
        )) + "</tr>" for material in estimates)
        body += "<p>主表为情景加权估计；备选构造可能互斥，不代表全部材料确定同时共存。</p><table><tr><th>材料（情景加权）</th><th>质量比例估计</th><th>质量条件敏感性区间</th><th>组分体积比例估计</th><th>体积条件敏感性区间</th></tr>" + rows + "</table>"
    elif not policy["has_physical"]:
        body += "<p>缺少质量和体积，当前只给材料构造推测，不填写质量或组分体积比例。</p>"
    else:
        body += "<p>当前可计算证据不足，暂不展示全家具组成比例。</p>"
    physical = data.get("physical_input") or {}
    if (physical.get("source") or {}).get("parameters_verified") is False:
        body += "<p>来源参数尚未核实；以上按估计输入计算，不能视为实测组成。</p>"
    return "<section><h2>主要材料与比例</h2>" + body + _fire_load_html(data, compact=True) + _frequency_effect_html(data, compact=True) + '<p>比例依赖构造、密度和物理输入假设；5%–95% 是条件敏感性范围。<a href="主要材料报告.html">查看完整主要材料报告与来源</a>。</p></section>'


def _percent(value, *, weak=False):
    number = _number(value)
    return "—" if number is None else (f"{number:.0%}" if weak else f"{number:.1%}")


def _interval(value, weak=False):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return "—"
    return _percent(value[0], weak=weak) + " – " + _percent(value[1], weak=weak)


def _status(value):
    return {"measured": "实测（用户标记）", "estimated": "估计", "user_input": "用户录入"}.get(value, str(value or "未提供"))


def _json_details(title, value):
    return f"<details><summary>{html.escape(title)}</summary><pre>{html.escape(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))}</pre></details>"


def _fire_load_html(data, *, compact=False):
    title = "<h2>大类→细材质→占比→火灾荷载</h2>"
    fire = data.get("fire_load")
    if not isinstance(fire, dict):
        return title + "<p>本结果尚未保存具体材质热值与潜在热量计算；不从大类名称补造热值。</p>"
    e = lambda value: html.escape(str(value))
    def numeric(value):
        value = _number(value)
        return "未计算" if value is None else f"{value:.4g}"
    total, known = _number(fire.get("total_heat_mj")), _number(fire.get("known_heat_mj"))
    if total is not None:
        body = f"<p><strong>原表潜在热量估计 Q = {numeric(total)} MJ</strong>；Q = Σ(材料质量 kg × 热值 MJ/kg)。</p>"
    elif known is not None:
        body = f"<p><strong>已知部分潜在热量为 {numeric(known)} MJ，整件总量未计算。</strong>缺少热值、具体密度或质量比例的材料没有补0。</p>"
    else:
        body = "<p>缺少足够的具体材料比例、物理量或适用热值，当前不填写潜在热量。</p>"
    if fire.get("mixed_heat_basis"):
        body += "<p class=\"note\">原表含HHV/LHV混合或未说明热值口径；此处仅为原表潜在热量估计，不能当作统一净热值的规范设计火灾荷载。</p>"
    body += "<p>细材质属于条件候选；只有实际使用可行物理样本时，才称为经过物理约束更新。互斥细类的加权均值不代表同时确认存在。未自动应用燃烧、保护或设计修正系数。</p>"
    area, density = _number(fire.get("floor_area_m2")), _number(fire.get("fire_load_density_mj_m2"))
    if area is not None and area > 0 and density is not None:
        body += f"<p>使用明确提供的建筑防火分区面积 {numeric(area)} m²：潜在热量密度 {numeric(density)} MJ/m²。</p>"
    else:
        body += "<p>没有可用的建筑防火分区面积与完整热量，不填写MJ/m²；家具几何投影不作为建筑面积。</p>"
    if compact:
        return title + body
    broad_names = {"wood": "木质", "plastic": "塑料", "metal": "金属", "glass": "玻璃", "fabric": "织物", "foam": "泡沫填充", "mineral": "矿物", "leather": "皮革", "paper": "纸质", "plant": "植物材料"}
    broad_stage = data.get("broad_stage") or {}
    broad_rows = []
    for proposal in broad_stage.get("proposals") or []:
        names = "、".join(broad_names.get(broad, broad) for broad in proposal.get("broads") or [])
        broad_rows.append("<tr>" + "".join(f"<td>{e(value)}</td>" for value in (
            proposal.get("id", "—"), names or proposal.get("label", "未提供"),
            _percent(proposal.get("image_score")), _percent(proposal.get("posterior_weight")),
        )) + "</tr>")
    if broad_rows:
        body += "<h3>第一步：图片判断材料大类与构造</h3><p>大类构造阶段不使用具体材质出现频率；频率在已假设存在的大类内部细化材料。图像分数未经校准，隐藏支撑仍属于备选。</p><table><tr><th>构造ID</th><th>材料大类</th><th>图像相容分数</th><th>约束后构造权重</th></tr>" + "".join(broad_rows) + "</table>"
    refinement_rows = []
    for group in (data.get("refinement_stage") or {}).get("groups") or []:
        for option in group.get("options") or []:
            evidence = option.get("frequency_evidence") or {}
            global_count = evidence.get("global_count", option.get("count"))
            type_count = evidence.get("type_count", option.get("prior_count"))
            updated = group.get("physics_used") is not False
            posterior = _percent(option.get("posterior_conditional")) if updated else "尚未施加物理约束（保留先验）"
            refinement_rows.append("<tr>" + "".join(f"<td>{e(value)}</td>" for value in (
                group.get("name") or broad_names.get(group.get("broad"), group.get("broad", "未提供")),
                option.get("name", option.get("id", "未知")),
                "未提供" if global_count is None else global_count,
                "未提供" if type_count is None else type_count,
                _percent(option.get("conditional_prior", option.get("prior"))),
                posterior,
            )) + "</tr>")
    if refinement_rows:
        body += "<h3>大类内细材质：频率先验→身份后验</h3><p>先验在已披露且物性可计算的具体候选中归一；身份后验以该大类存在为条件，表示互斥细类的推测权重，不等于材料质量比例。未明确披露的调查份额不是kg质量，不能直接乘家具总质量。没有有效物理约束的行仅保留调查先验。</p><table><tr><th>大类</th><th>具体候选</th><th>CSV总体次数</th><th>家具类型次数</th><th>细类频率先验</th><th>条件身份后验或证据状态</th></tr>" + "".join(refinement_rows) + "</table>"
    missing_names = {"specific_material_properties_missing": "缺具体物性", "specific_material_unresolved": "细类未解析", "specific_density_unresolved": "缺具体密度", "heat_value_missing": "缺热值", "heat_value_not_applicable_to_specific_material": "替代热值不可用于此标签", "density_unit_unsupported": "密度单位不支持", "heat_unit_unsupported": "热值单位不支持", "reportable_material_proportions_missing": "无可报告的材料比例"}
    rows = []
    for material in fire.get("materials") or []:
        density_range = material.get("density_range_kg_m3")
        density_text = "未提供" if not isinstance(density_range, list) or len(density_range) != 2 else " – ".join(numeric(value) for value in density_range)
        status = "条件计算" if material.get("status") == "computed" else "、".join(missing_names.get(reason, reason) for reason in material.get("missing") or [])
        rows.append("<tr>" + "".join(f"<td>{e(value)}</td>" for value in (
            broad_names.get(material.get("broad"), material.get("broad", "未提供")),
            material.get("name", material.get("id", "未知")), _percent(material.get("mass_fraction")),
            numeric(material.get("mass_kg")), density_text, numeric(material.get("heat_value_mj_kg")),
            material.get("heat_basis") or "未说明", numeric(material.get("heat_mj")), status,
        )) + "</tr>")
    if rows:
        body += "<table><tr><th>大类</th><th>具体候选材质</th><th>质量占比估计</th><th>材料质量 kg</th><th>密度 kg/m³</th><th>原表热值 MJ/kg</th><th>热值口径</th><th>贡献 MJ</th><th>状态</th></tr>" + "".join(rows) + "</table>"
    interval = fire.get("total_heat_interval_mj")
    if isinstance(interval, list) and len(interval) == 2:
        body += f"<p>潜在热量敏感性包络：{numeric(interval[0])} – {numeric(interval[1])} MJ。该范围由边际比例敏感性带与热值范围在总质量守恒下松弛求界，不是整体5%–95%区间，也不保证两个端点是可实现的同一构造，不能当作校准置信区间。</p>"
    links = []
    for source in fire.get("method_sources") or []:
        url = source.get("url", "")
        if isinstance(url, str) and url.startswith("https://"):
            links.append(f'<a href="{e(url)}">{e(source.get("title", "方法来源"))}</a>')
    if links:
        body += "<p>方法依据：" + "；".join(links) + "。</p>"
    for warning in fire.get("warnings") or []:
        body += "<p>" + e(warning) + "</p>"
    return title + body + _json_details("火灾荷载中间量、各候选条件结果与物性来源", fire)


def _frequency_effect_html(data, *, compact=False):
    e = lambda value: html.escape(str(value))
    effect = data.get("frequency_effect")
    title = "<h2>调查频次如何影响本次结果</h2>"
    if not isinstance(effect, dict):
        return title + "<p>本结果未记录候选频次先验的启用/停用对比，不能据此量化本次频次影响。</p>"
    policy = data["report_export"]
    allowed, weak = policy["proportions_shown"], policy["weak_evidence"]
    before, after = effect.get("with_frequency") or {}, effect.get("without_frequency") or {}
    enabled = "启用" if effect.get("enabled") else "停用"
    scope = effect.get("scope")
    scope_text = ("对比范围仅为候选情景频次先验（scenario_prior_only）；两边的密度子类情景仍保留其频次权重。"
                  if scope == "scenario_prior_only" else "对比范围以保存的审计记录为准；未声明全部频次来源均已停用。")
    top_text = f"当前{enabled}候选频次先验。启用时最高权重构造：{e(before.get('label') or before.get('top_candidate_id') or '未记录')}；停用时：{e(after.get('label') or after.get('top_candidate_id') or '未记录')}。"
    changed = effect.get("changed_top_candidate")
    if isinstance(changed, bool):
        top_text += "最高权重构造已改变。" if changed else "最高权重构造未改变；材料加权比例仍可能改变。"
    body = "<p>" + top_text + "</p><p>" + e(scope_text) + "</p>"
    body += "<p>对照固定同一组候选、图片、物理量、密度与角色样本，只改变候选情景频次先验。频次表示调查中的出现情况，不能直接当作质量或体积比例。</p>"
    delta_rows = []
    for material in effect.get("material_deltas") or []:
        def fraction(key):
            return _percent(material.get(key), weak=weak) if allowed else "未报告"
        def delta(key):
            value = _number(material.get(key))
            return f"{100 * value:+.2g} 个百分点" if allowed and value is not None else "未报告"
        delta_rows.append("<tr>" + "".join(f"<td>{e(value)}</td>" for value in (
            material.get("name", material.get("id", "未知")), fraction("with_mass"), fraction("without_mass"),
            delta("delta_mass"), fraction("with_volume"), fraction("without_volume"), delta("delta_volume"),
        )) + "</tr>")
    if delta_rows:
        body += "<table><tr><th>材料（情景加权）</th><th>启用：质量</th><th>停用：质量</th><th>质量变化</th><th>启用：体积</th><th>停用：体积</th><th>体积变化</th></tr>" + "".join(delta_rows) + "</table>"
    elif not allowed:
        body += "<p>缺少可报告的物理组成比例；仅比较构造先验，不填写质量/体积变化。</p>"
    if compact:
        return title + body

    def count_text(evidence, prefix):
        count, denominator = _number(evidence.get(prefix + "_count")), _number(evidence.get(prefix + "_denominator"))
        if count is None:
            return "未提供"
        return f"{count:g}" + (f" / {denominator:g}" if denominator is not None else " / 分母未提供")

    evidence_rows = []
    for material in effect.get("evidence") or []:
        evidence = material.get("frequency_evidence") or {}
        evidence_rows.append("<tr>" + "".join(f"<td>{e(value)}</td>" for value in (
            material.get("name", material.get("id", "未知")), count_text(evidence, "global"),
            count_text(evidence, "type"), _percent(evidence.get("global_coverage")),
            _percent(evidence.get("type_coverage")), _percent(evidence.get("global_within_broad_prior")),
            _percent(evidence.get("type_within_broad_prior")), _percent(evidence.get("blended_within_broad_prior")),
            _percent(evidence.get("mixing_weight")),
        )) + "</tr>")
    body += "<h3>本次使用的调查计数与细类先验</h3><p>总体列来自用户CSV，分型列来自同一调查的家具类型统计。分母与混合权重逐行列出；细类先验在相同材料大类内比较，不是家具组成比例。材料可共存，覆盖率不应相加到100%。</p>"
    if evidence_rows:
        body += "<table><tr><th>原材料标签</th><th>CSV总体计数/分母</th><th>分型计数/分母</th><th>总体覆盖率</th><th>分型覆盖率</th><th>总体细类先验</th><th>分型细类先验</th><th>混合细类先验</th><th>分型混合权重</th></tr>" + "".join(evidence_rows) + "</table>"
    else:
        body += "<p>未记录逐材料频次证据；不补造计数或来源。</p>"
    layout_rows = []
    for layout in effect.get("layout_priors") or []:
        evidence = layout.get("frequency_evidence") or {}
        layout_rows.append("<tr>" + "".join(f"<td>{e(value)}</td>" for value in (
            layout.get("id", ""), layout.get("description", ""), _percent(layout.get("prior")),
            count_text(evidence, "global"), count_text(evidence, "type"),
        )) + "</tr>")
    if layout_rows:
        body += "<h3>构造情景先验</h3><p>构造的去重或精确投影计数以原证据字段为准；不从单材料覆盖率相加拼造构造频率。</p><table><tr><th>情景ID</th><th>构造</th><th>先验</th><th>总体计数/分母</th><th>分型计数/分母</th></tr>" + "".join(layout_rows) + "</table>"
    return title + body + _json_details("完整频次影响审计、来源与比较假设", effect)


def _render(result, data):
    e = lambda value: html.escape(str(value))
    policy = data["report_export"]
    weak, allowed = policy["weak_evidence"], policy["proportions_shown"]
    materials = sorted(data.get("materials") or [], key=lambda row: _number(row.get("mass_fraction")) or 0, reverse=True)
    candidates = sorted(data.get("candidates") or [], key=lambda row: _number(row.get("weight")) or 0, reverse=True)
    top_candidate = candidates[0] if candidates else {}
    title = "最可能构造（仍为推测）：" + str(top_candidate.get("label") or "尚无可区分的构造候选")
    within = sorted(top_candidate.get("material_estimates") or [], key=lambda row: _number(row.get("mass_fraction")) or 0, reverse=True)
    if allowed and within:
        major = [m.get("name", m.get("id", "未知")) for m in within if (_number(m.get("mass_fraction")) or 0) >= 0.05]
        if not major:
            major = [within[0].get("name", "未知")]
        major_text = "该构造内按估计质量排序的主要材料：" + "、".join(major)
    elif allowed and data.get("main_materials"):
        major_text = "该构造内按估计质量排序的主要材料：" + "、".join(map(str, data["main_materials"]))
    else:
        major_text = "证据不足，暂不报告主要材料质量排序或组成比例。"
    rows = []
    for material in materials:
        mass_fraction = _percent(material.get("mass_fraction"), weak=weak) if allowed else "未报告"
        volume_fraction = _percent(material.get("material_volume_fraction"), weak=weak) if allowed else "未报告"
        interval = _interval(material.get("mass_fraction_interval"), weak) if allowed else "—"
        volume_interval = _interval(material.get("material_volume_fraction_interval"), weak) if allowed else "—"
        estimated_mass = _number(material.get("estimated_mass_kg")) if allowed else None
        mass_text = "—" if estimated_mass is None else (f"{estimated_mass:.2g}" if weak else f"{estimated_mass:.3g}")
        rows.append("<tr>" + "".join(f"<td>{e(v)}</td>" for v in (
            material.get("name", material.get("id", "未知")), mass_fraction, interval, volume_fraction, volume_interval, mass_text
        )) + "</tr>")
    if not rows:
        rows.append('<tr><td colspan="6">没有可报告的组成比例；构造候选见下方。</td></tr>')
    physical = data.get("physical_input") or {}
    if policy["has_physical"]:
        mass, volume = physical.get("mass", {}), physical.get("volume", {})
        kind = {"envelope": "包裹体积（含封闭空腔）", "material_volume": "与各组分密度口径一致的组分占据体积"}.get(volume.get("kind"), "体积口径未说明")
        physical_text = f"质量 {e(mass.get('value_kg'))} kg（{e(_status(mass.get('status')))}）；{e(kind)} {e(volume.get('value_m3'))} m³（{e(_status(volume.get('status')))}）。"
        density = _number((physical.get("derived") or {}).get("bulk_density_kg_m3"))
        if density is not None:
            physical_text += f" 平均密度 m/V = {density:.3g} kg/m³，仅为派生量。"
    else:
        physical_text = "未提供有效质量和体积；不输出质量比例、材料体积比例或材料质量。"
    candidate_rows = "".join("<tr>" + "".join(f"<td>{e(v)}</td>" for v in (
        c.get("id", ""), c.get("label", ""), _percent(c.get("prior"), weak=True),
        _percent(c.get("image_score"), weak=True), _percent(c.get("weight"), weak=True),
        c.get("closure_failure") or ("缺少密度：" + "、".join(c.get("density_unavailable") or []) if c.get("density_unavailable") else "条件构造假设")
    )) + "</tr>" for c in candidates)
    candidate_details = []
    for rank, candidate in enumerate(candidates[:3], 1):
        estimates = sorted(candidate.get("material_estimates") or [], key=lambda row: _number(row.get("mass_fraction")) or 0, reverse=True)
        if not allowed or not estimates:
            body = "<p>该候选无可展示的组成比例；仅保留构造假设。</p>"
        else:
            detail_rows = "".join("<tr>" + "".join(f"<td>{e(v)}</td>" for v in (
                material.get("name", material.get("id", "未知")),
                _percent(material.get("mass_fraction"), weak=weak),
                _interval(material.get("mass_fraction_interval"), weak),
                _percent(material.get("material_volume_fraction"), weak=weak),
                _interval(material.get("material_volume_fraction_interval"), weak),
            )) + "</tr>" for material in estimates)
            body = "<table><tr><th>该构造内材料（按质量）</th><th>质量比例</th><th>质量比例敏感性区间</th><th>材料体积比例</th><th>体积比例敏感性区间</th></tr>" + detail_rows + "</table>"
        candidate_details.append(f"<section><h3>候选 {rank}：{e(candidate.get('label', candidate.get('id', '')))}</h3>{body}</section>")
    warnings = list(data.get("warnings") or [])
    if weak:
        warnings.insert(0, "图片有较强 unknown 或可计算候选权重不足；细分材料和比例主要依赖假设，数值仅作粗略条件估计。")
    if not allowed and policy["has_physical"]:
        warnings.insert(0, "有效候选覆盖或识别证据不足，本报告不展示组成比例；完整计算留作溯源，不能视为确认材质。")
    warning_html = "".join(f"<li>{e(w)}</li>" for w in warnings)
    void = data.get("void_fraction_of_envelope")
    void_html = ""
    if allowed and isinstance(void, dict):
        void_html = f"<p>包络内未归属空间/额外空隙比例条件估计：{e(_percent(void.get('mean'), weak=weak))}；敏感性区间 {e(_interval(void.get('interval'), weak))}。该空间不计入材料体积比例的分母；泡沫有效密度已含泡孔，因此这不是家具总孔隙率。</p>"
    details = "".join((_json_details("物理输入、估计/实测状态与来源", physical),
                       _json_details("AI自动复核来源、未能判明与失败记录", {"ai_review": data.get("ai_review"), "auto_status": data.get("auto_status")}),
                       _json_details("调查频次先验、材料来源与密度范围", {"survey": data.get("survey"), "proposals": data.get("proposals"), "candidates": candidates}),
                       _json_details("图片决策模型版本、使用量与费用记录", {"decision": data.get("decision"), "metadata": data.get("decision_metadata")}),
                       _json_details("计算方法、条件假设和完整溯源", data)))
    return f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>{e(result.name)} · 主要材料估计报告</title>
<style>body{{margin:0;background:#f3f5f8;color:#223044;font:15px/1.7 'Microsoft YaHei',sans-serif}}main{{max-width:1100px;margin:28px auto;background:#fff;padding:30px;border-radius:16px}}h1{{font-size:27px}}h2{{font-size:21px}}.note{{padding:14px;background:#fff4db;border-left:4px solid #c28a19}}table{{width:100%;border-collapse:collapse}}td,th{{border-bottom:1px solid #e5e8ee;padding:10px;text-align:left;vertical-align:top}}details{{margin:16px 0}}summary{{cursor:pointer;font-weight:bold}}pre{{white-space:pre-wrap;word-break:break-word;background:#f4f6f9;padding:15px;font-size:12px}}small{{color:#596b82}}@media print{{main{{margin:0;padding:8px}}}}</style>
<main><small>单件家具 · 主要材料与物理约束的条件估计</small><h1>{e(result.name)}</h1><p>方法版本：{e(data.get('method_version', '未记录'))}；状态：{e(data.get('status', '未记录'))}。</p>
<h2>主要材料与比例（情景加权估计）</h2><p class="note">以下汇总是多候选加权推测，备选构造可能互斥；边际平均值不代表同一件家具确定同时含有这些材料。调查频次会参与情景权重，候选内部条件比例另表列出。</p><p>质量比例分母是家具总质量；材料体积比例分母是与各组分密度口径一致的组分占据体积，不含包络内额外空隙。两列不能互换。</p>
<table><tr><th>材料（按情景加权质量）</th><th>质量比例</th><th>质量比例敏感性区间</th><th>材料体积比例</th><th>体积比例敏感性区间</th><th>估计质量 kg</th></tr>{''.join(rows)}</table>{void_html}
{_fire_load_html(data)}
{_frequency_effect_html(data)}
<h2>{e(title)}</h2><p>{e(major_text)}</p><p class="note">此处仅描述权重最高的一个构造假设，不能证明该构造存在。可见像素面积占比不作为材料质量或体积比例。候选分数、unknown 分数、候选权重都不是经过本任务校准的材质正确概率。</p>
<h2>质量、体积与口径</h2><p>{physical_text}</p><p>包裹/包络体积包含封闭内部空腔，不等于组分占据体积。m/V 由同一对质量和体积派生，不作为第三条独立约束。</p>
<p class="note">5%–95% 区间是给定构造候选、密度、角色先验和物理输入下的条件敏感性区间，不是校准的置信区间、置信概率或准确率。出现频次只表示调查样本提及，不代表材料质量/体积比例。未识别细类的 density_scenarios 是按同类明确子材料构造的密度情景假设，不表示已识别该子材料。角色比例先验混合的整合范围仍属于敏感性分析。</p>
<ul>{warning_html}</ul><h2>构造候选</h2><p>这些是待辨别的构造假设，不是已经确认的内部材质。可计算候选权重覆盖：{e(_percent(policy['computed_candidate_weight'], weak=True))}；图片 unknown 分数：{e(_percent(policy['unknown_score'], weak=True))}。</p>
<table><tr><th>候选ID</th><th>材料与构造</th><th>频次先验相对权重</th><th>图片模型相对分数</th><th>综合候选权重</th><th>说明</th></tr>{candidate_rows}</table><h2>前三个构造候选的条件材料范围</h2>{''.join(candidate_details)}
<h2>来源、模型与复现依据</h2>{details}<p><small>本报告全部资源在本地。表面分割及人工复核记录见分析报告.html；完整组成数据见 composition.json。</small></p></main></html>'''


def render_html(result, output) -> str:
    if not is_fresh(result, output):
        raise ValueError(stale_note(output))
    return _render(result, _payload(result, output))


def _csv_text(value):
    text = str(value or "")
    if text.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r", "\n")):
        text = "'" + text
    return text


def _csv(data):
    stream = StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["材料ID", "材料", "质量比例", "质量比例5%条件敏感性界限", "质量比例95%条件敏感性界限", "材料体积比例", "材料体积比例5%条件敏感性界限", "材料体积比例95%条件敏感性界限", "估计质量(kg)", "状态", "来源", "统计口径", "原表热值(MJ/kg)", "热值口径", "潜在热量贡献(MJ)"])
    policy = data["report_export"]
    places = 2 if policy["weak_evidence"] else 3
    def value(number):
        number = _number(number)
        return round(number, places) if policy["proportions_shown"] and number is not None else ""
    heat_rows = {row.get("id"): row for row in (data.get("fire_load") or {}).get("materials", [])}
    for material in sorted(data.get("materials") or [], key=lambda row: _number(row.get("mass_fraction")) or 0, reverse=True):
        mi = material.get("mass_fraction_interval") or [None, None]
        vi = material.get("material_volume_fraction_interval") or [None, None]
        if len(mi) != 2: mi = [None, None]
        if len(vi) != 2: vi = [None, None]
        heat = heat_rows.get(material.get("id"), {})
        writer.writerow([
            _csv_text(material.get("id")), _csv_text(material.get("name")),
            value(material.get("mass_fraction")), value(mi[0]), value(mi[1]),
            value(material.get("material_volume_fraction")), value(vi[0]), value(vi[1]),
            value(material.get("estimated_mass_kg")), _csv_text(data.get("status")),
            _csv_text(json.dumps(material.get("source"), ensure_ascii=False) if isinstance(material.get("source"), (dict, list)) else material.get("source")),
            "多候选加权推测；备选构造可能互斥，不代表所有材料确定共存",
            value(heat.get("heat_value_mj_kg")), _csv_text(heat.get("heat_basis")), value(heat.get("heat_mj")),
        ])
    return stream.getvalue().encode("utf-8-sig")


def extra_files(result, output) -> dict[str, bytes]:
    if not is_fresh(result, output):
        raise ValueError(stale_note(output))
    data = _payload(result, output)
    return {
        "主要材料报告.html": _render(result, data).encode("utf8"),
        "主要材料统计.csv": _csv(data),
        "composition.json": json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False).encode("utf8"),
    }


def export_composition(result, output, path):
    """Export seven surface artifacts plus three fresh composition artifacts."""
    if not is_fresh(result, output):
        raise ValueError(stale_note(output))
    # A delayed import keeps report -> extra_files independent of this wrapper.
    from report import export_report
    return export_report(result, path, composition_output=output)
