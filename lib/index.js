/**
 * Furniture fire-load workbench — host half.
 *
 * Wires one HTTP carrier under /api/furniture-fireload that drives
 * py/bridge.py (the merged fire-load pipeline) and relays the composition
 * decision through the DSH model service so the panel can switch the
 * "jev-type" judgement between the original OpenRouter decider, a free vision
 * model, and a DeepSeek model (host channel or direct API).
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runSelfCheck, reportPath } from "./diag.js";

export const name = "furniture-fireload";
export const inject = ["webServer"];
export const meta = {
  name: "furniture-fireload",
  description: "家具材质细化 + 火灾荷载工作台（Fireprediction 重量/体积 + 本机分割 + JEV/DeepSeek 判定）",
};

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.dirname(LIB_DIR);
const BRIDGE = path.join(PLUGIN_DIR, "py", "bridge.py");
const CLIENT_BUNDLE = path.join(LIB_DIR, "client.js");
const PREFIX = "/api/furniture-fireload";

const DATA_DIR =
  process.env.FURNITURE_FIRELOAD_DATA ||
  path.join(process.env.LOCALAPPDATA || process.env.APPDATA || os.tmpdir(), "dsh-furniture-fireload");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const JOBS_DIR = path.join(DATA_DIR, "jobs");
const ACTIVATE_FILE = path.join(DATA_DIR, "activate.json");
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_BODY = 64 * 1024 * 1024;

/* The material-analysis modules are bundled with the plugin (py/vendor/material),
 * so no external tool directory is required anymore. */
const VENDOR_MATERIAL_DIR = path.join(PLUGIN_DIR, "py", "vendor", "material");
const VENDOR_FIREPREDICTION_DIR = path.join(PLUGIN_DIR, "py", "vendor", "fireprediction");
const DEFAULT_TOOL_A =
  "C:\\Users\\Administrator\\Documents\\Codex\\2026-11-06\\https-github-com-zhouyc98-fire-load\\outputs\\furniture-material-tool";
/* Fireprediction is an optional extra (~460MB of models); when it is missing the
 * run falls back to the vision model estimate. */
const DEFAULT_TOOL_B = "D:\\Fireprediction";
const PYTHON_CANDIDATES = [
  "C:\\Users\\Administrator\\Documents\\Codex\\2026-11-06\\https-github-com-zhouyc98-fire-load\\work\\venv\\Scripts\\python.exe",
  "C:\\Users\\Administrator\\Documents\\Codex\\2026-11-06\\https-github-com-zhouyc98-fire-load\\work\\python\\cpython-3.12.16-windows-x86_64-none\\python.exe",
  "D:\\DSH1\\DSH Desktop\\resources\\office-runtime\\primary-runtime\\dependencies\\python\\python.exe",
];
const CATEGORIES = ["柜子", "桌子", "床", "架子", "椅子", "沙发", "长凳", "凳子", "扶手椅", "躺椅", "家具套装", "配件及寝具"];
const VOLUME_KINDS = [
  { id: "envelope", label: "包裹体积（含空腔）" },
  { id: "material_volume", label: "材料占据体积（与密度口径一致）" },
];

const DEFAULT_SETTINGS = {
  /* "" means: use the bundled material modules (py/vendor/material). */
  toolA: "",
  /* "" means: auto-detect Fireprediction; when it is not installed the run falls
   * back to the vision model estimate of mass/volume. */
  toolB: "",
  pythonPath: "",
  device: "auto",
  useFireprediction: true,
  decider: {
    provider: "deepseek",
    channel: "host",
    model: "",
    providerId: "",
    vision: "auto",
    apiKey: "",
    baseUrl: "https://api.deepseek.com",
    jevModel: "perplexity/pplx-decider-v1.2",
  },
  review: {
    provider: "auto",
    model: "nvidia/nemotron-3.5-super-vl:free",
    apiKey: "",
    customModelId: "",
  },
  segmentation: { engine: "yolo", conf: 0.25, metalConf: 0.2, metalEnabled: true },
  llmEstimate: {
    enabled: false,
    role: "extra",
    model: "",
    customModelId: "",
  },
  /* User-defined OpenAI-compatible endpoints. Every model-selecting step can list
   * these by name, so the same key/model does not have to be retyped per run. */
  customModels: [],
};

/* ------------------------------------------------------------------ utils */

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDeep(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value && typeof value === "object" && !Array.isArray(value) && base && typeof base[key] === "object" && !Array.isArray(base[key])) {
      out[key] = mergeDeep(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function normalizeSettings(settings) {
  const next = settings && typeof settings === "object" ? settings : {};
  const decider = next.decider || (next.decider = {});
  // Settings written by the older panel could hold a leftover non-free model id on
  // the free-vision branch, which aborted the run with a ":free" validation error.
  // Treat that pair as damaged and fall back to the DeepSeek host route.
  if (String(decider.provider || "") === "free-vision" && decider.model && !/:free$/i.test(String(decider.model))) {
    decider.provider = "deepseek";
    decider.channel = "host";
    decider.model = "";
    decider.vision = decider.vision || "auto";
  }
  if (!decider.vision) decider.vision = "auto";
  next.customModels = normalizeCustomModels(next.customModels);
  return next;
}

/* A model library entry: an OpenAI-compatible endpoint the user saved once and can
 * then pick by name in every step that needs a model. */
function normalizeCustomModel(raw, index) {
  const item = raw && typeof raw === "object" ? raw : {};
  const model = String(item.model || "").trim();
  const label = String(item.label || "").trim() || model || `模型 ${index + 1}`;
  const baseUrl = String(item.baseUrl || "").trim();
  const apiKey = String(item.apiKey || "").trim();
  const vision = Boolean(item.vision);
  const id = String(item.id || "").trim() || `m${index + 1}-${Math.abs(hashString(label + model + baseUrl)).toString(36).slice(0, 6)}`;
  return { id, label, baseUrl, model, apiKey, vision };
}

function normalizeCustomModels(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  raw.forEach((entry, index) => {
    const item = normalizeCustomModel(entry, index);
    if (!item.model) return; // a row without a model name is not usable yet
    let id = item.id;
    let suffix = 2;
    while (seen.has(id)) id = `${item.id}-${suffix++}`;
    seen.add(id);
    out.push({ ...item, id });
  });
  return out.slice(0, 20);
}

function hashString(text) {
  let hash = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

function customModelList(settings) {
  return normalizeCustomModels(settings && settings.customModels);
}

function findCustomModel(settings, id) {
  const wanted = String(id || "").trim();
  if (!wanted) return null;
  return customModelList(settings).find((item) => item.id === wanted) || null;
}

/* Turn a library entry into the route shape askSegmentation/runLlmEstimate accept. */
function customModelRoute(item) {
  if (!item) return null;
  return {
    channel: "api",
    providerId: "",
    model: item.model,
    baseUrl: item.baseUrl,
    apiKey: item.apiKey,
    vision: Boolean(item.vision),
    label: item.label,
  };
}

function readSettings() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    stored = {};
  }
  const settings = mergeDeep(clone(DEFAULT_SETTINGS), stored || {});
  return normalizeSettings(settings);
}

function writeSettings(next) {
  ensureDir(DATA_DIR);
  const settings = normalizeSettings(mergeDeep(clone(DEFAULT_SETTINGS), next || {}));
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  const body = Buffer.from(String(text), "utf8");
  res.writeHead(status, { "content-type": type, "content-length": String(body.length), "cache-control": "no-store" });
  res.end(body);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function resolvePython(settings) {
  const explicit = String(settings.pythonPath || "").trim() || String(process.env.FURNITURE_FIRELOAD_PYTHON || "").trim();
  if (explicit) return { file: explicit, source: "settings" };
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) return { file: candidate, source: "auto" };
    } catch {
      /* ignore */
    }
  }
  return { file: "python", source: "path" };
}

function exists(target) {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function fileInfo(file) {
  try {
    const stat = fs.statSync(file);
    return { path: file, exists: stat.isFile(), size: stat.size, modifiedAt: stat.mtimeMs };
  } catch {
    return { path: file, exists: false, size: 0, modifiedAt: 0 };
  }
}

/* The material-analysis code ships with the plugin. A configured directory still
 * wins when it really contains the modules, so power users can point at a newer
 * external copy. */
function materialToolDir(settings) {
  const configured = String((settings && settings.toolA) || "").trim();
  if (configured && exists(path.join(configured, "auto_workflow.py"))) {
    return { path: configured, builtin: false };
  }
  return { path: VENDOR_MATERIAL_DIR, builtin: true };
}

/* Fireprediction ships with the plugin as a pure-numpy/onnxruntime engine; the
 * external CLI folder stays supported as an optional override. */
function builtinFirepredictionAvailable() {
  try {
    return (
      fs.existsSync(path.join(VENDOR_FIREPREDICTION_DIR, "engine.py")) &&
      fs.existsSync(path.join(VENDOR_FIREPREDICTION_DIR, "models", "weight_fusion.npz")) &&
      fs.existsSync(path.join(VENDOR_FIREPREDICTION_DIR, "models", "general.onnx"))
    );
  } catch {
    return false;
  }
}

/* "builtin" | "external" | "none" */
function firepredictionEngine(settings) {
  if (String(process.env.FURNITURE_FIRELOAD_NO_FIREPREDICTION || "") === "1") return "none";
  if (builtinFirepredictionAvailable()) return "builtin";
  return firepredictionToolDir(settings) ? "external" : "none";
}

/* Fireprediction is optional: it needs ~460MB of model files that are not bundled.
 * Returning "" means "not available" and the run falls back to the vision estimate. */
function firepredictionToolDir(settings) {
  const configured = String((settings && settings.toolB) || "").trim();
  const candidates = [];
  if (configured) candidates.push(configured);
  candidates.push(DEFAULT_TOOL_B);
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(path.join(candidate, "FirepredictionCLI.exe"))) return candidate;
    } catch {
      /* ignore */
    }
  }
  return "";
}

/* ------------------------------------------------------------------- jobs */

const jobs = new Map();
const jobOrder = [];
let activeJobId = null;

function jobSummary(job) {
  return {
    id: job.id,
    state: job.state,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    elapsedMs: Number(job.finishedAt || Date.now()) - job.createdAt,
    imageName: job.input && job.input.imageName,
    category: job.input && job.input.category,
    segmentationEngine: (job.input && job.input.segmentationEngine) || "yolo",
    headline: job.headline || "",
    error: job.error || null,
  };
}

function pushEvent(job, event) {
  job.events.push({ at: Date.now(), ...event });
  if (job.events.length > 600) job.events.splice(0, job.events.length - 600);
  job.updatedAt = Date.now();
}

function artifactsFor(job) {
  const names = [];
  for (const name of job.artifactNames || []) {
    const file = path.join(job.outputDir, name);
    if (exists(file)) names.push(name);
  }
  return names;
}

function finishJob(job, state, extra = {}) {
  job.state = state;
  job.finishedAt = Date.now();
  job.updatedAt = Date.now();
  Object.assign(job, extra);
  if (activeJobId === job.id) activeJobId = null;
  try {
    fs.writeFileSync(
      path.join(job.outputDir, "job.json"),
      JSON.stringify({ id: job.id, state: job.state, input: job.input, error: job.error, events: job.events.slice(-120) }, null, 2),
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

function killTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

function stripFences(text) {
  let body = String(text || "").trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) body = body.slice(start, end + 1);
  return body;
}

function normalizeAnswers(raw, questions) {
  const list = Array.isArray(questions) ? questions : [];
  let parsed;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (error) {
    throw new Error(`模型输出不是合法 JSON：${error.message}`);
  }
  if (parsed && typeof parsed === "object") {
    if (parsed.answers && typeof parsed.answers === "object") parsed = parsed.answers;
    else if (parsed.decisions && typeof parsed.decisions === "object") parsed = parsed.decisions;
  }
  if (!parsed || typeof parsed !== "object") throw new Error("模型输出缺少 answers 对象");
  const answers = {};
  for (const question of list) {
    const id = String(question && question.id ? question.id : "");
    if (!id) continue;
    const criteria = (question && question.criteria) || {};
    const names = Object.keys(criteria);
    if (names.length === 0) continue;
    const fallback = names.includes("unknown") ? "unknown" : names[0];
    const entry = parsed[id];
    if (!entry || typeof entry !== "object") {
      answers[id] = { choice: fallback, probabilities: Object.fromEntries(names.map((n) => [n, n === fallback ? 1 : 0])) };
      continue;
    }
    const probabilities = {};
    for (const n of names) {
      const value = Number(entry.probabilities && entry.probabilities[n]);
      probabilities[n] = Number.isFinite(value) && value >= 0 ? value : 0;
    }
    if (!Object.values(probabilities).some((v) => v > 0)) probabilities[fallback] = 1;
    let choice = typeof entry.choice === "string" && names.includes(entry.choice) ? entry.choice : null;
    const best = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
    if (!choice || probabilities[choice] < best[1]) choice = best[0];
    const total = Object.values(probabilities).reduce((sum, v) => sum + v, 0) || 1;
    for (const n of names) probabilities[n] = probabilities[n] / total;
    answers[id] = { choice, probabilities };
  }
  return answers;
}

async function resolveDefaultModel(llm, providerId, modelId) {
  const result = { provider: providerId, model: modelId };
  try {
    if (typeof llm.listProviders !== "function") return result;
    const providers = (await Promise.resolve(llm.listProviders())) || [];
    const entries = Array.isArray(providers) ? providers : providers.providers || [];
    const usable = entries.filter((entry) => entry && (entry.id || entry.provider));
    if (!result.provider) {
      const preferred = usable.find((entry) => /deepseek/i.test(String(entry.id || entry.provider))) || usable[0];
      if (preferred) result.provider = String(preferred.id || preferred.provider);
    }
    if (result.provider && !result.model) {
      const entry = usable.find((item) => String(item.id || item.provider) === result.provider);
      let models = entry && entry.models;
      if (!Array.isArray(models) && typeof llm.listModels === "function") {
        models = await Promise.resolve(llm.listModels(result.provider));
      }
      const first = Array.isArray(models) ? models.find((model) => model && (model.id || model.name)) : null;
      if (first) result.model = String(first.id || first.name);
    }
  } catch {
    /* 模型目录不可用时交给 llm 自己决定 */
  }
  return result;
}

async function listProviderModels(llm, providerId) {
  if (!llm || typeof llm.listModels !== "function" || !providerId) return [];
  try {
    const models = await Promise.resolve(llm.listModels(providerId));
    return Array.isArray(models) ? models : [];
  } catch {
    return [];
  }
}

function modelModalities(model) {
  const info = model || {};
  const list = info.inputModalities || info.modalities;
  return Array.isArray(list) ? list.map((value) => String(value)) : null;
}

function modelTakesImages(model) {
  const list = modelModalities(model);
  return Boolean(list && list.includes("image"));
}

/** true/false when the model catalog is readable, null when it cannot be probed. */
async function routeTakesImages(llm, providerId, modelId) {
  if (!providerId) return null;
  const models = await listProviderModels(llm, providerId);
  const wanted = String(modelId || "");
  const hit = models.find(
    (model) => String((model && (model.id || model.model || model.name)) || "") === wanted
  );
  if (!hit) return null;
  const list = modelModalities(hit);
  return list ? list.includes("image") : null;
}

/**
 * Pick a route that advertises the image modality. DeepSeek itself is text-only,
 * so the vision capable twin is the modlens-bridged provider (its model label
 * carries "(modlens vision)"): frames travel as image blocks, modlens turns them
 * into textual evidence and the DeepSeek model then answers the question.
 */
async function resolveVisionRoute(llm, providerId, modelId) {
  try {
    if (!llm || typeof llm.listProviders !== "function") return null;
    const providers = (await Promise.resolve(llm.listProviders())) || [];
    const entries = Array.isArray(providers) ? providers : providers.providers || [];
    const candidates = [];
    for (const entry of entries) {
      const pid = String((entry && (entry.id || entry.provider || entry.name)) || "").trim();
      if (!pid) continue;
      let models = entry && entry.models;
      if (!Array.isArray(models)) models = await listProviderModels(llm, pid);
      for (const model of Array.isArray(models) ? models : []) {
        const mid = String((model && (model.id || model.model || model.name)) || "").trim();
        if (!mid || !modelTakesImages(model)) continue;
        const label = String((model && (model.label || model.name)) || mid);
        candidates.push({
          provider: pid,
          model: mid,
          label,
          bridged: /modlens/i.test(pid) || /modlens/i.test(label),
        });
      }
    }
    if (!candidates.length) return null;
    if (modelId) {
      const sameModel = candidates.find((candidate) => candidate.model === modelId);
      if (sameModel) return sameModel;
    }
    if (providerId) {
      const sameProvider = candidates.find((candidate) => candidate.provider === providerId);
      if (sameProvider) return sameProvider;
    }
    return candidates.find((candidate) => candidate.bridged) || candidates[0];
  } catch {
    return null;
  }
}

async function readImageAttachments(ctx, files, job) {
  const attachments = ctx.get("attachments");
  if (!attachments || typeof attachments.saveImage !== "function") return [];
  const refs = [];
  for (const file of files.slice(0, 4)) {
    const filePath = String((file && file.path) || "").trim();
    if (!filePath || !exists(filePath)) continue;
    try {
      const data = await fs.promises.readFile(filePath);
      const ref = await attachments.saveImage({
        data,
        mediaType: String((file && file.mediaType) || "image/jpeg"),
        name: String((file && file.name) || path.basename(filePath)),
      });
      if (ref) refs.push(ref);
    } catch (error) {
      if (job) {
        pushEvent(job, {
          stage: "decision",
          level: "warn",
          message: `图片附带失败（${path.basename(filePath)}）：${error && error.message ? error.message : error}`,
        });
      }
    }
  }
  return refs;
}

function describeStream(exchange) {
  const parts = [];
  if (exchange && exchange.finish) parts.push(`finish=${exchange.finish}`);
  if (exchange && exchange.reasoning) parts.push(`推理 ${exchange.reasoning.length} 字`);
  if (exchange && exchange.usage) {
    const output = Number(exchange.usage.outputTokens) || 0;
    const reasoning = Number(exchange.usage.reasoningTokens) || 0;
    parts.push(`输出 ${output} tokens${reasoning ? `（其中推理 ${reasoning}）` : ""}`);
  }
  return parts.join("，");
}

async function streamDecision(llm, options) {
  const controller = new AbortController();
  const guard = setTimeout(() => controller.abort(), 180000);
  let text = "";
  let reasoning = "";
  let finish = "";
  let usage = null;
  try {
    for await (const chunk of llm.stream({ ...options, signal: controller.signal })) {
      if (!chunk) continue;
      if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
      // Reasoning models may spend the whole token budget on thinking before any
      // text arrives; keep the reasoning transcript so a failure can be explained.
      if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") reasoning += chunk.text;
      if (chunk.type === "usage" && chunk.usage) usage = chunk.usage;
      if (chunk.type === "finish" && chunk.reason) finish = String(chunk.reason.kind || "");
      if (chunk.type === "error" && chunk.error) throw new Error(String(chunk.error.message || chunk.error));
    }
  } finally {
    clearTimeout(guard);
  }
  return { text, reasoning, finish, usage };
}

async function pickReasoningEffort(llm, provider, model) {
  if (!provider || !model || !llm || typeof llm.resolveModelInfo !== "function") return undefined;
  try {
    const info = await llm.resolveModelInfo(provider, model);
    const efforts = (info && info.reasoning && info.reasoning.efforts) || [];
    if (!efforts.length) return undefined;
    const light =
      efforts.find((item) => item && /minimal|none|off|low|^1$|轻|低/i.test(String(item.id))) || efforts[0];
    return light && light.id ? light.id : undefined;
  } catch {
    return undefined;
  }
}

async function relayDecision(ctx, job, message) {
  const payload = (message && message.payload) || {};
  const settings = readSettings();
  const llm = ctx.get("llm");
  if (!llm || typeof llm.stream !== "function") {
    throw new Error("当前会话没有可用的模型服务；请在设置里改用 DeepSeek API 直连，或选择本地判定。");
  }
  const jobDecider = (job && job.request && job.request.decider) || {};
  let providerId = String(payload.providerId || jobDecider.providerId || settings.decider.providerId || "").trim();
  let modelId = String(payload.requestedModel || jobDecider.model || settings.decider.model || "").trim();
  if (!providerId || !modelId) {
    // 任务里没写具体提供方/模型时，按当前会话的模型目录挑一个（优先 deepseek）。
    const resolved = await resolveDefaultModel(llm, providerId, modelId);
    providerId = providerId || resolved.provider;
    modelId = modelId || resolved.model;
  }

  const imageFiles = Array.isArray(payload.images) ? payload.images.filter((file) => file && file.path) : [];
  const visionMode = String(jobDecider.vision || settings.decider.vision || "auto").toLowerCase();
  const notes = [];
  let imageRefs = [];
  if (imageFiles.length && visionMode !== "off") {
    const takesImages = await routeTakesImages(llm, providerId, modelId);
    // Vision-bridged routes (…-modlens) may not publish their modalities in the
    // catalog, so the name itself counts as evidence that images are accepted.
    const bridgedName = /modlens/i.test(providerId) || /modlens/i.test(modelId);
    if (takesImages === true || (takesImages === null && bridgedName)) {
      imageRefs = await readImageAttachments(ctx, imageFiles, job);
    } else {
      const visionRoute = await resolveVisionRoute(llm, providerId, modelId);
      const switched =
        visionRoute && (visionRoute.provider !== providerId || visionRoute.model !== modelId);
      if (switched) {
        providerId = visionRoute.provider;
        modelId = visionRoute.model;
        imageRefs = await readImageAttachments(ctx, imageFiles, job);
        if (imageRefs.length) {
          pushEvent(job, {
            stage: "decision",
            level: "info",
            message: `所选模型不接收图片，已自动改用视觉通道 ${providerId}/${modelId}（modlens 视觉桥）。`,
          });
          notes.push(`说明：为附带图片证据，本次判定已自动改用视觉通道 ${providerId} / ${modelId}。`);
        }
      }
    }
  }
  if (imageFiles.length && !imageRefs.length) {
    notes.push("说明：本次判定只使用文本证据（所选模型不支持图片输入，或图片未能附带）。");
  }

  const system = String(payload.system || "你是家具材料构造判定助手，只输出 JSON。");
  const prompt = String(payload.prompt || "");
  const textOnlyNote = imageRefs.length ? "" : notes.length ? "\n\n" + notes.join("\n") : "";
  const content = [{ type: "text", text: prompt + textOnlyNote }];
  for (const ref of imageRefs) content.push({ type: "image", attachment: ref });

  const options = {
    system,
    messages: [{ role: "user", content }],
    temperature: 0.2,
    maxTokens: 1600,
  };
  if (providerId) options.provider = providerId;
  if (modelId) options.model = modelId;
  const reasoningEffort = await pickReasoningEffort(llm, providerId, modelId);
  if (reasoningEffort) options.reasoningEffort = reasoningEffort;

  let exchange;
  try {
    exchange = await streamDecision(llm, options);
  } catch (error) {
    if (!imageRefs.length) throw error;
    pushEvent(job, {
      stage: "decision",
      level: "warn",
      message: `带图判定失败（${error && error.message ? error.message : error}），改为纯文本重试。`,
    });
    options.messages = [
      { role: "user", content: [{ type: "text", text: prompt + "\n\n说明：带图请求失败，本次仅使用文本证据。" }] },
    ];
    exchange = await streamDecision(llm, options);
    imageRefs = [];
  }
  let text = exchange.text;
  if (!text.trim()) {
    // Reasoning models can burn the whole budget on thinking; retry with a larger cap.
    pushEvent(job, {
      stage: "decision",
      level: "warn",
      message: `判定没有输出文本（${describeStream(exchange) || "无输出块"}），提高输出预算重试。`,
    });
    options.maxTokens = 4000;
    const retryContent = [{ type: "text", text: prompt + (imageRefs.length ? "" : textOnlyNote) }];
    for (const ref of imageRefs) retryContent.push({ type: "image", attachment: ref });
    options.messages = [{ role: "user", content: retryContent }];
    exchange = await streamDecision(llm, options);
    text = exchange.text;
  }
  if (!text.trim()) throw new Error(`宿主模型没有返回内容（${describeStream(exchange) || "无输出块"}）`);
  const answers = normalizeAnswers(text, payload.questions);
  const routeLabel = `${providerId ? providerId + "/" : ""}${modelId || "默认"}`;
  const imageNote = imageRefs.length ? `，随请求附带 ${imageRefs.length} 张图片` : "";
  pushEvent(job, {
    stage: "decision",
    level: "info",
    message: `判定完成（${Object.keys(answers).length} 个问题，模型 ${routeLabel}${imageNote}）。`,
  });
  return {
    answers,
    model: routeLabel,
    images: imageRefs.length,
    vision: imageRefs.length > 0,
    raw: text.slice(0, 4000),
  };
}

/* ------------------------------------------------------- llm direct estimate */

const LLM_ESTIMATE_SYSTEM = "你是家具质量与火灾荷载估计助手。只输出一个 JSON 对象，不要输出解释或 Markdown 代码块。";

function mediaTypeFor(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

/* ----------------------------------------------------- external chat completions */
// The host model service is optional: a user may also point this plugin at any
// OpenAI-compatible endpoint (DeepSeek, OpenRouter, a local llama.cpp server...)
// with their own base URL + key. These helpers implement that channel so the
// batch panel and the estimate/segmentation steps can pick either route.

const API_CHAT_TIMEOUT_MS = 180000;
const API_MAX_IMAGES = 4;

function normalizeChatEndpoint(baseUrl) {
  const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("请填写 API 地址（例如 https://api.deepseek.com 或 https://openrouter.ai/api/v1）。");
  if (!/^https?:\/\//i.test(raw)) throw new Error(`API 地址要以 http:// 或 https:// 开头：${raw}`);
  if (/\/chat\/completions$/i.test(raw)) return raw;
  return `${raw}/chat/completions`;
}

function apiImageDataUrl(filePath) {
  const file = String(filePath || "").trim();
  if (!file || !exists(file)) throw new Error(`找不到要发送的图片：${file}`);
  const data = fs.readFileSync(file);
  return `data:${mediaTypeFor(file)};base64,${data.toString("base64")}`;
}

function apiFailureText(status, body) {
  const snippet = String(body || "").replace(/\s+/g, " ").slice(0, 240);
  if (status === 401 || status === 403) return `API 密钥无效或没有权限（HTTP ${status}）。${snippet}`;
  if (status === 402) return `API 账户余额不足（HTTP 402）。${snippet}`;
  if (status === 429) return `API 触发频率或额度限制（HTTP 429）。${snippet}`;
  if (status === 400 || status === 422) return `API 拒绝了这次请求（HTTP ${status}），模型名或图片字段可能不被支持。${snippet}`;
  return `API 请求失败（HTTP ${status}）。${snippet}`;
}

async function callChatApi({ baseUrl, apiKey, model, system, prompt, imagePaths, maxTokens, temperature }) {
  const endpoint = normalizeChatEndpoint(baseUrl);
  const modelId = String(model || "").trim();
  if (!modelId) throw new Error("请填写要调用的模型名（例如 deepseek-chat、openai/gpt-4o-mini）。");
  const content = [{ type: "text", text: String(prompt || "") }];
  for (const file of (imagePaths || []).slice(0, API_MAX_IMAGES)) {
    content.push({ type: "image_url", image_url: { url: apiImageDataUrl(file) } });
  }
  const messages = [];
  if (system) messages.push({ role: "system", content: String(system) });
  messages.push({ role: "user", content });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_CHAT_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${String(apiKey || "").trim()}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: Number.isFinite(temperature) ? temperature : 0.1,
        max_tokens: Math.max(200, Number(maxTokens) || 1200),
      }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(apiFailureText(response.status, bodyText));
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch (error) {
      throw new Error(`API 返回的不是 JSON：${String(bodyText).slice(0, 200)}`);
    }
    const choice = (payload.choices || [])[0] || {};
    const message = choice.message || payload.message || {};
    let text = message.content;
    if (Array.isArray(text)) text = text.map((part) => (typeof part === "string" ? part : (part && part.text) || "")).join("");
    return { text: String(text || ""), finish: String(choice.finish_reason || ""), usage: payload.usage || null };
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("API 请求超时（180 秒没有响应）。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}


function buildEstimatePrompt(request) {
  const dims = request.dimensions || {};
  const unit = String(dims.unit || "cm");
  const hasDims = Number(dims.width) > 0 && Number(dims.height) > 0 && Number(dims.depth) > 0;
  const lines = [
    "请根据这张家具照片（以及给出的已知信息），直接估计这件家具的质量与火灾荷载。",
    "家具类别：" + (String(request.category || "").trim() || "未指定"),
  ];
  if (hasDims) {
    lines.push(`外包围盒尺寸：宽 ${dims.width} × 高 ${dims.height} × 深 ${dims.depth} ${unit}（若与照片观感冲突，以照片为准并在 notes 说明）。`);
  } else {
    lines.push("外包围盒尺寸：未提供，请按照片中的比例自行估计。");
  }
  lines.push("体积口径：外壳包裹体积（含封闭内部空腔，单位 m³）。");
  lines.push("只输出 JSON，字段如下：");
  lines.push('{"mass_kg": 数值, "volume_m3": 数值, "materials": [{"name": "材质中文名", "share": 0~1}], "heat_value_mj_kg": 数值, "fire_load_mj": 数值, "confidence": 0~1, "notes": "一句话说明依据与不确定点"}');
  lines.push("要求：materials 的 share 合计约为 1；heat_value_mj_kg 为质量加权平均低位热值；fire_load_mj = mass_kg × heat_value_mj_kg。");
  return lines.join("\n");
}

function parseEstimate(text) {
  let raw = String(text || "").trim();
  if (raw.startsWith("```")) raw = raw.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型输出里没有 JSON 对象");
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    throw new Error("模型输出的 JSON 无法解析：" + error.message);
  }
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const massKg = num(parsed.mass_kg != null ? parsed.mass_kg : parsed.massKg != null ? parsed.massKg : parsed.mass);
  const volumeM3 = num(parsed.volume_m3 != null ? parsed.volume_m3 : parsed.volumeM3 != null ? parsed.volumeM3 : parsed.volume);
  const heatValueMjKg = num(parsed.heat_value_mj_kg != null ? parsed.heat_value_mj_kg : parsed.heatValueMjKg != null ? parsed.heatValueMjKg : parsed.heat_value);
  const fireLoadMj = num(parsed.fire_load_mj != null ? parsed.fire_load_mj : parsed.fireLoadMj != null ? parsed.fireLoadMj : parsed.fire_load);
  const confidence = Number(parsed.confidence);
  const materials = [];
  for (const item of Array.isArray(parsed.materials) ? parsed.materials : []) {
    if (!item || typeof item !== "object") continue;
    const name = String(item.name || item.material || "").trim();
    const share = Number(item.share != null ? item.share : item.fraction);
    if (!name || !Number.isFinite(share) || share <= 0) continue;
    materials.push({ name, share });
  }
  const sum = materials.reduce((total, item) => total + item.share, 0);
  if (sum > 0) for (const item of materials) item.share = item.share / sum;
  materials.sort((a, b) => b.share - a.share);
  if (!massKg && !volumeM3 && materials.length === 0) throw new Error("模型没有给出可用的估计数值");
  return {
    massKg,
    volumeM3,
    heatValueMjKg,
    fireLoadMj,
    materials: materials.slice(0, 12),
    materialCount: materials.length,
    confidence: Number.isFinite(confidence) ? confidence : null,
    notes: String(parsed.notes || "").trim(),
    raw: raw.slice(0, 2000),
  };
}

async function estimateViaApi(cfg, request, job) {
  const model = String(cfg.model || "").trim();
  pushEvent(job, {
    stage: "llm-estimate",
    level: "info",
    message: `估计请求：外部 API ${model}（${String(cfg.baseUrl || "").trim()}），附带图片 1 张。`,
  });
  const attempts = [];
  const attempt = async ({ withImages, maxTokens, strict }) => {
    const prompt = strict
      ? `${buildEstimatePrompt(request)}\n\n严格：不要输出任何解释、思考或推理过程，第一行就直接输出 JSON。`
      : buildEstimatePrompt(request);
    const outcome = await callChatApi({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model,
      system: LLM_ESTIMATE_SYSTEM,
      prompt,
      imagePaths: withImages ? [request.imagePath] : [],
      maxTokens,
      temperature: 0.1,
    });
    attempts.push({
      withImages: withImages && Boolean(request.imagePath),
      maxTokens,
      strict,
      chars: outcome.text.length,
      finish: outcome.finish,
      usage: outcome.usage || null,
    });
    return { text: outcome.text, reasoning: "", finish: outcome.finish, usage: outcome.usage };
  };

  let exchange;
  try {
    exchange = await attempt({ withImages: true, maxTokens: 1200, strict: false });
  } catch (error) {
    pushEvent(job, {
      stage: "llm-estimate",
      level: "warn",
      message: `带图估计失败（${error && error.message ? error.message : error}），改为纯文本估计。`,
    });
    exchange = await attempt({ withImages: false, maxTokens: 1200, strict: false });
  }
  let text = exchange.text;
  if (!text.trim()) {
    pushEvent(job, {
      stage: "llm-estimate",
      level: "warn",
      message: "估计没有输出文本，提高输出预算重试。",
    });
    exchange = await attempt({ withImages: true, maxTokens: 4000, strict: true });
    text = exchange.text;
  }
  if (!text.trim()) {
    exchange = await attempt({ withImages: false, maxTokens: 4000, strict: true });
    text = exchange.text;
  }
  if (!text.trim()) throw new Error("外部 API 没有返回内容。");
  let estimate;
  try {
    estimate = parseEstimate(text);
  } catch (error) {
    pushEvent(job, {
      stage: "llm-estimate",
      level: "warn",
      message: `估计输出不是可解析的 JSON（${error && error.message ? error.message : error}），重试一次。`,
    });
    estimate = parseEstimate((await attempt({ withImages: true, maxTokens: 4000, strict: true })).text);
  }
  estimate.model = model;
  estimate.channel = "api";
  estimate.images = 1;
  estimate.vision = true;
  estimate.attempts = attempts;
  estimate.reasoningEffort = null;
  estimate.at = Date.now();
  return estimate;
}

async function runLlmEstimate(ctx, job, request) {
  const cfg = request.llmEstimate || {};
  if (cfg.customModelId) {
    const item = findCustomModel(readSettings(), cfg.customModelId);
    if (!item) throw new Error(`找不到自定义模型（${cfg.customModelId}），请重新在「自定义模型」里选择。`);
    return estimateViaApi(customModelRoute(item), request, job);
  }
  if (String(cfg.channel || "host") === "api") return estimateViaApi(cfg, request, job);
  const llm = ctx.get("llm");
  if (!llm || typeof llm.stream !== "function") throw new Error("当前会话没有可用的模型服务，无法做 LLM 直接估计。");
  const settings = readSettings();
  let providerId = String(cfg.providerId || settings.decider.providerId || "").trim();
  let modelId = String(cfg.model || settings.decider.model || "").trim();
  if (!providerId || !modelId) {
    const resolved = await resolveDefaultModel(llm, providerId, modelId);
    providerId = providerId || resolved.provider;
    modelId = modelId || resolved.model;
  }
  const takesImages = await routeTakesImages(llm, providerId, modelId);
  const bridged = /modlens/i.test(providerId) || /modlens/i.test(modelId);
  let imageRefs = [];
  let route = { provider: providerId, model: modelId };
  if (takesImages === true || (takesImages === null && bridged)) {
    imageRefs = await readImageAttachments(ctx, [{ path: request.imagePath, mediaType: mediaTypeFor(request.imagePath) }], job);
  } else {
    const visionRoute = await resolveVisionRoute(llm, providerId, modelId);
    if (visionRoute) {
      route = { provider: visionRoute.provider, model: visionRoute.model };
      imageRefs = await readImageAttachments(ctx, [{ path: request.imagePath, mediaType: mediaTypeFor(request.imagePath) }], job);
      if (imageRefs.length) {
        pushEvent(job, {
          stage: "llm-estimate",
          level: "info",
          message: `LLM 直接估计已改用视觉通道 ${route.provider}/${route.model}。`,
        });
      }
    }
  }
  const reasoningEffort = await pickReasoningEffort(llm, route.provider, route.model);
  pushEvent(job, {
    stage: "llm-estimate",
    level: "info",
    message: `估计请求：模型 ${(route.provider ? route.provider + "/" : "") + (route.model || "默认")}，附带图片 ${imageRefs.length} 张${
      reasoningEffort ? `，推理强度 ${reasoningEffort}` : ""
    }。`,
  });
  const attempts = [];
  const attempt = async ({ withImages, maxTokens, strict }) => {
    const prompt = strict
      ? buildEstimatePrompt(request) + "\n\n严格：不要输出任何解释、思考或推理过程，第一行就直接输出 JSON。"
      : buildEstimatePrompt(request);
    const content = [{ type: "text", text: prompt }];
    if (withImages) for (const ref of imageRefs) content.push({ type: "image", attachment: ref });
    const options = { system: LLM_ESTIMATE_SYSTEM, messages: [{ role: "user", content }], temperature: 0.1, maxTokens };
    if (route.provider) options.provider = route.provider;
    if (route.model) options.model = route.model;
    if (reasoningEffort) options.reasoningEffort = reasoningEffort;
    let exchange;
    try {
      exchange = await streamDecision(llm, options);
    } catch (error) {
      attempts.push({
        withImages: withImages && imageRefs.length > 0,
        maxTokens,
        strict,
        error: String(error && error.message ? error.message : error),
      });
      throw error;
    }
    attempts.push({
      withImages: withImages && imageRefs.length > 0,
      maxTokens,
      strict,
      chars: exchange.text.length,
      reasoningChars: exchange.reasoning.length,
      finish: exchange.finish,
      usage: exchange.usage || null,
    });
    return exchange;
  };

  let exchange;
  try {
    exchange = await attempt({ withImages: imageRefs.length > 0, maxTokens: 1200, strict: false });
  } catch (error) {
    if (!imageRefs.length) throw error;
    pushEvent(job, {
      stage: "llm-estimate",
      level: "warn",
      message: `带图估计失败（${error && error.message ? error.message : error}），改为纯文本估计。`,
    });
    imageRefs = [];
    exchange = await attempt({ withImages: false, maxTokens: 1200, strict: false });
  }
  let text = exchange.text;
  if (!text.trim()) {
    // A reasoning model may spend the entire maxTokens budget on its thinking
    // phase and then stream no text at all: retry with a bigger budget and an
    // explicit "no reasoning, JSON only" instruction.
    pushEvent(job, {
      stage: "llm-estimate",
      level: "warn",
      message: `估计没有输出文本（${describeStream(exchange) || "无输出块"}），提高输出预算重试。`,
    });
    exchange = await attempt({ withImages: imageRefs.length > 0, maxTokens: 4000, strict: true });
    text = exchange.text;
  }
  if (!text.trim() && imageRefs.length) {
    // Some vision bridges answer nothing when handed images by an automated
    // caller; a text-only retry at least yields an order-of-magnitude estimate.
    pushEvent(job, {
      stage: "llm-estimate",
      level: "warn",
      message: `仍然没有文本输出（${describeStream(exchange) || "无输出块"}），改为纯文本估计。`,
    });
    imageRefs = [];
    exchange = await attempt({ withImages: false, maxTokens: 4000, strict: true });
    text = exchange.text;
  }
  if (!text.trim()) throw new Error(`宿主模型没有返回内容（${describeStream(exchange) || "无输出块"}）`);
  let estimate;
  try {
    estimate = parseEstimate(text);
  } catch (error) {
    pushEvent(job, {
      stage: "llm-estimate",
      level: "warn",
      message: `估计输出不是可解析的 JSON（${error && error.message ? error.message : error}），重试一次。`,
    });
    exchange = await attempt({ withImages: imageRefs.length > 0, maxTokens: 4000, strict: true });
    estimate = parseEstimate(exchange.text);
  }
  estimate.model = (route.provider ? route.provider + "/" : "") + (route.model || "默认");
  estimate.images = imageRefs.length;
  estimate.vision = imageRefs.length > 0;
  estimate.attempts = attempts;
  estimate.reasoningEffort = reasoningEffort || null;
  estimate.at = Date.now();
  return estimate;
}

async function applyLlmEstimate(ctx, job, request) {
  const cfg = request.llmEstimate || {};
  if (!cfg.enabled) return;
  pushEvent(job, {
    stage: "llm-estimate",
    level: "info",
    message:
      cfg.role === "primary"
        ? "先用 LLM 直接从图片估计重量与火灾荷载（作为物理量输入）…"
        : "先用 LLM 直接从图片估计重量与火灾荷载（作为额外对照）…",
  });
  let estimate;
  try {
    estimate = await runLlmEstimate(ctx, job, request);
  } catch (error) {
    const text = String(error && error.message ? error.message : error);
    job.llmEstimate = { error: text };
    pushEvent(job, { stage: "llm-estimate", level: "warn", message: `LLM 直接估计失败：${text}；继续按原流程运行。` });
    return;
  }
  job.llmEstimate = estimate;
  const massText = estimate.massKg ? `${estimate.massKg.toFixed(2)} kg` : "未给出";
  const heatText = estimate.fireLoadMj ? `${estimate.fireLoadMj.toFixed(1)} MJ` : "未给出";
  pushEvent(job, {
    stage: "llm-estimate",
    level: "info",
    message: `LLM 直接估计完成：质量 ${massText}，火灾荷载 ${heatText}（模型 ${estimate.model}，附带图片 ${estimate.images} 张）。`,
  });
  if (cfg.role !== "primary") return;
  const hasManual = Number(request.massKg) > 0 && Number(request.volumeM3) > 0;
  if (hasManual) {
    pushEvent(job, { stage: "llm-estimate", level: "info", message: "已手工填写质量与体积，LLM 估计仅作对照，不覆盖物理量输入。" });
    return;
  }
  if (!estimate.massKg || !estimate.volumeM3) {
    pushEvent(job, { stage: "llm-estimate", level: "warn", message: "LLM 没有给出可用的质量/体积，保留原有物理量来源。" });
    return;
  }
  request.massKg = estimate.massKg;
  request.volumeM3 = estimate.volumeM3;
  request.volumeKind = "envelope";
  request.physicalSource = "llm-estimate";
  request.useFireprediction = false;
  pushEvent(job, {
    stage: "llm-estimate",
    level: "info",
    message: `已把 LLM 估计的 ${estimate.massKg.toFixed(2)} kg / ${estimate.volumeM3.toFixed(4)} m³ 作为物理量输入（来源 llm-estimate），本次跳过 Fireprediction。`,
  });
}

/* ------------------------------------------------------- llm segmentation */

const LLM_SEGMENT_SYSTEM =
  "你是家具图像分析助手。只服从本次任务说明，只输出一个 JSON 对象，不要输出解释或 Markdown 代码块。";

// The local YOLO model knows exactly these five broad classes; keep the vision
// model's answer inside the same set so every downstream table stays comparable.
const SEGMENT_BROAD_IDS = ["fabric", "wood", "plastic", "glass", "metal"];
const SEGMENT_BROAD_LABELS = { fabric: "织物", wood: "木材", plastic: "塑料", glass: "玻璃", metal: "金属" };
const SEGMENT_BROAD_ALIASES = {
  fabric: ["fabric", "textile", "upholstery", "织物", "布艺", "布料", "面料", "纺织"],
  wood: ["wood", "timber", "木材", "木质", "木制", "实木", "板材", "板式"],
  plastic: ["plastic", "acrylic", "塑料", "亚克力", "树脂"],
  glass: ["glass", "玻璃"],
  metal: ["metal", "steel", "aluminium", "aluminum", "iron", "金属", "钢", "铁", "铝", "不锈钢"],
};

function broadFromName(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return "";
  if (SEGMENT_BROAD_IDS.includes(text)) return text;
  for (const id of SEGMENT_BROAD_IDS) {
    if (SEGMENT_BROAD_ALIASES[id].some((alias) => text === alias || text.includes(alias))) return id;
  }
  return "";
}

function buildSegmentPrompt(request) {
  const dims = request.dimensions || {};
  const box =
    dims.width && dims.height && dims.depth ? `${dims.width} × ${dims.height} × ${dims.depth} ${dims.unit || "cm"}` : "未提供";
  return [
    "任务：在一张家具照片里定位「这件家具」，并估计照片里能看见的各类材质面积占比。",
    `家具类别（可能为空，仅作参考，不要被它限制）：${request.furnitureType || request.category || "未提供"}`,
    `外包围盒尺寸：${box}`,
    "",
    "只输出下面这个 JSON（不要解释，不要代码块）：",
    '{"target":{"x0":0.05,"y0":0.10,"x1":0.95,"y1":0.92},',
    '"materials":[{"broad":"wood","share":0.55},{"broad":"fabric","share":0.30}],',
    '"furniture_type":"沙发","confidence":0.6,"notes":"一句话说明依据"}',
    "",
    "字段要求：",
    "1. target：照片里这件家具的包围框，坐标是相对整张图片的比例（0–1，左上角为原点），要求 x0<x1、y0<y1；整张照片就是这件家具时给 0,0,1,1。",
    "2. materials：broad 只在这 5 个大类里选：fabric（织物/布艺）、wood（木材/木质）、plastic（塑料）、glass（玻璃）、metal（金属）；share 是「照片里能看见的面积占比」，合计不超过 1，看不清的部分不要强行分配；同一大类不要重复出现。",
    "3. furniture_type：可选的中文家具类别，不确定就给空字符串。",
    "4. confidence：0–1 的把握程度；notes：不超过 60 字。",
    "注意：这是照片可见面积占比，不是质量占比；隐藏结构、内部填充和看不见的部件不要计入。",
  ].join("\n");
}

function segmentNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeSegmentBox(raw) {
  if (!raw) return null;
  let x0; let y0; let x1; let y1;
  if (Array.isArray(raw) && raw.length >= 4) {
    [x0, y0, x1, y1] = raw;
  } else if (typeof raw === "object") {
    if ("x0" in raw || "x1" in raw) {
      x0 = raw.x0; y0 = raw.y0; x1 = raw.x1; y1 = raw.y1;
    } else if ("x" in raw || "width" in raw) {
      const x = segmentNumber(raw.x); const y = segmentNumber(raw.y);
      const w = segmentNumber(raw.width != null ? raw.width : raw.w);
      const h = segmentNumber(raw.height != null ? raw.height : raw.h);
      if (x === null || y === null || w === null || h === null) return null;
      x0 = x; y0 = y; x1 = x + w; y1 = y + h;
    } else if ("left" in raw) {
      x0 = raw.left; y0 = raw.top; x1 = raw.right; y1 = raw.bottom;
    }
  }
  const values = [x0, y0, x1, y1].map(segmentNumber);
  if (values.some((value) => value === null)) return null;
  let [a, b, c, d] = values;
  if (a > c) [a, c] = [c, a];
  if (b > d) [b, d] = [d, b];
  // Anything above 1 looks like pixel coordinates; the host cannot know the image
  // size here, so such a box is dropped rather than silently mis-scaled.
  if ([a, b, c, d].some((value) => value > 1.0001)) return null;
  a = Math.min(Math.max(a, 0), 1); b = Math.min(Math.max(b, 0), 1);
  c = Math.min(Math.max(c, 0), 1); d = Math.min(Math.max(d, 0), 1);
  if (c - a < 0.02 || d - b < 0.02) return null;
  return { x0: a, y0: b, x1: c, y1: d };
}

function parseSegmentation(text) {
  const cleaned = String(text || "").replace(/```[a-zA-Z]*\n?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("输出里没有 JSON 对象");
  let data;
  try {
    data = JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    throw new Error(`输出不是合法 JSON（${error.message}）`);
  }
  if (!data || typeof data !== "object") throw new Error("输出 JSON 不是对象");
  const target = normalizeSegmentBox(data.target || data.box || data.bbox || null);
  const rows = Array.isArray(data.materials) ? data.materials : Array.isArray(data.visible_materials) ? data.visible_materials : [];
  const shares = new Map();
  const dropped = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const broad = broadFromName(row.broad != null ? row.broad : row.material != null ? row.material : row.name != null ? row.name : row.category);
    const share = segmentNumber(row.share != null ? row.share : row.ratio != null ? row.ratio : row.fraction != null ? row.fraction : row.area_share);
    if (!broad || share === null || share <= 0) {
      dropped.push(String(row.name || row.broad || row.material || row.category || "?"));
      continue;
    }
    shares.set(broad, (shares.get(broad) || 0) + share);
  }
  if (!shares.size) throw new Error("没有给出可用的材质面积占比");
  let total = 0;
  for (const value of shares.values()) total += value;
  const materials = Array.from(shares.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([broad, value]) => {
      const share = total > 1 ? value / total : value;
      return { broad, name: SEGMENT_BROAD_LABELS[broad], share: Math.round(share * 10000) / 10000 };
    });
  const confidence = segmentNumber(data.confidence);
  return {
    target,
    materials,
    dropped,
    furnitureType: String(data.furniture_type || data.furnitureType || "").trim(),
    confidence: confidence === null ? null : Math.min(Math.max(confidence, 0), 1),
    notes: String(data.notes || "").slice(0, 200),
    raw: cleaned.slice(0, 4000),
  };
}

async function askSegmentationViaApi(cfg, target, notify) {
  const model = String(cfg.model || "").trim();
  const prompt = buildSegmentPrompt({
    imagePath: target.imagePath,
    category: target.category,
    furnitureType: target.furnitureType,
    furnitureName: target.furnitureName,
    dimensions: target.dimensions,
  });
  const attempt = async (maxTokens, strict) => {
    const outcome = await callChatApi({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model,
      system: LLM_SEGMENT_SYSTEM,
      prompt: strict ? `${prompt}\n\n严格：不要输出任何解释、思考或推理过程，第一行就直接输出 JSON。` : prompt,
      imagePaths: [target.imagePath],
      maxTokens,
      temperature: 0.1,
    });
    return { text: outcome.text, reasoning: "", finish: outcome.finish, usage: outcome.usage };
  };
  notify({
    stage: "segmentation",
    level: "info",
    message: `视觉分割请求：外部 API ${model}（${String(cfg.baseUrl || "").trim()}），附带图片 1 张。`,
  });
  let exchange = await attempt(1200, false);
  if (!exchange.text.trim()) exchange = await attempt(4000, true);
  if (!exchange.text.trim()) throw new Error("外部 API 没有返回分割结果。");
  let parsed;
  try {
    parsed = parseSegmentation(exchange.text);
  } catch (error) {
    notify({ stage: "segmentation", level: "warn", message: `分割输出无法解析（${error.message}），重试一次。` });
    parsed = parseSegmentation((await attempt(4000, true)).text);
  }
  parsed.model = model;
  parsed.channel = "api";
  parsed.images = 1;
  return parsed;
}

async function askSegmentation(ctx, target, notify, cfgIn) {
  const settings = readSettings();
  const cfg = cfgIn || {};
  if (String(cfg.channel || "host") === "api") return askSegmentationViaApi(cfg, target, notify);
  const llm = ctx.get("llm");
  if (!llm || typeof llm.stream !== "function") throw new Error("当前会话没有可用的模型服务，无法做视觉分割。");
  let providerId = String(cfg.providerId || cfg.provider || settings.decider.providerId || "").trim();
  let modelId = String(cfg.model || settings.decider.model || "").trim();
  if (!providerId || !modelId) {
    const resolved = await resolveDefaultModel(llm, providerId, modelId);
    providerId = providerId || resolved.provider;
    modelId = modelId || resolved.model;
  }
  let route = { provider: providerId, model: modelId };
  const takesImages = await routeTakesImages(llm, providerId, modelId);
  const bridged = /modlens/i.test(providerId) || /modlens/i.test(modelId);
  if (!(takesImages === true || (takesImages === null && bridged))) {
    const visionRoute = await resolveVisionRoute(llm, providerId, modelId);
    if (visionRoute) {
      route = { provider: visionRoute.provider, model: visionRoute.model };
      notify({
        stage: "segmentation",
        level: "info",
        message: `所选模型不接收图片，视觉分割改用 ${route.provider}/${route.model}。`,
      });
    }
  }
  const imageRefs = await readImageAttachments(
    ctx,
    [{ path: target.imagePath, mediaType: mediaTypeFor(target.imagePath) }],
    null
  );
  if (!imageRefs.length) throw new Error("没能把图片交给模型（当前模型可能不支持图片输入）。");
  const reasoningEffort = await pickReasoningEffort(llm, route.provider, route.model);
  const prompt = buildSegmentPrompt({
    imagePath: target.imagePath,
    category: target.category,
    furnitureType: target.furnitureType,
    furnitureName: target.furnitureName,
    dimensions: target.dimensions,
  });
  const attempt = async (maxTokens, strict) => {
    const content = [{ type: "text", text: strict ? `${prompt}\n\n严格：不要输出任何解释、思考或推理过程，第一行就直接输出 JSON。` : prompt }];
    for (const ref of imageRefs) content.push({ type: "image", attachment: ref });
    const options = { system: LLM_SEGMENT_SYSTEM, messages: [{ role: "user", content }], temperature: 0.1, maxTokens };
    if (route.provider) options.provider = route.provider;
    if (route.model) options.model = route.model;
    if (reasoningEffort) options.reasoningEffort = reasoningEffort;
    return streamDecision(llm, options);
  };
  notify({
    stage: "segmentation",
    level: "info",
    message: `视觉分割请求：模型 ${(route.provider ? `${route.provider}/` : "") + (route.model || "默认")}，附带图片 ${imageRefs.length} 张${
      reasoningEffort ? `，推理强度 ${reasoningEffort}` : ""
    }。`,
  });
  let exchange = await attempt(1200, false);
  if (!exchange.text.trim()) {
    notify({
      stage: "segmentation",
      level: "warn",
      message: `视觉分割没有输出文本（${describeStream(exchange) || "无输出块"}），提高输出预算重试。`,
    });
    exchange = await attempt(4000, true);
  }
  if (!exchange.text.trim()) throw new Error(`模型没有返回分割结果（${describeStream(exchange) || "无输出块"}）`);
  let parsed;
  try {
    parsed = parseSegmentation(exchange.text);
  } catch (error) {
    notify({
      stage: "segmentation",
      level: "warn",
      message: `分割输出无法解析（${error.message}），重试一次。`,
    });
    exchange = await attempt(4000, true);
    parsed = parseSegmentation(exchange.text);
  }
  parsed.model = (route.provider ? `${route.provider}/` : "") + (route.model || "默认");
  parsed.images = imageRefs.length;
  parsed.vision = true;
  parsed.reasoningEffort = reasoningEffort || null;
  parsed.at = Date.now();
  return parsed;
}

async function runLlmSegmentation(ctx, job, request, cfg) {
  return askSegmentation(
    ctx,
    {
      imagePath: request.imagePath,
      category: request.category,
      furnitureType: request.furnitureType,
      furnitureName: request.furnitureName,
      dimensions: request.dimensions,
    },
    (event) => pushEvent(job, event),
    cfg || undefined
  );
}

async function applyLlmSegmentation(ctx, job, request) {
  const seg = request.segmentation || {};
  const engine = String(seg.engine || "yolo");
  if (engine === "yolo") return;
  let customRoute = null;
  if (engine === "custom") {
    const item = findCustomModel(readSettings(), seg.customModelId);
    if (!item) {
      const text = `找不到自定义模型（${seg.customModelId || "未选择"}），本次仍用本机 YOLO 分割。`;
      request.segmentation.engine = "yolo";
      job.llmSegmentation = { error: text };
      if (job.input) job.input.segmentationEngine = "yolo";
      pushEvent(job, { stage: "segmentation", level: "warn", message: text });
      return;
    }
    customRoute = customModelRoute(item);
  }
  pushEvent(job, {
    stage: "segmentation",
    level: "info",
    message:
      engine === "custom"
        ? `已关闭本机 YOLO：改用自定义模型 ${customRoute.label}（${customRoute.model}）判断目标框与可见材质面积占比…`
        : "已关闭本机 YOLO：先让视觉模型判断目标框与照片里可见的材质面积占比…",
  });
  let parsed;
  try {
    parsed = await runLlmSegmentation(ctx, job, request, customRoute);
  } catch (error) {
    const text = String(error && error.message ? error.message : error);
    request.segmentation.engine = "yolo";
    job.llmSegmentation = { error: text };
    if (job.input) job.input.segmentationEngine = "yolo";
    pushEvent(job, {
      stage: "segmentation",
      level: "warn",
      message: `视觉分割失败：${text}；已回退到本机 YOLO 分割继续运行。`,
    });
    return;
  }
  request.llmSegmentation = parsed;
  job.llmSegmentation = parsed;
  const shareText = parsed.materials.map((row) => `${row.name} ${(row.share * 100).toFixed(1)}%`).join("、");
  const boxText = parsed.target
    ? `目标框 x ${parsed.target.x0.toFixed(2)}–${parsed.target.x1.toFixed(2)}、y ${parsed.target.y0.toFixed(2)}–${parsed.target.y1.toFixed(2)}`
    : "未给出目标框（按整张图片处理）";
  pushEvent(job, {
    stage: "segmentation",
    level: "info",
    message: `视觉分割完成：${boxText}；可见材质面积占比 ${shareText}（模型 ${parsed.model}）。`,
  });
  if (parsed.furnitureType && !String(request.furnitureType || "").trim()) {
    request.furnitureType = parsed.furnitureType;
  }
}

/* ---------------------------------------------------------------- request */

function buildRequest(input, settings, python) {
  const imagePath = String(input.imagePath || "").trim();
  if (!imagePath) throw new Error("请先选择或上传一张家具图片。");
  if (!exists(imagePath)) throw new Error(`图片不存在：${imagePath}`);
  const category = String(input.category || "").trim();
  const dimensions = input.dimensions || {};
  const unit = ["mm", "cm", "m"].includes(String(dimensions.unit)) ? String(dimensions.unit) : "cm";
  const dims = {
    width: Number(dimensions.width) || 0,
    height: Number(dimensions.height) || 0,
    depth: Number(dimensions.depth) || 0,
    unit,
  };
  const decider = mergeDeep(clone(DEFAULT_SETTINGS.decider), input.decider || {});
  const review = mergeDeep(clone(DEFAULT_SETTINGS.review), input.review || {});
  const segmentation = mergeDeep(clone(DEFAULT_SETTINGS.segmentation), input.segmentation || {});
  const llmEstimate = mergeDeep(clone(DEFAULT_SETTINGS.llmEstimate), input.llmEstimate || {});
  const provider = String(decider.provider || "deepseek");
  const channel = String(decider.channel || "host");
  const reviewProvider = String(decider.reviewProvider || review.provider || "auto");
  const reviewModelValue = String(decider.reviewModel || review.model || "");
  const reviewApiKeyValue = String(decider.reviewApiKey || review.apiKey || "");
  const massKg = Number(input.massKg);
  const volumeM3 = Number(input.volumeM3);
  const jobId = String(input.jobId || randomUUID());
  const outputDir = path.join(JOBS_DIR, jobId);
  ensureDir(outputDir);
  const request = {
    jobId,
    protocol: 1,
    imagePath,
    furnitureName: String(input.furnitureName || "家具"),
    category,
    furnitureType: category,
    dimensions: dims,
    device: String(input.device || settings.device || "auto") === "cpu" ? "cpu" : "",
    useFireprediction: Boolean(input.useFireprediction),
    toolA: materialToolDir(settings).path,
    toolB: firepredictionToolDir(settings),
    physicalEngine: firepredictionEngine(settings),
    runtimeDir: DATA_DIR,
    outputDir,
    segmentation: {
      engine: ["llm", "custom"].includes(String(segmentation.engine || "yolo")) ? String(segmentation.engine) : "yolo",
      customModelId: String(segmentation.customModelId || ""),
      conf: Number(segmentation.conf) || 0.25,
      metalConf: Number(segmentation.metalConf) || 0.2,
      metalEnabled: Boolean(segmentation.metalEnabled),
    },
    decider: {
      provider,
      channel,
      model: String(decider.model || ""),
      providerId: String(decider.providerId || ""),
      vision: String(decider.vision || "auto"),
      apiKey: String(decider.apiKey || ""),
      baseUrl: String(decider.baseUrl || "https://api.deepseek.com"),
      jevModel: String(decider.jevModel || "perplexity/pplx-decider-v1.2"),
      customModelId: String(decider.customModelId || ""),
      openrouterApiKey: String(reviewApiKeyValue || process.env.OPENROUTER_API_KEY || ""),
      reviewProvider,
      reviewModel: reviewModelValue,
      reviewApiKey: reviewApiKeyValue,
      reviewCustomModelId: String(decider.reviewCustomModelId || review.customModelId || ""),
    },
    target: input.target && typeof input.target === "object" ? input.target : null,
    llmEstimate: {
      enabled: Boolean(llmEstimate.enabled),
      role: String(llmEstimate.role || "extra") === "primary" ? "primary" : "extra",
      model: String(llmEstimate.model || ""),
      providerId: String(llmEstimate.providerId || decider.providerId || ""),
      customModelId: String(llmEstimate.customModelId || ""),
    },
    python: python.file,
  };
  if (Number.isFinite(massKg) && massKg > 0) request.massKg = massKg;
  if (Number.isFinite(volumeM3) && volumeM3 > 0) request.volumeM3 = volumeM3;
  if (input.volumeKind) request.volumeKind = String(input.volumeKind);
  // A custom-model decider keeps its endpoint in the settings library; the key is
  // resolved here and only travels over stdin (single jobs never persist a request
  // file), so the saved settings stay the single place the secret lives.
  if (provider === "custom") {
    const item = findCustomModel(settings, decider.customModelId);
    if (item) {
      request.decider.customModelId = item.id;
      request.decider.customBaseUrl = item.baseUrl;
      request.decider.customApiKey = item.apiKey;
      request.decider.customModel = item.model;
      request.decider.customVision = Boolean(item.vision);
      request.decider.customLabel = item.label;
      request.decider.model = item.model;
    }
  }
  if (request.segmentation.engine === "custom") {
    const item = findCustomModel(settings, request.segmentation.customModelId);
    if (!item) {
      request.segmentation.engine = "yolo";
      request.segmentation.customModelId = "";
    }
  }
  if (request.llmEstimate.customModelId) {
    const item = findCustomModel(settings, request.llmEstimate.customModelId);
    if (!item) request.llmEstimate.customModelId = "";
  }
  // Review side: the visual fact-check can also run on a library model. Same rule
  // as the decider - the endpoint comes from settings, the key only travels on stdin.
  if (reviewProvider === "custom") {
    const item = findCustomModel(settings, String(decider.reviewCustomModelId || review.customModelId || ""));
    if (item) {
      request.decider.reviewProvider = "custom";
      request.decider.reviewCustomModelId = item.id;
      request.decider.reviewCustomBaseUrl = item.baseUrl;
      request.decider.reviewCustomApiKey = item.apiKey;
      request.decider.reviewCustomModel = item.model;
      request.decider.reviewCustomVision = Boolean(item.vision);
      request.decider.reviewCustomLabel = item.label;
      request.decider.reviewModel = item.model;
    } else {
      request.decider.reviewProvider = "auto";
      request.decider.reviewCustomModelId = "";
    }
  }
  return { jobId, outputDir, request };
}

function startJob(ctx, input) {
  const settings = readSettings();
  const python = resolvePython(settings);
  const built = buildRequest(input, settings, python);
  if (!exists(python.file) && !String(python.file).endsWith("python") && !String(python.file).endsWith("python.exe")) {
    throw new Error(`找不到可用的 Python 解释器：${python.file}`);
  }
  if (!exists(BRIDGE)) throw new Error(`插件缺少 py/bridge.py：${BRIDGE}`);
  const job = {
    id: built.jobId,
    state: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: 0,
    input: {
      imagePath: built.request.imagePath,
      imageName: path.basename(built.request.imagePath),
      category: built.request.category,
      dimensions: built.request.dimensions,
      useFireprediction: built.request.useFireprediction,
      segmentationEngine: built.request.segmentation.engine,
      decider: built.request.decider.provider,
      channel: built.request.decider.channel,
      model: built.request.decider.model || built.request.decider.providerId,
      reviewProvider: built.request.decider.reviewProvider,
      llmEstimate: built.request.llmEstimate.enabled
        ? `${built.request.llmEstimate.role}${built.request.llmEstimate.model ? " · " + built.request.llmEstimate.model : ""}`
        : "off",
    },
    request: built.request,
    outputDir: built.outputDir,
    events: [],
    llmEstimate: null,
    llmSegmentation: null,
    payload: null,
    error: null,
    headline: "",
    artifactNames: [],
    python: python.file,
    stderr: "",
  };
  jobs.set(job.id, job);
  jobOrder.unshift(job.id);
  if (jobOrder.length > 40) {
    const trimmed = jobOrder.splice(40);
    for (const id of trimmed) jobs.delete(id);
  }
  activeJobId = job.id;
  pushEvent(job, { stage: "queue", level: "info", message: `任务已排队（Python：${python.file}）。` });
  runJob(ctx, job).catch((error) => {
    pushEvent(job, { stage: "error", level: "error", message: String(error && error.message ? error.message : error) });
    finishJob(job, "failed", { error: String(error && error.message ? error.message : error) });
  });
  return job;
}

function activeJob() {
  return activeJobId ? jobs.get(activeJobId) : null;
}

/* Fireprediction ships with the plugin as a pure-numpy/onnxruntime engine; when
 * even that is unavailable there is no mass/volume, so the run switches to the
 * vision-model estimate instead of failing. */
function applyPhysicalFallback(ctx, job, request) {
  if (request.useFireprediction === false) return;
  if (String(request.physicalEngine || "") !== "none") return;
  request.useFireprediction = false;
  const hasManual =
    Number(request.massKg) > 0 && Number(request.volumeM3) > 0;
  const estimate = request.llmEstimate && typeof request.llmEstimate === "object" ? request.llmEstimate : {};
  if (!hasManual && !estimate.enabled) {
    request.llmEstimate = { ...estimate, enabled: true, role: "primary" };
    pushEvent(job, {
      stage: "physical",
      level: "warn",
      message:
        "未检测到 Fireprediction：本单不再调用它，改用视觉模型直接估计质量与体积（估计失败则只给材质结论）。",
    });
    return;
  }
  pushEvent(job, {
    stage: "physical",
    level: "warn",
    message: "未检测到 Fireprediction：本单不使用它的重量/体积预测。",
  });
}

async function runJob(ctx, job) {
  const request = job.request;
  applyPhysicalFallback(ctx, job, request);
  await applyLlmSegmentation(ctx, job, request);
  await applyLlmEstimate(ctx, job, request);
  let child;
  try {
    child = spawn(job.python, ["-u", BRIDGE], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", PYTHONUTF8: "1" },
      windowsHide: true,
      cwd: path.dirname(BRIDGE),
    });
  } catch (error) {
    throw new Error(`无法启动 Python：${error.message}`);
  }
  job.child = child;
  job.state = "running";
  job.updatedAt = Date.now();
  pushEvent(job, { stage: "start", level: "info", message: "Python 流程已启动。" });

  let stdoutBuffer = "";
  let finished = false;
  let stderrTail = "";

  const timer = setTimeout(() => {
    pushEvent(job, { stage: "timeout", level: "error", message: `任务超过 ${Math.round(JOB_TIMEOUT_MS / 60000)} 分钟，已终止。` });
    killTree(child);
  }, JOB_TIMEOUT_MS);
  job.timer = timer;

  const settle = (state, extra) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    finishJob(job, state, extra);
  };

  const handleMessage = async (message) => {
    if (!message || typeof message !== "object") return;
    switch (message.type) {
      case "meta":
        job.meta = message;
        pushEvent(job, {
          stage: "meta",
          level: "info",
          message: `Python ${message.python || ""}｜材质模块 ${path.basename(String(message.toolA || "")) || "内置"}｜Fireprediction ${
            String(message.physicalEngine || "") === "builtin"
              ? "内置模型"
              : message.toolB
                ? path.basename(String(message.toolB))
                : "未使用"
          }`,
        });
        return;
      case "progress":
        pushEvent(job, {
          stage: String(message.stage || "pipeline"),
          level: String(message.level || "info"),
          message: String(message.message || ""),
          detail: message.detail || null,
        });
        return;
      case "trace":
        if (process.env.DSH_FURNITURE_FIRELOAD_TRACE) {
          pushEvent(job, { stage: "trace", level: "debug", message: `${message.message} (+${message.elapsed}s)` });
        }
        return;
      case "decision": {
        pushEvent(job, {
          stage: "decision",
          level: "info",
          message: `请求模型判定（${(message.payload && message.payload.questionIds && message.payload.questionIds.length) || 0} 个问题，模型 ${(message.payload && message.payload.requestedModel) || "默认"}）。`,
        });
        let answer;
        try {
          const relayed = await relayDecision(ctx, job, message);
          answer = {
            type: "decision-answer",
            id: message.id,
            answers: relayed.answers,
            model: relayed.model,
            images: relayed.images || 0,
          };
        } catch (error) {
          const text = String(error && error.message ? error.message : error);
          pushEvent(job, { stage: "decision", level: "warn", message: `判定请求失败：${text}` });
          answer = { type: "decision-answer", id: message.id, error: text };
        }
        try {
          if (child.stdin && !child.stdin.destroyed) child.stdin.write(JSON.stringify(answer) + "\n");
        } catch {
          /* child已经退出 */
        }
        return;
      }
      case "result": {
        const payload = message.payload || {};
        job.payload = payload;
        job.artifactNames = Array.isArray(payload.artifacts) ? payload.artifacts.slice() : [];
        const heat = payload.fireLoad || {};
        job.headline =
          heat.totalHeatMj != null
            ? `单个家具火灾荷载 ≈ ${Number(heat.totalHeatMj).toFixed(1)} MJ`
            : "材料占比已给出，缺质量或体积，暂无法计算火灾荷载";
        pushEvent(job, { stage: "finished", level: "info", message: job.headline });
        return;
      }
      case "error": {
        const text = String(message.message || "未知错误");
        job.error = text;
        pushEvent(job, { stage: "error", level: "error", message: text, detail: message.traceback || null });
        return;
      }
      default:
        return;
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let index = stdoutBuffer.indexOf("\n");
    while (index >= 0) {
      const line = stdoutBuffer.slice(0, index).trim();
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          void handleMessage(message).catch((error) => {
            pushEvent(job, { stage: "error", level: "error", message: `处理子进程消息失败：${error.message}` });
          });
        } catch {
          pushEvent(job, { stage: "stdout", level: "debug", message: line.slice(0, 400) });
        }
      }
      index = stdoutBuffer.indexOf("\n");
    }
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-8000);
    job.stderr = stderrTail;
  });

  child.on("error", (error) => {
    pushEvent(job, { stage: "error", level: "error", message: `子进程错误：${error.message}` });
    settle("failed", { error: error.message });
  });

  child.on("close", (code) => {
    if (job.state === "cancelled") {
      settle("cancelled");
      return;
    }
    if (code === 0 && job.payload) {
      settle("succeeded");
      return;
    }
    const message = job.error || (stderrTail ? stderrTail.trim().split(/\r?\n/).slice(-6).join("\n") : `Python 退出码 ${code}`);
    pushEvent(job, { stage: "error", level: "error", message: `流程未完成：${message}` });
    settle("failed", { error: message });
  });

  try {
    child.stdin.write(JSON.stringify(request) + "\n");
  } catch (error) {
    throw new Error(`无法向 Python 写入任务：${error.message}`);
  }
}

/* -------------------------------------------------------------- decisions */

function cancelJob(job, reason = "用户取消") {
  if (!job || !["queued", "running"].includes(job.state)) return false;
  pushEvent(job, { stage: "cancel", level: "warn", message: reason });
  job.state = "cancelled";
  killTree(job.child);
  finishJob(job, "cancelled");
  return true;
}

/* ----------------------------------------------------------------- models */

async function listModels(ctx) {
  const llm = ctx.get("llm");
  const providers = [];
  const push = (providerId, label, models) => {
    if (!providerId || !Array.isArray(models)) return;
    providers.push({
      id: providerId,
      label: label || providerId,
      models: models
        .map((model) => {
          const modalities = modelModalities(model);
          return {
            id: String(model.id || model.model || model.name || ""),
            label: String(model.label || model.name || model.id || ""),
            provider: providerId,
            modalities: modalities ? modalities.slice() : null,
            vision: Boolean(modalities && modalities.includes("image")),
          };
        })
        .filter((model) => model.id),
    });
  };
  if (llm && typeof llm.listProviders === "function") {
    try {
      const list = await llm.listProviders();
      for (const entry of Array.isArray(list) ? list : []) {
        const providerId = String(entry.id || entry.provider || entry.name || "");
        let models = entry.models;
        if (!Array.isArray(models) && typeof llm.listModels === "function") {
          try {
            models = await llm.listModels(providerId);
          } catch {
            models = [];
          }
        }
        push(providerId, String(entry.label || entry.name || providerId), models);
      }
    } catch {
      /* ignore */
    }
  }
  if (providers.length === 0 && llm && typeof llm.listProviders === "function") {
    try {
      const list = await llm.listProviders();
      for (const entry of Array.isArray(list) ? list : []) {
        const providerId = String(entry.id || entry.provider || "");
        let models = [];
        if (typeof llm.listModels === "function") {
          try {
            models = await llm.listModels(providerId);
          } catch {
            models = [];
          }
        }
        push(providerId, String(entry.label || providerId), models);
      }
    } catch {
      /* ignore */
    }
  }
  return providers;
}

/* ------------------------------------------------------------------ files */

const EXT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".html": "text/html; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function safeName(name) {
  const base = path.basename(String(name || ""));
  if (!base || base.includes("..")) return "";
  if (!/^[\w.\-\u3400-\u9fff ]+$/u.test(base)) return "";
  return base;
}

function serveArtifact(res, job, name) {
  const clean = safeName(name);
  if (!clean) return sendJson(res, 400, { error: "文件名不合法" });
  if (clean === "input") {
    const file = job.input && job.input.imagePath;
    if (!file || !exists(file)) return sendJson(res, 404, { error: "原图不存在" });
    return streamFile(res, file);
  }
  const file = path.join(job.outputDir, clean);
  if (!exists(file)) return sendJson(res, 404, { error: `找不到产物：${clean}` });
  if (!job.artifactNames.includes(clean) && !["fireprediction.json", "job.json"].includes(clean)) {
    return sendJson(res, 403, { error: "该文件不在本任务产物清单内" });
  }
  return streamFile(res, file);
}

function streamFile(res, file) {
  const stat = fs.statSync(file);
  const type = EXT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "content-length": String(stat.size),
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
}

/* ----------------------------------------------------------------- upload */

function saveUpload(body) {
  const name = safeName(body.name || "upload.png") || "upload.png";
  const data = String(body.dataBase64 || "");
  const match = data.match(/^data:[^;]+;base64,(.*)$/s);
  const raw = Buffer.from(match ? match[1] : data, "base64");
  if (raw.length === 0) throw new Error("上传内容为空");
  if (raw.length > 32 * 1024 * 1024) throw new Error("图片超过 32MB");
  const dir = path.join(DATA_DIR, "uploads");
  ensureDir(dir);
  const safe = `${Date.now()}-${name}`;
  const file = path.join(dir, safe);
  fs.writeFileSync(file, raw);
  return file;
}

/* ----------------------------------------------------------------- browse */

const BROWSE_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const BROWSE_MAX_DIRS = 300;
const BROWSE_MAX_FILES = 300;

function browseRoots() {
  const roots = [];
  const home = os.homedir();
  if (home) roots.push({ name: `主目录（${path.basename(home)}）`, path: home });
  if (process.env.LOCALAPPDATA) roots.push({ name: "本地应用数据", path: process.env.LOCALAPPDATA });
  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    try {
      if (fs.existsSync(drive)) roots.push({ name: drive, path: drive });
    } catch {
      /* ignore */
    }
  }
  return roots;
}

function browseDirectory(rawPath, kind) {
  const wanted = String(rawPath || "").trim();
  if (!wanted) {
    return { path: "", parent: "", roots: browseRoots(), dirs: [], files: [] };
  }
  const target = path.resolve(wanted);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new Error(`路径不存在：${target}`);
  }
  if (stat.isFile()) {
    return browseDirectory(path.dirname(target), kind);
  }
  if (!stat.isDirectory()) throw new Error(`不是文件夹：${target}`);
  let entries = [];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (error) {
    throw new Error(`无法读取文件夹：${String(error && error.message ? error.message : error)}`);
  }
  const dirs = [];
  const files = [];
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (dirs.length < BROWSE_MAX_DIRS) dirs.push({ name: entry.name, path: full });
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (kind === "xlsx" && ext !== ".xlsx") continue;
    if (kind === "images" && !BROWSE_IMAGE_EXTS.has(ext)) continue;
    if (files.length < BROWSE_MAX_FILES) {
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        size = 0;
      }
      files.push({ name: entry.name, path: full, size });
    }
  }
  dirs.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  files.sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? "" : parent,
    roots: [],
    dirs,
    files,
  };
}

/* ------------------------------------------------------------------ batch */

const BATCH_DIR = path.join(DATA_DIR, "batches");
const batches = new Map();
let activeBatchId = null;
const BATCH_TIMEOUT_MS = 6 * 60 * 60 * 1000;

function batchSummary(batch, options) {
  const withItems = Boolean(options && options.items);
  const summary = {
    id: batch.id,
    state: batch.state,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    finishedAt: batch.finishedAt,
    xlsxPath: batch.xlsxPath,
    xlsxName: batch.xlsxPath ? path.basename(batch.xlsxPath) : "",
    imagesDir: batch.imagesDir,
    outputDir: batch.outputDir,
    outputXlsx: batch.outputXlsx || "",
    outputName: batch.outputXlsx ? path.basename(batch.outputXlsx) : "",
    total: batch.total,
    ok: batch.ok,
    failed: batch.failed,
    skipped: batch.skipped,
    currentId: batch.currentId,
    hasHeader: batch.hasHeader,
    columns: batch.columns,
    elapsedMs: batch.finishedAt ? batch.finishedAt - batch.createdAt : Date.now() - batch.createdAt,
    error: batch.error || "",
  };
  if (withItems) {
    summary.items = batch.items.slice();
    summary.events = batch.events.slice(-200);
    summary.stderr = batch.stderr ? batch.stderr.slice(-2000) : "";
  }
  return summary;
}

function pushBatchEvent(batch, event) {
  batch.events.push({ at: Date.now(), ...event });
  if (batch.events.length > 600) batch.events.splice(0, batch.events.length - 600);
  batch.updatedAt = Date.now();
}

function persistBatch(batch) {
  try {
    ensureDir(batch.outputDir);
    const data = batchSummary(batch, { items: true });
    data.request = batch.request || null;
    fs.writeFileSync(path.join(batch.outputDir, "batch.json"), JSON.stringify(data, null, 2), "utf8");
  } catch {
    /* persistence is best effort */
  }
}

function buildBatchRequest(input, settings, python) {
  const xlsxPath = String(input.xlsxPath || "").trim();
  if (!xlsxPath) throw new Error("请先选择批量输入 Excel 文件。");
  if (!exists(xlsxPath)) throw new Error(`找不到 Excel 文件：${xlsxPath}`);
  if (!/\.xlsx$/i.test(xlsxPath)) throw new Error("批量输入只支持 .xlsx 文件。");
  const imagesDir = String(input.imagesDir || "").trim();
  if (!imagesDir) throw new Error("请填写图片文件夹路径。");
  if (!exists(imagesDir) || !fs.statSync(imagesDir).isDirectory()) throw new Error(`找不到图片文件夹：${imagesDir}`);

  const decider = mergeDeep(clone(DEFAULT_SETTINGS.decider), input.decider || {});
  const review = mergeDeep(clone(DEFAULT_SETTINGS.review), input.review || {});
  const segmentation = mergeDeep(clone(DEFAULT_SETTINGS.segmentation), input.segmentation || {});
  const estimateCfg = input.llmEstimate || {};
  const models = input.models && typeof input.models === "object" ? input.models : {};
  const normalizeRoute = (raw) => {
    const cfg = raw && typeof raw === "object" ? raw : {};
    return {
      channel: String(cfg.channel || "host") === "api" ? "api" : "host",
      providerId: String(cfg.providerId || "").trim(),
      model: String(cfg.model || "").trim(),
      baseUrl: String(cfg.baseUrl || "").trim(),
      apiKey: String(cfg.apiKey || "").trim(),
    };
  };
  const materialRoute = normalizeRoute(models.segmentation);
  const estimateRoute = normalizeRoute(models.estimate);
  const estimateEnabled = Boolean(estimateCfg.enabled);
  const batchId = `batch-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  const outputDir = path.join(BATCH_DIR, batchId);
  ensureDir(outputDir);
  const requestFile = path.join(outputDir, "request.json");
  const unit = ["mm", "cm", "m"].includes(String(input.defaultUnit || "")) ? String(input.defaultUnit) : "cm";
  const headers = input.headers && typeof input.headers === "object" ? input.headers : null;
  const limit = Math.max(0, Math.min(2000, Number(input.limit) || 0));
  const request = {
    mode: "batch",
    batchId,
    xlsxPath,
    imagesDir,
    headers,
    limit,
    defaults: { unit },
    outputDir,
    toolA: materialToolDir(settings).path,
    toolB: firepredictionToolDir(settings),
    physicalEngine: firepredictionEngine(settings),
    runtimeDir: DATA_DIR,
    python: python.file,
    models: { segmentation: materialRoute, estimate: estimateRoute },
    pipeline: {
      device: String(input.device || settings.device || "auto") === "cpu" ? "cpu" : "",
      useFireprediction: Boolean(input.useFireprediction),
      volumeKind: ["envelope", "material_volume"].includes(String(input.volumeKind))
        ? String(input.volumeKind)
        : "envelope",
      llmEstimate: {
        enabled: estimateEnabled,
        role: estimateEnabled ? "primary" : "extra",
        providerId: estimateRoute.providerId,
        model: estimateRoute.model,
      },
      segmentation: {
        engine: String(segmentation.engine || "yolo") === "llm" ? "llm" : "yolo",
        conf: Number(segmentation.conf) || 0.25,
        metalConf: Number(segmentation.metalConf) || 0.2,
        metalEnabled: Boolean(segmentation.metalEnabled),
      },
      decider: {
        provider: String(decider.provider || "deepseek"),
        channel: String(decider.channel || "host"),
        model: materialRoute.model || String(decider.model || ""),
        providerId: materialRoute.providerId || String(decider.providerId || ""),
        vision: String(decider.vision || "auto"),
        apiKey: String(decider.apiKey || ""),
        baseUrl: String(decider.baseUrl || "https://api.deepseek.com"),
        jevModel: String(decider.jevModel || "perplexity/pplx-decider-v1.2"),
        openrouterApiKey: String(review.apiKey || process.env.OPENROUTER_API_KEY || ""),
        reviewProvider: String(review.provider || "auto"),
        reviewModel: String(review.model || ""),
        reviewApiKey: String(review.apiKey || ""),
      },
    },
  };
  const notices = [];
  const fireprediction = firepredictionToolDir(settings);
  const engine = firepredictionEngine(settings);
  if (!fireprediction && request.pipeline.useFireprediction) {
    // Fireprediction is optional: without it there is no mass/volume at all, so
    // switch the whole batch to the per-row vision estimate.
    request.pipeline.useFireprediction = false;
    if (!request.pipeline.llmEstimate.enabled) {
      request.pipeline.llmEstimate.enabled = true;
      request.pipeline.llmEstimate.role = "primary";
    }
    notices.push("未检测到 Fireprediction：本批改用视觉模型逐件估计质量与体积（估计失败的件只给材质结论）。");
  }
  if (request.pipeline.segmentation.engine === "llm") {
    // Every row asks the host model for its own segmentation over the same
    // JSON-line channel used for decisions, so this works but costs one vision
    // call per row and falls back to local YOLO when a row's call fails.
    notices.push("本批逐件调用视觉模型判定材质区域（每件一次视觉请求，耗时更长；失败的件会自动回退本机 YOLO）。");
  }
  if (estimateEnabled) {
    notices.push("本批逐件请视觉模型直接估计质量与体积（每件一次视觉请求）；估计失败的件会自动回退 Fireprediction。");
  }
  if (notices.length) request.batchNotices = notices;
  // Keys stay in memory only: the persisted request.json carries the routing
  // (channel/baseUrl/model) but never the secret.
  const persisted = clone(request);
  persisted.models.segmentation.apiKey = "";
  persisted.models.estimate.apiKey = "";
  fs.writeFileSync(requestFile, JSON.stringify(persisted, null, 2), "utf8");
  return {
    batchId,
    outputDir,
    requestFile,
    request,
    models: {
      segmentation: clone(materialRoute),
      estimate: clone(estimateRoute),
    },
  };
}

function startBatch(ctx, input) {
  const settings = readSettings();
  const python = resolvePython(settings);
  if (!exists(python.file)) throw new Error(`找不到可用的 Python 解释器：${python.file}`);
  if (!exists(BRIDGE)) throw new Error(`插件缺少 py/bridge.py：${BRIDGE}`);
  const built = buildBatchRequest(input, settings, python);
  const batch = {
    id: built.batchId,
    state: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: 0,
    xlsxPath: built.request.xlsxPath,
    imagesDir: built.request.imagesDir,
    outputDir: built.outputDir,
    requestFile: built.requestFile,
    request: built.request,
    models: built.models || {},
    outputXlsx: "",
    total: 0,
    ok: 0,
    failed: 0,
    skipped: 0,
    currentId: "",
    hasHeader: null,
    columns: null,
    items: [],
    events: [],
    error: "",
    stderr: "",
    python: python.file,
  };
  batches.set(batch.id, batch);
  if (batches.size > 12) {
    for (const [id, value] of batches) {
      if (id !== batch.id && value.state !== "running") batches.delete(id);
    }
  }
  activeBatchId = batch.id;
  pushBatchEvent(batch, { stage: "queue", level: "info", message: `批量任务已提交（共 ${path.basename(batch.xlsxPath)}）。` });
  runBatch(ctx, batch).catch((error) => {
    batch.error = String(error && error.message ? error.message : error);
    pushBatchEvent(batch, { stage: "error", level: "error", message: batch.error });
    finishBatch(batch, "failed");
  });
  return batch;
}

function finishBatch(batch, state) {
  if (batch.finishedAt) return;
  batch.state = state;
  batch.finishedAt = Date.now();
  batch.updatedAt = batch.finishedAt;
  persistBatch(batch);
}

async function runBatch(ctx, batch) {
  let child;
  try {
    child = spawn(batch.python, ["-u", BRIDGE, "--batch", batch.requestFile], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1", PYTHONUTF8: "1" },
      windowsHide: true,
      cwd: path.dirname(BRIDGE),
    });
  } catch (error) {
    throw new Error(`无法启动 Python：${error.message}`);
  }
  batch.state = "running";
  batch.child = child;
  pushBatchEvent(batch, { stage: "start", level: "info", message: "批量流程已启动（逐件分析中）。" });

  let buffer = "";
  let stderrTail = "";
  let settled = false;
  const timer = setTimeout(() => {
    pushBatchEvent(batch, { stage: "timeout", level: "error", message: `批量任务超过 ${Math.round(BATCH_TIMEOUT_MS / 3600000)} 小时，已终止。` });
    killTree(child);
  }, BATCH_TIMEOUT_MS);
  batch.timer = timer;
  const settle = (state) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    batch.child = null;
    finishBatch(batch, state);
  };

  const handleBatchMessage = (message) => {
    switch (message.type) {
      case "batch-meta": {
        batch.total = Number(message.total) || 0;
        batch.hasHeader = Boolean(message.hasHeader);
        batch.columns = message.columns || null;
        batch.items = (Array.isArray(message.items) ? message.items : []).map((item) => ({
          index: Number(item.index) || 0,
          id: String(item.id || ""),
          category: String(item.category || ""),
          dimensionsText: String(item.dimensionsText || ""),
          imagePath: String(item.imagePath || ""),
          imageName: item.imagePath ? path.basename(String(item.imagePath)) : "",
          problem: String(item.problem || ""),
          status: item.problem ? "skipped" : "pending",
          summary: null,
          elapsedMs: 0,
        }));
        pushBatchEvent(batch, {
          stage: "batch",
          level: "info",
          message: `解析出 ${batch.total} 件家具（可运行 ${message.ready == null ? batch.total : message.ready} 件）。`,
        });
        persistBatch(batch);
        return;
      }
      case "batch-progress": {
        batch.currentId = String(message.id || "");
        if (Number(message.position) && Number(message.total)) {
          batch.position = Number(message.position);
        }
        return;
      }
      case "batch-log": {
        pushBatchEvent(batch, {
          stage: String(message.stage || "pipeline"),
          level: String(message.level || "info"),
          message: `[${message.id || ""}] ${message.message || ""}`,
        });
        return;
      }
      case "batch-item": {
        const index = Number(message.index) || 0;
        const item = batch.items[index];
        if (item) {
          item.status = String(message.status || "unknown");
          item.summary = message.summary || null;
          item.problem = String(message.problem || item.problem || "");
          item.elapsedMs = Number(message.elapsedMs) || 0;
          item.outputDir = message.outputDir || "";
        }
        const counts = { ok: 0, failed: 0, skipped: 0 };
        for (const entry of batch.items) {
          if (entry.status === "ok") counts.ok += 1;
          else if (entry.status === "failed") counts.failed += 1;
          else if (entry.status === "skipped") counts.skipped += 1;
        }
        batch.ok = counts.ok;
        batch.failed = counts.failed;
        batch.skipped = counts.skipped;
        const heat = message.summary && message.summary.fireLoadMj != null ? `${Number(message.summary.fireLoadMj).toFixed(1)} MJ` : "—";
        pushBatchEvent(batch, {
          stage: "item",
          level: message.status === "ok" ? "info" : message.status === "skipped" ? "warn" : "error",
          message: `${Number(message.position) || ""}/${batch.total} ${message.id || ""}：${message.status === "ok" ? `火灾荷载 ${heat}` : message.status === "skipped" ? `跳过（${message.problem || "缺少图片"}）` : `失败（${message.problem || "未知错误"}）`}`,
        });
        persistBatch(batch);
        return;
      }
      case "batch-done": {
        batch.outputXlsx = String(message.outputXlsx || "");
        batch.total = Number(message.total) || batch.total;
        batch.ok = Number(message.ok) || batch.ok;
        batch.failed = Number(message.failed) || 0;
        batch.skipped = Number(message.skipped) || 0;
        pushBatchEvent(batch, {
          stage: "done",
          level: "info",
          message: `批量完成：成功 ${batch.ok}、失败 ${batch.failed}、跳过 ${batch.skipped}（${Math.round((Number(message.elapsedMs) || 0) / 1000)} 秒）。`,
        });
        persistBatch(batch);
        return;
      }
      case "segment-request": {
        const requestId = String(message.id || "");
        const payload = message.payload || {};
        const answer = (body) => {
          if (!batch.child || !batch.child.stdin || batch.child.stdin.destroyed) return;
          try {
            batch.child.stdin.write(`${JSON.stringify(Object.assign({ type: "segment-answer", id: requestId }, body))}\n`);
          } catch (error) {
            /* the batch process is gone; nothing to answer */
          }
        };
        batch.currentId = payload.imageName ? String(payload.imageName) : batch.currentId;
        const batchModels = (batch.models && Object.keys(batch.models).length ? batch.models : (batch.request && batch.request.models)) || {};
        askSegmentation(
          ctx,
          {
            imagePath: payload.imagePath,
            category: payload.category,
            furnitureType: payload.furnitureType,
            furnitureName: payload.furnitureName,
            dimensions: payload.dimensions,
          },
          (event) =>
            pushBatchEvent(batch, {
              stage: "segmentation",
              level: event.level || "info",
              message: `${batch.currentId ? `[${batch.currentId}] ` : ""}${event.message}`,
            }),
          batchModels.segmentation || {}
        )
          .then((parsed) => answer({ segmentation: parsed, model: parsed.model, images: parsed.images }))
          .catch((error) => answer({ error: String(error && error.message ? error.message : error) }));
        return;
      }
      case "estimate-request": {
        const requestId = String(message.id || "");
        const payload = message.payload || {};
        const answer = (body) => {
          if (!batch.child || !batch.child.stdin || batch.child.stdin.destroyed) return;
          try {
            batch.child.stdin.write(`${JSON.stringify(Object.assign({ type: "estimate-answer", id: requestId }, body))}\n`);
          } catch {
            /* the batch process is gone; nothing to answer */
          }
        };
        batch.currentId = payload.imageName ? String(payload.imageName) : batch.currentId;
        const batchModels = (batch.models && Object.keys(batch.models).length ? batch.models : (batch.request && batch.request.models)) || {};
        const estimateRoute = batchModels.estimate || {};
        const relayEvents = () => {
          for (const event of virtualJob.events.splice(0)) {
            pushBatchEvent(batch, {
              stage: event.stage || "llm-estimate",
              level: event.level || "info",
              message: `${batch.currentId ? `[${batch.currentId}] ` : ""}${event.message || ""}`,
            });
          }
        };
        const virtualJob = { id: `batch:${batch.id}`, events: [], updatedAt: Date.now() };
        runLlmEstimate(ctx, virtualJob, {
          imagePath: payload.imagePath,
          imageName: payload.imageName,
          category: payload.category,
          furnitureType: payload.furnitureType,
          furnitureName: payload.furnitureName,
          dimensions: payload.dimensions,
          llmEstimate: {
            enabled: true,
            providerId: String(estimateRoute.providerId || estimateRoute.provider || ""),
            model: String(estimateRoute.model || ""),
          },
        })
          .then((estimate) => {
            relayEvents();
            answer({ estimate, model: estimate.model, images: estimate.images });
          })
          .catch((error) => {
            relayEvents();
            answer({ error: String(error && error.message ? error.message : error) });
          });
        return;
      }
      case "error": {
        batch.error = String(message.message || "未知错误");
        pushBatchEvent(batch, { stage: "error", level: "error", message: batch.error });
        return;
      }
      default:
        return;
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          handleBatchMessage(JSON.parse(line));
        } catch {
          pushBatchEvent(batch, { stage: "stdout", level: "debug", message: line.slice(0, 300) });
        }
      }
      index = buffer.indexOf("\n");
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrTail = (stderrTail + chunk).slice(-8000);
    batch.stderr = stderrTail;
  });
  child.on("error", (error) => {
    batch.error = error.message;
    settle("failed");
  });
  child.on("close", (code) => {
    if (batch.state === "cancelled") {
      settle("cancelled");
      return;
    }
    if (code === 0 && batch.outputXlsx) {
      settle("succeeded");
      return;
    }
    if (!batch.error) {
      batch.error =
        (stderrTail ? stderrTail.trim().split(/\r?\n/).slice(-6).join("\n") : "") || `Python 退出码 ${code}`;
    }
    pushBatchEvent(batch, { stage: "error", level: "error", message: `批量未完成：${batch.error}` });
    settle("failed");
  });
}

function cancelBatch(batch, reason = "用户取消") {
  if (!batch || !["queued", "running"].includes(batch.state)) return false;
  pushBatchEvent(batch, { stage: "cancel", level: "warn", message: reason });
  batch.state = "cancelled";
  if (batch.child) killTree(batch.child);
  batch.child = null;
  finishBatch(batch, "cancelled");
  return true;
}

function activeBatch() {
  return activeBatchId ? batches.get(activeBatchId) : null;
}

let templatePromise = null;
let templatePath = "";

async function ensureBatchTemplate(settings) {
  const target = path.join(DATA_DIR, "批量输入模板.xlsx");
  if (exists(target)) {
    templatePath = target;
    return target;
  }
  if (templatePromise) return templatePromise;
  const python = resolvePython(settings || readSettings()).file;
  templatePromise = new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(python, ["-u", BRIDGE, "--xlsx-template", target], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        windowsHide: true,
        cwd: path.dirname(BRIDGE),
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && exists(target)) {
        templatePath = target;
        resolve(target);
      } else {
        reject(new Error(stderr.trim() || `生成模板失败（退出码 ${code}）`));
      }
    });
  }).finally(() => {
    templatePromise = null;
  });
  return templatePromise;
}

function serveBatchFile(res, batch, name) {
  const clean = safeName(name);
  if (!clean) return sendJson(res, 400, { error: "文件名不合法" });
  const file = batch.outputXlsx && path.basename(batch.outputXlsx) === clean ? batch.outputXlsx : path.join(batch.outputDir, clean);
  if (!exists(file)) return sendJson(res, 404, { error: `找不到批量产物：${clean}` });
  if (!batch.outputXlsx || path.resolve(file) !== path.resolve(batch.outputXlsx)) {
    return sendJson(res, 403, { error: "该文件不在批量产物清单内" });
  }
  return streamFile(res, file);
}

/* ------------------------------------------------------------------ routes */

function statePayload(ctx) {
  const settings = readSettings();
  const python = resolvePython(settings);
  const material = materialToolDir(settings);
  const fireprediction = firepredictionToolDir(settings);
  const engine = firepredictionEngine(settings);
  return {
    ok: true,
    settings,
    categories: CATEGORIES,
    volumeKinds: VOLUME_KINDS,
    paths: {
      plugin: PLUGIN_DIR,
      bridge: fileInfo(BRIDGE),
      clientBundle: fileInfo(CLIENT_BUNDLE),
      toolA: {
        path: material.path,
        exists: exists(path.join(material.path, "auto_workflow.py")),
        builtin: material.builtin,
      },
      toolB: {
        path: engine === "builtin" ? VENDOR_FIREPREDICTION_DIR : fireprediction,
        exists: engine !== "none",
        builtin: engine === "builtin",
        optional: false,
      },
      python: { path: python.file, source: python.source, exists: exists(python.file) },
      dataDir: DATA_DIR,
    },
    jobs: jobOrder.map((id) => jobs.get(id)).filter(Boolean).map(jobSummary),
    activeJobId,
    selfCheck: {
      status: selfCheckState.status,
      startedAt: selfCheckState.startedAt,
      finishedAt: selfCheckState.finishedAt,
      reportPath: reportPath(),
      error: selfCheckState.error,
    },
    diagnostics: {
      node: process.version,
      platform: process.platform,
      reportPath: reportPath(),
      reportExists: exists(reportPath()),
    },
  };
}

const selfCheckState = { status: "idle", startedAt: 0, finishedAt: 0, error: null, result: null };
let selfCheckPromise = null;

function startSelfCheck() {
  if (selfCheckPromise) return selfCheckPromise;
  const settings = readSettings();
  selfCheckState.status = "running";
  selfCheckState.startedAt = Date.now();
  selfCheckState.finishedAt = 0;
  selfCheckState.error = null;
  selfCheckPromise = runSelfCheck({
    toolA: materialToolDir(settings).path,
    toolB: firepredictionToolDir(settings),
    python: resolvePython(settings).file,
  })
    .then((report) => {
      selfCheckState.status = report && report.ok === false ? "failed" : "ok";
      selfCheckState.result = report;
      return report;
    })
    .catch((error) => {
      selfCheckState.status = "failed";
      selfCheckState.error = String(error && error.message ? error.message : error);
      return null;
    })
    .finally(() => {
      selfCheckState.finishedAt = Date.now();
      selfCheckPromise = null;
    });
  return selfCheckPromise;
}

async function handle(ctx, req, res) {
  const url = new URL(req.url || "/", "http://furniture-fireload.local");
  const route = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) || "/" : null;
  if (route === null) return sendJson(res, 404, { error: "not found" });
  const method = String(req.method || "GET").toUpperCase();

  try {
    if (route === "/health" && method === "GET") {
      return sendJson(res, 200, { ok: true, plugin: name, version: "1.1.1", bridge: fileInfo(BRIDGE), activeJobId });
    }
    if (route === "/state" && method === "GET") {
      return sendJson(res, 200, statePayload(ctx));
    }
    if (route === "/settings" && method === "GET") {
      return sendJson(res, 200, { ok: true, settings: readSettings() });
    }
    if (route === "/settings" && method === "POST") {
      const body = await readBody(req);
      const settings = writeSettings(body.settings || body);
      return sendJson(res, 200, { ok: true, settings, paths: statePayload(ctx).paths });
    }
    if (route === "/models" && method === "GET") {
      const providers = await listModels(ctx);
      return sendJson(res, 200, { ok: true, providers, llm: Boolean(ctx.get("llm")) });
    }
    if (route === "/upload" && method === "POST") {
      const body = await readBody(req);
      const file = saveUpload(body);
      return sendJson(res, 200, { ok: true, path: file, name: path.basename(file), size: fs.statSync(file).size });
    }
    if (route === "/jobs" && method === "POST") {
      const body = await readBody(req);
      const current = activeJob();
      if (current) cancelJob(current, "新任务开始，先终止上一个任务。");
      const job = startJob(ctx, body.job || body);
      return sendJson(res, 200, { ok: true, job: jobSummary(job), jobId: job.id });
    }
    if (route === "/job" && method === "GET") {
      const id = String(url.searchParams.get("id") || "");
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, { error: "任务不存在或已过期" });
      return sendJson(res, 200, {
        ok: true,
        job: jobSummary(job),
        events: job.events.slice(-260),
        payload: job.payload,
        llmEstimate: job.llmEstimate || null,
        llmSegmentation: job.llmSegmentation || null,
        stderr: job.stderr ? job.stderr.slice(-2000) : "",
        artifacts: artifactsFor(job),
      });
    }
    if (route === "/jobs" && method === "GET") {
      return sendJson(res, 200, { ok: true, jobs: jobOrder.map((id) => jobs.get(id)).filter(Boolean).map(jobSummary), activeJobId });
    }
    if (route === "/cancel" && method === "POST") {
      const body = await readBody(req);
      const job = jobs.get(String(body.id || "")) || activeJob();
      const cancelled = job ? cancelJob(job) : false;
      return sendJson(res, 200, { ok: true, cancelled });
    }
    if (route === "/file" && method === "GET") {
      const id = String(url.searchParams.get("id") || "");
      const name = String(url.searchParams.get("name") || "");
      const job = jobs.get(id);
      if (!job) return sendJson(res, 404, { error: "任务不存在或已过期" });
      return serveArtifact(res, job, name);
    }
    if (route === "/batch" && method === "POST") {
      const body = await readBody(req);
      const current = activeBatch();
      if (current && ["queued", "running"].includes(current.state)) {
        cancelBatch(current, "新批量任务开始，先终止上一个批量任务。");
      }
      const batch = startBatch(ctx, body.batch || body);
      return sendJson(res, 200, { ok: true, batch: batchSummary(batch, { items: true }) });
    }
    if (route === "/batch" && method === "GET") {
      const id = String(url.searchParams.get("id") || "");
      const batch = id ? batches.get(id) : activeBatch();
      return sendJson(res, 200, { ok: true, batch: batch ? batchSummary(batch, { items: true }) : null });
    }
    if (route === "/batch/cancel" && method === "POST") {
      const body = await readBody(req);
      const batch = batches.get(String(body.id || "")) || activeBatch();
      const cancelled = batch ? cancelBatch(batch) : false;
      return sendJson(res, 200, { ok: true, cancelled });
    }
    if (route === "/batch/file" && method === "GET") {
      const id = String(url.searchParams.get("id") || "");
      const name = String(url.searchParams.get("name") || "");
      const batch = batches.get(id);
      if (!batch) return sendJson(res, 404, { error: "批量任务不存在或已过期" });
      return serveBatchFile(res, batch, name);
    }
    if (route === "/batch/template" && method === "GET") {
      try {
        const file = await ensureBatchTemplate();
        return streamFile(res, file);
      } catch (error) {
        return sendJson(res, 500, { error: `生成模板失败：${String(error && error.message ? error.message : error)}` });
      }
    }
    if (route === "/batch/upload" && method === "POST") {
      const body = await readBody(req);
      if (!/\.xlsx$/i.test(String(body.name || ""))) throw new Error("批量输入只支持 .xlsx 文件");
      const file = saveUpload(body);
      return sendJson(res, 200, { ok: true, path: file, name: path.basename(file), size: fs.statSync(file).size });
    }
    if (route === "/browse" && method === "GET") {
      const target = String(url.searchParams.get("path") || "");
      const kind = String(url.searchParams.get("kind") || "");
      try {
        return sendJson(res, 200, { ok: true, ...browseDirectory(target, kind) });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) });
      }
    }
    if (route === "/selfcheck" && method === "GET") {
      let report = null;
      try {
        report = JSON.parse(fs.readFileSync(reportPath(), "utf8"));
      } catch {
        report = null;
      }
      return sendJson(res, 200, { ok: true, status: selfCheckState.status, error: selfCheckState.error, reportPath: reportPath(), report });
    }
    if (route === "/selfcheck" && method === "POST") {
      const report = await startSelfCheck();
      return sendJson(res, 200, { ok: true, status: selfCheckState.status, report });
    }
    return sendJson(res, 404, { error: `未知接口：${route}` });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) });
  }
}

/* -------------------------------------------------------------------- apply */

export function apply(ctx) {
  try {
    ensureDir(DATA_DIR);
    ensureDir(JOBS_DIR);
    fs.writeFileSync(
      ACTIVATE_FILE,
      JSON.stringify({ at: new Date().toISOString(), pluginDir: PLUGIN_DIR, pid: process.pid, node: process.version }, null, 2),
      "utf8",
    );
  } catch {
    /* ignore */
  }

  ctx.effect(() => {
    const disposer = ctx.webServer.register({
      kind: "prefix",
      path: PREFIX,
      handler: (req, res) => {
        void handle(ctx, req, res);
      },
    });
    return () => {
      try {
        disposer();
      } catch {
        /* ignore */
      }
    };
  }, "furniture-fireload: http carrier");

  ctx.effect(() => {
    const timer = setTimeout(() => {
      void startSelfCheck();
    }, 4000);
    return () => {
      clearTimeout(timer);
      for (const id of jobOrder.slice()) {
        const job = jobs.get(id);
        if (job && job.child) killTree(job.child);
      }
    };
  }, "furniture-fireload: background self-check");
}
