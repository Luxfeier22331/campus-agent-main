import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import posix from "node:path/posix";
import { fileURLToPath } from "node:url";
import { docsMarkdownFiles, frontmatterFields } from "./check_docs_frontmatter_tracked.ts";

export interface DocsReferenceGraphIssue {
	path: string;
	target: string;
	message: string;
}

interface Reference {
	target: string;
	context: string;
}

const controlMarkdownPaths = [
	"AGENTS.md",
	"README.md",
	".planning/PROJECT.md",
	".planning/WORKSTREAMS.md",
];
const retiredCompatibilityPaths = new Set([
	"docs/architecture/system/execution-and-agents-architecture.md",
]);
const referencePattern =
	/(?<![/\w.-])(?<target>(?:\.{1,2}\/|docs\/|AGENTS\.md|README\.md)[^\s)`'"<>]*?\.md)/g;
const localAbsoluteRepoPathPattern = /(?<target>\/home\/[^\s)`'"<>]*\/code\/[^\s)`'"<>]*?\.md)/g;
const migrationProcessMarkers = ["Split from the former mega-doc", "former mega-doc"];
const historicalContextTerms = [
	"archive",
	"historical",
	"history",
	"superseded",
	"background",
	"retired",
	"deprecated",
	"legacy",
	"追溯",
	"历史",
	"旧",
	"已退役",
	"已被",
	"背景",
];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const currentRepoRoot = join(scriptDir, "../../..");

export function auditDocsReferenceGraph(root = currentRepoRoot): DocsReferenceGraphIssue[] {
	const docStatus = docStatusMap(root);
	const activeSources = activeSourceFiles(root, docStatus);
	const issues: DocsReferenceGraphIssue[] = [];

	for (const source of docsMarkdownFiles(root)) {
		const sourceRelative = relativePosix(root, source);
		for (const target of splitMarkdownPaths(source, sourceRelative)) {
			issues.push({
				path: sourceRelative,
				target,
				message: "markdown path appears split across lines",
			});
		}
	}

	for (const source of activeSources) {
		const sourceRelative = relativePosix(root, source);
		if (sourceRelative.includes("/archive/")) {
			continue;
		}
		issues.push(...activeTextIssues(source, sourceRelative));
		for (const reference of referencesFromFile(source, root)) {
			if (retiredCompatibilityPaths.has(reference.target)) {
				issues.push({
					path: sourceRelative,
					target: reference.target,
					message: "active document references retired compatibility path",
				});
				continue;
			}
			if (!existsSync(join(root, reference.target))) {
				issues.push({
					path: sourceRelative,
					target: reference.target,
					message: "active document references missing markdown file",
				});
				continue;
			}
			const targetStatus = docStatus.get(reference.target);
			if (targetStatus === "historical" && !hasHistoricalContext(reference.context)) {
				issues.push({
					path: sourceRelative,
					target: reference.target,
					message: "active document references historical document without historical context",
				});
			}
			if (
				(targetStatus === "superseded" || targetStatus === "deprecated") &&
				!hasHistoricalContext(reference.context)
			) {
				issues.push({
					path: sourceRelative,
					target: reference.target,
					message: `active document references ${targetStatus} document without historical context`,
				});
			}
		}
	}
	return issues;
}

function docStatusMap(root: string): Map<string, string> {
	const statuses = new Map<string, string>();
	for (const path of docsMarkdownFiles(root)) {
		const relativePath = relativePosix(root, path);
		const fields = frontmatterFields(path);
		if (fields?.status) {
			statuses.set(relativePath, fields.status);
		}
	}
	return statuses;
}

function activeSourceFiles(root: string, statuses: Map<string, string>): string[] {
	const sources: string[] = [];
	for (const [relativePath, status] of statuses.entries()) {
		if (status === "active" || status === "accepted") {
			sources.push(join(root, relativePath));
		}
	}
	for (const relativePath of controlMarkdownPaths) {
		const path = join(root, relativePath);
		if (existsSync(path)) {
			sources.push(path);
		}
	}
	return [...new Set(sources)];
}

function referencesFromFile(path: string, root: string): Reference[] {
	const sourceRelative = relativePosix(root, path);
	const lines = readFileSync(path, "utf8").split(/\r?\n/);
	const references: Reference[] = [];
	for (const [index, line] of lines.entries()) {
		const context = paragraphContext(lines, index);
		for (const match of line.matchAll(referencePattern)) {
			const target = normalizeReference(match.groups?.target ?? "", sourceRelative);
			if (target) {
				references.push({ target, context });
			}
		}
	}
	return references;
}

function activeTextIssues(path: string, sourceRelative: string): DocsReferenceGraphIssue[] {
	const text = readFileSync(path, "utf8");
	const issues: DocsReferenceGraphIssue[] = [];
	for (const match of text.matchAll(localAbsoluteRepoPathPattern)) {
		issues.push({
			path: sourceRelative,
			target: match.groups?.target ?? "",
			message: "active document references local absolute repo path",
		});
	}
	for (const marker of migrationProcessMarkers) {
		if (text.includes(marker)) {
			issues.push({
				path: sourceRelative,
				target: marker,
				message: "active document contains documentation migration process marker",
			});
			break;
		}
	}
	return issues;
}

function splitMarkdownPaths(path: string, sourceRelative: string): string[] {
	const lines = readFileSync(path, "utf8").split(/\r?\n/);
	const targets: string[] = [];
	for (let index = 0; index < lines.length - 1; index += 1) {
		const line = lines[index];
		if (!line.trimEnd().endsWith(".m")) {
			continue;
		}
		const nextLine = lines[index + 1];
		if (!nextLine.trim().startsWith("d")) {
			continue;
		}
		const prefix = line.split("`").at(-1) ?? "";
		const suffix = nextLine.trim().split("`", 1)[0] ?? "";
		const target = normalizeReference(`${prefix}${suffix}`, sourceRelative);
		if (target) {
			targets.push(target);
		}
	}
	return targets;
}

function normalizeReference(rawTarget: string, sourcePath: string): string | undefined {
	const target = rawTarget.split("#", 1)[0].replace(/[.,;:]+$/g, "");
	if (!target.endsWith(".md")) {
		return;
	}
	if (["*", ":", "{", "}"].some((marker) => target.includes(marker))) {
		return;
	}
	let normalized: string;
	if (target.startsWith("docs/") || target === "AGENTS.md" || target === "README.md") {
		normalized = posix.normalize(target);
	} else if (target.startsWith("./") || target.startsWith("../")) {
		normalized = posix.normalize(posix.join(posix.dirname(sourcePath), target));
	} else {
		return;
	}
	if (normalized.startsWith("../")) {
		return;
	}
	return normalized;
}

function paragraphContext(lines: string[], index: number): string {
	let start = index;
	while (start > 0 && lines[start - 1].trim()) {
		start -= 1;
	}
	let end = index;
	while (end + 1 < lines.length && lines[end + 1].trim()) {
		end += 1;
	}
	return lines.slice(start, end + 1).join("\n");
}

function hasHistoricalContext(context: string): boolean {
	const lowerContext = context.toLowerCase();
	return historicalContextTerms.some((term) => lowerContext.includes(term));
}

function relativePosix(root: string, path: string): string {
	return relative(root, path).replaceAll("\\", "/");
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "docs-reference-"));
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

function activeDocFrontmatter(): string {
	return "---\ndoc_type: architecture\ntruth_scope: repository\nowner_boundary: docs/architecture\nstatus: active\ncreated: 2026-06-14\nupdated: 2026-06-14\n---\n";
}

function historicalDocFrontmatter(status = "historical"): string {
	return `---\ndoc_type: reference\ntruth_scope: data\nowner_boundary: docs/reference\nstatus: ${status}\ncreated: 2026-06-14\nupdated: 2026-06-14\n---\n`;
}

function runSelfTest(): number {
	withFixture((root) => {
		const active = join(root, "docs", "architecture", "current.md");
		const historical = join(root, "docs", "reference", "old-contract.md");
		writeText(
			active,
			`${activeDocFrontmatter()}# Current\n\nCurrent contract: \`docs/reference/old-contract.md\`.\n`,
		);
		writeText(historical, `${historicalDocFrontmatter()}# Old Contract\n`);
		expectEqualJson(
			auditDocsReferenceGraph(root),
			[
				{
					path: "docs/architecture/current.md",
					target: "docs/reference/old-contract.md",
					message: "active document references historical document without historical context",
				},
			],
			"historical reference without context",
		);
	});
	withFixture((root) => {
		const active = join(root, "docs", "architecture", "current.md");
		writeText(
			active,
			`${activeDocFrontmatter()}# Current\n\nCurrent owner: \`docs/architecture/system/missing-owner.md\`.\n`,
		);
		expectEqualJson(
			auditDocsReferenceGraph(root),
			[
				{
					path: "docs/architecture/current.md",
					target: "docs/architecture/system/missing-owner.md",
					message: "active document references missing markdown file",
				},
			],
			"missing markdown reference",
		);
	});
	withFixture((root) => {
		const active = join(root, "docs", "reference", "normalization.md");
		writeText(
			active,
			`${activeDocFrontmatter()}# Normalization\n\nExternal legacy source: \`/home/reptilian/code/campusRag/docs/rag/schema.md\`.\n`,
		);
		expectEqualJson(
			auditDocsReferenceGraph(root),
			[
				{
					path: "docs/reference/normalization.md",
					target: "/home/reptilian/code/campusRag/docs/rag/schema.md",
					message: "active document references local absolute repo path",
				},
			],
			"local absolute path",
		);
	});
	withFixture((root) => {
		const doc = join(root, "docs", "reference", "index.md");
		const target = join(root, "docs", "reference", "long-owner.md");
		writeText(
			doc,
			`${historicalDocFrontmatter()}# Index\n\n- \`docs/reference/long-owner.m\n  d\`\n`,
		);
		writeText(target, `${historicalDocFrontmatter()}# Long Owner\n`);
		expectEqualJson(
			auditDocsReferenceGraph(root),
			[
				{
					path: "docs/reference/index.md",
					target: "docs/reference/long-owner.md",
					message: "markdown path appears split across lines",
				},
			],
			"split markdown path",
		);
	});
	withFixture((root) => {
		const agents = join(root, "AGENTS.md");
		writeText(
			agents,
			"# AGENTS\n\n## Source Of Truth\n\n- `docs/architecture/system/execution-and-agents-architecture.md`\n",
		);
		expectEqualJson(
			auditDocsReferenceGraph(root),
			[
				{
					path: "AGENTS.md",
					target: "docs/architecture/system/execution-and-agents-architecture.md",
					message: "active document references retired compatibility path",
				},
			],
			"retired compatibility path",
		);
	});
	console.log("check_docs_reference_graph_tracked self-test passed.");
	return 0;
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const issues = auditDocsReferenceGraph();
	if (issues.length === 0) {
		console.log("Validated docs reference graph.");
		return 0;
	}
	for (const issue of issues) {
		console.error(`${issue.path}: ${issue.target}: ${issue.message}`);
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
