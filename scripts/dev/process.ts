import { type SpawnSyncOptions, spawnSync } from "node:child_process";

export function runCommand(command: string, args: string[], options: SpawnSyncOptions = {}): void {
	const result = spawnSync(command, args, {
		...options,
		encoding: "utf8",
		stdio: options.stdio ?? "inherit",
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		const detail = typeof result.stderr === "string" ? result.stderr.trim() : "";
		throw new Error(
			`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`,
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
	});
	if (result.error) {
		throw result.error;
	}
	if (result.status !== 0) {
		const detail = typeof result.stderr === "string" ? result.stderr.trim() : "";
		throw new Error(
			`${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`,
		);
	}
	return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

export function commandSucceeds(
	command: string,
	args: string[],
	options: SpawnSyncOptions = {},
): boolean {
	return spawnSync(command, args, { ...options, stdio: "ignore" }).status === 0;
}
