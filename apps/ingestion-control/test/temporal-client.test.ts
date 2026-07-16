import { canonicalJsonSha256Digest } from "ingest-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testSnapshot } from "./fixtures";

const temporal = vi.hoisted(() => {
	class AlreadyStartedError extends Error {}
	class NotFoundError extends Error {}
	return {
		AlreadyStartedError,
		NotFoundError,
		close: vi.fn(async () => undefined),
		connect: vi.fn(),
		getSystemInfo: vi.fn(async () => ({})),
		getHandle: vi.fn(),
		scheduleDescribe: vi.fn(),
		scheduleGetHandle: vi.fn(),
		scheduleUnpause: vi.fn(async () => undefined),
		start: vi.fn(),
		withDeadline: vi.fn(async (_deadline: number, operation: () => Promise<unknown>) =>
			operation(),
		),
	};
});

vi.mock("@temporalio/client", () => ({
	Client: class {
		readonly schedule = { getHandle: temporal.scheduleGetHandle };
		readonly workflow = { getHandle: temporal.getHandle, start: temporal.start };
	},
	Connection: {
		connect: temporal.connect,
	},
	ScheduleNotFoundError: temporal.NotFoundError,
	WorkflowExecutionAlreadyStartedError: temporal.AlreadyStartedError,
}));

import { createTemporalIngestionWorkflowStarter } from "../src/temporal-client";

const config = {
	address: "temporal.example:7233",
	controlActivityTaskQueue: "ingestion.control",
	namespace: "campus-agent",
	rustKernelActivityTaskQueue: "ingestion.rust",
	sourceCollectorActivityTaskQueue: "ingestion.source",
	workflowTaskQueue: "ingestion.workflow",
};

describe("Temporal ingestion workflow starter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		temporal.connect.mockResolvedValue({
			close: temporal.close,
			workflowService: { getSystemInfo: temporal.getSystemInfo },
			withDeadline: temporal.withDeadline,
		});
		temporal.getHandle.mockReturnValue({
			describe: vi.fn(async () => ({
				memo: { canonical_snapshot_digest: canonicalJsonSha256Digest(testSnapshot()) },
				runId: "temporal-run-existing",
				status: { code: 1, name: "RUNNING" },
			})),
		});
		temporal.scheduleDescribe.mockResolvedValue({
			info: {
				nextActionTimes: [new Date("2026-07-16T00:30:00.000Z")],
				recentActions: [],
			},
			state: { paused: false },
		});
		temporal.scheduleGetHandle.mockReturnValue({
			describe: temporal.scheduleDescribe,
			unpause: temporal.scheduleUnpause,
		});
	});

	it("rejects task workflow id reuse and freezes every task queue in start input", async () => {
		temporal.start.mockResolvedValue({
			firstExecutionRunId: "temporal-run-001",
			workflowId: "ingestion/task-curriculum-chunk-001",
		});
		const starter = await createTemporalIngestionWorkflowStarter(config);

		await expect(starter.startTask(testSnapshot())).resolves.toEqual({
			alreadyStarted: false,
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-001",
			workflowStatus: "RUNNING",
		});
		expect(temporal.start).toHaveBeenCalledWith(
			expect.any(Function),
			expect.objectContaining({
				taskQueue: "ingestion.workflow",
				workflowId: "ingestion/task-curriculum-chunk-001",
				workflowIdReusePolicy: "REJECT_DUPLICATE",
			}),
		);
		expect(temporal.start.mock.calls[0]?.[1]?.args[0]).toMatchObject({
			controlActivityTaskQueue: "ingestion.control",
			rustKernelActivityTaskQueue: "ingestion.rust",
			sourceCollectorActivityTaskQueue: "ingestion.source",
		});
		expect(temporal.start.mock.calls[0]?.[1]?.memo).toEqual({
			canonical_snapshot_digest: canonicalJsonSha256Digest(testSnapshot()),
		});
		await starter.checkReady();
		expect(temporal.getSystemInfo).toHaveBeenCalledWith({});
		expect(temporal.withDeadline).toHaveBeenCalledTimes(2);
	});

	it("treats a running or closed duplicate task as the same durable task", async () => {
		temporal.start.mockRejectedValue(new temporal.AlreadyStartedError("duplicate"));
		const starter = await createTemporalIngestionWorkflowStarter(config);

		await expect(starter.startTask(testSnapshot())).resolves.toEqual({
			alreadyStarted: true,
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-existing",
			workflowStatus: "RUNNING",
		});
		expect(temporal.getHandle).toHaveBeenCalledWith("ingestion/task-curriculum-chunk-001");
	});

	it("rejects a duplicate workflow when its frozen snapshot memo differs or is missing", async () => {
		temporal.start.mockRejectedValue(new temporal.AlreadyStartedError("duplicate"));
		temporal.getHandle.mockReturnValue({
			describe: vi.fn(async () => ({
				memo: { canonical_snapshot_digest: `sha256:${"0".repeat(64)}` },
				runId: "temporal-run-existing",
				status: { code: 1, name: "RUNNING" },
			})),
		});
		const starter = await createTemporalIngestionWorkflowStarter(config);

		await expect(starter.startTask(testSnapshot())).rejects.toMatchObject({
			name: "IngestionWorkflowIdentityConflictError",
			taskId: "task-curriculum-chunk-001",
			workflowId: "ingestion/task-curriculum-chunk-001",
		});
	});

	it("reads the fixed maintenance workflow result and resumes its schedule", async () => {
		temporal.scheduleDescribe.mockResolvedValue({
			info: {
				nextActionTimes: [new Date("2026-07-16T00:30:00.000Z")],
				recentActions: [
					{
						action: {
							type: "startWorkflow",
							workflow: { firstExecutionRunId: "run-auth-1", workflowId: "auth-run-1" },
						},
						takenAt: new Date("2026-07-16T00:00:00.000Z"),
					},
				],
			},
			state: { paused: true },
		});
		temporal.getHandle.mockReturnValue({
			describe: vi.fn(async () => ({ status: { name: "COMPLETED" } })),
			result: vi.fn(async () => ({
				completedAt: "2026-07-16T00:00:03.000Z",
				errorCode: null,
				lastSuccessAt: "2026-07-16T00:00:02.000Z",
				noticeProbeSucceeded: true,
				outcome: "success",
				portalSessionEstablished: true,
				schemaVersion: "internal_portal_auth_maintenance.v1",
				serviceTicketIssued: true,
				startedAt: "2026-07-16T00:00:00.000Z",
			})),
		});
		const starter = await createTemporalIngestionWorkflowStarter(config);

		await expect(starter.getInternalPortalAuthMaintenanceStatus?.()).resolves.toMatchObject({
			lastOutcome: "SUCCESS",
			lastSuccessAt: "2026-07-16T00:00:02.000Z",
			scheduleState: "PAUSED",
			serviceTicketIssued: true,
		});
		await starter.resumeInternalPortalAuthMaintenance?.();
		expect(temporal.scheduleUnpause).toHaveBeenCalledWith("credential replaced through Ops Web");
	});

	it("maps a credential-expired workflow failure to a paused maintenance status", async () => {
		temporal.scheduleDescribe.mockResolvedValue({
			info: {
				nextActionTimes: [],
				recentActions: [
					{
						action: {
							type: "startWorkflow",
							workflow: { firstExecutionRunId: "run-auth-expired", workflowId: "auth-run-expired" },
						},
						takenAt: new Date("2026-07-16T01:00:00.000Z"),
					},
				],
			},
			state: { paused: true },
		});
		temporal.getHandle.mockReturnValue({
			describe: vi.fn(async () => ({ status: { name: "FAILED" } })),
			result: vi.fn(async () => {
				throw new Error("workflow failed", {
					cause: {
						details: [
							{
								errorCode: "internal_portal_credential_expired",
								failedAt: "2026-07-16T01:00:02.000Z",
								lastSuccessAt: "2026-07-16T00:30:02.000Z",
								startedAt: "2026-07-16T01:00:00.000Z",
							},
						],
						type: "internal_portal_credential_expired",
					},
				});
			}),
		});
		const starter = await createTemporalIngestionWorkflowStarter(config);

		await expect(starter.getInternalPortalAuthMaintenanceStatus?.()).resolves.toMatchObject({
			errorCode: "internal_portal_credential_expired",
			lastAttemptAt: "2026-07-16T01:00:00.000Z",
			lastOutcome: "CREDENTIAL_EXPIRED",
			lastSuccessAt: "2026-07-16T00:30:02.000Z",
			nextRunAt: null,
			noticeProbeSucceeded: false,
			portalSessionEstablished: false,
			scheduleState: "PAUSED",
			serviceTicketIssued: false,
		});
	});
});
