import { describe, expect, it } from "vitest";
import type { ToolExecutionRequest } from "../src/agent-run-contract.ts";
import { createCampusSearchReporter } from "../src/campus-search-observer.ts";

const request = (): ToolExecutionRequest => ({
	requestId: "request-1",
	invocationId: "call-1",
	workflowStepId: "task.step.one",
	activityAttempt: 1,
	argumentsJson: { search_query: "图书馆" },
	citationStart: 1,
	resultLimit: 5,
	userGoal: "图书馆",
	tool: {
		name: "campus_search",
		timeoutMs: 10,
		handler: { type: "agent_control_internal_query", endpoint: "/internal/campus/search" },
	} as ToolExecutionRequest["tool"],
});

describe("Campus Search observation delivery", () => {
	it("does not retry or expose arguments beyond the query", async () => {
		const observations: Record<string, unknown>[] = [];
		const report = createCampusSearchReporter({
			baseUrl: "http://execution",
			sharedSecret: "secret",
			fetchImpl: async (_url, init) => {
				observations.push(JSON.parse(String(init?.body)));
				throw new Error("offline");
			},
		});
		await report(
			{ ...request(), argumentsJson: { search_query: "字".repeat(401), secret: "private" } },
			{ phase: "queued" },
		);
		expect(observations).toHaveLength(1);
		expect(observations[0]?.searchQuery).toHaveLength(400);
		expect(observations[0]).not.toHaveProperty("secret");
	});
});
