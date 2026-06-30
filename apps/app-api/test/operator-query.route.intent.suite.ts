import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
	createOperatorPrincipal,
	createOperatorQueryServiceMock,
	env,
} from "./operator-query.route.test-support";

export function registerOperatorQueryIntentSuite(): void {
	describe("GET /api/operator/intent/summary", () => {
		it("returns an intent governance summary for operator principals", async () => {
			const principal = createOperatorPrincipal();
			const service = createOperatorQueryServiceMock({
				getIntentSummary: vi.fn().mockResolvedValue({
					asOf: "2026-03-28T08:00:10.000Z",
					runtime: {
						ambiguityRate: { count: 2, eligibleCount: 10, value: 0.2 },
						contextUnresolvedRate: { count: 1, eligibleCount: 10, value: 0.1 },
						distributions: {
							tool: [{ count: 6, value: "knowledge_query" }],
							classifierVersion: [{ count: 10, value: "intent-classifier@2026-04-20" }],
							launchState: [{ count: 8, value: "open" }],
							nextAction: [{ count: 7, value: "delegate" }],
							schemaVersion: [{ count: 10, value: "intent-schema-1.0.0" }],
							scopeClass: [{ count: 9, value: "in_scope" }],
							taskKind: [{ count: 6, value: "knowledge_lookup" }],
						},
						lowConfidenceRate: { count: 1, eligibleCount: 10, value: 0.1 },
						requestCount: 10,
					},
					sampledGrades: {
						coverageRate: { count: 4, eligibleCount: 10, value: 0.4 },
						intentPassRate: { count: 3, eligibleCount: 4, value: 0.75 },
					},
					window: {
						from: "2026-03-27T08:00:10.000Z",
						granularity: "1h",
						to: "2026-03-28T08:00:10.000Z",
					},
				}),
			});
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request(
					"https://app-api.internal/api/operator/intent/summary?window=24h&surface=campus_web&selectedTool=place_lookup",
				),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				runtime: {
					lowConfidenceRate: { count: 1, eligibleCount: 10, value: 0.1 },
					requestCount: 10,
				},
				sampledGrades: {
					intentPassRate: { count: 3, eligibleCount: 4, value: 0.75 },
				},
			});
			expect(service.getIntentSummary).toHaveBeenCalledWith({
				filters: {
					collection: null,
					granularity: null,
					modelName: null,
					principalType: null,
					requestedTool: null,
					selectedTool: "place_lookup",
					surface: "campus_web",
					window: "24h",
				},
				principal,
			});
		});
	});
}
