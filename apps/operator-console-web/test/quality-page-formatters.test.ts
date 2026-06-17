import { describe, expect, it } from "vitest";

import { buildRuntimeSummaryCards } from "../src/panel/pages/quality-page/formatters";

describe("quality page formatters", () => {
	it("renders feedback aggregates as runtime summary cards", () => {
		const cards = buildRuntimeSummaryCards({
			asOf: "2026-04-20T09:00:00.000Z",
			runtime: {
				citationMissRate: { count: 1, eligibleCount: 4, value: 0.25 },
				emptyRecallRate: { count: 2, eligibleCount: 8, value: 0.25 },
				feedback: {
					coverageRate: { count: 6, eligibleCount: 12, value: 0.5 },
					distributions: {
						answerKind: [],
						capability: [],
						citationPosture: [],
						reasonCode: [],
						surface: [],
						vote: [],
					},
					feedbackCount: 6,
					helpfulRate: { count: 4, eligibleCount: 6, value: 0.6667 },
					noAnswerUnhelpfulRate: { count: 2, eligibleCount: 3, value: 0.6667 },
					unhelpfulRate: { count: 2, eligibleCount: 6, value: 0.3333 },
				},
				refusalDistribution: {
					approvalRequired: 0,
					needsClarification: 1,
					noAnswer: 3,
					rejected: 0,
				},
				requestCount: 12,
			},
			sampledGrades: null,
			window: {
				from: "2026-04-20T08:00:00.000Z",
				granularity: "1h",
				to: "2026-04-20T09:00:00.000Z",
			},
		});

		expect(cards).toEqual(
			expect.arrayContaining([
				{
					detail: "6 / 12",
					label: "反馈覆盖率",
					value: "50%",
				},
				{
					detail: "4 / 6",
					label: "有帮助率",
					value: "67%",
				},
				{
					detail: "2 / 3",
					label: "无法回答负反馈率",
					value: "67%",
				},
			]),
		);
	});
});
