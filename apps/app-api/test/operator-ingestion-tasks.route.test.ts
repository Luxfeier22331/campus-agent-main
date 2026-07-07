// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import {
	createOperatorPrincipal,
	createOperatorQueryServiceMock,
	env,
} from "./operator-query.route.test-support";

describe("operator ingestion task route", () => {
	it("proxies read-only ingestion task projections for operator principals", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					tasks: [
						{
							schema_version: "ingestion_task_operator_projection.v1",
							task_id: "task_curriculum_chunk_001",
							run_id: "run_curriculum_20260611",
							source_family: "curriculum",
							source_channel: "curriculum_plan",
							corpus: "curriculum",
							collection: "curriculum_plan",
							task_kind: "chunk_prepare",
							status: "completed",
							created_at: "2026-06-11T00:00:00.000Z",
							updated_at: "2026-06-11T00:02:00.000Z",
							terminal_status: "completed",
							outcome_kind: "success",
							artifact_count: 1,
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
			},
			{
				getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
				operatorQueryService: createOperatorQueryServiceMock(),
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
					schema_version: "ingestion_task_operator_projection.v1",
					task_id: "task_curriculum_chunk_001",
					run_id: "run_curriculum_20260611",
					source_family: "curriculum",
					source_channel: "curriculum_plan",
					corpus: "curriculum",
					collection: "curriculum_plan",
					task_kind: "chunk_prepare",
					status: "completed",
					created_at: "2026-06-11T00:00:00.000Z",
					updated_at: "2026-06-11T00:02:00.000Z",
					terminal_status: "completed",
					outcome_kind: "success",
					artifact_count: 1,
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
			{ method: "GET" },
		);
	});
});
