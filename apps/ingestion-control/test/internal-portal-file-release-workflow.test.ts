import { beforeEach, describe, expect, it, vi } from "vitest";

const captureInternalPortalFileRelease = vi.hoisted(() => vi.fn());
const proxyActivities = vi.hoisted(() => vi.fn(() => ({ captureInternalPortalFileRelease })));

vi.mock("@temporalio/workflow", () => ({
	ApplicationFailure: class extends Error {},
	CancellationScope: { nonCancellable: vi.fn() },
	isCancellation: vi.fn(),
	proxyActivities,
	workflowInfo: vi.fn(),
}));

import { internalPortalFileReleaseWorkflow } from "../src/workflows/ingestion-task-workflow";

describe("internal portal file-release workflow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls one source activity with Temporal retries disabled", async () => {
		captureInternalPortalFileRelease.mockResolvedValue({
			file_release_id: 646,
			schema_version: "internal_portal_file_release_capture_result.v1",
			source_ref: {
				byte_size: 1,
				digest: `sha256:${"a".repeat(64)}`,
				kind: "object_store",
				uri: "s3://source/internal_portal/site/file-releases/646/source.json",
			},
		});

		await internalPortalFileReleaseWorkflow({
			fileReleaseId: 646,
			sourceCollectorActivityTaskQueue: "ingestion.source",
		});

		expect(proxyActivities).toHaveBeenCalledWith({
			heartbeatTimeout: "30 seconds",
			retry: { maximumAttempts: 1 },
			startToCloseTimeout: "12 hours",
			taskQueue: "ingestion.source",
		});
		expect(captureInternalPortalFileRelease).toHaveBeenCalledOnce();
		expect(captureInternalPortalFileRelease).toHaveBeenCalledWith({ fileReleaseId: 646 });
	});
});
