import { describe, expect, it } from "vitest";

import {
	parseToolTrajectory,
	scoreToolSequence,
	toolSequenceFromTrajectory,
} from "../src/tool-trajectory";

describe("tool trajectory projection", () => {
	it("parses the ordered public tool trajectory and scores the complete sequence", () => {
		const trajectory = parseToolTrajectory({
			decision_kind: "tool_assisted",
			schema_version: "tool_trajectory.v4",
			tool_calls: [
				{
					tool_name: "personal_memory_recall",
				},
			],
		});

		expect(toolSequenceFromTrajectory(trajectory)).toEqual(["personal_memory_recall"]);
		expect(scoreToolSequence(trajectory, ["personal_memory_recall"])).toBe(true);
		expect(scoreToolSequence(trajectory, [])).toBe(false);
	});

	it("rejects the retired trajectory version and inactive tools", () => {
		expect(() =>
			parseToolTrajectory({
				decision_kind: "direct_answer",
				schema_version: "tool_trajectory.v3",
				tool_calls: [],
			}),
		).toThrow(/not supported/u);
		expect(() =>
			parseToolTrajectory({
				decision_kind: "tool_assisted",
				schema_version: "tool_trajectory.v4",
				tool_calls: [{ tool_name: "legacy_tool" }],
			}),
		).toThrow(/active agent runtime tool/i);
	});

	it("does not count fail closed as a direct answer", () => {
		const trajectory = parseToolTrajectory({
			decision_kind: "fail_closed",
			schema_version: "tool_trajectory.v4",
			tool_calls: [],
		});

		expect(trajectory.decision_kind).toBe("fail_closed");
		expect(scoreToolSequence(trajectory, [])).toBe(true);
	});

	it("keeps campus_search query arguments on tool calls", () => {
		const trajectory = parseToolTrajectory({
			decision_kind: "tool_assisted",
			schema_version: "tool_trajectory.v4",
			tool_calls: [
				{
					search_goal: "确认本科生转专业的申请条件",
					search_query: "本科生转专业 申请条件",
					tool_name: "campus_search",
				},
			],
		});

		expect(toolSequenceFromTrajectory(trajectory)).toEqual(["campus_search"]);
		expect(trajectory.tool_calls[0]).toEqual({
			search_goal: "确认本科生转专业的申请条件",
			search_query: "本科生转专业 申请条件",
			tool_name: "campus_search",
		});
	});
});
