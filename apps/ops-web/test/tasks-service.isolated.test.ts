// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
	patch: vi.fn(),
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
	getJob: vi.fn(),
}));
vi.mock("@kubernetes/client-node", () => ({
	BatchV1Api: class {},
	KubeConfig: class {
		loadFromCluster() {
			/* Fake cluster credentials for service behavior tests. */
		}
		makeApiClient() {
			return { patchNamespacedCronJob: native.patch, readNamespacedJob: native.readJob };
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

function service() {
	return createTaskService({
		local: false,
		namespace: "staging",
		env: {},
		pool: { query: native.query },
		jobs: { list: async () => [], create: vi.fn(), get: native.getJob } as never,
		collection: { update: vi.fn() } as never,
	});
}
beforeEach(() => {
	vi.resetAllMocks();
	native.list.mockImplementation(async function* () {
		/* No running workflows. */
	});
	native.describe.mockResolvedValue({ info: { runningActions: [] } });
	native.start.mockResolvedValue({
		workflowId: "campus-rag-refresh-workflow",
		firstExecutionRunId: "run-1",
	});
	native.query.mockResolvedValue({
		rows: [
			{
				expected_current: `campus_docs_${"b".repeat(64)}`,
				docs_embedding_set: `sha256:${"a".repeat(64)}`,
				notice_embedding_set: `sha256:${"c".repeat(64)}`,
				producer: "automatic",
				producer_run_id: "original-run",
			},
		],
	});
});
describe("native task ownership", () => {
	it("patches only schedule and suspend on the selected CronJob", async () => {
		await service().update("notice-classifier", { enabled: true, intervalMinutes: 15 });
		expect(native.patch).toHaveBeenCalledWith({
			name: "notice-classifier",
			namespace: "staging",
			body: [
				{ op: "add", path: "/spec/suspend", value: false },
				{ op: "add", path: "/spec/schedule", value: "*/15 * * * *" },
			],
		});
		await expect(
			service().update("document-ocr", { enabled: true, intervalMinutes: 15 }),
		).rejects.toMatchObject({ status: 409 });
		expect(native.patch).toHaveBeenCalledTimes(1);
	});
	it("preserves Temporal action and policies when the operator changes timing", async () => {
		const existing = {
			action: { workflowType: "campusRagRefresh" },
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
		await service().update("campus-rag-refresh", { enabled: true, intervalMinutes: 15 });
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
			workflowId: "campus-rag-refresh-workflow",
			runId: "run-1",
		});
		expect(native.start).toHaveBeenCalledWith(
			"campusRagRollback",
			expect.objectContaining({
				taskQueue: "campus-rag",
				workflowId: "campus-rag-refresh-workflow",
				workflowIdConflictPolicy: "FAIL",
				workflowIdReusePolicy: "ALLOW_DUPLICATE",
				args: [
					{
						expectedCurrent: `campus_docs_${"b".repeat(64)}`,
						docsEmbeddingSet: `sha256:${"a".repeat(64)}`,
						noticeEmbeddingSet: `sha256:${"c".repeat(64)}`,
						producer: "automatic",
						producerRunId: "original-run",
					},
				],
			}),
		);
		expect(native.update).not.toHaveBeenCalled();
		await service().run("campus-rag-refresh");
		expect(native.start).toHaveBeenLastCalledWith(
			"campusRagRefresh",
			expect.objectContaining({
				workflowId: "campus-rag-refresh-workflow",
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
			workflowId: "campus-rag-refresh-workflow",
			runId,
			type: "campusRagRollback",
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
		expect((await service().runs("campus-rag-refresh")).map((run) => run.id)).toEqual(ids);
		expect(await service().getRun("campus-rag-refresh", firstId)).toMatchObject({
			id: firstId,
			runId: firstId,
			details: { collection: ids[0] },
		});
		expect(native.list).toHaveBeenLastCalledWith({ query: `RunId="${firstId}"`, pageSize: 1 });
		expect(native.getHandle).toHaveBeenLastCalledWith("campus-rag-refresh-workflow", ids[0], {
			followRuns: false,
		});
	});
	it("reads old Kubernetes runs directly and checks their owner", async () => {
		native.readJob.mockResolvedValue({
			metadata: { ownerReferences: [{ kind: "CronJob", name: "document-ocr" }] },
		});
		expect(await service().getRun("document-ocr", "old-job")).toMatchObject({
			id: "old-job",
			runId: null,
		});
		expect(await service().getRun("internal-portal-credential-checker", "old-job")).toBeNull();
		native.getJob.mockResolvedValue({
			jobName: "old-notice-job",
			operation: "notice-sync",
			status: "succeeded",
		});
		expect(await service().getRun("notice-sync", "old-notice-job")).toMatchObject({
			id: "old-notice-job",
		});
		expect(await service().getRun("notice-classifier", "old-notice-job")).toBeNull();
	});
});
