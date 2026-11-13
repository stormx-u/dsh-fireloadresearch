// Development harness that mimics what lib/index.js does: spawn the Python
// bridge with a JSON request on stdin, then answer "decision" messages locally.
// Usage: node scripts/test_host_llm.mjs [request.json] [--answer first|unknown]
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(here, "..", "..", ".tmp", "host-llm.log");
writeFileSync(LOG_PATH, "");
const rawLog = console.log.bind(console);
console.log = (...values) => {
  const line = values.map((value) => (typeof value === "string" ? value : String(value))).join(" ");
  appendFileSync(LOG_PATH, line + "\n");
  rawLog(line);
};
const BRIDGE = join(here, "..", "py", "bridge.py");
const PYTHON =
  process.env.FURNITURE_PYTHON ||
  "C:\\Users\\Administrator\\Documents\\Codex\\2026-11-06\\https-github-com-zhouyc98-fire-load\\work\\venv\\Scripts\\python.exe";

const args = process.argv.slice(2);
const requestPath = args.find((value) => !value.startsWith("--")) || join(here, "..", "..", ".tmp", "request-deepseek-host.json");
const answerIndex = args.indexOf("--answer");
const answerMode = answerIndex >= 0 ? args[answerIndex + 1] : "unknown";

function answersFor(mode, payload) {
  const answers = {};
  for (const question of payload?.questions || []) {
    const criteria = Object.keys(question.criteria || {});
    if (!criteria.length) continue;
    const extras = criteria.filter((name) => name !== "unknown");
    const probabilities = {};
    if (mode === "first" && extras.length && question.id !== "furniture_type" && question.id !== "visible_metal") {
      const share = 0.9;
      for (const name of criteria) probabilities[name] = (1 - share) / Math.max(1, criteria.length - 1);
      probabilities[extras[0]] = share;
    } else {
      for (const name of criteria) probabilities[name] = name === "unknown" ? 1 : 0;
    }
    const choice = Object.keys(probabilities).reduce((a, b) => (probabilities[a] >= probabilities[b] ? a : b));
    answers[question.id] = { choice, probabilities };
  }
  return answers;
}

const request = JSON.parse(readFileSync(requestPath, "utf8"));
const started = Date.now();
const child = spawn(PYTHON, ["-u", BRIDGE], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
let buffer = "";
let progressCount = 0;
let lastResult = null;

const guard = setTimeout(() => {
  console.log("[guard] no exit after 180s; killing child");
  child.kill();
}, 180000);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      console.log("[non-json]", line.slice(0, 160));
      continue;
    }
    if (message.type === "meta") console.log(`[meta] python=${message.python} toolA=${message.toolA}`);
    else if (message.type === "trace") console.log(`[trace +${message.elapsed}s] ${message.message}`);
    else if (message.type === "progress") {
      progressCount += 1;
      console.log(`[progress:${message.stage}] ${message.message}`);
    } else if (message.type === "decision") {
      const { payload } = message;
      console.log(`[host] decision ${message.id.slice(0, 8)} model=${payload?.requestedModel} questions=${(payload?.questionIds || []).length} promptChars=${payload?.prompt?.length}`);
      const answers = answersFor(answerMode, payload);
      child.stdin.write(JSON.stringify({ type: "decision-answer", id: message.id, answers, model: "local-harness" }) + "\n");
    } else if (message.type === "result") {
      lastResult = message.payload;
    } else if (message.type === "error") {
      console.log(`[error] ${message.errorType}: ${message.message}`);
      console.log((message.traceback || "").slice(-1500));
    }
  }
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

child.on("exit", (code) => {
  clearTimeout(guard);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[done] exit=${code} elapsed=${elapsed}s progress=${progressCount}`);
  if (!lastResult) {
    console.log("[fail] no result payload");
    process.exitCode = 1;
    return;
  }
  const fire = lastResult.fireLoad || {};
  console.log(`[size] ${(JSON.stringify(lastResult).length / 1024).toFixed(1)} KiB`);
  console.log(`[heat] ${fire.status} total=${fire.totalHeatMj} MJ interval=${JSON.stringify(fire.totalHeatIntervalMj)}`);
  console.log(`[physical] source=${lastResult.physicalSource} mass=${lastResult.physical?.mass?.value_kg} volume=${lastResult.physical?.volume?.value_m3}`);
  console.log(`[review] ${lastResult.review?.status} type=${lastResult.review?.selected_furniture_type} via=${lastResult.review?.furniture_type_source}`);
  console.log(`[decision] ${JSON.stringify(lastResult.composition?.decision)}`);
  console.log(`[materials] ${(lastResult.composition?.materials || []).length} rows, refinementGroups=${(lastResult.composition?.refinementStage?.groups || []).length}`);
  console.log(`[artifacts] ${JSON.stringify(lastResult.artifacts)}`);
  console.log(`[notices] ${JSON.stringify(lastResult.notices)}`);
});

child.stdin.write(JSON.stringify(request) + "\n");
