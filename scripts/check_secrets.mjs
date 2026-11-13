#!/usr/bin/env node
// 提交前/手动运行：扫描工作区里是否混入了 API 密钥。
// 用法：node scripts/check_secrets.mjs   （命中则退出码 1）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".runtime", ".tmp", "dist", "archive", "generations"]);
// 这些文件里有大量哈希/SHA256，属于正常内容
const SKIP_FILES = new Set([
  "py/vendor/fireprediction/models/manifest.json",
  "py/vendor/material/data/frequency_prior.json",
  "py/vendor/fireprediction/licenses/inventory.json",
]);
const SKIP_PATH_PREFIXES = ["py/vendor/fireprediction/licenses/"];
const TEXT_EXT = /\.(py|js|mjs|json|md|markdown|yml|yaml|txt|toml|cfg|ini|csv|html|css|ps1|cmd|bat|sh)$/i;

const RULES = [
  { name: "OpenRouter 密钥", re: /sk-or-v1-[A-Za-z0-9]{16,}/g },
  { name: "API 密钥（sk-）", re: /\bsk-[A-Za-z0-9_-]{24,}/g },
  { name: "Authorization Bearer 令牌", re: /Bearer\s+[A-Za-z0-9\-_.]{24,}/g },
  { name: "环境变量里的密钥", re: /(?:OPENROUTER_API_KEY|DEEPSEEK_API_KEY|OPENAI_API_KEY)\s*=\s*[A-Za-z0-9\-_]{16,}/g },
  { name: "JS/JSON 里的 apiKey 字面量", re: /(?:apiKey|api_key|reviewApiKey)["']?\s*[:=]\s*["'][A-Za-z0-9\-_.]{16,}["']/g },
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(ROOT, abs).replaceAll("\\", "/");
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      walk(abs, out);
    } else {
      if (SKIP_FILES.has(rel)) continue;
      if (SKIP_PATH_PREFIXES.some((p) => rel.startsWith(p))) continue;
      if (!TEXT_EXT.test(ent.name)) continue;
      out.push(abs);
    }
  }
  return out;
}

const mask = (s) => s.slice(0, 8) + "*".repeat(Math.max(0, s.length - 8));

let files = 0;
const hits = [];
for (const file of walk(ROOT)) {
  let text;
  try {
    if (fs.statSync(file).size > 4 * 1024 * 1024) continue;
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  files++;
  for (const rule of RULES) {
    const found = text.match(rule.re);
    if (!found) continue;
    for (const value of found.slice(0, 3)) {
      const line = text.slice(0, text.indexOf(value)).split(/\r?\n/).length;
      hits.push({ file: path.relative(ROOT, file), line, rule: rule.name, sample: mask(value) });
    }
  }
}

if (hits.length === 0) {
  console.log(`[secrets] clean — ${files} 个文本文件，未发现 API 密钥。`);
  process.exit(0);
}

console.error(`[secrets] 发现 ${hits.length} 处疑似密钥，已阻止提交：`);
for (const h of hits) console.error(`  - ${h.file}:${h.line}  [${h.rule}]  ${h.sample}`);
console.error("如确认不是密钥（例如文档示例），请调整该处写法或把它加到 scripts/check_secrets.mjs 的白名单。");
process.exit(1);
