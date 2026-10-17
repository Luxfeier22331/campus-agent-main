import { BatchV1Api, KubeConfig, type V1Job } from "@kubernetes/client-node";
import {
	Client,
	Connection,
	WorkflowExecutionAlreadyStartedError,
	type WorkflowExecutionInfo,
	WorkflowNotFoundError,
} from "@temporalio/client";
import type { Pool } from "pg";
import type { OpsTask, TaskId, TaskRun, TaskScheduleInput } from "../shared/tasks-contract.ts";

import { projectTaskStages } from "./task-stages.ts";

import { projectTemporalStages, taskFailureMessage } from "./temporal-task-stages.ts";

const maintenanceWorkflowId = "notice-pipeline-workflow";
const pipelineTypes = ["noticePipelineRun", "noticePipelineScheduled"];
const directory: {
	id: TaskId;
	label: string;
	cron?: string;
}[] = [
	{ id: "notice-pipeline", label: "通知采集与 RAG 流水线" },
	{ id: "document-ocr", label: "OCR 扫描", cron: "document-ocr" },
	{
		id: "internal-portal-credential-checker",
		label: "门户凭据检查",
		cron: "ops-web-internal-portal-check",
	},
];
export class TaskError extends Error {
	readonly status: 404 | 409 | 503;
	constructor(message: string, status: 404 | 409 | 503 = 503) {
		super(message);
		this.status = status;
	}
}
export function createTaskService(input: {
	local: boolean;
	namespace: string;
	env: { TEMPORAL_ADDRESS?: string; TEMPORAL_NAMESPACE?: string };
	pool?: Pick<Pool, "query">;
}) {
	const batch = () => {
		const config = new KubeConfig();
		config.loadFromCluster();
		return config.makeApiClient(BatchV1Api);
	};
	const temporal = async <T>(run: (client: Client) => Promise<T>) => {
		const connection = await Connection.connect({
			address: input.env.TEMPORAL_ADDRESS ?? "temporal:7233",
		});
		try {
			return await run(
				new Client({ connection, namespace: input.env.TEMPORAL_NAMESPACE ?? "default" }),
			);
		} finally {
			await connection.close();
		}
	};
	const definition = (id: TaskId) => {
		const task = directory.find((item) => item.id === id);
		if (!task) {
			throw new TaskError("任务不存在", 404);
		}
		return task;
	};
	const runs = async (id: TaskId): Promise<TaskRun[]> => {
		const task = definition(id);
		if (id === "notice-pipeline") {
			return temporal(async (client) => {
				const result: TaskRun[] = [];
				for await (const execution of client.workflow.list({
					query: 'WorkflowType IN ("noticePipelineRun", "noticePipelineScheduled")',
					pageSize: 20,
				})) {
					// Scheduled wrappers with a started child are represented by that child.
					// Read the wrapper history so a child outside this visibility page is not lost.
					if (execution.type === "noticePipelineScheduled") {
						const history = await client.workflow
							.getHandle(execution.workflowId, execution.runId, { followRuns: false })
							.fetchHistory();
						if (
							history.events?.some((event) => event.childWorkflowExecutionStartedEventAttributes)
						) {
							continue;
						}
					}
					result.push(await temporalRun(client, execution));
					if (result.length >= 20) {
						break;
					}
				}
				return result;
			});
		}
		if (input.local) {
			return [];
		}
		if (task.cron) {
			const jobs = await batch().listNamespacedJob({ namespace: input.namespace });
			return (jobs.items ?? [])
				.filter((job) =>
					job.metadata?.ownerReferences?.some(
						(owner) =>
							owner.kind === "CronJob" && owner.name === task.cron && Boolean(job.metadata?.name),
					),
				)
				.sort(
					(left, right) =>
						(right.metadata?.creationTimestamp?.getTime() ?? 0) -
						(left.metadata?.creationTimestamp?.getTime() ?? 0),
				)
				.slice(0, 20)
				.map((job) => kubernetesRun(job, String(job.metadata?.name)));
		}
		return [];
	};
	const list = async (): Promise<OpsTask[]> =>
		Promise.all(
			directory.map(async (task) => {
				const value: OpsTask = {
					id: task.id,
					label: task.label,
					runtime: task.cron ? "kubernetes" : "temporal",
					canSchedule: !task.cron,
					canRun: !task.cron,
					enabled: null,
					intervalMinutes: null,
					schedule: null,
					running: false,
					runs: [],
					error: null,
				};
				try {
					if (task.cron && !input.local) {
						const cron = await batch().readNamespacedCronJob({
							name: task.cron,
							namespace: input.namespace,
						});
						value.enabled = !cron.spec?.suspend;
						value.schedule = cron.spec?.schedule ?? null;
						value.running = Boolean(cron.status?.active?.length);
					} else if (!task.cron) {
						await temporal(async (client) => {
							const schedule = await client.schedule.getHandle(task.id).describe();
							value.enabled = !schedule.state.paused;
							value.intervalMinutes = (schedule.spec.intervals?.[0]?.every ?? 0) / 60_000;
							value.schedule = `${value.intervalMinutes} min`;
							value.running = schedule.info.runningActions.length > 0;
						});
					}
					value.runs = await runs(task.id);
					value.running ||= value.runs.some(
						(run) => run.status === "running" || run.status === "pending",
					);
				} catch (error) {
					value.error = message(error);
				}
				return value;
			}),
		);
	return {
		list,
		runs,
		async getRun(id: TaskId, runId: string): Promise<TaskRun | null> {
			const task = definition(id);
			if (id === "notice-pipeline") {
				if (!/^[a-f0-9-]{36}$/i.test(runId)) {
					return null;
				}
				return temporal(async (client) => {
					for await (const execution of client.workflow.list({
						query: `RunId="${runId}"`,
						pageSize: 1,
					})) {
						if (!pipelineTypes.includes(execution.type)) {
							return null;
						}
						try {
							return await temporalRun(client, execution);
						} catch (error) {
							if (error instanceof WorkflowNotFoundError) {
								return null;
							}
							throw error;
						}
					}
					return null;
				});
			}
			if (input.local) {
				return null;
			}
			try {
				const job = await batch().readNamespacedJob({ name: runId, namespace: input.namespace });
				if (
					!job.metadata?.ownerReferences?.some(
						(owner) => owner.kind === "CronJob" && owner.name === task.cron,
					)
				) {
					return null;
				}
				return kubernetesRun(job, runId);
			} catch (error) {
				if (error && typeof error === "object" && "code" in error && error.code === 404) {
					return null;
				}
				throw error;
			}
		},
		async update(id: TaskId, value: TaskScheduleInput) {
			const task = definition(id);
			if (task.cron) {
				throw new TaskError("此任务的调度设置只读", 409);
			}
			return temporal(async (client) => {
				await client.schedule.getHandle(id).update((existing) => ({
					...existing,
					spec: { intervals: [{ every: value.intervalMinutes * 60_000 }] },
					state: { ...existing.state, paused: !value.enabled },
				}));
			});
		},
		async run(id: TaskId) {
			definition(id);
			if (id === "notice-pipeline") {
				return temporal(async (client) => startMaintenance(client, "noticePipelineRun", []));
			}
			throw new TaskError("此任务不支持从任务页运行", 409);
		},
	};
}
function message(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
async function startMaintenance(client: Client, type: string, args: unknown[]) {
	try {
		const handle = await client.workflow.start(type, {
			taskQueue: "notice-pipeline",
			workflowId: maintenanceWorkflowId,
			workflowIdConflictPolicy: "FAIL",
			workflowIdReusePolicy: "ALLOW_DUPLICATE",
			workflowExecutionTimeout: "4 hours",
			args,
		});
		return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
	} catch (error) {
		if (error instanceof WorkflowExecutionAlreadyStartedError) {
			throw new TaskError("通知流水线正在运行，请等待本轮结束", 409);
		}
		throw error;
	}
}

async function temporalRun(client: Client, execution: WorkflowExecutionInfo): Promise<TaskRun> {
	const handle = client.workflow.getHandle(execution.workflowId, execution.runId, {
		followRuns: false,
	});
	let details: {
		activities?: unknown[];
		outcome?: TaskRun["outcome"];
		noOp?: boolean;
		obsolete?: boolean;
	} | null = null;
	let error: string | null = null;
	let stages: TaskRun["stages"] = [];
	if (execution.status.name === "RUNNING") {
		const description = await handle.describe();
		stages = projectTemporalStages(client, await handle.fetchHistory(), description);
		details = {
			activities:
				description.raw.pendingActivities?.map((activity) => ({
					type: activity.activityType?.name,
					attempt: activity.attempt,
					lastHeartbeatTime: activity.lastHeartbeatTime,
					progress:
						activity.heartbeatDetails?.payloads?.map((payload) =>
							client.workflow.options.loadedDataConverter.payloadConverter.fromPayload(payload),
						) ?? [],
					lastFailure: activity.lastFailure?.message,
				})) ?? [],
		};
	} else {
		try {
			details = (await handle.result()) as typeof details;
			stages = projectTaskStages(details);
		} catch (failure) {
			if (failure instanceof WorkflowNotFoundError) {
				throw failure;
			}
			error = taskFailureMessage(failure);
			const description = await handle.describe();
			stages = projectTemporalStages(client, await handle.fetchHistory(), description);
		}
	}
	return {
		id: execution.runId,
		workflowId: execution.workflowId,
		runId: execution.runId,
		status: execution.status.name.toLowerCase(),
		outcome:
			details?.outcome ??
			(["FAILED", "CANCELLED", "CANCELED", "TERMINATED", "TIMED_OUT"].includes(
				execution.status.name,
			)
				? "failed"
				: "unknown"),
		startedAt: execution.startTime.toISOString(),
		completedAt: execution.closeTime?.toISOString() ?? null,
		error,
		details,
		stages,
		...(execution.parentExecution ? { parentExecution: execution.parentExecution } : {}),
	};
}

function kubernetesRun(job: V1Job, id: string): TaskRun {
	const conditions = job.status?.conditions ?? [];
	const complete = conditions.some((c) => c.type === "Complete" && c.status === "True");
	const failed = conditions.find((c) => c.type === "Failed" && c.status === "True");
	const status = complete
		? "succeeded"
		: failed
			? "failed"
			: job.status?.active
				? "running"
				: job.status?.succeeded
					? "succeeded"
					: job.status?.failed
						? "failed"
						: "pending";
	return {
		id,
		workflowId: null,
		runId: null,
		status,
		outcome: status === "succeeded" ? "success" : status === "failed" ? "failed" : "unknown",
		startedAt: job.status?.startTime?.toISOString() ?? null,
		completedAt: job.status?.completionTime?.toISOString() ?? null,
		error: failed?.message ?? null,
		details: job.status,
		stages: [],
	};
}
