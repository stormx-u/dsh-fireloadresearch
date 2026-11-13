// Real-network check of the free OpenRouter vision review, using the key that the
// plugin already stores in its own settings file (never printed, never written to
// a request file).  Dev-only script; not shipped in the plugin runtime.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const SETTINGS = path.join(process.env.LOCALAPPDATA || os.homedir(), "dsh-furniture-fireload", "settings.json");
const PY = "C:\\Users\\Administrator\\Documents\\Codex\\2026-11-06\\https-github-com-zhouyc98-fire-load\\work\\venv\\Scripts\\python.exe";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE = path.join(path.dirname(SCRIPT_DIR), "py", "bridge.py");
const TOOLA = "C:\\Users\\Administrator\\Documents\\Codex\\2026-11-06\\https-github-com-zhouyc98-fire-load\\outputs\\furniture-material-tool";

const settings = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
const key = String((settings.review && settings.review.apiKey) || process.env.OPENROUTER_API_KEY || "").trim();
if (!key) {
  console.log("[vision] no stored OpenRouter key, nothing to test");
  process.exit(0);
}
console.log(`[vision] key present (${key.slice(0, 6)}…, ${key.length} chars)`);

const MODE = (process.argv[2] || "review").trim();
const request = {
  jobId: "test-free-vision-" + Date.now(),
  imagePath: path.join(TOOLA, "examples", "bed.jpg"),
  category: "床",
  furnitureType: "床",
  dimensions: { width: 200, height: 60, depth: 180, unit: "cm" },
  massKg: 45,
  volumeM3: 0.95,
  useFireprediction: false,
  device: "cpu",
  decider:
    MODE === "judge"
      ? // exactly what the user had selected in the panel: the free vision model
        // is the construction judge (old records carry a stale "deepseek-flash" id)
        { provider: "free-vision", reviewProvider: "none", reviewApiKey: "" }
      : { provider: "stub", reviewProvider: "openrouter-free", reviewModel: "" },
  segmentation: { conf: 0.25, metalConf: 0.2, metalEnabled: true },
  outputDir: path.join("D:\\dsh workplace\\.tmp", "job-test-vision-" + MODE),
};
console.log(`[vision] mode = ${MODE}`);

const child = spawn(PY, ["-u", BRIDGE], {
  cwd: TOOLA,
  env: { ...process.env, PYTHONIOENCODING: "utf-8", OPENROUTER_API_KEY: key },
  stdio: ["pipe", "pipe", "pipe"],
});
child.stdin.write(JSON.stringify(request) + "\n");
child.stdin.end();

let buffer = "";
const guard = setTimeout(() => {
  console.log("[vision] TIMEOUT 240s, killing");
  child.kill();
}, 240000);

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.type === "progress") console.log(`  [${message.stage}/${message.level || "info"}] ${message.message}`);
    else if (message.type === "error") console.log(`[vision] ERROR ${message.message}`);
    else if (message.type === "result") {
      const payload = message.payload || {};
      const review = payload.review || {};
      const aiMeta = review.metadata || {};
      const composition = payload.composition || {};
      console.log("[vision] result:");
      console.log("  review.status =", review.status);
      console.log("  review.model  =", aiMeta.model || aiMeta.requested_model || "(none)");
      console.log("  review.api    =", aiMeta.api_family);
      console.log("  composition.decision =", JSON.stringify(composition.decision));
      console.log("  composition.warnings =", JSON.stringify(composition.warnings || []));
      console.log("  top warnings  =", JSON.stringify((payload.warnings || []).slice(0, 6)));
      console.log("  heat MJ       =", payload.fireLoad && payload.fireLoad.totalHeatMj);
      console.log("  elapsed ms    =", payload.elapsedMs);
    }
  }
});
child.stderr.on("data", (chunk) => process.stderr.write("[py-err] " + chunk.toString("utf8")));
child.on("exit", (code) => {
  clearTimeout(guard);
  console.log("[vision] exit code", code);
  process.exit(code === 0 ? 0 : 1);
});
