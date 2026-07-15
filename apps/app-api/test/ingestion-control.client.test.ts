// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createIngestionTaskProjectionClient } from "../src/modules/integration";

describe("ingestion-control client", () => {
	it("fails closed when ingestion-control is not configured", async () => {
		expect(() => createIngestionTaskProjectionClient({})).toThrow("not configured");
	});

	it("fails closed when projection token is not configured", async () => {
		expect(() =>
			createIngestionTaskProjectionClient({
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
			}),
		).toThrow("projection token is not configured");
	});

	it("reads operator task projections from ingestion-control", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					page: { next_cursor: null },
					tasks: [
						{
							task_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
							schema_version: "ingestion_task_operator_projection.v2",
							run_id: "owrun_01HQ",
							source_family: "official_web",
							source_channel: "official_web",
							corpus: "official_web",
							collection: "stable_reference",
							registry_task_id: "official_web.capture",
							executor_kind: "source_collector",
							status: "completed",
							created_at: "2026-06-11T00:00:00.000Z",
							updated_at: "2026-06-11T00:01:00.000Z",
							result_contract: "official_web_capture_result.v1",
							has_result: true,
							summary: { artifact_count: 1 },
							last_error_code: null,
							last_error_message: null,
							workflow_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
							workflow_run_id: "temporal-run-001",
						},
					],
				}),
				{
					headers: {
						"content-type": "application/json",
					},
					status: 200,
				},
			),
		);
		const client = createIngestionTaskProjectionClient(
			{
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
				INGESTION_CONTROL_APP_API_PROJECTION_TOKEN: "app-api-projection-token",
			},
			{
				fetchImplementation,
			},
		);

		const result = await client.listTasks({
			query: new URLSearchParams({ corpus: "official_web", status: "completed" }),
		});

		expect(result).toEqual({
			page: { next_cursor: null },
			tasks: [
				{
					task_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
					schema_version: "ingestion_task_operator_projection.v2",
					run_id: "owrun_01HQ",
					source_family: "official_web",
					source_channel: "official_web",
					corpus: "official_web",
					collection: "stable_reference",
					registry_task_id: "official_web.capture",
					executor_kind: "source_collector",
					status: "completed",
					created_at: "2026-06-11T00:00:00.000Z",
					updated_at: "2026-06-11T00:01:00.000Z",
					result_contract: "official_web_capture_result.v1",
					has_result: true,
					summary: { artifact_count: 1 },
					last_error_code: null,
					last_error_message: null,
					workflow_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
					workflow_run_id: "temporal-run-001",
				},
			],
		});
		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://ingestion-control.internal/internal/ingestion/operator-projection/tasks?corpus=official_web&status=completed",
			{
				method: "GET",
				headers: {
					authorization: "Bearer app-api-projection-token",
				},
			},
		);
	});

	it("fails closed when operator task projection returns an error", async () => {
		const client = createIngestionTaskProjectionClient(
			{
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
				INGESTION_CONTROL_APP_API_PROJECTION_TOKEN: "app-api-projection-token",
			},
			{
				fetchImplementation: vi
					.fn()
					.mockResolvedValue(
						new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
					),
			},
		);

		await expect(client.listTasks({ query: new URLSearchParams() })).rejects.toMatchObject({
			code: "ingestion_control_projection_unavailable",
			status: 502,
		});
	});

	it("fails closed when operator task projection contains raw task internals", async () => {
		const client = createIngestionTaskProjectionClient(
			{
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
				INGESTION_CONTROL_APP_API_PROJECTION_TOKEN: "app-api-projection-token",
			},
			{
				fetchImplementation: vi.fn().mockResolvedValue(
					new Response(
						JSON.stringify({
							page: { next_cursor: null },
							tasks: [
								{
									schema_version: "ingestion_task_operator_projection.v2",
									task_id: "task_01",
									run_id: "run_01",
									source_family: "official_web",
									source_channel: "official_web",
									corpus: "official_web",
									collection: "stable_reference",
									registry_task_id: "official_web.capture",
									executor_kind: "source_collector",
									status: "completed",
									created_at: "2026-06-11T00:00:00.000Z",
									updated_at: "2026-06-11T00:01:00.000Z",
									result_contract: "official_web_capture_result.v1",
									has_result: true,
									summary: { artifact_count: 1 },
									last_error_code: null,
									last_error_message: null,
									workflow_id: "task_01",
									workflow_run_id: "temporal-run-001",
									input_ref: { kind: "object_store", uri: "s3://bucket/raw.json" },
								},
							],
						}),
						{ status: 200 },
					),
				),
			},
		);

		await expect(client.listTasks({ query: new URLSearchParams() })).rejects.toMatchObject({
			code: "ingestion_control_projection_invalid",
			status: 502,
		});
	});
});
