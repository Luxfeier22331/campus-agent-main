import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	rollback: vi.fn(),
	publish: vi.fn(),
	store: vi.fn(),
	catalog: vi.fn(),
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
vi.mock("campus-rag-index-publisher/run", () => ({
	runCampusRagPublish: mocks.publish,
	runCampusRagRollback: mocks.rollback,
}));
vi.mock("notice-index-publisher/object-store", () => ({
	createNoticeS3ArtifactStore: mocks.store,
}));

import { rollbackIndex } from "../src/activities.ts";

describe("rollback activity", () => {
	beforeEach(() => vi.resetAllMocks());
	it("reuses the pinned target on retry and never resolves current/previous again", async () => {
		const input = {
			expectedCurrent: "B",
			collection: "A",
		};
		mocks.rollback
			.mockRejectedValueOnce(new Error("acknowledgement lost"))
			.mockResolvedValueOnce({ collection: "A", noOp: true });
		await expect(rollbackIndex(input)).rejects.toThrow("acknowledgement lost");
		expect(await rollbackIndex(input)).toEqual({ collection: "A", noOp: true });
		for (const [args] of mocks.rollback.mock.calls) {
			expect(args).toMatchObject(input);
		}
		expect(mocks.catalog).not.toHaveBeenCalled();
		expect(mocks.publish).not.toHaveBeenCalled();
		expect(mocks.store).not.toHaveBeenCalled();
	});
});
