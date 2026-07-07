// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createIngestionTaskProjectionClient } from "../src/modules/integration";

describe("ingestion-control client", () => {
	it("fails closed when ingestion-control is not configured", async () => {
		expect(() => createIngestionTaskProjectionClient({})).toThrow("not configured");
	});

	it("reads operator task projections from ingestion-control", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					page: { next_cursor: null },
					tasks: [
						{
							task_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
							status: "completed",
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
					status: "completed",
				},
			],
		});
		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://ingestion-control.internal/internal/ingestion/operator-projection/tasks?corpus=official_web&status=completed",
			{
				method: "GET",
			},
		);
	});

	it("fails closed when operator task projection returns an error", async () => {
		const client = createIngestionTaskProjectionClient(
			{
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
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
});
