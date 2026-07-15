// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { createOperatorPrincipal, env } from "./operator-route.test-support";

describe("operator ingestion task route", () => {
	it("proxies read-only ingestion task projections for operator principals", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					tasks: [
						{
							schema_version: "ingestion_task_operator_projection.v2",
							task_id: "task_curriculum_chunk_001",
							run_id: "run_curriculum_20260611",
							source_family: "curriculum",
							source_channel: "curriculum_plan",
							corpus: "curriculum",
							collection: "curriculum_plan",
							registry_task_id: "curriculum.chunk_prepare",
							executor_kind: "rust_kernel",
							status: "completed",
							created_at: "2026-06-11T00:00:00.000Z",
							updated_at: "2026-06-11T00:02:00.000Z",
							result_contract: "ingestion_chunk_set.v1",
							has_result: true,
							summary: { chunk_count: 12 },
							last_error_code: null,
							last_error_message: null,
							workflow_id: "task_curriculum_chunk_001",
							workflow_run_id: "temporal-run-001",
						},
					],
					page: { next_cursor: null },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const app = createApp(
			{
				...env,
				INGESTION_CONTROL_BASE_URL: "http://ingestion-control",
				INGESTION_CONTROL_APP_API_PROJECTION_TOKEN: "app-api-projection-token",
			},
			{
				getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
				ingestionTaskProjectionFetch: fetchImplementation,
			},
		);

		const response = await app.fetch(
			new Request(
				"https://app-api.internal/api/operator/ingestion/tasks?corpus=curriculum&collection=curriculum_plan&status=completed",
			),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			tasks: [
				{
					schema_version: "ingestion_task_operator_projection.v2",
					task_id: "task_curriculum_chunk_001",
					run_id: "run_curriculum_20260611",
					source_family: "curriculum",
					source_channel: "curriculum_plan",
					corpus: "curriculum",
					collection: "curriculum_plan",
					registry_task_id: "curriculum.chunk_prepare",
					executor_kind: "rust_kernel",
					status: "completed",
					created_at: "2026-06-11T00:00:00.000Z",
					updated_at: "2026-06-11T00:02:00.000Z",
					result_contract: "ingestion_chunk_set.v1",
					has_result: true,
					summary: { chunk_count: 12 },
					last_error_code: null,
					last_error_message: null,
					workflow_id: "task_curriculum_chunk_001",
					workflow_run_id: "temporal-run-001",
				},
			],
			page: { next_cursor: null },
		});
		expect(fetchImplementation).toHaveBeenCalledWith(
			"http://ingestion-control/internal/ingestion/operator-projection/tasks?corpus=curriculum&collection=curriculum_plan&status=completed",
			{
				method: "GET",
				headers: {
					authorization: "Bearer app-api-projection-token",
				},
			},
		);
	});
});
