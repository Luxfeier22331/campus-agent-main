import type {
	IngestionArtifactRef,
	IngestionTaskEnvelope,
	IngestionTaskRegistry,
	IngestionTaskRegistryTask,
} from "ingestion-contracts";

export interface TsTaskHandlerResult {
	artifactRefs?: IngestionArtifactRef[];
}

export type TsTaskHandler = (
	task: IngestionTaskEnvelope,
	registryTask: IngestionTaskRegistryTask,
) => Promise<TsTaskHandlerResult>;

export type RustKernelHandler = (task: IngestionTaskEnvelope) => Promise<TsTaskHandlerResult>;

export interface IngestionHandlerIdentity {
	sourceFamily: string;
	corpus: string;
	collection: string;
	registryTaskId: string;
}

export type TsTaskHandlerIdentity = IngestionHandlerIdentity;

export class TsTaskHandlerRegistry {
	readonly #handlers = new Map<
		string,
		{ handler: TsTaskHandler; identity: TsTaskHandlerIdentity }
	>();

	register(identity: TsTaskHandlerIdentity, handler: TsTaskHandler): void {
		const key = ingestionHandlerIdentityKey(identity);
		if (this.#handlers.has(key)) {
			throw new Error(`TS task handler already registered: ${key}`);
		}
		this.#handlers.set(key, { handler, identity: { ...identity } });
	}

	has(identity: TsTaskHandlerIdentity): boolean {
		return this.#handlers.has(ingestionHandlerIdentityKey(identity));
	}

	registeredIdentities(): TsTaskHandlerIdentity[] {
		return [...this.#handlers.values()].map((entry) => ({ ...entry.identity }));
	}

	require(task: IngestionTaskEnvelope): TsTaskHandler {
		const key = ingestionHandlerIdentityKey({
			sourceFamily: task.source_family,
			corpus: task.corpus,
			collection: task.collection,
			registryTaskId: task.registry_task_id,
		});
		const handler = this.#handlers.get(key);
		if (!handler) {
			throw new TsTaskHandlerNotRegisteredError({
				registryTaskId: task.registry_task_id,
				key,
			});
		}
		return handler.handler;
	}
}

export class TsTaskHandlerNotRegisteredError extends Error {
	readonly registryTaskId: string;
	readonly key: string;

	constructor(input: { registryTaskId: string; key: string }) {
		super(`TS task handler not registered: ${input.key}`);
		this.registryTaskId = input.registryTaskId;
		this.key = input.key;
	}
}

export class RustKernelRegistry {
	readonly #handlers = new Map<string, RustKernelHandler>();

	register(kernelId: string, handler: RustKernelHandler): void {
		if (this.#handlers.has(kernelId)) {
			throw new Error(`Rust kernel already registered: ${kernelId}`);
		}
		this.#handlers.set(kernelId, handler);
	}

	has(kernelId: string): boolean {
		return this.#handlers.has(kernelId);
	}

	registeredKernelIds(): string[] {
		return [...this.#handlers.keys()];
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
	readonly registryTaskId: string;

	constructor(registryTaskId: string) {
		super(`Rust kernel id missing for registry task: ${registryTaskId}`);
		this.registryTaskId = registryTaskId;
	}
}

export class RegistryTaskNotDeclaredError extends Error {
	readonly registryTaskId: string;

	constructor(registryTaskId: string) {
		super(`task is not declared by ingestion registry: ${registryTaskId}`);
		this.registryTaskId = registryTaskId;
	}
}

export class RegistryTaskContractMismatchError extends Error {
	readonly registryTaskId: string;

	constructor(input: {
		registryTaskId: string;
		expectedInputContract: string;
		actualInputContract: string;
		expectedOutputContract: string;
		actualOutputContract: string;
	}) {
		super(
			`contract mismatch for ${input.registryTaskId}: expected ${input.expectedInputContract} -> ${input.expectedOutputContract}, got ${input.actualInputContract} -> ${input.actualOutputContract}`,
		);
		this.registryTaskId = input.registryTaskId;
	}
}

export class TaskInputRefNotObjectStoreError extends Error {
	readonly inputRefKind: IngestionTaskEnvelope["input_ref"]["kind"];

	constructor(inputRefKind: IngestionTaskEnvelope["input_ref"]["kind"]) {
		super(`input_ref must be object_store, got ${inputRefKind}`);
		this.inputRefKind = inputRefKind;
	}
}

export async function runDeclaredIngestionTask(input: {
	registry: IngestionTaskRegistry;
	rustKernels: RustKernelRegistry;
	task: IngestionTaskEnvelope;
	tsHandlers: TsTaskHandlerRegistry;
}): Promise<TsTaskHandlerResult> {
	const registryTask = requireRegistryTask(input.registry, input.task);
	requireTaskContracts(input.task, registryTask);
	requireObjectStoreInputRef(input.task);
	switch (registryTask.executor_kind) {
		case "ts_control":
			return input.tsHandlers.require(input.task)(input.task, registryTask);
		case "rust_kernel":
			return runRustKernelTask({
				task: input.task,
				registryTask,
				rustKernels: input.rustKernels,
			});
		default: {
			const exhaustiveCheck: never = registryTask.executor_kind;
			throw new Error(`unsupported executor kind: ${exhaustiveCheck}`);
		}
	}
}

export function ingestionTaskExecutionErrorCode(error: unknown): string {
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
	if (error instanceof TaskInputRefNotObjectStoreError) {
		return "task_input_ref_not_object_store";
	}
	return "ingestion_task_execution_failed";
}

export function ingestionTaskExecutionErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "ingestion registry task failed";
}

function requireRegistryTask(
	registry: IngestionTaskRegistry,
	task: IngestionTaskEnvelope,
): IngestionTaskRegistryTask {
	if (
		registry.source_family !== task.source_family ||
		registry.corpus !== task.corpus ||
		registry.collection !== task.collection
	) {
		throw new RegistryTaskNotDeclaredError(task.registry_task_id);
	}
	const registryTask = registry.tasks.find(
		(candidate) => candidate.registry_task_id === task.registry_task_id,
	);
	if (!registryTask) {
		throw new RegistryTaskNotDeclaredError(task.registry_task_id);
	}
	return registryTask;
}

function requireTaskContracts(
	task: IngestionTaskEnvelope,
	registryTask: IngestionTaskRegistryTask,
): void {
	if (
		task.task_kind !== registryTask.task_kind ||
		task.input_contract !== registryTask.input_contract ||
		task.output_contract !== registryTask.output_contract
	) {
		throw new RegistryTaskContractMismatchError({
			registryTaskId: task.registry_task_id,
			expectedInputContract: registryTask.input_contract,
			actualInputContract: task.input_contract,
			expectedOutputContract: registryTask.output_contract,
			actualOutputContract: task.output_contract,
		});
	}
}

function requireObjectStoreInputRef(task: IngestionTaskEnvelope): void {
	if (task.input_ref.kind !== "object_store") {
		throw new TaskInputRefNotObjectStoreError(task.input_ref.kind);
	}
}

async function runRustKernelTask(input: {
	task: IngestionTaskEnvelope;
	registryTask: IngestionTaskRegistryTask;
	rustKernels: RustKernelRegistry;
}): Promise<TsTaskHandlerResult> {
	if (!input.registryTask.kernel_id) {
		throw new RustKernelIdMissingError(input.task.registry_task_id);
	}
	return input.rustKernels.require(input.registryTask.kernel_id)(input.task);
}

function ingestionHandlerIdentityKey(identity: IngestionHandlerIdentity): string {
	return [
		identity.sourceFamily,
		identity.corpus,
		identity.collection,
		identity.registryTaskId,
	].join("/");
}
