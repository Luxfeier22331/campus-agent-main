import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionRequest } from "../src/agent-run-contract.ts";
import type { AgentControlClient } from "../src/control-client.ts";
import { createDomainToolExecutor } from "../src/domain-tools.ts";
import { loadToolCatalog } from "../src/tool-catalog.ts";

describe("Runtime domain tool Activities", () => {
	afterEach(() => vi.unstubAllGlobals());
	const config = {
		searchUrl: "http://search",
		searchToken: "search-token",
		memoryUrl: "http://memory",
		memorySecret: "memory-token",
	};
	const tool = loadToolCatalog(
		fileURLToPath(new URL("../../../configs/runtime/tools.v8.json", import.meta.url)),
	).tools.find((tool) => tool.name === "campus_search");
	if (!tool) {
		throw new Error("Test catalog must contain campus_search");
	}
	const request: ToolExecutionRequest = {
		requestId: "run",
		invocationId: "solve:tool:0",
		argumentsJson: { search_query: "去年通知", search_goal: "日期" },
		userGoal: "通知",
		tool,
		citationStart: 3,
	};
	it("searches directly and projects live retrieval status through control", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				Response.json({ collection: "index", results: [{ result_ref: "notice-1" }] }),
			);
		vi.stubGlobal("fetch", fetchMock);
		const call = vi.fn().mockResolvedValue({});
		const executor = createDomainToolExecutor(
			config,
			{ user_id: "user" },
			{ call } as unknown as AgentControlClient,
			"2026-10-10T00:00:00Z",
			"conversation",
		);
		const result = await executor(request);
		expect(result).toMatchObject({
			status: "completed",
			result: { outcome: "matched", results: [{ citation_index: 3 }] },
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"http://search/internal/v1/search",
			expect.objectContaining({ body: expect.stringContaining("2025年通知") }),
		);
		expect(
			call.mock.calls.map(([action, payload]) => [
				action,
				payload.retrieval_status ?? payload.collection,
			]),
		).toEqual([
			["retrieval/status", "started"],
			["collection/bind", "index"],
			["retrieval/status", "completed"],
		]);
	});
	it("closes the live retrieval event when Search fails", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection failed")));
		const call = vi.fn().mockResolvedValue({});
		const executor = createDomainToolExecutor(
			config,
			{ user_id: "user" },
			{ call } as unknown as AgentControlClient,
			"2026-10-10T00:00:00Z",
			"conversation",
		);
		expect(await executor(request)).toMatchObject({
			status: "failed",
			failure: { code: "campus_search_failed" },
		});
		expect(call.mock.calls.map(([, payload]) => payload.retrieval_status)).toEqual([
			"started",
			"failed",
		]);
	});
});
