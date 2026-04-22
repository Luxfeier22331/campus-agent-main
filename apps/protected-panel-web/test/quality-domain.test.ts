import { describe, expect, it } from "vitest";

import {
	buildQualityRuntimeTrendSeries,
	buildRefusalDistributionEntries,
	formatQualityBadcaseStatus,
} from "../src/panel/pages/quality-domain";

describe("quality domain helpers", () => {
	it("projects quality runtime buckets into chart-friendly series points", () => {
		expect(
			buildQualityRuntimeTrendSeries([
				{
					bucketEnd: "2026-04-20T09:00:00.000Z",
					bucketStart: "2026-04-20T08:00:00.000Z",
					citationMissRate: 0.2,
					emptyRecallRate: 0.1,
					needsClarificationRate: 0.05,
					noAnswerRate: 0.15,
					requestCount: 42,
					sampledGroundingPassRate: 0.85,
				},
			]),
		).toEqual([
			{
				bucketEnd: "2026-04-20T09:00:00.000Z",
				bucketStart: "2026-04-20T08:00:00.000Z",
				citationMissRatePct: 20,
				emptyRecallRatePct: 10,
				needsClarificationRatePct: 5,
				noAnswerRatePct: 15,
				requestCount: 42,
				sampledGroundingPassRatePct: 85,
			},
		]);
	});

	it("builds chinese refusal-distribution entries for quality summary cards", () => {
		expect(
			buildRefusalDistributionEntries({
				approvalRequired: 3,
				needsClarification: 5,
				noAnswer: 2,
				rejected: 1,
			}),
		).toEqual([
			{ count: 5, key: "needsClarification", label: "需澄清" },
			{ count: 2, key: "noAnswer", label: "无法回答" },
			{ count: 3, key: "approvalRequired", label: "待审批" },
			{ count: 1, key: "rejected", label: "已拒绝" },
		]);
	});

	it("formats badcase status with explicit chinese labels", () => {
		expect(formatQualityBadcaseStatus("open")).toBe("待处理");
		expect(formatQualityBadcaseStatus("closed")).toBe("已关闭");
	});
});
