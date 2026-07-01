// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	createIngestionTaskProjectionClient,
	type IngestionTaskEnvelope,
} from "../src/modules/integration";

const task: IngestionTaskEnvelope = {
	schema_version: "ingestion_task_envelope.v1",
	task_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
	run_id: "owrun_01HQ",
	source_family: "official_web",
	source_channel: "official_web",
	corpus: "official_web",
	collection: "stable_reference",
	task_kind: "source_truth_materialize",
	input_ref: {
		kind: "object_store",
		uri: "s3://campus-agent-source/official_web/www_muc_edu_cn/runs/owrun_01HQ/source-truth-bundle.json",
		digest: "sha256:def456",
	},
	output_contract: "official_web_stable_reference_source_truth.v1",
	idempotency_key: "official_web/stable_reference/source_truth_materialize/owrun_01HQ",
	lease_policy: {
		lease_seconds: 300,
		heartbeat_seconds: 30,
	},
	retry_policy: {
		max_attempts: 3,
	},
	created_by: "app-api:official-web-projection",
	created_at: "2026-03-29T08:17:33.000Z",
};

describe("ingestion-control client", () => {
	it("fails closed when ingestion-control is not configured", async () => {
		expect(() => createIngestionTaskProjectionClient({})).toThrow("not configured");
	});

	it("admits tasks through the generic ingestion-control task endpoint", async () => {
		const fetchImplementation = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					task_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
					status: "queued",
				}),
				{
					headers: {
						"content-type": "application/json",
					},
					status: 202,
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

		const result = await client.admitTask(task);

		expect(result).toEqual({
			task_id: "task_official_web_stable_reference_source_truth_owrun_01HQ",
			status: "queued",
		});
		expect(fetchImplementation).toHaveBeenCalledWith(
			"https://ingestion-control.internal/internal/ingestion/tasks",
			{
				body: JSON.stringify(task),
				headers: {
					"content-type": "application/json",
				},
				method: "POST",
			},
		);
	});

	it("fails closed when task admission returns an invalid response", async () => {
		const client = createIngestionTaskProjectionClient(
			{
				INGESTION_CONTROL_BASE_URL: "https://ingestion-control.internal",
			},
			{
				fetchImplementation: vi
					.fn()
					.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
			},
		);

		await expect(client.admitTask(task)).rejects.toMatchObject({
			code: "ingestion_control_task_admission_invalid_response",
			status: 502,
		});
	});
});
