import { describe, expect, it } from "vitest";

describe("cost domain helpers", () => {
	it("projects cost timeseries buckets into chart-friendly series points", async () => {
		const { buildCostTrendSeries } = await import("../src/panel/pages/cost-domain");

		expect(
			buildCostTrendSeries([
				{
					bucketEnd: "2026-04-20T09:00:00.000Z",
					bucketStart: "2026-04-20T08:00:00.000Z",
					cachedInputTokens: 40,
					estimatedCostMicrousd: 4200,
					inputTokens: 320,
					outputTokens: 140,
				},
			]),
		).toEqual([
			{
				bucketEnd: "2026-04-20T09:00:00.000Z",
				bucketStart: "2026-04-20T08:00:00.000Z",
				cachedInputTokens: 40,
				estimatedCostUsd: 0.0042,
				inputTokens: 320,
				outputTokens: 140,
				totalTokens: 500,
			},
		]);
	});

	it("projects by-model summary into comparable distribution entries", async () => {
		const { buildCostModelDistributionEntries } = await import("../src/panel/pages/cost-domain");

		expect(
			buildCostModelDistributionEntries([
				{
					estimatedCostMicrousd: 4200,
					modelName: "gpt-5.2-mini",
					requestCount: 2,
				},
				{
					estimatedCostMicrousd: 800,
					modelName: "gpt-5.2",
					requestCount: 1,
				},
			]),
		).toEqual([
			{
				estimatedCostUsd: 0.0042,
				key: "gpt-5.2-mini",
				label: "gpt-5.2-mini",
				requestCount: 2,
				sharePct: 84,
			},
			{
				estimatedCostUsd: 0.0008,
				key: "gpt-5.2",
				label: "gpt-5.2",
				requestCount: 1,
				sharePct: 16,
			},
		]);
	});

	it("projects by-surface summary into chinese-labelled distribution entries", async () => {
		const { buildCostSurfaceDistributionEntries } = await import("../src/panel/pages/cost-domain");

		expect(
			buildCostSurfaceDistributionEntries([
				{
					estimatedCostMicrousd: 4200,
					requestCount: 2,
					surface: "public_chat_web",
				},
				{
					estimatedCostMicrousd: 800,
					requestCount: 1,
					surface: "protected_panel_web",
				},
			]),
		).toEqual([
			{
				estimatedCostUsd: 0.0042,
				key: "public_chat_web",
				label: "公开聊天网页",
				requestCount: 2,
				sharePct: 84,
			},
			{
				estimatedCostUsd: 0.0008,
				key: "protected_panel_web",
				label: "受保护运维面板",
				requestCount: 1,
				sharePct: 16,
			},
		]);
	});
});
