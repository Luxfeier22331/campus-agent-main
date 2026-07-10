import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	fileNames,
	issue,
	objectValue,
	type RepoGuardIssue,
	readJson,
	readText,
	readYaml,
	stringValue,
} from "./common.ts";

const expectedIssueForms = new Set([
	"bug_report.yml",
	"config.yml",
	"documentation.yml",
	"feature_request.yml",
]);

export function auditCollaborationGuard(root: string): RepoGuardIssue[] {
	return [
		...auditRequiredScaffolding(root),
		...auditCollaborationDocs(root),
		...auditCodeowners(root),
		...auditDependabot(root),
		...auditSecurityPosture(root),
		...auditGitHubTemplates(root),
	];
}

function auditRequiredScaffolding(root: string): RepoGuardIssue[] {
	const expectedFiles = [
		".editorconfig",
		".pre-commit-config.yaml",
		".gitleaks.toml",
		"osv-scanner.toml",
		"CODE_OF_CONDUCT.md",
		"CONTRIBUTING.md",
		".github/CODEOWNERS",
		".github/dependabot.yml",
		".github/workflows/pr.yml",
		".github/workflows/scorecard.yml",
		".github/workflows/scheduled-health.yml",
		"SECURITY.md",
		"SUPPORT.md",
	];
	return expectedFiles
		.filter((path) => !existsSync(join(root, path)))
		.map((path) => issue(path, "required collaboration scaffold is missing"));
}

function auditCollaborationDocs(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	requireContains(issues, root, "README.md", ["CONTRIBUTING.md", "SECURITY.md"]);
	requireContains(issues, root, "CONTRIBUTING.md", [
		"public-source-data.md",
		"main",
		"uv sync --all-packages --dev",
		"pnpm web:typecheck",
		"pre-commit install",
		"不使用 Husky / lint-staged / lefthook",
		"branch protection / rulesets",
		"pr / required",
		"failed、cancelled、missing",
		"changed-surface",
		"manual、staging、eval lane",
		"无条件 PR blocker",
	]);
	requireContains(issues, root, "docs/reference/testing-and-verification-lanes.md", [
		"only repository-level local hook system",
		"Not a typecheck",
		"not a PR blocker",
		"Security / Supply Chain Lanes",
		"GitHub Code Security",
		"Advanced Security",
		"real release artifacts",
		"Gitleaks",
		"OSV-Scanner",
		"pnpm-lock.yaml",
		"full commit SHA",
		"SBOM artifact",
		"private repository",
		"branch protection / rulesets",
		"pr / required",
		"changed-surface detection",
	]);
	const preCommit = readText(join(root, ".pre-commit-config.yaml"));
	for (const token of ["check-toml", "https://github.com/gitleaks/gitleaks"]) {
		if (!preCommit.includes(token)) {
			issues.push(issue(".pre-commit-config.yaml", `missing required token: ${token}`));
		}
	}
	const packageJson = JSON.stringify(readJson(join(root, "package.json")));
	for (const token of ["lint-staged", "lefthook", "simple-git-hooks"]) {
		if (packageJson.includes(token)) {
			issues.push(issue("package.json", `forbidden hook package token is present: ${token}`));
		}
	}
	const scripts = objectValue(readJson(join(root, "package.json")).scripts) ?? {};
	if ("prepare" in scripts) {
		issues.push(issue("package.json", "root package.json must not define prepare hook script"));
	}
	if (existsSync(join(root, ".husky"))) {
		issues.push(issue(".husky", "Husky local hook system must not be present"));
	}
	return issues;
}

function auditCodeowners(root: string): RepoGuardIssue[] {
	const codeowners = readText(join(root, ".github/CODEOWNERS"));
	const issues: RepoGuardIssue[] = [];
	for (const token of [
		"* @Linear27",
		"/.github/ @Linear27",
		"/docs/ @Linear27",
		"/apps/ @Linear27",
		"/packages/ @Linear27",
		"/scripts/ @Linear27",
		"/tests/ @Linear27",
	]) {
		if (!codeowners.includes(token)) {
			issues.push(issue(".github/CODEOWNERS", `missing required ownership token: ${token}`));
		}
	}
	return issues;
}

function auditDependabot(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const config = readYaml(join(root, ".github/dependabot.yml"));
	if (config.version !== 2) {
		issues.push(issue(".github/dependabot.yml", "dependabot version must be 2"));
	}
	const updates = Array.isArray(config.updates) ? config.updates.filter(isRecord) : [];
	const surfaces = new Set(
		updates.map(
			(entry) => `${stringValue(entry["package-ecosystem"])}:${stringValue(entry.directory)}`,
		),
	);
	for (const surface of ["github-actions:/", "npm:/", "gomod:/apps/execution-control"]) {
		if (!surfaces.has(surface)) {
			issues.push(issue(".github/dependabot.yml", `missing dependabot surface: ${surface}`));
		}
	}
	for (const entry of updates) {
		if (stringValue(objectValue(entry.schedule)?.interval) !== "weekly") {
			issues.push(issue(".github/dependabot.yml", "dependabot entries must run weekly"));
		}
		if (
			typeof entry["open-pull-requests-limit"] !== "number" ||
			entry["open-pull-requests-limit"] <= 0
		) {
			issues.push(
				issue(".github/dependabot.yml", "dependabot entries must allow at least one open PR"),
			);
		}
	}
	return issues;
}

function auditSecurityPosture(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const scorecardText = readText(join(root, ".github/workflows/scorecard.yml"));
	const scorecard = readYaml(join(root, ".github/workflows/scorecard.yml"));
	const scorecardTriggers = triggerKeys(scorecard);
	for (const trigger of ["workflow_dispatch", "schedule"]) {
		if (!scorecardTriggers.has(trigger)) {
			issues.push(issue(".github/workflows/scorecard.yml", `scorecard must include ${trigger}`));
		}
	}
	if (scorecardTriggers.has("pull_request")) {
		issues.push(issue(".github/workflows/scorecard.yml", "scorecard must not block pull_request"));
	}
	for (const token of ["ossf/scorecard-action@v2.4.3", "publish_results: false"]) {
		if (!scorecardText.includes(token)) {
			issues.push(issue(".github/workflows/scorecard.yml", `missing required token: ${token}`));
		}
	}
	for (const token of ["security-events: write", "id-token: write"]) {
		if (scorecardText.includes(token)) {
			issues.push(issue(".github/workflows/scorecard.yml", `forbidden permission token: ${token}`));
		}
	}
	issues.push(...auditScheduledChecks(root));
	issues.push(...auditSecurityLaneDocs(root));
	issues.push(...auditDiningImageWorkflow(root));
	issues.push(...auditNoUnconditionalAdvancedSecurity(root));
	return issues;
}

function auditScheduledChecks(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const path = ".github/workflows/scheduled-health.yml";
	const workflowText = readText(join(root, path));
	const workflow = readYaml(join(root, path));
	const triggers = triggerKeys(workflow);
	for (const trigger of ["workflow_dispatch", "schedule"]) {
		if (!triggers.has(trigger)) {
			issues.push(issue(path, `scheduled checks must include ${trigger}`));
		}
	}
	if (triggers.has("pull_request")) {
		issues.push(issue(path, "scheduled checks must not run on pull_request"));
	}
	const turboTeamVariable = ["TURBO_TEAM: ", "$", "{{ vars.TURBO_TEAM }}"].join("");
	for (const token of [
		"pnpm ci:repo:full",
		"pnpm repo:self-test",
		"pnpm ci:web:full",
		"pnpm ci:contracts",
		"pnpm ci:ingest",
		"pnpm ci:eval",
		"pnpm ci:go",
		"google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.8",
		"golangci-lint@v2.11.4",
		turboTeamVariable,
	]) {
		if (!workflowText.includes(token)) {
			issues.push(issue(path, `missing required token: ${token}`));
		}
	}
	const secretRefs = Array.from(new Set(workflowText.match(/secrets\.[A-Z0-9_]+/g) ?? [])).sort();
	if (JSON.stringify(secretRefs) !== JSON.stringify(["secrets.TURBO_TOKEN"])) {
		issues.push(
			issue(
				path,
				`scheduled checks secret refs must only include TURBO_TOKEN, got ${secretRefs.join(", ")}`,
			),
		);
	}
	return issues;
}

function auditSecurityLaneDocs(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const combined = [
		readText(join(root, ".github/pull_request_template.md")),
		readText(join(root, "CONTRIBUTING.md")),
		readText(join(root, "docs/reference/testing-and-verification-lanes.md")),
	].join("\n");
	for (const token of [
		"Dependabot PR",
		"GitHub Actions",
		"pnpm ci:config",
		"npm / pnpm",
		"pnpm ci:web",
		"Go module",
		"pnpm ci:go",
		"gitleaks/gitleaks-action@v3",
		"pnpm ci:deps",
		"actionlint",
		"zizmor",
		"CodeQL",
		"Dependency Review",
		"artifact attestation",
	]) {
		if (!combined.includes(token)) {
			issues.push(
				issue(
					"docs/reference/testing-and-verification-lanes.md",
					`collaboration/security docs missing token: ${token}`,
				),
			);
		}
	}
	const prChecks = readText(join(root, ".github/workflows/pr.yml"));
	const rootScripts = objectValue(readJson(join(root, "package.json")).scripts) ?? {};
	for (const script of ["ci:deps"]) {
		if (!(script in rootScripts)) {
			issues.push(issue("package.json", `missing security script: ${script}`));
		}
	}
	if ("ci:secrets" in rootScripts) {
		issues.push(
			issue("package.json", "ci:secrets must not be restored; use GitHub Gitleaks action"),
		);
	}
	for (const token of [
		"secrets:",
		"gitleaks/gitleaks-action@v3",
		"osv-scanner-reusable-pr.yml@v2.3.8",
	]) {
		if (!prChecks.includes(token)) {
			issues.push(issue(".github/workflows/pr.yml", `missing required token: ${token}`));
		}
	}
	return issues;
}

function auditDiningImageWorkflow(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const path = ".github/workflows/dining-sync-image.yml";
	const text = readText(join(root, path));
	for (const token of [
		"aquasecurity/trivy-action@v0.36.0",
		"anchore/sbom-action@v0.24.0",
		'exit-code: "1"',
		"severity: HIGH,CRITICAL",
		"dependency-snapshot: false",
	]) {
		if (!text.includes(token)) {
			issues.push(issue(path, `missing required image security token: ${token}`));
		}
	}
	return issues;
}

function auditNoUnconditionalAdvancedSecurity(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	for (const name of fileNames(join(root, ".github/workflows"))) {
		if (!name.endsWith(".yml")) {
			continue;
		}
		const path = `.github/workflows/${name}`;
		const text = readText(join(root, path));
		if (
			!["codeql", "dependency-review", "attestation"].some((token) =>
				text.toLowerCase().includes(token),
			)
		) {
			continue;
		}
		if (triggerKeys(readYaml(join(root, path))).has("pull_request")) {
			issues.push(
				issue(
					path,
					"CodeQL / Dependency Review / attestation must not be unconditional pull_request blockers",
				),
			);
		}
	}
	return issues;
}

function auditGitHubTemplates(root: string): RepoGuardIssue[] {
	const issues: RepoGuardIssue[] = [];
	const issueRoot = join(root, ".github/ISSUE_TEMPLATE");
	const templateNames = new Set(fileNames(issueRoot));
	for (const expected of expectedIssueForms) {
		if (!templateNames.has(expected)) {
			issues.push(
				issue(`.github/ISSUE_TEMPLATE/${expected}`, "expected GitHub issue form is missing"),
			);
		}
	}
	for (const actual of templateNames) {
		if (!expectedIssueForms.has(actual)) {
			issues.push(issue(`.github/ISSUE_TEMPLATE/${actual}`, "unexpected issue template file"));
		}
		if (actual.endsWith(".md")) {
			issues.push(
				issue(`.github/ISSUE_TEMPLATE/${actual}`, "issue templates must use YAML issue forms"),
			);
		}
	}
	const config = readYaml(join(issueRoot, "config.yml"));
	if (config.blank_issues_enabled !== false) {
		issues.push(issue(".github/ISSUE_TEMPLATE/config.yml", "blank issues must be disabled"));
	}
	for (const formName of expectedIssueForms) {
		if (formName === "config.yml") {
			continue;
		}
		const formPath = `.github/ISSUE_TEMPLATE/${formName}`;
		const form = readYaml(join(root, formPath));
		for (const key of ["name", "description", "title"]) {
			if (typeof form[key] !== "string") {
				issues.push(issue(formPath, `issue form ${key} must be a string`));
			}
		}
		if (!Array.isArray(form.labels)) {
			issues.push(issue(formPath, "issue form labels must be a list"));
		}
		const body = Array.isArray(form.body) ? form.body.filter(isRecord) : [];
		if (body.length === 0) {
			issues.push(issue(formPath, "issue form body must be non-empty"));
		}
		if (!body.some((entry) => entry.type === "checkboxes")) {
			issues.push(issue(formPath, "issue form body must include checkboxes"));
		}
	}
	issues.push(...auditPullRequestTemplate(root));
	return issues;
}

function auditPullRequestTemplate(root: string): RepoGuardIssue[] {
	const path = ".github/pull_request_template.md";
	const template = readText(join(root, path));
	const headings = template
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("## "));
	const expectedHeadings = [
		"## Why is this change needed?",
		"## What changed?",
		"## How was this verified?",
		"## Related issue(s)",
		"## Change category",
		"## User-facing change",
		"## API / contract / migration impact",
		"## Documentation",
	];
	const issues: RepoGuardIssue[] = [];
	if (JSON.stringify(headings) !== JSON.stringify(expectedHeadings)) {
		issues.push(issue(path, "pull request template headings must stay GitHub-native and ordered"));
	}
	for (const token of [
		"- [ ] Feature",
		"- [ ] API / contract change",
		"- [ ] Cleanup / refactor",
		"```release-note",
		"NONE",
		"```docs",
		'If there is no associated issue, then write "N/A".',
	]) {
		if (!template.includes(token)) {
			issues.push(issue(path, `pull request template missing token: ${token}`));
		}
	}
	for (const token of [
		"/kind ",
		"/release-note-none",
		"Public Source / Data Boundary",
		"Data Boundary",
		"CI 与合并纪律",
		"CodeQL",
		"Dependency Review",
		"artifact attestation",
		"branch protection",
		"changed-surface",
		"manual / staging / eval lane",
		"private repo",
		"pr-checks / required-checks",
		"source-derived documents",
		"No internal publish/deploy workflow",
		"explicitly redistributable",
		"Kubernetes / Prow",
		"Reviewer Notes",
	]) {
		if (template.includes(token)) {
			issues.push(issue(path, `pull request template contains forbidden token: ${token}`));
		}
	}
	return issues;
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

function triggerKeys(workflow: Record<string, unknown>): Set<string> {
	const raw = workflow.on ?? workflow[true as unknown as keyof typeof workflow];
	if (typeof raw === "string") {
		return new Set([raw]);
	}
	if (Array.isArray(raw)) {
		return new Set(raw.map(String));
	}
	if (isRecord(raw)) {
		return new Set(Object.keys(raw));
	}
	return new Set();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
