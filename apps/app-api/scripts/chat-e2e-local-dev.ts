import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appApiDir = resolve(scriptDir, "..");
const repoRoot = resolve(appApiDir, "../..");
const publicChatDir = resolve(repoRoot, "apps/public-chat-web");
const supervisorStartScript = resolve(repoRoot, "infra/local/start-supervisor-runtime.sh");
const defaultEmail = "help_bot@outlook.com";
const defaultName = "Campus Agent Smoke";
const defaultPrompt = "中央民族大学本科学生国家奖学金评审办法";
const defaultChatBaseUrl = "http://127.0.0.1:27011";
const defaultExecReadyzUrl = "http://127.0.0.1:27051/readyz";

for (const envPath of [resolve(appApiDir, ".env"), resolve(appApiDir, ".dev.vars")]) {
	try {
		process.loadEnvFile(envPath);
	} catch (error) {
		if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
			throw error;
		}
	}
}

interface LocalDevChatE2eArgs {
	chatBaseUrl: string;
	email: string;
	execReadyzUrl: string;
	expectPromptRuntimeState: string | null;
	expectResultKind: string;
	name: string;
	prompt: string;
	restartPublicChat: boolean;
	restartSupervisorRuntime: boolean;
	startupTimeoutMs: number;
}

function readArgValue(argv: string[], flag: string): string | null {
	const index = argv.indexOf(flag);
	if (index === -1) {
		return null;
	}
	return argv[index + 1]?.trim() || null;
}

function readOptionalValue(value: string | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function readPositiveInteger(value: string | null, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = Number.parseInt(value, 10);
	if (Number.isNaN(parsed) || parsed <= 0) {
		throw new Error(`Expected a positive integer, received: ${value}`);
	}
	return parsed;
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): LocalDevChatE2eArgs {
	return {
		chatBaseUrl: readArgValue(argv, "--chat-base-url") ?? defaultChatBaseUrl,
		email: (readArgValue(argv, "--email") ?? defaultEmail).toLowerCase(),
		execReadyzUrl: readArgValue(argv, "--exec-readyz-url") ?? defaultExecReadyzUrl,
		expectPromptRuntimeState: readArgValue(argv, "--expect-prompt-runtime-state"),
		expectResultKind: readArgValue(argv, "--expect-result-kind") ?? "answer",
		name: readArgValue(argv, "--name") ?? defaultName,
		prompt: readArgValue(argv, "--prompt") ?? defaultPrompt,
		restartPublicChat: argv.includes("--restart-public-chat"),
		restartSupervisorRuntime: argv.includes("--restart-supervisor-runtime"),
		startupTimeoutMs: readPositiveInteger(
			readArgValue(argv, "--startup-timeout-ms") ??
				readOptionalValue(env.CHAT_E2E_LOCAL_DEV_STARTUP_TIMEOUT_MS),
			180_000,
		),
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

function startSupervisorRuntime(args: LocalDevChatE2eArgs): void {
	runChecked(
		"bash",
		args.restartSupervisorRuntime
			? [supervisorStartScript, "up", "-d", "--force-recreate", "--no-build"]
			: [supervisorStartScript],
		repoRoot,
	);
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

function stopLocalPublicChatIfRequested(args: LocalDevChatE2eArgs): void {
	if (!args.restartPublicChat) {
		return;
	}

	const port = localPortFromUrl(args.chatBaseUrl);
	if (!port) {
		throw new Error("--restart-public-chat only supports localhost chat-base-url values.");
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
		throw new Error(`Failed to restart public-chat on port ${port}: ${result.stderr.trim()}`);
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

function startPublicChatLiveSmoke(): ChildProcess {
	return spawn("pnpm", ["--dir", publicChatDir, "dev:live-smoke"], {
		cwd: repoRoot,
		env: process.env,
		shell: process.platform === "win32",
		stdio: "inherit",
	});
}

async function waitForReadyzWhileChildAlive(
	url: string,
	timeoutMs: number,
	child: ChildProcess | null,
): Promise<void> {
	if (!child) {
		await waitForReadyz(url, timeoutMs);
		return;
	}

	await Promise.race([
		waitForReadyz(url, timeoutMs),
		new Promise<never>((_, reject) => {
			child.once("exit", (code, signal) => {
				reject(
					new Error(
						`public-chat dev:live-smoke exited before ${url} was ready (${signal ?? code ?? "unknown"}).`,
					),
				);
			});
		}),
	]);
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
	if (!readOptionalValue(process.env.APP_API_SMOKE_IDENTITY_PASSWORD)) {
		throw new Error("APP_API_SMOKE_IDENTITY_PASSWORD is required for local dev public/chat E2E.");
	}

	if (args.restartSupervisorRuntime || !(await isReadyzReady(args.execReadyzUrl))) {
		startSupervisorRuntime(args);
	}
	await waitForReadyz(args.execReadyzUrl, args.startupTimeoutMs);
	runChecked("pnpm", ["--dir", appApiDir, "db:bootstrap"], repoRoot);
	runChecked(
		"pnpm",
		[
			"--dir",
			appApiDir,
			"smoke-identity:provision",
			"--",
			"--email",
			args.email,
			"--name",
			args.name,
		],
		repoRoot,
	);

	const chatE2eArgs = [
		"--dir",
		appApiDir,
		"chat:e2e",
		"--",
		"--profile",
		"dev",
		"--email",
		args.email,
		"--name",
		args.name,
		"--prompt",
		args.prompt,
		"--chat-base-url",
		args.chatBaseUrl,
		"--exec-readyz-url",
		args.execReadyzUrl,
		"--expect-result-kind",
		args.expectResultKind,
	];
	if (args.expectPromptRuntimeState) {
		chatE2eArgs.push("--expect-prompt-runtime-state", args.expectPromptRuntimeState);
	}

	const chatReadyzUrl = new URL("/readyz", args.chatBaseUrl).toString();
	stopLocalPublicChatIfRequested(args);
	const publicChat =
		!args.restartPublicChat && (await isReadyzReady(chatReadyzUrl))
			? null
			: startPublicChatLiveSmoke();
	try {
		await waitForReadyzWhileChildAlive(chatReadyzUrl, args.startupTimeoutMs, publicChat);
		runChecked("pnpm", chatE2eArgs, repoRoot);
	} finally {
		if (publicChat) {
			await stopChild(publicChat);
		}
	}
}

void main(process.argv.slice(2)).catch(async (error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
