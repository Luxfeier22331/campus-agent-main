import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	auditLintCoverage,
	lintExclusionReason,
	lintFamiliesForPath,
	trackedLintCandidatePaths,
} from "./lint-coverage.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

function main(): number {
	if (process.argv.includes("--self-test")) {
		return runSelfTest();
	}
	const failures = auditLintCoverage(repoRoot);
	if (failures.length > 0) {
		console.error("Tracked lint coverage check failed:");
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		return 1;
	}
	console.log(
		`Validated tracked lint coverage for ${trackedLintCandidatePaths(repoRoot).length} candidate files.`,
	);
	return 0;
}

function runSelfTest(): number {
	const candidates = new Set(trackedLintCandidatePaths(repoRoot));
	for (const path of [
		"package.json",
		"apps/campus-web/index.html",
		"apps/app-api/README.md",
		"apps/source-collector/README.md",
		"jobs/dining-sync/src/config.ts",
		"apps/execution-control/internal/execution/request.go",
	]) {
		expect(candidates.has(path), `candidate inventory should include ${path}`);
	}
	expectEqualJson(lintFamiliesForPath("package.json"), ["web:lint"], "package lint families");
	expectEqualJson(
		lintFamiliesForPath("apps/campus-web/index.html"),
		["repo:static"],
		"html lint families",
	);
	expectEqualJson(
		lintFamiliesForPath("apps/app-api/scripts/run-with-local-env.ts"),
		["web:lint"],
		"mjs lint families",
	);
	expectEqualJson(
		lintFamiliesForPath("jobs/dining-sync/src/config.ts"),
		["web:lint"],
		"job TS lint families",
	);
	expectEqualJson(
		lintFamiliesForPath("apps/app-api/README.md"),
		["repo:static"],
		"app README lint families",
	);
	expectEqualJson(
		lintFamiliesForPath("SECURITY.md"),
		["repo:static"],
		"root markdown lint families",
	);
	expectEqualJson(
		lintFamiliesForPath("tools/repo-static/checks/check_public_source_tokens.ts"),
		["web:lint", "repo:static"],
		"repo static script lint families",
	);
	expectEqualJson(
		lintFamiliesForPath("apps/execution-control/internal/execution/request.go"),
		["ci:go"],
		"go lint families",
	);
	expectEqualJson(
		lintFamiliesForPath(".github/workflows/pr.yml"),
		["repo:static"],
		"workflow lint families",
	);
	expect(lintExclusionReason(".planning/PROJECT.md") === "planning_artifact", "planning exclusion");
	expect(
		lintExclusionReason("apps/app-api/README.md") === undefined,
		"README should not be excluded",
	);
	expect(
		lintExclusionReason("apps/app-api/drizzle/0000_current_baseline.sql") ===
			"generated_drizzle_migration",
		"drizzle SQL exclusion",
	);
	expectEqualJson(auditLintCoverage(repoRoot), [], "current repo lint coverage");
	return 0;
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

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = main();
}
