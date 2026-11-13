/**
 * Self-diagnostics for dsh-furniture-fireload.
 *
 * The build environment for this plugin has no usable shell, so the plugin
 * verifies ITSELF and writes the machine-readable report to a stable path:
 *
 *   <reportDir>/selfcheck.json
 *
 * Three checks run on every activation:
 *   1. the browser half parses, loads through a stubbed __ModuleLoader__, and
 *      its apply() registers the panel against a stubbed client context
 *      (each registered component is rendered once with stubbed props/hooks);
 *   2. every Python file under py/ compiles (py_compile);
 *   3. the installed Python runtimes and the two source-tool paths are probed,
 *      including the heavy third-party imports the bridge needs.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = dirname(LIB_DIR);

/** Where the report lands; overridable for a different checkout. */
export function reportPath() {
	const explicit = process.env.DSH_FURNITURE_FIRELOAD_REPORT;
	if (typeof explicit === "string" && explicit.trim() !== "") return explicit;
	return join("D:\\dsh workplace", ".furniture-fireload", "selfcheck.json");
}

/* ------------------------------------------------------------------ */
/* 1. browser half                                                     */
/* ------------------------------------------------------------------ */

function stubReact() {
	const element = (type, props, ...children) => ({
		__element: true,
		type: typeof type === "function" ? type.name || "anonymous" : type,
		props: props ?? {},
		children,
	});
	const table = {
		createElement: element,
		cloneElement: (node, props) => ({ ...node, props: { ...(node.props ?? {}), ...(props ?? {}) } }),
		isValidElement: (value) => Boolean(value && value.__element),
		Fragment: "Fragment",
		StrictMode: "StrictMode",
		Suspense: "Suspense",
		useState: (init) => [typeof init === "function" ? init() : init, () => undefined],
		useReducer: (_reducer, init) => [init, () => undefined],
		useRef: (init) => ({ current: init }),
		useMemo: (fn) => fn(),
		useCallback: (fn) => fn,
		useEffect: () => undefined,
		useLayoutEffect: () => undefined,
		useInsertionEffect: () => undefined,
		useId: () => "stub-id",
		useContext: () => ({}),
		useTransition: () => [false, (fn) => (typeof fn === "function" ? fn() : undefined)],
		startTransition: (fn) => (typeof fn === "function" ? fn() : undefined),
		useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
		useDeferredValue: (value) => value,
		memo: (component) => component,
		forwardRef: (render) => render,
	};
	return new Proxy(table, {
		get(target, key) {
			if (key in target) return target[key];
			if (typeof key === "symbol") return undefined;
			return () => undefined;
		},
	});
}

function stubDocument() {
	const node = () => ({
		setAttribute() {},
		appendChild() {},
		removeChild() {},
		addEventListener() {},
		removeEventListener() {},
		dataset: {},
		style: {},
		textContent: "",
	});
	return {
		documentElement: { lang: "zh-CN", dataset: {}, style: {} },
		body: node(),
		head: node(),
		createElement: node,
		createElementNS: node,
		createTextNode: () => ({}),
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener() {},
		removeEventListener() {},
		visibilityState: "visible",
		baseURI: "http://127.0.0.1/",
	};
}

function stubContext() {
	const errors = [];
	const registered = [];
	const noop = () => undefined;
	const disposable = () => noop;
	const register = (definition, component) => {
		registered.push({ definition, component });
		return disposable();
	};
	const slots = {
		inject(_name, callback) {
			try {
				const dispose = callback();
				return typeof dispose === "function" ? dispose : noop;
			} catch (error) {
				errors.push(`slots.inject(${_name}) threw: ${message(error)}`);
				return noop;
			}
		},
		register,
		render: noop,
	};
	const chainable = (name) =>
		new Proxy(
			{},
			{
				get(_target, key) {
					if (key === "then") return undefined;
					if (key === "getSnapshot") return () => ({});
					if (key === "subscribe") return () => noop;
					if (key === "get") return () => ({});
					if (key === "list" || key === "items" || key === "groups") return [];
					if (typeof key === "symbol") return undefined;
					return (...args) => chainable(`${name}.${String(key)}`)(...args);
				},
			},
		);
	const services = new Proxy(
		{},
		{
			get(_target, key) {
				if (key === "locale")
					return {
						register: () => noop,
						bind: () => (key_) => String(key_),
						current: () => "zh-CN",
						subscribe: () => noop,
					};
				if (key === "theme") return { getTheme: () => "light", setTheme: noop, subscribe: () => noop };
				if (key === "layout")
					return {
						panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => noop },
						selectPanel: noop,
						openRightbar: noop,
						closeRightbar: noop,
					};
				if (key === "connection") return { api: chainable("connection.api"), on: () => noop, reset: () => noop };
				if (key === "slots") return slots;
				if (typeof key === "symbol") return undefined;
				return chainable(String(key));
			},
		},
	);
	const ctx = {
		slots,
		effect(fn) {
			try {
				const dispose = fn();
				return typeof dispose === "function" ? dispose : noop;
			} catch (error) {
				errors.push(`ctx.effect threw: ${message(error)}`);
				return noop;
			}
		},
		get: (name) => services[name],
		on: () => noop,
		once: () => noop,
		emit: () => undefined,
		logger: { info: noop, warn: noop, error: noop, debug: noop },
		locale: services.locale,
	};
	return { ctx, errors, registered };
}

function message(error) {
	if (error instanceof Error) return `${error.name}: ${error.message}`;
	return String(error);
}

/** Parse + load + apply the browser half inside stubs; report what it registered. */
export function checkClientBundle(source) {
	const findings = [];
	const registration = { registered: [], rendered: [] };
	try {
		// eslint-disable-next-line no-new-func
		new Function(source);
	} catch (error) {
		return { ok: false, findings: [`client.js syntax: ${message(error)}`], registration };
	}
	let captured;
	const windowStub = {
		__ModuleLoader__: {
			load(definition) {
				captured = definition;
			},
		},
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		location: { href: "http://127.0.0.1/", origin: "http://127.0.0.1", search: "" },
		localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
		matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
		setTimeout: (...args) => setTimeout(...args),
		clearTimeout: (...args) => clearTimeout(...args),
		setInterval: (...args) => setInterval(...args),
		clearInterval: (...args) => clearInterval(...args),
		requestAnimationFrame: (fn) => setTimeout(fn, 0),
		cancelAnimationFrame: (...args) => clearTimeout(...args),
	};
	const documentStub = stubDocument();
	const fetchStub = async () => ({
		ok: true,
		status: 200,
		json: async () => ({ ok: true }),
		text: async () => "{}",
	});
	try {
		// eslint-disable-next-line no-new-func
		const run = new Function("window", "document", "fetch", "EventSource", "localStorage", "navigator", "crypto", source);
		run(
			windowStub,
			documentStub,
			fetchStub,
			function EventSourceStub() {
				this.close = () => undefined;
				this.addEventListener = () => undefined;
			},
			windowStub.localStorage,
			{ language: "zh-CN", userAgent: "dsh-selfcheck" },
			globalThis.crypto ?? { randomUUID: () => "selfcheck-uuid" },
		);
	} catch (error) {
		return { ok: false, findings: [`client.js bootstrap: ${message(error)}`], registration };
	}
	if (!captured || typeof captured !== "object") {
		return { ok: false, findings: ["client.js never called window.__ModuleLoader__.load({...})"], registration };
	}
	if (typeof captured.id !== "string" || captured.id === "") findings.push("client bundle is missing its dsh.client id");
	if (typeof captured.factory !== "function") return { ok: false, findings: [...findings, "client bundle has no factory"], registration };
	const react = stubReact();
	const jsxRuntime = { jsx: react.createElement, jsxs: react.createElement, Fragment: "Fragment" };
	const seenModules = [];
	const requireStub = (id) => {
		seenModules.push(id);
		if (id === "react") return react;
		if (id === "react/jsx-runtime" || id === "react/jsx-dev-runtime") return jsxRuntime;
		if (id === "react-dom" || id === "react-dom/client")
			return { createRoot: () => ({ render() {}, unmount() {} }), render() {}, hydrate() {}, unmountComponentAtNode() {} };
		return new Proxy(
			{},
			{
				get: (_target, key) => {
					if (key === "then") return undefined;
					if (typeof key === "symbol") return undefined;
					return () => undefined;
				},
			},
		);
	};
	let exportsValue;
	try {
		exportsValue = captured.factory(requireStub);
	} catch (error) {
		return { ok: false, findings: [...findings, `client factory: ${message(error)}`], registration };
	}
	if (!exportsValue || typeof exportsValue.apply !== "function") return { ok: false, findings: [...findings, "client bundle exports no apply()"], registration };
	const stub = stubContext();
	try {
		exportsValue.apply(stub.ctx);
	} catch (error) {
		findings.push(`client apply(): ${message(error)}`);
	}
	findings.push(...stub.errors);
	registration.requiredModules = seenModules;
	registration.registered = stub.registered.map((entry) => ({
		slot: entry.definition?.name,
		id: entry.definition?.id,
		key: entry.definition?.key,
		component: typeof entry.component === "function" ? entry.component.name || "anonymous" : typeof entry.component,
	}));
	for (const entry of stub.registered) {
		if (typeof entry.component !== "function") continue;
		try {
			entry.component({ size: 16, api: {}, controller: {}, inject: {}, panel: {}, context: {} });
			registration.rendered.push({ component: entry.component.name || "anonymous", slot: entry.definition?.name, ok: true });
		} catch (error) {
			registration.rendered.push({ component: entry.component.name || "anonymous", slot: entry.definition?.name, ok: false, error: message(error) });
			findings.push(`render ${entry.component.name || "anonymous"}: ${message(error)}`);
		}
	}
	return { ok: findings.length === 0, findings, registration };
}

/* ------------------------------------------------------------------ */
/* 2. Python bridge                                                    */
/* ------------------------------------------------------------------ */

function runPython(exe, args, timeoutMs = 60000) {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		const child = spawn(exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				try {
					child.kill();
				} catch {
					/* already gone */
				}
				resolve({ ok: false, code: null, stdout, stderr: `${stderr}\n[timeout after ${timeoutMs}ms]` });
			}
		}, timeoutMs);
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ ok: false, code: null, stdout, stderr: message(error) });
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ ok: code === 0, code, stdout, stderr });
		});
	});
}

/** List every .py file under dir, recursively but bounded. */
export function pythonFiles(dir, depth = 0) {
	const files = [];
	if (depth > 4 || !existsSync(dir)) return files;
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		let entry;
		try {
			entry = statSync(full);
		} catch {
			continue;
		}
		if (entry.isDirectory()) files.push(...pythonFiles(full, depth + 1));
		else if (name.endsWith(".py")) files.push(full);
	}
	return files;
}

const COMPILE_SCRIPT = [
	"import json, sys, py_compile",
	"results = []",
	"for path in sys.argv[1:]:",
	"    try:",
	"        py_compile.compile(path, cfile=None, doraise=True)",
	"        results.append({'path': path, 'ok': True})",
	"    except SyntaxError as error:",
	"        results.append({'path': path, 'ok': False, 'error': f'{error.__class__.__name__}: {error.msg} (line {error.lineno})'})",
	"    except Exception as error:",
	"        results.append({'path': path, 'ok': False, 'error': f'{error.__class__.__name__}: {error}'})",
	"print(json.dumps({'version': sys.version.split()[0], 'results': results}, ensure_ascii=False))",
].join("\n");

/** Compile every Python file with the given interpreter. */
export async function checkPythonSyntax(exe, files) {
	if (!existsSync(exe)) return { ok: false, findings: [`python missing: ${exe}`], files: [] };
	if (files.length === 0) return { ok: true, findings: [], files: [] };
	const result = await runPython(exe, ["-c", COMPILE_SCRIPT, ...files], 120000);
	const findings = [];
	if (!result.ok) {
		findings.push(`py_compile failed (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 1500)}`);
		return { ok: false, findings, files: [] };
	}
	let payload;
	try {
		payload = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
	} catch (error) {
		return { ok: false, findings: [`py_compile output was not JSON: ${message(error)}`], files: [] };
	}
	for (const row of payload.results) if (!row.ok) findings.push(`${row.path}: ${row.error}`);
	return { ok: findings.length === 0, python: payload.version, findings, files: payload.results };
}

/* ------------------------------------------------------------------ */
/* 3. runtime + source-tool probe                                      */
/* ------------------------------------------------------------------ */

const PROBE_SCRIPT = [
	"import json, sys",
	"out = {'version': sys.version.split()[0], 'executable': sys.executable, 'modules': {}}",
	"for name in ('numpy', 'PIL', 'cv2', 'torch', 'ultralytics', 'requests', 'onnxruntime', 'joblib'):",
	"    try:",
	"        module = __import__(name)",
	"        out['modules'][name] = getattr(module, '__version__', 'ok')",
	"    except Exception as error:",
	"        out['modules'][name] = None",
	"print(json.dumps(out, ensure_ascii=False))",
].join("\n");

export async function probePython(exe, timeoutMs = 60000) {
	if (!existsSync(exe)) return { path: exe, ok: false, error: "not found" };
	const result = await runPython(exe, ["-c", PROBE_SCRIPT], timeoutMs);
	if (!result.ok) return { path: exe, ok: false, error: (result.stderr || result.stdout).trim().slice(0, 800) };
	try {
		const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
		return { path: exe, ok: true, ...payload };
	} catch (error) {
		return { path: exe, ok: false, error: `probe output was not JSON: ${message(error)}` };
	}
}

/* ------------------------------------------------------------------ */
/* report                                                              */
/* ------------------------------------------------------------------ */

export function writeReport(payload) {
	const target = reportPath();
	try {
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
		return { ok: true, path: target };
	} catch (error) {
		return { ok: false, path: target, error: message(error) };
	}
}

export function readClientSource() {
	const file = join(LIB_DIR, "client.js");
	if (!existsSync(file)) return { ok: false, error: `missing ${file}` };
	try {
		return { ok: true, path: file, source: readFileSync(file, "utf8") };
	} catch (error) {
		return { ok: false, path: file, error: message(error) };
	}
}

/** Full self-check; resolved with the report payload it also wrote to disk.
 *
 * The report is rewritten after every stage so a slow or stuck probe still
 * leaves the earlier findings on disk for inspection.
 */
export async function runSelfCheck(options = {}) {
	const startedAt = new Date().toISOString();
	const report = { plugin: "dsh-furniture-fireload", startedAt, pluginDir: PLUGIN_DIR, stage: "started", checks: {} };
	const flush = (stage) => {
		report.stage = stage;
		report.updatedAt = new Date().toISOString();
		report.report = writeReport(report);
		return report;
	};
	flush("started");

	const client = readClientSource();
	report.checks.client = client.ok
		? { path: client.path, bytes: client.source.length, ...checkClientBundle(client.source) }
		: { ok: false, findings: [client.error] };
	flush("client");

	const files = pythonFiles(join(PLUGIN_DIR, "py"));
	report.checks.python = { files: files.map((file) => file.replace(PLUGIN_DIR, "<plugin>")) };
	flush("python-listed");

	const candidates = options.pythonCandidates ?? defaultPythonCandidates();
	const probes = [];
	for (const exe of candidates) {
		// eslint-disable-next-line no-await-in-loop
		probes.push(await probePython(exe, options.probeTimeoutMs ?? 45000));
		report.checks.runtimes = probes.slice();
		flush(`probe:${exe}`);
	}
	const working = probes.find((probe) => probe.ok && probe.modules?.torch && probe.modules?.ultralytics) ?? probes.find((probe) => probe.ok);
	report.checks.pythonInterpreter = working?.path ?? null;
	if (working) {
		report.checks.pythonSyntax = await checkPythonSyntax(working.path, files);
		flush("python-syntax");
	} else {
		report.checks.pythonSyntax = { ok: false, findings: ["no usable interpreter"] };
	}

	const toolA = options.toolA ?? "C:\\Users\\Administrator\\Documents\\Codex\\2026-11-06\\https-github-com-zhouyc98-fire-load\\outputs\\furniture-material-tool";
	const toolB = options.toolB ?? "D:\\Fireprediction";
	report.checks.sources = {
		toolA,
		toolAExists: existsSync(toolA),
		toolAModules: {
			analysis: existsSync(join(toolA, "analysis.py")),
			composition: existsSync(join(toolA, "composition.py")),
			auto_workflow: existsSync(join(toolA, "auto_workflow.py")),
			physical: existsSync(join(toolA, "physical.py")),
			fire_load: existsSync(join(toolA, "fire_load.py")),
			catalog: existsSync(join(toolA, "catalog.py")),
			composition_report: existsSync(join(toolA, "composition_report.py")),
			dataCsv: existsSync(join(toolA, "data", "材料分类与物性表.csv")),
			frequencyPrior: existsSync(join(toolA, "data", "frequency_prior.json")),
			coCoModel: existsSync(join(toolA, "models", "furniture-coco.pt")),
		},
		toolB,
		toolBExists: existsSync(toolB),
		toolBCli: existsSync(join(toolB, "FirepredictionCLI.exe")),
		toolBGui: existsSync(join(toolB, "Fireprediction.exe")),
		toolBCatalog: existsSync(join(toolB, "examples", "catalog.json")),
		toolBHistory: existsSync(join(toolB, "data", "history.sqlite3")),
	};

	report.finishedAt = new Date().toISOString();
	return flush("finished");
}

export function defaultPythonCandidates() {
	return [
		"C:\\Users\\Administrator\\Documents\\Codex\\2026-11-06\\https-github-com-zhouyc98-fire-load\\work\\venv\\Scripts\\python.exe",
		"C:\\Users\\Administrator\\Documents\\Codex\\2026-11-06\\https-github-com-zhouyc98-fire-load\\work\\python\\cpython-3.12.16-windows-x86_64-none\\python.exe",
		"D:\\DSH1\\DSH Desktop\\resources\\office-runtime\\primary-runtime\\dependencies\\python\\python.exe",
	];
}
