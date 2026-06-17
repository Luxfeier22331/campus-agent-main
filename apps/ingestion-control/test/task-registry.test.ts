import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIngestionTaskRegistryFromFile } from "../src/index.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const registryRoot = join(repoRoot, "configs", "ingestion");

function listTaskRegistries(root: string): string[] {
	const entries = readdirSync(root, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			return listTaskRegistries(path);
		}
		return entry.name === "task-registry.v1.json" ? [path] : [];
	});
}

describe("ingestion-control task registry loading", () => {
	it("loads every repo registry without python adapter executors", () => {
		const registryPaths = listTaskRegistries(registryRoot);

		expect(registryPaths.length).toBeGreaterThanOrEqual(2);
		for (const registryPath of registryPaths) {
			const rawRegistry = JSON.parse(readFileSync(registryPath, "utf8")) as {
				tasks?: Array<{ executor_kind?: unknown }>;
			};
			expect(rawRegistry.tasks?.some((task) => task.executor_kind === "python_adapter")).toBe(
				false,
			);

			const registry = loadIngestionTaskRegistryFromFile(registryPath);

			const aliasTask = registry.tasks.find((task) => task.task_kind === "alias_publish");
			if (aliasTask) {
				expect(aliasTask.executor_kind).toBe("ts_control");
			}
		}
	});
});
