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

const fixtureRoots = [
	"packages/contracts/fixtures/",
	"packages/eval-langfuse/assets/",
	"packages/eval-langfuse/fixtures/",
	"packages/eval-langfuse/test/fixtures/",
	"apps/source-collector/adapters/official-web/test/",
	"apps/source-collector/adapters/official-web/test/fixtures/pages/",
	"apps/campus-web/test/fixtures/",
];
const fixturePathspecs = [
	"packages/contracts/fixtures/**",
	"packages/eval-langfuse/assets/**",
	"packages/eval-langfuse/fixtures/**",
	"packages/eval-langfuse/test/fixtures/**",
	"apps/source-collector/adapters/official-web/test/**",
	"apps/source-collector/adapters/official-web/test/fixtures/pages/**",
	"apps/campus-web/test/fixtures/**",
];
const publicWebSearchAgentAssetPrefix =
	"packages/eval-langfuse/assets/datasets/agent/public_web_search/";
const textSuffixes = new Set([".html", ".json", ".jsonl", ".md", ".ts", ".txt", ".yaml", ".yml"]);
const forbiddenSourceTokens = [
	"中央民族大学",
	"my.muc.edu.cn",
	"www.muc.edu.cn",
	"campus-agent://promotion/internal_notice",
	"muc_internal_portal",
	"institutional_regulation:muc",
	"official_web:muc_public",
	"849087992",
	"116.108483",
	"116.10859555",
	"116.3211",
	"116.3222",
];
const allowedPublicWebSearchAgentTokens = new Set(["中央民族大学", "muc.edu.cn"]);

export interface FixtureSourceCleanFailure {
	path: string;
	lineNumber: number;
	token: string;
}

export function publicFixtureTextFiles(root = repoRoot): string[] {
	return candidateFiles(root, fixturePathspecs).filter((path) => {
		const relativePath = relativePosix(root, path);
		return (
			statSync(path).isFile() &&
			textSuffixes.has(extname(path).toLowerCase()) &&
			fixtureRoots.some((fixtureRoot) => relativePath.startsWith(fixtureRoot))
		);
	});
}

export function scanPublicFixtureSourceTokens(root = repoRoot): FixtureSourceCleanFailure[] {
	const failures: FixtureSourceCleanFailure[] = [];
	for (const path of publicFixtureTextFiles(root)) {
		const relativePath = relativePosix(root, path);
		const lines = readFileSync(path, "utf8").split(/\r?\n/);
		for (const [index, line] of lines.entries()) {
			for (const token of forbiddenSourceTokens) {
				if (allowedPublicWebSearchAgentToken(relativePath, token)) {
					continue;
				}
				if (line.includes(token)) {
					failures.push({ path: relativePath, lineNumber: index + 1, token });
				}
			}
		}
	}
	return failures;
}

function allowedPublicWebSearchAgentToken(relativePath: string, token: string): boolean {
	return (
		relativePath.startsWith(publicWebSearchAgentAssetPrefix) &&
		allowedPublicWebSearchAgentTokens.has(token)
	);
}

function renderFailure(failure: FixtureSourceCleanFailure): string {
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
	const root = mkdtempSync(join(tmpdir(), "public-fixture-clean-"));
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
		const fixturePath = join(
			root,
			"packages",
			"eval-langfuse",
			"test",
			"fixtures",
			"example",
			"source.jsonl",
		);
		const unrelatedPath = join(root, "tests", "not_fixture", "source.json");
		writeText(fixturePath, `${JSON.stringify({ title: "中央民族大学示例" })}\n`);
		writeText(unrelatedPath, `${JSON.stringify({ title: "中央民族大学不在扫描范围" })}\n`);
		expectEqualJson(
			scanPublicFixtureSourceTokens(root),
			[
				{
					path: "packages/eval-langfuse/test/fixtures/example/source.jsonl",
					lineNumber: 1,
					token: "中央民族大学",
				},
			],
			"forbidden fixture token",
		);
	});
	withFixture((root) => {
		const path = join(
			root,
			"packages",
			"eval-langfuse",
			"assets",
			"datasets",
			"agent",
			"public_web_search",
			"sample.jsonl",
		);
		writeText(path, `${JSON.stringify({ title: "中央民族大学 synthetic" })}\n`);
		expectEqualJson(scanPublicFixtureSourceTokens(root), [], "public web search allowance");
	});
	const repoFiles = publicFixtureTextFiles(repoRoot).map((path) => relativePosix(repoRoot, path));
	expect(
		repoFiles.includes(
			"packages/contracts/fixtures/tool_execution_contract/tool_execution_delegate.valid.json",
		),
		"repo fixture discovery lost contract fixture",
	);
	console.log("check_public_fixture_source_clean self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures = scanPublicFixtureSourceTokens();
	if (failures.length > 0) {
		console.error("Public fixture source-clean check failed:");
		for (const failure of failures) {
			console.error(`- ${renderFailure(failure)}`);
		}
		return 1;
	}
	console.log(`Validated ${publicFixtureTextFiles().length} public fixture text files.`);
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
