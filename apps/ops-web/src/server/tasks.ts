import { BatchV1Api, KubeConfig } from "@kubernetes/client-node";
import {
	Client,
	Connection,
	WorkflowExecutionAlreadyStartedError,
	type WorkflowExecutionInfo,
	WorkflowNotFoundError,
} from "@temporalio/client";
import type { Pool } from "pg";
import type { OpsTask, TaskId, TaskRun, TaskScheduleInput } from "../shared/tasks-contract.ts";

const maintenanceWorkflowId = "notice-pipeline-workflow";
const ragTypes = ["noticePipelineRun", "noticePipelineRollback", "noticePipelineScheduled"];
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
					query:
						'WorkflowType IN ("noticePipelineRun", "noticePipelineRollback", "noticePipelineScheduled")',
					pageSize: 20,
				})) {
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
				.map((job) => ({
					id: String(job.metadata?.name),
					workflowId: null,
					runId: null,
					status: job.status?.active
						? "running"
						: job.status?.succeeded
							? "succeeded"
							: job.status?.failed
								? "failed"
								: "pending",
					outcome: job.status?.failed ? ("failed" as const) : ("unknown" as const),
					startedAt: job.status?.startTime?.toISOString() ?? null,
					completedAt: job.status?.completionTime?.toISOString() ?? null,
					error:
						job.status?.conditions?.find((condition) => condition.type === "Failed")?.message ??
						null,
					details: job.status,
				}));
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
						if (!ragTypes.includes(execution.type)) {
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
				return {
					id: runId,
					workflowId: null,
					runId: null,
					status: job.status?.active
						? "running"
						: job.status?.succeeded
							? "succeeded"
							: job.status?.failed
								? "failed"
								: "pending",
					outcome: job.status?.failed ? "failed" : "unknown",
					startedAt: job.status?.startTime?.toISOString() ?? null,
					completedAt: job.status?.completionTime?.toISOString() ?? null,
					error:
						job.status?.conditions?.find((condition) => condition.type === "Failed")?.message ??
						null,
					details: job.status,
				};
			} catch (error) {
				if (error && typeof error === "object" && "code" in error && error.code === 404) {
					return null;
				}
				throw error;
			}
		},
		async rollback() {
			if (!input.pool) {
				throw new TaskError("索引目录数据库暂不可用");
			}
			const target = await input.pool.query(`SELECT c.collection AS expected_current,
				c.previous_collection AS collection
				FROM campus_docs_serving.current_index c
				JOIN campus_docs_serving.index_versions current_version ON current_version.collection=c.collection
				JOIN campus_docs_serving.index_versions v ON v.collection=c.previous_collection
				WHERE c.singleton AND current_version.validated AND v.validated`);
			const row = target.rows[0];
			if (!row) {
				throw new TaskError("没有可回滚的已验证上一版本", 409);
			}
			const args = {
				expectedCurrent: row.expected_current,
				collection: row.collection,
			};
			return temporal(async (client) => {
				const schedule = client.schedule.getHandle("notice-pipeline");
				await schedule.pause("Paused for index rollback");
				return startMaintenance(client, "noticePipelineRollback", [args]);
			});
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
			throw new TaskError("索引刷新或回滚正在运行，请等待本轮结束", 409);
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
	if (execution.status.name === "RUNNING") {
		const description = await handle.describe();
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
		} catch (failure) {
			if (failure instanceof WorkflowNotFoundError) {
				throw failure;
			}
			error = message(failure);
		}
	}
	return {
		id: execution.runId,
		workflowId: execution.workflowId,
		runId: execution.runId,
		status: execution.status.name.toLowerCase(),
		outcome:
			details?.outcome ??
			(execution.status.name === "COMPLETED" && execution.type === "noticePipelineRollback"
				? details?.noOp || details?.obsolete
					? "skipped"
					: "success"
				: execution.status.name === "FAILED"
					? "failed"
					: "unknown"),
		startedAt: execution.startTime.toISOString(),
		completedAt: execution.closeTime?.toISOString() ?? null,
		error,
		details,
	};
}
