// Dev harness: mount the plugin panel in jsdom with real React 18,
// feed it the API responses captured from scripts/test_host.mjs, then
// click "开始分析" and verify the flow nodes + result render.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.FFX_PLUGIN_ROOT ? path.resolve(process.env.FFX_PLUGIN_ROOT) : path.dirname(here);
const req = createRequire("D:/dsh workplace/.tmp/reactcheck/package.json");
const { JSDOM } = req("jsdom");
const React = req("react");
const ReactDOMClient = req("react-dom/client");

const dumpDir = process.env.FFX_DUMP || "D:/dsh workplace/.tmp/ffx-dump";
const readDump = (name) => JSON.parse(fs.readFileSync(path.join(dumpDir, name), "utf8"));
const jobFile = fs.readdirSync(dumpDir).find((name) => name.startsWith("job_id_"));
if (!jobFile) throw new Error(`no job dump in ${dumpDir}`);
const dumps = {
  state: readDump("state.json"),
  models: readDump("models.json"),
  jobs: readDump("jobs.json"),
  job: readDump(jobFile),
};
console.log(`[ui] dumps: ${Object.keys(dumps).join(", ")} | job=${jobFile}`);

const dom = new JSDOM('<!doctype html><html lang="zh-CN"><head></head><body><div id="host"></div></body></html>', {
  url: "http://127.0.0.1:43129/",
  pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
for (const [key, value] of Object.entries({
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Event: window.Event,
  localStorage: window.localStorage,
})) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const requests = [];
const fetchStub = async (url, options = {}) => {
  const target = String(url);
  const method = (options.method || "GET").toUpperCase();
  requests.push(`${method} ${target}`);
  const reply = (body, status = 200) => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
  if (/\/browse\?/.test(target)) {
    const kind = (/kind=([a-z]+)/.exec(target) || [])[1] || "";
    const dirs = target.includes("path=&")
      ? []
      : [{ name: "images", path: "D:\\dsh workplace\\.tmp\\batch-fixture\\images" }];
    const files = target.includes("images")
      ? [{ name: "001.jpg", path: "D:\\dsh workplace\\.tmp\\batch-fixture\\images\\001.jpg" }]
      : kind === "xlsx"
        ? [{ name: "输入.xlsx", path: "D:\\dsh workplace\\.tmp\\batch-fixture\\输入.xlsx" }]
        : [];
    return reply({
      ok: true,
      path: target.includes("images") ? "D:\\dsh workplace\\.tmp\\batch-fixture\\images" : "D:\\dsh workplace\\.tmp\\batch-fixture",
      parent: "D:\\dsh workplace\\.tmp",
      roots: [{ name: "D:\\", path: "D:\\" }],
      dirs,
      files,
    });
  }
  if (method === "POST" && /\/jobs$/.test(target)) {
    return reply({ ok: true, jobId: "smoke-job", job: { id: "smoke-job", state: "queued" } });
  }
  if (method === "POST") return reply({ ok: true });
  if (/\/state$/.test(target)) return reply(dumps.state);
  if (/\/models$/.test(target)) return reply(dumps.models);
  if (/\/job\?/.test(target)) return reply(dumps.job);
  if (/\/jobs$/.test(target)) return reply(dumps.jobs);
  return reply({ ok: true });
};
globalThis.fetch = fetchStub;
window.fetch = fetchStub;

const clientPath = path.join(root, "lib", "client.js");
const src = fs.readFileSync(clientPath, "utf8");
// Pre-seed the persisted form so the panel starts with an image and dimensions.
window.localStorage.setItem(
  "dsh-furniture-fireload.form",
  JSON.stringify({
    imagePath: "D:\\dsh workplace\\.tmp\\upload\\bed.jpg",
    imageName: "bed.jpg",
    category: "床",
    width: 200,
    height: 60,
    depth: 180,
    unit: "cm",
    useFireprediction: false,
    massKg: 45,
    volumeM3: 0.95,
    volumeKind: "envelope",
    conf: 0.25,
    metalConf: 0.2,
    metalEnabled: true,
    device: "cpu",
  }),
);
let captured = null;
window.__ModuleLoader__ = { load(entry) { captured = entry; } };
const sandbox = new Function("window", "document", "navigator", "localStorage", "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval", src);
sandbox(window, window.document, window.navigator, window.localStorage, fetchStub, setTimeout, clearTimeout, setInterval, clearInterval);
if (!captured) throw new Error("client bundle did not register");

const jsxRuntime = req("react/jsx-runtime");
const requireShim = (name) => {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return jsxRuntime;
  if (name === "react-dom/client") return ReactDOMClient;
  throw new Error(`unexpected require("${name}")`);
};
const mod = captured.factory(requireShim);

const registrations = [];
const ctx = {
  slots: {
    inject(name, callback) { callback(); return () => {}; },
    register(def, component) { registrations.push({ def, component }); return () => {}; },
  },
  effect(fn) { fn(); return () => {}; },
  locale: { register() { return () => {}; }, bind() { return (key) => key; } },
  get(name) { return name === "layout" ? { selectPanel() {} } : undefined; },
  on() {},
};
mod.apply(ctx);

const panel = registrations.find((item) => item.def.name === "main");
if (!panel) throw new Error("no main panel registered");

const container = window.document.getElementById("host");
const rootClient = ReactDOMClient.createRoot(container);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
const originalError = console.error;
console.error = (...args) => {
  errors.push(args.map((value) => (value && value.stack) || String(value)).join(" "));
  originalError(...args);
};

await React.act(async () => {
  rootClient.render(React.createElement(panel.component, {}));
  await sleep(120);
});

const text = () => container.textContent || "";
const expectLabels = ["家具类别", "开始分析", "DeepSeek", "LLM 直接估计", "批量分析", "材质区域识别", "宿主模型直接判定", "0 自定义模型", "编辑模型库", "添加一个模型"];
const missing = expectLabels.filter((label) => !text().includes(label));
console.log(`[ui] initial render: html ${container.innerHTML.length} chars, text ${text().length} chars`);
console.log(`[ui] missing labels: ${missing.length ? missing.join(", ") : "none"}`);

const buttons = Array.from(container.querySelectorAll("button"));
console.log(`[ui] buttons: ${buttons.map((button) => (button.textContent || "").trim()).filter(Boolean).join(" | ")}`);

// 0 自定义模型: clicking "添加一个模型" must actually add an editable row.
const addModelButton = buttons.find((button) => (button.textContent || "").trim() === "添加一个模型");
const rowsBefore = container.querySelectorAll(".ffx-custom").length;
if (!addModelButton) {
  console.log("[ui] FAIL: 添加一个模型 button not found");
} else {
  await React.act(async () => {
    addModelButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(120);
  });
  const rowsAfter = container.querySelectorAll(".ffx-custom").length;
  console.log(`[ui] custom model rows: before=${rowsBefore} after=${rowsAfter}`);
  if (rowsAfter <= rowsBefore) {
    console.log("[ui] FAIL: 添加一个模型 did not add a row");
  }
}
const startButton = Array.from(container.querySelectorAll("button")).find((button) => /开始分析/.test(button.textContent || ""));
if (!startButton) {
  console.log("[ui] FAIL: 开始分析 button not found");
} else {
  await React.act(async () => {
    startButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(300);
  });
  console.log(`[ui] after click: html ${container.innerHTML.length} chars`);
  await React.act(async () => {
    await sleep(1600);
  });
  await React.act(async () => {
    await sleep(1200);
  });
  const hasHeat = /636\.3|636 MJ|火灾荷载/.test(text());
  console.log(`[ui] result rendered: heat=${hasHeat}`);
  const resultText = text().replace(/\s+/g, " ");
  const resultExpectations = [
    [/家具.{0,3}重量|重量/, "重量节点"],
    [/家具.{0,3}体积|体积/, "体积节点"],
    [/平均密度（含空腔）/, "体密度格子"],
    [/材料平均密度（除空腔）/, "材料密度格子"],
    [/材质组合/, "材质组合节点"],
    [/材质的占比|质量占比/, "占比节点"],
    [/热值/, "热值节点"],
    [/热值口径：低位热值/, "热值口径说明"],
    [/火灾荷载/, "火灾荷载节点"],
    [/\d+(\.\d+)?\s?MJ/, "热量数值"],
    [/合计/, "质量占比合计行"],
    [/大类质量占比/, "大类质量占比列"],
    [/该材质占全家具/, "该材质占全家具列"],
    [/种材质合计/, "材质合计说明"],
    [/LLM 直接估计/, "LLM 直接估计卡片"],
    [/置信度/, "估计置信度"],
    [/与主流程/, "与主流程偏差"],
    [/模型说明|按床体比例/, "估计模型说明"],
  ];
  const resultMissing = resultExpectations.filter(([pattern]) => !pattern.test(resultText)).map(([, label]) => label);
  console.log(`[ui] result nodes missing: ${resultMissing.length ? resultMissing.join(", ") : "none"}`);
  missing.push(...resultMissing);

  // 折叠 / 展开交互：材质表默认折叠，可展开、可收起
  const rowCount = () => container.querySelectorAll("table tbody tr").length;
  const foldButton = Array.from(container.querySelectorAll("button")).find((button) => /展开全部/.test(button.textContent || ""));
  const collapsedRows = rowCount();
  const foldTotal = container.querySelectorAll("button").length;
  console.log(`[ui] fold: buttons=${foldTotal} collapsedRows=${collapsedRows} foldText=${foldButton ? (foldButton.textContent || "").trim() : "none"}`);
  if (!foldButton) {
    missing.push("折叠按钮");
  } else {
    await React.act(async () => {
      foldButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await sleep(150);
    });
    const expandedRows = rowCount();
    const collapseButton = Array.from(container.querySelectorAll("button")).find((button) => /收起（/.test(button.textContent || ""));
    console.log(`[ui] fold: expandedRows=${expandedRows} collapseButton=${collapseButton ? "yes" : "no"}`);
    if (!(expandedRows > collapsedRows)) missing.push("展开后行数未增加");
    if (!collapseButton) missing.push("收起按钮");
    if (collapseButton) {
      await React.act(async () => {
        collapseButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await sleep(150);
      });
      const backRows = rowCount();
      console.log(`[ui] fold: backRows=${backRows}`);
      if (backRows !== collapsedRows) missing.push("收起后行数未恢复");
    }
  }
  // 页签：单件分析 ↔ 批量分析
  const batchTab = Array.from(container.querySelectorAll("button")).find((button) => /批量分析/.test(button.textContent || ""));
  if (!batchTab) {
    missing.push("批量分析页签");
  } else {
    await React.act(async () => {
      batchTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await sleep(500);
    });
    const batchText = text().replace(/\s+/g, " ");
    const batchExpectations = [
      [/批量输入/, "批量输入卡片"],
      [/Excel 文件/, "Excel 路径输入"],
      [/图片文件夹/, "图片文件夹输入"],
      [/下载模板/, "下载模板链接"],
      [/开始批量/, "开始批量按钮"],
      [/逐件结果/, "逐件结果卡片"],
      [/编号/, "编号列"],
      [/沿用「单件分析」/, "沿用单件设置说明"],
      [/质量体积来源/, "质量体积来源选择"],
      [/材质判定模型/, "材质判定模型选择"],
      [/宿主模型（自动选择）|（自动：宿主默认模型）/, "宿主模型选项"],
    ];
    const batchMissing = batchExpectations.filter(([pattern]) => !pattern.test(batchText)).map(([, label]) => label);
    console.log(`[ui] batch view: missing=${batchMissing.length ? batchMissing.join(", ") : "none"}`);
    missing.push(...batchMissing);
    fs.writeFileSync(path.join(dumpDir, "panel-batch.html"), container.innerHTML, "utf8");

    // 批量页的交互：用「浏览…」选 Excel 与图片文件夹 → 点「开始批量」→ 应发出 POST /batch
    const clickText = async (pattern, scope = container, settle = 400) => {
      const button = Array.from(scope.querySelectorAll("button")).find((item) => pattern.test((item.textContent || "").trim()));
      if (button) {
        await React.act(async () => {
          button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
          await sleep(settle);
        });
      }
      return button;
    };
    const xlsxInput = Array.from(container.querySelectorAll("input.ffx-input")).find((input) => /xlsx/i.test(input.placeholder || ""));
    const imagesInput = Array.from(container.querySelectorAll("input.ffx-input")).find((input) => /家具图片/.test(input.placeholder || ""));
    console.log(`[ui] batch inputs: xlsx=${Boolean(xlsxInput)} images=${Boolean(imagesInput)}`);
    if (!xlsxInput || !imagesInput) {
      missing.push("批量输入框");
    } else {
      const before = requests.length;
      // 1) Excel：浏览… → 点文件
      const browseButtons = Array.from(container.querySelectorAll("button")).filter((button) => /^浏览…$/.test((button.textContent || "").trim()));
      console.log(`[ui] browse buttons: ${browseButtons.length}`);
      if (browseButtons.length < 2) missing.push("浏览按钮");
      await React.act(async () => {
        if (browseButtons[0]) browseButtons[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await sleep(500);
      });
      const modal = container.querySelector(".ffx-modal");
      console.log(`[ui] picker modal (xlsx): ${Boolean(modal)} entries=${modal ? modal.querySelectorAll(".ffx-entry").length : 0}`);
      if (!modal) missing.push("Excel 选择器未打开");
      const fileEntry = modal ? Array.from(modal.querySelectorAll(".ffx-entry")).find((entry) => /输入\.xlsx/.test(entry.textContent || "")) : null;
      await React.act(async () => {
        if (fileEntry) fileEntry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await sleep(400);
      });
      console.log(`[ui] after pick xlsx: value=${JSON.stringify(xlsxInput.value)}`);

      // 2) 图片文件夹：浏览… → 进入 images → 选择此文件夹
      const browseButtons2 = Array.from(container.querySelectorAll("button")).filter((button) => /^浏览…$/.test((button.textContent || "").trim()));
      await React.act(async () => {
        if (browseButtons2[1]) browseButtons2[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await sleep(500);
      });
      const modal2 = container.querySelector(".ffx-modal");
      const dirEntry = modal2 ? Array.from(modal2.querySelectorAll(".ffx-entry")).find((entry) => /images/.test(entry.textContent || "")) : null;
      await React.act(async () => {
        if (dirEntry) dirEntry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await sleep(400);
      });
      const pickFolder = await clickText(/^选择此文件夹$/, container.querySelector(".ffx-modal") || container, 400);
      console.log(`[ui] picker folder: dirEntry=${Boolean(dirEntry)} picked=${Boolean(pickFolder)} imagesDir=${JSON.stringify(imagesInput.value)}`);

      const startButton = Array.from(container.querySelectorAll("button")).find((button) => /^开始批量$/.test((button.textContent || "").trim()));
      console.log(`[ui] batch start button: ${startButton ? "found" : "missing"} disabled=${startButton ? startButton.disabled : "-"}`);
      if (!startButton) {
        missing.push("开始批量按钮不可点");
      } else {
        let reached = 0;
        const onCapture = () => {
          reached += 1;
        };
        startButton.addEventListener("click", onCapture, true);
        const beforeErrors = errors.length;
        await React.act(async () => {
          startButton.click();
          await sleep(500);
        });
        const posted = requests.slice(before).some((entry) => /^POST .*\/batch$/.test(entry));
        console.log(`[ui] batch click: captured=${reached} text=${JSON.stringify((startButton.textContent || "").trim())} newRequests=${JSON.stringify(requests.slice(before))} posted=${posted}`);
        console.log(`[ui] batch click errors: ${JSON.stringify(errors.slice(beforeErrors))}`);
        if (!posted) missing.push("点击开始批量没有发出 POST /batch");
        const errorText = (container.querySelector(".ffx-error") || {}).textContent || "";
        if (errorText) console.log(`[ui] batch error text: ${errorText}`);
      }
    }
    const singleTab = Array.from(container.querySelectorAll("button")).find((button) => /单件分析/.test(button.textContent || ""));
    if (!singleTab) {
      missing.push("单件分析页签");
    } else {
      await React.act(async () => {
        singleTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await sleep(400);
      });
      if (!/家具类别/.test(text())) missing.push("返回单件页签失败");
    }
  }

  console.log(`[ui] result text: ${resultText.slice(0, 700)}`);
  fs.writeFileSync(path.join(dumpDir, "panel.html"), container.innerHTML, "utf8");
}

console.log(`[ui] fetch calls: ${requests.length}`);
console.log(`[ui] console.error count: ${errors.length}`);
for (const message of errors.slice(0, 5)) console.log(`[ui] error: ${message.slice(0, 400)}`);

console.error = originalError;
console.log(errors.length === 0 && missing.length === 0 ? "[ui] RESULT: OK" : "[ui] RESULT: FAIL");
process.exit(errors.length === 0 && missing.length === 0 ? 0 : 1);
