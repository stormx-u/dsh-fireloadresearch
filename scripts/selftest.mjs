/**
 * Developer self-test runner (not shipped to the plugin runtime).
 *
 *   node scripts/selftest.mjs [--client] [--python] [--probes] [--all]
 *
 * Uses the same diagnostics module the plugin loads at activation time, so the
 * results match what the panel's "自检" button would report.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	checkClientBundle,
	checkPythonSyntax,
	defaultPythonCandidates,
	pythonFiles,
	probePython,
	readClientSource,
	reportPath,
	runSelfCheck,
} from "../lib/diag.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const want = (flag) => argv.length === 0 || argv.includes(flag) || argv.includes("--all");

function heading(text) {
	console.log(`\n=== ${text} ===`);
}

if (want("--client")) {
	heading("client bundle");
	const client = readClientSource();
	if (!client.ok) {
		console.log(`FAIL ${client.error}`);
	} else {
		const result = checkClientBundle(client.source);
		console.log(`path: ${client.path} (${client.source.length} bytes)`);
		console.log(`ok: ${result.ok}`);
		console.log(`entry id: ${result.registration?.entryId ?? "(not captured)"}`);
		console.log(`requires: ${JSON.stringify(result.registration?.requiredModules ?? [])}`);
		console.log(`registered: ${JSON.stringify(result.registration?.registered ?? [], null, 2)}`);
		console.log(`rendered: ${JSON.stringify(result.registration?.rendered ?? [], null, 2)}`);
		for (const finding of result.findings) console.log(`FAIL ${finding}`);
		if (result.ok) console.log("client OK");
	}
}

if (want("--python")) {
	heading("python files");
	const files = pythonFiles(join(root, "py"));
	console.log(files.map((file) => `  ${file.replace(root, "<plugin>")}`).join("\n") || "  (none)");
	const candidate = defaultPythonCandidates().find((exe) => exe && exe.length > 0);
	const interpreters = [process.env.DSH_TEST_PYTHON, candidate, "python"].filter(Boolean);
	for (const exe of interpreters) {
		const result = await probePython(exe, 60000);
		console.log(`\ninterpreter ${exe}`);
		console.log(`  ok=${result.ok} version=${result.version ?? "?"} modules=${JSON.stringify(result.modules ?? {})}`);
		if (!result.ok) console.log(`  error: ${result.error}`);
		if (result.ok && files.length) {
			const syntax = await checkPythonSyntax(exe, files);
			console.log(`  syntax ok=${syntax.ok}`);
			for (const finding of syntax.findings) console.log(`  FAIL ${finding}`);
		}
		if (result.ok) break;
	}
}

if (want("--probes")) {
	heading("environment");
	const report = await runSelfCheck({});
	console.log(`report: ${JSON.stringify(report.report)}`);
	console.log(`stage: ${report.stage}`);
	console.log(`client: ok=${report.checks.client?.ok}`);
	console.log(`sources: ${JSON.stringify(report.checks.sources, null, 2)}`);
}

if (want("--report")) {
	heading("report file");
	try {
		console.log(readFileSync(reportPath(), "utf8"));
	} catch (error) {
		console.log(`FAIL ${error.message}`);
	}
}
