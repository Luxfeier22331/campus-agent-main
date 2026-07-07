import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { normalizeCliArgs } from "./cli.ts";
import {
	OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
	OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT,
	type OfficialWebSourceTruthBundle,
} from "./core/index.ts";
import { validateBundlePage } from "./validate-page-artifacts.ts";
import { validateQualityAudit } from "./validate-quality-audit.ts";
import type { CollectorValidationIssue, CollectorValidationReport } from "./validate-shared.ts";
import {
	finalizeReport,
	formatError,
	printValidationReport,
	REQUIRED_LOCAL_RUN_ARTIFACTS,
} from "./validate-shared.ts";

export type {
	CollectorValidationIssue,
	CollectorValidationReport,
} from "./validate-shared.ts";

export async function validateCollectorOutput(
	outputDir: string,
): Promise<CollectorValidationReport> {
	const issues: CollectorValidationIssue[] = [];

	for (const artifactName of REQUIRED_LOCAL_RUN_ARTIFACTS) {
		const artifactPath = resolve(outputDir, artifactName);
		if (!existsSync(artifactPath)) {
			issues.push({
				severity: "error",
				category: "correctness",
				code: "missing_run_artifact",
				message: `missing run artifact: ${artifactName}`,
			});
		}
	}

	const bundlePath = resolve(outputDir, OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT);
	if (!existsSync(bundlePath)) {
		return finalizeReport(outputDir, issues, 0);
	}

	let bundle: OfficialWebSourceTruthBundle;
	try {
		bundle = JSON.parse(readFileSync(bundlePath, "utf-8")) as OfficialWebSourceTruthBundle;
	} catch (error) {
		issues.push({
			severity: "error",
			category: "correctness",
			code: "bundle_parse_failed",
			message: `failed to parse source-truth bundle: ${formatError(error)}`,
		});
		return finalizeReport(outputDir, issues, 0);
	}

	const requireTargetLineage = bundle.collectionMode === "target-workset";
	for (const page of bundle.pages) {
		validateBundlePage(outputDir, page, issues, { requireTargetLineage });
	}

	const auditPath = resolve(outputDir, OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT);
	if (existsSync(auditPath)) {
		validateQualityAudit(auditPath, bundle, issues);
	}

	return finalizeReport(outputDir, issues, bundle.pages.length);
}

export async function validateMain(argv: string[] = process.argv.slice(2)): Promise<void> {
	const { values } = parseArgs({
		args: normalizeCliArgs(argv),
		options: {
			"output-dir": { type: "string" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: false,
	});

	const outputDir = values["output-dir"];
	if (typeof outputDir !== "string" || outputDir.length === 0) {
		throw new Error("--output-dir is required");
	}

	const report = await validateCollectorOutput(outputDir);
	if (values.json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		printValidationReport(report);
	}

	if (!report.valid) {
		process.exitCode = 1;
	}
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
	void validateMain();
}
