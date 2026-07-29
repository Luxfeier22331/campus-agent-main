import { z } from "zod";

import { formatZodIssues } from "./core.ts";

const ALLOWED_SERVING_STAGES = [
	"query_serving",
	"tool_read_model_serving",
	"offline_preparation",
] as const;
const ALLOWED_ARTIFACT_MODES = ["normalized", "source_truth_only"] as const;
const ALLOWED_SERVING_SURFACES = [
	"mixed",
	"stable_reference",
	"fresh_news",
	"news_archive",
] as const;
const ALLOWED_LISTING_PAGE_ROLES = [
	"discovery_only",
	"navigation_hint",
	"primary_evidence",
] as const;
const ALLOWED_EMBEDDING_PROVIDERS = ["openai-compatible", "openai", "mock"] as const;
const ALLOWED_SPARSE_PROVIDERS = ["qdrant", "mock"] as const;
const ALLOWED_SOURCE_OCR_IMAGE_ROUTING_STRATEGIES = ["default", "mineru_primary"] as const;
const ALLOWED_REVISION_TRACKS = ["source-faithful", "current-effective"] as const;

const DEFAULT_DENSE_PREFETCH_LIMIT = 20;
const DEFAULT_SPARSE_PREFETCH_LIMIT = 20;
const DEFAULT_EMBEDDING_QUERY_INSTRUCTION =
	"Given a campus policy or handbook question, retrieve relevant passages that answer the query.";
const DEFAULT_QDRANT_DENSE_VECTOR_NAME = "dense";
const DEFAULT_QDRANT_SPARSE_VECTOR_NAME = "sparse";

const RequiredTextSchema = z
	.string()
	.transform((value) => value.trim())
	.pipe(z.string().min(1));

const OptionalTextSchema = z
	.string()
	.transform((value) => value.trim())
	.pipe(z.string().min(1))
	.nullable()
	.catch(null);

const PositiveIntegerSchema = z.number().int().positive();

const EmbeddingProfileSchema = z.object({
	provider: z.enum(ALLOWED_EMBEDDING_PROVIDERS),
	model: RequiredTextSchema,
	dimensions: PositiveIntegerSchema,
	dense_vector_name: RequiredTextSchema.default(DEFAULT_QDRANT_DENSE_VECTOR_NAME),
});

const SparseProfileSchema = z.object({
	provider: z.enum(ALLOWED_SPARSE_PROVIDERS),
	model: RequiredTextSchema,
	tokenizer: RequiredTextSchema,
	language: RequiredTextSchema,
	sparse_vector_name: RequiredTextSchema.default(DEFAULT_QDRANT_SPARSE_VECTOR_NAME),
});

const CollectionRuntimeProfileSchema = z
	.object({
		corpus: RequiredTextSchema,
		collection: RequiredTextSchema,
		serving_stage: z.enum(ALLOWED_SERVING_STAGES),
		serving_surface: z.enum(ALLOWED_SERVING_SURFACES).nullable().optional(),
		allowed_artifact_modes: z.array(z.enum(ALLOWED_ARTIFACT_MODES)).min(1),
		split_manifest_required: z.boolean(),
		cleaning_policy_version: RequiredTextSchema,
		chunk_profile_version: RequiredTextSchema,
		source_ocr_provider: OptionalTextSchema.optional(),
		source_ocr_model: OptionalTextSchema.optional(),
		source_parser_version: OptionalTextSchema.optional(),
		source_ocr_image_routing_strategy: z
			.enum(ALLOWED_SOURCE_OCR_IMAGE_ROUTING_STRATEGIES)
			.nullable()
			.optional(),
		retrieval_enabled: z.boolean(),
		tool_read_model_enabled: z.boolean().default(false),
		tool_read_model_tools: z.array(RequiredTextSchema).default([]),
		supports_freshness_sensitive_queries: z.boolean().default(false),
		freshness_max_age_hours: PositiveIntegerSchema.nullable().optional(),
		serving_revision_tracks: z.array(z.enum(ALLOWED_REVISION_TRACKS)).default([]),
		serving_visibility_levels: z.array(RequiredTextSchema).default([]),
		serving_visibility_scopes: z.array(RequiredTextSchema).default([]),
		primary_evidence_page_families: z.array(RequiredTextSchema).default([]),
		listing_page_role: z.enum(ALLOWED_LISTING_PAGE_ROLES).nullable().optional(),
		requires_freshness_gate: z.boolean().default(false),
		requires_explicit_history_intent: z.boolean().default(false),
		duplicate_collapse_required: z.boolean().default(false),
		dense_prefetch_limit: PositiveIntegerSchema.default(DEFAULT_DENSE_PREFETCH_LIMIT),
		sparse_prefetch_limit: PositiveIntegerSchema.default(DEFAULT_SPARSE_PREFETCH_LIMIT),
		embedding_query_instruction: RequiredTextSchema.default(DEFAULT_EMBEDDING_QUERY_INSTRUCTION),
		qdrant_collection_prefix: RequiredTextSchema.default("unconfigured"),
		qdrant_dense_vector_name: RequiredTextSchema.default(DEFAULT_QDRANT_DENSE_VECTOR_NAME),
		qdrant_sparse_vector_name: RequiredTextSchema.default(DEFAULT_QDRANT_SPARSE_VECTOR_NAME),
		embedding_profile: EmbeddingProfileSchema.nullable().optional(),
		sparse_profile: SparseProfileSchema.nullable().optional(),
	})
	.superRefine((value, context) => {
		if (value.serving_stage === "tool_read_model_serving") {
			if (value.retrieval_enabled) {
				context.addIssue({
					code: "custom",
					message: "tool_read_model_serving requires retrieval_enabled=false",
					path: ["retrieval_enabled"],
				});
			}
			if (!value.tool_read_model_enabled) {
				context.addIssue({
					code: "custom",
					message: "tool_read_model_serving requires tool_read_model_enabled=true",
					path: ["tool_read_model_enabled"],
				});
			}
		}
		if (value.tool_read_model_enabled && value.tool_read_model_tools.length === 0) {
			context.addIssue({
				code: "custom",
				message: "tool_read_model_tools must not be empty when tool_read_model_enabled is true",
				path: ["tool_read_model_tools"],
			});
		}
		if (value.retrieval_enabled) {
			if (!value.embedding_profile) {
				context.addIssue({
					code: "custom",
					message: "embedding_profile is required when retrieval is enabled",
					path: ["embedding_profile"],
				});
			} else if (value.embedding_profile.dense_vector_name !== value.qdrant_dense_vector_name) {
				context.addIssue({
					code: "custom",
					message: "embedding_profile dense_vector_name must match qdrant binding",
					path: ["embedding_profile", "dense_vector_name"],
				});
			}
			if (!value.sparse_profile) {
				context.addIssue({
					code: "custom",
					message: "sparse_profile is required when retrieval is enabled",
					path: ["sparse_profile"],
				});
			} else if (value.sparse_profile.sparse_vector_name !== value.qdrant_sparse_vector_name) {
				context.addIssue({
					code: "custom",
					message: "sparse_profile sparse_vector_name must match qdrant binding",
					path: ["sparse_profile", "sparse_vector_name"],
				});
			}
		}
	});

const ChunkRuntimeDefaultsSchema = z
	.object({
		strategy_name: RequiredTextSchema,
		chunk_size: PositiveIntegerSchema,
		max_chunk_size: PositiveIntegerSchema,
		chunk_overlap: z.number().int().nonnegative(),
		min_chunk_size: PositiveIntegerSchema,
	})
	.superRefine((value, context) => {
		if (value.max_chunk_size < value.chunk_size) {
			context.addIssue({
				code: "custom",
				message: "max_chunk_size must be greater than or equal to chunk_size",
				path: ["max_chunk_size"],
			});
		}
		if (value.chunk_overlap >= value.max_chunk_size) {
			context.addIssue({
				code: "custom",
				message: "chunk_overlap must be less than max_chunk_size",
				path: ["chunk_overlap"],
			});
		}
		if (value.min_chunk_size >= value.max_chunk_size) {
			context.addIssue({
				code: "custom",
				message: "min_chunk_size must be less than max_chunk_size",
				path: ["min_chunk_size"],
			});
		}
	});

const CollectionChunkProfileSchema = z.object({
	corpus: RequiredTextSchema,
	collection: RequiredTextSchema,
	chunk_profile_version: RequiredTextSchema,
	structured_input: RequiredTextSchema,
	runtime_defaults: ChunkRuntimeDefaultsSchema,
	cleaning_policy_version: RequiredTextSchema,
	lane_defaults: z.record(z.string(), ChunkRuntimeDefaultsSchema).default({}),
});

export interface CollectionEmbeddingProfile {
	provider: string;
	model: string;
	dimensions: number;
	denseVectorName: string;
}

export interface CollectionSparseProfile {
	provider: string;
	model: string;
	tokenizer: string;
	language: string;
	sparseVectorName: string;
}

export interface QdrantIndexBindingProfile {
	collectionPrefix: string;
	denseVectorName: string;
	sparseVectorName: string;
}

export interface CollectionRuntimeProfile {
	corpus: string;
	collection: string;
	servingStage: string;
	servingSurface: string | null;
	allowedArtifactModes: string[];
	splitManifestRequired: boolean;
	cleaningPolicyVersion: string;
	chunkProfileVersion: string;
	sourceOcrProvider: string | null;
	sourceOcrModel: string | null;
	sourceParserVersion: string | null;
	sourceOcrImageRoutingStrategy: string | null;
	retrievalEnabled: boolean;
	toolReadModelEnabled: boolean;
	toolReadModelTools: string[];
	supportsFreshnessSensitiveQueries: boolean;
	freshnessMaxAgeHours: number | null;
	servingRevisionTracks: string[];
	servingVisibilityLevels: string[];
	servingVisibilityScopes: string[];
	primaryEvidencePageFamilies: string[];
	listingPageRole: string | null;
	requiresFreshnessGate: boolean;
	requiresExplicitHistoryIntent: boolean;
	duplicateCollapseRequired: boolean;
	densePrefetchLimit: number;
	sparsePrefetchLimit: number;
	embeddingQueryInstruction: string;
	qdrantIndexBinding: QdrantIndexBindingProfile;
	embeddingProfile: CollectionEmbeddingProfile | null;
	sparseProfile: CollectionSparseProfile | null;
}

export interface CollectionChunkRuntimeDefaults {
	strategyName: string;
	chunkSize: number;
	maxChunkSize: number;
	chunkOverlap: number;
	minChunkSize: number;
}

export interface CollectionChunkProfile {
	corpus: string;
	collection: string;
	chunkProfileVersion: string;
	structuredInput: string;
	runtimeDefaults: CollectionChunkRuntimeDefaults;
	cleaningPolicyVersion: string;
	laneDefaults: Record<string, CollectionChunkRuntimeDefaults>;
}

export function parseCollectionRuntimeProfile(value: unknown): CollectionRuntimeProfile {
	const parsed = CollectionRuntimeProfileSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`collection runtime profile is invalid: ${formatZodIssues(
				parsed.error.issues,
				"profile",
			).join("; ")}`,
		);
	}
	return toCollectionRuntimeProfile(parsed.data);
}

export function parseCollectionChunkProfile(value: unknown): CollectionChunkProfile {
	const parsed = CollectionChunkProfileSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`collection chunk profile is invalid: ${formatZodIssues(parsed.error.issues, "profile").join(
				"; ",
			)}`,
		);
	}
	return {
		corpus: parsed.data.corpus,
		collection: parsed.data.collection,
		chunkProfileVersion: parsed.data.chunk_profile_version,
		structuredInput: parsed.data.structured_input,
		runtimeDefaults: toChunkRuntimeDefaults(parsed.data.runtime_defaults),
		cleaningPolicyVersion: parsed.data.cleaning_policy_version,
		laneDefaults: Object.fromEntries(
			Object.entries(parsed.data.lane_defaults).map(([lane, defaults]) => [
				lane,
				toChunkRuntimeDefaults(defaults),
			]),
		),
	};
}

function toCollectionRuntimeProfile(
	value: z.infer<typeof CollectionRuntimeProfileSchema>,
): CollectionRuntimeProfile {
	return {
		corpus: value.corpus,
		collection: value.collection,
		servingStage: value.serving_stage,
		servingSurface: value.serving_surface ?? null,
		allowedArtifactModes: value.allowed_artifact_modes,
		splitManifestRequired: value.split_manifest_required,
		cleaningPolicyVersion: value.cleaning_policy_version,
		chunkProfileVersion: value.chunk_profile_version,
		sourceOcrProvider: value.source_ocr_provider ?? null,
		sourceOcrModel: value.source_ocr_model ?? null,
		sourceParserVersion: value.source_parser_version ?? null,
		sourceOcrImageRoutingStrategy: value.source_ocr_image_routing_strategy ?? null,
		retrievalEnabled: value.retrieval_enabled,
		toolReadModelEnabled: value.tool_read_model_enabled,
		toolReadModelTools: value.tool_read_model_tools,
		supportsFreshnessSensitiveQueries: value.supports_freshness_sensitive_queries,
		freshnessMaxAgeHours: value.freshness_max_age_hours ?? null,
		servingRevisionTracks: value.serving_revision_tracks,
		servingVisibilityLevels: value.serving_visibility_levels,
		servingVisibilityScopes: value.serving_visibility_scopes,
		primaryEvidencePageFamilies: value.primary_evidence_page_families,
		listingPageRole: value.listing_page_role ?? null,
		requiresFreshnessGate: value.requires_freshness_gate,
		requiresExplicitHistoryIntent: value.requires_explicit_history_intent,
		duplicateCollapseRequired: value.duplicate_collapse_required,
		densePrefetchLimit: value.dense_prefetch_limit,
		sparsePrefetchLimit: value.sparse_prefetch_limit,
		embeddingQueryInstruction: value.embedding_query_instruction,
		qdrantIndexBinding: {
			collectionPrefix: value.qdrant_collection_prefix,
			denseVectorName: value.qdrant_dense_vector_name,
			sparseVectorName: value.qdrant_sparse_vector_name,
		},
		embeddingProfile: value.embedding_profile
			? {
					provider: value.embedding_profile.provider,
					model: value.embedding_profile.model,
					dimensions: value.embedding_profile.dimensions,
					denseVectorName: value.embedding_profile.dense_vector_name,
				}
			: null,
		sparseProfile: value.sparse_profile
			? {
					provider: value.sparse_profile.provider,
					model: value.sparse_profile.model,
					tokenizer: value.sparse_profile.tokenizer,
					language: value.sparse_profile.language,
					sparseVectorName: value.sparse_profile.sparse_vector_name,
				}
			: null,
	};
}

function toChunkRuntimeDefaults(
	value: z.infer<typeof ChunkRuntimeDefaultsSchema>,
): CollectionChunkRuntimeDefaults {
	return {
		strategyName: value.strategy_name,
		chunkSize: value.chunk_size,
		maxChunkSize: value.max_chunk_size,
		chunkOverlap: value.chunk_overlap,
		minChunkSize: value.min_chunk_size,
	};
}
