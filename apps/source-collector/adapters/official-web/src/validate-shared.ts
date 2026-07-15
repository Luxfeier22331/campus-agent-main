import { readFileSync } from "node:fs";

import {
	OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
	OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS,
	OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT,
} from "./core/index.ts";

export type PageArtifactRelativePath =
	| "capture/response.html"
	| "provider/cheerio-basic/page-extraction.json"
	| "provider/cheerio-basic/discovered-links.jsonl"
	| "source-truth/page-manifest.json"
	| "source-truth/content-blocks.jsonl";

export interface CollectorValidationIssue {
	severity: "error" | "warning";
	category: "correctness" | "quality";
	code:
		| "missing_run_artifact"
		| "bundle_parse_failed"
		| "missing_page_file"
		| "page_manifest_parse_failed"
		| "provider_parse_failed"
		| "content_blocks_parse_failed"
		| "quality_audit_parse_failed"
		| "quality_audit_page_count_mismatch"
		| "quality_audit_missing_page"
		| "page_family_mismatch"
		| "bundle_object_key_mismatch"
		| "bundle_artifact_identity_mismatch"
		| "manifest_identity_mismatch"
		| "response_body_hash_mismatch"
		| "block_count_mismatch"
		| "content_block_identity_mismatch"
		| "target_lineage_snake_case"
		| "target_lineage_missing"
		| "target_lineage_mismatch"
		| "quality_gate_review"
		| "quality_gate_fail";
	message: string;
}

export interface CollectorValidationReport {
	valid: boolean;
	outputDir: string;
	issues: CollectorValidationIssue[];
	counts: {
		bundlePages: number;
		errors: number;
		warnings: number;
	};
}

export const REQUIRED_LOCAL_RUN_ARTIFACTS = [
	...OFFICIAL_WEB_REQUIRED_RUN_ARTIFACTS,
	OFFICIAL_WEB_SOURCE_TRUTH_BUNDLE_ARTIFACT,
	OFFICIAL_WEB_QUALITY_AUDIT_ARTIFACT,
] as const;

export function parseJsonLines(path: string): object[] {
	const raw = readFileSync(path, "utf-8").trim();
	if (raw.length === 0) {
		return [];
	}

	return raw.split("\n").map((line: string) => JSON.parse(line) as object);
}

export function finalizeReport(
	outputDir: string,
	issues: CollectorValidationIssue[],
	bundlePages: number,
): CollectorValidationReport {
	return {
		valid: !issues.some((issue) => issue.severity === "error"),
		outputDir,
		issues,
		counts: {
			bundlePages,
			errors: issues.filter((issue) => issue.severity === "error").length,
			warnings: issues.filter((issue) => issue.severity === "warning").length,
		},
	};
}

export function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

export function printValidationReport(report: CollectorValidationReport): void {
	console.log(`official-web collector validation: ${report.valid ? "PASS" : "FAIL"}`);
	console.log(`outputDir: ${report.outputDir}`);
	console.log(`bundlePages: ${report.counts.bundlePages}`);
	console.log(`errors: ${report.counts.errors}`);
	console.log(`warnings: ${report.counts.warnings}`);
	for (const issue of report.issues) {
		console.log(`[${issue.severity}/${issue.category}/${issue.code}] ${issue.message}`);
	}
}
