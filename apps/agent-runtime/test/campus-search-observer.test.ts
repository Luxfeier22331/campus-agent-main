import { describe, expect, it } from "vitest";
import type { ToolExecutionRequest } from "../src/agent-run-contract.ts";
import { createCampusSearchReporter } from "../src/campus-search-observer.ts";
import { createExecutionControlToolExecutor } from "../src/tool-executor.ts";

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
		handler: { type: "execution_control_internal_query", endpoint: "/internal/campus/search" },
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
	it.each(["matched", "no_match"])(
		"preserves %s results when observations fail",
		async (outcome) => {
			const executor = createExecutionControlToolExecutor({
				baseUrl: "http://execution",
				sharedSecret: "secret",
				fetchImpl: async (url) => {
					if (String(url).endsWith("observations")) {
						throw new Error("diagnostics offline");
					}
					return Response.json({ outcome, results: [] });
				},
			});
			expect(await executor(request())).toEqual({
				status: "completed",
				result: { outcome, results: [] },
			});
		},
	);
	it.each(["network", "timeout", "cancel"])(
		"records %s without changing the result contract",
		async (mode) => {
			const observations: Array<{ phase: string; failureCode?: string }> = [];
			const controller = new AbortController();
			const executor = createExecutionControlToolExecutor({
				baseUrl: "http://execution",
				sharedSecret: "secret",
				fetchImpl: async (url, init) => {
					if (String(url).endsWith("observations")) {
						observations.push(JSON.parse(String(init?.body)));
						return new Response(null, { status: 204 });
					}
					if (mode === "network") {
						throw new Error("connection refused");
					}
					if (mode === "cancel") {
						controller.abort(new Error("user canceled"));
					}
					await new Promise<void>((_resolve, reject) => {
						const signal = init?.signal;
						if (signal?.aborted) {
							reject(signal.reason);
						} else {
							signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
						}
					});
					return Response.json({});
				},
			});
			const promise = executor({ ...request(), signal: controller.signal });
			if (mode === "cancel") {
				await expect(promise).rejects.toThrow("user canceled");
			} else {
				expect(await promise).toMatchObject({
					status: "failed",
					failure: {
						code: mode === "network" ? "campus_search_network_failed" : "campus_search_timeout",
					},
				});
			}
			expect(observations.map((o) => o.phase)).toEqual([
				"dispatching",
				mode === "cancel" ? "canceled" : "failed",
			]);
			if (mode === "timeout") {
				expect(observations[1]?.failureCode).toBe("campus_search_timeout");
			}
		},
	);
});
