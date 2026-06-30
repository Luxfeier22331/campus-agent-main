import type {
	IngestionArtifactRef,
	IngestionTaskEnvelope,
	IngestionTaskRecord,
	IngestionTaskRegistry,
	IngestionTaskRegistryTask,
	IngestionTaskStore,
} from "./types";

export interface TsTaskHandlerResult {
	artifactRefs?: IngestionArtifactRef[];
}

export type TsTaskHandler = (
	task: IngestionTaskRecord,
	registryTask: IngestionTaskRegistryTask,
) => Promise<TsTaskHandlerResult>;

export type RustKernelHandler = (task: IngestionTaskRecord) => Promise<TsTaskHandlerResult>;

export interface TsTaskHandlerIdentity {
	sourceFamily: string;
	corpus: string;
	collection: string;
	taskKind: IngestionTaskEnvelope["task_kind"];
}

export class TsTaskHandlerRegistry {
	readonly #handlers = new Map<string, TsTaskHandler>();

	register(identity: TsTaskHandlerIdentity, handler: TsTaskHandler): void {
		const key = tsTaskHandlerIdentityKey(identity);
		if (this.#handlers.has(key)) {
			throw new Error(`TS task handler already registered: ${key}`);
		}
		this.#handlers.set(key, handler);
	}

	require(task: IngestionTaskRecord): TsTaskHandler {
		const key = tsTaskHandlerIdentityKey({
			sourceFamily: task.source_family,
			corpus: task.corpus,
			collection: task.collection,
			taskKind: task.task_kind,
		});
		const handler = this.#handlers.get(key);
		if (!handler) {
			throw new TsTaskHandlerNotRegisteredError({
				taskKind: task.task_kind,
				key,
			});
		}
		return handler;
	}
}

export class TsTaskHandlerNotRegisteredError extends Error {
	readonly taskKind: IngestionTaskEnvelope["task_kind"];
	readonly key: string;

	constructor(input: { taskKind: IngestionTaskEnvelope["task_kind"]; key: string }) {
		super(`TS task handler not registered: ${input.key}`);
		this.taskKind = input.taskKind;
		this.key = input.key;
	}
}

function tsTaskHandlerIdentityKey(identity: TsTaskHandlerIdentity): string {
	return [identity.sourceFamily, identity.corpus, identity.collection, identity.taskKind].join("/");
}

export class RustKernelRegistry {
	readonly #handlers = new Map<string, RustKernelHandler>();

	register(kernelId: string, handler: RustKernelHandler): void {
		if (this.#handlers.has(kernelId)) {
			throw new Error(`Rust kernel already registered: ${kernelId}`);
		}
		this.#handlers.set(kernelId, handler);
	}

	require(kernelId: string): RustKernelHandler {
		const handler = this.#handlers.get(kernelId);
		if (!handler) {
			throw new RustKernelNotRegisteredError(kernelId);
		}
		return handler;
	}
}

export class RustKernelNotRegisteredError extends Error {
	readonly kernelId: string;

	constructor(kernelId: string) {
		super(`Rust kernel not registered: ${kernelId}`);
		this.kernelId = kernelId;
	}
}

export class RustKernelIdMissingError extends Error {
	readonly taskKind: IngestionTaskEnvelope["task_kind"];

	constructor(taskKind: IngestionTaskEnvelope["task_kind"]) {
		super(`Rust kernel id missing for task kind: ${taskKind}`);
		this.taskKind = taskKind;
	}
}

export class RegistryTaskNotDeclaredError extends Error {
	readonly taskKind: IngestionTaskEnvelope["task_kind"];

	constructor(taskKind: IngestionTaskEnvelope["task_kind"]) {
		super(`task is not declared by ingestion registry: ${taskKind}`);
		this.taskKind = taskKind;
	}
}

export class RegistryTaskContractMismatchError extends Error {
	readonly taskKind: IngestionTaskEnvelope["task_kind"];

	constructor(input: {
		taskKind: IngestionTaskEnvelope["task_kind"];
		expectedOutputContract: string;
		actualOutputContract: string;
	}) {
		super(
			`output contract mismatch for ${input.taskKind}: expected ${input.expectedOutputContract}, got ${input.actualOutputContract}`,
		);
		this.taskKind = input.taskKind;
	}
}

export type ClaimedTaskRunResult =
	| { status: "idle"; task?: undefined }
	| { status: "completed" | "failed"; task: IngestionTaskRecord };

export async function runRegistryTaskOnce(input: {
	store: IngestionTaskStore;
	registry: IngestionTaskRegistry;
	tsHandlers: TsTaskHandlerRegistry;
	rustKernels: RustKernelRegistry;
	workerId: string;
}): Promise<ClaimedTaskRunResult> {
	const task = await input.store.claimNextTask({ workerId: input.workerId });
	if (!task) {
		return { status: "idle" };
	}
	try {
		const registryTask = requireRegistryTask(input.registry, task);
		requireTaskContracts(task, registryTask);
		const result =
			registryTask.executor_kind === "ts_control"
				? await input.tsHandlers.require(task)(task, registryTask)
				: await runRustKernelTask({
						task,
						registryTask,
						rustKernels: input.rustKernels,
					});
		const completed = await input.store.completeTask({
			taskId: task.task_id,
			workerId: input.workerId,
			artifactRefs: result.artifactRefs ?? [],
		});
		return { status: "completed", task: completed };
	} catch (error) {
		const failed = await input.store.failTask({
			taskId: task.task_id,
			workerId: input.workerId,
			errorCode: taskExecutorErrorCode(error),
			errorMessage: error instanceof Error ? error.message : "ingestion registry task failed",
		});
		return { status: "failed", task: failed };
	}
}

function requireRegistryTask(
	registry: IngestionTaskRegistry,
	task: IngestionTaskRecord,
): IngestionTaskRegistryTask {
	if (
		registry.source_family !== task.source_family ||
		registry.corpus !== task.corpus ||
		registry.collection !== task.collection
	) {
		throw new RegistryTaskNotDeclaredError(task.task_kind);
	}
	const registryTask = registry.tasks.find((candidate) => candidate.task_kind === task.task_kind);
	if (!registryTask) {
		throw new RegistryTaskNotDeclaredError(task.task_kind);
	}
	return registryTask;
}

function requireTaskContracts(
	task: IngestionTaskRecord,
	registryTask: IngestionTaskRegistryTask,
): void {
	if (task.output_contract !== registryTask.output_contract) {
		throw new RegistryTaskContractMismatchError({
			taskKind: task.task_kind,
			expectedOutputContract: registryTask.output_contract,
			actualOutputContract: task.output_contract,
		});
	}
}

async function runRustKernelTask(input: {
	task: IngestionTaskRecord;
	registryTask: IngestionTaskRegistryTask;
	rustKernels: RustKernelRegistry;
}): Promise<TsTaskHandlerResult> {
	if (!input.registryTask.kernel_id) {
		throw new RustKernelIdMissingError(input.task.task_kind);
	}
	return input.rustKernels.require(input.registryTask.kernel_id)(input.task);
}

function taskExecutorErrorCode(error: unknown): string {
	if (error instanceof RegistryTaskNotDeclaredError) {
		return "registry_task_not_declared";
	}
	if (error instanceof RegistryTaskContractMismatchError) {
		return "registry_task_contract_mismatch";
	}
	if (error instanceof TsTaskHandlerNotRegisteredError) {
		return "ts_handler_not_registered";
	}
	if (error instanceof RustKernelIdMissingError) {
		return "rust_kernel_id_missing";
	}
	if (error instanceof RustKernelNotRegisteredError) {
		return "rust_kernel_not_registered";
	}
	return "task_executor_failed";
}
