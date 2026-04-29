import type { CollectorQcReport } from "./qc-report-types.ts";

export function printQcReport(report: CollectorQcReport): void {
	console.log(`official-web collector qc gate: ${report.valid ? "PASS" : "FAIL"}`);
	console.log(`outputs: ${report.totals.outputs}`);
	console.log(`bundlePages: ${report.totals.bundlePages}`);
	console.log(`validationErrors: ${report.totals.validationErrors}`);
	console.log(`validationWarnings: ${report.totals.validationWarnings}`);
	console.log(`passPages: ${report.totals.passPages}`);
	console.log(`reviewPages: ${report.totals.reviewPages}`);
	console.log(`failPages: ${report.totals.failPages}`);
	console.log(`unexpectedReviewPages: ${report.totals.unexpectedReviewPages}`);

	if (report.thresholds.allowedReviewIssueCodes.length > 0) {
		console.log(`allowedReviewIssueCodes: ${report.thresholds.allowedReviewIssueCodes.join(", ")}`);
	}
	if (report.thresholds.allowedReviewPageFamilies.length > 0) {
		console.log(
			`allowedReviewPageFamilies: ${report.thresholds.allowedReviewPageFamilies.join(", ")}`,
		);
	}

	for (const page of report.failPages) {
		console.log(
			`[fail-page] ${page.outputDir} ${page.pageFamily} ${page.normalizedCanonicalUrl} ${page.issueCodes.join(",")}`,
		);
	}

	for (const page of report.unexpectedReviewPages) {
		console.log(
			`[unexpected-review] ${page.outputDir} ${page.pageFamily} ${page.normalizedCanonicalUrl} ${page.issueCodes.join(",")}`,
		);
	}
}
