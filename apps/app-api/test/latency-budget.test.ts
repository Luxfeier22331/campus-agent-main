// @vitest-environment node

import { describe, expect, it } from "vitest";

import { STAGE_TIMING_FIELDS } from "../src/modules/integration/execution-finalization-contract";
import { evaluateStageTimingBudget, LATENCY_BUDGET_RULES } from "../src/modules/latency-budget";

describe("runtime latency budget", () => {
	it("classifies canonical stage timing fields against repo-owned thresholds", () => {
		const result = evaluateStageTimingBudget({
			"workflow.execute_step_ms": 13_000,
			"request.total_ms": 900,
		});

		expect(result.version).toBe("latency-budget-v1");
		expect(result.breaches).toEqual([
			{
				durationMs: 13_000,
				field: "workflow.execute_step_ms",
				severity: "critical",
				thresholdMs: 12_000,
			},
		]);
		expect(result.worstBreach?.field).toBe("workflow.execute_step_ms");
	});

	it("keeps every canonical stage timing field covered by the versioned budget artifact", () => {
		expect(LATENCY_BUDGET_RULES.map((rule) => rule.field).sort()).toEqual(
			[...STAGE_TIMING_FIELDS].sort(),
		);
	});
});
