import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	buildCloudflareCliEnv,
	CommandTimeoutError,
	collectWorkerSecretPresence,
} from "./check-worker-secret-presence.ts";

export function runWorkerSecretPresenceSelfTest(): number {
	const canonicalWranglerEnv = buildCloudflareCliEnv({
		CLOUDFLARE_API_TOKEN: "legacy-token-must-not-win",
		CLOUDFLARE_AUTOMATION_TOKEN: "  canonical-token  ",
	});
	expectEqualJson(canonicalWranglerEnv.CLOUDFLARE_API_TOKEN, "canonical-token");
	expect(
		!("CLOUDFLARE_AUTOMATION_TOKEN" in canonicalWranglerEnv),
		"canonical token leaked to Wrangler",
	);
	const noCanonicalWranglerEnv = buildCloudflareCliEnv({
		CLOUDFLARE_API_TOKEN: "legacy-token-must-not-be-a-fallback",
	});
	expect(!("CLOUDFLARE_API_TOKEN" in noCanonicalWranglerEnv), "vendor token alias remained active");

	withFixture((root) => {
		writeText(
			join(root, "apps", "app-api", "wrangler.toml"),
			[
				'name = "app-api"',
				"",
				"[secrets]",
				'required = ["ROOT_ONLY_SECRET"]',
				"",
				"[env.staging.secrets]",
				'required = ["STAGING_ONLY_SECRET", "SHARED_SECRET"]',
				"",
			].join("\n"),
		);
		const seenCommands: string[][] = [];
		const status = collectWorkerSecretPresence({
			root,
			envName: "staging",
			appPaths: ["apps/app-api"],
			runCommand: (command) => {
				seenCommands.push(command);
				return {
					status: 0,
					stdout: JSON.stringify([{ name: "SHARED_SECRET" }]),
					stderr: "",
				};
			},
		});
		expect(!status.overall_ready, "missing secret should make status not ready");
		expectEqualJson(seenCommands[0]?.slice(0, 4), [
			"pnpm",
			"exec",
			"tsx",
			join(root, "scripts", "deploy", "run-wrangler-command.ts"),
		]);
		expectEqualJson(seenCommands[0]?.slice(4, 6), ["--cwd", join(root, "apps", "app-api")]);
		expectEqualJson(seenCommands[0]?.slice(6, 10), ["secret", "list", "--env", "staging"]);
		const appStatus = status.apps["apps/app-api"];
		expectEqualJson(appStatus?.required_secrets, ["SHARED_SECRET", "STAGING_ONLY_SECRET"]);
		expectEqualJson(appStatus?.configured_secrets, ["SHARED_SECRET"]);
		expectEqualJson(appStatus?.missing_secrets, ["STAGING_ONLY_SECRET"]);
	});

	withFixture((root) => {
		writeWorkerConfig(root, "apps/campus-web", ["SENTRY_DSN"]);
		const status = collectWorkerSecretPresence({
			root,
			envName: "staging",
			appPaths: ["apps/campus-web"],
			runCommand: (_command, options) => {
				expect(!("HTTP_PROXY" in options.env), "proxy env should be stripped");
				expect(
					options.env.NO_PROXY.includes("api.cloudflare.com"),
					"NO_PROXY should include Cloudflare",
				);
				return {
					status: 0,
					stdout: JSON.stringify([{ name: "SENTRY_DSN" }]),
					stderr: "",
				};
			},
		});
		expect(status.overall_ready, "configured secret should make status ready");
	});

	withFixture((root) => {
		writeWorkerConfig(root, "apps/campus-web", ["SENTRY_DSN"]);
		const status = collectWorkerSecretPresence({
			root,
			envName: "staging",
			appPaths: ["apps/campus-web"],
			runCommand: () => ({
				status: 1,
				stdout: "\u001b[33mWARNING\u001b[0m proxy noise",
				stderr: "\u001b[31mERROR\u001b[0m auth failed",
			}),
		});
		const error = status.apps["apps/campus-web"]?.error ?? "";
		expect(error.includes("WARNING proxy noise"), "stdout should be sanitized");
		expect(error.includes("ERROR auth failed"), "stderr should be sanitized");
		expect(!error.includes("\u001b"), "ANSI escapes should be removed");
	});

	withFixture((root) => {
		writeWorkerConfig(root, "apps/app-api", ["BETTER_AUTH_SECRET"]);
		const oldMaxAttempts = process.env.WORKER_SECRET_AUDIT_MAX_ATTEMPTS;
		process.env.WORKER_SECRET_AUDIT_MAX_ATTEMPTS = "2";
		let calls = 0;
		try {
			const status = collectWorkerSecretPresence({
				root,
				envName: "staging",
				appPaths: ["apps/app-api"],
				runCommand: (command) => {
					calls += 1;
					if (calls === 1) {
						throw new CommandTimeoutError(command, 30);
					}
					return {
						status: 0,
						stdout: JSON.stringify([{ name: "BETTER_AUTH_SECRET" }]),
						stderr: "",
					};
				},
			});
			expect(calls === 2, "timeout should be retried");
			expect(status.apps["apps/app-api"]?.ready === true, "retry success should be ready");
		} finally {
			restoreEnv("WORKER_SECRET_AUDIT_MAX_ATTEMPTS", oldMaxAttempts);
		}
	});

	withFixture((root) => {
		writeWorkerConfig(root, "apps/campus-web", ["SENTRY_DSN"]);
		const home = join(root, "fake-home");
		const oldHome = process.env.HOME;
		process.env.HOME = home;
		writeText(
			join(home, ".config", ".wrangler", "config", "default.toml"),
			[
				'oauth_token = "masked-access-token"',
				'expiration_time = "2026-04-18T20:14:50.499Z"',
				'refresh_token = "masked-refresh-token"',
				"",
			].join("\n"),
		);
		try {
			const status = collectWorkerSecretPresence({
				root,
				envName: "staging",
				appPaths: ["apps/campus-web"],
				runCommand: () => ({
					status: 1,
					stdout: "",
					stderr:
						"Failed to fetch auth token: 400 Bad Request\nNot logged in.\nCLOUDFLARE_API_TOKEN is required.",
				}),
			});
			const error = status.apps["apps/campus-web"]?.error ?? "";
			expect(
				error.includes("expired at 2026-04-18T20:14:50.499Z"),
				"expired OAuth guidance missing",
			);
			expect(
				error.includes("pnpm --dir apps/campus-web exec wrangler login"),
				"login guidance missing",
			);
			expect(error.includes("CLOUDFLARE_AUTOMATION_TOKEN"), "token guidance missing");
		} finally {
			restoreEnv("HOME", oldHome);
		}
	});

	console.log("check-worker-secret-presence self-test passed.");
	return 0;
}

function writeWorkerConfig(root: string, appPath: string, secrets: string[]): void {
	writeText(
		join(root, appPath, "wrangler.toml"),
		[
			`name = "${appPath.split("/").at(-1)}"`,
			"",
			"[env.staging.secrets]",
			`required = [${secrets.map((secret) => JSON.stringify(secret)).join(", ")}]`,
			"",
		].join("\n"),
	);
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "worker-secret-presence-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = value;
	}
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectEqualJson(actual: unknown, expected: unknown): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}
