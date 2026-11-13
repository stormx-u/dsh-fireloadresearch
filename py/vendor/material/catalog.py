"""Material properties and disclosure-frequency priors from the supplied survey.

Frequencies describe product-level material presence. They are neither mass
fractions nor independent probabilities of mutually exclusive materials.
"""
from __future__ import annotations

import csv
import json
import math
from copy import deepcopy
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parent / "data"

_CLASS_BROAD = {
    "木质人造板": "wood", "木材（实木/单板）": "wood", "金属": "metal",
    "塑料与橡胶": "plastic", "纤维与纺织": "fabric", "泡沫与填充": "foam",
    "纸与纸板": "paper", "皮革": "leather", "竹藤等天然植物": "plant",
    "玻璃/陶瓷/石材": "mineral", "表面处理与涂层": "coating",
    "胶黏剂": "adhesive", "复合材料与其他": "composite", "未指明材料": "unknown",
}
_SURFACES = {
    "plastic_edging_unknown", "paper_foil", "nickel_plating", "zinc_coating",
    "chrome_plating", "wood_veneer", "hpl", "chromium",
}
_AMBIGUOUS_FORMS = {
    "polyester": ("plastic", "fabric"), "polyurethane": ("plastic", "foam"),
    "latex_unknown": ("plastic", "foam"), "rattan_unknown": ("plant", "plastic"),
    "mesh_unknown": ("fabric", "plastic", "metal"),
    "phase_change_unknown": ("wax", "mineral"),
}
# The CSV uses a surrogate material for these labels. Preserve that reference
# separately, but do not present its density as an identified material property.
_UNRESOLVED_DENSITY = {
    "engineered_wood", "fiberboard", "metal_unknown", "plastic_unknown",
    "polyester", "polyurethane", "latex_unknown", "fiber_unknown", "nylon_fiber",
    "olefin_fiber", "elastane_fiber", "elastic_fiber_unknown", "leather_unknown",
    "plastic_rattan_unknown", "plastic_mesh_unknown", "rattan_unknown",
    "mesh_unknown", "honeycomb_board_unknown", "phase_change_unknown",
    "plastic_film_unknown", "veneer_unknown", "paint_finish", "eva", "peva",
    "eva_foam",
}
# Generic identities are retained as survey uncertainty, even where the source
# supplied a broad numeric range. Known polymer names with an unknown shape
# (for example PP/PE) remain usable subtype hypotheses with the source ranges.
_REFINEMENT_GENERIC_IDS = {
    "engineered_wood", "fiberboard", "wood_unknown", "metal_unknown",
    "plastic_unknown", "plastic_rattan_unknown", "plastic_mesh_unknown",
    "rubber_unknown", "textile_unknown", "fiber_unknown", "olefin_fiber",
    "elastic_fiber_unknown", "plant_fiber_unknown", "foam_unknown", "padding_unknown",
    "faux_leather_unknown", "leather_unknown", "rattan_unknown", "mesh_unknown",
    "glass_composite", "quartz_composite", "honeycomb_board_unknown", "phase_change_unknown",
}
_FURNITURE_ALIASES = {
    "chair": "椅子", "chairs": "椅子", "椅": "椅子", "椅子": "椅子",
    "sofa": "沙发", "couch": "沙发", "沙发": "沙发",
    "table": "桌子", "dining table": "桌子", "desk": "桌子", "桌": "桌子",
    "cabinet": "柜子", "wardrobe": "柜子", "柜": "柜子", "柜类": "柜子",
    "shelf": "架子", "shelving": "架子", "bookcase": "架子",
    "bed": "床", "armchair": "扶手椅", "stool": "凳子", "bench": "长凳",
    "长椅": "长凳", "lounger": "躺椅", "chaise longue": "躺椅",
}


def _number(value):
    text = str(value).strip()
    return None if text in {"", "—", "-"} else float(text)


def _range(value):
    text = str(value).strip()
    if text in {"", "—", "-"}:
        return None, None
    parts = text.replace("–", "-").replace("—", "-").split("-")
    if len(parts) != 2:
        raise ValueError(f"Invalid material property range: {value!r}")
    low, high = map(float, parts)
    if low > high:
        raise ValueError(f"Reversed material property range: {value!r}")
    return low, high


class Catalog:
    """Read-only catalog; all densities are kg/m³ and heat values MJ/kg.

    ``candidates`` blends smoothed global and type-specific label frequencies
    within a bulk broad, then applies ``limit``. These are descriptive views of
    overlapping observations, not independent likelihoods or mass fractions.
    """

    def __init__(self, data_dir=None, *, mixing_weight=.5):
        if isinstance(mixing_weight, bool) or not math.isfinite(float(mixing_weight)) or not 0 <= float(mixing_weight) <= 1:
            raise ValueError("mixing_weight must be a finite number between zero and one")
        self.mixing_weight = float(mixing_weight)
        self.data_dir = Path(data_dir) if data_dir is not None else DATA_DIR
        self.frequency = json.loads((self.data_dir / "frequency_prior.json").read_text(encoding="utf-8"))
        self.materials = {}
        with (self.data_dir / "材料分类与物性表.csv").open(encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))
        for row in rows:
            meta = self.frequency["materials_by_name"].get(row["材质标签"])
            if meta is None:
                raise ValueError(f"No stable material code for {row['材质标签']}")
            code = meta["id"]
            broad = _CLASS_BROAD[row["基本类"]]
            if code == "glass":
                broad = "glass"
            elif code.startswith("faux_leather_"):
                broad = "leather"
            elif code == "paraffin":
                broad = "wax"
            options = _AMBIGUOUS_FORMS.get(code)
            if options:
                broad = "unknown"
            role = "surface" if broad == "coating" or code in _SURFACES else "bulk"
            if broad == "adhesive":
                role = "adhesive"
            elif broad == "unknown":
                role = "unknown"
            density_low, density_high = _range(row["密度范围(kg/m³)"])
            density_typical = _number(row["密度典型(kg/m³)"])
            reference_density = {"min": density_low, "max": density_high, "typical": density_typical}
            density_basis = self._density_basis(code, broad, role)
            unresolved = code in _UNRESOLVED_DENSITY
            if unresolved:
                density_low = density_high = density_typical = None
                density_basis = "unknown"
            heat_low, heat_high = _range(row["热值范围(MJ/kg)"])
            notes = [row["备注"]] if row["备注"] else []
            if unresolved:
                notes.append("原表物性为指定替代材料或形态不明确，保留参考值，不用于密度数值约束。")
            if density_basis == "fiber_true":
                notes.append("纤维本体密度，不能直接乘软包或织物外廓体积。")
            if code == "foam_unknown":
                notes.append("化学类型未确定，但原表明确为泡沫，可使用15–60 kg/m³表观密度范围。")
            material = {
                "id": code, "category": broad, "broad": broad,
                "broad_options": list(options or (broad,)), "name": row["材质标签"],
                "source_category": row["基本类"], "family": meta["family"],
                "form": meta["form"], "behavior": meta["behavior"],
                "count": int(row["出现产品数"]),
                "coverage_all": float(row["覆盖率(全体)"]), "role": role,
                "density_min": density_low, "density_max": density_high,
                "density_typical": density_typical, "density_basis": density_basis,
                "density_unit": "kg/m³", "reference_density": reference_density,
                "property_resolution": "surrogate_or_unspecified" if unresolved else "source_range",
                "heat_value_typical": _number(row["热值典型(MJ/kg)"]),
                "heat_value_min": heat_low, "heat_value_max": heat_high,
                "heat_basis": row["热值口径"], "heat_unit": "MJ/kg",
                "source": {"property_file": "材料分类与物性表.csv",
                           "frequency_file": "stats/03_材质总频次.csv",
                           "property_reference": row["物性参照"],
                           "source_codes": row["依据"].split("/"), "notes": notes},
            }
            material["refinement_exclusion_reason"] = self._refinement_reason(material)
            material["refinement_specific"] = material["refinement_exclusion_reason"] is None
            material["heat_usable_for_refinement"] = material["refinement_specific"]
            if material["count"] != meta["count"]:
                raise ValueError(f"Property and frequency counts disagree for {code}")
            if code in self.materials:
                raise ValueError(f"Duplicate material code: {code}")
            self.materials[code] = material

    @staticmethod
    def _density_basis(code, broad, role):
        if role == "surface":
            return "surface_layer"
        if code == "padding_unknown":
            return "loose_fill_bulk"
        if broad == "foam" or code == "feather_down":
            return "foam_bulk" if broad == "foam" else "loose_fill_bulk"
        if code == "textile_unknown":
            return "textile_bulk"
        if broad == "fabric" or code == "glass_fiber":
            return "fiber_true"
        if broad in {"leather", "composite", "paper"}:
            return "composite_bulk"
        return "solid" if broad not in {"unknown", "coating", "adhesive"} else "unknown"

    @staticmethod
    def _refinement_reason(material):
        if material.get("role") != "bulk":
            return "surface_adhesive_or_cross_broad_identity"
        if material["id"] in _REFINEMENT_GENERIC_IDS:
            return "unspecified_material_identity"
        lo, hi = material.get("density_min"), material.get("density_max")
        if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value)
               for value in (lo, hi)) or not 0 < lo <= hi:
            return "density_missing_or_surrogate"
        low, high = material.get("heat_value_min"), material.get("heat_value_max")
        if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value)
               for value in (low, high)) or not 0 <= low <= high:
            return "net_heat_value_missing"
        basis = str(material.get("heat_basis") or "")
        if not any(token in basis.lower() for token in ("lhv", "net", "低位")):
            return "net_heat_value_basis_unspecified"
        return None

    def refinement_groups(self, broad):
        """Partition one already identified broad without inferring its presence.

        Specific options require a named subtype plus usable source density and
        LHV ranges. Generic and property-incomplete source rows remain separate.
        This method does not use broad-combination frequencies or source unions.
        """
        broad = str(broad).strip().lower()
        broad = {"textile": "fabric", "polymer": "plastic", "timber": "wood"}.get(broad, broad)
        specific, unresolved, nonbulk, ambiguous = [], [], [], []
        for material in self.materials.values():
            if material["broad"] == broad:
                entry = deepcopy(material)
                reason = self._refinement_reason(entry)
                entry["refinement_exclusion_reason"] = reason
                entry["refinement_specific"] = reason is None
                if entry["role"] != "bulk":
                    nonbulk.append(entry)
                elif reason is None:
                    specific.append(entry)
                else:
                    unresolved.append(entry)
            elif material["broad"] == "unknown" and broad in material.get("broad_options", []):
                ambiguous.append(deepcopy(material))
        return {"broad": broad, "specific": specific, "unresolved": unresolved,
                "nonbulk": nonbulk, "cross_broad_ambiguous": ambiguous, "broad_locked": True}

    def by_id(self, material_id):
        """Return a defensive copy, or None for an unknown stable code."""
        material = self.materials.get(material_id)
        return deepcopy(material) if material is not None else None

    def _type_evidence(self, furniture_type):
        key = str(furniture_type or "").strip()
        key = _FURNITURE_ALIASES.get(key.lower(), key)
        return key, self.frequency["furniture_types"].get(key)

    def _frequency_sources(self, has_type=False):
        files = [("材料分类与物性表.csv", "material_label_and_global_count"),
                 ("stats/03_材质总频次.csv", "global_product_material_presence")]
        if has_type:
            files.append(("stats/06_分类型材质长表.csv", "type_product_material_presence"))
        provenance = self.frequency.get("provenance", {})
        return [{"file": filename, "sha256": provenance.get(filename, {}).get("sha256"), "role": role}
                for filename, role in files]

    def frequency_evidence(self, material_id, furniture_type=None):
        """Expose exact counts, denominators and the descriptive prior blend.

        Coverage uses all product observations (CSV denominator A). The
        within-broad prior instead normalizes label counts, which can overlap.
        Parent/unspecified labels retain their original identity and count.
        """
        material = self.materials.get(material_id)
        if material is None:
            return None
        key, conditional = self._type_evidence(furniture_type)
        peers = [m for m in self.materials.values()
                 if m["broad"] == material["broad"] and m["role"] == "bulk"]
        eligible = material["role"] == "bulk" and bool(peers)
        alpha = float(self.frequency["candidate_smoothing"]["alpha"])
        global_normalizer = sum(m["count"] + alpha for m in peers)
        type_counts = conditional["counts"] if conditional else None
        type_normalizer = sum(type_counts.get(m["id"], 0) + alpha for m in peers) if conditional else None
        global_prior = (material["count"] + alpha) / global_normalizer if eligible else None
        type_count = type_counts.get(material_id, 0) if conditional else None
        type_prior = (type_count + alpha) / type_normalizer if conditional and eligible else None
        weight = self.mixing_weight if conditional else 0.
        blended = ((1 - weight) * global_prior + weight * type_prior
                   if type_prior is not None else global_prior)
        global_denominator = self.frequency["population"]["n_all"]
        type_denominator = conditional["n_all"] if conditional else None
        return {
            "material_id": material_id, "raw_label": material["name"], "broad": material["broad"],
            "unit": "distinct_product_material_presence", "furniture_type": key if conditional else None,
            "global_count": material["count"], "global_denominator": global_denominator,
            "global_coverage": material["count"] / global_denominator,
            "type_count": type_count, "type_denominator": type_denominator,
            "type_coverage": type_count / type_denominator if conditional else None,
            "global_with_material_denominator": self.frequency["population"]["n_with_material"],
            "type_with_material_denominator": conditional["n_with_material"] if conditional else None,
            "global_within_broad_prior": global_prior, "type_within_broad_prior": type_prior,
            "blended_within_broad_prior": blended, "mixing_weight": weight,
            "mixing_weight_interpretation": "weight on type view; convex blend, not independent evidence multiplication",
            "global_label_count_normalizer": global_normalizer if eligible else None,
            "type_label_count_normalizer": type_normalizer if conditional and eligible else None,
            "smoothing_alpha": alpha, "eligible_for_bulk_prior": eligible,
            "not_mass_fraction": True, "sources": self._frequency_sources(bool(conditional)),
            "limitations": "Descriptive disclosure prior. Labels overlap within products; an unspecified parent is not a separate identified substance.",
        }

    def broad_frequency_evidence(self, broad, furniture_type=None):
        """Return a verified bulk product union, with an explicitly labeled fallback.

        The exact union is recomputed from normalized product records using this
        catalog's bulk/broad mapping, after all 112 counts reconcile to the CSV.
        A fallback sum counts product-material pairs, never distinct products.
        """
        broad = str(broad).strip().lower()
        broad = {"textile": "fabric", "polymer": "plastic", "timber": "wood"}.get(broad, broad)
        peers = [m for m in self.materials.values() if m["broad"] == broad and m["role"] == "bulk"]
        key, conditional = self._type_evidence(furniture_type)
        global_sum = sum(m["count"] for m in peers)
        type_sum = sum(conditional["counts"].get(m["id"], 0) for m in peers) if conditional else None
        block = self.frequency.get("broad_product_unions") or {}
        expected_mapping = {(m["id"], m["broad"]) for m in self.materials.values() if m["role"] == "bulk"}
        supplied_mapping = {(m["id"], m["broad"]) for m in block.get("mapping", [])}
        exact = bool(block and block.get("unit") == "exact_product_union" and
                     block.get("verification", {}).get("all_112_material_counts_match_property_csv") and
                     expected_mapping == supplied_mapping)
        global_denominator = self.frequency["population"]["n_all"]
        type_denominator = conditional["n_all"] if conditional else None
        type_block = block.get("furniture_types", {}).get(key) if conditional else None
        if exact and (block["global"]["n_all"] != global_denominator or
                      (conditional and (not type_block or type_block["n_all"] != type_denominator))):
            exact = False
        global_count = block["global"]["counts"].get(broad, 0) if exact else global_sum
        type_count = (type_block["counts"].get(broad, 0) if exact else type_sum) if conditional else None
        global_rate = global_count / global_denominator
        type_rate = type_count / type_denominator if conditional else None
        weight = self.mixing_weight if conditional else 0.
        blended = (1 - weight) * global_rate + weight * type_rate if conditional else global_rate
        sources = deepcopy(block.get("sources", [])) if exact else self._frequency_sources(bool(conditional))
        return {
            "broad": broad, "furniture_type": key if conditional else None,
            "unit": "exact_product_union" if exact else "sum_material_presence_counts",
            "is_product_union": exact, "global_count": global_count, "type_count": type_count,
            "global_denominator": global_denominator, "type_denominator": type_denominator,
            "global_coverage": global_rate if exact else None, "type_coverage": type_rate if exact else None,
            "global_rate": global_rate, "type_rate": type_rate, "blended_rate": blended,
            "global_sum_mentions": global_sum, "type_sum_mentions": type_sum,
            "sum_mentions": {"global": global_sum, "type": type_sum}, "mixing_weight": weight,
            "not_mass_fraction": True, "independent_evidence": False, "sources": sources,
            "interpretation": ("Product union within the bulk broad; categories can co-occur, so broad coverages do not sum to one."
                               if exact else "Mean material-label presences per product; not a product-union probability, and may exceed one."),
            "mapping_excludes": "surface layers, adhesives and unresolved cross-broad forms",
        }

    def layout_frequency_evidence(self, broads, furniture_type=None, universe=None, observed=None):
        """Count exact projected *disclosed material combinations*, not frames.

        For each product's bulk signature S, retain products containing every
        observed broad O. The event is exactly S intersect universe U == B.
        Other disclosed materials outside U do not alter that projected event.
        Missing disclosures are not evidence that a material is physically absent.
        """
        def broad_set(value):
            if value is None:
                return set()
            values = value.split("|") if isinstance(value, str) else value
            result = set()
            for item in values:
                if not isinstance(item, str):
                    raise ValueError("Material combination entries must be broad names")
                item = item.strip().lower()
                if item:
                    result.add({"textile": "fabric", "polymer": "plastic", "timber": "wood"}.get(item, item))
            return result
        target = broad_set(broads)
        known = {m["broad"] for m in self.materials.values() if m["role"] == "bulk"}
        scope = known if universe is None else broad_set(universe)
        required = broad_set(observed)
        if not target.issubset(scope):
            raise ValueError("Requested material combination must be contained in universe")
        key, conditional = self._type_evidence(furniture_type)
        block = self.frequency.get("broad_product_unions") or {}
        expected_mapping = {(m["id"], m["broad"]) for m in self.materials.values() if m["role"] == "bulk"}
        supplied_mapping = {(m["id"], m["broad"]) for m in block.get("mapping", [])}
        available = (block.get("unit") == "exact_product_union" and expected_mapping == supplied_mapping and
                     block.get("verification", {}).get("all_112_material_counts_match_property_csv") is True and
                     isinstance(block.get("global", {}).get("signatures"), dict))
        def count_signatures(record):
            if record is None or not isinstance(record.get("signatures"), dict):
                return None, None, None
            if sum(record["signatures"].values()) != record["n_all"]:
                raise ValueError("Signature counts do not reconcile to their product population")
            numerator = denominator = 0
            for signature, count in record["signatures"].items():
                present = broad_set(signature)
                if required.issubset(present):
                    denominator += count
                    if present & scope == target:
                        numerator += count
            return numerator, denominator, numerator / denominator if denominator else None
        global_count, global_denominator, global_rate = count_signatures(block["global"]) if available else (None, None, None)
        type_record = block.get("furniture_types", {}).get(key) if conditional and available else None
        type_count, type_denominator, type_rate = count_signatures(type_record)
        weight = self.mixing_weight if type_rate is not None and global_rate is not None else (1. if type_rate is not None else 0.)
        blended = ((1 - weight) * global_rate + weight * type_rate
                   if global_rate is not None and type_rate is not None else
                   (type_rate if type_rate is not None else global_rate))
        return {
            "available": available, "unit": "exact_projected_product_signature" if available else "signature_data_unavailable",
            "broads": sorted(target), "projected_signature": "|".join(sorted(target)),
            "universe": sorted(scope), "observed": sorted(required),
            "furniture_type": key if conditional else None,
            "global_count": global_count, "global_denominator": global_denominator, "global_coverage": global_rate,
            "type_count": type_count, "type_denominator": type_denominator, "type_coverage": type_rate,
            "global_total_products": self.frequency["population"]["n_all"],
            "type_total_products": conditional["n_all"] if conditional else None,
            "global_rate": global_rate, "type_rate": type_rate, "blended_rate": blended,
            "mixing_weight": weight, "independent_evidence": False, "not_mass_fraction": True,
            "event": "disclosed bulk signature projected on universe equals broads; denominator conditioned on containing observed",
            "interpretation": "Material-combination disclosure frequency, not a support/frame frequency, physical absence claim or mass fraction.",
            "sources": deepcopy(block.get("sources", [])) if available else [],
        }

    def candidates(self, broad, furniture_type=None, limit=6):
        """Return bulk candidates, ranked by the requested disclosure prior.

        Absent materials in the full type table have zero reported occurrences,
        then receive +1 smoothing. Unrecognized furniture types use global counts.
        Missing co-occurrence edges have different semantics and remain unknown.
        """
        broad = str(broad).lower().strip()
        broad = {"textile": "fabric", "polymer": "plastic", "timber": "wood"}.get(broad, broad)
        candidates = [m for m in self.materials.values() if m["broad"] == broad and m["role"] == "bulk"]
        type_key, conditional = self._type_evidence(furniture_type)
        counts = conditional["counts"] if conditional else {m["id"]: m["count"] for m in candidates}
        alpha = float(self.frequency["candidate_smoothing"]["alpha"])
        n_population = conditional["n_all"] if conditional else self.frequency["population"]["n_all"]
        basis = {
            "kind": "global_type_blend" if conditional else "global", "furniture_type": type_key if conditional else None,
            "denominator_products": n_population, "unit": "distinct_product_material_presence",
            "smoothing": "laplace", "alpha": alpha, "normalization": "all_bulk_candidates_in_broad_before_limit",
            "disclosure_frequency_is_mass_fraction": False,
            "combination": "convex descriptive blend; global and type views are not independent likelihoods",
            "mixing_weight": self.mixing_weight if conditional else 0.,
            "coverage_denominator": "all_product_observations_A; within-broad normalization separately uses label counts",
        }
        output = []
        for material in candidates:
            item = deepcopy(material)
            actual_count = counts.get(item["id"], 0)
            item["prior_count"] = actual_count
            item["frequency_evidence"] = self.frequency_evidence(item["id"], furniture_type)
            item["prior"] = item["frequency_evidence"]["blended_within_broad_prior"]
            item["prior_basis"] = deepcopy(basis)
            output.append(item)
        output.sort(key=lambda m: (-m["prior"], -m["count"], m["id"]))
        return output[:max(0, min(int(limit), 64))]

    def cooccurrence_detail(self, id_a, id_b):
        """Return directional product co-occurrence evidence, or None if unobserved.

        The published table includes only the top 60 labels with at least 50
        joint products. Its absent edges do not establish a zero probability.
        """
        if id_a not in self.materials or id_b not in self.materials:
            return None
        if id_a == id_b:
            count = self.materials[id_a]["count"]
            return {"id_a": id_a, "id_b": id_b, "joint_count": count,
                    "p_b_given_a": 1.0, "p_a_given_b": 1.0,
                    "support_all": count / self.frequency["population"]["n_all"],
                    "basis": "identity", "lift": None}
        reverse = False
        entry = self.frequency["cooccurrence"].get(id_a + "|" + id_b)
        if entry is None:
            entry = self.frequency["cooccurrence"].get(id_b + "|" + id_a)
            reverse = True
        if entry is None:
            return None
        result = deepcopy(entry)
        if reverse:
            result["p_b_given_a"], result["p_a_given_b"] = result["p_a_given_b"], result["p_b_given_a"]
        result.update(id_a=id_a, id_b=id_b, basis="global_product_presence_top60_min_joint50")
        return result

    def cooccurrence(self, id_a, id_b):
        """Return P(id_b present | id_a present), or None for unpublished edges."""
        detail = self.cooccurrence_detail(id_a, id_b)
        return detail["p_b_given_a"] if detail is not None else None

    def summary(self):
        return {"material_count": len(self.materials),
                "population": deepcopy(self.frequency["population"]),
                "furniture_types": list(self.frequency["furniture_types"]),
                "frequency_basis": deepcopy(self.frequency["frequency_basis"]),
                "cooccurrence_basis": deepcopy(self.frequency["cooccurrence_basis"]),
                "frequency_blend": {"type_weight": self.mixing_weight, "global_weight": 1 - self.mixing_weight,
                                    "kind": "convex_descriptive_not_independent_evidence"},
                "broad_frequency_unit": "exact_product_union" if self.frequency.get("broad_product_unions") else "sum_material_presence_counts",
                "source_references": deepcopy(self.frequency["source_references"]),
                "density_bases": sorted({m["density_basis"] for m in self.materials.values()})}
