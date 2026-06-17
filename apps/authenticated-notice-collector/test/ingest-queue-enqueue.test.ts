import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildVerifiedRunTaskEnvelope } from "../src/ingest-queue-enqueue.js";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const internalNoticeRegistry = JSON.parse(
	readFileSync(
		join(
			repoRoot,
			"configs",
			"ingestion",
			"campus_notices",
			"internal_notice",
			"task-registry.v1.json",
		),
		"utf8",
	),
) as {
	tasks: Array<{ task_kind: string; output_contract: string }>;
};

describe("authenticated notice collector ingest queue enqueue", () => {
	it("builds an ingestion-control task envelope from verified run facts", () => {
		const envelope = buildVerifiedRunTaskEnvelope({
			collectedAt: "2026-06-12T00:00:00Z",
			runId: "muc_internal_portal:notice:20260404T012345000Z",
			siteId: "muc_internal_portal",
			sourceSurface: "notice",
		});

		expect(envelope).toMatchObject({
			schema_version: "ingestion_task_envelope.v1",
			task_id: "authenticated_notice_collector_run:muc_internal_portal:notice:20260404T012345000Z",
			run_id: "muc_internal_portal:notice:20260404T012345000Z",
			source_family: "authenticated_notice",
			source_channel: "muc_internal_portal",
			corpus: "campus_notices",
			collection: "internal_notice",
			task_kind: "source_truth_materialize",
			input_ref: {
				kind: "inline",
				uri: "collector-run://muc_internal_portal/notice/muc_internal_portal:notice:20260404T012345000Z",
			},
			output_contract: "authenticated_notice_source_truth.v1",
			idempotency_key:
				"authenticated_notice_portal/muc_internal_portal/notice/muc_internal_portal:notice:20260404T012345000Z",
			created_by: "authenticated-notice-collector",
			created_at: "2026-06-12T00:00:00Z",
		});
		expect(
			internalNoticeRegistry.tasks.some(
				(task) =>
					task.task_kind === envelope.task_kind &&
					task.output_contract === envelope.output_contract,
			),
		).toBe(true);
	});
});
