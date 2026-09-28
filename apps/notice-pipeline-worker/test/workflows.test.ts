import { beforeEach, describe, expect, it, vi } from "vitest";

const stages = vi.hoisted(() => ({
	collectNotices: vi.fn(),
	classifyNotices: vi.fn(),
	publishNoticesStage: vi.fn(),
	syncFiles: vi.fn(),
	prepareRefresh: vi.fn(),
	embedNotices: vi.fn(),
	publishRefresh: vi.fn(),
	cleanupVersions: vi.fn(),
}));
vi.mock("@temporalio/workflow", () => ({
	proxyActivities: () => stages,
	executeChild: vi.fn(),
	isCancellation: (error: unknown) => error instanceof Error && error.name === "CancelledFailure",
	ParentClosePolicy: { ABANDON: "ABANDON" },
}));

import { noticePipelineRun } from "../src/workflows.ts";

beforeEach(() => {
	vi.resetAllMocks();
	stages.collectNotices.mockResolvedValue({ summary: { outcome: "success", noticesProcessed: 2 } });
	stages.classifyNotices.mockResolvedValue({ outcome: "success", classified: 2 });
	stages.publishNoticesStage.mockResolvedValue({ outcome: "success", notices: 2 });
	stages.prepareRefresh.mockResolvedValue({ unchanged: false, expectedCurrent: "old" });
	stages.embedNotices.mockResolvedValue({ embeddingSet: "set" });
	stages.publishRefresh.mockResolvedValue({ outcome: "success", collection: "new" });
	stages.cleanupVersions.mockResolvedValue({ outcome: "success" });
});
describe("notice pipeline outcomes", () => {
	it("continues valid notices after item failures and exposes partial completion", async () => {
		stages.collectNotices.mockResolvedValue({ summary: { outcome: "partial", noticesFailed: 1 } });
		expect(await noticePipelineRun()).toMatchObject({
			outcome: "partial",
			rag: { collection: "new" },
		});
		expect(stages.classifyNotices).toHaveBeenCalledOnce();
		expect(stages.cleanupVersions).toHaveBeenCalledOnce();
	});
	it("stops downstream stages on infrastructure failure", async () => {
		stages.collectNotices.mockRejectedValue(new Error("database unavailable"));
		await expect(noticePipelineRun()).rejects.toThrow("database unavailable");
		expect(stages.classifyNotices).not.toHaveBeenCalled();
		expect(stages.prepareRefresh).not.toHaveBeenCalled();
	});
	it("dispatches republish explicitly and avoids collection", async () => {
		await expect(
			noticePipelineRun({ mode: "republish-one", noticeIds: [42] }),
		).resolves.toMatchObject({ outcome: "success" });
		expect(stages.publishNoticesStage).toHaveBeenCalledWith([42], true);
		expect(stages.collectNotices).not.toHaveBeenCalled();
	});
	it("preserves publication but reports cleanup failure", async () => {
		stages.cleanupVersions.mockRejectedValue(new Error("object store unavailable"));
		expect(await noticePipelineRun({ mode: "refresh" })).toMatchObject({
			outcome: "partial",
			rag: { collection: "new" },
			cleanup: { outcome: "failed" },
		});
	});
	it("never converts cancellation to partial success", async () => {
		const error = new Error("cancelled");
		error.name = "CancelledFailure";
		stages.cleanupVersions.mockRejectedValue(error);
		await expect(noticePipelineRun({ mode: "refresh" })).rejects.toBe(error);
	});
});
