import { describe, expect, it } from "vitest";
import { projectOpsStageTiming, projectOpsStageTimingBudget } from "../src/shared/stage-timing";

describe("ops stage timing projection", () => {
	it("keeps only stage_timing.v1 fields and uses repo latency budgets", () => {
		const rawTiming = {
			"agent.primary_ms": 7_500,
			"provider.raw_queue_ms": 999,
			"request.total_ms": 16_000,
			"tool.transport_schedule_lookup_ms": 2_000,
			"unknown.ms": 1,
		};

		expect(projectOpsStageTiming(rawTiming)).toEqual({
			"agent.primary_ms": 7_500,
			"request.total_ms": 16_000,
			"tool.transport_schedule_lookup_ms": 2_000,
		});
		expect(projectOpsStageTimingBudget(rawTiming)).toEqual({
			"agent.primary_ms": "WARN",
			"request.total_ms": "BREACH",
			"tool.transport_schedule_lookup_ms": "OK",
		});
	});
});
