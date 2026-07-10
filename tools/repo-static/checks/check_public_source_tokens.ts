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

const scanPaths = ["apps", "configs", "docs", "packages", "tests", "THIRD_PARTY_NOTICES.md"];
const textSuffixes = new Set([
	".env",
	".example",
	".go",
	".json",
	".jsonl",
	".md",
	".mjs",
	".mts",
	".py",
	".toml",
	".ts",
	".tsx",
	".txt",
	".yaml",
	".yml",
]);
const forbiddenSourceTokens = [
	"my.muc.edu.cn",
	"portal.muc.edu.cn",
	"www.muc.edu.cn",
	"xxgk.muc.edu.cn",
	"met.muc.edu.cn",
	"jwc.muc.edu.cn",
	"muc.edu.cn",
	"muc_internal_portal",
	"official_web:muc_public",
	"institutional_regulation:muc",
	"asset:curriculum-plan-2022",
	"asset:student-handbook-pdf",
	"student-handbook-pdf",
	"curriculum-plan-2022",
	"campus-agent://promotion/internal_notice",
	"药学院2021年硕博连读博士研究生招生实施细则",
	"历史文化学院2021年硕博连读博士研究生",
	"民族学与社会学学院2021年硕博连读博士研究生",
	"新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
	"生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
	"中华民族共同体学院",
	"MUC出行快讯",
	"MUCer注意啦",
	"I_0ji-iVJWm_ukb6UNDMiw",
	"EphU4RgS59GGvGuTgg62pw",
	"kHOaEpryJ9oy_A6NXNAhGw",
	"xtybxO4eKRzImzIreOLSRg",
	"6ZpX2byjb5j8UJ5XYiR5OA",
	"7ZwKk37lvAnOGJcU89j2dg",
	"nkWA_2jlmS-e9yTfbEfmyw",
	"849087992",
	"116.10859555",
	"116.108483",
	"116.10855328",
	"116.108,",
	"116.3211",
	"116.3222",
];
const publicWebSearchSourceTokenPaths = new Set([
	"apps/app-api/src/modules/chat/model.ts",
	"apps/app-api/src/modules/provider-config/validators.ts",
	"apps/app-api/src/modules/runtime-command/service/normalize-source-items.ts",
	"apps/app-api/test/chat-structured-parts.test.ts",
	"apps/app-api/test/provider-config.search-validator.test.ts",
	"apps/campus-web/test/source-items.test.tsx",
	"apps/execution-control/internal/httpapi/public_web_search.go",
	"apps/execution-control/internal/httpapi/public_web_search_test.go",
	"apps/execution-control/internal/provider/gemini_google_search_client_test.go",
	"apps/execution-control/internal/provider/openai_web_search_client_test.go",
	"apps/execution-control/internal/httpapi/provider_config_resolver_public_web_search_test.go",
	"apps/execution-control/internal/provider/perplexity_search_client_test.go",
	"docs/decisions/adr-0067-public-web-search-provider-boundary.md",
	"docs/domains/public-web-search.md",
	"docs/runbooks/execution-smoke.md",
	"packages/eval-langfuse/src/public-web-search-agent-runner.ts",
	"packages/eval-langfuse/src/public-web-search-eval.ts",
	"packages/eval-langfuse/test/public-web-search-agent-runner.test.ts",
	"packages/eval-langfuse/test/public-web-search-eval.test.ts",
]);
const publicWebSearchSourceTokenPrefixes = [
	"packages/eval-langfuse/assets/datasets/agent/public_web_search/",
];
const publicWebSearchAllowedSourceTokens = new Set([
	"muc.edu.cn",
	"my.muc.edu.cn",
	"www.muc.edu.cn",
]);

export interface PublicSourceTokenFailure {
	path: string;
	lineNumber: number;
	token: string;
}

export function publicSourceTokenCandidatePaths(root = repoRoot): string[] {
	return candidateFiles(root, scanPaths).filter((path) => {
		const relativePath = relativePosix(root, path);
		return (
			statSync(path).isFile() &&
			textSuffixes.has(extname(path).toLowerCase()) &&
			scanPath(relativePath)
		);
	});
}

export function scanPublicSourceTokens(root = repoRoot): PublicSourceTokenFailure[] {
	const failures: PublicSourceTokenFailure[] = [];
	for (const path of publicSourceTokenCandidatePaths(root)) {
		const relativePath = relativePosix(root, path);
		const lines = readFileSync(path, "utf8").split(/\r?\n/);
		for (const [index, line] of lines.entries()) {
			for (const token of forbiddenSourceTokens) {
				if (allowedPublicWebSearchSourceToken(relativePath, token)) {
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

function allowedPublicWebSearchSourceToken(relativePath: string, token: string): boolean {
	if (!publicWebSearchAllowedSourceTokens.has(token)) {
		return false;
	}
	if (publicWebSearchSourceTokenPaths.has(relativePath)) {
		return true;
	}
	return publicWebSearchSourceTokenPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function scanPath(relativePath: string): boolean {
	return (
		relativePath === "THIRD_PARTY_NOTICES.md" ||
		["apps/", "configs/", "docs/", "packages/", "tests/"].some((prefix) =>
			relativePath.startsWith(prefix),
		)
	);
}

function renderFailure(failure: PublicSourceTokenFailure): string {
	return `${failure.path}: line ${failure.lineNumber}: forbidden public source token ${JSON.stringify(failure.token)}`;
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
	const root = mkdtempSync(join(tmpdir(), "public-source-token-"));
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
		const source = join(root, "apps", "app-api", "test", "example.test.ts");
		writeText(source, 'const url = "https://www.muc.edu.cn/news.htm";\n');
		expectEqualJson(
			scanPublicSourceTokens(root),
			[
				{ path: "apps/app-api/test/example.test.ts", lineNumber: 1, token: "www.muc.edu.cn" },
				{ path: "apps/app-api/test/example.test.ts", lineNumber: 1, token: "muc.edu.cn" },
			],
			"real source token rejection",
		);
	});
	withFixture((root) => {
		const allowed = join(
			root,
			"apps",
			"execution-control",
			"internal",
			"httpapi",
			"public_web_search.go",
		);
		const other = join(root, "apps", "app-api", "test", "unrelated.test.ts");
		writeText(allowed, 'const host = "https://www.muc.edu.cn/page.htm";\n');
		writeText(other, 'const host = "https://www.muc.edu.cn/page.htm";\n');
		expectEqualJson(
			scanPublicSourceTokens(root),
			[
				{ path: "apps/app-api/test/unrelated.test.ts", lineNumber: 1, token: "www.muc.edu.cn" },
				{ path: "apps/app-api/test/unrelated.test.ts", lineNumber: 1, token: "muc.edu.cn" },
			],
			"public web search owner allowance",
		);
	});
	const repoFiles = publicSourceTokenCandidatePaths(repoRoot).map((path) =>
		relativePosix(repoRoot, path),
	);
	expect(repoFiles.includes("apps/app-api/wrangler.toml"), "repo discovery lost app-api wrangler");
	expect(
		repoFiles.includes("docs/reference/open-source-data.md"),
		"repo discovery lost open-source data doc",
	);
	console.log("check_public_source_tokens self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures = scanPublicSourceTokens();
	if (failures.length > 0) {
		console.error("Public source-token check failed:");
		for (const failure of failures) {
			console.error(`- ${renderFailure(failure)}`);
		}
		return 1;
	}
	console.log(`Validated ${publicSourceTokenCandidatePaths().length} public text files.`);
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
