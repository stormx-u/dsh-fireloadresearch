"""Dev-only: convert Fireprediction's fusion.joblib into a compact numpy artifact.

The plugin runtime has numpy + onnxruntime but NOT scikit-learn/joblib, so the
two HistGBR heads are flattened here into plain arrays that `engine.py`
evaluates with numpy.

Design notes
------------
* sklearn stores numeric split thresholds as float64 midpoints. Instead of
  shipping those floats we ship the *bin index* (`bin_threshold`, uint8) plus
  the per-feature bin edges, and bin the input matrix with `np.searchsorted`
  exactly like `_bin_mapper.transform` does. Comparisons then become integer
  comparisons, which is bit-exact and much smaller.
* The single categorical feature (furniture type, column 0) is also expressed
  as a bin index; its splits need a category bitset, which we collapse into a
  uint16 mask over the 12 possible type bins.
* Child indices are stored as int16 deltas relative to the parent node.
* The converter verifies its own numpy forward pass against
  `HistGradientBoostingRegressor.predict` and refuses to write on mismatch.

    python scripts/convert_weight_model.py \
        --joblib "D:\\Fireprediction\\models\\weight\\fusion.joblib" \
        --out "py\\vendor\\fireprediction\\models\\weight_fusion.npz"
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

LEAF = 255


def _stages(model) -> list:
    trees = []
    for stage in model._predictors:
        if isinstance(stage, (list, tuple)):
            trees.extend(list(stage))
        else:
            trees.append(stage)
    return trees


def _categorical_masks(trees, tree_starts, n_bins: int) -> dict:
    node_rows = []
    masks = []
    for tree_index, tree in enumerate(trees):
        nodes = tree.nodes
        cat_local = np.where(nodes["is_categorical"] != 0)[0]
        if cat_local.size == 0:
            continue
        bitsets = np.asarray(tree.binned_left_cat_bitsets)
        for local in cat_local:
            row = bitsets[int(nodes["bitset_idx"][local])]
            mask = 0
            for bin_index in range(n_bins):
                if (int(row[bin_index >> 5]) >> (bin_index & 31)) & 1:
                    mask |= 1 << bin_index
            node_rows.append(tree_starts[tree_index] + int(local))
            masks.append(mask)
    return {
        "cat_node": np.asarray(node_rows, dtype=np.int32),
        "cat_mask": np.asarray(masks, dtype=np.uint16),
    }


def flatten_model(model, n_bins: int) -> dict:
    trees = _stages(model)
    tree_starts = []
    features = []
    bins = []
    lefts = []
    rights = []
    values = []
    offset = 0
    for tree in trees:
        nodes = tree.nodes
        count = len(nodes)
        if count > 60000:
            raise SystemExit("tree too large for int16 child deltas")
        tree_starts.append(offset)
        is_leaf = nodes["is_leaf"].astype(bool)
        local = np.arange(count, dtype=np.int64)
        feature = np.where(is_leaf, LEAF, nodes["feature_idx"].astype(np.int64)).astype(np.uint8)
        features.append(feature)
        bins.append(np.where(is_leaf, 0, nodes["bin_threshold"].astype(np.int64)).astype(np.uint8))
        left_local = nodes["left"].astype(np.int64)
        right_local = nodes["right"].astype(np.int64)
        lefts.append(np.where(is_leaf, 0, left_local - local).astype(np.int16))
        rights.append(np.where(is_leaf, 0, right_local - local).astype(np.int16))
        values.append(nodes["value"].astype(np.float64))
        offset += count
    flat = {
        "feature": np.concatenate(features),
        "bin": np.concatenate(bins),
        "left_delta": np.concatenate(lefts),
        "right_delta": np.concatenate(rights),
        "value": np.concatenate(values),
        "offsets": np.asarray(tree_starts + [offset], dtype=np.int32),
        "baseline": float(np.asarray(model._baseline_prediction).reshape(-1)[0]),
        "n_trees": len(trees),
    }
    flat.update(_categorical_masks(trees, tree_starts, n_bins))
    return flat


def bin_matrix(matrix: np.ndarray, binning: dict) -> np.ndarray:
    """Replicate sklearn's _bin_mapper.transform for our 24-feature matrix."""
    x = np.asarray(matrix, dtype=np.float64)
    n_samples = x.shape[0]
    out = np.zeros((n_samples, binning["n_features"]), dtype=np.int64)
    offsets = binning["edges_offsets"]
    for feature in range(binning["n_features"]):
        column = x[:, feature]
        if feature == binning["cat_feature"]:
            values = binning["cat_values"]
            out[:, feature] = np.searchsorted(values, column, side="left")
        else:
            start = int(offsets[feature])
            stop = int(offsets[feature + 1])
            out[:, feature] = np.searchsorted(binning["edges"][start:stop], column, side="left")
    return out.astype(np.uint8)


def predict_numpy(flat: dict, binned: np.ndarray) -> np.ndarray:
    n_samples = binned.shape[0]
    out = np.full(n_samples, flat["baseline"], dtype=np.float64)
    feature = flat["feature"]
    bin_threshold = flat["bin"]
    left_delta = flat["left_delta"]
    right_delta = flat["right_delta"]
    value = flat["value"]
    offsets = flat["offsets"]
    cat_row = np.full(feature.shape[0], -1, dtype=np.int32)
    if flat["cat_node"].size:
        cat_row[flat["cat_node"]] = np.arange(flat["cat_node"].size, dtype=np.int32)
    cat_mask = flat["cat_mask"]
    for tree in range(len(offsets) - 1):
        start = int(offsets[tree])
        stop = int(offsets[tree + 1])
        node = np.full(n_samples, start, dtype=np.int64)
        while True:
            feat_all = feature[node]
            pending = np.nonzero(feat_all != LEAF)[0]
            if pending.size == 0:
                break
            node_ids = node[pending]
            f_pending = feat_all[pending].astype(np.int64)
            rows = cat_row[node_ids]
            is_cat = rows >= 0
            go_left = np.empty(pending.size, dtype=bool)
            if np.any(is_cat):
                masks = cat_mask[rows[is_cat]].astype(np.int64)
                go_left[is_cat] = ((masks >> binned[pending[is_cat], 0]) & 1) != 0
            numeric = ~is_cat
            if np.any(numeric):
                go_left[numeric] = (
                    binned[pending[numeric], f_pending[numeric]]
                    <= bin_threshold[node_ids[numeric]]
                )
            delta = np.where(go_left, left_delta[node_ids], right_delta[node_ids]).astype(np.int64)
            node[pending] = node_ids + delta
            node[pending] = np.clip(node[pending], start, stop - 1)
        out += value[node]
    return out


def build_binning(bin_mapper) -> dict:
    n_features = 24
    edges = []
    offsets = [0]
    cat_feature = -1
    cat_values = np.zeros(0, dtype=np.float64)
    for feature in range(n_features):
        if bin_mapper.is_categorical_[feature]:
            cat_feature = feature
            cat_values = np.asarray(bin_mapper.known_categories[feature], dtype=np.float64)
            # keep offsets aligned but contribute nothing
            offsets.append(offsets[-1])
            continue
        values = np.asarray(bin_mapper.bin_thresholds_[feature], dtype=np.float64)
        edges.append(values)
        offsets.append(offsets[-1] + values.size)
    return {
        "n_features": n_features,
        "edges": np.concatenate(edges) if edges else np.zeros(0, dtype=np.float64),
        "edges_offsets": np.asarray(offsets, dtype=np.int32),
        "cat_feature": cat_feature,
        "cat_values": cat_values,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--joblib", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--check-samples", type=int, default=128)
    args = parser.parse_args()

    try:
        import joblib
    except ImportError:
        print("ERROR: converter needs joblib + scikit-learn", file=sys.stderr)
        return 2

    artifact = joblib.load(Path(args.joblib))
    models = list(artifact["models"])
    if len(models) != 2:
        print(f"ERROR: expected 2 models, found {len(models)}", file=sys.stderr)
        return 2
    if int(artifact["n_features"]) != 24:
        print("ERROR: unexpected n_features", file=sys.stderr)
        return 2

    sys.path.insert(0, r"D:\Fireprediction\src")
    try:
        from fireprediction.models.mass_features import make_matrix
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: cannot import mass_features: {exc}", file=sys.stderr)
        return 2

    bin_mapper = models[0]._bin_mapper
    binning = build_binning(bin_mapper)
    n_bins = int(binning["cat_values"].size)
    types = [str(item) for item in artifact["types"]]

    # Reproducible random check matrix in the 24-feature space.
    rng = np.random.default_rng(20261112)
    samples = args.check_samples
    columns = []
    for _ in range(samples):
        w, h, d = (float(rng.uniform(20, 260)), float(rng.uniform(20, 240)),
                   float(rng.uniform(20, 200)))
        type_id = int(rng.integers(0, len(types)))
        log_value = float(rng.uniform(0.4, 4.6))
        features = make_matrix([w], [h], [d], [type_id], artifact["medians"])
        columns.append(np.column_stack([features, np.asarray([[log_value]])]).astype(np.float32))
    matrix = np.vstack(columns)

    binned = bin_matrix(matrix, binning)
    expected_binned = bin_mapper.transform(models[0]._preprocessor.transform(matrix))
    if not np.array_equal(binned, expected_binned.astype(np.uint8)):
        print("ERROR: binning does not match sklearn's bin mapper", file=sys.stderr)
        return 2

    payload: dict[str, np.ndarray] = {}
    for key, values in binning.items():
        payload[f"bin_{key}"] = np.asarray(values)
    meta = {
        "n_features": 24,
        "types": types,
        "img_size": int(artifact.get("img_size", 0) or 0),
        "img_model": str(artifact.get("img_model", "")),
        "name": str(artifact.get("name", "")),
        "version": str(artifact.get("version", "")),
        "models": [],
    }
    for key in ("W", "H", "D", "V"):
        payload[f"medians_{key}"] = np.asarray(
            [float(artifact["medians"][key][index]) for index in range(len(types))],
            dtype=np.float64,
        )
    payload["hd_w"] = np.asarray(artifact["hd_w"], dtype=np.float64).reshape(-1)
    payload["hd_b"] = np.asarray(artifact["hd_b"], dtype=np.float64).reshape(-1)

    total_nodes = 0
    for index, model in enumerate(models):
        flat = flatten_model(model, n_bins)
        total_nodes += int(flat["feature"].size)
        expected = np.asarray(model.predict(matrix), dtype=np.float64).reshape(-1)
        actual = predict_numpy(flat, binned)
        drift = float(np.max(np.abs(expected - actual)))
        print(
            f"check model {index}: trees={flat['n_trees']} nodes={flat['feature'].size} "
            f"max_abs={drift:.3e}"
        )
        if drift > 1e-9:
            print("ERROR: numpy forward pass does not match sklearn", file=sys.stderr)
            return 3
        for name in ("feature", "bin", "left_delta", "right_delta", "value", "offsets",
                     "cat_node", "cat_mask"):
            payload[f"m{index}_{name}"] = flat[name]
        payload[f"m{index}_baseline"] = np.asarray([flat["baseline"]], dtype=np.float64)
        meta["models"].append(
            {
                "trees": flat["n_trees"],
                "nodes": int(flat["feature"].size),
                "baseline": flat["baseline"],
            }
        )

    payload["meta"] = np.asarray(json.dumps(meta, ensure_ascii=False))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, **payload)
    print(f"wrote {out} ({out.stat().st_size / 1024 / 1024:.2f} MiB, {total_nodes} nodes)")
    print(json.dumps(meta["models"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
