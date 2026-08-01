import { describe, expect, it } from "vitest";

import { isDocsDocumentPath, resolveDocsRedirect } from "../src/features/docs/docs-redirects";

describe("docs redirects", () => {
	const redirects = [
		{
			fromPath: "/docs/regulations/student_rules/retired-attendance",
			toPath: "/docs/regulations/student_rules/student-attendance",
		},
	];

	it("resolves all published forms of a retired document path", () => {
		for (const path of [
			"/docs/regulations/student_rules/retired-attendance",
			"/docs/regulations/student_rules/retired-attendance/",
			"/docs/regulations/student_rules/retired-attendance.html",
			"/docs/regulations/student_rules/retired-attendance/index.html",
		]) {
			expect(resolveDocsRedirect(path, redirects)).toBe(
				"/docs/regulations/student_rules/student-attendance",
			);
		}
	});

	it("distinguishes document URLs from retired directory URLs", () => {
		expect(isDocsDocumentPath("/docs/regulations")).toBe(false);
		expect(isDocsDocumentPath("/docs/curriculum/undergraduate")).toBe(false);
		expect(isDocsDocumentPath("/docs/regulations/student_rules/student-attendance")).toBe(true);
		expect(
			isDocsDocumentPath("/docs/regulations/student_rules/student-attendance/v/2025-history"),
		).toBe(true);
	});
});
