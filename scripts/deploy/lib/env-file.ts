import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function resolveSourceEnvPath(repoRoot: string): string {
	const resolved = resolve(repoRoot);
	return dirname(resolved).split(/[\\/]/).at(-1) === ".worktrees"
		? join(dirname(dirname(resolved)), ".env")
		: join(resolved, ".env");
}

export function parseEnvFile(path: string): Record<string, string> {
	if (!existsSync(path)) {
		return {};
	}
	const values: Record<string, string> = {};
	for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || !rawLine.includes("=")) {
			continue;
		}
		const separator = rawLine.indexOf("=");
		const key = rawLine.slice(0, separator).trim();
		const value = rawLine.slice(separator + 1).trim();
		if (key) {
			values[key] = value;
		}
	}
	return values;
}
