import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { OperatorQueryService } from "../src/modules/operator-query";
import { createOperatorPrincipal, env } from "./operator-query.route.test-support";

export function registerOperatorQueryLangfuseEvalBacklinksSuite(): void {
	describe("GET /api/operator/langfuse/eval-backlinks", () => {
		it("returns sanitized Langfuse eval backlink summaries for operator principals", async () => {
			const service = {
				getLangfuseEvalBacklinksByTraceId: vi.fn().mockResolvedValue({
					backlinks: [
						{
							environment: "staging",
							evalRunId: "rag-first-stage:release-2026-06-19",
							langfuseUrl: "https://langfuse.example/project/traces/trace_01HQ",
							release: "release-2026-06-19",
							scoreName: "retrieval.pass",
							scoreValue: 1,
							traceId: "trace_01HQ",
						},
					],
				}),
			} as unknown as OperatorQueryService;
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/langfuse/eval-backlinks?traceId=trace_01HQ",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				backlinks: [
					{
						environment: "staging",
						evalRunId: "rag-first-stage:release-2026-06-19",
						langfuseUrl: "https://langfuse.example/project/traces/trace_01HQ",
						release: "release-2026-06-19",
						scoreName: "retrieval.pass",
						scoreValue: 1,
						traceId: "trace_01HQ",
					},
				],
			});
			expect(service.getLangfuseEvalBacklinksByTraceId).toHaveBeenCalledWith({
				principal,
				traceId: "trace_01HQ",
			});
		});
	});
}
