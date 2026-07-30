import type { InternalPortalFileReleaseCaptureResult } from "ingestion-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const temporal = vi.hoisted(() => ({
	heartbeat: vi.fn(),
	signal: new AbortController().signal,
}));
const captureInternalPortalFileRelease = vi.hoisted(() => vi.fn());

vi.mock("@temporalio/activity", () => ({
	Context: {
		current: () => ({
			cancellationSignal: temporal.signal,
			heartbeat: temporal.heartbeat,
		}),
	},
}));

vi.mock("../adapters/internal-portal/src/file-release-capture.ts", () => ({
	captureInternalPortalFileRelease,
}));

import { createSourceCollectorActivities } from "../src/activities";

describe("source collector Temporal activities", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		temporal.signal = new AbortController().signal;
	});

	it("captures one exact internal portal file release", async () => {
		const result: InternalPortalFileReleaseCaptureResult = {
			file_release_id: 646,
			schema_version: "internal_portal_file_release_capture_result.v1",
			source_ref: {
				byte_size: 123,
				digest: `sha256:${"a".repeat(64)}`,
				kind: "object_store",
				uri: "s3://campus-agent-source/internal_portal/site/file-releases/646/source.json",
			},
		};
		captureInternalPortalFileRelease.mockResolvedValue(result);
		const objectStore = { sourceBucket: "campus-agent-source" };

		await expect(
			createSourceCollectorActivities({
				env: {},
				objectStore: objectStore as never,
			}).captureInternalPortalFileRelease({ fileReleaseId: 646 }),
		).resolves.toEqual(result);
		expect(captureInternalPortalFileRelease).toHaveBeenCalledWith({
			abortSignal: temporal.signal,
			config: expect.objectContaining({ siteId: "muc_internal_portal" }),
			fileReleaseId: 646,
			objectStore,
		});
		expect(temporal.heartbeat).toHaveBeenCalledWith({ file_release_id: 646, phase: "capture" });
	});
});
