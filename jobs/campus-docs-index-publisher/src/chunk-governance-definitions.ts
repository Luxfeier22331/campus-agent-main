import { CANONICAL_EMBEDDING_MODEL, EMBEDDING_SPACE } from "@campus-agent/embedding-runtime";
import { CHUNK_SET_DEFINITION, COLLECTION_DEFINITION } from "./definitions.ts";

export const CAMPUS_DOCS_CHUNK_GOVERNANCE_DEFINITION = {
	chunkThresholds: {
		nearMaxChars: 1200,
		shortChars: 200,
		tinyChars: 80,
	},
	embedding: {
		model: CANONICAL_EMBEDDING_MODEL,
		queryInstruction: COLLECTION_DEFINITION.dense.queryInstruction,
		rankingCutoffs: [1, 3, 5, 10],
		rankingDepth: 10,
		similarity: "cosine",
		space: EMBEDDING_SPACE,
	},
	review: {
		controlItemTarget: 100,
		itemTarget: 450,
		perDocumentItemCap: 4,
		sampleTarget: 150,
		signalStrata: [
			{ name: "table-context-overhead", signals: ["table-context-overhead"], target: 70 },
			{ name: "section-fragment", signals: ["section-fragment"], target: 70 },
			{ name: "mergeable-short-tail", signals: ["mergeable-short-tail"], target: 60 },
			{ name: "short-table-chunk", signals: ["short-table-chunk"], target: 40 },
			{
				name: "many-root-or-split-reader",
				signals: ["many-root-units", "split-reader-element"],
				target: 40,
			},
		],
	},
	chunkDefinition: CHUNK_SET_DEFINITION.chunking,
} as const;

export const CAMPUS_DOCS_CHUNK_GOVERNANCE_SCHEMA_VERSION =
	"campus_docs_chunk_governance_run.v1" as const;
export const CAMPUS_DOCS_CHUNK_CENSUS_SCHEMA_VERSION =
	"campus_docs_chunk_census.v1" as const;
export const CAMPUS_DOCS_CHUNK_COMPARISON_SCHEMA_VERSION =
	"campus_docs_chunk_comparison.v1" as const;
export const CAMPUS_DOCS_CHUNK_COMPARISON_RUN_SCHEMA_VERSION =
	"campus_docs_chunk_comparison_run.v1" as const;
export const CAMPUS_DOCS_CHUNK_EMBEDDING_EVALUATION_SCHEMA_VERSION =
	"campus_docs_chunk_embedding_evaluation_run.v1" as const;
export const CAMPUS_DOCS_CHUNK_EMBEDDING_METRICS_SCHEMA_VERSION =
	"campus_docs_chunk_embedding_metrics.v1" as const;
export const CAMPUS_DOCS_CHUNK_EMBEDDING_CACHE_SCHEMA_VERSION =
	"campus_docs_chunk_embedding_cache.v1" as const;
