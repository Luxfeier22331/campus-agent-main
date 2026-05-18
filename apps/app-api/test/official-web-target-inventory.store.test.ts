// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createPgOfficialWebTargetInventoryFieldStatusStore } from "../src/modules/official-web-target-inventory/store";

function createSummaryQueryDb(rows: Array<{ summary: { summaryJson: Record<string, unknown> } }>) {
	const limit = vi.fn().mockResolvedValue(rows);
	const orderBy = vi.fn(() => ({ limit }));
	const where = vi.fn(() => ({ orderBy }));
	const innerJoin = vi.fn(() => ({ where }));
	const from = vi.fn(() => ({ innerJoin }));
	const select = vi.fn(() => ({ from }));

	return {
		db: { select },
		limit,
	};
}

describe("official web target inventory field status store", () => {
	it("expands rollup review summaries and returns field status for the matching inventory entry", async () => {
		const { db, limit } = createSummaryQueryDb([
			{
				summary: {
					summaryJson: {
						candidateCount: 2,
						latestStatus: "release_gate_required",
						reviewSummaries: [
							{
								fieldStatus: {
									authoritative_source_url: "present",
									normalized_content_summary: "present",
									reference_title: "present",
									release_scope: "present",
									source_version_evidence: "present",
								},
								inventoryId: "muc-library-reference",
								normalizedCanonicalUrl: "https://www.muc.edu.cn/jgsz/jxfwjg/tsg.htm",
								schemaVersion: "official_web_target_field_review.v1",
							},
							{
								fieldStatus: {
									authoritative_source_url: "missing",
								},
								inventoryId: "muc-museum-reference",
								normalizedCanonicalUrl: "https://www.muc.edu.cn/jgsz/jxfwjg/mzbwg.htm",
								schemaVersion: "official_web_target_field_review.v1",
							},
						],
						schemaVersion: "official_web_target_field_review_rollup.v1",
					},
				},
			},
		]);
		const store = createPgOfficialWebTargetInventoryFieldStatusStore({} as never, {
			getDb: async () => db as never,
		});

		const result = await store.listFieldStatus({
			entries: [
				{
					admissionTargetId: "official-web-stable-reference",
					inventoryId: "muc-library-reference",
					sourceUrls: ["https://www.muc.edu.cn/jgsz/jxfwjg/tsg.htm"],
				} as never,
			],
			siteId: "muc_public",
		});

		expect(result).toEqual({
			"muc-library-reference": {
				authoritative_source_url: "present",
				normalized_content_summary: "present",
				reference_title: "present",
				release_scope: "present",
				source_version_evidence: "present",
			},
		});
		expect(limit).toHaveBeenCalledWith(10);
	});
});
