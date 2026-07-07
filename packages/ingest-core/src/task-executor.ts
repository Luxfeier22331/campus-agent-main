import type { IngestionTaskRegistry, IngestionTaskRegistryTask } from "ingestion-contracts";
import defaultExecutorInventory from "./default-executor-inventory.v1.json" with { type: "json" };

export interface IngestionHandlerIdentity {
	sourceFamily: string;
	corpus: string;
	collection: string;
	registryTaskId: string;
}

export type TsTaskHandlerIdentity = IngestionHandlerIdentity;

export interface DefaultExecutableTsTask extends TsTaskHandlerIdentity {
	inputContract: string;
	outputContract: string;
}

export interface DefaultExecutableRustKernel {
	inputContract: string;
	kernelId: string;
	outputContract: string;
}

export type IngestionTaskExecutabilityStatus = "executable" | "invalid_registry";

export interface IngestionTaskExecutabilityClassification {
	identity: string;
	executorKind: IngestionTaskRegistryTask["executor_kind"];
	status: IngestionTaskExecutabilityStatus;
}

export interface IngestionTaskExecutabilityIssue extends IngestionTaskExecutabilityClassification {
	message: string;
}

export const DEFAULT_EXECUTABLE_RUST_KERNELS =
	defaultExecutorInventory.rust_kernels as readonly DefaultExecutableRustKernel[];

export const DEFAULT_EXECUTABLE_RUST_KERNEL_IDS = DEFAULT_EXECUTABLE_RUST_KERNELS.map(
	(kernel) => kernel.kernelId,
);

export type DefaultExecutableRustKernelId = string;

export const DEFAULT_EXECUTABLE_TS_TASKS =
	defaultExecutorInventory.ts_tasks as readonly DefaultExecutableTsTask[];

export const DEFAULT_EXECUTABLE_TS_TASK_IDENTITIES: readonly TsTaskHandlerIdentity[] =
	DEFAULT_EXECUTABLE_TS_TASKS.map(({ inputContract, outputContract, ...identity }) => identity);

export function isDefaultTsTaskExecutable(identity: TsTaskHandlerIdentity): boolean {
	return Boolean(defaultTsTaskForIdentity(identity));
}

export function isDefaultRustKernelExecutable(
	kernelId: string,
): kernelId is DefaultExecutableRustKernelId {
	return Boolean(defaultRustKernelForId(kernelId));
}

export function classifyIngestionRegistryTaskExecutability(input: {
	registry: Pick<IngestionTaskRegistry, "source_family" | "corpus" | "collection">;
	task: IngestionTaskRegistryTask;
}): IngestionTaskExecutabilityClassification {
	const taskIdentity: TsTaskHandlerIdentity = {
		sourceFamily: input.registry.source_family,
		corpus: input.registry.corpus,
		collection: input.registry.collection,
		registryTaskId: input.task.registry_task_id,
	};
	if (input.task.executor_kind === "ts_control") {
		const defaultTask = defaultTsTaskForIdentity(taskIdentity);
		return {
			identity: ingestionHandlerIdentityKey(taskIdentity),
			executorKind: input.task.executor_kind,
			status:
				defaultTask &&
				defaultTask.inputContract === input.task.input_contract &&
				defaultTask.outputContract === input.task.output_contract
					? "executable"
					: "invalid_registry",
		};
	}
	if (input.task.executor_kind === "rust_kernel") {
		const kernelId = input.task.kernel_id;
		const defaultKernel = kernelId ? defaultRustKernelForId(kernelId) : undefined;
		return {
			identity: kernelId ? `rust_kernel:${kernelId}` : ingestionHandlerIdentityKey(taskIdentity),
			executorKind: input.task.executor_kind,
			status:
				defaultKernel &&
				defaultKernel.inputContract === input.task.input_contract &&
				defaultKernel.outputContract === input.task.output_contract
					? "executable"
					: "invalid_registry",
		};
	}
	return {
		identity: ingestionHandlerIdentityKey(taskIdentity),
		executorKind: input.task.executor_kind,
		status: "invalid_registry",
	};
}

export function auditIngestionRegistryExecutability(
	registries: readonly IngestionTaskRegistry[],
): IngestionTaskExecutabilityIssue[] {
	return registries.flatMap((registry) =>
		registry.tasks.flatMap((task) => {
			const classification = classifyIngestionRegistryTaskExecutability({
				registry,
				task,
			});
			if (classification.status === "executable") {
				return [];
			}
			return [
				{
					...classification,
					message: registryExecutabilityIssueMessage(task, classification),
				},
			];
		}),
	);
}

function ingestionHandlerIdentityKey(identity: IngestionHandlerIdentity): string {
	return [
		identity.sourceFamily,
		identity.corpus,
		identity.collection,
		identity.registryTaskId,
	].join("/");
}

function registryExecutabilityIssueMessage(
	task: IngestionTaskRegistryTask,
	classification: IngestionTaskExecutabilityClassification,
): string {
	switch (task.executor_kind) {
		case "ts_control":
			if (defaultTsTaskForIdentityKey(classification.identity)) {
				return "registry-declared ts_control task contract does not match default handler";
			}
			return "registry-declared ts_control task has no default handler";
		case "rust_kernel":
			if (!task.kernel_id) {
				return "registry-declared rust_kernel task is missing kernel_id";
			}
			if (defaultRustKernelForId(task.kernel_id)) {
				return "registry-declared rust_kernel task contract does not match default kernel bridge";
			}
			return "registry-declared rust_kernel task has no default kernel bridge";
		default: {
			const exhaustiveCheck: never = task.executor_kind;
			return `unsupported ingestion task executor_kind: ${String(exhaustiveCheck)}`;
		}
	}
}

function defaultTsTaskForIdentity(
	identity: TsTaskHandlerIdentity,
): DefaultExecutableTsTask | undefined {
	return defaultTsTaskForIdentityKey(ingestionHandlerIdentityKey(identity));
}

function defaultTsTaskForIdentityKey(identityKey: string): DefaultExecutableTsTask | undefined {
	return DEFAULT_EXECUTABLE_TS_TASKS.find(
		(candidate) => ingestionHandlerIdentityKey(candidate) === identityKey,
	);
}

function defaultRustKernelForId(kernelId: string): DefaultExecutableRustKernel | undefined {
	return DEFAULT_EXECUTABLE_RUST_KERNELS.find((candidate) => candidate.kernelId === kernelId);
}
