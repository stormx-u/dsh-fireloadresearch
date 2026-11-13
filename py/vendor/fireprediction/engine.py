"""内置的 Fireprediction 推理引擎（纯 numpy + onnxruntime，无 sklearn/joblib）。

这个模块把原工具 B（`D:\\Fireprediction`）的两个已训练模型搬进插件：

* 重量：ResNet34 图像编码器（ONNX）+ 两个 HistGBR 融合头（已由
  `scripts/convert_weight_model.py` 从 fusion.joblib 转成 numpy 数组）；
* 体积：ConvNeXt 通用模型（ONNX），柜子实验版另需一个小路由逻辑回归
  与一个 head（ONNX）。

推理结果与 `FirepredictionCLI.exe predict` 的 JSON 字段保持一致，因此
`physical.load_fireprediction()` 可以直接读取我们写出的结果文件。

依赖：numpy、onnxruntime、Pillow（插件运行时都已具备）。
"""

from __future__ import annotations

import hashlib
import json
import math
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

CATEGORIES = (
    "柜子", "桌子", "床", "架子", "椅子", "沙发", "长凳", "凳子",
    "扶手椅", "躺椅", "家具套装", "配件及寝具",
)
VOLUME_PROFILES = {"general": "通用最佳模型", "cabinet_experimental": "柜子实验版"}
VOLUME_DEFINITION = "外壳包裹体积（含封闭内部空腔）/轴对齐包围盒体积"
UNIT_TO_CM = {"mm": 0.1, "cm": 1.0, "m": 100.0}
MAX_IMAGE_BYTES = 30 * 1024 * 1024
_LEAF = 255
_MEAN = np.asarray([0.485, 0.456, 0.406], dtype=np.float32)[:, None, None]
_STD = np.asarray([0.229, 0.224, 0.225], dtype=np.float32)[:, None, None]

MODELS_DIR = Path(__file__).resolve().parent / "models"
WEIGHT_ARTIFACT = "weight_fusion.npz"
IMAGE_ENCODER = "image_encoder.onnx"
VOLUME_GENERAL = "general.onnx"
CABINET_HEAD = "cabinet_head.onnx"
CABINET_ROUTER = "cabinet_router.npz"
CABINET_THRESHOLD = 0.65


class EngineUnavailable(RuntimeError):
    """模型文件缺失或依赖不可用。"""


def is_available(models_dir: Path | None = None) -> bool:
    root = Path(models_dir or MODELS_DIR)
    required = (WEIGHT_ARTIFACT, IMAGE_ENCODER, VOLUME_GENERAL, CABINET_HEAD, CABINET_ROUTER)
    try:
        return all((root / name).is_file() and (root / name).stat().st_size > 0 for name in required)
    except OSError:
        return False


def _normalized_batch(image: Image.Image) -> np.ndarray:
    array = np.asarray(image, dtype=np.uint8).transpose(2, 0, 1).copy()
    normalized = (array.astype(np.float32) / np.float32(255.0) - _MEAN) / _STD
    return np.ascontiguousarray(normalized[None, ...], dtype=np.float32)


def _cabinet_crop(image: Image.Image) -> Image.Image:
    """复刻柜子实验版的自动白边裁剪。"""
    result = image.convert("RGB")
    result.thumbnail((1600, 1600))
    pixels = np.asarray(result)
    height, width = pixels.shape[:2]
    edge = max(1, min(height, width) // 20)
    corners = np.concatenate(
        [
            pixels[:edge, :edge].reshape(-1, 3),
            pixels[:edge, -edge:].reshape(-1, 3),
            pixels[-edge:, :edge].reshape(-1, 3),
            pixels[-edge:, -edge:].reshape(-1, 3),
        ]
    )
    if np.percentile(corners, 10) > 235:
        ys, xs = np.where(np.min(pixels, axis=2) < 235)
        if len(xs) > 100:
            low = np.asarray([xs.min(), ys.min()])
            high = np.asarray([xs.max() + 1, ys.max() + 1])
            padding = np.maximum(3, (high - low) * 0.05).astype(int)
            low = np.maximum(0, low - padding)
            high = np.minimum([width, height], high + padding)
            if np.prod(high - low) > width * height * 0.06:
                result = result.crop(tuple(int(value) for value in (*low, *high)))
    return result


def _weight_tensor(rgb: Image.Image) -> np.ndarray:
    return _normalized_batch(rgb.resize((192, 192), resample=Image.Resampling.BILINEAR))


def _volume_tensor(rgb: Image.Image, crop: bool = False) -> np.ndarray:
    base = _cabinet_crop(rgb) if crop else rgb
    resized = ImageOps.contain(base, (208, 208), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (224, 224), "white")
    canvas.paste(resized, ((224 - resized.width) // 2, (224 - resized.height) // 2))
    return _normalized_batch(canvas)


def _base_features(width, height, depth) -> np.ndarray:
    width = np.asarray(width, dtype=np.float64)
    height = np.asarray(height, dtype=np.float64)
    depth = np.asarray(depth, dtype=np.float64)
    volume = width * height * depth / 1000.0
    surface = 2.0 * (width * height + width * depth + height * depth) / 10000.0
    maximum = np.maximum(np.maximum(width, height), depth)
    minimum = np.minimum(np.minimum(width, height), depth)
    middle = np.median(np.column_stack([width, height, depth]), axis=1)
    return np.column_stack(
        [
            width, height, depth, maximum, minimum, middle,
            np.log(width), np.log(height), np.log(depth), np.log(volume),
            np.log1p(surface), np.log(maximum / minimum), np.log(width / depth),
            np.log(height / maximum), np.log(width * depth / 1000.0),
            np.log(width * height / 1000.0), np.log(height * depth / 1000.0),
            np.log(maximum / middle),
        ]
    ).astype(np.float32)


class FirepredictionEngine:
    """同时提供重量与体积比例的本地推理；线程安全（惰性加载）。"""

    def __init__(self, models_dir: Path | str | None = None, cpu_threads: int = 4) -> None:
        self.root = Path(models_dir or MODELS_DIR)
        self.cpu_threads = max(1, min(32, int(cpu_threads or 4)))
        self._lock = threading.RLock()
        self._artifact: dict | None = None
        self._meta: dict = {}
        self._binning: dict | None = None
        self._encoder = None
        self._general = None
        self._cabinet_head = None
        self._router: dict | None = None

    # ------------------------------------------------------------------ models
    def _session(self, name: str, input_name: str, input_shape: tuple, output_names: tuple):
        try:
            import onnxruntime as ort
        except ImportError as exc:  # pragma: no cover - 运行时已装
            raise EngineUnavailable("缺少 onnxruntime，无法运行内置 Fireprediction 模型。") from exc
        path = self.root / name
        if not path.is_file():
            raise EngineUnavailable(f"内置模型缺失：{name}")
        options = ort.SessionOptions()
        options.intra_op_num_threads = self.cpu_threads
        options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        session = ort.InferenceSession(
            str(path), sess_options=options, providers=["CPUExecutionProvider"]
        )
        inputs = session.get_inputs()
        if len(inputs) != 1 or inputs[0].name != input_name:
            raise EngineUnavailable(f"ONNX 输入接口不匹配：{name}")
        if inputs[0].type != "tensor(float)" or len(inputs[0].shape) != len(input_shape):
            raise EngineUnavailable(f"ONNX 输入类型或维数不匹配：{name}")
        for dimension, required in zip(inputs[0].shape, input_shape):
            if required is not None and dimension != required:
                raise EngineUnavailable(f"ONNX 输入尺寸不匹配：{name}")
        if {item.name for item in session.get_outputs()} != set(output_names):
            raise EngineUnavailable(f"ONNX 输出接口不匹配：{name}")
        return session

    def _ensure_loaded(self) -> None:
        with self._lock:
            if self._artifact is not None and self._encoder is not None:
                return
            artifact_path = self.root / WEIGHT_ARTIFACT
            if not artifact_path.is_file():
                raise EngineUnavailable(f"内置模型缺失：{WEIGHT_ARTIFACT}")
            data = np.load(artifact_path, allow_pickle=False)
            artifact: dict = {key: data[key] for key in data.files}
            self._meta = json.loads(str(artifact.pop("meta")))
            self._artifact = artifact
            self._binning = {
                key[len("bin_"):]: value
                for key, value in artifact.items()
                if key.startswith("bin_")
            }
            self._encoder = self._session(IMAGE_ENCODER, "image", (None, 3, 192, 192), ("embedding",))
            self._general = self._session(
                VOLUME_GENERAL, "image", (None, 3, 224, 224), ("ratio", "features")
            )

    def _ensure_cabinet(self) -> None:
        with self._lock:
            if self._cabinet_head is not None and self._router is not None:
                return
            router_path = self.root / CABINET_ROUTER
            if not router_path.is_file():
                raise EngineUnavailable(f"内置模型缺失：{CABINET_ROUTER}")
            with np.load(router_path, allow_pickle=False) as data:
                router = {
                    "mean": np.asarray(data["mean"], dtype=np.float64).reshape(-1),
                    "scale": np.asarray(data["scale"], dtype=np.float64).reshape(-1),
                    "coef": np.asarray(data["coef"], dtype=np.float64).reshape(-1),
                    "intercept": float(np.asarray(data["intercept"]).reshape(-1)[0]),
                }
            if any(value.shape != (1536,) for key, value in router.items() if key != "intercept"):
                raise EngineUnavailable("柜子路由器参数维数无效。")
            self._cabinet_head = self._session(
                CABINET_HEAD, "features", (None, 1536), ("ratio",)
            )
            self._router = router

    # ----------------------------------------------------------------- helpers
    def _bin_matrix(self, matrix: np.ndarray) -> np.ndarray:
        assert self._binning is not None
        binning = self._binning
        x = np.asarray(matrix, dtype=np.float64)
        out = np.zeros((x.shape[0], int(binning["n_features"])), dtype=np.int64)
        offsets = binning["edges_offsets"]
        cat_feature = int(binning["cat_feature"])
        cat_values = np.asarray(binning["cat_values"], dtype=np.float64)
        edges = np.asarray(binning["edges"], dtype=np.float64)
        for feature in range(int(binning["n_features"])):
            if feature == cat_feature:
                out[:, feature] = np.searchsorted(cat_values, x[:, feature], side="left")
            else:
                start = int(offsets[feature])
                stop = int(offsets[feature + 1])
                out[:, feature] = np.searchsorted(edges[start:stop], x[:, feature], side="left")
        return out.astype(np.uint8)

    def _hist_tree_one(self, model_index: int, bins: np.ndarray) -> float:
        """Fast path for a single sample: walk each tree with plain integers.

        The vectorised version below allocates ~40 numpy temporaries per tree,
        which costs several seconds across 6000 trees; scalar walking is
        byte-identical but ~30x faster."""
        assert self._artifact is not None
        prefix = f"m{model_index}_"
        feature = self._artifact[prefix + "feature"]
        bin_threshold = self._artifact[prefix + "bin"]
        left_delta = self._artifact[prefix + "left_delta"]
        right_delta = self._artifact[prefix + "right_delta"]
        value = self._artifact[prefix + "value"]
        offsets = self._artifact[prefix + "offsets"]
        cat_node = self._artifact[prefix + "cat_node"]
        cat_mask = self._artifact[prefix + "cat_mask"]
        total = float(self._artifact[prefix + "baseline"][0])
        row_of = {}
        for row, node in enumerate(np.asarray(cat_node).tolist()):
            row_of[int(node)] = row
        masks = np.asarray(cat_mask).tolist()
        cat_bin = int(bins[0])
        feat_list = feature.tolist()
        thr_list = bin_threshold.tolist()
        ldelta_list = left_delta.tolist()
        rdelta_list = right_delta.tolist()
        value_list = value.tolist()
        offset_list = offsets.tolist()
        bin_list = bins.tolist()
        n_trees = len(offset_list) - 1
        for tree in range(n_trees):
            node = offset_list[tree]
            while True:
                f = feat_list[node]
                if f == _LEAF:
                    break
                row = row_of.get(node)
                if row is None:
                    go_left = bin_list[f] <= thr_list[node]
                else:
                    go_left = (masks[row] >> cat_bin) & 1
                node = node + (ldelta_list[node] if go_left else rdelta_list[node])
            total += value_list[node]
        return total

    def _hist_tree(self, model_index: int, binned: np.ndarray) -> np.ndarray:
        assert self._artifact is not None
        prefix = f"m{model_index}_"
        feature = self._artifact[prefix + "feature"]
        bin_threshold = self._artifact[prefix + "bin"]
        left_delta = self._artifact[prefix + "left_delta"]
        right_delta = self._artifact[prefix + "right_delta"]
        value = self._artifact[prefix + "value"]
        offsets = self._artifact[prefix + "offsets"]
        cat_node = self._artifact[prefix + "cat_node"]
        cat_mask = self._artifact[prefix + "cat_mask"]
        baseline = float(self._artifact[prefix + "baseline"][0])
        n_samples = binned.shape[0]
        out = np.full(n_samples, baseline, dtype=np.float64)
        cat_row = np.full(feature.shape[0], -1, dtype=np.int32)
        if cat_node.size:
            cat_row[cat_node] = np.arange(cat_node.size, dtype=np.int32)
        for tree in range(len(offsets) - 1):
            start = int(offsets[tree])
            stop = int(offsets[tree + 1])
            node = np.full(n_samples, start, dtype=np.int64)
            while True:
                feat_all = feature[node]
                pending = np.nonzero(feat_all != _LEAF)[0]
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
                node[pending] = np.clip(node_ids + delta, start, stop - 1)
            out += value[node]
        return out

    def _make_matrix(self, width_cm, height_cm, depth_cm, type_id: int) -> np.ndarray:
        assert self._artifact is not None
        base = _base_features([width_cm], [height_cm], [depth_cm])
        medians = {
            key: np.asarray(self._artifact[f"medians_{key}"], dtype=np.float64)
            for key in ("W", "H", "D", "V")
        }
        width = np.asarray([width_cm], dtype=np.float64)
        height = np.asarray([height_cm], dtype=np.float64)
        depth = np.asarray([depth_cm], dtype=np.float64)
        volume = width * height * depth / 1000.0
        index = int(type_id)
        norm = np.column_stack(
            [
                np.log(width / medians["W"][index]),
                np.log(height / medians["H"][index]),
                np.log(depth / medians["D"][index]),
                np.log(volume / medians["V"][index]),
            ]
        ).astype(np.float32)
        encoded = np.asarray([index], dtype=np.int16)
        return np.column_stack([encoded, base, norm]).astype(np.float32)

    @staticmethod
    def _ratio(value) -> float:
        raw = np.asarray(value)
        if raw.size != 1:
            raise EngineUnavailable("体积模型返回的比例维数无效。")
        ratio = float(raw.reshape(-1)[0])
        if not math.isfinite(ratio) or not 0 <= ratio <= 1:
            raise EngineUnavailable("体积模型返回了超出 0–1 的无效比例。")
        return ratio

    # ----------------------------------------------------------------- predict
    def predict(
        self,
        image_path: str | Path,
        category: str,
        width: float,
        height: float,
        depth: float,
        unit: str = "cm",
        volume_profile: str = "general",
    ) -> dict:
        started = datetime.now(timezone.utc)
        if category not in CATEGORIES:
            raise EngineUnavailable(f"不支持的家具类别：{category}")
        factor = UNIT_TO_CM.get(str(unit).lower())
        if factor is None:
            raise EngineUnavailable(f"不支持的长度单位：{unit}")
        if volume_profile not in VOLUME_PROFILES:
            raise EngineUnavailable(f"不支持的体积模型：{volume_profile}")
        if volume_profile == "cabinet_experimental" and category != "柜子":
            raise EngineUnavailable("柜子实验版仅适用于柜子。")
        path = Path(image_path).expanduser()
        if not path.is_file():
            raise EngineUnavailable(f"找不到图片：{path}")
        content = path.read_bytes()
        if not content:
            raise EngineUnavailable("图片文件为空。")
        if len(content) > MAX_IMAGE_BYTES:
            raise EngineUnavailable("图片超过 30 MiB，请先压缩。")
        sha256 = hashlib.sha256(content).hexdigest()
        import io

        with Image.open(io.BytesIO(content)) as source:
            source.load()
            width_px, height_px = source.size
            corrected = ImageOps.exif_transpose(source)
            has_alpha = "A" in corrected.getbands()
            if has_alpha:
                background = Image.new("RGBA", corrected.size, "white")
                background.alpha_composite(corrected.convert("RGBA"))
                rgb = background.convert("RGB")
            else:
                rgb = corrected.convert("RGB")

        width_cm = float(width) * factor
        height_cm = float(height) * factor
        depth_cm = float(depth) * factor

        self._ensure_loaded()
        assert self._artifact is not None
        weight_tensor = _weight_tensor(rgb)
        embedding = np.asarray(self._encoder.run(["embedding"], {"image": weight_tensor})[0])
        if embedding.shape != (1, 512) or not np.isfinite(embedding).all():
            raise EngineUnavailable("重量图像模型返回了无效特征。")
        hd_w = np.asarray(self._artifact["hd_w"], dtype=np.float64).reshape(-1)
        hd_b = np.asarray(self._artifact["hd_b"], dtype=np.float64).reshape(-1)
        log_image = embedding @ hd_w + hd_b
        if log_image.size != 1 or not np.isfinite(log_image).all():
            raise EngineUnavailable("重量图像分量不是有效有限数值。")
        type_id = list(self._meta["types"]).index(category)
        features = self._make_matrix(width_cm, height_cm, depth_cm, type_id)
        matrix = np.column_stack([features, log_image]).astype(np.float32)
        if matrix.shape != (1, 24) or not np.isfinite(matrix).all():
            raise EngineUnavailable("尺寸无法生成有效重量特征。")
        binned = self._bin_matrix(matrix)
        if binned.shape[0] == 1:
            row = binned[0]
            log_predictions = np.array(
                [[self._hist_tree_one(0, row)], [self._hist_tree_one(1, row)]], dtype=np.float64
            )
        else:
            log_predictions = np.vstack([self._hist_tree(0, binned), self._hist_tree(1, binned)])
        predicted_kg = float(np.exp(log_predictions.mean(axis=0)).reshape(-1)[0])
        image_kg = float(np.exp(log_image).reshape(-1)[0])
        if not (math.isfinite(predicted_kg) and predicted_kg > 0 and math.isfinite(image_kg) and image_kg > 0):
            raise EngineUnavailable("重量模型返回了无效结果。")

        general_ratio, general_features = self._volume(rgb)
        cabinet_probability = None
        used_specialist = False
        ratio = general_ratio
        model_id = "volume_convnext_general"
        if volume_profile == "cabinet_experimental":
            self._ensure_cabinet()
            assert self._router is not None
            router = self._router
            logit = float(
                ((general_features - router["mean"]) / router["scale"]) @ router["coef"]
                + router["intercept"]
            )
            clipped = float(np.clip(logit, -80, 80))
            cabinet_probability = 1.0 / (1.0 + math.exp(-clipped))
            used_specialist = cabinet_probability >= CABINET_THRESHOLD
            if used_specialist:
                cropped_ratio, cropped_features = self._volume(rgb, crop=True)
                head_ratio = np.asarray(
                    self._cabinet_head.run(
                        ["ratio"], {"features": cropped_features.reshape(1, -1).astype(np.float32)}
                    )[0]
                )
                ratio = self._ratio(head_ratio)
            model_id = "volume_convnext_cabinet_experimental"

        bbox_m3 = (width_cm * height_cm * depth_cm) / 1_000_000.0
        volume_m3 = ratio * bbox_m3
        elapsed_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        return {
            "schema_version": "1.0",
            "prediction_id": str(uuid.uuid4()),
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "category": category,
            "dimensions": {
                "width": float(width),
                "height": float(height),
                "depth": float(depth),
                "unit": str(unit).lower(),
                "width_height_depth_cm": [width_cm, height_cm, depth_cm],
            },
            "image": {
                "path": str(path.resolve()),
                "sha256": sha256,
                "width_px": int(width_px),
                "height_px": int(height_px),
            },
            "mass": {
                "estimated_kg": predicted_kg,
                "image_component_kg": image_kg,
                "model_id": "weight_fusion_v3",
            },
            "volume": {
                "estimated_m3": volume_m3,
                "bbox_m3": bbox_m3,
                "ratio": ratio,
                "ratio_percent": ratio * 100.0,
                "model_id": model_id,
                "profile": volume_profile,
                "definition": VOLUME_DEFINITION,
                "cabinet_probability": cabinet_probability,
                "used_cabinet_specialist": used_specialist,
            },
            "elapsed_ms": elapsed_ms,
            "notices": ["由插件内置模型推理（Fireprediction weight_fusion_v3 + volume_convnext_general）"],
            "extensions": {"engine": "builtin-fireprediction", "weights": WEIGHT_ARTIFACT},
        }

    def _volume(self, rgb: Image.Image, crop: bool = False) -> tuple[float, np.ndarray]:
        self._ensure_loaded()
        assert self._general is not None
        outputs = self._general.run(
            ["ratio", "features"], {"image": _volume_tensor(rgb, crop=crop)}
        )
        features = np.asarray(outputs[1], dtype=np.float64)
        if features.shape != (1, 1536) or not np.isfinite(features).all():
            raise EngineUnavailable("体积模型返回了无效图像特征。")
        return self._ratio(outputs[0]), features.reshape(-1)

    # ---------------------------------------------------------------- metadata
    def info(self) -> dict:
        self._ensure_loaded()
        return {
            "engine": "builtin-fireprediction",
            "models_dir": str(self.root),
            "weight_model": self._meta.get("name", ""),
            "weight_version": self._meta.get("version", ""),
            "types": self._meta.get("types", []),
            "trees_per_model": [item.get("trees") for item in self._meta.get("models", [])],
            "volume_profiles": dict(VOLUME_PROFILES),
            "categories": list(CATEGORIES),
        }
