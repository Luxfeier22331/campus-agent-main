import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptDir, "..", "..", "..", "..");

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export function repoPath(value: string): string {
	return resolve(repoRoot, value);
}

export function relativePath(path: string): string {
	const relativeValue = relative(repoRoot, path).replaceAll("\\", "/");
	return relativeValue.startsWith("..") ? path : relativeValue;
}

export function requirePath(path: string): void {
	if (!existsSync(path)) {
		throw new Error(`registered contract schema path does not exist: ${relativePath(path)}`);
	}
}

export function loadJson(path: string): unknown {
	requirePath(path);
	return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function loadYaml(path: string): unknown {
	requirePath(path);
	return YAML.parse(readFileSync(path, "utf8")) as unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredString(source: Record<string, unknown>, key: string): string {
	const value = source[key];
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`contract schema registry entry missing non-empty ${key}`);
	}
	return value;
}

export function stringArray(value: unknown, label: string): string[] {
	if (!(Array.isArray(value) && value.every((item) => typeof item === "string"))) {
		throw new Error(`${label} must be a string array`);
	}
	return value;
}

export function listFilesMatching(directory: string, pattern: string): string[] {
	requirePath(directory);
	const regex = globPatternToRegExp(pattern);
	return readdirSync(directory)
		.map((name) => join(directory, name))
		.filter((path) => statSync(path).isFile() && regex.test(path.split("/").at(-1) ?? ""))
		.sort();
}

function globPatternToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
	return new RegExp(`^${escaped}$`);
}
