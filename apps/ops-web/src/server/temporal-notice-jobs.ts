import {
	Client,
	Connection,
	WorkflowExecutionAlreadyStartedError,
	type WorkflowExecutionDescription,
	WorkflowNotFoundError,
} from "@temporalio/client";
import {
	type NoticeJob,
	type NoticeJobCreate,
	NoticeJobCreateSchema,
} from "../shared/ops-contract.ts";
import {
	NoticeJobConflictError,
	type NoticeJobStore,
	NoticeJobUnavailableError,
	parseNoticeJobDiagnostics,
} from "./notice-jobs.ts";

const workflowId = "notice-pipeline-workflow";
type WithClient = <T>(run: (client: Client) => Promise<T>) => Promise<T>;

export function createTemporalNoticeJobStore(env: {
	TEMPORAL_ADDRESS?: string;
	TEMPORAL_NAMESPACE?: string;
}): NoticeJobStore {
	return new TemporalNoticeJobStore(async (run) => {
		let connection: Connection | undefined;
		try {
			connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS ?? "temporal:7233" });
			return await run(new Client({ connection, namespace: env.TEMPORAL_NAMESPACE ?? "default" }));
		} catch (error) {
			if (error instanceof NoticeJobConflictError || error instanceof NoticeJobUnavailableError) {
				throw error;
			}
			throw new NoticeJobUnavailableError("Temporal 通知任务接口暂不可用。", { cause: error });
		} finally {
			await connection?.close();
		}
	});
}

export function noticePipelineInput(input: NoticeJobCreate) {
	const modes = {
		"notice-sync": "sync",
		"notice-rescan": "rescan",
		"notice-backfill": "backfill",
		"notice-classify-missing": "classify-one",
		"notice-classify-one": "classify-one",
		"notice-publish-pending": "publish-one",
		"notice-publish-one": "publish-one",
		"notice-republish-one": "republish-one",
	} as const;
	return {
		mode: modes[input.operation],
		...("noticeId" in input ? { noticeIds: [input.noticeId] } : {}),
		...("from" in input ? { from: input.from, to: input.to } : {}),
		...("startDate" in input ? { startDate: input.startDate } : {}),
	};
}

export class TemporalNoticeJobStore implements NoticeJobStore {
	private readonly withClient: WithClient;
	constructor(withClient: WithClient) {
		this.withClient = withClient;
	}
	async findActive(): Promise<string | null> {
		return this.withClient(async (client) => {
			try {
				const run = await client.workflow.getHandle(workflowId).describe();
				return run.status.name === "RUNNING" ? run.runId : null;
			} catch (error) {
				if (error instanceof WorkflowNotFoundError) {
					return null;
				}
				throw error;
			}
		});
	}
	async create(input: NoticeJobCreate): Promise<NoticeJob> {
		return this.withClient(async (client) => {
			try {
				const handle = await client.workflow.start("noticePipelineRun", {
					workflowId,
					taskQueue: "notice-pipeline",
					workflowIdConflictPolicy: "FAIL",
					workflowIdReusePolicy: "ALLOW_DUPLICATE",
					workflowExecutionTimeout: "4 hours",
					args: [noticePipelineInput(input)],
					memo: { noticeJob: input, trigger: "manual" },
				});
				return await projectNoticeJob(client, await handle.describe());
			} catch (error) {
				if (error instanceof WorkflowExecutionAlreadyStartedError) {
					const running = await client.workflow.getHandle(workflowId).describe();
					throw new NoticeJobConflictError(running.runId);
				}
				throw error;
			}
		});
	}
	async get(runId: string): Promise<NoticeJob | null> {
		if (!/^[a-f0-9-]{36}$/i.test(runId)) {
			return null;
		}
		return this.withClient(async (client) => {
			try {
				const execution = await client.workflow
					.getHandle(workflowId, runId, { followRuns: false })
					.describe();
				return execution.type === "noticePipelineRun"
					? await projectNoticeJob(client, execution)
					: null;
			} catch (error) {
				if (error instanceof WorkflowNotFoundError) {
					return null;
				}
				throw error;
			}
		});
	}
	async list(): Promise<NoticeJob[]> {
		return this.withClient(async (client) => {
			const jobs: NoticeJob[] = [];
			for await (const execution of client.workflow.list({
				query: `WorkflowId="${workflowId}" AND WorkflowType="noticePipelineRun"`,
				pageSize: 50,
			})) {
				const description = await client.workflow
					.getHandle(workflowId, execution.runId, { followRuns: false })
					.describe();
				jobs.push(await projectNoticeJob(client, description));
				if (jobs.length === 50) {
					break;
				}
			}
			return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		});
	}
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export async function projectNoticeJob(
	client: Client,
	execution: WorkflowExecutionDescription,
): Promise<NoticeJob> {
	const handle = client.workflow.getHandle(workflowId, execution.runId, { followRuns: false });
	let input = NoticeJobCreateSchema.safeParse(execution.memo?.noticeJob);
	if (!input.success) {
		const history = await handle.fetchHistory();
		const payload =
			history.events?.[0]?.workflowExecutionStartedEventAttributes?.input?.payloads?.[0];
		const args = record(
			payload
				? client.workflow.options.loadedDataConverter.payloadConverter.fromPayload(payload)
				: undefined,
		);
		const noticeId = Array.isArray(args.noticeIds) ? args.noticeIds[0] : undefined;
		const operation =
			args.mode === "classify-one"
				? noticeId
					? "notice-classify-one"
					: "notice-classify-missing"
				: args.mode === "publish-one"
					? noticeId
						? "notice-publish-one"
						: "notice-publish-pending"
					: args.mode === "republish-one"
						? "notice-republish-one"
						: args.mode === "rescan"
							? "notice-rescan"
							: args.mode === "backfill"
								? "notice-backfill"
								: "notice-sync";
		input = NoticeJobCreateSchema.safeParse({
			operation,
			...(noticeId ? { noticeId } : {}),
			...(operation === "notice-rescan" ? { from: args.from, to: args.to } : {}),
			...(operation === "notice-backfill" ? { startDate: args.startDate } : {}),
		});
	}
	if (!input.success) {
		throw new NoticeJobUnavailableError("Temporal 返回了无效的通知任务参数。");
	}
	const running = execution.status.name === "RUNNING";
	let result: Record<string, unknown> = {};
	let error: string | null = null;
	if (!running) {
		try {
			result = record(await handle.result());
		} catch (failure) {
			if (failure instanceof WorkflowNotFoundError) {
				throw failure;
			}
			error = failure instanceof Error ? failure.message : String(failure);
		}
	}
	const collection = record(result.collection);
	const summary = {
		...record(collection.summary),
		...record(result.classification),
		...record(result.publication),
		...record(record(result.files).summary),
		...(result.outcome ? { outcome: result.outcome } : {}),
	};
	const diagnostics = parseNoticeJobDiagnostics(
		JSON.stringify({
			summary,
			maintenanceRange: collection.maintenanceRange,
			processedRange: collection.processedRange,
		}),
	);
	for (const activity of execution.raw.pendingActivities ?? []) {
		for (const payload of activity.heartbeatDetails?.payloads ?? []) {
			const value = record(
				client.workflow.options.loadedDataConverter.payloadConverter.fromPayload(payload),
			);
			const progress = parseNoticeJobDiagnostics(
				JSON.stringify({
					progress: { phase: value.phase, processed: value.processed, total: value.total },
					processedRange: value.processedRange,
				}),
			);
			if (progress.progress) {
				diagnostics.progress = progress.progress;
			}
			if (progress.processedRange) {
				diagnostics.processedRange = progress.processedRange;
			}
		}
	}
	const completed = execution.status.name === "COMPLETED";
	return {
		jobName: execution.runId,
		operation: input.data.operation,
		noticeId: "noticeId" in input.data ? input.data.noticeId : null,
		createdAt: execution.startTime.toISOString(),
		startedAt: execution.startTime.toISOString(),
		completedAt: execution.closeTime?.toISOString() ?? null,
		trigger:
			execution.memo?.trigger === "scheduled" ||
			execution.raw.workflowExecutionInfo?.parentExecution
				? "scheduled"
				: "manual",
		status: running ? "running" : completed ? "succeeded" : "failed",
		...diagnostics,
		error,
		controllerError: error,
	};
}
