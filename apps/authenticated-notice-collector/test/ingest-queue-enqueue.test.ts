import { describe, expect, it } from "vitest";

import { buildVerifiedRunEnqueueCommand } from "../src/ingest-queue-enqueue.js";

describe("authenticated notice collector ingest queue enqueue", () => {
	it("builds the repo-owned worker enqueue command from verified run facts", () => {
		const command = buildVerifiedRunEnqueueCommand({
			outputDir: "/tmp/enqueue-evidence",
			runId: "muc_internal_portal:notice:20260404T012345000Z",
			siteId: "muc_internal_portal",
			sourceSurface: "notice",
		});

		expect(command).toEqual([
			"uv",
			"run",
			"--all-packages",
			"python",
			"-m",
			"campus_ingestion_worker.enqueue_authenticated_notice_collector_run",
			"--run-id",
			"muc_internal_portal:notice:20260404T012345000Z",
			"--site-id",
			"muc_internal_portal",
			"--source-surface",
			"notice",
			"--output-dir",
			"/tmp/enqueue-evidence",
			"--enqueue-source",
			"live_discovery",
			"--execute",
		]);
	});
});
