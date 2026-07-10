import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	directoryNames,
	frontmatterFields,
	issue,
	markdownFiles,
	type RepoGuardIssue,
	readText,
	relativePosix,
} from "./common.ts";

const expectedDocDirectories = {
	architecture: "architecture",
	contracts: "contract",
	data: "data",
	decisions: "decision",
	domains: "index",
	environment: "index",
	policies: "policy",
	product: "product_requirement",
	reference: "reference",
	runbooks: "runbook",
} as const;

const decisionStatuses = new Set(["accepted", "deprecated", "proposed", "superseded"]);
const activeOnlyStatuses = new Set(["active"]);
const historicalReferenceStatuses = new Set(["active", "historical"]);

export function auditDocsGuard(root: string): RepoGuardIssue[] {
	return [
		...auditDocsRoot(root),
		...auditDocsFrontmatterShape(root),
		...auditDocsIndexesAndNamespaces(root),
		...auditDocsLinksAndPlacement(root),
		...auditRequiredDocsContent(root),
	];
}

function auditDocsRoot(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const actualDirs = new Set(directoryNames(join(root, "docs")));
	const expectedDirs = new Set(Object.keys(expectedDocDirectories));
	for (const actual of actualDirs) {
		if (!expectedDirs.has(actual)) {
			issues.push(issue(`docs/${actual}`, "unexpected docs top-level directory"));
		}
	}
	for (const expected of expectedDirs) {
		if (!actualDirs.has(expected)) {
			issues.push(issue(`docs/${expected}`, "expected docs top-level directory is missing"));
		}
	}
	for (const removed of ["verification", "archive", "plans"]) {
		if (existsSync(join(root, "docs", removed))) {
			issues.push(issue(`docs/${removed}`, "removed docs namespace must not exist"));
		}
	}
	for (const removed of ["docs/reference/archive", "docs/runbooks/archive"]) {
		if (existsSync(join(root, removed))) {
			issues.push(
				issue(removed, "reference/runbook archive namespace must not exist in branch tip"),
			);
		}
	}
	return issues;
}

function auditDocsFrontmatterShape(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const docsRoot = join(root, "docs");
	const docsIndex = fieldsOrIssue(root, "docs/README.md", issues);
	if (docsIndex) {
		requireFieldValue(issues, "docs/README.md", docsIndex, "doc_type", "index");
		requireAllowed(issues, "docs/README.md", docsIndex, "status", activeOnlyStatuses);
	}
	for (const [directoryName, expectedDocType] of Object.entries(expectedDocDirectories)) {
		const directory = join(docsRoot, directoryName);
		if (!existsSync(directory)) {
			issues.push(issue(`docs/${directoryName}`, "expected docs directory is missing"));
			continue;
		}
		for (const path of markdownFiles(root, `docs/${directoryName}`).filter(
			(path) => dirname(path) === directory,
		)) {
			const relativePath = relativePosix(root, path);
			const fields = fieldsOrIssue(root, relativePath, issues);
			if (!fields) {
				continue;
			}
			if (basename(path) === "README.md") {
				requireFieldValue(issues, relativePath, fields, "doc_type", "index");
				requireAllowed(issues, relativePath, fields, "status", activeOnlyStatuses);
				continue;
			}
			if (directoryName === "environment") {
				requireAllowed(issues, relativePath, fields, "doc_type", new Set(["index", "reference"]));
			} else {
				requireFieldValue(issues, relativePath, fields, "doc_type", expectedDocType);
			}
			if (directoryName === "decisions") {
				requireAllowed(issues, relativePath, fields, "status", decisionStatuses);
				if (!fields.decision_id) {
					issues.push(issue(relativePath, "decision docs must include decision_id"));
				}
			} else if (directoryName === "reference" || directoryName === "runbooks") {
				requireAllowed(issues, relativePath, fields, "status", historicalReferenceStatuses);
			} else {
				requireAllowed(issues, relativePath, fields, "status", activeOnlyStatuses);
			}
		}
	}
	return issues;
}

function auditDocsIndexesAndNamespaces(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	for (const directoryName of ["reference", "runbooks"]) {
		for (const path of topLevelMarkdown(root, `docs/${directoryName}`)) {
			if (basename(path) === "README.md") {
				continue;
			}
			const relativePath = relativePosix(root, path);
			const fields = fieldsOrIssue(root, relativePath, issues);
			if (!fields) {
				continue;
			}
			requireFieldValue(
				issues,
				relativePath,
				fields,
				"doc_type",
				directoryName === "reference" ? "reference" : "runbook",
			);
			requireAllowed(issues, relativePath, fields, "status", activeOnlyStatuses);
		}
	}
	requireContains(issues, root, "docs/README.md", [
		"runbooks/README.md",
		"environment/README.md",
		"domains/README.md",
		"policies/public-source-data.md",
	]);
	const domainDocs = new Set(topLevelMarkdown(root, "docs/domains").map((path) => basename(path)));
	const expectedDomainDocs = new Set([
		"README.md",
		"place.md",
		"public-web-search.md",
		"source-card.md",
		"transport.md",
	]);
	for (const actual of domainDocs) {
		if (!expectedDomainDocs.has(actual)) {
			issues.push(issue(`docs/domains/${actual}`, "unexpected narrow domain surface doc"));
		}
	}
	for (const expected of expectedDomainDocs) {
		if (!domainDocs.has(expected)) {
			issues.push(
				issue(`docs/domains/${expected}`, "expected narrow domain surface doc is missing"),
			);
		}
	}
	return issues;
}

function auditDocsLinksAndPlacement(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const brokenLinkPattern = /\[[^\]]+\]\([^)]*\n[^)]*\.md\)/;
	for (const path of [join(root, "README.md"), ...markdownFiles(root, "docs")]) {
		if (brokenLinkPattern.test(readText(path))) {
			issues.push(
				issue(relativePosix(root, path), "markdown link path must not split across lines"),
			);
		}
	}
	if (existsSync(join(root, "docs/architecture/system/observability-ledger.md"))) {
		issues.push(
			issue(
				"docs/architecture/system/observability-ledger.md",
				"completion ledgers must not live in architecture docs",
			),
		);
	}
	if (!existsSync(join(root, "docs/reference/observability-ledger.md"))) {
		issues.push(
			issue(
				"docs/reference/observability-ledger.md",
				"observability ledger reference doc is required",
			),
		);
	}
	for (const path of markdownFiles(root, "docs")) {
		const relativePath = relativePosix(root, path);
		if (relativePath.startsWith("docs/decisions/") || basename(path) === "README.md") {
			continue;
		}
		const text = readText(path);
		const lineCount = text.split(/\r?\n/).length;
		if (
			lineCount >= 300 &&
			![
				"## 文档边界",
				"## Document Boundary",
				"## Boundary",
				"## Contract Boundary",
				"## Source Of Truth",
			].some((heading) => text.includes(heading))
		) {
			issues.push(issue(relativePath, "large non-ADR docs must declare an explicit boundary"));
		}
	}
	return issues;
}

function auditRequiredDocsContent(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	requireContains(issues, root, "docs/documentation-architecture.md", [
		"Mature Standards Mapping",
		"Diataxis",
		"MADR",
		"Nygard",
		"OpenAPI",
		"JSON Schema",
		"RFC 2119",
		"RFC 8174",
		"GitHub Issue Forms",
		"GitHub Markdown pull request template",
		"not a standalone documentation framework",
		"planning_signal",
		"release_closeout_artifact",
	]);
	requireAbsent(issues, root, "docs/documentation-architecture.md", ["planning_work_map"]);
	requireContains(issues, root, "docs/policies/public-source-data.md", [
		"synthetic",
		"self-authored",
		"source-derived-publicly-redistributable",
		"internal-only-not-for-public-repo",
		"Runtime content is not read from git",
	]);
	requireContains(issues, root, "docs/contracts/README.md", [
		"app-api/eval-benchmark.md",
		"durable-runtime.md",
		"eval-artifact.md",
	]);
	requireContains(issues, root, "docs/data/README.md", ["durable-runtime.md"]);
	requireAbsent(issues, root, "docs/reference/README.md", ["durable-agent-runtime-gap-matrix.md"]);
	requireContains(issues, root, "docs/architecture/system/durable-runtime.md", [
		"adr-0048-temporal.md",
		"docs/contracts/durable-runtime.md",
		"docs/data/durable-runtime.md",
	]);
	requireContains(issues, root, "docs/contracts/durable-runtime.md", [
		"durable-agent-runtime-contract-v1",
		"`run_id`",
		"`conversation_id`",
		"Temporal-backed run command/query",
		"repo-owned projection",
		"`conversation_active_run`",
		"`tool.started`",
		"`tool.completed`",
		"`tool.failed`",
	]);
	requireContains(issues, root, "docs/data/durable-runtime.md", ["runtime.agent_runs"]);
	requireContains(issues, root, "docs/reference/testing-and-verification-lanes.md", [
		"pnpm repo:static",
		"Repo-wide static gate for live tracked surfaces",
		"JSON/YAML/TOML/HTML/SQL/XML/JSONL/shell/Dockerfile",
		"Biome, Ruff format",
		"decomposition guard",
		"Not a typecheck, unit test, integration test or E2E validation",
	]);
	issues.push(...auditDecisionIds(root));
	const retiredLegacyFlat = [".planning", "legacy-flat"].join("/");
	if (existsSync(join(root, retiredLegacyFlat))) {
		issues.push(issue(retiredLegacyFlat, "historical planning archive tree must not exist"));
	}
	return issues;
}

function auditDecisionIds(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const seen = new Map<string, string>();
	for (const path of topLevelMarkdown(root, "docs/decisions")) {
		if (basename(path) === "README.md") {
			continue;
		}
		const relativePath = relativePosix(root, path);
		const decisionId = fieldsOrIssue(root, relativePath, issues)?.decision_id;
		if (!decisionId) {
			issues.push(issue(relativePath, "decision docs must include decision_id"));
			continue;
		}
		const duplicate = seen.get(decisionId);
		if (duplicate) {
			issues.push(issue(relativePath, `decision_id duplicates ${duplicate}`));
			continue;
		}
		seen.set(decisionId, relativePath);
	}
	return issues;
}

function fieldsOrIssue(
	root: string,
	relativePath: string,
	issues: RepoGuardIssue[],
): Record<string, string> | undefined {
	try {
		return frontmatterFields(join(root, relativePath));
	} catch (error) {
		issues.push(issue(relativePath, error instanceof Error ? error.message : String(error)));
		return;
	}
}

function requireFieldValue(
	issues: RepoGuardIssue[],
	path: string,
	fields: Record<string, string>,
	field: string,
	expected: string,
): void {
	if (fields[field] !== expected) {
		issues.push(issue(path, `${field} must be ${expected}`));
	}
}

function requireAllowed(
	issues: RepoGuardIssue[],
	path: string,
	fields: Record<string, string>,
	field: string,
	allowed: Set<string>,
): void {
	if (!allowed.has(fields[field] ?? "")) {
		issues.push(issue(path, `${field} must be one of ${[...allowed].join(", ")}`));
	}
}

function requireContains(
	issues: RepoGuardIssue[],
	root: string,
	relativePath: string,
	tokens: string[],
): void {
	const text = readText(join(root, relativePath));
	for (const token of tokens) {
		if (!text.includes(token)) {
			issues.push(issue(relativePath, `missing required token: ${token}`));
		}
	}
}

function requireAbsent(
	issues: RepoGuardIssue[],
	root: string,
	relativePath: string,
	tokens: string[],
): void {
	const text = readText(join(root, relativePath));
	for (const token of tokens) {
		if (text.includes(token)) {
			issues.push(issue(relativePath, `forbidden token is present: ${token}`));
		}
	}
}

function topLevelMarkdown(root: string, relativeRoot: string): string[] {
	const absoluteRoot = join(root, relativeRoot);
	return markdownFiles(root, relativeRoot).filter((path) => dirname(path) === absoluteRoot);
}
