// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildRequestSmokeSeedScenarios,
	parseRequestSmokeSeedArgs,
} from "../scripts/seed-request-smoke";

describe("request smoke seed helper", () => {
	it("parses optional smoke identity overrides", () => {
		expect(parseRequestSmokeSeedArgs([])).toEqual({
			email: "help_bot@outlook.com",
			name: "Campus Agent Smoke",
		});
		expect(
			parseRequestSmokeSeedArgs(["--", "--email", "seed-user@example.edu", "--name", "Seed User"]),
		).toEqual({
			email: "seed-user@example.edu",
			name: "Seed User",
		});
	});

	it("builds a mixed request sample pack for completed, clarification, and no-answer states", () => {
		const scenarios = buildRequestSmokeSeedScenarios();

		expect(scenarios.map((scenario) => scenario.status)).toEqual([
			"completed",
			"completed",
			"completed",
			"needs_clarification",
			"no_answer",
		]);
		expect(scenarios.filter((scenario) => scenario.conversationKey === "curriculum")).toHaveLength(
			2,
		);
		expect(
			scenarios.find((scenario) => scenario.key === "clarification-major-options"),
		).toMatchObject({
			requestedScope: {
				collection: "curriculum_plan",
				corpus: "curriculum",
			},
			status: "needs_clarification",
		});
		expect(scenarios.find((scenario) => scenario.key === "no-answer-mars-campus")).toMatchObject({
			status: "no_answer",
		});
	});
});
