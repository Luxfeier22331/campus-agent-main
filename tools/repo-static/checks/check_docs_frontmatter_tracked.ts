import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreePaths } from "../../lib/worktree-paths.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

export interface DocsFrontmatterIssue {
	path: string;
	message: string;
}

const docRoot = "docs";
const requiredFields = [
	"doc_type",
	"truth_scope",
	"owner_boundary",
	"status",
	"created",
	"updated",
];
const allowedTruthScopes = new Set(["product", "execution", "data", "ops", "eval", "repository"]);
const allowedStatus = new Set([
	"active",
	"historical",
	"proposed",
	"accepted",
	"superseded",
	"deprecated",
]);

export function docsMarkdownFiles(root = repoRoot): string[] {
	let files: string[];
	try {
		files = worktreePaths(root, [docRoot]);
	} catch {
		files = walkFiles(join(root, docRoot));
	}
	return files.filter(
		(path) => path.endsWith(".md") && existsSync(path) && isDocsMarkdownPath(path, root),
	);
}

export function auditDocsFrontmatter(root = repoRoot): DocsFrontmatterIssue[] {
	const issues: DocsFrontmatterIssue[] = [];
	for (const path of docsMarkdownFiles(root)) {
		const relativePath = relativePosix(root, path);
		const fields = frontmatterFields(path);
		if (!fields) {
			issues.push({ path: relativePath, message: "missing YAML frontmatter block" });
			continue;
		}
		for (const field of requiredFields) {
			if (!(field in fields)) {
				issues.push({
					path: relativePath,
					message: `missing required frontmatter field: ${field}`,
				});
			}
		}
		const truthScope = fields.truth_scope;
		if (truthScope !== undefined && !allowedTruthScopes.has(truthScope)) {
			issues.push({ path: relativePath, message: `invalid truth_scope: ${truthScope}` });
		}
		const status = fields.status;
		if (status !== undefined && !allowedStatus.has(status)) {
			issues.push({ path: relativePath, message: `invalid status: ${status}` });
		}
		if (isNonReadmeArchivePath(relativePath) && status === "active") {
			issues.push({
				path: relativePath,
				message: "archive documents must be historical unless they are README.md indexes",
			});
		}
	}
	return issues;
}

export function frontmatterFields(path: string): Record<string, string> | undefined {
	const text = readFileSync(path, "utf8");
	if (!text.startsWith("---\n")) {
		return;
	}
	const end = text.indexOf("\n---", 4);
	if (end === -1) {
		return;
	}
	const fields: Record<string, string> = {};
	for (const line of text.slice(4, end).split(/\r?\n/)) {
		if (!line || line.startsWith(" ") || !line.includes(":")) {
			continue;
		}
		const [key, ...valueParts] = line.split(":");
		fields[key.trim()] = valueParts.join(":").trim();
	}
	return fields;
}

function isDocsMarkdownPath(path: string, root: string): boolean {
	const relativePath = relativePosix(root, path);
	return relativePath === docRoot || relativePath.startsWith(`${docRoot}/`);
}

function isNonReadmeArchivePath(path: string): boolean {
	return path.includes("/archive/") && !path.endsWith("/README.md");
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
	return result;
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "docs-frontmatter-"));
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
		const architectureDoc = join(root, "docs", "architecture", "target.md");
		const archiveDoc = join(root, "docs", "reference", "archive", "sample.md");
		const packageDoc = join(root, "packages", "sample", "README.md");
		writeText(architectureDoc, "---\ndoc_type: architecture\n---\n# Target\n");
		writeText(archiveDoc, "---\ndoc_type: reference\n---\n# Sample\n");
		writeText(packageDoc, "# Package\n");
		expectEqualJson(docsMarkdownFiles(root), [architectureDoc, archiveDoc], "docs markdown files");
	});
	withFixture((root) => {
		const doc = join(root, "docs", "contracts", "tool-execution.md");
		writeText(
			doc,
			"---\ndoc_type: contract\nstatus: active\ncreated: 2026-06-13\nupdated: 2026-06-13\n---\n# Tool Execution\n",
		);
		expectEqualJson(
			auditDocsFrontmatter(root),
			[
				{
					path: "docs/contracts/tool-execution.md",
					message: "missing required frontmatter field: truth_scope",
				},
				{
					path: "docs/contracts/tool-execution.md",
					message: "missing required frontmatter field: owner_boundary",
				},
			],
			"missing required docs fields",
		);
	});
	withFixture((root) => {
		const doc = join(root, "docs", "runbooks", "archive", "old-runbook.md");
		writeText(
			doc,
			"---\ndoc_type: runbook\ntruth_scope: ops\nowner_boundary: docs/runbooks/archive\nstatus: active\ncreated: 2026-06-13\nupdated: 2026-06-13\n---\n# Old Runbook\n",
		);
		expectEqualJson(
			auditDocsFrontmatter(root),
			[
				{
					path: "docs/runbooks/archive/old-runbook.md",
					message: "archive documents must be historical unless they are README.md indexes",
				},
			],
			"active archive doc rejection",
		);
	});
	console.log("check_docs_frontmatter_tracked self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const issues = auditDocsFrontmatter();
	if (issues.length === 0) {
		console.log("Validated docs frontmatter.");
		return 0;
	}
	for (const issue of issues) {
		console.error(`${issue.path}: ${issue.message}`);
	}
	return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		process.exit(main(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
