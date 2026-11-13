"""Frequency-guided subtype hypotheses inside an already identified material broad.

Survey disclosure counts rank plywood/steel/PE alternatives. They never decide
whether wood/metal/plastic is present and are never copied into mass fractions.
"""
from __future__ import annotations

from copy import deepcopy
import math


_PROPERTY_FIELDS = (
    "id", "name", "broad", "density_min", "density_max", "density_typical", "density_basis", "density_unit",
    "heat_value_min", "heat_value_max", "heat_value_typical", "heat_basis", "heat_unit",
    "property_resolution", "source", "heat_usable_for_refinement",
)


def refine_options(catalog, broad, furniture_type=None, limit=6):
    """Return normalized computable subtype options and separate survey unknowns.

    Global and furniture-type views are blended descriptively, not multiplied
    as independent observations. Subtype priors are normalized among concrete
    computable rows only. With ``limit``, ``conditional_prior`` sums to one in
    the returned subset; ``full_conditional_prior`` preserves the pre-limit
    value. ``unknown_mass`` is a label-frequency share, not a physical mass.
    """
    if isinstance(limit, bool) or not isinstance(limit, int) or not 0 <= limit <= 64:
        raise ValueError("limit must be an integer between zero and 64")
    groups = catalog.refinement_groups(broad)
    broad = groups["broad"]
    specific, unresolved = groups["specific"], groups["unresolved"]
    key, conditional = catalog._type_evidence(furniture_type)
    weight = catalog.mixing_weight if conditional else 0.
    alpha = float(catalog.frequency["candidate_smoothing"]["alpha"])
    if not math.isfinite(alpha) or alpha < 0:
        raise ValueError("Subtype smoothing must be nonnegative and finite")
    evidence = {m["id"]: catalog.frequency_evidence(m["id"], furniture_type)
                for m in specific + unresolved}
    def count(material, type_view=False):
        value = evidence[material["id"]]["type_count" if type_view else "global_count"]
        return value if value is not None else 0
    def view(type_view=False):
        concrete_count = sum(count(m, type_view) for m in specific)
        unknown_count = sum(count(m, type_view) for m in unresolved)
        total = concrete_count + unknown_count
        return {"specific_label_count": concrete_count, "unresolved_label_count": unknown_count,
                "all_label_count": total, "unresolved_share": unknown_count / total if total else None,
                "product_denominator": (conditional["n_all"] if conditional else None) if type_view
                                       else catalog.frequency["population"]["n_all"]}
    global_view = view()
    type_view = view(True) if conditional else None
    unknown_weight = weight if type_view and type_view["all_label_count"] else 0.
    global_unknown = global_view["unresolved_share"]
    type_unknown = type_view["unresolved_share"] if type_view else None
    if global_unknown is not None and type_unknown is not None:
        unknown_share = (1 - unknown_weight) * global_unknown + unknown_weight * type_unknown
    else:
        unknown_share = global_unknown if global_unknown is not None else type_unknown
    # A type containing only unspecified labels has no within-specific subtype
    # evidence. Use the global subtype distribution, preserving its unknown share.
    subtype_weight = weight if type_view and type_view["specific_label_count"] else 0.
    k = len(specific)
    global_normalizer = global_view["specific_label_count"] + alpha * k
    type_normalizer = (type_view["specific_label_count"] + alpha * k) if type_view else None
    options = []
    for material in specific:
        global_prior = ((count(material) + alpha) / global_normalizer
                        if global_normalizer else 1 / k)
        type_prior = ((count(material, True) + alpha) / type_normalizer
                      if type_normalizer else None)
        combined = ((1 - subtype_weight) * global_prior + subtype_weight * type_prior
                    if subtype_weight else global_prior)
        item = deepcopy(material)
        item.update(
            material=deepcopy(material), conditional_prior=combined, prior=combined,
            full_conditional_prior=combined, global_count=count(material),
            type_count=count(material, True) if conditional else None,
            frequency_evidence=deepcopy(evidence[material["id"]]), unknown=False,
            refinement_status="candidate_not_identified", identified=False,
            source_properties={field: deepcopy(material.get(field)) for field in _PROPERTY_FIELDS},
            conditional_prior_basis={
                "scope": "within_already_identified_broad_computable_specific_rows",
                "global_specific_prior": global_prior, "type_specific_prior": type_prior,
                "global_specific_label_count_normalizer": global_normalizer,
                "type_specific_label_count_normalizer": type_normalizer,
                "smoothing_alpha": alpha, "type_mixing_weight": subtype_weight,
                "not_mass_fraction": True, "independent_evidence": False,
            },
        )
        options.append(item)
    options.sort(key=lambda m: (-m["full_conditional_prior"], -m["global_count"], m["id"]))
    selected = options[:limit]
    retained = sum(option["full_conditional_prior"] for option in selected)
    for option in selected:
        option["conditional_prior"] = option["full_conditional_prior"] / retained
        option["prior"] = option["conditional_prior"]
        option["conditional_prior_basis"]["normalization"] = "conditional_on_retained_specific_options"
    unknown_labels = [
        {"id": m["id"], "name": m["name"], "reason": m["refinement_exclusion_reason"],
         "frequency_evidence": deepcopy(evidence[m["id"]]),
         "density_min": m["density_min"], "density_max": m["density_max"],
         "reference_density": deepcopy(m.get("reference_density")), "source": deepcopy(m["source"])}
        for m in unresolved
    ]
    unresolved_survey = {
        "unknown_mass": unknown_share,
        "unit": "descriptive_label_frequency_prior_mass_not_physical_mass",
        "not_mass_fraction": True, "not_product_union_fraction": True,
        "global": global_view, "type": type_view, "type_mixing_weight": unknown_weight,
        "generic_labels": unknown_labels, "labels": deepcopy(unknown_labels),
        "cross_broad_ambiguous_labels": [
            {"id": m["id"], "name": m["name"], "broad_options": m["broad_options"],
             "frequency_evidence": catalog.frequency_evidence(m["id"], furniture_type),
             "included_in_unknown_mass": False}
            for m in groups["cross_broad_ambiguous"]],
        "interpretation": "Unspecified or property-incomplete label counts are disclosed separately; overlapping product labels are not physical mass and are not assigned to a specific subtype.",
    }
    notices = ["频次只在已识别大类内部排列细类候选，不改变大类存在结论，也不是质量比例。",
               "具体细类均为待密度、质量、体积进一步约束的假设，不代表图像已确定牌号、板种或纤维成分。"]
    if not selected:
        notices.append("该大类没有可用的具体密度与低位热值候选，保留未知，不补造物性。")
    if any(m["density_basis"] == "fiber_true" for m in selected):
        notices.append("纤维本体密度用于纤维实体体积，不能直接乘软包或织物外廓体积。")
    return {
        "broad": broad, "broad_locked": True, "furniture_type": key if conditional else None,
        "options": selected, "specific_candidate_count": k,
        "retained_prior_mass": retained, "other_specific_prior_mass": max(0., 1 - retained) if k else None,
        "unknown_survey_share": unknown_share, "unknown_mass": unknown_share,
        "unresolved_survey": unresolved_survey,
        "generic_labels": deepcopy(unknown_labels),
        "frequency_basis": {
            "scope": "within_already_identified_broad_only", "unit": "distinct_product_material_presence",
            "global_denominator": catalog.frequency["population"]["n_all"],
            "type_denominator": conditional["n_all"] if conditional else None,
            "specific_type_mixing_weight": subtype_weight, "smoothing_alpha": alpha,
            "sources": catalog._frequency_sources(bool(conditional)),
            "not_mass_fraction": True, "broad_presence_weighted_by_frequency": False,
            "combination": "convex descriptive global/type blend among computable specific rows",
        },
        "status": "conditional_subtype_candidates" if selected else "unresolved_broad",
        "warnings": notices,
    }
