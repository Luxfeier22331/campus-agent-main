import { type SpawnSyncOptions, spawnSync } from "node:child_process";

export interface CapturedCommandResult {
	error?: Error;
	signal?: NodeJS.Signals;
	status: number | null;
	stderr: string;
	stdout: string;
	timedOut: boolean;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export function runCommand(command: string, args: string[], options: SpawnSyncOptions = {}): void {
	const result = spawnSync(command, args, {
		...options,
		encoding: "utf8",
		stdio: options.stdio ?? "inherit",
		timeout: options.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
	});
	if (result.error) {
		throw new Error(formatCommandFailure(command, args, result.error), { cause: result.error });
	}
	if (result.status !== 0) {
		const detail = typeof result.stderr === "string" ? result.stderr.trim() : "";
		throw new Error(
			`${command} ${formatArgs(args)} failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`,
		);
	}
}

export function captureCommand(
	command: string,
	args: string[],
	options: SpawnSyncOptions = {},
): string {
	const result = spawnSync(command, args, {
		...options,
		encoding: "utf8",
		stdio: "pipe",
		timeout: options.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
	});
	if (result.error) {
		throw new Error(formatCommandFailure(command, args, result.error), { cause: result.error });
	}
	if (result.status !== 0) {
		const detail = typeof result.stderr === "string" ? result.stderr.trim() : "";
		throw new Error(
			`${command} ${formatArgs(args)} failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`,
		);
	}
	return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

export function captureCommandResult(
	command: string,
	args: string[],
	options: SpawnSyncOptions = {},
): CapturedCommandResult {
	const result = spawnSync(command, args, {
		...options,
		encoding: "utf8",
		stdio: "pipe",
		timeout: options.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
	});
	return {
		error: result.error,
		status: result.status,
		stderr: typeof result.stderr === "string" ? result.stderr : "",
		stdout: typeof result.stdout === "string" ? result.stdout : "",
		signal: result.signal ?? undefined,
		timedOut: isCommandError(result.error) && result.error.code === "ETIMEDOUT",
	};
}

export function commandSucceeds(
	command: string,
	args: string[],
	options: SpawnSyncOptions = {},
): boolean {
	const result = spawnSync(command, args, {
		...options,
		stdio: "ignore",
		timeout: options.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
	});
	return result.status === 0 && !result.error;
}

function formatCommandFailure(command: string, args: string[], error: Error): string {
	return `${command} ${formatArgs(args)} failed to start: ${error.message}`;
}

function isCommandError(error: Error | undefined): error is NodeJS.ErrnoException {
	return Boolean(error && "code" in error);
}

function formatArgs(args: string[]): string {
	return args.map(redactArgument).join(" ");
}

function redactArgument(value: string): string {
	return value
		.replace(/(postgres(?:ql)?:\/\/[^:/]+:)[^@]+(@)/giu, "$1***$2")
		.replace(/(PASSWORD\s+')[^']+(')/giu, "$1***$2")
		.replace(/(PASSWORD=)[^\s]+/giu, "$1***");
}
