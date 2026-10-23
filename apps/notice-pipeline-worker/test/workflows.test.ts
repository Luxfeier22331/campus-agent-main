import { beforeEach, expect, it, vi } from "vitest";

const stages = vi.hoisted(() => ({
	collectNotices: vi.fn(),
	classifyNotices: vi.fn(),
	publishNoticesStage: vi.fn(),
	syncFiles: vi.fn(),
}));
const workflow = vi.hoisted(() => ({
	patched: vi.fn(() => true),
	workflowInfo: vi.fn(() => ({
		executionTimeoutMs: 4 * 60 * 60 * 1000,
		startTime: new Date(Date.now()),
	})),
}));
vi.mock("@temporalio/workflow", () => ({
	proxyActivities: () => stages,
	executeChild: vi.fn(),
	ParentClosePolicy: { ABANDON: "ABANDON" },
	patched: workflow.patched,
	workflowInfo: workflow.workflowInfo,
}));

import { noticePipelineRun } from "../src/workflows.ts";

beforeEach(() => {
	vi.resetAllMocks();
	workflow.patched.mockReturnValue(true);
	workflow.workflowInfo.mockImplementation(() => ({
		executionTimeoutMs: 4 * 60 * 60 * 1000,
		startTime: new Date(Date.now()),
	}));
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
it("relabels every internal notice in classify-all mode", async () => {
	await noticePipelineRun({ mode: "classify-all" });
	expect(stages.classifyNotices).toHaveBeenCalledWith("all");
	expect(stages.collectNotices).not.toHaveBeenCalled();
	expect(stages.publishNoticesStage).not.toHaveBeenCalled();
});
it("classifies explicit notices or the missing ones in classify-one mode", async () => {
	await noticePipelineRun({ mode: "classify-one", noticeIds: [42] });
	expect(stages.classifyNotices).toHaveBeenLastCalledWith({ noticeIds: [42] });
	await noticePipelineRun({ mode: "classify-one" });
	expect(stages.classifyNotices).toHaveBeenLastCalledWith("missing");
});

function backfillWindow(from: string, to: string, outcome = "success") {
	return {
		maintenanceRange: { from, to: "2026-10-23" },
		processedRange: { from, to },
		summary: { outcome, noticesProcessed: 10 },
	};
}
it("backfills in windows until the requested start date is covered", async () => {
	stages.collectNotices
		.mockResolvedValueOnce(backfillWindow("2026-09-01", "2026-10-01"))
		.mockResolvedValueOnce(backfillWindow("2026-08-02", "2026-09-01"))
		.mockResolvedValueOnce(backfillWindow("2026-08-01", "2026-08-02"));

	const result = await noticePipelineRun({ mode: "backfill", startDate: "2026-08-01" });

	expect(stages.collectNotices).toHaveBeenCalledTimes(3);
	expect(stages.collectNotices).toHaveBeenCalledWith({
		mode: "notice-backfill",
		startDate: "2026-08-01",
		windowDays: 30,
	});
	expect(result.collection).toEqual({
		maintenanceRange: { from: "2026-08-01", to: "2026-10-23" },
		processedRange: { from: "2026-08-01", to: "2026-10-01" },
		summary: { outcome: "success", noticesProcessed: 30 },
	});
	expect(stages.classifyNotices).toHaveBeenCalledOnce();
	expect(stages.publishNoticesStage).toHaveBeenCalledOnce();
});
it("stops opening windows after a window with item failures", async () => {
	stages.collectNotices
		.mockResolvedValueOnce(backfillWindow("2026-09-01", "2026-10-01"))
		.mockResolvedValueOnce({
			maintenanceRange: null,
			processedRange: { from: "2026-08-02", to: "2026-09-01" },
			summary: { outcome: "partial", noticesProcessed: 5 },
		});

	const result = await noticePipelineRun({ mode: "backfill", startDate: "2026-01-01" });

	expect(stages.collectNotices).toHaveBeenCalledTimes(2);
	expect(result.outcome).toBe("partial");
	expect(result.collection?.maintenanceRange).toEqual({ from: "2026-09-01", to: "2026-10-23" });
	expect(stages.publishNoticesStage).toHaveBeenCalledOnce();
});
it("leaves time for processing when the backfill is long", async () => {
	workflow.workflowInfo.mockImplementation(() => ({
		executionTimeoutMs: 4 * 60 * 60 * 1000,
		startTime: new Date(Date.now() - 2.5 * 60 * 60 * 1000),
	}));
	stages.collectNotices.mockResolvedValueOnce(backfillWindow("2026-09-01", "2026-10-01"));

	const result = await noticePipelineRun({ mode: "backfill", startDate: "2026-01-01" });

	expect(stages.collectNotices).toHaveBeenCalledOnce();
	expect(result.collection?.summary.outcome).toBe("partial");
	expect(stages.classifyNotices).toHaveBeenCalledOnce();
});
it("ends when the maintained range is already covered", async () => {
	stages.collectNotices.mockResolvedValueOnce({
		maintenanceRange: { from: "2025-12-01", to: "2026-10-23" },
		processedRange: null,
		summary: { outcome: "success" },
	});

	await noticePipelineRun({ mode: "backfill", startDate: "2026-01-01" });

	expect(stages.collectNotices).toHaveBeenCalledOnce();
});
it("replays a pre-window backfill history as one collection", async () => {
	workflow.patched.mockReturnValue(false);

	await noticePipelineRun({ mode: "backfill", startDate: "2026-01-01" });

	expect(stages.collectNotices).toHaveBeenCalledWith({
		mode: "notice-backfill",
		startDate: "2026-01-01",
	});
});
