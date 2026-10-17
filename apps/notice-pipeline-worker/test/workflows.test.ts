import { beforeEach, expect, it, vi } from "vitest";

const stages = vi.hoisted(() => ({
	collectNotices: vi.fn(),
	classifyNotices: vi.fn(),
	publishNoticesStage: vi.fn(),
	syncFiles: vi.fn(),
}));
vi.mock("@temporalio/workflow", () => ({
	proxyActivities: () => stages,
	executeChild: vi.fn(),
	ParentClosePolicy: { ABANDON: "ABANDON" },
}));

import { noticePipelineRun } from "../src/workflows.ts";

beforeEach(() => {
	vi.resetAllMocks();
	stages.collectNotices.mockResolvedValue({ summary: { outcome: "success" } });
	stages.classifyNotices.mockResolvedValue({ outcome: "success" });
	stages.publishNoticesStage.mockResolvedValue({ outcome: "success" });
});
it("finishes scheduled ingestion with publication and no index stages", async () => {
	const result = await noticePipelineRun();
	expect(result).toEqual({
		outcome: "success",
		collection: { summary: { outcome: "success" } },
		classification: { outcome: "success" },
		publication: { outcome: "success" },
	});
});
it("continues processing item failures", async () => {
	stages.collectNotices.mockResolvedValue({ summary: { outcome: "partial" } });
	expect(await noticePipelineRun()).toMatchObject({ outcome: "partial" });
	expect(stages.publishNoticesStage).toHaveBeenCalledOnce();
});
it("stops on infrastructure failure", async () => {
	stages.collectNotices.mockRejectedValue(new Error("database unavailable"));
	await expect(noticePipelineRun()).rejects.toThrow("database unavailable");
	expect(stages.classifyNotices).not.toHaveBeenCalled();
});
it("republishes an explicit notice", async () => {
	await noticePipelineRun({ mode: "republish-one", noticeIds: [42] });
	expect(stages.publishNoticesStage).toHaveBeenCalledWith([42], true);
	expect(stages.collectNotices).not.toHaveBeenCalled();
});
