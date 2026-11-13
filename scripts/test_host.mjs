// Dev harness: load the plugin host half outside DSH, expose its HTTP carrier
// on a local port, drive one real job through it, and print the result.
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.dirname(LIB_DIR);
const ROOT = process.env.FFX_PLUGIN_ROOT ? path.resolve(process.env.FFX_PLUGIN_ROOT) : PLUGIN_DIR;
const modulePath = path.join(ROOT, "lib", "index.js");
console.log(`[load] plugin root: ${ROOT}`);

const routes = [];
const disposers = [];
const VISION = process.env.FFX_VISION !== "0";
const STUB_ESTIMATE = JSON.stringify({
  mass_kg: 16.2,
  volume_m3: 0.98,
  materials: [
    { name: "实木", share: 0.62 },
    { name: "织物", share: 0.24 },
    { name: "金属", share: 0.09 },
    { name: "泡沫填充", share: 0.05 },
  ],
  heat_value_mj_kg: 15.4,
  fire_load_mj: 249.5,
  confidence: 0.52,
  notes: "按床体比例与常见板式结构估算，体积含床箱空腔。",
});
const STUB_SEGMENTATION = JSON.stringify({
  target: { x0: 0.12, y0: 0.1, x1: 0.9, y1: 0.86 },
  materials: [
    { broad: "wood", share: 0.48 },
    { broad: "fabric", share: 0.27 },
    { broad: "metal", share: 0.05 },
  ],
  furniture_type: "床",
  confidence: 0.58,
  notes: "看得到木质床架和布艺床面，余下看不清。",
});
const savedImages = [];

const PROVIDERS = VISION
  ? [
      {
        id: "deepseek",
        label: "DeepSeek",
        models: [
          { id: "deepseek-flash", label: "deepseek-flash", inputModalities: ["text"] },
          { id: "deepseek-v4-pro", label: "deepseek-v4-pro", inputModalities: ["text"] },
        ],
      },
      {
        id: "deepseek-modlens",
        label: "DeepSeek (modlens vision)",
        models: [{ id: "deepseek-v4-pro", label: "deepseek-v4-pro (modlens vision)", inputModalities: ["text", "image"] }],
      },
    ]
  : [{ id: "deepseek", label: "DeepSeek", models: [{ id: "deepseek-flash", label: "deepseek-flash" }] }];

function makeCtx() {
  let estimateCalls = 0;
  return {
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === "function") disposers.push(dispose);
      return dispose;
    },
    get(name) {
      if (name === "llm") {
        return {
          async *stream(options) {
            const content = (options.messages && options.messages[0] && options.messages[0].content) || [];
            const prompt = (content.find((block) => block && block.type === "text") || {}).text || "";
            const imageBlocks = content.filter((block) => block && block.type === "image");
            const questionIds = Array.from(prompt.matchAll(/"id":\s*"([\w.-]+)"/g)).map((match) => match[1]);
            console.log(
              `[stub-llm] provider=${options.provider || "-"} model=${options.model || "-"} promptChars=${prompt.length} ` +
                `images=${imageBlocks.length} effort=${options.reasoningEffort || "-"} maxTokens=${options.maxTokens || "-"} ` +
                `ids~${questionIds.slice(0, 6).join(",")}`
            );
            if (imageBlocks.length) console.log(`[stub-llm] image attachments: ${imageBlocks.map((block) => (block.attachment && block.attachment.name) || "?").join(", ")}`);
            // An empty object is enough: the host fills unseen questions with unknown.
            const isEstimate = prompt.includes("直接估计这件家具");
            const isSegment = prompt.includes("任务：在一张家具照片里定位");
            if (isEstimate && process.env.FFX_ESTIMATE_EMPTY_FIRST === "1" && estimateCalls++ === 0) {
              // Simulate a reasoning model that spends the whole budget thinking.
              yield { type: "reasoning-delta", index: 0, text: "先分析照片里的家具结构与常见材质……" };
              yield { type: "usage", usage: { inputTokens: 900, outputTokens: options.maxTokens || 0, reasoningTokens: options.maxTokens || 0 } };
              yield { type: "finish", reason: { kind: "max-tokens" } };
              return;
            }
            const text = isEstimate
              ? process.env.FFX_ESTIMATE_BAD === "1"
                ? "抱歉，我没法从这张照片估计出质量。"
                : STUB_ESTIMATE
              : isSegment
                ? process.env.FFX_SEGMENT_BAD === "1"
                  ? "抱歉，我看不清这张照片。"
                  : STUB_SEGMENTATION
                : "{}";
            yield { type: "text-delta", index: 0, text };
            yield { type: "finish", reason: { kind: "stop" } };
          },
          async resolveModelInfo(providerId, modelId) {
            return { provider: providerId, id: modelId, name: modelId, reasoning: { efforts: [{ id: "medium" }, { id: "minimal" }], defaultEffort: "medium" } };
          },
          listProviders() {
            return PROVIDERS;
          },
          async listModels(providerId) {
            const group = PROVIDERS.find((entry) => entry.id === providerId);
            return group ? group.models : [];
          },
        };
      }
      if (name === "attachments") {
        return {
          async saveImage(input) {
            const data = input && input.data ? input.data : new Uint8Array();
            const ref = {
              attachmentId: `stub-${savedImages.length + 1}`,
              mediaType: (input && input.mediaType) || "image/jpeg",
              bytes: typeof data.length === "number" ? data.length : 0,
              width: 0,
              height: 0,
              name: (input && input.name) || "frame.jpg",
            };
            savedImages.push(ref);
            return ref;
          },
        };
      }
      if (name === "layout") return { selectPanel() {} };
      return undefined;
    },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {
          const index = routes.indexOf(route);
          if (index >= 0) routes.splice(index, 1);
        };
      },
    },
  };
}

if (process.env.FFX_SINGLE_CUSTOM === "1" || process.env.FFX_REVIEW_CUSTOM === "1") {
  // Keep the real user settings untouched: the plugin derives DATA_DIR at load time.
  process.env.FURNITURE_FIRELOAD_DATA = path.join("D:\\dsh workplace", ".tmp", "host-data-custom");
}
if (process.env.FFX_TOOLB_MISSING === "1") {
  // Pretend the optional Fireprediction install is absent.
  process.env.FURNITURE_FIRELOAD_NO_FIREPREDICTION = "1";
}

const mod = await import(pathToFileURL(modulePath).href);
console.log(`[load] module exports: ${Object.keys(mod).join(", ")}`);
mod.apply(makeCtx());
console.log(`[load] routes registered: ${routes.map((route) => `${route.kind} ${route.path}`).join(" | ")}`);

const server = http.createServer((req, res) => {
  // A tiny OpenAI-compatible endpoint so the "custom API" channel can be tested
  // offline: it answers /mock/chat/completions with canned JSON based on prompt.
  if (/\/mock\/chat\/completions$/.test(req.url || "")) {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        payload = {};
      }
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const user = messages.filter((message) => message.role === "user").pop() || {};
      const content = Array.isArray(user.content) ? user.content : [{ type: "text", text: String(user.content || "") }];
      const text = content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
      const images = content.filter((part) => part.type === "image_url").length;
      console.log(`[mock-api] model=${payload.model} images=${images} maxTokens=${payload.max_tokens}`);
      let answer = "{}";
      if (/任务：在一张家具照片里定位/.test(text)) answer = process.env.FFX_SEGMENT_BAD === "1" ? "抱歉，我看不清这张照片。" : STUB_SEGMENTATION;
      else if (/直接估计这件家具/.test(text)) answer = process.env.FFX_ESTIMATE_BAD === "1" ? "抱歉，我没法从这张照片估计出质量。" : STUB_ESTIMATE;
      else if (/需要判定的问题/.test(text) && /construction/.test(text)) {
        const ids = Array.from(new Set((text.match(/"(B\d{2}|unknown)"/g) || []).map((hit) => hit.slice(1, -1))));
        const candidates = ids.filter((id) => id !== "unknown");
        if (candidates.length) {
          const winner = candidates[0];
          const probabilities = {};
          const rest = candidates.slice(1);
          probabilities[winner] = rest.length ? 0.6 : 0.8;
          rest.forEach((id) => {
            probabilities[id] = 0.4 / rest.length;
          });
          probabilities.unknown = rest.length ? 0.0 : 0.2;
          answer = JSON.stringify({ answers: { construction: { choice: winner, probabilities } } });
        }
      }
      const body = JSON.stringify({
        id: "mock-1",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    });
    return;
  }
  const route = routes.find((entry) => (entry.kind === "prefix" ? req.url.startsWith(entry.path) : req.url === entry.path));
  if (!route) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no route" }));
    return;
  }
  Promise.resolve(route.handler(req, res)).catch((error) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
  });
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/api/furniture-fireload`;
console.log(`[http] listening on ${base}`);

async function call(pathname, options = {}) {
  const response = await fetch(base + pathname, {
    ...options,
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) throw new Error(`${pathname} -> HTTP ${response.status} ${text.slice(0, 400)}`);
  if (process.env.FFX_DUMP) {
    const fs = await import("node:fs");
    const dir = path.resolve(process.env.FFX_DUMP);
    fs.mkdirSync(dir, { recursive: true });
    const name = pathname.replace(/[^\w.-]+/g, "_").replace(/^_+/, "") || "root";
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(body, null, 2), "utf8");
  }
  return body;
}

const toolA = "C:\\Users\\Administrator\\Documents\\Codex\\2026-11-06\\https-github-com-zhouyc98-fire-load\\outputs\\furniture-material-tool";
const toolB = "D:\\Fireprediction";
const mode = process.argv[2] || "stub";
const image = process.argv[3] || path.join(toolA, "examples", "bed.jpg");

async function runBatchMode() {
  const { mkdirSync, writeFileSync, copyFileSync, statSync } = await import("node:fs");
  const fixtureDir = path.join("D:\\dsh workplace", ".tmp", "batch-fixture");
  const imagesDir = path.join(fixtureDir, "images");
  mkdirSync(imagesDir, { recursive: true });
  const templateResponse = await fetch(`${base}/batch/template`);
  const templatePath = path.join(fixtureDir, "输入.xlsx");
  writeFileSync(templatePath, Buffer.from(await templateResponse.arrayBuffer()));
  console.log(`[batch] template status=${templateResponse.status} size=${statSync(templatePath).size}`);
  const samples = [
    ["01_桌子.jpg", "001.jpg"],
    ["06_沙发.jpg", "002.jpg"],
    ["04_床.jpg", "003.jpg"],
  ];
  for (const [source, target] of samples) {
    copyFileSync(path.join(toolB, "examples", "images", source), path.join(imagesDir, target));
  }
  if (process.env.FFX_TEMPLATE_ONLY === "1") {
    console.log("[batch] template-only done");
    return;
  }
  const roots = await call(`/browse?kind=images&path=`);
  console.log(`[browse] roots=${(roots.roots || []).map((root) => root.path).join(",")}`);
  const imageListing = await call(`/browse?kind=images&path=${encodeURIComponent(imagesDir)}`);
  console.log(`[browse] images dir=${imageListing.path} dirs=${imageListing.dirs.length} files=${imageListing.files.length} first=${imageListing.files[0] ? imageListing.files[0].name : "-"}`);
  const xlsxListing = await call(`/browse?kind=xlsx&path=${encodeURIComponent(fixtureDir)}`);
  console.log(`[browse] xlsx dir=${xlsxListing.path} files=${xlsxListing.files.map((file) => file.name).join(",") || "-"}`);
  if (!imageListing.files.length || !xlsxListing.files.length) {
    console.log("[browse] FAIL: 浏览接口没有列出夹具文件");
    process.exitCode = 1;
  }
  const wantEstimate = process.env.FFX_BATCH_ESTIMATE === "llm";
  const apiChannel = process.env.FFX_BATCH_API === "1";
  const apiRoot = `http://127.0.0.1:${server.address().port}/mock`;
  if (apiChannel) {
    console.log(`[batch] custom API channel: ${apiRoot} model=mock-vision`);
  }
  const materialSlot = apiChannel
    ? { channel: "api", providerId: "", model: "mock-vision", baseUrl: apiRoot, apiKey: "mock-key" }
    : { providerId: "", model: "" };
  const estimateSlot = !wantEstimate
    ? { providerId: "", model: "" }
    : apiChannel
      ? { channel: "api", providerId: "", model: "mock-vision", baseUrl: apiRoot, apiKey: "mock-key" }
      : { providerId: "deepseek-modlens", model: "deepseek-v4-pro" };
  const created = await call("/batch", {
    method: "POST",
    body: {
      batch: {
        xlsxPath: templatePath,
        imagesDir,
        defaultUnit: "cm",
        limit: Number(process.env.FFX_BATCH_LIMIT || 3),
        useFireprediction: true,
        device: "cpu",
        decider: { provider: "stub", reviewProvider: "none" },
        segmentation: { engine: process.env.FFX_SEGMENT === "llm" ? "llm" : "yolo", conf: 0.25, metalConf: 0.2, metalEnabled: true },
        llmEstimate: { enabled: wantEstimate },
        models: {
          segmentation: materialSlot,
          estimate: estimateSlot,
        },
      },
    },
  });
  const batchId = created.batch.id;
  console.log(`[batch] started ${batchId} total=${created.batch.total} header=${created.batch.hasHeader} columns=${JSON.stringify(created.batch.columns)}`);
  for (const item of created.batch.items || []) {
    console.log(`   - ${item.id} ${item.category} ${item.dimensionsText} image=${item.imageName || "-"} ${item.problem || ""}`);
  }
  const startedAt = Date.now();
  let latest = created.batch;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const polled = await call(`/batch?id=${encodeURIComponent(batchId)}`);
    if (polled.batch) latest = polled.batch;
    if (["succeeded", "failed", "cancelled"].includes(latest.state)) break;
    if (Date.now() - startedAt > 540000) {
      console.log("[batch] TIMEOUT");
      process.exitCode = 1;
      break;
    }
  }
  console.log(`[batch] state=${latest.state} ok=${latest.ok} failed=${latest.failed} skipped=${latest.skipped} elapsed=${latest.elapsedMs}ms output=${latest.outputName}`);
  for (const event of (latest.events || []).slice(-4)) console.log(`   # [${event.stage}/${event.level}] ${event.message}`);
  for (const item of latest.items || []) {
    const summary = item.summary || {};
    console.log(`   - ${item.id} ${item.category} ${item.status} mass=${summary.massKg} heat=${summary.fireLoadMj} bulk=${summary.bulkDensityKgM3} region=${summary.regionEngine || "-"} physical=${summary.physicalLabel || "-"} ${item.problem || ""}`);
  }
  const expectLlm = process.env.FFX_SEGMENT === "llm" && process.env.FFX_SEGMENT_BAD !== "1";
  if (expectLlm) {
    const regions = (latest.items || []).filter((item) => item.status === "ok").map((item) => (item.summary || {}).regionEngine);
    console.log(`[batch] region engines: ${JSON.stringify(regions)}`);
    if (regions.some((label) => label !== "视觉大模型")) {
      console.log("[batch] FAIL: 批量没有逐件走视觉大模型分割");
      process.exitCode = 1;
    }
  }
  if (wantEstimate) {
    const okItems = (latest.items || []).filter((item) => item.status === "ok");
    const labels = okItems.map((item) => (item.summary || {}).physicalLabel);
    const masses = okItems.map((item) => (item.summary || {}).massKg);
    console.log(`[batch] physical labels: ${JSON.stringify(labels)} masses=${JSON.stringify(masses)}`);
    if (process.env.FFX_ESTIMATE_BAD === "1") {
      if (labels.some((label) => label !== "Fireprediction")) {
        console.log("[batch] FAIL: 估计失败的件没有回退 Fireprediction");
        process.exitCode = 1;
      }
    } else {
      if (labels.some((label) => label !== "视觉大模型估计")) {
        console.log("[batch] FAIL: 批量没有逐件用视觉模型估计质量/体积");
        process.exitCode = 1;
      }
      if (masses.some((value) => value !== 16.2)) {
        console.log("[batch] FAIL: 估计质量不是桩模型返回的 16.2 kg");
        process.exitCode = 1;
      }
    }
  }
  if (!latest.outputName) {
    console.log("[batch] FAIL: 没有生成结果 Excel");
    process.exitCode = 1;
  } else {
    const response = await fetch(`${base}/batch/file?id=${encodeURIComponent(batchId)}&name=${encodeURIComponent(latest.outputName)}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const saved = path.join(fixtureDir, latest.outputName);
    writeFileSync(saved, buffer);
    console.log(`[batch] file status=${response.status} type=${String(response.headers.get("content-type"))} bytes=${buffer.length} saved=${saved}`);
    if (response.status !== 200 || buffer.length < 2000) {
      console.log("[batch] FAIL: 结果 Excel 下载异常");
      process.exitCode = 1;
    }
  }
  if (Number(latest.failed) > 0) {
    console.log(`[batch] FAIL: ${latest.failed} 件失败`);
    process.exitCode = 1;
  }
  console.log(`[batch] ok=${latest.ok} total=${latest.total}`);
}

if (mode === "batch") {
  await runBatchMode();
  for (const dispose of disposers.splice(0)) {
    try {
      dispose();
    } catch {
      /* ignore */
    }
  }
  server.close();
  console.log("[done]");
  process.exit(process.exitCode || 0);
}

const health = await call("/health");
console.log(`[health] ${JSON.stringify(health).slice(0, 200)}`);

const state = await call("/state");
console.log(`[state] python=${state.paths.python.path} exists=${state.paths.python.exists} toolA=${state.paths.toolA.exists} toolB=${state.paths.toolB.exists}`);

const models = await call("/models");
console.log(`[models] llm=${models.llm} providers=${(models.providers || []).map((p) => p.id + ":" + p.models.length).join(",")}`);

const deciderMode = process.env.FFX_DECIDER || "text";
const visionMode = process.env.FFX_VISION_MODE || "auto";
const wantImages = process.env.FFX_EXPECT_IMAGES === "1";
const singleCustom = process.env.FFX_SINGLE_CUSTOM === "1";
const reviewCustom = process.env.FFX_REVIEW_CUSTOM === "1";
const noToolB = process.env.FFX_TOOLB_MISSING === "1";
const mockRoot = `http://127.0.0.1:${server.address().port}/mock`;

if (singleCustom || reviewCustom) {
  const fs = await import("node:fs");
  const dataDir = process.env.FURNITURE_FIRELOAD_DATA;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "settings.json"),
    JSON.stringify(
      {
        customModels: [
          { id: "m1", label: "Mock Vision", baseUrl: mockRoot, model: "mock-vision", apiKey: "mock-key", vision: true },
          { id: "m2", label: "Mock Text", baseUrl: mockRoot, model: "mock-text", apiKey: "mock-key", vision: false },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`[custom] settings written to ${dataDir} models=m1(visual),m2(text)`);
}

const job = await call("/jobs", {
  method: "POST",
  body: {
    job: {
      imagePath: image,
      category: "床",
      dimensions: { width: 200, height: 60, depth: 180, unit: "cm" },
      useFireprediction: mode === "fireprediction" || mode === "notoolb",
      massKg: mode === "stub" || mode === "segment" || singleCustom ? 45 : undefined,
      volumeM3: mode === "stub" || mode === "segment" || singleCustom ? 0.95 : undefined,
      device: "cpu",
      decider: reviewCustom
        ? { provider: "stub", reviewProvider: "custom", reviewCustomModelId: "m2" }
        : singleCustom
        ? { provider: "custom", customModelId: "m1", reviewProvider: "none" }
        : mode === "stub" || mode === "nophys" || mode === "segment" || mode === "notoolb"
          ? { provider: "stub", reviewProvider: "none" }
          : {
              provider: "deepseek",
              channel: "host",
              providerId: deciderMode === "vision" ? "deepseek-modlens" : "deepseek",
              model: deciderMode === "vision" ? "deepseek-v4-pro" : "deepseek-flash",
              vision: visionMode,
              reviewProvider: "none",
            },
      segmentation: {
        engine: singleCustom ? "custom" : mode === "segment" || process.env.FFX_SEGMENT === "llm" ? "llm" : "yolo",
        customModelId: singleCustom ? "m1" : "",
        conf: 0.25,
        metalConf: 0.2,
        metalEnabled: true,
      },
      llmEstimate: singleCustom
        ? { enabled: true, role: "extra", model: "", customModelId: "m2" }
        : mode === "estimate"
          ? { enabled: true, role: "primary", model: "" }
          : process.env.FFX_LLM_ESTIMATE
          ? { enabled: true, role: process.env.FFX_LLM_ESTIMATE, model: "" }
          : { enabled: false },
    },
  },
});
console.log(`[job] started ${job.jobId}`);

const startedAt = Date.now();
let latest = null;
for (;;) {
  await new Promise((resolve) => setTimeout(resolve, 800));
  latest = await call(`/job?id=${job.jobId}`);
  if (["succeeded", "failed", "cancelled"].includes(latest.job.state)) break;
  if (Date.now() - startedAt > 240000) {
    console.log("[job] TIMEOUT");
    break;
  }
}
console.log(`[job] state=${latest.job.state} elapsed=${latest.job.elapsedMs}ms events=${latest.events.length}`);
for (const event of latest.events.slice(-6)) console.log(`   - [${event.stage}/${event.level}] ${event.message}`);
if (latest.job.error) console.log(`[job] error=${latest.job.error}`);
const payload = latest.payload || {};
const physical = payload.physical || {};
console.log(`[payload] source=${payload.physicalSource} mass=${physical.mass && physical.mass.value_kg} volume=${physical.volume && physical.volume.value_m3} density=${physical.derived && physical.derived.bulk_density_kg_m3}`);
const fire = payload.fireLoad || {};
console.log(`[payload] heat=${fire.totalHeatMj} status=${fire.status} interval=${JSON.stringify(fire.totalHeatIntervalMj)} coverage=${fire.coverageMassFraction} materials=${fire.materialCount}`);
const composition = payload.composition || {};
console.log(`[payload] compositionStatus=${composition.status} decision=${JSON.stringify(composition.decision)} materials=${(composition.materials || []).length} groups=${((composition.refinementStage || {}).groups || []).length}`);
console.log(`[payload] artifacts=${JSON.stringify(latest.artifacts)}`);
for (const name of latest.artifacts || []) {
  const response = await fetch(`${base}/file?id=${job.jobId}&name=${encodeURIComponent(name)}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`[file] ${name} -> ${response.status} ${buffer.length} bytes ${String(response.headers.get("content-type"))}`);
}

if (noToolB) {
  const messages = (latest.events || []).map((event) => String(event.message || "")).join(" | ");
  console.log(
    "[notoolb] " +
      JSON.stringify({
        physicalSource: payload.physicalSource,
        mass: physical.mass && physical.mass.value_kg,
        heat: fire.totalHeatMj,
        fallbackNotice: /未检测到 Fireprediction/.test(messages),
      }),
  );
  if (!/未检测到 Fireprediction/.test(messages)) {
    console.log("[notoolb] FAIL: expected the Fireprediction fallback notice in the run log");
    process.exitCode = 1;
  }
  if (payload.physicalSource !== "llm-estimate") {
    console.log(`[notoolb] FAIL: expected physicalSource=llm-estimate, got ${payload.physicalSource}`);
    process.exitCode = 1;
  }
  if (fire.status === "unavailable") {
    console.log("[notoolb] FAIL: heat should still be computed from the vision estimate");
    process.exitCode = 1;
  }
}

if (mode === "fireprediction") {
  console.log(
    "[builtin] " +
      JSON.stringify({
        physicalSource: payload.physicalSource,
        mass: physical.mass && physical.mass.value_kg,
        volume: physical.volume && physical.volume.value_m3,
        heat: fire.totalHeatMj,
      }),
  );
  if (!["builtin-fireprediction", "fireprediction"].includes(String(payload.physicalSource || ""))) {
    console.log(`[builtin] FAIL: expected Fireprediction mass/volume, got ${payload.physicalSource}`);
    process.exitCode = 1;
  }
  const massValue = Number(physical.mass && physical.mass.value_kg);
  if (!(massValue > 0)) {
    console.log("[builtin] FAIL: expected a positive mass from the trained model");
    process.exitCode = 1;
  }
}

const estimate = latest.llmEstimate || null;
console.log(
  "[estimate] " +
    (estimate
      ? JSON.stringify({
          massKg: estimate.massKg,
          volumeM3: estimate.volumeM3,
          heatValueMjKg: estimate.heatValueMjKg,
          fireLoadMj: estimate.fireLoadMj,
          model: estimate.model,
          images: estimate.images,
          confidence: estimate.confidence,
          error: estimate.error,
        })
      : "none"),
);
if ((mode === "estimate" || process.env.FFX_LLM_ESTIMATE) && !estimate) {
  console.log("[estimate] FAIL: expected llmEstimate in the job response");
  process.exitCode = 1;
}
if (mode === "estimate" && estimate && !estimate.error && payload.physicalSource !== "llm-estimate") {
  console.log(`[estimate] FAIL: expected physicalSource=llm-estimate, got ${payload.physicalSource}`);
  process.exitCode = 1;
}

const segmentation = latest.llmSegmentation || null;
const segPayload = payload.segmentation || {};
console.log(
  "[segment] " +
    JSON.stringify({
      engine: (latest.job && latest.job.segmentationEngine) || "yolo",
      source: segPayload.source,
      targetMode: segPayload.targetMode,
      model: segmentation && segmentation.model,
      materials: segmentation && (segmentation.materials || []).map((row) => row.broad + ":" + row.share),
      llmBox: segmentation && segmentation.target,
      error: segmentation && segmentation.error,
      parts: (segPayload.parts || []).length,
      knownRatio: segPayload.statistics && segPayload.statistics.known_ratio,
    }),
);
if (mode === "segment" || process.env.FFX_SEGMENT === "llm") {
  if (!segmentation || segmentation.error) {
    console.log("[segment] FAIL: expected llmSegmentation in the job response");
    process.exitCode = 1;
  }
  if (segPayload.source !== "llm") {
    console.log(`[segment] FAIL: expected segmentation.source=llm, got ${segPayload.source}`);
    process.exitCode = 1;
  }
  if ((segPayload.parts || []).length) {
    console.log("[segment] FAIL: llm mode should not produce local YOLO parts");
    process.exitCode = 1;
  }
  if (fire.status === "unavailable") {
    console.log("[segment] FAIL: heat should still be computed in llm segmentation mode");
    process.exitCode = 1;
  }
}

if (singleCustom) {
  console.log(
    "[custom] " +
      JSON.stringify({
        segmentationModel: segmentation && segmentation.model,
        segmentationSource: segPayload.source,
        estimateModel: estimate && estimate.model,
        estimateChannel: estimate && estimate.channel,
        decision: composition.decision,
        heat: fire.totalHeatMj,
      }),
  );
  if (!segmentation || segmentation.error || segmentation.model !== "mock-vision") {
    console.log("[custom] FAIL: expected segmentation via custom model mock-vision");
    process.exitCode = 1;
  }
  if (segPayload.source !== "llm") {
    console.log(`[custom] FAIL: expected segmentation.source=llm, got ${segPayload.source}`);
    process.exitCode = 1;
  }
  if (!estimate || estimate.error || estimate.model !== "mock-text") {
    console.log("[custom] FAIL: expected estimate via custom model mock-text");
    process.exitCode = 1;
  }
  if (estimate && estimate.channel !== "api") {
    console.log(`[custom] FAIL: expected estimate.channel=api, got ${estimate.channel}`);
    process.exitCode = 1;
  }
  if (fire.status === "unavailable") {
    console.log("[custom] FAIL: heat should still be computed");
    process.exitCode = 1;
  }
}

if (reviewCustom) {
  const review = latest.payload && latest.payload.review ? latest.payload.review : {};
  const usedProvider = latest.payload && latest.payload.input && latest.payload.input.decider ? latest.payload.input.decider.reviewProvider : "";
  console.log(
    "[review-custom] " +
      JSON.stringify({ provider: usedProvider, status: review.status, type: review.furniture_type, selected: review.selected_furniture_type, heat: fire.totalHeatMj }),
  );
  if (usedProvider !== "custom") {
    console.log(`[review-custom] FAIL: expected reviewProvider=custom, got ${usedProvider}`);
    process.exitCode = 1;
  }
  if (!review || review.status !== "complete") {
    console.log(`[review-custom] FAIL: expected review.status=complete, got ${review && review.status}`);
    process.exitCode = 1;
  }
  if (fire.status === "unavailable") {
    console.log("[review-custom] FAIL: heat should still be computed");
    process.exitCode = 1;
  }
}

const cancelled = await call("/cancel", { method: "POST", body: { id: job.jobId } });
console.log(`[cancel] ${JSON.stringify(cancelled)}`);
console.log(`[vision] attachments saved=${savedImages.length} names=${savedImages.map((ref) => ref.name).join(",") || "-"}`);
if (wantImages && savedImages.length === 0) {
  console.log("[vision] FAIL: expected image attachments, none were saved");
  process.exitCode = 1;
}

for (const dispose of disposers.splice(0)) {
  try {
    dispose();
  } catch {
    /* ignore */
  }
}
server.close();
console.log("[done]");
