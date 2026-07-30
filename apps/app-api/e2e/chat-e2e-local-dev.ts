import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appApiDir = resolve(scriptDir, "..");
const repoRoot = resolve(appApiDir, "../..");
const campusWebDir = resolve(repoRoot, "apps/campus-web");
const campusWebViteBin = resolve(campusWebDir, "node_modules/vite/bin/vite.js");
const defaultPrompt = "示例大学本科学生国家奖学金评审办法";
const defaultChatBaseUrl = "http://127.0.0.1:27014";
const defaultExecReadyzUrl = "http://127.0.0.1:27051/readyz";

interface LocalDevChatE2eArgs {
	captchaToken: string;
	chatBaseUrl: string;
	email: string;
	execReadyzUrl: string;
	expectModelExecutionState: string | null;
	expectResultKind: string;
	password: string;
	prompt: string;
	restartCampusWeb: boolean;
	startupTimeoutMs: number;
}

function readArgValue(argv: string[], flag: string): string | null {
	const index = argv.indexOf(flag);
	if (index === -1) {
		return null;
	}
	return argv[index + 1]?.trim() || null;
}

function readPositiveInteger(value: string | null, defaultValue: number): number {
	if (!value) {
		return defaultValue;
	}
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed <= 0) {
		throw new Error(`Expected a positive integer, received: ${value}`);
	}
	return parsed;
}

function parseArgs(argv: string[]): LocalDevChatE2eArgs {
	const captchaToken = readArgValue(argv, "--captcha-token");
	const email = readArgValue(argv, "--email");
	const password = readArgValue(argv, "--password");
	if (!captchaToken) {
		throw new Error("--captcha-token is required.");
	}
	if (!email) {
		throw new Error("--email is required.");
	}
	if (!password) {
		throw new Error("--password is required.");
	}
	return {
		captchaToken,
		chatBaseUrl: readArgValue(argv, "--chat-base-url") ?? defaultChatBaseUrl,
		email: email.toLowerCase(),
		execReadyzUrl: readArgValue(argv, "--exec-readyz-url") ?? defaultExecReadyzUrl,
		expectModelExecutionState: readArgValue(argv, "--expect-model-execution-state"),
		expectResultKind: readArgValue(argv, "--expect-result-kind") ?? "answer",
		password,
		prompt: readArgValue(argv, "--prompt") ?? defaultPrompt,
		restartCampusWeb: argv.includes("--restart-campus-web"),
		startupTimeoutMs: readPositiveInteger(readArgValue(argv, "--startup-timeout-ms"), 180_000),
	};
}

function runChecked(command: string, args: string[], cwd: string, env = process.env): void {
	const result = spawnSync(command, args, {
		cwd,
		env,
		shell: process.platform === "win32",
		stdio: "inherit",
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? "signal"}.`);
	}
}

function localPortFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
			return null;
		}
		return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
	} catch {
		return null;
	}
}

function stopLocalCampusWebIfRequested(args: LocalDevChatE2eArgs): void {
	if (!args.restartCampusWeb) {
		return;
	}

	const port = localPortFromUrl(args.chatBaseUrl);
	if (!port) {
		throw new Error("--restart-campus-web only supports localhost chat-base-url values.");
	}

	const result = spawnSync(
		"bash",
		[
			"-lc",
			[
				"command -v lsof >/dev/null || exit 0",
				`pids="$(lsof -ti tcp:${port})"`,
				'[ -n "$pids" ] || exit 0',
				"kill $pids 2>/dev/null || true",
				'for _ in $(seq 1 20); do [ -z "$(lsof -ti tcp:' +
					port +
					')" ] && exit 0; sleep 0.25; done',
				"kill -KILL $pids 2>/dev/null || true",
			].join("; "),
		],
		{
			cwd: repoRoot,
			encoding: "utf8",
			shell: process.platform === "win32",
		},
	);
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		throw new Error(`Failed to restart campus-web on port ${port}: ${result.stderr.trim()}`);
	}
}

async function waitForReadyz(url: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError = "";

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, {
				headers: {
					accept: "application/json",
				},
				signal: AbortSignal.timeout(5_000),
			});
			if (response.status === 200) {
				return;
			}
			lastError = `status ${response.status}: ${await response.text()}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
	}

	throw new Error(`Timed out waiting for ${url}. Last error: ${lastError}`);
}

async function isReadyzReady(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, {
			headers: {
				accept: "application/json",
			},
			signal: AbortSignal.timeout(5_000),
		});
		return response.status === 200;
	} catch {
		return false;
	}
}

function startCampusWebLiveSmoke(): ChildProcess {
	return spawn(
		process.execPath,
		[campusWebViteBin, "--host", "127.0.0.1", "--port", "27014", "--strictPort"],
		{
			cwd: campusWebDir,
			env: {
				...process.env,
				CLOUDFLARE_ENV: "local",
				CAMPUS_WEB_LIVE_SMOKE: "1",
				WRANGLER_DISABLE_EXPERIMENTAL_WARNING: "1",
				XDG_CONFIG_HOME: "./.wrangler-home",
			},
			stdio: "inherit",
		},
	);
}

export async function waitForReadyzWhileChildAlive(
	url: string,
	timeoutMs: number,
	child: ChildProcess | null,
	deps: {
		waitForReadyz?: (url: string, timeoutMs: number) => Promise<void>;
	} = {},
): Promise<void> {
	const waitForReadyzImpl = deps.waitForReadyz ?? waitForReadyz;
	if (!child) {
		await waitForReadyzImpl(url, timeoutMs);
		return;
	}

	let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
	let settled = false;
	const exitWatcher = new Promise<never>((_, reject) => {
		onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			if (settled) {
				return;
			}
			reject(
				new Error(
					`campus-web live smoke exited before ${url} was ready (${signal ?? code ?? "unknown"}).`,
				),
			);
		};
		child.once("exit", onExit);
	});

	try {
		await Promise.race([waitForReadyzImpl(url, timeoutMs), exitWatcher]);
		settled = true;
	} finally {
		if (onExit) {
			child.off("exit", onExit);
		}
	}
}

async function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	await new Promise<void>((resolvePromise) => {
		const timeout = setTimeout(resolvePromise, 5_000);
		child.once("exit", () => {
			clearTimeout(timeout);
			resolvePromise();
		});
		child.kill("SIGTERM");
	});
}

async function main(argv: string[]): Promise<void> {
	const args = parseArgs(argv);

	if (!(await isReadyzReady(args.execReadyzUrl))) {
		throw new Error(
			`Execution-control runtime is not ready at ${args.execReadyzUrl}. Start the runtime through the platform-owned deployment path before running local chat E2E.`,
		);
	}
	await waitForReadyz(args.execReadyzUrl, args.startupTimeoutMs);
	runChecked(
		"node",
		[`${appApiDir}/scripts/run-with-local-env.ts`, "node", "./ops/db/prepare-local.ts"],
		repoRoot,
	);
	const chatE2eArgs = [
		"--dir",
		appApiDir,
		"exec",
		"tsx",
		"./e2e/chat-e2e.ts",
		"--profile",
		"dev",
		"--email",
		args.email,
		"--password",
		args.password,
		"--captcha-token",
		args.captchaToken,
		"--prompt",
		args.prompt,
		"--chat-base-url",
		args.chatBaseUrl,
		"--exec-readyz-url",
		args.execReadyzUrl,
		"--expect-result-kind",
		args.expectResultKind,
	];
	if (args.expectModelExecutionState) {
		chatE2eArgs.push("--expect-model-execution-state", args.expectModelExecutionState);
	}

	const chatReadyzUrl = new URL("/readyz", args.chatBaseUrl).toString();
	stopLocalCampusWebIfRequested(args);
	const campusWeb =
		!args.restartCampusWeb && (await isReadyzReady(chatReadyzUrl))
			? null
			: startCampusWebLiveSmoke();
	try {
		await waitForReadyzWhileChildAlive(chatReadyzUrl, args.startupTimeoutMs, campusWeb);
		runChecked("pnpm", chatE2eArgs, repoRoot);
	} finally {
		if (campusWeb) {
			await stopChild(campusWeb);
		}
	}
}

const isMainModule =
	typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
	void main(process.argv.slice(2)).catch(async (error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
