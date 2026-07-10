import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedHandwrittenCodePaths } from "./lint-coverage.ts";

export const defaultThreshold = 800;
const baselinePath = "configs/lint/decomposition-baseline.json";

export interface DecompositionBaseline {
	threshold: number;
	admitted: Record<string, number>;
}

export interface DecompositionFinding {
	path: string;
	reason: string;
	lines: number | null;
	maxLines: number;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(scriptDir, "../../..");

export function trackedDecompositionPaths(root = repoRoot): string[] {
	return trackedHandwrittenCodePaths(root);
}

export function loadDecompositionBaseline(
	root = repoRoot,
	path = join(root, baselinePath),
): DecompositionBaseline {
	const payload = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	const threshold = payload.threshold;
	if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold <= 0) {
		throw new Error("decomposition baseline threshold must be a positive integer");
	}
	const admittedPayload = payload.admitted;
	if (!isObject(admittedPayload)) {
		throw new Error("decomposition baseline admitted entries must be an object");
	}
	const admitted: Record<string, number> = {};
	for (const [relativePath, entry] of Object.entries(admittedPayload)) {
		if (relativePath === "") {
			throw new Error("decomposition baseline entry paths must be non-empty strings");
		}
		if (!isObject(entry)) {
			throw new Error(`decomposition baseline entry for ${relativePath} must be an object`);
		}
		const maxLines = entry.max_lines;
		if (typeof maxLines !== "number" || !Number.isInteger(maxLines) || maxLines <= threshold) {
			throw new Error(
				`decomposition baseline entry for ${relativePath} must set max_lines > threshold`,
			);
		}
		admitted[relativePath] = maxLines;
	}
	return { threshold, admitted };
}

export function auditDecomposition(
	root = repoRoot,
	customBaselinePath?: string,
): DecompositionFinding[] {
	const baseline = loadDecompositionBaseline(root, customBaselinePath);
	const trackedPaths = trackedDecompositionPaths(root);
	return auditDecompositionWithTrackedPaths(root, baseline, trackedPaths);
}

export function auditDecompositionWithTrackedPaths(
	root: string,
	baseline: DecompositionBaseline,
	trackedPaths: string[],
): DecompositionFinding[] {
	const trackedSet = new Set(trackedPaths);
	const findings: DecompositionFinding[] = [];
	for (const [relativePath, maxLines] of Object.entries(baseline.admitted)) {
		const path = join(root, relativePath);
		if (!existsSync(path)) {
			findings.push({ path: relativePath, reason: "baseline_missing", lines: null, maxLines });
			continue;
		}
		const lineCount = countFileLines(path);
		if (!trackedSet.has(relativePath)) {
			findings.push({
				path: relativePath,
				reason: "baseline_untracked",
				lines: lineCount,
				maxLines,
			});
			continue;
		}
		if (lineCount <= baseline.threshold) {
			findings.push({
				path: relativePath,
				reason: "baseline_resolved",
				lines: lineCount,
				maxLines,
			});
		} else if (lineCount > maxLines) {
			findings.push({ path: relativePath, reason: "baseline_grew", lines: lineCount, maxLines });
		}
	}
	for (const relativePath of trackedPaths) {
		if (relativePath in baseline.admitted) {
			continue;
		}
		const lineCount = countFileLines(join(root, relativePath));
		if (lineCount > baseline.threshold) {
			findings.push({
				path: relativePath,
				reason: "new_over_threshold",
				lines: lineCount,
				maxLines: baseline.threshold,
			});
		}
	}
	return findings.sort((left, right) =>
		`${left.path}\0${left.reason}`.localeCompare(`${right.path}\0${right.reason}`),
	);
}

function formatFinding(finding: DecompositionFinding): string {
	if (finding.reason === "new_over_threshold") {
		return `${finding.path}: tracked handwritten file exceeds threshold (${finding.lines} > ${finding.maxLines}) without baseline admission`;
	}
	if (finding.reason === "baseline_grew") {
		return `${finding.path}: admitted baseline file grew beyond frozen budget (${finding.lines} > ${finding.maxLines})`;
	}
	if (finding.reason === "baseline_resolved") {
		return `${finding.path}: admitted baseline file is now within threshold (${finding.lines} <= ${defaultThreshold}) and must leave the baseline`;
	}
	if (finding.reason === "baseline_missing") {
		return `${finding.path}: admitted baseline entry points to a missing file`;
	}
	if (finding.reason === "baseline_untracked") {
		return `${finding.path}: admitted baseline entry is not part of the tracked handwritten code inventory anymore`;
	}
	return `${finding.path}: unknown decomposition finding ${finding.reason}`;
}

function main(): number {
	if (process.argv.includes("--self-test")) {
		return runSelfTest();
	}
	let findings: DecompositionFinding[];
	let baseline: DecompositionBaseline;
	try {
		baseline = loadDecompositionBaseline();
		findings = auditDecomposition();
	} catch (error) {
		console.error(
			`Tracked decomposition audit failed to load baseline: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	}
	if (findings.length > 0) {
		console.error("Tracked decomposition audit failed:");
		for (const finding of findings) {
			console.error(`- ${formatFinding(finding)}`);
		}
		return 1;
	}
	console.log(
		`Validated tracked decomposition budget for ${trackedDecompositionPaths().length} handwritten code/test files against ${baselinePath} at threshold ${baseline.threshold}.`,
	);
	return 0;
}

function runSelfTest(): number {
	const candidates = new Set(trackedDecompositionPaths(repoRoot));
	for (const path of [
		"tools/repo-static/checks/check_tracked_text_formats.ts",
		"tools/repo-static/check_ci_workflows.ts",
		"tools/repo-static/ci-workflow-contracts/core.ts",
		"apps/app-api/src/app/request-scope.ts",
		"apps/execution-control/internal/execution/request.go",
	]) {
		expect(candidates.has(path), `decomposition inventory should include ${path}`);
	}
	expect(
		!candidates.has("docs/architecture/current.md"),
		"markdown docs must not be decomposition candidates",
	);
	expect(!candidates.has("package.json"), "package.json must not be decomposition candidate");
	withFixture((root) => {
		const baseline = { threshold: defaultThreshold, admitted: { "src/oversized.py": 812 } };
		writeText(
			join(root, baselinePath),
			JSON.stringify({
				threshold: defaultThreshold,
				admitted: { "src/oversized.py": { max_lines: 812 } },
			}),
		);
		expectEqualJson(loadDecompositionBaseline(root), baseline, "baseline load");
	});
	withFixture((root) => {
		writeText(join(root, "src/new_file.py"), `${"line\n".repeat(defaultThreshold + 5)}`);
		const baseline = { threshold: defaultThreshold, admitted: {} };
		expectEqualJson(
			auditDecompositionWithTrackedPaths(root, baseline, ["src/new_file.py"]),
			[
				{
					path: "src/new_file.py",
					reason: "new_over_threshold",
					lines: defaultThreshold + 5,
					maxLines: defaultThreshold,
				},
			],
			"new over-threshold finding",
		);
	});
	expectEqualJson(auditDecomposition(repoRoot), [], "current repo decomposition");
	return 0;
}

function countFileLines(path: string): number {
	const text = readFileSync(path, "utf8");
	if (text === "") {
		return 0;
	}
	return text.endsWith("\n") ? text.split(/\r?\n/).length - 1 : text.split(/\r?\n/).length;
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "decomposition-"));
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

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = main();
}
