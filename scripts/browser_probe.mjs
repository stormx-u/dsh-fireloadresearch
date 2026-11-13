// Dev-only: drive the real GUI in headless Chrome via CDP and reproduce the batch click flow.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;
const GUI = "http://127.0.0.1:43129/";
const PROFILE = "D:\\dsh workplace\\.tmp\\chrome-ffx";

fs.rmSync(PROFILE, { recursive: true, force: true });

const child = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--window-size=1400,1000",
  GUI,
], { stdio: "ignore", detached: false });

async function targets() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  throw new Error("chrome devtools not reachable");
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const events = [];
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method) events.push(msg);
});

function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`cdp timeout ${method}`));
      }
    }, 60000);
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

await send("Runtime.enable");
await send("Page.enable");

// wait for the app shell
for (let i = 0; i < 60; i += 1) {
  const ok = await evaluate("Boolean(document.querySelector('.ffx-root') || document.body.textContent.length > 50)");
  if (ok) break;
  await sleep(500);
}
await sleep(1500);

const report = await evaluate(`(async () => {
  const out = { steps: [], calls: [], errors: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!window.__ffxProbe) {
    window.__ffxProbe = { calls: [] };
    const orig = window.fetch;
    window.fetch = function (input, init) {
      const entry = { url: String(typeof input === "string" ? input : input.url), method: (init && init.method) || "GET" };
      const promise = orig.apply(this, arguments);
      promise.then(
        (res) => { entry.status = res.status; },
        (error) => { entry.error = String(error && error.message || error); },
      );
      window.__ffxProbe.calls.push(entry);
      return promise;
    };
  }
  // open the panel from the sidebar
  const entryIcon = document.querySelector('[data-dsh-panel-entry="furniture-fireload"]');
  out.steps.push("panelEntry=" + Boolean(entryIcon));
  if (entryIcon) { entryIcon.click(); await sleep(1200); }
  out.steps.push("root=" + Boolean(document.querySelector('.ffx-root')));
  const tabs = Array.from(document.querySelectorAll('.ffx-tab'));
  out.steps.push("tabs=" + JSON.stringify(tabs.map((t) => t.textContent)));
  const batchTab = tabs.find((t) => /批量/.test(t.textContent));
  if (batchTab) { batchTab.click(); await sleep(900); }
  out.steps.push("batchView=" + Boolean(document.querySelector('.ffx-batch')));
  const buttons = Array.from(document.querySelectorAll('.ffx-batch button')).map((b) => ({
    text: b.textContent, disabled: b.disabled, cls: b.className,
  }));
  out.steps.push("buttons=" + JSON.stringify(buttons));
  const inputs = Array.from(document.querySelectorAll('.ffx-batch input.ffx-input'));
  out.steps.push("inputs=" + JSON.stringify(inputs.map((i) => i.placeholder)));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  const xlsxInput = inputs.find((i) => /xlsx/i.test(i.placeholder || ""));
  const imagesInput = inputs.find((i) => /家具图片/.test(i.placeholder || ""));
  if (xlsxInput) { xlsxInput.focus(); setter.call(xlsxInput, "D:\\\\dsh workplace\\\\.tmp\\\\batch-fixture\\\\\\u8f93\\u5165.xlsx"); xlsxInput.dispatchEvent(new Event("input", { bubbles: true })); }
  if (imagesInput) { imagesInput.focus(); setter.call(imagesInput, "D:\\\\dsh workplace\\\\.tmp\\\\batch-fixture\\\\images"); imagesInput.dispatchEvent(new Event("input", { bubbles: true })); }
  await sleep(400);
  out.steps.push("typed=" + JSON.stringify([xlsxInput && xlsxInput.value, imagesInput && imagesInput.value]));
  const errorBefore = document.querySelector('.ffx-batch .ffx-error');
  out.steps.push("errorBefore=" + (errorBefore ? errorBefore.textContent : ""));
  const startButton = Array.from(document.querySelectorAll('.ffx-batch button')).find((b) => /开始批量/.test(b.textContent));
  out.steps.push("startBtn=" + Boolean(startButton) + " disabled=" + (startButton && startButton.disabled));
  if (startButton) { startButton.click(); await sleep(2500); }
  const errorAfter = document.querySelector('.ffx-batch .ffx-error');
  out.steps.push("errorAfter=" + (errorAfter ? errorAfter.textContent : ""));
  out.steps.push("startBtnText=" + (startButton ? startButton.textContent : ""));
  out.calls = window.__ffxProbe.calls.slice(-12);
  out.errors = Array.from(document.querySelectorAll('.ffx-batch .ffx-error')).map((e) => e.textContent);
  return out;
})()`);

console.log(JSON.stringify(report, null, 2));
ws.close();
child.kill();
