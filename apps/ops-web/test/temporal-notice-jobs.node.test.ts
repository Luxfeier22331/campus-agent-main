import type { Client, WorkflowExecutionDescription } from "@temporalio/client";
import { WorkflowExecutionAlreadyStartedError, WorkflowNotFoundError } from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";
import { noticePipelineInput, TemporalNoticeJobStore } from "../src/server/temporal-notice-jobs.ts";
import { type NoticeJobCreate, NoticeJobSchema } from "../src/shared/ops-contract.ts";

const runId = "11111111-1111-4111-8111-111111111111";
function fixture(status = "RUNNING") {
	const description = {
		workflowId: "notice-pipeline-workflow",
		runId,
		type: "noticePipelineRun",
		status: { name: status },
		startTime: new Date("2026-09-29T00:00:00Z"),
		memo: { noticeJob: { operation: "notice-republish-one", noticeId: 42 } },
		raw: { pendingActivities: [] },
	} as unknown as WorkflowExecutionDescription;
	const handle = {
		fetchHistory: vi.fn(async () => ({ events: [] })),
		describe: vi.fn(async () => description),
		result: vi.fn(async () => ({
			outcome: "partial",
			publication: { outcome: "partial", failed: 1, updated: 2 },
		})),
	};
	const client = {
		workflow: {
			getHandle: vi.fn(() => handle),
			start: vi.fn(async () => handle),
			list: async function* () {
				yield description;
			},
		},
	} as unknown as Client;
	return {
		client,
		handle,
		description,
		store: new TemporalNoticeJobStore(async (run) => run(client)),
	};
}
describe("Temporal notice maintenance", () => {
	it.each([
		[{ operation: "notice-sync" }, { mode: "sync" }],
		[
			{ operation: "notice-rescan", from: "2026-09-01", to: "2026-09-02" },
			{ mode: "rescan", from: "2026-09-01", to: "2026-09-02" },
		],
		[
			{ operation: "notice-backfill", startDate: "2026-09-01" },
			{ mode: "backfill", startDate: "2026-09-01" },
		],
		[{ operation: "notice-classify-missing" }, { mode: "classify-one" }],
		[
			{ operation: "notice-classify-one", noticeId: 42 },
			{ mode: "classify-one", noticeIds: [42] },
		],
		[{ operation: "notice-publish-pending" }, { mode: "publish-one" }],
		[
			{ operation: "notice-publish-one", noticeId: 42 },
			{ mode: "publish-one", noticeIds: [42] },
		],
		[
			{ operation: "notice-republish-one", noticeId: 42 },
			{ mode: "republish-one", noticeIds: [42] },
		],
	])("maps maintenance input %j", (input, expected) => {
		expect(noticePipelineInput(input as NoticeJobCreate)).toEqual(expected);
	});
	it("uses atomic shared admission and returns the unchanged API schema", async () => {
		const { client, store } = fixture();
		const job = await store.create({ operation: "notice-republish-one", noticeId: 42 });
		expect(NoticeJobSchema.parse(job)).toMatchObject({
			jobName: runId,
			operation: "notice-republish-one",
			status: "running",
		});
		expect(client.workflow.start).toHaveBeenCalledWith(
			"noticePipelineRun",
			expect.objectContaining({
				workflowId: "notice-pipeline-workflow",
				workflowIdConflictPolicy: "FAIL",
				args: [{ mode: "republish-one", noticeIds: [42] }],
			}),
		);
	});
	it("reports a concurrent start conflict even after preflight admission", async () => {
		const { client, store } = fixture();
		vi.mocked(client.workflow.start).mockRejectedValueOnce(
			new WorkflowExecutionAlreadyStartedError(
				"busy",
				"notice-pipeline-workflow",
				"noticePipelineRun",
			),
		);
		await expect(store.create({ operation: "notice-sync" })).rejects.toMatchObject({
			runningJobName: runId,
		});
	});
	it("keeps completed partial results on the exact run", async () => {
		const { client, store } = fixture("COMPLETED");
		const job = await store.get(runId);
		expect(NoticeJobSchema.parse(job)).toMatchObject({
			status: "succeeded",
			summary: { outcome: "partial", failed: 1, updated: 2 },
		});
		expect(client.workflow.getHandle).toHaveBeenCalledWith("notice-pipeline-workflow", runId, {
			followRuns: false,
		});
	});
	it.each(["FAILED", "CANCELLED", "TERMINATED", "TIMED_OUT"])(
		"maps %s to failed",
		async (status) => {
			const { handle, store } = fixture(status);
			handle.result.mockRejectedValueOnce(new Error(status));
			expect(await store.get(runId)).toMatchObject({
				status: "failed",
				error: status,
				controllerError: null,
			});
		},
	);
	it("returns null for missing runs", async () => {
		const { handle, store } = fixture();
		handle.describe.mockRejectedValueOnce(
			new WorkflowNotFoundError("missing", "notice-pipeline-workflow", runId),
		);
		await expect(store.get(runId)).resolves.toBeNull();
	});
});
