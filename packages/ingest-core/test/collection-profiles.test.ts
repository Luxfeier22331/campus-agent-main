import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCollectionChunkProfile, parseCollectionRuntimeProfile } from "../src/index.ts";

const CONFIG_ROOT = join(process.cwd(), "../../configs/ingestion");

describe("collection ingestion profiles", () => {
	it("parses query-serving runtime profiles with retrieval binding metadata", () => {
		const profile = parseCollectionRuntimeProfile({
			corpus: "regulations",
			collection: "student_rules",
			serving_stage: "query_serving",
			allowed_artifact_modes: ["normalized", "source_truth_only"],
			split_manifest_required: true,
			cleaning_policy_version: "student_rules_cleaning_v1",
			chunk_profile_version: "student_rules_semantic_v3",
			retrieval_enabled: true,
			qdrant_collection_prefix: "student_rules",
			qdrant_dense_vector_name: "dense",
			qdrant_sparse_vector_name: "sparse",
			embedding_profile: {
				provider: "openai-compatible",
				model: "Qwen3-Embedding-4B",
				dimensions: 2560,
				dense_vector_name: "dense",
			},
			sparse_profile: {
				provider: "qdrant",
				model: "qdrant/bm25",
				tokenizer: "multilingual",
				language: "none",
				sparse_vector_name: "sparse",
			},
		});

		expect(profile).toMatchObject({
			corpus: "regulations",
			collection: "student_rules",
			servingStage: "query_serving",
			retrievalEnabled: true,
			qdrantIndexBinding: {
				collectionPrefix: "student_rules",
				denseVectorName: "dense",
				sparseVectorName: "sparse",
			},
			embeddingProfile: {
				provider: "openai-compatible",
				model: "Qwen3-Embedding-4B",
				dimensions: 2560,
				denseVectorName: "dense",
			},
			sparseProfile: {
				provider: "qdrant",
				model: "qdrant/bm25",
				tokenizer: "multilingual",
				language: "none",
				sparseVectorName: "sparse",
			},
		});
	});

	it("keeps scoped rules offline until its serving scope is explicitly opened", () => {
		const profile = parseCollectionRuntimeProfile(
			readConfigJson("regulations", "scoped_rules", "serving-config.json"),
		);
		expect(profile.servingStage).toBe("offline_preparation");
		expect(profile.retrievalEnabled).toBe(false);
	});

	it("rejects retrieval profiles without matching embedding and sparse vector names", () => {
		expect(() =>
			parseCollectionRuntimeProfile({
				corpus: "regulations",
				collection: "student_rules",
				serving_stage: "query_serving",
				allowed_artifact_modes: ["normalized"],
				split_manifest_required: true,
				cleaning_policy_version: "student_rules_cleaning_v1",
				chunk_profile_version: "student_rules_semantic_v3",
				retrieval_enabled: true,
				qdrant_collection_prefix: "student_rules",
				qdrant_dense_vector_name: "dense",
				qdrant_sparse_vector_name: "sparse",
				embedding_profile: {
					provider: "openai-compatible",
					model: "Qwen3-Embedding-4B",
					dimensions: 2560,
					dense_vector_name: "wrong_dense",
				},
				sparse_profile: {
					provider: "qdrant",
					model: "qdrant/bm25",
					tokenizer: "multilingual",
					language: "none",
					sparse_vector_name: "sparse",
				},
			}),
		).toThrow("embedding_profile dense_vector_name must match qdrant binding");
	});

	it("rejects tool read-model profiles that also open generic retrieval", () => {
		expect(() =>
			parseCollectionRuntimeProfile({
				corpus: "campus_services",
				collection: "transport_schedule",
				serving_stage: "tool_read_model_serving",
				allowed_artifact_modes: ["source_truth_only"],
				split_manifest_required: false,
				cleaning_policy_version: "transport_schedule_projection_v1",
				chunk_profile_version: "transport_schedule_projection_v1",
				retrieval_enabled: true,
				tool_read_model_enabled: true,
				tool_read_model_tools: ["transport_schedule_lookup"],
			}),
		).toThrow("tool_read_model_serving requires retrieval_enabled=false");
	});

	it("parses every tracked collection runtime profile and available chunk profile", () => {
		for (const { collection, corpus } of listConfiguredCollectionScopes()) {
			const runtimeProfile = parseCollectionRuntimeProfile(
				readConfigJson(corpus, collection, "serving-config.json"),
			);
			expect(runtimeProfile.corpus).toBe(corpus);
			expect(runtimeProfile.collection).toBe(collection);

			const chunkProfilePath = join(CONFIG_ROOT, corpus, collection, "chunk-profile.json");
			if (!existsSync(chunkProfilePath)) {
				continue;
			}
			const chunkProfile = parseCollectionChunkProfile(
				readConfigJson(corpus, collection, "chunk-profile.json"),
			);
			expect(chunkProfile.corpus).toBe(corpus);
			expect(chunkProfile.collection).toBe(collection);
			expect(chunkProfile.chunkProfileVersion).toBe(runtimeProfile.chunkProfileVersion);
			expect(chunkProfile.cleaningPolicyVersion).toBe(runtimeProfile.cleaningPolicyVersion);
		}
	});
});

function listConfiguredCollectionScopes(): Array<{ corpus: string; collection: string }> {
	return readdirSync(CONFIG_ROOT, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((corpusEntry) => {
			const corpus = corpusEntry.name;
			const corpusPath = join(CONFIG_ROOT, corpus);
			return readdirSync(corpusPath, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.filter((collectionEntry) =>
					existsSync(join(corpusPath, collectionEntry.name, "serving-config.json")),
				)
				.map((collectionEntry) => ({
					collection: collectionEntry.name,
					corpus,
				}));
		})
		.sort((left, right) =>
			`${left.corpus}/${left.collection}`.localeCompare(`${right.corpus}/${right.collection}`),
		);
}

function readConfigJson(corpus: string, collection: string, filename: string): unknown {
	return JSON.parse(readFileSync(join(CONFIG_ROOT, corpus, collection, filename), "utf8"));
}
