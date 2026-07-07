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

describe("ingest-core node registry loading", () => {
	it("loads registry files recursively and validates shape", () => {
		const root = mkdtempSync(join(tmpdir(), "ingest-core-registry-"));
		const registryDir = join(root, "official_web", "stable_reference");
		mkdirSync(registryDir, { recursive: true });
		const registryPath = join(registryDir, "task-registry.v2.json");
		writeFileSync(
			registryPath,
			JSON.stringify({
				schema_version: "ingestion_task_registry.v2",
				source_family: "official_web",
				corpus: "official_web",
				collection: "stable_reference",
				tasks: [
					{
						task_kind: "source_truth_materialize",
						executor_kind: "ts_control",
						registry_task_id: "source_truth_materialize",
						input_contract: "official_web_source_truth_bundle.v1",
						output_contract: "official_web_stable_reference_source_truth.v1",
					},
				],
			}),
		);

		expect(listIngestionTaskRegistryFiles(root)).toEqual([registryPath]);
		expect(loadIngestionTaskRegistryFromFile(registryPath).collection).toBe("stable_reference");
		expect(loadIngestionTaskRegistryCatalogFromRoot(root).requireTask).toBeTypeOf("function");
	});

	it("rejects invalid registry files", () => {
		const root = mkdtempSync(join(tmpdir(), "ingest-core-registry-invalid-"));
		const registryPath = join(root, "task-registry.v2.json");
		writeFileSync(registryPath, JSON.stringify({ schema_version: "wrong" }));

		expect(() => loadIngestionTaskRegistryFromFile(registryPath)).toThrow(
			"invalid ingestion task registry",
		);
	});

	it("loads collection chunk profiles recursively", () => {
		const root = mkdtempSync(join(tmpdir(), "ingest-core-chunk-profile-"));
		const profileDir = join(root, "official_web", "stable_reference");
		mkdirSync(profileDir, { recursive: true });
		const profilePath = join(profileDir, "chunk-profile.json");
		writeFileSync(profilePath, JSON.stringify(chunkProfilePayload()));

		expect(listCollectionChunkProfileFiles(root)).toEqual([profilePath]);
		expect(
			loadCollectionChunkProfilesFromRoot(root).get("official_web/stable_reference"),
		).toMatchObject({
			collection: "stable_reference",
			corpus: "official_web",
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
			"duplicate collection chunk profile: official_web/stable_reference",
		);
	});
});

function chunkProfilePayload(): unknown {
	return {
		corpus: "official_web",
		collection: "stable_reference",
		chunk_profile_version: "official_web_semantic_v2",
		structured_input: "document_units_jsonl",
		runtime_defaults: {
			strategy_name: "official_web_stable_reference_semantic_v2",
			chunk_size: 260,
			max_chunk_size: 360,
			chunk_overlap: 48,
			min_chunk_size: 48,
		},
		cleaning_policy_version: "official_web_cleaning_v2",
	};
}
