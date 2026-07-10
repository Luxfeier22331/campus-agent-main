import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreePaths } from "../../lib/worktree-paths.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const expectedLicense = "Apache-2.0";
const rootRequiredPackageKeys = ["bugs", "homepage", "repository"];
const metadataPathspecs = [
	"package.json",
	"apps/*/package.json",
	"packages/*/package.json",
	"packages/domains/*/package.json",
	"pyproject.toml",
	"apps/*/pyproject.toml",
	"packages/*/pyproject.toml",
	"packages/domains/*/pyproject.toml",
	"Cargo.toml",
	"packages/*/Cargo.toml",
	"packages/domains/*/Cargo.toml",
];

export interface OpenSourceMetadataFailure {
	path: string;
	message: string;
}

export function auditOpenSourceMetadata(root = repoRoot): OpenSourceMetadataFailure[] {
	const failures: OpenSourceMetadataFailure[] = [];
	for (const path of metadataFiles(root)) {
		const relativePath = relativePosix(root, path);
		const name = basename(path);
		if (name === "package.json") {
			failures.push(...auditPackageJson(path, relativePath));
		} else if (name === "pyproject.toml") {
			failures.push(...auditTomlProjectLicense(path, relativePath, "project"));
		} else if (name === "Cargo.toml") {
			failures.push(...auditTomlProjectLicense(path, relativePath, "package"));
		}
	}
	return failures;
}

function metadataFiles(root: string): string[] {
	if (existsSync(join(root, ".git"))) {
		return worktreePaths(root, metadataPathspecs).filter((path) => statSync(path).isFile());
	}
	return walkFiles(root).filter((path) =>
		["package.json", "pyproject.toml", "Cargo.toml"].includes(basename(path)),
	);
}

function auditPackageJson(path: string, relativePath: string): OpenSourceMetadataFailure[] {
	const payload = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	const failures: OpenSourceMetadataFailure[] = [];
	if (payload.license !== expectedLicense) {
		failures.push({ path: relativePath, message: `license must be ${expectedLicense}` });
	}
	if (relativePath !== "package.json" && payload.private !== true) {
		failures.push({
			path: relativePath,
			message:
				"workspace package.json must remain private unless publication is explicitly designed",
		});
	}
	if (relativePath === "package.json") {
		for (const key of rootRequiredPackageKeys) {
			if (!(key in payload)) {
				failures.push({ path: relativePath, message: `root package.json must define ${key}` });
			}
		}
	}
	return failures;
}

function auditTomlProjectLicense(
	path: string,
	relativePath: string,
	tableName: "project" | "package",
): OpenSourceMetadataFailure[] {
	const table = tomlTable(readFileSync(path, "utf8"), tableName);
	if (!table) {
		return tableName === "project"
			? [{ path: relativePath, message: "missing [project] table" }]
			: [];
	}
	const license = table.license;
	if (license !== expectedLicense) {
		return [{ path: relativePath, message: `license must be ${expectedLicense}` }];
	}
	return [];
}

function tomlTable(text: string, tableName: string): Record<string, string> | undefined {
	let active = false;
	const table: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = stripTomlComment(rawLine).trim();
		if (line === "") {
			continue;
		}
		const sectionMatch = line.match(/^\[([^\]]+)\]$/);
		if (sectionMatch?.[1]) {
			if (active) {
				break;
			}
			active = sectionMatch[1].trim() === tableName;
			continue;
		}
		if (!active) {
			continue;
		}
		const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/);
		if (match?.[1] && match[2] !== undefined) {
			table[match[1]] = match[2];
		}
	}
	return active || Object.keys(table).length > 0 ? table : undefined;
}

function stripTomlComment(line: string): string {
	let inString = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (char === '"' && line[index - 1] !== "\\") {
			inString = !inString;
		}
		if (char === "#" && !inString) {
			return line.slice(0, index);
		}
	}
	return line;
}

function renderFailure(failure: OpenSourceMetadataFailure): string {
	return `${failure.path}: ${failure.message}`;
}

function walkFiles(root: string): string[] {
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

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "open-source-metadata-"));
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

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	withFixture((root) => {
		writeText(
			join(root, "package.json"),
			JSON.stringify({ name: "demo", private: true, license: "MIT" }),
		);
		const rendered = auditOpenSourceMetadata(root).map(renderFailure).sort();
		expectEqualJson(
			rendered,
			[
				"package.json: license must be Apache-2.0",
				"package.json: root package.json must define bugs",
				"package.json: root package.json must define homepage",
				"package.json: root package.json must define repository",
			],
			"root package metadata failures",
		);
	});
	withFixture((root) => {
		writeText(
			join(root, "packages", "domains", "dining", "package.json"),
			JSON.stringify({ name: "@campus-agent/dining", license: "Apache-2.0" }),
		);
		expectEqualJson(
			auditOpenSourceMetadata(root).map(renderFailure),
			[
				"packages/domains/dining/package.json: workspace package.json must remain private unless publication is explicitly designed",
			],
			"workspace private package failure",
		);
	});
	withFixture((root) => {
		writeText(
			join(root, "packages", "example", "pyproject.toml"),
			'[project]\nname = "example"\nlicense = "MIT"\n',
		);
		expectEqualJson(
			auditOpenSourceMetadata(root).map(renderFailure),
			["packages/example/pyproject.toml: license must be Apache-2.0"],
			"pyproject license failure",
		);
	});
	console.log("check_open_source_metadata self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures = auditOpenSourceMetadata();
	if (failures.length > 0) {
		console.error("Open-source metadata check failed:");
		for (const failure of failures) {
			console.error(`- ${renderFailure(failure)}`);
		}
		return 1;
	}
	console.log("Validated open-source package metadata.");
	return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
