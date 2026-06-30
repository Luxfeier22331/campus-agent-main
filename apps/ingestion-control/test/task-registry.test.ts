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

		expect(registryPaths.length).toBeGreaterThanOrEqual(1);
		for (const registryPath of registryPaths) {
			const rawRegistry = JSON.parse(readFileSync(registryPath, "utf8")) as {
				tasks?: Array<{ executor_kind?: unknown }>;
			};
			expect(rawRegistry.tasks?.some((task) => task.executor_kind === "python_adapter")).toBe(
				false,
			);

			const registry = loadIngestionTaskRegistryFromFile(registryPath);

			expect(registry.tasks).not.toHaveLength(0);
			expect(
				registry.tasks.some((task) =>
					[
						"canonical_document_materialize",
						"operator_projection_snapshot",
						"structured_projection_publish",
					].includes(task.task_kind),
				),
			).toBe(false);
		}
	});

	it("declares authenticated internal notice materialization from capture release artifacts", () => {
		const registry = loadIngestionTaskRegistryFromFile(
			join(registryRoot, "campus_notices", "internal_notice", "task-registry.v1.json"),
		);

		expect(
			registry.tasks.find((task) => task.task_kind === "source_truth_materialize"),
		).toMatchObject({
			executor_kind: "ts_control",
			input_contract: "authenticated_notice_capture_release.v1",
			output_contract: "authenticated_notice_source_truth.v1",
		});
	});

	it("declares official-web source truth materialization from source-truth bundle artifacts", () => {
		const stableReference = loadIngestionTaskRegistryFromFile(
			join(registryRoot, "official_web", "stable_reference", "task-registry.v1.json"),
		);
		const freshNews = loadIngestionTaskRegistryFromFile(
			join(registryRoot, "official_web", "fresh_news", "task-registry.v1.json"),
		);

		expect(
			stableReference.tasks.find((task) => task.task_kind === "source_truth_materialize"),
		).toMatchObject({
			executor_kind: "ts_control",
			input_contract: "official_web_source_truth_bundle.v1",
			output_contract: "official_web_stable_reference_source_truth.v1",
		});
		expect(
			freshNews.tasks.find((task) => task.task_kind === "source_truth_materialize"),
		).toMatchObject({
			executor_kind: "ts_control",
			input_contract: "official_web_source_truth_bundle.v1",
			output_contract: "official_web_fresh_news_source_truth.v1",
		});
	});
});
