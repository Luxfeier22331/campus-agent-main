import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	listCollectionChunkProfileFiles,
	listIngestionTaskRegistryFiles,
	loadCollectionChunkProfilesFromRoot,
	loadIngestionTaskRegistryCatalogFromRoot,
	loadIngestionTaskRegistryFromFile,
} from "../src/node.ts";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

describe("ingest-core node registry loading", () => {
	it("loads every repository ingestion registry through the runtime catalog", () => {
		expect(() =>
			loadIngestionTaskRegistryCatalogFromRoot(join(repoRoot, "configs", "ingestion")),
		).not.toThrow();
	});

	it("loads registry files recursively and validates shape", () => {
		const root = mkdtempSync(join(tmpdir(), "ingest-core-registry-"));
		const registryDir = join(root, "sources");
		mkdirSync(registryDir, { recursive: true });
		const registryPath = join(registryDir, "task-registry.v3.json");
		writeFileSync(
			registryPath,
			JSON.stringify({
				schema_version: "ingestion_task_registry.v3",
				tasks: [
					{
						executor_kind: "rust_kernel",
						input_contract: "canonical_document_units.v1",
						kernel_id: "chunk-document-units",
						output_contract: "ingestion_chunk_set.v1",
						registry_task_id: "curriculum.curriculum_plan.chunk_prepare",
						target: { collection: "curriculum_plan", corpus: "curriculum" },
					},
				],
			}),
		);

		expect(listIngestionTaskRegistryFiles(root)).toEqual([registryPath]);
		expect(loadIngestionTaskRegistryFromFile(registryPath).tasks[0]?.registry_task_id).toBe(
			"curriculum.curriculum_plan.chunk_prepare",
		);
		expect(loadIngestionTaskRegistryCatalogFromRoot(root).requireTask).toBeTypeOf("function");
	});

	it("rejects invalid registry files", () => {
		const root = mkdtempSync(join(tmpdir(), "ingest-core-registry-invalid-"));
		const registryPath = join(root, "task-registry.v3.json");
		writeFileSync(registryPath, JSON.stringify({ schema_version: "wrong" }));

		expect(() => loadIngestionTaskRegistryFromFile(registryPath)).toThrow(
			"invalid ingestion task registry",
		);
	});

	it("loads collection chunk profiles recursively", () => {
		const root = mkdtempSync(join(tmpdir(), "ingest-core-chunk-profile-"));
		const profileDir = join(root, "regulations", "institutional_rules");
		mkdirSync(profileDir, { recursive: true });
		const profilePath = join(profileDir, "chunk-profile.json");
		writeFileSync(profilePath, JSON.stringify(chunkProfilePayload()));

		expect(listCollectionChunkProfileFiles(root)).toEqual([profilePath]);
		expect(
			loadCollectionChunkProfilesFromRoot(root).get("regulations/institutional_rules"),
		).toMatchObject({
			collection: "institutional_rules",
			corpus: "regulations",
			runtimeDefaults: {
				chunkSize: 260,
				maxChunkSize: 360,
				minChunkSize: 48,
			},
		});
	});

	it("rejects duplicate collection chunk profiles", () => {
		const root = mkdtempSync(join(tmpdir(), "ingest-core-chunk-profile-duplicate-"));
		const left = join(root, "left");
		const right = join(root, "right");
		mkdirSync(left, { recursive: true });
		mkdirSync(right, { recursive: true });
		writeFileSync(join(left, "chunk-profile.json"), JSON.stringify(chunkProfilePayload()));
		writeFileSync(join(right, "chunk-profile.json"), JSON.stringify(chunkProfilePayload()));

		expect(() => loadCollectionChunkProfilesFromRoot(root)).toThrow(
			"duplicate collection chunk profile: regulations/institutional_rules",
		);
	});
});

function chunkProfilePayload(): unknown {
	return {
		corpus: "regulations",
		collection: "institutional_rules",
		chunk_profile_version: "institutional_rules_semantic_v1",
		structured_input: "document_units_jsonl",
		runtime_defaults: {
			strategy_name: "institutional_rules_semantic_v1",
			chunk_size: 260,
			max_chunk_size: 360,
			chunk_overlap: 48,
			min_chunk_size: 48,
		},
		cleaning_policy_version: "institutional_rules_cleaning_v1",
	};
}
