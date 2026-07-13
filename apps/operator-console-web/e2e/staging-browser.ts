#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { loadRepoStagingEnvFile } from "../../../scripts/deploy/lib/repo-env.ts";

const DEFAULT_BASE_URL = "https://panel-staging.mucwiki-edge.link";
const DEFAULT_EVIDENCE_DIR = "var/staging-evidence/operator-console-browser-e2e";

interface NetworkRecord {
	method: string;
	status: number | null;
	url: string;
}

loadRepoStagingEnvFile(import.meta.url, "../../..");

function optionalValue(value) {
	const trimmed = value?.trim();
	return trimmed || null;
}

function parseArgs(argv, env = process.env) {
	const args = {
		baseUrl:
			optionalValue(env.STAGING_OPERATOR_CONSOLE_BASE_URL) ??
			optionalValue(env.OPERATOR_CONSOLE_STAGING_BASE_URL) ??
			DEFAULT_BASE_URL,
		evidenceDir: optionalValue(env.E2E_QA_EVIDENCE_DIR) ?? DEFAULT_EVIDENCE_DIR,
		headed: false,
		storageState: optionalValue(env.OPERATOR_CONSOLE_STORAGE_STATE) ?? "",
		timeoutMs: Number.parseInt(
			optionalValue(env.OPERATOR_CONSOLE_BROWSER_E2E_TIMEOUT_MS) ?? "120000",
			10,
		),
	};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (token === "--headed") {
			args.headed = true;
			continue;
		}
		const next = optionalValue(argv[index + 1]);
		if (token === "--base-url" && next) {
			args.baseUrl = next;
			index += 1;
			continue;
		}
		if (token === "--evidence-dir" && next) {
			args.evidenceDir = next;
			index += 1;
			continue;
		}
		if (token === "--storage-state" && next) {
			args.storageState = next;
			index += 1;
			continue;
		}
		throw new Error(`Unknown or incomplete argument: ${token}`);
	}
	if (!args.storageState) {
		throw new Error(
			"OPERATOR_CONSOLE_STORAGE_STATE or --storage-state is required; service-token smoke does not prove human operator browser E2E.",
		);
	}
	return args;
}

function assertNoDirectRuntimeRequests(records) {
	const forbidden = records.filter((record) =>
		/temporal|execution-control|sentry|axiom|langfuse|postgres|pg\b/i.test(record.url),
	);
	if (forbidden.length > 0) {
		throw new Error(
			`Operator browser directly reached forbidden runtime URLs: ${JSON.stringify(forbidden)}`,
		);
	}
}

function assertNoBrokenNetwork(records) {
	const broken = records.filter((record) => record.status === null || record.status >= 500);
	if (broken.length > 0) {
		throw new Error(
			`Operator browser E2E saw broken network records: ${JSON.stringify(broken.slice(0, 8))}`,
		);
	}
}

async function visit(page, path, evidenceDir, screenshotName) {
	await page.goto(path, { waitUntil: "domcontentloaded" });
	await page.locator("body").waitFor();
	await page.screenshot({ fullPage: true, path: resolve(evidenceDir, screenshotName) });
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	await mkdir(args.evidenceDir, { recursive: true });
	const browser = await chromium.launch({ headless: !args.headed });
	const network: NetworkRecord[] = [];
	const consoleErrors: string[] = [];
	const context = await browser.newContext({
		baseURL: args.baseUrl,
		storageState: args.storageState,
		viewport: { height: 900, width: 1366 },
	});
	const page = await context.newPage();
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("response", (response) => {
		network.push({
			method: response.request().method(),
			status: response.status(),
			url: response.url(),
		});
	});
	page.on("requestfailed", (request) => {
		network.push({
			method: request.method(),
			status: null,
			url: request.url(),
		});
	});
	try {
		const routes = [
			["/", "operator-shell.png"],
			["/operations/provider-config", "operator-provider-config.png"],
		];
		for (const [path, screenshotName] of routes) {
			await visit(page, path, args.evidenceDir, screenshotName);
		}
		assertNoBrokenNetwork(network);
		assertNoDirectRuntimeRequests(network);
		const result = {
			checks: {
				consoleErrorCount: consoleErrors.length,
				networkFailureCount: network.filter(
					(record) => record.status === null || record.status >= 500,
				).length,
				routesVisited: routes.map(([path]) => path),
			},
			evidenceDir: args.evidenceDir,
			passed: consoleErrors.length === 0,
			surface: "operator-console-web",
		};
		await writeFile(
			resolve(args.evidenceDir, "operator-console-browser-e2e.json"),
			JSON.stringify(result, null, 2),
		);
		console.log(JSON.stringify(result, null, 2));
		if (!result.passed) {
			process.exitCode = 1;
		}
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
