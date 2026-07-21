import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	buildCloudflareCliEnv,
	buildSecretDeleteCommand,
	buildSecretListCommand,
	buildSecretPutCommand,
	buildSecretViewCommand,
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

	const commandFixture = {
		root: "/repo",
		appPath: "apps/app-api",
		envName: "staging",
	};
	expectEqualJson(buildSecretListCommand(commandFixture).slice(-5), [
		"versions",
		"list",
		"--env",
		"staging",
		"--json",
	]);
	expectEqualJson(buildSecretViewCommand({ ...commandFixture, versionId: "version-2" }).slice(-6), [
		"versions",
		"view",
		"version-2",
		"--env",
		"staging",
		"--json",
	]);
	expectEqualJson(
		buildSecretPutCommand({ ...commandFixture, secretName: "REQUIRED_SECRET" }).slice(-6),
		["versions", "secret", "put", "REQUIRED_SECRET", "--env", "staging"],
	);
	expectEqualJson(
		buildSecretDeleteCommand({ ...commandFixture, secretName: "OLD_SECRET" }).slice(-6),
		["versions", "secret", "delete", "OLD_SECRET", "--env", "staging"],
	);

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
				return successfulWranglerResponse(command, ["SHARED_SECRET"]);
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
		expectEqualJson(seenCommands[0]?.slice(6), ["versions", "list", "--env", "staging", "--json"]);
		expectEqualJson(seenCommands[1]?.slice(6), [
			"versions",
			"view",
			"version-2",
			"--env",
			"staging",
			"--json",
		]);
		const appStatus = status.apps["apps/app-api"];
		expectEqualJson(appStatus?.required_secrets, ["SHARED_SECRET", "STAGING_ONLY_SECRET"]);
		expectEqualJson(appStatus?.configured_secrets, ["SHARED_SECRET"]);
		expectEqualJson(appStatus?.missing_secrets, ["STAGING_ONLY_SECRET"]);
		expectEqualJson(appStatus?.unexpected_secrets, []);
		expectEqualJson(appStatus?.recommended_put_commands.length, 1);
		expectEqualJson(appStatus?.recommended_delete_commands, []);
	});

	withFixture((root) => {
		writeWorkerConfig(root, "apps/campus-web", []);
		const status = collectWorkerSecretPresence({
			root,
			envName: "staging",
			appPaths: ["apps/campus-web"],
			runCommand: (command) => successfulWranglerResponse(command, ["SENTRY_DSN"]),
		});
		const appStatus = status.apps["apps/campus-web"];
		expect(!status.overall_ready, "unexpected secret should make status not ready");
		expectEqualJson(appStatus?.required_secrets, []);
		expectEqualJson(appStatus?.unexpected_secrets, ["SENTRY_DSN"]);
		expectEqualJson(appStatus?.recommended_delete_commands.length, 1);
		expect(
			appStatus?.recommended_delete_commands[0]?.includes("versions secret delete SENTRY_DSN") ===
				true,
			"unexpected secret should recommend a versioned delete",
		);
	});

	withFixture((root) => {
		writeWorkerConfig(root, "apps/campus-web", ["SENTRY_DSN"]);
		const status = collectWorkerSecretPresence({
			root,
			envName: "staging",
			appPaths: ["apps/campus-web"],
			runCommand: (command, options) => {
				expect(!("HTTP_PROXY" in options.env), "proxy env should be stripped");
				expect(
					options.env.NO_PROXY.includes("api.cloudflare.com"),
					"NO_PROXY should include Cloudflare",
				);
				return successfulWranglerResponse(command, ["SENTRY_DSN"]);
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
		const oldTimeout = process.env.WORKER_SECRET_AUDIT_TIMEOUT_SECONDS;
		const oldMaxAttempts = process.env.WORKER_SECRET_AUDIT_MAX_ATTEMPTS;
		delete process.env.WORKER_SECRET_AUDIT_TIMEOUT_SECONDS;
		delete process.env.WORKER_SECRET_AUDIT_MAX_ATTEMPTS;
		let calls = 0;
		try {
			const status = collectWorkerSecretPresence({
				root,
				envName: "staging",
				appPaths: ["apps/app-api"],
				runCommand: (command, options) => {
					calls += 1;
					expect(options.timeout === 120, "default Wrangler audit timeout should be 120s");
					throw new CommandTimeoutError(command, options.timeout);
				},
			});
			expect(calls === 1, "default Wrangler audit should not retry a timed-out command");
			expect(
				status.apps["apps/app-api"]?.error?.includes("after 120s") === true,
				"default timeout should be reported",
			);
		} finally {
			restoreEnv("WORKER_SECRET_AUDIT_TIMEOUT_SECONDS", oldTimeout);
			restoreEnv("WORKER_SECRET_AUDIT_MAX_ATTEMPTS", oldMaxAttempts);
		}
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
					return successfulWranglerResponse(command, ["BETTER_AUTH_SECRET"]);
				},
			});
			expect(calls === 3, "version list timeout should be retried before version view");
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

function successfulWranglerResponse(command: string[], secrets: string[]) {
	const operation = command[7];
	if (operation === "list") {
		return {
			status: 0,
			stdout: JSON.stringify([
				{ id: "version-1", number: 1 },
				{ id: "version-2", number: 2 },
			]),
			stderr: "",
		};
	}
	if (operation === "view") {
		return {
			status: 0,
			stdout: JSON.stringify({
				resources: {
					bindings: secrets.map((name) => ({ name, type: "secret_text" })),
				},
			}),
			stderr: "",
		};
	}
	throw new Error(`unexpected Wrangler command: ${command.join(" ")}`);
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
