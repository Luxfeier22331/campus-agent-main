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

import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
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
	it("uses atomic start conflict after pausing, without visibility admission", async () => {
		native.start.mockRejectedValue(new WorkflowExecutionAlreadyStartedError("busy", "id", "type"));
		await expect(service().rollback()).rejects.toMatchObject({ status: 409 });
		expect(native.pause).toHaveBeenCalledTimes(1);
		expect(native.start).toHaveBeenCalledTimes(1);
		expect(native.list).not.toHaveBeenCalled();
		expect(native.close).toHaveBeenCalledTimes(1);
	});
	it("pins rollback inputs and uses the same atomic ID for manual refresh", async () => {
		expect(await service().rollback()).toEqual({
			workflowId: "notice-pipeline-workflow",
			runId: "run-1",
		});
		expect(native.start).toHaveBeenCalledWith(
			"noticePipelineRollback",
			expect.objectContaining({
				taskQueue: "notice-pipeline",
				workflowId: "notice-pipeline-workflow",
				workflowIdConflictPolicy: "FAIL",
				workflowIdReusePolicy: "ALLOW_DUPLICATE",
				args: [
					{
						expectedCurrent: `campus_docs_${"b".repeat(64)}`,
						collection: `campus_docs_${"a".repeat(64)}`,
					},
				],
			}),
		);
		expect(native.update).not.toHaveBeenCalled();
		await service().run("notice-pipeline");
		expect(native.start).toHaveBeenLastCalledWith(
			"noticePipelineRun",
			expect.objectContaining({
				workflowId: "notice-pipeline-workflow",
				workflowIdConflictPolicy: "FAIL",
				args: [],
			}),
		);
		expect(native.trigger).not.toHaveBeenCalled();
	});
	it("does not pause when no validated rollback target exists", async () => {
		native.query.mockResolvedValue({ rows: [] });
		await expect(service().rollback()).rejects.toMatchObject({ status: 409 });
		expect(native.pause).not.toHaveBeenCalled();
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
			type: "noticePipelineRollback",
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
			result: async () => ({ collection: runId, noOp: false }),
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
