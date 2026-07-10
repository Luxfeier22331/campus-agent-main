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

const forbiddenProjectNamingTokens = [
	"campus-map-data",
	"campus-rag-",
	"campusrag://",
	"campusrag_ingestion",
];
const scanPaths = [
	".github",
	"*.md",
	"*.json",
	"*.lock",
	"apps",
	"configs",
	"docs",
	"env",
	"infra",
	"packages",
	"scripts",
	"tests",
];
const allowedTokenOwnerPaths = new Set([
	"tools/repo-static/checks/check_object_store_bucket_policy.ts",
]);
const textSuffixes = new Set([
	".cjs",
	".env",
	".example",
	".go",
	".json",
	".jsonl",
	".js",
	".lock",
	".md",
	".mjs",
	".py",
	".sh",
	".sql",
	".toml",
	".ts",
	".tsx",
	".txt",
	".yaml",
	".yml",
]);

export interface ObjectStoreBucketPolicyFailure {
	path: string;
	lineNumber: number;
	token: string;
}

export function scanObjectStoreBucketPolicy(root = repoRoot): ObjectStoreBucketPolicyFailure[] {
	const failures: ObjectStoreBucketPolicyFailure[] = [];
	for (const path of candidateFiles(root, scanPaths)) {
		if (!scannableTextFile(path)) {
			continue;
		}
		const relativePath = relativePosix(root, path);
		if (allowedTokenOwnerPaths.has(relativePath)) {
			continue;
		}
		const lines = readFileSync(path, "utf8").split(/\r?\n/);
		for (const [index, line] of lines.entries()) {
			for (const token of forbiddenProjectNamingTokens) {
				if (line.includes(token)) {
					failures.push({ path: relativePath, lineNumber: index + 1, token });
				}
			}
		}
	}
	return failures;
}

function scannableTextFile(path: string): boolean {
	return statSync(path).isFile() && textSuffixes.has(extname(path).toLowerCase());
}

function renderFailure(failure: ObjectStoreBucketPolicyFailure): string {
	return `${failure.path}: line ${failure.lineNumber}: forbidden retired object-store/project token ${JSON.stringify(failure.token)}`;
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
	const root = mkdtempSync(join(tmpdir(), "object-store-bucket-"));
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
		const fixture = join(root, "apps", "campus-web", "wrangler.toml");
		writeText(
			fixture,
			[
				'bucket_name = "campus-map-data-staging"',
				'OBJECT_STORE_BUCKET_SOURCE = "campus-rag-source"',
				'OBJECT_STORE_BUCKET_DERIVED = "campus-rag-derived"',
				'source_uri = "campusrag://promotion/internal_notice/1"',
				"from campus_ingestion_core.campusrag_ingestion_support import utc_now",
			].join("\n"),
		);
		expectEqualJson(
			scanObjectStoreBucketPolicy(root).map((failure) => failure.token),
			["campus-map-data", "campus-rag-", "campus-rag-", "campusrag://", "campusrag_ingestion"],
			"retired object-store token failures",
		);
	});
	console.log("check_object_store_bucket_policy self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const failures = scanObjectStoreBucketPolicy();
	if (failures.length > 0) {
		console.error("Object-store bucket policy check failed:");
		for (const failure of failures) {
			console.error(`- ${renderFailure(failure)}`);
		}
		return 1;
	}
	console.log("Validated object-store bucket policy.");
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
