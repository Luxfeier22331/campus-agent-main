import { readFileSync } from "node:fs";

import type {
	OfficialWebQualityAuditDocument,
	OfficialWebSourceTruthBundle,
} from "./official-web-core.ts";
import type { CollectorValidationIssue } from "./validate-shared.ts";
import { formatError } from "./validate-shared.ts";

export function validateQualityAudit(
	auditPath: string,
	bundle: OfficialWebSourceTruthBundle,
	issues: CollectorValidationIssue[],
): void {
	let audit: OfficialWebQualityAuditDocument;
	try {
		audit = JSON.parse(readFileSync(auditPath, "utf-8")) as OfficialWebQualityAuditDocument;
	} catch (error) {
		issues.push({
			severity: "error",
			category: "correctness",
			code: "quality_audit_parse_failed",
			message: `failed to parse quality audit: ${formatError(error)}`,
		});
		return;
	}

	if (
		audit.summary.totalPages !== bundle.pages.length ||
		audit.pages.length !== bundle.pages.length
	) {
		issues.push({
			severity: "error",
			category: "correctness",
			code: "quality_audit_page_count_mismatch",
			message: "quality audit page count does not match source-truth bundle",
		});
	}

	const bundlePagesById = new Map<string, OfficialWebSourceTruthBundle["pages"][number]>(
		bundle.pages.map((page) => [`${page.rawAssetId}/${page.rawVersionId}`, page]),
	);

	for (const auditPage of audit.pages) {
		const key = `${auditPage.rawAssetId}/${auditPage.rawVersionId}`;
		const bundlePage = bundlePagesById.get(key);
		if (!bundlePage) {
			issues.push({
				severity: "error",
				category: "correctness",
				code: "quality_audit_missing_page",
				message: `quality audit references unknown page: ${key}`,
			});
			continue;
		}

		if (bundlePage.pageFamily !== auditPage.pageFamily) {
			issues.push({
				severity: "error",
				category: "correctness",
				code: "page_family_mismatch",
				message: `quality audit page family mismatch for ${key}`,
			});
		}

		for (const auditIssue of auditPage.issues) {
			issues.push({
				severity: auditIssue.severity === "fail" ? "error" : "warning",
				category: "quality",
				code: auditIssue.severity === "fail" ? "quality_gate_fail" : "quality_gate_review",
				message: `${key}: ${auditIssue.code}: ${auditIssue.message}`,
			});
		}
	}
}
