import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { auditCiWorkflowContracts } from "./core.ts";
import { requiredScripts, writeMinimalWorkflows, writePackage } from "./fixtures.ts";
import { gh, renderIssue } from "./lib.ts";

export function runCiWorkflowContractSelfTest(repoRoot: string): number {
	expectEqualJson(auditCiWorkflowContracts(repoRoot), [], "current repo CI workflow contracts");

	withFixture((root) => {
		writePackage(join(root, "package.json"));
		writeText(
			join(root, "apps/app-api/package.json"),
			JSON.stringify({ packageManager: "pnpm@10.17.1" }),
		);
		writeMinimalWorkflows(root, { pnpm: "10.17.1" });
		expectIssues(root, [
			"apps/app-api/package.json: packageManager pnpm version 10.17.1 does not match root 10.26.1",
			".github/workflows/pr.yml: pnpm/action-setup version 10.17.1 does not match root 10.26.1",
			".github/workflows/scheduled-health.yml: pnpm/action-setup version 10.17.1 does not match root 10.26.1",
		]);
	});

	withFixture((root) => {
		const scripts = requiredScripts();
		delete scripts["ci:repo"];
		writePackage(join(root, "package.json"), scripts);
		writeMinimalWorkflows(root, { omitPrCall: "pnpm ci:repo" });
		expectIssues(root, [
			"package.json: missing required CI lane script: ci:repo",
			".github/workflows/pr.yml: workflow does not call required script: pnpm ci:repo",
		]);
	});

	withFixture((root) => {
		const scripts = requiredScripts();
		scripts["ci:config"] = "pnpm ci:actions:lint";
		writePackage(join(root, "package.json"), scripts);
		writeMinimalWorkflows(root);
		expectIssues(root, [
			"package.json: ci:config must include required command token: uvx zizmor --min-severity=medium .github",
			"package.json: ci:config must include required command token: pnpm exec tsx scripts/check_repo_static.ts --ci-workflows",
		]);
	});

	withFixture((root) => {
		const scripts = requiredScripts();
		scripts["ci:python-islands"] = "true";
		writePackage(join(root, "package.json"), scripts);
		writeMinimalWorkflows(root);
		expectIssues(root, [
			"package.json: retired CI lane script must not be restored: ci:python-islands",
		]);
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"));
		writeMinimalWorkflows(root, {
			includeConcurrency: false,
			includeRequired: false,
			includePathFilters: false,
			installGolangciLint: false,
			setupCache: false,
			diningSchedule: true,
			diningUnconditionalPush: true,
			omitScheduledCall: "pnpm ci:eval",
		});
		expectIssues(root, [
			".github/workflows/pr.yml: workflow must configure concurrency to cancel superseded runs",
			".github/workflows/pr.yml: pr workflow must define required aggregate job",
			".github/workflows/pr.yml: pr workflow must define a changes job for path-filtered heavy lanes",
			".github/workflows/pr.yml: go must install golangci-lint v2.11.4 before pnpm ci:go",
			".github/workflows/scheduled-health.yml: scheduled health workflow does not call required script: pnpm ci:eval",
			".github/workflows/scheduled-health.yml: go must install golangci-lint v2.11.4 before pnpm ci:go",
			".github/workflows/dining-sync-image.yml: manual-only workflow must not define automatic triggers: schedule",
			".github/workflows/dining-sync-image.yml: dining-sync image workflow must gate GHCR login and image push behind inputs.push_image",
		]);
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"));
		writeMinimalWorkflows(root);
		writeText(
			join(root, ".github/workflows/broken-pnpm-cache.yml"),
			[
				"name: broken",
				"on: workflow_dispatch",
				"jobs:",
				"  check:",
				"    steps:",
				"      - uses: actions/setup-node@v6",
				"        with:",
				'          node-version: "24"',
				"          cache: pnpm",
				"          cache-dependency-path: pnpm-lock.yaml",
				"      - uses: pnpm/action-setup@v6",
				"        with:",
				"          version: 10.26.1",
				"      - run: pnpm install --frozen-lockfile",
			].join("\n"),
		);
		expectIssues(root, [
			".github/workflows/broken-pnpm-cache.yml: pnpm/action-setup must run before actions/setup-node when setup-node enables pnpm cache",
			".github/workflows/broken-pnpm-cache.yml: workflow is not in the governed workflow surface",
		]);
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"));
		writeMinimalWorkflows(root);
		writeText(
			join(root, ".github/workflows/extra.yml"),
			[
				"name: extra",
				"on: workflow_dispatch",
				"jobs:",
				"  check:",
				"    steps:",
				"      - run: true",
			].join("\n"),
		);
		expectIssues(root, [
			".github/workflows/extra.yml: workflow is not in the governed workflow surface",
		]);
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"));
		writeMinimalWorkflows(root);
		writeText(
			join(root, ".github/workflows/deploy-staging.yml"),
			[
				"name: deploy-staging",
				"on: workflow_dispatch",
				"jobs:",
				"  deploy:",
				"    env:",
				`      CLOUDFLARE_ACCOUNT_ID: ${gh("secrets.CLOUDFLARE_ACCOUNT_ID")}`,
				`      CLOUDFLARE_API_TOKEN: ${gh("secrets.CLOUDFLARE_API_TOKEN")}`,
				`      STAGING_ACCESS_POLICY_AUD: ${gh("secrets.STAGING_ACCESS_POLICY_AUD")}`,
				`      STAGING_ACCESS_TEAM_DOMAIN: ${gh("vars.STAGING_ACCESS_TEAM_DOMAIN")}`,
				`      STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY: ${gh("vars.STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY")}`,
				"      STAGING_EXECUTION_CONTROL_BASE_URL: https://execution-control-staging.example",
				"    steps:",
				"      - run: true",
			].join("\n"),
		);
		expectIssues(root, [
			[
				".github/workflows/deploy-staging.yml: deploy staging env CLOUDFLARE_ACCOUNT_ID",
				`must be ${gh("vars.CLOUDFLARE_ACCOUNT_ID")}`,
			].join(" "),
			[
				".github/workflows/deploy-staging.yml: deploy staging env STAGING_ACCESS_POLICY_AUD",
				`must be ${gh("vars.STAGING_ACCESS_POLICY_AUD")}`,
			].join(" "),
			".github/workflows/deploy-staging.yml: deploy staging workflow must not reference retired token: secrets.CLOUDFLARE_ACCOUNT_ID",
			".github/workflows/deploy-staging.yml: deploy staging workflow must not reference retired token: secrets.STAGING_ACCESS_POLICY_AUD",
			".github/workflows/deploy-staging.yml: deploy staging workflow must not reference retired token: STAGING_EXECUTION_CONTROL_BASE_URL",
		]);
	});

	return 0;
}

function expectIssues(root: string, expected: string[]): void {
	const rendered = auditCiWorkflowContracts(root).map(renderIssue);
	for (const issue of expected) {
		if (!rendered.includes(issue)) {
			throw new Error(
				`missing expected issue ${JSON.stringify(issue)} in ${JSON.stringify(rendered)}`,
			);
		}
	}
}

function expectEqualJson(actual: unknown, expected: unknown, label: string): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} mismatch: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
	}
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "ci-workflow-contracts-"));
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
