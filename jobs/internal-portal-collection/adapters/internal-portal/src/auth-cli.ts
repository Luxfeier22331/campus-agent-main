import { type ChildProcess, execFile as execFileCallback, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
	type InternalPortalConfig,
	loadInternalPortalEnv,
	resolveInternalPortalConfig,
} from "./config.js";
import { resolveInternalPortalCredential } from "./ops-web-credential-resolver.js";
import { checkPortalAuthentication } from "./portal.js";
import { formatSafeErrorMessage } from "./safe-error.js";

const execFile = promisify(execFileCallback);
const MANAGED_LOCAL_ENV_MARKER = "# Managed by pnpm dev:init. Do not edit.";
export const AUTH_CHECK_TIMEOUT_MS = 60_000;
const PORT_FORWARD_READY_TIMEOUT_MS = 15_000;
const PORT_FORWARD_STOP_TIMEOUT_MS = 3_000;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultEnvPath = resolve(packageRoot, "adapters/internal-portal/.env.local");

export interface KubectlPortForward {
	close(): Promise<void>;
	url: string;
}

export interface AuthPullDependencies {
	envPath?: string;
	resolveCredential?: typeof resolveInternalPortalCredential;
	runKubectl?: (args: string[]) => Promise<string>;
	startPortForward?: (input: {
		context: string;
		kubectlPath: string;
		namespace: string;
	}) => Promise<KubectlPortForward>;
	kubectlPath?: string;
}

export interface AuthPullResult {
	context: string;
	envPath: string;
	namespace: string;
}

export interface AuthCheckDependencies {
	abortSignal?: AbortSignal;
	config?: InternalPortalConfig;
	checkAuthentication?: typeof checkPortalAuthentication;
}

export async function checkInternalPortalAuth(
	dependencies: AuthCheckDependencies = {},
): Promise<void> {
	const config = dependencies.config ?? resolveInternalPortalConfig(process.env);
	const timeoutSignal = AbortSignal.timeout(AUTH_CHECK_TIMEOUT_MS);
	const abortSignal = dependencies.abortSignal
		? AbortSignal.any([dependencies.abortSignal, timeoutSignal])
		: timeoutSignal;
	await (dependencies.checkAuthentication ?? checkPortalAuthentication)(config, { abortSignal });
}

export async function pullInternalPortalAuth(
	dependencies: AuthPullDependencies = {},
): Promise<AuthPullResult> {
	const kubectlPath = dependencies.kubectlPath ?? "kubectl";
	const runKubectl =
		dependencies.runKubectl ?? ((args: string[]) => runKubectlCommand(kubectlPath, args));
	const context = requireCommandValue(
		await runKubectl(["config", "current-context"]),
		"kubectl current context is empty",
	);
	const namespace =
		(
			await runKubectl([
				"--context",
				context,
				"config",
				"view",
				"--minify",
				"--output=jsonpath={..namespace}",
			])
		).trim() || "default";
	const encodedToken = requireCommandValue(
		await runKubectl([
			"--context",
			context,
			"--namespace",
			namespace,
			"get",
			"secret",
			"ops-web-internal-secrets",
			"--output=jsonpath={.data.OPS_WEB_INTERNAL_TOKEN}",
		]),
		"ops-web-internal-secrets does not contain OPS_WEB_INTERNAL_TOKEN",
	);
	const token = decodeSecretValue(encodedToken);
	const portForward = await (dependencies.startPortForward ?? startKubectlPortForward)({
		context,
		kubectlPath,
		namespace,
	});
	try {
		const credential = await (dependencies.resolveCredential ?? resolveInternalPortalCredential)({
			token,
			url: portForward.url,
		});
		const envPath = dependencies.envPath ?? defaultEnvPath;
		await writeManagedCredentialEnv(envPath, credential.ssoTgc);
		return { context, envPath, namespace };
	} finally {
		await portForward.close();
	}
}

export async function writeManagedCredentialEnv(path: string, ssoTgc: string): Promise<void> {
	const normalized = ssoTgc.trim();
	if (!normalized) {
		throw new Error("resolved internal portal credential is empty");
	}
	let current = `${MANAGED_LOCAL_ENV_MARKER}\n`;
	try {
		current = await readFile(path, "utf8");
	} catch (error) {
		if (!isMissingFile(error)) {
			throw error;
		}
	}
	if (!current.startsWith(MANAGED_LOCAL_ENV_MARKER)) {
		throw new Error(`Refusing to overwrite unmanaged local environment file: ${path}`);
	}
	const next = replaceEnvValue(current, "INTERNAL_PORTAL_SSO_TGC", normalized);
	const temporaryPath = resolve(dirname(path), `.${randomBytes(8).toString("hex")}.tmp`);
	try {
		await writeFile(temporaryPath, next, { flag: "wx", mode: 0o600 });
		await rename(temporaryPath, path);
		await chmod(path, 0o600);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

export async function startKubectlPortForward(input: {
	context: string;
	kubectlPath: string;
	namespace: string;
}): Promise<KubectlPortForward> {
	const child = spawn(
		input.kubectlPath,
		[
			"--context",
			input.context,
			"--namespace",
			input.namespace,
			"port-forward",
			"--address=127.0.0.1",
			"service/ops-web",
			":5178",
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	try {
		const url = await waitForPortForward(child);
		return {
			async close() {
				await stopChild(child);
			},
			url,
		};
	} catch (error) {
		await stopChild(child);
		throw error;
	}
}

async function runKubectlCommand(kubectlPath: string, args: string[]): Promise<string> {
	try {
		const result = await execFile(kubectlPath, args, {
			encoding: "utf8",
			maxBuffer: 1024 * 1024,
		});
		return result.stdout;
	} catch {
		throw new Error("kubectl command failed");
	}
}

async function waitForPortForward(child: ChildProcess): Promise<string> {
	return await new Promise<string>((resolveReady, rejectReady) => {
		let output = "";
		let settled = false;
		const timeout = setTimeout(
			() => finish(new Error("kubectl port-forward did not become ready")),
			PORT_FORWARD_READY_TIMEOUT_MS,
		);
		const finish = (error?: Error, url?: string) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			child.off("error", onError);
			child.off("close", onClose);
			child.stdout?.off("data", onData);
			child.stderr?.off("data", onData);
			if (error) {
				rejectReady(error);
			} else if (url) {
				resolveReady(url);
			}
		};
		const onData = (chunk: Buffer | string) => {
			output = `${output}${String(chunk)}`.slice(-16 * 1024);
			const match = /Forwarding from 127\.0\.0\.1:([1-9][0-9]*) -> 5178/u.exec(output);
			if (match?.[1]) {
				finish(undefined, `http://127.0.0.1:${match[1]}`);
			}
		};
		const onError = () => finish(new Error("kubectl port-forward failed to start"));
		const onClose = () => finish(new Error("kubectl port-forward exited before becoming ready"));
		child.on("error", onError);
		child.on("close", onClose);
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
	});
}

async function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	child.kill("SIGTERM");
	await waitForChildExit(child, PORT_FORWARD_STOP_TIMEOUT_MS);
	if (child.exitCode === null && child.signalCode === null) {
		child.kill("SIGKILL");
		await waitForChildExit(child, PORT_FORWARD_STOP_TIMEOUT_MS);
	}
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) {
		return;
	}
	await Promise.race([
		new Promise<void>((resolveClosed) => {
			child.once("close", () => resolveClosed());
			child.once("error", () => resolveClosed());
		}),
		delay(timeoutMs),
	]);
}

function decodeSecretValue(encoded: string): string {
	const value = encoded.trim();
	if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) {
		throw new Error("OPS_WEB_INTERNAL_TOKEN secret value is not valid base64");
	}
	const decoded = Buffer.from(value, "base64").toString("utf8").trim();
	if (!decoded) {
		throw new Error("OPS_WEB_INTERNAL_TOKEN secret value is empty");
	}
	return decoded;
}

function replaceEnvValue(source: string, key: string, value: string): string {
	const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, "u");
	const lines = source.replace(/\r\n/gu, "\n").split("\n");
	const output: string[] = [];
	let replaced = false;
	for (const line of lines) {
		if (!pattern.test(line)) {
			output.push(line);
			continue;
		}
		if (!replaced) {
			output.push(`${key}=${JSON.stringify(value)}`);
			replaced = true;
		}
	}
	while (output.at(-1) === "") {
		output.pop();
	}
	if (!replaced) {
		output.push(`${key}=${JSON.stringify(value)}`);
	}
	return `${output.join("\n")}\n`;
}

function requireCommandValue(value: string, message: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(message);
	}
	return normalized;
}

function isMissingFile(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
	if (argv.length !== 1) {
		throw usageError();
	}
	if (argv[0] === "pull") {
		const result = await pullInternalPortalAuth();
		console.log(
			JSON.stringify(
				{
					context: result.context,
					envPath: result.envPath,
					namespace: result.namespace,
					status: "updated",
				},
				null,
				2,
			),
		);
		return;
	}
	if (argv[0] === "check") {
		loadInternalPortalEnv();
		await checkInternalPortalAuth();
		console.log(JSON.stringify({ status: "valid" }, null, 2));
		return;
	}
	throw usageError();
}

function usageError(): Error {
	return new Error("Usage: pnpm internal-portal:auth:pull | pnpm internal-portal:auth:check");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(formatSafeErrorMessage(error));
		process.exitCode = 1;
	});
}
