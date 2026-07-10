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

export interface PackageScriptPolicyIssue {
	path: string;
	script: string;
	message: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

const rootScriptAllowlist = new Set([
	"repo:guard",
	"repo:self-test",
	"repo:static",
	"repo:static:affected",
	"smoke:app-api",
	"ci:repo",
	"ci:repo:full",
	"ci:contracts",
	"ci:ingest",
	"ci:eval",
	"ci:go",
	"ci:web",
	"ci:web:full",
	"ci:worker",
	"ci:config",
	"ci:actions:lint",
	"ci:deps",
	"dev",
	"web:build",
	"web:check",
	"web:lint",
	"web:test",
	"web:test:worker",
	"web:test:integration",
	"web:typecheck",
	"contracts:generate",
	"contracts:check",
	"go:check",
]);

const deployInternalPrefixes = [
	"deploy:check-secrets:",
	"deploy:preflight:",
	"deploy:verify-config",
];

const sourceCollectorAllowedScripts = new Set(["test", "typecheck"]);
const jobPackageAllowedScripts = new Set(["build", "test", "typecheck"]);
const scriptOperationDebtPattern = /\b(?:proof|backfill|one[-:]?shot|live[-:]?provider)\b/u;
const publicPackageScriptPrefixes = [
	"build",
	"check",
	"dev",
	"deploy",
	"generate",
	"lint",
	"self-test",
	"test",
	"typecheck",
];
const appLocalScriptDebtPattern = /(?:^|[-_.])(?:e2e|smoke|provision|reconcile|seed)(?:[-_.]|$)/u;
const appLocalScriptDebtMessage =
	"app scripts/ must only keep build/deploy/preflight/dev entrypoints; e2e/smoke belongs under e2e/ and db/identity operations belong under ops/";
const publicDeployImplementationPattern =
	/\btools\/deploy\/|\.\.\/\.\.\/tools\/deploy\/|\.\.\/\.\.\/\.\.\/tools\/deploy\//u;
const publicDeployEntrypointMessage =
	"tools/deploy has been removed; package scripts must use scripts/deploy entrypoints";

export function auditPackageScriptPolicy(root = repoRoot): PackageScriptPolicyIssue[] {
	return [
		...auditRootScripts(root),
		...packagePaths(root).flatMap((packagePath) => auditPackageScripts(root, packagePath)),
		...auditAppLocalScriptLayout(root),
	];
}

function auditRootScripts(root: string): PackageScriptPolicyIssue[] {
	const scripts = readScripts(join(root, "package.json"));
	const issues: PackageScriptPolicyIssue[] = [];
	for (const script of Object.keys(scripts).sort()) {
		if (!rootScriptAllowlist.has(script)) {
			issues.push({
				path: "package.json",
				script,
				message: "root package.json may only expose repo, ci, web, contracts, and go public lanes",
			});
		}
	}
	if (rootDevMissingStudentSurfaceDependency(scripts.dev ?? "")) {
		issues.push({
			path: "package.json",
			script: "dev",
			message:
				"root dev must start both campus-web and app-api for local student-surface development",
		});
	}
	return issues;
}

function rootDevMissingStudentSurfaceDependency(command: string): boolean {
	if (command === "") {
		return false;
	}
	if (!command.includes("turbo run dev")) {
		return true;
	}
	return !(command.includes("--filter=campus-web") && command.includes("--filter=app-api"));
}

function auditPackageScripts(root: string, packagePath: string): PackageScriptPolicyIssue[] {
	const scripts = readScripts(packagePath);
	const relpath = relative(root, packagePath).replaceAll("\\", "/");
	const issues: PackageScriptPolicyIssue[] = [];
	for (const script of Object.keys(scripts).sort()) {
		const command = scripts[script] ?? "";
		if (publicDeployImplementationPattern.test(command)) {
			issues.push({
				path: relpath,
				script,
				message: publicDeployEntrypointMessage,
			});
		}
		if (deployInternalPrefixes.some((prefix) => script.startsWith(prefix))) {
			issues.push({
				path: relpath,
				script,
				message: "deploy internals must be owned by deploy scripts instead of package.json aliases",
			});
		}
		if (scriptOperationDebtPattern.test(script) || scriptOperationDebtPattern.test(command)) {
			issues.push({
				path: relpath,
				script,
				message:
					"one-off proof/backfill/live-provider operations must not be exposed as package scripts",
			});
		}
		if ((script.includes("smoke") || command.includes("smoke")) && relpath !== "package.json") {
			issues.push({
				path: relpath,
				script,
				message: "smoke helpers must be invoked through scripts/ public CLI entrypoints",
			});
		}
		if (script.endsWith(":audit") || script.includes(":audit:")) {
			issues.push({
				path: relpath,
				script,
				message: "one-off audit helpers must not be exposed as package scripts",
			});
		}
		if (
			relpath === "apps/source-collector/package.json" &&
			!sourceCollectorAllowedScripts.has(script)
		) {
			issues.push({
				path: relpath,
				script,
				message:
					"source-collector package scripts may only expose test/typecheck verification lanes; runtime entrypoints must be invoked directly or through ingestion-control jobs",
			});
		}
		if (relpath.startsWith("jobs/") && !jobPackageAllowedScripts.has(script)) {
			issues.push({
				path: relpath,
				script,
				message:
					"job package scripts may only expose build/test/typecheck; job operations must use the job CLI or platform scheduler",
			});
		}
		if (
			relpath === "apps/campus-web/package.json" &&
			script.startsWith("build:") &&
			script !== "build:staging" &&
			script.endsWith(":staging")
		) {
			issues.push({
				path: relpath,
				script,
				message:
					"campus-web staging split build aliases must not be public package scripts; use build:staging",
			});
		}
		if (
			relpath.startsWith("packages/") &&
			!publicPackageScriptPrefixes.some(
				(prefix) => script === prefix || script.startsWith(`${prefix}:`),
			)
		) {
			issues.push({
				path: relpath,
				script,
				message:
					"package scripts may only expose conventional verification/build lanes; operational CLIs must be invoked directly",
			});
		}
	}
	return dedupeIssues(issues);
}

function auditAppLocalScriptLayout(root: string): PackageScriptPolicyIssue[] {
	const issues: PackageScriptPolicyIssue[] = [];
	for (const path of appScriptFiles(root, "app-api")) {
		const relpath = relative(root, path).replaceAll("\\", "/");
		const filename = relpath.slice(relpath.lastIndexOf("/") + 1);
		if (appLocalScriptDebtPattern.test(filename)) {
			issues.push({
				path: relpath,
				script: filename,
				message: appLocalScriptDebtMessage,
			});
		}
		if (
			filename.endsWith(".args.ts") ||
			filename.endsWith(".types.ts") ||
			filename.endsWith("-lib.ts") ||
			filename.endsWith("-shared.ts")
		) {
			issues.push({
				path: relpath,
				script: filename,
				message:
					"app-api scripts/ may only keep executable app-local entrypoints; e2e support belongs under e2e/support and operational helpers belong under ops/",
			});
		}
	}
	for (const appName of ["campus-web", "operator-console-web"]) {
		for (const path of appScriptFiles(root, appName)) {
			const relpath = relative(root, path).replaceAll("\\", "/");
			const filename = relpath.slice(relpath.lastIndexOf("/") + 1);
			if (appLocalScriptDebtPattern.test(filename)) {
				issues.push({
					path: relpath,
					script: filename,
					message: appLocalScriptDebtMessage,
				});
			}
		}
	}
	for (const path of appScriptFiles(root, "campus-web")) {
		const relpath = relative(root, path).replaceAll("\\", "/");
		const filename = relpath.slice(relpath.lastIndexOf("/") + 1);
		if (
			filename.startsWith("published-reader-") ||
			filename.startsWith("rspress-") ||
			filename === "copy-rspress-docs-build.ts" ||
			filename === "filter-rspress-search-index.ts" ||
			filename === "sync-campus-published-reader.ts"
		) {
			issues.push({
				path: relpath,
				script: filename,
				message:
					"campus-web scripts/ may only keep executable app-local entrypoints; docs reader build implementation belongs under src/docs-reader-build",
			});
		}
	}
	for (const path of forbiddenTestingSupportFiles(root)) {
		const relpath = relative(root, path).replaceAll("\\", "/");
		issues.push({
			path: relpath,
			script: relpath.slice(relpath.lastIndexOf("/") + 1),
			message: "test/e2e support must not live under product src/; use test/ or e2e/support/",
		});
	}
	return issues;
}

function appScriptFiles(root: string, appName: string): string[] {
	const scriptsRoot = join(root, "apps", appName, "scripts");
	if (!existsSync(scriptsRoot)) {
		return [];
	}
	return readdirSync(scriptsRoot, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(scriptsRoot, entry.name));
}

function forbiddenTestingSupportFiles(root: string): string[] {
	const results: string[] = [];
	for (const relativePath of [
		"apps/campus-web/src/testing",
		"apps/app-api/src/script-support/smoke",
	]) {
		const absolutePath = join(root, relativePath);
		if (existsSync(absolutePath)) {
			results.push(...walkFiles(absolutePath));
		}
	}
	return results;
}

function walkFiles(path: string): string[] {
	return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
		const child = join(path, entry.name);
		if (entry.isDirectory()) {
			return walkFiles(child);
		}
		return entry.isFile() ? [child] : [];
	});
}

function packagePaths(root: string): string[] {
	const paths = [
		...packageJsonsUnder(join(root, "apps")),
		...packageJsonsUnder(join(root, "jobs")),
		...packageJsonsUnder(join(root, "packages")),
		...packageJsonsUnder(join(root, "packages", "domains")),
	];
	return [...new Set(paths)].sort();
}

function packageJsonsUnder(parent: string): string[] {
	if (!existsSync(parent)) {
		return [];
	}
	return readdirSync(parent, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(parent, entry.name, "package.json"))
		.filter((path) => existsSync(path));
}

function readScripts(packagePath: string): Record<string, string> {
	if (!existsSync(packagePath)) {
		return {};
	}
	const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: unknown };
	if (!packageJson.scripts || typeof packageJson.scripts !== "object") {
		return {};
	}
	return Object.fromEntries(
		Object.entries(packageJson.scripts).map(([name, value]) => [String(name), String(value)]),
	);
}

function dedupeIssues(issues: PackageScriptPolicyIssue[]): PackageScriptPolicyIssue[] {
	const seen = new Set<string>();
	const result: PackageScriptPolicyIssue[] = [];
	for (const issue of issues) {
		const key = JSON.stringify(issue);
		if (!seen.has(key)) {
			seen.add(key);
			result.push(issue);
		}
	}
	return result;
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "package-script-policy-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writePackage(path: string, scripts: Record<string, string>): void {
	mkdirp(dirname(path));
	writeFileSync(path, JSON.stringify({ scripts }), "utf8");
}

function expectIssueIncluded(
	issues: PackageScriptPolicyIssue[],
	expected: PackageScriptPolicyIssue,
): void {
	if (!issues.some((issue) => JSON.stringify(issue) === JSON.stringify(expected))) {
		throw new Error(`expected issue not found: ${JSON.stringify(expected)}`);
	}
}

function expectNoIssues(issues: unknown[], label: string): void {
	if (issues.length > 0) {
		throw new Error(`${label} should pass, got ${JSON.stringify(issues)}`);
	}
}

function runSelfTest(): number {
	expectNoIssues(auditPackageScriptPolicy(repoRoot), "current package script policy");

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true", "docs:lint": "true" });
		expectIssueIncluded(auditPackageScriptPolicy(root), {
			path: "package.json",
			script: "docs:lint",
			message: "root package.json may only expose repo, ci, web, contracts, and go public lanes",
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { dev: "turbo run dev --filter=campus-web" });
		expectIssueIncluded(auditPackageScriptPolicy(root), {
			path: "package.json",
			script: "dev",
			message:
				"root dev must start both campus-web and app-api for local student-surface development",
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		const packagePath = join(root, "apps", "app-api", "package.json");
		writePackage(packagePath, {
			build: "vite build",
			"deploy:preflight:staging": "pnpm exec tsx ./scripts/preflight-staging.ts",
			"docs:gated:smoke:staging": "tsx scripts/staging-docs-gated-smoke.ts",
		});
		const issues = auditPackageScriptPolicy(root);
		expectIssueIncluded(issues, {
			path: "apps/app-api/package.json",
			script: "deploy:preflight:staging",
			message: "deploy internals must be owned by deploy scripts instead of package.json aliases",
		});
		expectIssueIncluded(issues, {
			path: "apps/app-api/package.json",
			script: "docs:gated:smoke:staging",
			message: "smoke helpers must be invoked through scripts/ public CLI entrypoints",
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "apps", "app-api", "package.json"), {
			deploy: "pnpm exec tsx ../../tools/deploy/run-wrangler-command.ts deploy",
			test: "vitest run",
		});
		expectIssueIncluded(auditPackageScriptPolicy(root), {
			path: "apps/app-api/package.json",
			script: "deploy",
			message: publicDeployEntrypointMessage,
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "apps", "app-api", "package.json"), {
			"runtime-db:proof:staging": "tsx scripts/staging-runtime-db-proof.ts",
			"db:backfill": "tsx scripts/backfill.ts",
			"chat:e2e:live-provider": "tsx scripts/chat-e2e-local-provider.ts",
		});
		const issues = auditPackageScriptPolicy(root);
		for (const script of ["runtime-db:proof:staging", "db:backfill", "chat:e2e:live-provider"]) {
			expectIssueIncluded(issues, {
				path: "apps/app-api/package.json",
				script,
				message:
					"one-off proof/backfill/live-provider operations must not be exposed as package scripts",
			});
		}
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "apps", "app-api", "package.json"), {
			"chat:e2e": "tsx e2e/chat-e2e.ts",
			test: "vitest run",
		});
		const scriptsRoot = join(root, "apps", "app-api", "scripts");
		mkdirp(scriptsRoot);
		writeFileSync(join(scriptsRoot, "chat-e2e.ts"), "", "utf8");
		writeFileSync(join(scriptsRoot, "chat-e2e.args.ts"), "", "utf8");
		const issues = auditPackageScriptPolicy(root);
		expectIssueIncluded(issues, {
			path: "apps/app-api/scripts/chat-e2e.args.ts",
			script: "chat-e2e.args.ts",
			message:
				"app-api scripts/ may only keep executable app-local entrypoints; e2e support belongs under e2e/support and operational helpers belong under ops/",
		});
		expectIssueIncluded(issues, {
			path: "apps/app-api/scripts/chat-e2e.ts",
			script: "chat-e2e.ts",
			message: appLocalScriptDebtMessage,
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "apps", "campus-web", "package.json"), {
			test: "vitest run",
		});
		writePackage(join(root, "apps", "operator-console-web", "package.json"), {
			test: "vitest run",
		});
		const campusScriptsRoot = join(root, "apps", "campus-web", "scripts");
		const operatorScriptsRoot = join(root, "apps", "operator-console-web", "scripts");
		mkdirp(campusScriptsRoot);
		mkdirp(operatorScriptsRoot);
		writeFileSync(join(campusScriptsRoot, "staging-browser-e2e.ts"), "", "utf8");
		writeFileSync(join(operatorScriptsRoot, "staging-access-service-token-smoke.ts"), "", "utf8");
		mkdirp(join(root, "apps", "campus-web", "src", "testing"));
		writeFileSync(join(root, "apps", "campus-web", "src", "testing", "fixture.ts"), "", "utf8");
		mkdirp(join(root, "apps", "app-api", "src", "script-support", "smoke"));
		writeFileSync(
			join(root, "apps", "app-api", "src", "script-support", "smoke", "helper.ts"),
			"",
			"utf8",
		);
		const issues = auditPackageScriptPolicy(root);
		for (const expected of [
			"apps/campus-web/scripts/staging-browser-e2e.ts",
			"apps/operator-console-web/scripts/staging-access-service-token-smoke.ts",
		]) {
			expectIssueIncluded(issues, {
				path: expected,
				script: expected.slice(expected.lastIndexOf("/") + 1),
				message: appLocalScriptDebtMessage,
			});
		}
		expectIssueIncluded(issues, {
			path: "apps/campus-web/src/testing/fixture.ts",
			script: "fixture.ts",
			message: "test/e2e support must not live under product src/; use test/ or e2e/support/",
		});
		expectIssueIncluded(issues, {
			path: "apps/app-api/src/script-support/smoke/helper.ts",
			script: "helper.ts",
			message: "test/e2e support must not live under product src/; use test/ or e2e/support/",
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "apps", "campus-web", "package.json"), {
			"build:app:staging": "vite build",
			"build:docs:staging": "tsx scripts/build-published-reader-docs.ts --staging",
		});
		const issues = auditPackageScriptPolicy(root);
		expectIssueIncluded(issues, {
			path: "apps/campus-web/package.json",
			script: "build:app:staging",
			message:
				"campus-web staging split build aliases must not be public package scripts; use build:staging",
		});
		expectIssueIncluded(issues, {
			path: "apps/campus-web/package.json",
			script: "build:docs:staging",
			message:
				"campus-web staging split build aliases must not be public package scripts; use build:staging",
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "apps", "campus-web", "package.json"), {
			build: "tsx scripts/build-published-reader-docs.ts",
			test: "vitest run",
		});
		const scriptsRoot = join(root, "apps", "campus-web", "scripts");
		mkdirp(scriptsRoot);
		writeFileSync(join(scriptsRoot, "build-published-reader-docs.ts"), "", "utf8");
		writeFileSync(join(scriptsRoot, "published-reader-manifest.ts"), "", "utf8");
		expectIssueIncluded(auditPackageScriptPolicy(root), {
			path: "apps/campus-web/scripts/published-reader-manifest.ts",
			script: "published-reader-manifest.ts",
			message:
				"campus-web scripts/ may only keep executable app-local entrypoints; docs reader build implementation belongs under src/docs-reader-build",
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "packages", "domains", "dining", "package.json"), {
			"debug:audit": "tsx src/debug-audit.ts",
			test: "vitest run",
			typecheck: "tsc --noEmit",
		});
		expectIssueIncluded(auditPackageScriptPolicy(root), {
			path: "packages/domains/dining/package.json",
			script: "debug:audit",
			message: "one-off audit helpers must not be exposed as package scripts",
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "apps", "source-collector", "package.json"), {
			crawl: "node src/crawl.ts",
			plan: "node src/plan.ts",
			"validate-source-pack": "node src/validate-source-pack.ts",
			validate: "node src/validate.ts",
			"qc-report": "node src/qc-report.ts",
			test: "vitest run",
			typecheck: "tsc --noEmit",
		});
		expectIssueIncluded(auditPackageScriptPolicy(root), {
			path: "apps/source-collector/package.json",
			script: "crawl",
			message:
				"source-collector package scripts may only expose test/typecheck verification lanes; runtime entrypoints must be invoked directly or through ingestion-control jobs",
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "apps", "source-collector", "package.json"), {
			test: "vitest run",
			typecheck: "tsc --noEmit",
		});
		expectNoIssues(auditPackageScriptPolicy(root), "source collector verification scripts");
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "jobs", "dining-sync", "package.json"), {
			sync: "tsx src/cli.ts sync-all",
			"sync:smoke": "tsx src/cli.ts",
			test: "vitest run",
			typecheck: "tsc --noEmit",
		});
		expectIssueIncluded(auditPackageScriptPolicy(root), {
			path: "jobs/dining-sync/package.json",
			script: "sync",
			message:
				"job package scripts may only expose build/test/typecheck; job operations must use the job CLI or platform scheduler",
		});
		expectIssueIncluded(auditPackageScriptPolicy(root), {
			path: "jobs/dining-sync/package.json",
			script: "sync:smoke",
			message: "smoke helpers must be invoked through scripts/ public CLI entrypoints",
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "jobs", "learning-loop-candidates", "package.json"), {
			"select-candidates": "tsx src/cli.ts select-candidates",
			"publish-candidates": "tsx src/cli.ts publish-candidates",
			"verify-published-candidates": "tsx src/cli.ts verify-published-candidates",
			test: "vitest run",
			typecheck: "tsc --noEmit",
		});
		const issues = auditPackageScriptPolicy(root);
		expectIssueIncluded(issues, {
			path: "jobs/learning-loop-candidates/package.json",
			script: "select-candidates",
			message:
				"job package scripts may only expose build/test/typecheck; job operations must use the job CLI or platform scheduler",
		});
		expectIssueIncluded(issues, {
			path: "jobs/learning-loop-candidates/package.json",
			script: "publish-candidates",
			message:
				"job package scripts may only expose build/test/typecheck; job operations must use the job CLI or platform scheduler",
		});
		expectIssueIncluded(issues, {
			path: "jobs/learning-loop-candidates/package.json",
			script: "verify-published-candidates",
			message:
				"job package scripts may only expose build/test/typecheck; job operations must use the job CLI or platform scheduler",
		});
	});

	withFixture((root) => {
		writePackage(join(root, "package.json"), { "repo:guard": "true" });
		writePackage(join(root, "packages", "eval-langfuse", "package.json"), {
			langfuse: "tsx ./src/cli.ts",
			test: "vitest run",
			typecheck: "tsc --noEmit",
		});
		expectIssueIncluded(auditPackageScriptPolicy(root), {
			path: "packages/eval-langfuse/package.json",
			script: "langfuse",
			message:
				"package scripts may only expose conventional verification/build lanes; operational CLIs must be invoked directly",
		});
	});

	console.log("check_package_script_policy self-test passed.");
	return 0;
}

function mkdirp(path: string): void {
	mkdirSync(path, { recursive: true });
}

function main(argv: string[]): number {
	if (argv.length === 1 && argv[0] === "--self-test") {
		return runSelfTest();
	}
	if (argv.length > 0) {
		throw new Error(`unsupported argument: ${argv[0]}`);
	}
	const issues = auditPackageScriptPolicy();
	if (issues.length > 0) {
		console.error("Package script policy check failed:");
		for (const issue of issues) {
			console.error(`- ${issue.path}: ${issue.script}: ${issue.message}`);
		}
		return 1;
	}
	console.log("Validated package script policy.");
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
