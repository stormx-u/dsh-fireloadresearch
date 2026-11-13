"""Potential heat from conditional fine-material masses and source-table values.

This is not a code-compliant design fire load. No combustion/protection factors,
gross-to-net conversion, or building floor area are inferred from photographs.
"""
from __future__ import annotations

from copy import deepcopy
import math
import re

METHOD_SOURCES = [{
    "title": "European Commission JRC, Handbook 5: Design of buildings for the fire situation",
    "url": "https://eurocodes.jrc.ec.europa.eu/sites/default/files/2021-12/handbook5.pdf",
    "role": "材料质量乘净热值求和；按防火分区面积归一化。规范计算另有燃烧和保护等系数，本模块不自动采用。",
}]
_PROPERTIES = ("id", "name", "broad", "density_min", "density_max", "density_typical", "density_basis", "density_unit", "heat_value_min", "heat_value_max", "heat_value_typical", "heat_basis", "heat_unit", "property_resolution", "refinement_specific", "heat_usable_for_refinement", "source")


class FireLoadError(ValueError):
    pass


def _number(value, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except (ValueError, OverflowError):
        return None
    return number if math.isfinite(number) and (number > 0 if positive else number >= 0) else None


def _basis(value):
    value = str(value or "")
    lhv = bool(re.search(r"lhv|\bnet\b|低位", value, re.I))
    hhv = bool(re.search(r"hhv|\bgross\b|高位", value, re.I))
    return "LHV" if lhv and not hhv else ("HHV" if hhv and not lhv else "unspecified_or_mixed")


def _properties(material, catalog):
    material_id = material.get("id")
    source = catalog.by_id(material_id)
    if source is None:
        source = material.get("source_properties")
    if not isinstance(source, dict) or source.get("id") != material_id:
        return None
    return {key: deepcopy(source.get(key)) for key in _PROPERTIES}


def _simplex_extreme(rows, costs, maximize):
    """Linear bound on a relaxed mass simplex, retaining marginal band limits."""
    values = [row["mass_fraction_interval"][0] for row in rows]
    remaining = 1.0 - sum(values)
    if remaining < -1e-8 or sum(row["mass_fraction_interval"][1] for row in rows) < 1 - 1e-8:
        return None
    for index in sorted(range(len(rows)), key=lambda i: costs[i], reverse=maximize):
        extra = min(max(0.0, remaining), rows[index]["mass_fraction_interval"][1] - values[index])
        values[index] += extra
        remaining -= extra
    return sum(value * cost for value, cost in zip(values, costs)) if remaining <= 1e-8 else None


def _calculate_rows(materials, mass, catalog):
    rows, seen = [], set()
    for material in materials:
        material_id = material.get("id")
        if not isinstance(material_id, str) or not material_id or material_id in seen:
            raise FireLoadError("具体材料ID缺失或重复，不能安全计算材料质量。")
        seen.add(material_id)
        fraction = _number(material.get("mass_fraction"))
        if fraction is None or fraction > 1:
            raise FireLoadError("材料质量比例必须是0–1之间的有限数值。")
        interval = material.get("mass_fraction_interval")
        if interval is None:
            interval = [fraction, fraction]
        if not isinstance(interval, (tuple, list)) or len(interval) != 2:
            raise FireLoadError("材料质量比例范围须有上下两项。")
        low, high = (_number(value) for value in interval)
        if low is None or high is None or low > high or high > 1:
            raise FireLoadError("材料质量比例范围无效。")
        # Include the reported mean as marginal quantiles can omit rare events.
        interval = [min(low, fraction), max(high, fraction)]
        properties = _properties(material, catalog)
        missing = []
        if properties is None:
            missing.append("specific_material_properties_missing")
            properties = {key: None for key in _PROPERTIES}
        if properties.get("refinement_specific") is False:
            missing.append("specific_material_unresolved")
        if properties.get("heat_usable_for_refinement") is False:
            missing.append("heat_value_not_applicable_to_specific_material")
        density_lo = _number(properties.get("density_min"), positive=True)
        density_hi = _number(properties.get("density_max"), positive=True)
        density_typical = _number(properties.get("density_typical"), positive=True)
        if density_lo is None or density_hi is None:
            density_lo = density_hi = density_typical
        if density_lo is None or density_hi is None or density_lo > density_hi or properties.get("property_resolution") == "surrogate_or_unspecified":
            missing.append("specific_density_unresolved")
        heat = _number(properties.get("heat_value_typical"))
        heat_lo, heat_hi = _number(properties.get("heat_value_min")), _number(properties.get("heat_value_max"))
        if heat is None:
            missing.append("heat_value_missing")
        if heat_lo is None or heat_hi is None:
            heat_lo = heat_hi = heat
        if heat_lo is not None and heat_hi is not None and heat_lo > heat_hi:
            raise FireLoadError("原材料热值范围上下界颠倒。")
        if properties.get("density_unit") not in (None, "kg/m³", "kg/m3"):
            missing.append("density_unit_unsupported")
        if properties.get("heat_unit") not in (None, "MJ/kg"):
            missing.append("heat_unit_unsupported")
        estimated_mass = mass * fraction
        stated_mass = material.get("estimated_mass_kg")
        if stated_mass is not None and (_number(stated_mass) is None or not math.isclose(float(stated_mass), estimated_mass, rel_tol=1e-6, abs_tol=1e-10)):
            raise FireLoadError("材料质量与家具总质量乘质量比例不一致。")
        computed = not missing
        rows.append({
            "id": material_id, "name": material.get("name") or properties.get("name") or material_id,
            "broad": material.get("broad") or properties.get("broad"),
            "refinement_status": material.get("refinement_status", "candidate_not_identified"),
            "mass_fraction": fraction, "mass_fraction_interval": interval, "mass_kg": estimated_mass,
            "material_volume_fraction": material.get("material_volume_fraction"),
            "density_range_kg_m3": [density_lo, density_hi] if density_lo is not None and density_hi is not None else None,
            "heat_value_mj_kg": heat, "heat_value_range_mj_kg": [heat_lo, heat_hi] if heat_lo is not None and heat_hi is not None else None,
            "heat_basis": properties.get("heat_basis"), "heat_basis_kind": _basis(properties.get("heat_basis")),
            "heat_mj": estimated_mass * heat if computed else None,
            "status": "computed" if computed else "missing_properties", "missing": missing,
            "source_properties": properties, "source": deepcopy(properties.get("source")),
            "frequency_evidence": deepcopy(material.get("frequency_evidence")),
        })
    fraction_sum = sum(row["mass_fraction"] for row in rows)
    if fraction_sum > 1 + 1e-6:
        raise FireLoadError("材料质量比例合计超过1，不能重复累计潜在热量。")
    known_rows = [row for row in rows if row["status"] == "computed"]
    known = sum(row["heat_mj"] for row in known_rows) if known_rows else None
    closed = bool(rows) and math.isclose(fraction_sum, 1.0, abs_tol=1e-6, rel_tol=0)
    complete = closed and len(known_rows) == len(rows)
    bounds = None
    if complete:
        lower_cost = [row["heat_value_range_mj_kg"][0] for row in rows]
        upper_cost = [row["heat_value_range_mj_kg"][1] for row in rows]
        lower = _simplex_extreme(rows, lower_cost, False)
        upper = _simplex_extreme(rows, upper_cost, True)
        if lower is not None and upper is not None:
            bounds = [mass * lower, mass * upper]
    bases = sorted({row["heat_basis_kind"] for row in known_rows})
    return {
        "status": "complete" if complete else ("partial" if known_rows else "unavailable"),
        "total_heat_mj": known if complete else None, "known_heat_mj": known,
        "total_heat_interval_mj": bounds,
        "coverage_mass_fraction": sum(row["mass_fraction"] for row in known_rows),
        "unaccounted_mass_fraction": max(0.0, 1.0 - fraction_sum),
        "mass_fractions_sum": fraction_sum, "materials": rows,
        "heat_bases": bases, "mixed_heat_basis": len(bases) > 1 or "unspecified_or_mixed" in bases,
        "missing_material_ids": [row["id"] for row in rows if row["missing"]],
    }


def calculate_fire_load(output, catalog, *, floor_area_m2=None):
    """Calculate table-based potential heat; unknown values are never zero-filled.

    ``total_heat_interval_mj`` is a relaxed sensitivity envelope using marginal
    material bands, heat ranges and sum(w)=1. It is not a joint 5–95% interval;
    subtype/role dependence is unavailable without the original paired samples.
    """
    physical = output.get("physical_input") or {}
    mass = _number((physical.get("mass") or {}).get("value_kg"), positive=True)
    volume = _number((physical.get("volume") or {}).get("value_m3"), positive=True)
    area_source = None
    if floor_area_m2 is not None:
        area_source = "explicit_function_argument"
    elif output.get("floor_area_m2") is not None:
        floor_area_m2, area_source = output["floor_area_m2"], "output.floor_area_m2"
    elif physical.get("floor_area_m2") is not None:
        floor_area_m2, area_source = physical["floor_area_m2"], "physical_input.floor_area_m2"
    if floor_area_m2 is not None and _number(floor_area_m2, positive=True) is None:
        raise FireLoadError("建筑防火分区面积须为大于零的有限m²数值。")
    result = {
        "schema_version": 1, "method_version": "source-table-potential-heat-v1",
        "quantity": "source_table_potential_heat", "formula": "Q = sum(m_i * H_i)",
        "status": "unavailable", "total_heat_mj": None, "known_heat_mj": None,
        "total_heat_interval_mj": None, "coverage_mass_fraction": 0.0, "materials": [],
        "candidate_results": [], "candidate_weighted_total_heat_mj": None,
        "candidate_heat_sensitivity_envelope_mj": None,
        "heat_bases": [], "mixed_heat_basis": False,
        "floor_area_m2": float(floor_area_m2) if floor_area_m2 is not None else None,
        "floor_area_source": area_source, "fire_load_density_mj_m2": None,
        "is_code_design_value": False, "method_sources": deepcopy(METHOD_SOURCES),
        "assumptions": {
            "mass_unit": "kg", "heat_unit": "MJ/kg", "energy_unit": "MJ",
            "missing_properties": "unknown, never substituted with zero",
            "identity": "specific material alternatives are conditional hypotheses, not confirmed coexisting materials",
            "interval_method": "linear envelope of marginal sensitivity bands and source heat ranges subject to sum(mass fractions)=1; not a joint 5th–95th interval",
            "interval_limit": "relaxed envelope may combine mutually exclusive identities; not a realizable unique scenario or calibrated confidence interval",
            "heat_basis": "source HHV/LHV retained without conversion; no automatic combustion/protection/design factors",
            "area": "only explicitly supplied building fire-compartment floor_area_m2; never furniture width×depth",
        },
        "warnings": ["结果为原表热值下的潜在热量估计，不是规范设计火灾荷载；未自动应用燃烧、保护等系数。", "细材质及质量比例属于条件推测；互斥材料后验均值不代表同时确认存在。"],
    }
    if mass is None or volume is None:
        result["warnings"].append("缺少有效质量或体积/组成比例，无法计算潜在热量；没有补造材料质量。")
        return result
    can_report = output.get("proportion_reporting_allowed", True) is not False
    materials = output.get("materials") or []
    if materials and can_report:
        result.update(_calculate_rows(materials, mass, catalog))
    for candidate in output.get("candidates") or []:
        estimates = candidate.get("material_estimates") or []
        weight = _number(candidate.get("weight"))
        if not estimates or weight is None or weight == 0:
            continue
        computed = _calculate_rows(estimates, mass, catalog)
        computed.update(candidate_id=candidate.get("id"), label=candidate.get("label"), weight=weight,
                        scope="conditional_on_this_construction")
        result["candidate_results"].append(computed)
    candidates = result["candidate_results"]
    candidate_coverage = sum(row["weight"] for row in candidates)
    result["computed_candidate_weight"] = candidate_coverage
    if candidates and candidate_coverage > 1 + 1e-6:
        raise FireLoadError("构造候选权重合计超过1。")
    if candidates and math.isclose(candidate_coverage, 1.0, abs_tol=1e-6) and all(row["status"] == "complete" for row in candidates):
        result["candidate_weighted_total_heat_mj"] = sum(row["weight"] * row["total_heat_mj"] for row in candidates)
        intervals = [row["total_heat_interval_mj"] for row in candidates]
        if all(interval is not None for interval in intervals):
            result["candidate_heat_sensitivity_envelope_mj"] = [min(interval[0] for interval in intervals), max(interval[1] for interval in intervals)]
    if not materials or not can_report:
        result["warnings"].append("全家具材料比例不足，候选潜在热量仅对各构造假设成立，不作为全家具总量。")
    if result["status"] != "complete":
        result["warnings"].append("有材料比例、具体密度或热值缺失；已知部分不能当作整件家具的总潜在热量，缺失项没有按0处理。")
    if result["mixed_heat_basis"]:
        result["warnings"].append("热值口径含HHV/LHV混合或未说明项，仅给原表潜在热量估计，不能标为统一净热值设计结果。")
    if (physical.get("source") or {}).get("parameters_verified") is False:
        result["warnings"].append("物理来源参数尚未核实；仍按估计量计算，不是实测火灾荷载。")
    if result["total_heat_mj"] is not None and floor_area_m2 is not None:
        result["fire_load_density_mj_m2"] = result["total_heat_mj"] / float(floor_area_m2)
    return result
