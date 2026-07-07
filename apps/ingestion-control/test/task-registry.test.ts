import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	loadIngestionTaskRegistryCatalogFromRoot,
	loadIngestionTaskRegistryFromFile,
} from "../src/index.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const registryRoot = join(repoRoot, "configs", "ingestion");

function listTaskRegistries(root: string): string[] {
	const entries = readdirSync(root, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) {
			return listTaskRegistries(path);
		}
		return entry.name === "task-registry.v2.json" ? [path] : [];
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
			join(registryRoot, "campus_notices", "internal_notice", "task-registry.v2.json"),
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
			join(registryRoot, "official_web", "stable_reference", "task-registry.v2.json"),
		);
		const freshNews = loadIngestionTaskRegistryFromFile(
			join(registryRoot, "official_web", "fresh_news", "task-registry.v2.json"),
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

	it("declares authenticated file-release source materialization from file-release export artifacts", () => {
		const registry = loadIngestionTaskRegistryFromFile(
			join(registryRoot, "authenticated_documents", "file_release_source", "task-registry.v2.json"),
		);

		expect(
			registry.tasks.find((task) => task.task_kind === "source_truth_materialize"),
		).toMatchObject({
			executor_kind: "ts_control",
			input_contract: "internal_portal_file_release_export_v1",
			output_contract: "authenticated_document_file_release_source_truth.v1",
		});
	});

	it("fails closed when a registry declares a task without default executor support", () => {
		const root = mkdtempSync(join(tmpdir(), "ingestion-registry-invalid-"));
		const registryPath = join(root, "custom", "collection", "task-registry.v2.json");
		mkdirForFile(registryPath);
		writeFileSync(
			registryPath,
			JSON.stringify({
				schema_version: "ingestion_task_registry.v2",
				source_family: "custom_family",
				corpus: "custom",
				collection: "collection",
				tasks: [
					{
						registry_task_id: "custom_source_truth_materialize",
						task_kind: "source_truth_materialize",
						executor_kind: "ts_control",
						input_contract: "custom_source_truth_bundle.v1",
						output_contract: "custom_source_truth.v1",
					},
				],
			}),
		);

		expect(() => loadIngestionTaskRegistryCatalogFromRoot(root)).toThrow(
			"registry-declared ts_control task has no default handler",
		);
	});
});

function mkdirForFile(path: string): void {
	const directory = path.slice(0, path.lastIndexOf("/"));
	mkdirSync(directory, { recursive: true });
}
