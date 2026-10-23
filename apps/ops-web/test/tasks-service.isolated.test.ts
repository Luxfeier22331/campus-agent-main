// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
	readCron: vi.fn(),
	listJobs: vi.fn(),
	pause: vi.fn(),
	describe: vi.fn(),
	update: vi.fn(),
	trigger: vi.fn(),
	start: vi.fn(),
	list: vi.fn(),
	close: vi.fn(),
	query: vi.fn(),
	getHandle: vi.fn(),
	readJob: vi.fn(),
}));
vi.mock("@kubernetes/client-node", () => ({
	BatchV1Api: class {},
	KubeConfig: class {
		loadFromCluster() {
			/* Fake cluster credentials for service behavior tests. */
		}
		makeApiClient() {
			return {
				readNamespacedCronJob: native.readCron,
				listNamespacedJob: native.listJobs,
				readNamespacedJob: native.readJob,
			};
		}
	},
}));
vi.mock("@temporalio/client", () => ({
	WorkflowExecutionAlreadyStartedError: class extends Error {},
	WorkflowNotFoundError: class extends Error {},
	ScheduleOverlapPolicy: { SKIP: "SKIP" },
	Connection: { connect: async () => ({ close: native.close }) },
	Client: class {
		schedule = {
			getHandle: () => ({
				pause: native.pause,
				describe: native.describe,
				update: native.update,
				trigger: native.trigger,
			}),
		};
		workflow = { start: native.start, list: native.list, getHandle: native.getHandle };
	},
}));

import { createTaskService } from "../src/server/tasks.ts";

function service(local = false) {
	return createTaskService({
		local,
		namespace: "staging",
		env: {},
		pool: { query: native.query },
	});
}
beforeEach(() => {
	vi.resetAllMocks();
	native.list.mockImplementation(async function* () {
		/* No running workflows. */
	});
	native.describe.mockResolvedValue({
		state: { paused: false },
		spec: { intervals: [{ every: 900000 }] },
		info: { runningActions: [] },
	});
	native.readCron.mockResolvedValue({ spec: { suspend: false, schedule: "*/5 * * * *" } });
	native.listJobs.mockResolvedValue({ items: [] });
	native.start.mockResolvedValue({
		workflowId: "notice-pipeline-workflow",
		firstExecutionRunId: "run-1",
	});
	native.query.mockResolvedValue({
		rows: [
			{
				expected_current: `campus_docs_${"b".repeat(64)}`,
				collection: `campus_docs_${"a".repeat(64)}`,
			},
		],
	});
});
describe("native task ownership", () => {
	it.each([false, true])(
		"lists only current tasks with executable capabilities (local=%s)",
		async (local) => {
			const tasks = await service(local).list();
			expect(tasks.map((task) => task.id)).toEqual([
				"notice-pipeline",
				"document-ocr",
				"internal-portal-credential-checker",
			]);
			expect(tasks[0]).toMatchObject({
				runtime: "temporal",
				enabled: true,
				intervalMinutes: 15,
				canSchedule: true,
				canRun: true,
				error: null,
			});
			for (const task of tasks.slice(1)) {
				expect(task).toMatchObject({
					runtime: "kubernetes",
					canSchedule: false,
					canRun: false,
					error: null,
				});
			}
			expect(native.describe).toHaveBeenCalledTimes(1);
			expect(native.readCron.mock.calls.map(([request]) => request.name)).toEqual(
				local ? [] : ["document-ocr", "ops-web-internal-portal-check"],
			);
		},
	);
	it("keeps current CronJob scheduling and execution read-only", async () => {
		for (const id of ["document-ocr", "internal-portal-credential-checker"] as const) {
			await expect(
				service().update(id, { enabled: true, intervalMinutes: 15 }),
			).rejects.toMatchObject({ status: 409 });
			await expect(service().run(id)).rejects.toMatchObject({ status: 409 });
		}
		expect(native.update).not.toHaveBeenCalled();
		expect(native.start).not.toHaveBeenCalled();
	});
	it("preserves Temporal action and policies when the operator changes timing", async () => {
		const existing = {
			action: { workflowType: "noticePipelineRun" },
			policies: { overlap: "SKIP" },
			state: { paused: true, note: "initialized" },
			spec: { intervals: [{ every: 3600000 }] },
		};
		native.update.mockImplementation(async (fn) => {
			expect(fn(existing)).toEqual({
				...existing,
				spec: { intervals: [{ every: 900000 }] },
				state: { paused: false, note: "initialized" },
			});
		});
		await service().update("notice-pipeline", { enabled: true, intervalMinutes: 15 });
		expect(native.update).toHaveBeenCalledTimes(1);
	});
	it("gives repeated workflow executions distinct identities and exact result handles", async () => {
		const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
		const firstId = ids[0];
		if (!firstId) {
			throw new Error("test fixture is missing the first run ID");
		}
		const execution = (runId: string) => ({
			workflowId: "notice-pipeline-workflow",
			runId,
			type: "noticePipelineRun",
			status: { name: "COMPLETED" },
			startTime: new Date(),
			closeTime: new Date(),
		});
		native.list.mockImplementation(async function* ({ query }) {
			if (query.startsWith("RunId=")) {
				yield execution(firstId);
			} else {
				for (const id of ids) {
					yield execution(id);
				}
			}
		});
		native.getHandle.mockImplementation((_workflowId, runId) => ({
			result: async () => ({ outcome: "success", collection: runId }),
		}));
		expect((await service().runs("notice-pipeline")).map((run) => run.id)).toEqual(ids);
		expect(await service().getRun("notice-pipeline", firstId)).toMatchObject({
			id: firstId,
			runId: firstId,
			details: { collection: ids[0] },
		});
		expect(native.list).toHaveBeenLastCalledWith({ query: `RunId="${firstId}"`, pageSize: 1 });
		expect(native.getHandle).toHaveBeenLastCalledWith("notice-pipeline-workflow", ids[0], {
			followRuns: false,
		});
	});
	it("reads current Kubernetes task runs directly and checks their owner", async () => {
		native.readJob.mockResolvedValue({
			metadata: { ownerReferences: [{ kind: "CronJob", name: "document-ocr" }] },
		});
		expect(await service().getRun("document-ocr", "old-job")).toMatchObject({
			id: "old-job",
			runId: null,
		});
		expect(await service().getRun("internal-portal-credential-checker", "old-job")).toBeNull();
	});
});

it("keeps only actual child runs, while preserving skipped and failed schedules across visibility pages", async () => {
	const execution = (runId: string, type: string, parent?: string) => ({
		workflowId: runId,
		runId,
		type,
		status: { name: "COMPLETED" },
		startTime: new Date(),
		closeTime: new Date(),
		...(parent ? { parentExecution: { workflowId: parent, runId: parent } } : {}),
	});
	native.list.mockImplementation(async function* () {
		yield execution("wrapper", "noticePipelineScheduled");
		yield execution("skipped", "noticePipelineScheduled");
		yield { ...execution("start-failed", "noticePipelineScheduled"), status: { name: "FAILED" } };
		for (let index = 0; index < 17; index++) {
			yield execution(`manual-${index}`, "noticePipelineRun");
		}
		yield execution("child", "noticePipelineRun", "wrapper");
	});
	native.getHandle.mockImplementation((_workflowId, runId) => ({
		describe: async () => ({ status: { name: "FAILED" }, raw: { pendingActivities: [] } }),
		fetchHistory: async () => ({
			events:
				runId === "wrapper"
					? [
							{
								childWorkflowExecutionStartedEventAttributes: {
									workflowExecution: { workflowId: "child", runId: "child" },
								},
							},
						]
					: [],
		}),
		result: async () => {
			if (runId === "start-failed") {
				throw new Error("Unable to start child");
			}
			return { outcome: runId === "skipped" ? "skipped" : "success" };
		},
	}));
	const runs = await service().runs("notice-pipeline");
	expect(runs).toHaveLength(20);
	expect(runs.map((run) => run.id)).not.toContain("wrapper");
	expect(runs.find((run) => run.id === "child")).toMatchObject({
		parentExecution: { runId: "wrapper" },
	});
	expect(runs.find((run) => run.id === "skipped")).toMatchObject({ outcome: "skipped" });
	expect(runs.find((run) => run.id === "start-failed")).toMatchObject({
		outcome: "failed",
		error: "Unable to start child",
	});
});
it.each([
	[
		{ succeeded: 1, failed: 1, conditions: [{ type: "Complete", status: "True" }] },
		"succeeded",
		"success",
	],
	[
		{ active: 1, conditions: [{ type: "Failed", status: "True", message: "deadline" }] },
		"failed",
		"failed",
	],
	[{ active: 1, failed: 1 }, "running", "unknown"],
	[{}, "pending", "unknown"],
])(
	"uses the same Kubernetes status in list and detail: %j",
	async (status, expectedStatus, outcome) => {
		const job = {
			metadata: { name: "ocr-run", ownerReferences: [{ kind: "CronJob", name: "document-ocr" }] },
			status,
		};
		native.readJob.mockResolvedValue(job);
		native.listJobs.mockResolvedValue({ items: [job] });
		const detail = await service().getRun("document-ocr", "ocr-run");
		expect(detail).toMatchObject({ status: expectedStatus, outcome });
		expect(await service().runs("document-ocr")).toEqual([detail]);
	},
);

it("exposes actual activity scheduling state even before the first heartbeat", async () => {
	const execution = {
		workflowId: "notice-pipeline-workflow",
		runId: "waiting-run",
		type: "noticePipelineRun",
		status: { name: "RUNNING" },
		startTime: new Date("2026-10-03T14:00:00Z"),
	};
	native.list.mockImplementation(async function* () {
		yield execution;
	});
	native.getHandle.mockReturnValue({
		fetchHistory: async () => ({ events: [] }),
		describe: async () => ({
			status: { name: "RUNNING" },
			raw: {
				pendingActivities: [
					{
						activityType: { name: "collectNotices" },
						state: 1,
						attempt: 1,
						lastHeartbeatTime: null,
						heartbeatDetails: { payloads: [] },
					},
				],
			},
		}),
	});
	const runs = await service().runs("notice-pipeline");
	expect(runs[0]?.stages).toMatchObject([
		{
			id: "collectNotices",
			counts: {},
			activity: { state: "waiting", attempt: 1, lastHeartbeatAt: null },
		},
	]);
});
