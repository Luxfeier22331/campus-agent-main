import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateIngestionTaskRegistry } from "ingestion-contracts";

import type {
	IngestionTaskEnvelope,
	IngestionTaskRegistry,
	IngestionTaskRegistryTask,
} from "./types";

export function loadIngestionTaskRegistryFromFile(path: string): IngestionTaskRegistry {
	const payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
	const validation = validateIngestionTaskRegistry(payload);
	if (!validation.ok) {
		throw new Error(`invalid ingestion task registry: ${validation.errors.join("; ")}`);
	}
	return payload as IngestionTaskRegistry;
}

export function loadIngestionTaskRegistryCatalogFromRoot(
	root: string,
): IngestionTaskRegistryCatalog {
	return createIngestionTaskRegistryCatalog(
		listIngestionTaskRegistryFiles(root).map(loadIngestionTaskRegistryFromFile),
	);
}

export function listIngestionTaskRegistryFiles(root: string): string[] {
	const entries = readdirSync(root, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			return listIngestionTaskRegistryFiles(path);
		}
		return entry.name === "task-registry.v1.json" ? [path] : [];
	});
}

export class IngestionTaskRegistryCatalog {
	readonly #registries = new Map<string, IngestionTaskRegistry>();

	constructor(registries: readonly IngestionTaskRegistry[]) {
		for (const registry of registries) {
			const key = registryKey({
				source_family: registry.source_family,
				corpus: registry.corpus,
				collection: registry.collection,
			});
			if (this.#registries.has(key)) {
				throw new Error(`duplicate ingestion task registry: ${key}`);
			}
			this.#registries.set(key, registry);
		}
	}

	requireTask(task: IngestionTaskEnvelope): IngestionTaskRegistryTask {
		const { registryTask } = this.#requireRegistryTask(task);
		if (task.output_contract !== registryTask.output_contract) {
			throw new RegistryAdmissionError(
				`output contract mismatch for ${task.task_kind}: expected ${registryTask.output_contract}, got ${task.output_contract}`,
			);
		}
		return registryTask;
	}

	requireRegistry(task: IngestionTaskEnvelope): IngestionTaskRegistry {
		return this.#requireRegistryTask(task).registry;
	}

	#requireRegistryTask(task: IngestionTaskEnvelope): {
		key: string;
		registry: IngestionTaskRegistry;
		registryTask: IngestionTaskRegistryTask;
	} {
		const key = registryKey(task);
		const registry = this.#registries.get(key);
		if (!registry) {
			throw new RegistryAdmissionError(
				`task collection is not declared by ingestion registry: ${key}`,
			);
		}
		const registryTask = registry.tasks.find((candidate) => candidate.task_kind === task.task_kind);
		if (!registryTask) {
			throw new RegistryAdmissionError(
				`task is not declared by ingestion registry: ${key}/${task.task_kind}`,
			);
		}
		return { key, registry, registryTask };
	}
}

export class RegistryAdmissionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RegistryAdmissionError";
	}
}

export function createIngestionTaskRegistryCatalog(
	registries: readonly IngestionTaskRegistry[],
): IngestionTaskRegistryCatalog {
	return new IngestionTaskRegistryCatalog(registries);
}

function registryKey(input: { source_family: string; corpus: string; collection: string }): string {
	return [input.source_family, input.corpus, input.collection].join("/");
}
