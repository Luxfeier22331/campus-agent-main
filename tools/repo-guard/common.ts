import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

export interface RepoGuardIssue {
	path: string;
	message: string;
}

export function readText(path: string): string {
	return readFileSync(path, "utf8");
}

export function readJson(path: string): Record<string, unknown> {
	const payload = JSON.parse(readText(path)) as unknown;
	if (!isRecord(payload)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	return payload;
}

export function readYaml(path: string): Record<string, unknown> {
	const payload = parseYaml(readText(path));
	if (!isRecord(payload)) {
		throw new Error(`${path} must contain a YAML object`);
	}
	return payload;
}

export function frontmatterFields(path: string): Record<string, string> {
	const lines = readText(path).split(/\r?\n/);
	if (lines[0]?.trim() !== "---") {
		throw new Error(`${path} is missing YAML frontmatter`);
	}
	const fields: Record<string, string> = {};
	for (const line of lines.slice(1)) {
		if (line.trim() === "---") {
			return fields;
		}
		const separator = line.indexOf(":");
		if (separator === -1) {
			continue;
		}
		fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
	}
	throw new Error(`${path} has an unterminated YAML frontmatter block`);
}

export function markdownFiles(root: string, relativeRoot: string): string[] {
	return walkFiles(join(root, relativeRoot))
		.filter((path) => path.endsWith(".md"))
		.sort();
}

export function walkFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	const result: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			result.push(...walkFiles(path));
		} else if (entry.isFile()) {
			result.push(path);
		}
	}
	return result.sort();
}

export function directoryNames(path: string): string[] {
	if (!existsSync(path)) {
		return [];
	}
	return readdirSync(path, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

export function fileNames(path: string): string[] {
	if (!existsSync(path)) {
		return [];
	}
	return readdirSync(path, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
}

export function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

export function issue(path: string, message: string): RepoGuardIssue {
	return { path, message };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function objectValue(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}
