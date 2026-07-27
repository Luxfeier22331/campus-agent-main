import { canonicalJsonSha256Digest } from "ingest-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { testSnapshot } from "./fixtures";

const temporal = vi.hoisted(() => {
	class AlreadyStartedError extends Error {}
	return {
		AlreadyStartedError,
		close: vi.fn(async () => undefined),
		connect: vi.fn(),
		getSystemInfo: vi.fn(async () => ({})),
		getHandle: vi.fn(),
		start: vi.fn(),
		withDeadline: vi.fn(async (_deadline: number, operation: () => Promise<unknown>) =>
			operation(),
		),
	};
});

vi.mock("@temporalio/client", () => ({
	Client: class {
		readonly workflow = { getHandle: temporal.getHandle, start: temporal.start };
	},
	Connection: {
		connect: temporal.connect,
	},
	WorkflowExecutionAlreadyStartedError: temporal.AlreadyStartedError,
}));

import {
	createTemporalIngestionWorkflowStarter,
	internalPortalFileReleaseWorkflowId,
} from "../src/temporal-client";

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
	});

	it("rejects task workflow ID reuse and freezes the Rust task queues in start input", async () => {
		temporal.start.mockResolvedValue({
			firstExecutionRunId: "temporal-run-001",
			workflowId: "ingestion/task-curriculum-chunk-001",
		});
		const starter = await createTemporalIngestionWorkflowStarter(config);

		await expect(
			starter.startTask(testSnapshot(), { createdBy: "test:operator" }),
		).resolves.toEqual({
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
		});
		expect(temporal.start.mock.calls[0]?.[1]?.memo).toEqual({
			canonical_snapshot_digest: canonicalJsonSha256Digest(testSnapshot()),
		});
		await starter.checkReady();
		expect(temporal.getSystemInfo).toHaveBeenCalledWith({});
	});

	it("treats a duplicate task with the same frozen snapshot as the same durable task", async () => {
		temporal.start.mockRejectedValue(new temporal.AlreadyStartedError("duplicate"));
		const starter = await createTemporalIngestionWorkflowStarter(config);

		await expect(
			starter.startTask(testSnapshot(), { createdBy: "test:operator" }),
		).resolves.toEqual({
			alreadyStarted: true,
			workflowId: "ingestion/task-curriculum-chunk-001",
			workflowRunId: "temporal-run-existing",
			workflowStatus: "RUNNING",
		});
	});

	it("rejects a duplicate task when its frozen snapshot memo differs", async () => {
		temporal.start.mockRejectedValue(new temporal.AlreadyStartedError("duplicate"));
		temporal.getHandle.mockReturnValue({
			describe: vi.fn(async () => ({
				memo: { canonical_snapshot_digest: `sha256:${"0".repeat(64)}` },
				runId: "temporal-run-existing",
				status: { code: 1, name: "RUNNING" },
			})),
		});
		const starter = await createTemporalIngestionWorkflowStarter(config);

		await expect(
			starter.startTask(testSnapshot(), { createdBy: "test:operator" }),
		).rejects.toMatchObject({
			name: "IngestionWorkflowIdentityConflictError",
			taskId: "task-curriculum-chunk-001",
			workflowId: "ingestion/task-curriculum-chunk-001",
		});
	});

	it("uses request ID and file ID for an exact file-release workflow", async () => {
		temporal.start.mockResolvedValue({
			firstExecutionRunId: "file-run-646",
			workflowId: "ingestion/internal-portal-file-release/batch-001/646",
		});
		const starter = await createTemporalIngestionWorkflowStarter(config);
		const startInput = {
			createdBy: "ops@example.edu",
			fileReleaseId: 646,
			requestId: "batch-001",
		};

		await expect(starter.startInternalPortalFileRelease?.(startInput)).resolves.toEqual({
			alreadyStarted: false,
			workflowId: "ingestion/internal-portal-file-release/batch-001/646",
			workflowRunId: "file-run-646",
			workflowStatus: "RUNNING",
		});
		expect(temporal.start.mock.calls[0]?.[1]).toMatchObject({
			args: [{ fileReleaseId: 646, sourceCollectorActivityTaskQueue: "ingestion.source" }],
			memo: { created_by: "ops@example.edu" },
			workflowId: "ingestion/internal-portal-file-release/batch-001/646",
			workflowIdReusePolicy: "REJECT_DUPLICATE",
		});
		expect(internalPortalFileReleaseWorkflowId("batch-001", 646)).toBe(
			"ingestion/internal-portal-file-release/batch-001/646",
		);
	});

	it("treats a repeated request and file ID as the same capture", async () => {
		temporal.start.mockRejectedValue(new temporal.AlreadyStartedError("duplicate"));
		const starter = await createTemporalIngestionWorkflowStarter(config);

		await expect(
			starter.startInternalPortalFileRelease?.({
				createdBy: "another-operator@example.edu",
				fileReleaseId: 646,
				requestId: "batch-001",
			}),
		).resolves.toEqual({
			alreadyStarted: true,
			workflowId: "ingestion/internal-portal-file-release/batch-001/646",
			workflowRunId: "temporal-run-existing",
			workflowStatus: "RUNNING",
		});
	});

	it("describes current file-release workflow statuses", async () => {
		temporal.getHandle.mockImplementation((workflowId: string) => ({
			describe: async () => ({
				runId: `${workflowId}:run`,
				status: { name: workflowId.endsWith("/646") ? "COMPLETED" : "RUNNING" },
			}),
		}));
		const starter = await createTemporalIngestionWorkflowStarter(config);
		const workflowIds = [
			"ingestion/internal-portal-file-release/batch-001/646",
			"ingestion/internal-portal-file-release/batch-001/647",
		];

		await expect(starter.getInternalPortalFileReleaseStatuses?.(workflowIds)).resolves.toEqual([
			{
				workflowId: workflowIds[0],
				workflowRunId: `${workflowIds[0]}:run`,
				workflowStatus: "COMPLETED",
			},
			{
				workflowId: workflowIds[1],
				workflowRunId: `${workflowIds[1]}:run`,
				workflowStatus: "RUNNING",
			},
		]);
	});
});
