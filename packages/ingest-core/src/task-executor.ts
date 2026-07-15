import type { IngestionTaskRegistry, IngestionTaskRegistryTask } from "ingestion-contracts";
import defaultExecutorInventory from "./default-executor-inventory.v1.json" with { type: "json" };

export interface DefaultExecutableSourceCollectorTask {
	registryTaskId: string;
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

export const DEFAULT_EXECUTABLE_SOURCE_COLLECTOR_TASKS =
	defaultExecutorInventory.source_collectors as readonly DefaultExecutableSourceCollectorTask[];

export const DEFAULT_EXECUTABLE_SOURCE_COLLECTOR_TASK_IDS =
	DEFAULT_EXECUTABLE_SOURCE_COLLECTOR_TASKS.map((task) => task.registryTaskId);

export const DEFAULT_EXECUTABLE_RUST_KERNELS =
	defaultExecutorInventory.rust_kernels as readonly DefaultExecutableRustKernel[];

export const DEFAULT_EXECUTABLE_RUST_KERNEL_IDS = DEFAULT_EXECUTABLE_RUST_KERNELS.map(
	(kernel) => kernel.kernelId,
);

export type DefaultExecutableRustKernelId = string;

export function isDefaultSourceCollectorExecutable(registryTaskId: string): boolean {
	return Boolean(defaultSourceCollectorForId(registryTaskId));
}

export function isDefaultRustKernelExecutable(
	kernelId: string,
): kernelId is DefaultExecutableRustKernelId {
	return Boolean(defaultRustKernelForId(kernelId));
}

export function classifyIngestionRegistryTaskExecutability(input: {
	registry: IngestionTaskRegistry;
	task: IngestionTaskRegistryTask;
}): IngestionTaskExecutabilityClassification {
	void input.registry;
	if (input.task.executor_kind === "source_collector") {
		const declared = defaultSourceCollectorForId(input.task.registry_task_id);
		return {
			identity: input.task.registry_task_id,
			executorKind: input.task.executor_kind,
			status:
				declared &&
				declared.inputContract === input.task.input_contract &&
				declared.outputContract === input.task.output_contract
					? "executable"
					: "invalid_registry",
		};
	}
	const kernelId = input.task.kernel_id;
	const declared = kernelId ? defaultRustKernelForId(kernelId) : undefined;
	return {
		identity: kernelId ? `rust_kernel:${kernelId}` : input.task.registry_task_id,
		executorKind: input.task.executor_kind,
		status:
			declared &&
			declared.inputContract === input.task.input_contract &&
			declared.outputContract === input.task.output_contract
				? "executable"
				: "invalid_registry",
	};
}

export function auditIngestionRegistryExecutability(
	registries: readonly IngestionTaskRegistry[],
): IngestionTaskExecutabilityIssue[] {
	return registries.flatMap((registry) =>
		registry.tasks.flatMap((task) => {
			const classification = classifyIngestionRegistryTaskExecutability({ registry, task });
			if (classification.status === "executable") {
				return [];
			}
			return [{ ...classification, message: registryExecutabilityIssueMessage(task) }];
		}),
	);
}

function registryExecutabilityIssueMessage(task: IngestionTaskRegistryTask): string {
	if (task.executor_kind === "source_collector") {
		return defaultSourceCollectorForId(task.registry_task_id)
			? "registry-declared source collector contract does not match its handler"
			: "registry-declared source collector task has no handler";
	}
	if (!task.kernel_id) {
		return "registry-declared rust kernel task is missing kernel_id";
	}
	return defaultRustKernelForId(task.kernel_id)
		? "registry-declared rust kernel contract does not match its bridge"
		: "registry-declared rust kernel task has no bridge";
}

function defaultSourceCollectorForId(
	registryTaskId: string,
): DefaultExecutableSourceCollectorTask | undefined {
	return DEFAULT_EXECUTABLE_SOURCE_COLLECTOR_TASKS.find(
		(candidate) => candidate.registryTaskId === registryTaskId,
	);
}

function defaultRustKernelForId(kernelId: string): DefaultExecutableRustKernel | undefined {
	return DEFAULT_EXECUTABLE_RUST_KERNELS.find((candidate) => candidate.kernelId === kernelId);
}
