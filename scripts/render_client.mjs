// Dev harness: render the plugin's client half with REAL React (SSR) instead of stubs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const req = createRequire("D:/dsh workplace/.tmp/reactcheck/package.json");
const React = req("react");
const { renderToStaticMarkup } = req("react-dom/server");
const jsxRuntime = req("react/jsx-runtime");

const clientPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "lib", "client.js");
const src = fs.readFileSync(clientPath, "utf8");
console.log(`[render] client: ${clientPath} (${src.length} chars)`);

let captured = null;
const styleTags = [];
const storage = new Map();
const documentStub = {
  documentElement: { lang: "zh-CN" },
  createElement(tag) {
    return { tag, dataset: {}, setAttribute() {}, textContent: "" };
  },
  head: { appendChild(node) { styleTags.push(node); } },
  querySelector() { return null; },
  addEventListener() {},
  removeEventListener() {},
  body: { appendChild() {} },
};
const localStorageStub = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
};
const windowStub = {
  __ModuleLoader__: {
    load(entry) { captured = entry; },
  },
  addEventListener() {},
  removeEventListener() {},
  localStorage: localStorageStub,
  location: { href: "http://127.0.0.1/" },
};

const makeFetch = () => async (url) => ({
  ok: true,
  status: 200,
  url: String(url),
  text: async () => "{}",
  json: async () => ({}),
});

const sandbox = new Function(
  "window",
  "document",
  "navigator",
  "localStorage",
  "fetch",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  src,
);
sandbox(windowStub, documentStub, { language: "zh-CN" }, localStorageStub, makeFetch(), setTimeout, clearTimeout, setInterval, clearInterval);

if (!captured || typeof captured.factory !== "function") {
  console.error("[render] FAIL: client bundle did not register a factory");
  process.exit(1);
}
console.log(`[render] module id: ${captured.id}`);

const requireShim = (name) => {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return jsxRuntime;
  if (name === "react-dom/client") return { createRoot: () => ({ render() {}, unmount() {} }) };
  throw new Error(`unexpected require("${name}")`);
};

const mod = captured.factory(requireShim);
console.log(`[render] exports: ${Object.keys(mod).join(", ")} | inject=${JSON.stringify(mod.inject)}`);

const registrations = [];
const disposers = [];
const ctx = {
  slots: {
    inject(name, callback) {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    register(def, component) {
      registrations.push({ def, component });
      return () => {};
    },
  },
  effect(fn) {
    const dispose = fn();
    if (typeof dispose === "function") disposers.push(dispose);
    return () => {};
  },
  locale: {
    register() { return () => {}; },
    bind() { return (key) => key; },
  },
  get(name) {
    if (name === "layout") return { selectPanel() {}, closeRightbar() {} };
    return undefined;
  },
  on() {},
};

try {
  mod.apply(ctx);
} catch (error) {
  console.error("[render] FAIL apply():", error && error.stack ? error.stack : error);
  process.exit(1);
}
console.log(`[render] registrations: ${registrations.map((item) => `${item.def.name}${item.def.id || item.def.key ? ":" + (item.def.id || item.def.key) : ""}`).join(", ")}`);
console.log(`[render] css tags injected: ${styleTags.length}, css chars: ${styleTags.reduce((sum, tag) => sum + String(tag.textContent || "").length, 0)}`);

let failed = false;
for (const { def, component } of registrations) {
  const isIcon = def.name === "sidebar.panellist";
  const props = isIcon ? { size: 16, active: false } : {};
  try {
    const html = renderToStaticMarkup(React.createElement(component, props));
    console.log(`[render] ${def.name}${isIcon ? " icon" : " panel"} -> ok, html ${html.length} chars`);
    if (!isIcon) {
      const head = html.slice(0, 600).replace(/\s+/g, " ");
      console.log(`[render] panel head: ${head}`);
    }
  } catch (error) {
    failed = true;
    console.error(`[render] ${def.name} -> FAIL:`, error && error.stack ? error.stack : error);
  }
}

for (const dispose of disposers.splice(0)) {
  try {
    dispose();
  } catch {
    /* ignore */
  }
}
console.log(failed ? "[render] RESULT: FAIL" : "[render] RESULT: OK");
process.exit(failed ? 1 : 0);
