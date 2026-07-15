import type {
	IngestionTaskExecutionSnapshot,
	IngestionTaskRegistryTask,
	IngestionTaskResult,
} from "ingestion-contracts";

export type RustKernelHandler = (
	snapshot: IngestionTaskExecutionSnapshot,
	options?: { activityAttempt?: number; signal?: AbortSignal },
) => Promise<IngestionTaskResult>;

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

export function assertRustKernelRegistryCoversTasks(
	tasks: readonly IngestionTaskRegistryTask[],
	registry: RustKernelRegistry,
): void {
	const missing = tasks
		.filter((task) => task.executor_kind === "rust_kernel")
		.filter((task) => !(task.kernel_id && registry.has(task.kernel_id)))
		.map((task) => `${task.registry_task_id}:${task.kernel_id || "missing-kernel-id"}`)
		.sort();
	if (missing.length > 0) {
		throw new Error(`ingestion worker is missing registry Rust kernels: ${missing.join(", ")}`);
	}
}

export function requireRustKernelId(snapshot: IngestionTaskExecutionSnapshot): string {
	if (snapshot.registry_task.executor_kind !== "rust_kernel") {
		throw new Error(
			`registry task ${snapshot.registry_task.registry_task_id} is not a Rust kernel task`,
		);
	}
	const kernelId = snapshot.registry_task.kernel_id?.trim();
	if (!kernelId) {
		throw new Error(`Rust kernel id missing for ${snapshot.registry_task.registry_task_id}`);
	}
	return kernelId;
}
