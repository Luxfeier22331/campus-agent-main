import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	publish: vi.fn(),
	catalog: vi.fn(),
	close: vi.fn(),
}));

vi.mock("@temporalio/activity", () => ({
	Context: {
		current: () => ({
			cancellationSignal: new AbortController().signal,
			info: { activityType: "rollbackIndex" },
		}),
	},
	heartbeat: vi.fn(),
}));
vi.mock("campus-rag-index-publisher/catalog", () => ({
	createPostgresIndexCatalog: mocks.catalog,
}));
vi.mock("campus-rag-index-publisher/run", () => ({ runCampusRagPublish: mocks.publish }));
vi.mock("notice-index-publisher/object-store", () => ({
	createNoticeS3ArtifactStore: () => ({ close: mocks.close }),
}));

import { rollbackIndex } from "../src/activities.ts";

describe("rollback activity", () => {
	beforeEach(() => vi.resetAllMocks());
	it("reuses the pinned target on retry and never resolves current/previous again", async () => {
		const input = {
			expectedCurrent: "B",
			docsEmbeddingSet: "sha256:a" as const,
			noticeEmbeddingSet: "sha256:b" as const,
			producer: "automatic" as const,
			producerRunId: "original",
		};
		mocks.publish
			.mockRejectedValueOnce(new Error("acknowledgement lost"))
			.mockResolvedValueOnce({ collection: "A", noOp: true });
		await expect(rollbackIndex(input)).rejects.toThrow("acknowledgement lost");
		expect(await rollbackIndex(input)).toEqual({ collection: "A", noOp: true });
		for (const [args] of mocks.publish.mock.calls) {
			expect(args).toMatchObject(input);
		}
		expect(mocks.catalog).not.toHaveBeenCalled();
		expect(mocks.close).toHaveBeenCalledTimes(2);
	});
});
