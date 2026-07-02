import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
	createOperatorPrincipal,
	createOperatorQueryServiceMock,
	env,
} from "./operator-query.route.test-support";

export function registerOperatorQueryRetiredRoutesSuite(): void {
	describe("retired broad operator observability routes", () => {
		it("keeps old browser-facing observability dashboards closed", async () => {
			const service = createOperatorQueryServiceMock();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
				operatorQueryService: service,
			});

			for (const path of [
				"/api/operator/requests/req_01HQ/observability",
				"/api/operator/intent/summary",
				"/api/operator/quality/summary",
				"/api/operator/quality/timeseries",
				"/api/operator/quality/badcases",
				"/api/operator/quality/eval-candidates",
				"/api/operator/safety/summary",
				"/api/operator/safety/anomalies",
				"/api/operator/cost/summary",
				"/api/operator/cost/timeseries",
				"/api/operator/audit",
				"/api/operator/audit/audit_01HQ",
				"/api/operator/runtime/temporal-task-queues",
				"/api/operator/runtime/autoscaler/actuations",
				"/api/operator/runtime/autoscaler/postures",
				"/api/operator/runtime/autoscaler/decisions",
			]) {
				const response = await app.fetch(new Request(`https://app-api.internal${path}`));
				expect(response.status, path).toBe(404);
			}
		});
	});
}
