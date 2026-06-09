import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE_SCRIPT_TIMEOUT_MS = 15_000;

let tempRoots: string[] = [];

afterEach(() => {
	for (const tempRoot of tempRoots) {
		rmSync(tempRoot, { force: true, recursive: true });
	}
	tempRoots = [];
});

describe("campus staging account smoke script", () => {
	it("exposes a staging-only account browser smoke command", () => {
		const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as {
			scripts: Record<string, string>;
		};

		expect(packageJson.scripts["account:smoke:staging"]).toBe(
			"node ../../scripts/run-with-staging-smoke-env.mjs --cwd apps/campus-web node ./scripts/staging-account-browser-smoke.mjs",
		);
		expect(packageJson.scripts["account:smoke:staging"]).not.toContain("dev:live-smoke");
		expect(packageJson.scripts["account:smoke:staging"]).not.toContain("localhost");
		expect(packageJson.scripts["account:smoke:staging"]).not.toContain("127.0.0.1");
	});

	it("rejects local targets for the campus staging account browser smoke", () => {
		const scriptSource = readFileSync(
			join(appDir, "scripts", "staging-account-browser-smoke.mjs"),
			"utf8",
		);
		const tempRoot = mkdtempSync(join(tmpdir(), "campus-web-account-browser-smoke-"));
		tempRoots.push(tempRoot);
		const scriptPath = join(tempRoot, "scripts", "staging-account-browser-smoke.mjs");
		mkdirSync(join(tempRoot, "scripts"), { recursive: true });
		writeFileSync(scriptPath, scriptSource, "utf8");

		const result = spawnSync(
			process.execPath,
			[
				scriptPath,
				"--campus-base-url",
				"http://127.0.0.1:27014",
				"--smoke-auth-secret",
				"smoke-secret",
			],
			{
				cwd: tempRoot,
				env: process.env,
				encoding: "utf8",
				timeout: SMOKE_SCRIPT_TIMEOUT_MS,
			},
		);

		expect(result.status).toBe(1);
		expect(result.error).toBeUndefined();
		expect(result.stderr).toContain(
			"campus staging smoke requires https://campus-staging.mucwiki-edge.link",
		);
	});

	it("writes campus account smoke artifacts without hub naming", () => {
		const scriptSource = readFileSync(
			join(appDir, "scripts", "staging-account-browser-smoke.mjs"),
			"utf8",
		);

		expect(scriptSource).toContain("Campus Account Browser Smoke");
		expect(scriptSource).toContain("campus-account-browser-smoke.md");
		expect(scriptSource).toContain("中央民族大学校园问答");
		expect(scriptSource).toContain("问校园信息，从这里开始。");
		expect(scriptSource).toContain("饭堂分布图");
		expect(scriptSource).not.toContain("Hub account browser smoke");
		expect(scriptSource).not.toContain("hubBaseUrl");
		expect(scriptSource).not.toContain("hub-staging.mucwiki-edge.link");
	});
});
