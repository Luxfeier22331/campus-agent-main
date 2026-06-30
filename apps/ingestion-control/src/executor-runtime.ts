import type {
	ClaimedTaskRunResult,
	RustKernelRegistry,
	TsTaskHandlerRegistry,
} from "./task-executor";
import { runClaimedRegistryTask, TaskHeartbeatFailedError } from "./task-executor";
import type { IngestionTaskRegistryCatalog } from "./task-registry";
import type { ExpiredLeaseSweepResult, IngestionTaskStore } from "./types";

export interface IngestionExecutorRuntimeConfig {
	databaseUrl: string;
	pollIntervalMs: number;
	registryRoot: string;
	workerId: string;
}

export interface IngestionExecutorIterationInput {
	registryCatalog: IngestionTaskRegistryCatalog;
	rustKernels: RustKernelRegistry;
	store: IngestionTaskStore;
	tsHandlers: TsTaskHandlerRegistry;
	workerId: string;
}

export type IngestionExecutorIterationResult =
	| (ClaimedTaskRunResult & { sweep: ExpiredLeaseSweepResult })
	| { status: "idle"; sweep: ExpiredLeaseSweepResult };

export interface IngestionExecutorLoopInput extends IngestionExecutorIterationInput {
	pollIntervalMs: number;
	sleep?: (ms: number) => Promise<void>;
	stopSignal?: AbortSignal;
}

export function buildIngestionExecutorRuntimeConfig(
	env: Record<string, string | undefined>,
): IngestionExecutorRuntimeConfig {
	const pollIntervalMs = readPositiveInteger(env.INGESTION_EXECUTOR_POLL_INTERVAL_MS, 5000);
	return {
		databaseUrl: requiredEnv(env, "INGESTION_CONTROL_DATABASE_URL"),
		pollIntervalMs,
		registryRoot: requiredEnv(env, "INGESTION_TASK_REGISTRY_ROOT"),
		workerId: env.INGESTION_EXECUTOR_WORKER_ID?.trim() || defaultWorkerId(),
	};
}

export async function runIngestionExecutorIteration(
	input: IngestionExecutorIterationInput,
): Promise<IngestionExecutorIterationResult> {
	const sweep = await input.store.sweepExpiredLeases();
	const task = await input.store.claimNextTask({ workerId: input.workerId });
	if (!task) {
		return { status: "idle", sweep };
	}
	const heartbeat = startHeartbeat({
		heartbeatSeconds: task.lease_policy.heartbeat_seconds,
		store: input.store,
		taskId: task.task_id,
		workerId: input.workerId,
	});
	let result: ClaimedTaskRunResult;
	try {
		result = await runClaimedRegistryTask({
			registry: input.registryCatalog.requireRegistry(task),
			rustKernels: input.rustKernels,
			store: input.store,
			task,
			tsHandlers: input.tsHandlers,
			workerId: input.workerId,
			beforeComplete: () => {
				const error = heartbeat.error();
				if (error) {
					throw error;
				}
			},
		});
	} finally {
		heartbeat.stop();
	}
	return { ...result, sweep };
}

export async function runIngestionExecutorLoop(input: IngestionExecutorLoopInput): Promise<void> {
	const sleep = input.sleep ?? defaultSleep;
	while (!input.stopSignal?.aborted) {
		const result = await runIngestionExecutorIteration(input);
		if (result.status === "idle" && !input.stopSignal?.aborted) {
			await sleep(input.pollIntervalMs);
		}
	}
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function startHeartbeat(input: {
	heartbeatSeconds: number;
	store: IngestionTaskStore;
	taskId: string;
	workerId: string;
}): { error(): Error | null; stop(): void } {
	let heartbeatError: Error | null = null;
	const interval = setInterval(() => {
		void (async () => {
			await input.store.heartbeatTask({
				taskId: input.taskId,
				workerId: input.workerId,
			});
		})().catch((error: unknown) => {
			const message = error instanceof Error ? error.message : "ingestion task heartbeat failed";
			heartbeatError = new TaskHeartbeatFailedError(message);
		});
	}, input.heartbeatSeconds * 1000);
	return {
		error(): Error | null {
			return heartbeatError;
		},
		stop(): void {
			clearInterval(interval);
		},
	};
}

function defaultWorkerId(): string {
	return `ingestion-control-executor:${process.pid}`;
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

function readPositiveInteger(value: string | undefined, defaultValue: number): number {
	if (!value?.trim()) {
		return defaultValue;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error("ingestion executor interval env must be a positive integer");
	}
	return parsed;
}
