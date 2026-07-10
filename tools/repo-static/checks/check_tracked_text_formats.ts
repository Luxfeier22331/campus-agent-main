import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

export const textFormats = ["html", "jsonl", "sql", "toml", "xml", "yaml"] as const;
export type TextFormat = (typeof textFormats)[number];

const packageRoot = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(packageRoot, "../..");

const htmlPathspecs = ["*.html", "apps/**/*.html", "jobs/**/*.html"];

export function trackedFormatFiles(format: TextFormat, root = repoRoot): string[] {
	const files =
		format === "html"
			? worktreePaths(htmlPathspecs, root)
			: worktreePaths(pathspecsForFormat(format), root);
	return files.filter((path) => shouldIncludePath(format, path));
}

export function checkFormat(format: TextFormat, root = repoRoot): number {
	const files = trackedFormatFiles(format, root);
	if (format === "yaml") {
		return checkYaml(files, root);
	}

	const failures: string[] = [];
	for (const path of files) {
		if (format === "html") {
			failures.push(...validateHtmlFile(join(root, path)).map((error) => `${path}: ${error}`));
		}
		if (format === "jsonl") {
			failures.push(...validateJsonlFile(join(root, path)));
		}
		if (format === "sql") {
			const result = spawnSync(
				"uv",
				["run", "--all-packages", "sqlfluff", "lint", "--config", ".sqlfluff", path],
				{
					cwd: root,
					encoding: "utf8",
				},
			);
			if (result.status !== 0) {
				failures.push(`${path}: ${(result.stderr || result.stdout || "").trim()}`);
			}
		}
		if (format === "toml") {
			try {
				validateTomlFile(join(root, path));
			} catch (error) {
				failures.push(`${path}: ${messageForError(error)}`);
			}
		}
		if (format === "xml") {
			failures.push(...validateXmlFile(join(root, path)).map((error) => `${path}: ${error}`));
		}
	}

	if (failures.length > 0) {
		console.error(`${format.toUpperCase()} check failed:`);
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		return 1;
	}
	console.log(`Validated ${files.length} ${format.toUpperCase()} files from current worktree.`);
	return 0;
}

export function validateHtmlFile(path: string): string[] {
	const content = readFileSync(path, "utf8");
	const normalized = content.toLowerCase();
	const errors: string[] = [];
	if (!normalized.trimStart().startsWith("<!doctype html>")) {
		errors.push("missing <!doctype html> declaration");
	}
	if (!/<html(?:\s|>)/i.test(content)) {
		errors.push("missing <html> element");
	}
	if (!/<body(?:\s|>)/i.test(content)) {
		errors.push("missing <body> element");
	}
	if (!/<head(?:\s|>)/i.test(content)) {
		errors.push("missing <head> element");
		errors.push("missing non-empty <title> element");
		return errors;
	}
	const title = content.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
	if (!title || title[1]?.trim() === "") {
		errors.push("missing non-empty <title> element");
	}
	return errors;
}

export function validateJsonlFile(path: string): string[] {
	const failures: string[] = [];
	const schema = schemaForJsonlPath(path);
	const lines = readFileSync(path, "utf8").split(/\r?\n/);
	for (const [index, rawLine] of lines.entries()) {
		const lineNumber = index + 1;
		if (rawLine.trim() === "") {
			continue;
		}
		let record: unknown;
		try {
			record = JSON.parse(rawLine);
		} catch (error) {
			failures.push(`${path}: line ${lineNumber}: JSON parse error: ${messageForError(error)}`);
			continue;
		}
		if (!isRecord(record)) {
			failures.push(`${path}: line ${lineNumber}: must decode to a JSON object`);
			continue;
		}
		if (schema) {
			failures.push(...validateJsonlRecordSchema(path, lineNumber, record, schema));
		}
	}
	return failures;
}

export function validateTomlFile(path: string): void {
	const content = readFileSync(path, "utf8");
	parseToml(content);
}

export function validateXmlFile(path: string): string[] {
	const content = readFileSync(path, "utf8");
	const failures: string[] = [];
	const stack: string[] = [];
	for (const match of content.matchAll(/<\/?([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>/g)) {
		const raw = match[0];
		if (raw.startsWith("<?") || raw.startsWith("<!") || raw.endsWith("/>")) {
			continue;
		}
		const tag = match[1];
		if (!tag) {
			continue;
		}
		if (raw.startsWith("</")) {
			const previous = stack.pop();
			if (previous !== tag) {
				failures.push(`mismatched closing tag ${tag}`);
				break;
			}
			continue;
		}
		stack.push(tag);
	}
	if (failures.length === 0 && stack.length > 0) {
		failures.push(`unclosed tag ${stack.at(-1)}`);
	}
	return failures;
}

export function parseArgs(argv: string[]): TextFormat[] {
	const formats: TextFormat[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg !== "--format") {
			throw new Error(`unsupported argument: ${arg}`);
		}
		const value = argv[index + 1];
		if (!isTextFormat(value)) {
			throw new Error(`unsupported format: ${value ?? "<missing>"}`);
		}
		formats.push(value);
		index += 1;
	}
	return formats.length > 0 ? formats : [...textFormats];
}

function checkYaml(files: string[], root: string): number {
	if (files.length === 0) {
		console.log("No current-worktree YAML files matched the live-surface pathspecs.");
		return 0;
	}
	const result = spawnSync(
		"uv",
		["run", "--all-packages", "yamllint", "-c", ".yamllint.yml", ...files],
		{
			cwd: root,
			stdio: "inherit",
		},
	);
	if (result.status === 0) {
		console.log(`Validated ${files.length} YAML files from current worktree outside .planning/.`);
		return 0;
	}
	console.error("YAML lint failed.");
	return result.status ?? 1;
}

function worktreePaths(pathspecs: string[], root: string): string[] {
	const result = spawnSync(
		"git",
		[
			"-c",
			"core.quotePath=false",
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			...pathspecs,
		],
		{ cwd: root, encoding: "buffer" },
	);
	if (result.status !== 0) {
		throw new Error(String(result.stderr || result.stdout || "git ls-files failed"));
	}
	const seen = new Set<string>();
	const paths: string[] = [];
	for (const item of result.stdout.toString("utf8").split("\0")) {
		if (item === "" || seen.has(item)) {
			continue;
		}
		seen.add(item);
		if (existsSync(join(root, item))) {
			paths.push(item);
		}
	}
	return paths;
}

function pathspecsForFormat(format: TextFormat): string[] {
	if (format === "jsonl") {
		return ["*.jsonl"];
	}
	if (format === "sql") {
		return ["*.sql"];
	}
	if (format === "toml") {
		return ["*.toml"];
	}
	if (format === "xml") {
		return ["*.xml"];
	}
	if (format === "yaml") {
		return ["*.yml", "*.yaml"];
	}
	return htmlPathspecs;
}

function shouldIncludePath(format: TextFormat, path: string): boolean {
	if (format === "html") {
		return (
			path.endsWith(".html") &&
			!path.startsWith(".planning/") &&
			!path.startsWith(".tmp/") &&
			!path.startsWith(".worktrees/") &&
			!path.includes("/vendor/") &&
			!path.includes("/node_modules/")
		);
	}
	if (format === "jsonl") {
		return !(path.startsWith(".planning/") || path.includes("/vendor/"));
	}
	if (format === "sql") {
		return !(path.startsWith(".planning/") || path.startsWith("apps/app-api/drizzle/"));
	}
	if (format === "xml" || format === "yaml") {
		return !path.startsWith(".planning/");
	}
	return true;
}

function schemaForJsonlPath(path: string): string[] | undefined {
	const name = path.split("/").at(-1) ?? "";
	if (name.includes("provider-result")) {
		return ["logId", "result"];
	}
	if (name.includes("layout-elements")) {
		return ["schema_version", "row_id", "row_type", "page_start", "page_end"];
	}
	if (name.endsWith(".structured.jsonl")) {
		return [
			"doc_id",
			"version_id",
			"chunk_id",
			"clean_text",
			"page_start",
			"page_end",
			"source",
			"acl",
		];
	}
	return;
}

function validateJsonlRecordSchema(
	path: string,
	lineNumber: number,
	record: Record<string, unknown>,
	schema: string[],
): string[] {
	for (const key of schema) {
		if (!(key in record)) {
			return [`${path}: line ${lineNumber}: missing required key '${key}'`];
		}
	}
	const failures: string[] = [];
	if ("logId" in record && !isNonemptyString(record.logId)) {
		failures.push(`${path}: line ${lineNumber}: key 'logId' must be a non-empty string`);
	}
	if ("result" in record && !isRecord(record.result)) {
		failures.push(`${path}: line ${lineNumber}: key 'result' must decode to a JSON object`);
	}
	if ("clean_text" in record && !isNonemptyString(record.clean_text)) {
		failures.push(`${path}: line ${lineNumber}: key 'clean_text' must be a non-empty string`);
	}
	if ("source" in record && !isRecord(record.source)) {
		failures.push(`${path}: line ${lineNumber}: key 'source' must decode to a JSON object`);
	}
	if ("acl" in record && !isRecord(record.acl)) {
		failures.push(`${path}: line ${lineNumber}: key 'acl' must decode to a JSON object`);
	}
	return failures;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): boolean {
	return typeof value === "string" && value.trim() !== "";
}

function isTextFormat(value: string | undefined): value is TextFormat {
	return typeof value === "string" && (textFormats as readonly string[]).includes(value);
}

function messageForError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	let exitCode = 0;
	try {
		for (const format of parseArgs(process.argv.slice(2))) {
			const result = checkFormat(format);
			if (result !== 0) {
				exitCode = result;
				break;
			}
		}
	} catch (error) {
		console.error(messageForError(error));
		exitCode = 1;
	}
	process.exit(exitCode);
}
