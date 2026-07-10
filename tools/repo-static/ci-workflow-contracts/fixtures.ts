import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { requiredCiScriptTokens, requiredWorkflowScriptCalls } from "./core.ts";
import { gh, requiredGolangciLintInstall } from "./lib.ts";

interface WorkflowOptions {
	pnpm?: string;
	includeConcurrency?: boolean;
	includePathFilters?: boolean;
	includeRequired?: boolean;
	omitPrCall?: string;
	omitScheduledCall?: string;
	installGolangciLint?: boolean;
	setupCache?: boolean;
	diningSchedule?: boolean;
	diningUnconditionalPush?: boolean;
}

export function requiredScripts(): Record<string, string> {
	return {
		"repo:guard": "pnpm exec tsx scripts/check_repo_guard.ts",
		"repo:self-test": "pnpm exec tsx scripts/check_repo_static.ts --self-test-all",
		"repo:static": "pnpm exec tsx scripts/check_repo_static.ts",
		"repo:static:affected": "pnpm exec tsx scripts/check_repo_static.ts --affected",
		"ci:repo": joinTokens("ci:repo"),
		"ci:repo:full": joinTokens("ci:repo:full"),
		"ci:contracts": joinTokens("ci:contracts"),
		"ci:ingest": joinTokens("ci:ingest"),
		"ci:eval": joinTokens("ci:eval"),
		"ci:go": "pnpm go:check",
		"ci:web": joinTokens("ci:web"),
		"ci:web:full": joinTokens("ci:web:full"),
		"ci:worker": joinTokens("ci:worker"),
		"ci:config": joinTokens("ci:config"),
		"ci:actions:lint": joinTokens("ci:actions:lint"),
		"ci:deps": joinTokens("ci:deps"),
	};
}

function joinTokens(scriptName: string): string {
	return (requiredCiScriptTokens.get(scriptName) ?? []).join(" && ");
}

export function writePackage(path: string, scripts = requiredScripts(), pnpm = "10.26.1"): void {
	writeText(path, JSON.stringify({ packageManager: `pnpm@${pnpm}`, scripts }));
}

export function writeMinimalWorkflows(root: string, options: WorkflowOptions = {}): void {
	const pnpm = options.pnpm ?? "10.26.1";
	const prCalls =
		requiredWorkflowScriptCalls
			.get(".github/workflows/pr.yml")
			?.filter((call) => call !== options.omitPrCall) ?? [];
	writeText(
		join(root, ".github/workflows/pr.yml"),
		[
			"name: pr",
			"on:",
			"  pull_request:",
			...concurrencyLines(options.includeConcurrency !== false),
			"jobs:",
			...changesJobLines(options.includePathFilters !== false),
			"  repo:",
			"    needs: changes",
			"    env:",
			`      CI_BASE_REF: ${gh("needs.changes.outputs.base_sha")}`,
			"    steps:",
			"      - uses: pnpm/action-setup@v6",
			"        with:",
			`          version: ${pnpm}`,
			"      - uses: actions/setup-node@v6",
			"        with:",
			'          node-version: "24"',
			...nodeCacheLines(options.setupCache !== false),
			"      - run: pnpm install --frozen-lockfile",
			...prCalls.map((call) => `      - run: ${call}`),
			...secretJobLines(),
			...pathFilteredJobLines(pnpm, options),
			...depsJobsLines(),
			...requiredJobLines(options.includeRequired !== false),
			"",
		].join("\n"),
	);
	writeDiningImageWorkflow(root, options);
	writeScheduledHealthWorkflow(root, pnpm, options);
}

function changesJobLines(enabled: boolean): string[] {
	return enabled
		? [
				"  changes:",
				"    outputs:",
				`      base_sha: ${gh("steps.base.outputs.base_sha")}`,
				`      ci: ${gh("steps.filter.outputs.ci")}`,
				`      contracts: ${gh("steps.filter.outputs.contracts")}`,
				`      deps: ${gh("steps.filter.outputs.deps")}`,
				`      eval: ${gh("steps.filter.outputs.eval")}`,
				`      go: ${gh("steps.filter.outputs.go")}`,
				`      ingest: ${gh("steps.filter.outputs.ingest")}`,
				`      web: ${gh("steps.filter.outputs.web")}`,
				`      worker: ${gh("steps.filter.outputs.worker")}`,
				"    steps:",
				"      - id: base",
				"        run: echo base_sha=HEAD~1",
				"      - id: filter",
				"        run: echo success",
			]
		: [];
}

function secretJobLines(): string[] {
	return [
		"  secrets:",
		"    steps:",
		"      - uses: gitleaks/gitleaks-action@v3",
		"        env:",
		`          GITHUB_TOKEN: ${gh("secrets.GITHUB_TOKEN")}`,
		`          GITLEAKS_LICENSE: ${gh("secrets.GITLEAKS_LICENSE")}`,
	];
}

function pathFilteredJobLines(pnpm: string, options: WorkflowOptions): string[] {
	return [
		"  web:",
		"    needs: changes",
		"    if: needs.changes.outputs.web == 'true' || needs.changes.outputs.deps == 'true' || needs.changes.outputs.ci == 'true'",
		"    env:",
		`      TURBO_SCM_BASE: ${gh("needs.changes.outputs.base_sha")}`,
		`      TURBO_TOKEN: ${gh("secrets.TURBO_TOKEN")}`,
		`      TURBO_TEAM: ${gh("vars.TURBO_TEAM")}`,
		"    steps:",
		"      - uses: pnpm/action-setup@v6",
		"        with:",
		`          version: ${pnpm}`,
		"      - run: pnpm ci:web",
		...simplePathJob("worker", "worker", "pnpm ci:worker"),
		...simplePathJob("contracts", "contracts", "pnpm ci:contracts"),
		"  go:",
		"    needs: changes",
		"    if: needs.changes.outputs.go == 'true' || needs.changes.outputs.ci == 'true'",
		"    steps:",
		...(options.installGolangciLint === false
			? []
			: [`      - run: ${requiredGolangciLintInstall}`]),
		"      - run: pnpm ci:go",
		...simplePathJob("eval", "eval", "pnpm ci:eval"),
		...simplePathJob("ingest", "ingest", "pnpm ci:ingest"),
	];
}

function simplePathJob(jobName: string, outputName: string, command: string): string[] {
	return [
		`  ${jobName}:`,
		"    needs: changes",
		`    if: needs.changes.outputs.${outputName} == 'true' || needs.changes.outputs.ci == 'true'`,
		"    steps:",
		`      - run: ${command}`,
	];
}

function depsJobsLines(): string[] {
	return [
		"  deps-pr:",
		"    needs: changes",
		"    if: github.event_name == 'pull_request' && (needs.changes.outputs.deps == 'true' || needs.changes.outputs.ci == 'true')",
		"    uses: google/osv-scanner-action/.github/workflows/osv-scanner-reusable-pr.yml@v2.3.8",
		"  deps-full:",
		"    needs: changes",
		"    if: github.event_name != 'pull_request' && (needs.changes.outputs.deps == 'true' || needs.changes.outputs.ci == 'true')",
		"    uses: google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.8",
	];
}

function requiredJobLines(enabled: boolean): string[] {
	return enabled
		? [
				"  required:",
				"    needs:",
				"      - changes",
				"      - repo",
				"      - secrets",
				"      - web",
				"      - worker",
				"      - contracts",
				"      - go",
				"      - eval",
				"      - ingest",
				"      - deps-pr",
				"      - deps-full",
				"    if: always()",
				"    steps:",
				"      - run: echo success|skipped",
			]
		: [];
}

function writeDiningImageWorkflow(root: string, options: WorkflowOptions): void {
	const guard = options.diningUnconditionalPush ? "true" : gh("inputs.push_image");
	writeText(
		join(root, ".github/workflows/dining-sync-image.yml"),
		[
			"name: dining-sync-image",
			"on:",
			...(options.diningSchedule ? ["  schedule:", "    - cron: '11 4 * * *'"] : []),
			"  workflow_dispatch:",
			"    inputs:",
			"      push_image:",
			"        default: false",
			"permissions:",
			"  contents: read",
			"  packages: write",
			"jobs:",
			"  build:",
			"    steps:",
			"      - uses: docker/build-push-action@v7",
			"        with:",
			"          load: true",
			"          push: false",
			"      - uses: aquasecurity/trivy-action@v0.36.0",
			"        with:",
			'          exit-code: "1"',
			"          severity: HIGH,CRITICAL",
			"      - uses: anchore/sbom-action@v0.24.0",
			`        if: ${guard}`,
			"        with:",
			"          dependency-snapshot: false",
			"      - uses: docker/login-action@v4.3.0",
			`        if: ${guard}`,
			"      - uses: docker/build-push-action@v7",
			`        if: ${guard}`,
			"        with:",
			"          push: true",
			"",
		].join("\n"),
	);
}

function writeScheduledHealthWorkflow(root: string, pnpm: string, options: WorkflowOptions): void {
	const scheduledCalls = [
		"pnpm ci:repo:full",
		"pnpm repo:self-test",
		"pnpm ci:web:full",
		"pnpm ci:contracts",
		"pnpm ci:ingest",
		"pnpm ci:eval",
		"pnpm ci:go",
	].filter((call) => call !== options.omitScheduledCall);
	writeText(
		join(root, ".github/workflows/scheduled-health.yml"),
		[
			"name: scheduled-health",
			"on:",
			"  workflow_dispatch:",
			"  schedule:",
			"    - cron: '23 2 * * *'",
			...concurrencyLines(true),
			"jobs:",
			"  web:",
			"    env:",
			`      TURBO_TOKEN: ${gh("secrets.TURBO_TOKEN")}`,
			`      TURBO_TEAM: ${gh("vars.TURBO_TEAM")}`,
			"    steps:",
			"      - uses: pnpm/action-setup@v6",
			"        with:",
			`          version: ${pnpm}`,
			"      - uses: actions/setup-node@v6",
			"        with:",
			'          node-version: "24"',
			...nodeCacheLines(options.setupCache !== false),
			"      - run: pnpm install --frozen-lockfile",
			...scheduledCalls
				.filter((call) => call !== "pnpm ci:go")
				.map((call) => `      - run: ${call}`),
			"  go:",
			"    steps:",
			...(options.installGolangciLint === false
				? []
				: [`      - run: ${requiredGolangciLintInstall}`]),
			...(scheduledCalls.includes("pnpm ci:go") ? ["      - run: pnpm ci:go"] : []),
			"  deps:",
			"    uses: google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.8",
			"",
		].join("\n"),
	);
}

function concurrencyLines(enabled: boolean): string[] {
	return enabled
		? [
				"concurrency:",
				`  group: ${gh("github.workflow")}-${gh("github.event.pull_request.number || github.ref")}`,
				"  cancel-in-progress: true",
			]
		: [];
}

function nodeCacheLines(enabled: boolean): string[] {
	return enabled
		? ["          cache: pnpm", "          cache-dependency-path: pnpm-lock.yaml"]
		: [];
}

function writeText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, "utf8");
}
