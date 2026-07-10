import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	appApiEvalIngressContractPath,
	ciInternalSurfaceDetectorPath,
	evalMapPath,
	langfuseCliPath,
	langfuseRuntimeContractPath,
	otelTaxonomyPath,
	requiredRagasScoreNames,
	scoreRegistryPath,
	traceEvidencePath,
} from "./constants.ts";
import { auditLangfuseEvalConfiguration } from "./core.ts";

export function runLangfuseEvalAuditSelfTest(): number {
	withFixture((root) => {
		writeMinimalLangfuseEvalRepo({ root });
		const report = auditLangfuseEvalConfiguration(root);
		expectEqual(report.passed, true, "minimal langfuse eval repo should pass");
	});
	selfTestRetiredCiContractPath();
	selfTestDuplicateSelectedTool();
	selfTestRetiredExperimentAutomation();
	selfTestRetiredTokenDefinitionsAreAllowedInAuditPolicy();
	selfTestForbiddenEvalIngressLanguage();
	console.log("langfuse_eval_audit self-test passed.");
	return 0;
}

function selfTestRetiredCiContractPath(): void {
	withFixture((root) => {
		writeMinimalLangfuseEvalRepo({
			root,
			ciSurfaceContractPath: "docs/contracts/langfuse-runtime-observability-contract.md",
		});
		const report = auditLangfuseEvalConfiguration(root);
		expectEqual(report.passed, false, "retired CI surface contract path should fail");
		expect(
			JSON.stringify(report).includes('"check_id":"langfuse_ci_surface_contract_path"'),
			"retired CI surface contract path was not reported",
		);
	});
}

function selfTestDuplicateSelectedTool(): void {
	withFixture((root) => {
		writeMinimalLangfuseEvalRepo({ root, duplicateSelectedTool: true });
		const report = auditLangfuseEvalConfiguration(root);
		expectEqual(report.passed, false, "duplicate selected_tool should fail");
		expect(
			JSON.stringify(report).includes('"duplicates":["selected_tool"]'),
			"duplicate selected_tool was not reported",
		);
	});
}

function selfTestRetiredExperimentAutomation(): void {
	withFixture((root) => {
		writeMinimalLangfuseEvalRepo({ root });
		writeText(
			join(root, "packages/eval-langfuse/src/platform.ts"),
			`
function runLangfuseExperiment() { return "langfuse_experiment_manifest.v1"; }
function syncLangfuseAnnotationQueue() { return "langfuse_review_manifest.v1"; }
function exportLangfuseReviewResults() {}
`,
		);
		const report = auditLangfuseEvalConfiguration(root);
		expectEqual(report.passed, false, "retired experiment automation should fail");
		expect(
			JSON.stringify(report).includes("runLangfuseExperiment"),
			"retired experiment automation was not reported",
		);
	});
}

function selfTestRetiredTokenDefinitionsAreAllowedInAuditPolicy(): void {
	withFixture((root) => {
		writeMinimalLangfuseEvalRepo({ root });
		writeText(
			join(root, "packages/eval-langfuse/src/audit/langfuse-eval-audit/constants.ts"),
			`
const retiredActiveSourceTokens = ["runLangfuseExperiment", "langfuse_experiment_manifest"];
`,
		);
		writeText(
			join(root, "packages/eval-langfuse/src/audit/langfuse-eval-audit/self-test.ts"),
			`
const fixture = "runLangfuseExperiment";
`,
		);
		const report = auditLangfuseEvalConfiguration(root);
		expectEqual(report.passed, true, "audit policy token definitions should be excluded");
	});
}

function selfTestForbiddenEvalIngressLanguage(): void {
	withFixture((root) => {
		writeMinimalLangfuseEvalRepo({ root });
		writeText(
			join(root, appApiEvalIngressContractPath),
			`
internal eval materialization ingress seam
materialization request
Langfuse/Ragas materialized dataset run
safe trace observation
deterministic gate
`,
		);
		const report = auditLangfuseEvalConfiguration(root);
		expectEqual(report.passed, false, "forbidden app-api eval ingress language should fail");
		expect(
			JSON.stringify(report).includes("deterministic gate"),
			"forbidden eval ingress language was not reported",
		);
	});
}

function writeMinimalLangfuseEvalRepo({
	ciSurfaceContractPath = langfuseRuntimeContractPath,
	duplicateSelectedTool = false,
	root,
}: {
	ciSurfaceContractPath?: string;
	duplicateSelectedTool?: boolean;
	root: string;
}): void {
	writeText(
		join(root, ciInternalSurfaceDetectorPath),
		`function isLangfusePath(path: string) { return path === ${JSON.stringify(ciSurfaceContractPath)}; }\n`,
	);
	writeJson(join(root, scoreRegistryPath), {
		schema_version: "langfuse_score_registry.v1",
		scores: requiredRagasScoreNames.map((name) => ({ name, owner: "packages/ragas-runner" })),
	});
	writeText(
		join(root, langfuseCliPath),
		`const commands = ["ragas-score-traces", "ragas-score-dataset", "build-rag-dataset-manifest", "sync-datasets"];\nexport { commands };\n`,
	);
	const selectedToolLines = duplicateSelectedTool
		? ['"selected_tool",', '"selected_tool",']
		: ['"selected_tool",'];
	writeText(
		join(root, traceEvidencePath),
		`const REQUIRED_OBSERVATION_ATTRIBUTES = [\n${selectedToolLines.join("\n")}\n];\n`,
	);
	writeText(
		join(root, "packages/eval-langfuse/src/ragas-langfuse.ts"),
		`
const error = "materialized for Ragas scoring";
function ragasEvalFieldsFromTrace() {}
const fields = ["retrieved_contexts", "reference_context_ids"];
export { error, fields, ragasEvalFieldsFromTrace };
`,
	);
	const taxonomyLines = duplicateSelectedTool
		? ["- `selected_tool`", "- `selected_tool`"]
		: ["- `selected_tool`"];
	writeText(
		join(root, otelTaxonomyPath),
		`### Runtime / Request Attributes\n\n${taxonomyLines.join("\n")}\n\n## Next\n`,
	);
	writeText(
		join(root, evalMapPath),
		`
## Active Eval Lanes

\`ragas-trace\`

\`ragas-dataset\`

## Retired Surfaces
`,
	);
	writeText(
		join(root, appApiEvalIngressContractPath),
		`
internal eval materialization ingress seam
materialization request
Langfuse/Ragas materialized dataset run
safe trace observation
`,
	);
}

function withFixture(callback: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "langfuse-eval-audit-"));
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeText(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text.trimStart(), "utf8");
}

function writeJson(path: string, payload: unknown): void {
	writeText(path, JSON.stringify(payload));
}

function expect(condition: boolean, message: string): void {
	if (!condition) {
		throw new Error(message);
	}
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
	if (actual !== expected) {
		throw new Error(
			`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
	}
}
