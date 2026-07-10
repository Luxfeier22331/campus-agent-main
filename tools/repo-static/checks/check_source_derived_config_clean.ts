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
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreePaths } from "../../lib/worktree-paths.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const configPatterns = ["configs/ingestion/**", "configs/sources/**"];
const textSuffixes = new Set([".json", ".jsonl", ".md", ".sql", ".toml", ".txt", ".yaml", ".yml"]);
const forbiddenSourceTokens = [
	"中央民族大学",
	"muc.edu.cn",
	"my.muc.edu.cn",
	"www.muc.edu.cn",
	"institutional_regulation:muc",
	"official_web:muc_public",
	"asset:curriculum-plan-2022",
	"asset:student-handbook-pdf",
	"student-handbook-pdf",
	"curriculum-plan-2022",
	"campus-agent://regulations/student_rules/docs",
	"campus-agent://promotion/internal_notice",
	"central-minzu",
	"campus-rag",
];

export interface SourceDerivedConfigCleanFailure {
	path: string;
	lineNumber: number;
	token: string;
}

export function sourceConfigTextFiles(root = repoRoot): string[] {
	return candidateFiles(root, configPatterns).filter((path) => {
		const relativePath = relativePosix(root, path);
		return (
			statSync(path).isFile() &&
			textSuffixes.has(extname(path).toLowerCase()) &&
			sourceConfigPath(relativePath)
		);
	});
}

export function scanSourceDerivedConfigTokens(root = repoRoot): SourceDerivedConfigCleanFailure[] {
	const failures: SourceDerivedConfigCleanFailure[] = [];
	for (const path of sourceConfigTextFiles(root)) {
		const relativePath = relativePosix(root, path);
		const lines = readFileSync(path, "utf8").split(/\r?\n/);
		for (const [index, line] of lines.entries()) {
			for (const token of forbiddenSourceTokens) {
				if (line.includes(token)) {
					failures.push({ path: relativePath, lineNumber: index + 1, token });
				}
			}
		}
	}
	return failures;
}

function sourceConfigPath(relativePath: string): boolean {
	return (
		relativePath.startsWith("configs/ingestion/") || relativePath.startsWith("configs/sources/")
	);
}

function renderFailure(failure: SourceDerivedConfigCleanFailure): string {
	return `${failure.path}: line ${failure.lineNumber}: forbidden source token ${JSON.stringify(failure.token)}`;
}

function candidateFiles(root: string, pathspecs: string[]): string[] {
	if (existsSync(join(root, ".git"))) {
		return worktreePaths(root, pathspecs);
	}
	return walkFiles(root);
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
	const root = mkdtempSync(join(tmpdir(), "source-config-clean-"));
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

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function runSelfTest(): number {
	withFixture((root) => {
		const configPath = join(root, "configs", "ingestion", "example", "source.json");
		const unrelatedPath = join(root, "tests", "fixtures", "example", "source.json");
		writeText(configPath, `${JSON.stringify({ title: "中央民族大学示例" })}\n`);
		writeText(unrelatedPath, `${JSON.stringify({ title: "中央民族大学不在扫描范围" })}\n`);
		expectEqualJson(
			scanSourceDerivedConfigTokens(root),
			[{ path: "configs/ingestion/example/source.json", lineNumber: 1, token: "中央民族大学" }],
			"source config token rejection",
		);
	});
	const repoFiles = sourceConfigTextFiles(repoRoot).map((path) => relativePosix(repoRoot, path));
	expect(
		repoFiles.includes("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"),
		"repo source config discovery lost curriculum split manifest",
	);
	expect(
		repoFiles.includes("configs/sources/official_web/muc_public/site.json"),
		"repo source config discovery lost official web site config",
	);
	console.log("check_source_derived_config_clean self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures = scanSourceDerivedConfigTokens();
	if (failures.length > 0) {
		console.error("Source-derived config cleanliness check failed:");
		for (const failure of failures) {
			console.error(`- ${renderFailure(failure)}`);
		}
		return 1;
	}
	console.log(`Validated ${sourceConfigTextFiles().length} source config text files.`);
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
